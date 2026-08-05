import type { SettingsAdapter } from '@banou/media-player'

import {
  SETTING_AUDIO_LANGUAGE, SETTING_HIDE_STATS, SETTING_PLAYBACK_RATE, SETTING_SUBTITLE_LANGUAGE,
  localStorageSettings,
} from '@banou/media-player'

/**
 * Which settings follow a person between devices, and which belong to the machine they are on.
 *
 * Volume and mute are deliberately NOT here. Output hardware differs: 1.0 on a laptop speaker and 0.2
 * on a desk amp are both correct, and syncing that means every sign-in on a second device is either
 * silent or deafening. What syncs is a statement about the viewer, not about the hardware.
 *
 * The subtitle and audio preferences are LANGUAGES, never stream indexes. An index is meaningful
 * only inside one file, so it is worthless the moment it crosses to another device or another video.
 */
const SYNCED_KEYS = [
  SETTING_HIDE_STATS,
  SETTING_PLAYBACK_RATE,
  SETTING_SUBTITLE_LANGUAGE,
  SETTING_AUDIO_LANGUAGE,
] as const

const BACKUP_PATH = 'video-player/settings.json'
const ACCOUNT_KEY = 'fkn-video:sync-account'
const WRITE_DEBOUNCE = 3_000
const BROKER_TIMEOUT = 10_000
// The last delay repeats forever. Never add a give-up: a restore that gives up leaves writes disarmed
// for the life of the page, so a preference changed after a passing glitch never reaches the cloud
// and nothing re-arms it.
const RESTORE_BACKOFF = [5_000, 10_000, 20_000, 40_000, 60_000]

export type SyncStatus = 'off' | 'syncing' | 'synced' | 'error'

type Document = { values: Record<string, string>, stamps: Record<string, number> }

// The broker reports each of these with a reserved marker that survives the RPC boundary: custom
// properties are stripped, the message and `code` are not.
const isLocked = (error: unknown) => (error as { code?: string })?.code === 'FKN_E2E_LOCKED'
const isUnreadable = (error: unknown) => {
  const message = (error as { message?: string })?.message ?? ''
  return message.startsWith('fkn:e2e-integrity') || message.startsWith('fkn:e2e-stale-epoch')
}
const isMissing = (error: unknown) => /not found|enoent/i.test((error as { message?: string })?.message ?? '')

const bounded = <T>(work: Promise<T>, fallback: T, ms = BROKER_TIMEOUT): Promise<T> =>
  Promise.race([
    work,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('broker timed out')), ms)),
  ]).catch((error) => {
    if ((error as Error)?.message === 'broker timed out') return fallback
    throw error
  })

/**
 * A settings store that is local first and cloud second.
 *
 * localStorage is the source of truth for the running player and is read synchronously, so the player
 * renders and plays before anything here has resolved. Nothing in this module is on the path to a
 * first frame: no account, no broker, no await. If every one of them fails, the player behaves exactly
 * as it does for an anonymous visitor.
 */
export const createCloudSettings = (): SettingsAdapter & { attach: () => () => void, status: () => SyncStatus } => {
  const local = localStorageSettings
  const listeners = new Set<() => void>()
  let status: SyncStatus = 'off'
  const stamps: Record<string, number> = {}

  const notify = () => { for (const listener of listeners) listener() }

  const readStamps = () => {
    try {
      return JSON.parse(local.get('fkn-video:stamps') ?? '{}') as Record<string, number>
    } catch {
      return {}
    }
  }
  Object.assign(stamps, readStamps())

  const adapter: SettingsAdapter = {
    get: (key) => local.get(key),
    set: (key, value) => {
      local.set(key, value)
      if ((SYNCED_KEYS as readonly string[]).includes(key)) {
        stamps[key] = Date.now()
        local.set('fkn-video:stamps', JSON.stringify(stamps))
        scheduleWrite()
      }
      notify()
    },
    subscribe: (listener) => {
      listeners.add(listener)
      const off = local.subscribe?.(listener)
      return () => { listeners.delete(listener); off?.() }
    },
  }

  let writeTimer: ReturnType<typeof setTimeout> | undefined
  let pending = false
  let restored = false
  let stopped = false
  let generation = 0

  const localDocument = (): Document => ({
    values: Object.fromEntries(
      SYNCED_KEYS.map((key) => [key, adapter.get(key)]).filter(([, value]) => value !== undefined) as [string, string][],
    ),
    stamps: { ...stamps },
  })

  const merge = (remote: Document) => {
    // Last write wins per field. Comparing per field rather than per document means two devices that
    // each changed a different setting both keep their change.
    for (const key of SYNCED_KEYS) {
      const remoteStamp = remote.stamps?.[key] ?? 0
      const localStamp = stamps[key] ?? 0
      const value = remote.values?.[key]
      if (value !== undefined && remoteStamp > localStamp) {
        local.set(key, value)
        stamps[key] = remoteStamp
      }
    }
    local.set('fkn-video:stamps', JSON.stringify(stamps))
    notify()
  }

  const scheduleWrite = () => {
    pending = true
    if (!restored || stopped) return
    clearTimeout(writeTimer)
    writeTimer = setTimeout(() => { void flush() }, WRITE_DEBOUNCE)
  }

  const flush = async () => {
    if (!restored || stopped) return
    try {
      const { cloud } = await import('@fkn/lib')
      await cloud.fs.promises.writeFile(BACKUP_PATH, JSON.stringify(localDocument()))
      pending = false
      status = 'synced'
    } catch (error) {
      // Owed, not lost: pending stays true so the next restore or `online` flushes it.
      status = 'error'
      if (isLocked(error)) return
    }
  }

  const restore = async (attempt = 0): Promise<void> => {
    if (stopped) return
    const mine = ++generation
    status = 'syncing'
    try {
      const { account, cloud } = await import('@fkn/lib')
      if (!(await bounded(cloud.fs.available(), false, 4_000))) { status = 'off'; return }

      const name = await bounded(account.info().then((info) => info?.name ?? null), null, 4_000).catch(() => null)
      const remembered = local.get(ACCOUNT_KEY)
      if (!name) {
        // A null answer with an account remembered means "we do not know who this is", not "nobody".
        // Handing one account's preferences to whoever comes next is the failure this prevents.
        if (!remembered) { status = 'off'; return }
        throw new Error('account unavailable')
      }
      if (name !== remembered) {
        // Switching accounts: the local stamps describe someone else's edits.
        for (const key of SYNCED_KEYS) delete stamps[key]
      }
      local.set(ACCOUNT_KEY, name)

      let remote: Document | null = null
      try {
        const raw = await cloud.fs.promises.readFile(BACKUP_PATH, 'utf8')
        remote = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw as ArrayBuffer)) as Document
      } catch (error) {
        // Missing and undecryptable are the same thing: nothing can read those bytes, and reseeding
        // from local is the only way the document ever becomes readable again.
        if (!isMissing(error) && !isUnreadable(error)) throw error
        remote = null
      }

      if (mine !== generation || stopped) return
      if (remote) merge(remote)
      restored = true
      status = 'synced'
      if (remote === null || pending) await flush()
    } catch (error) {
      if (mine !== generation || stopped) return
      status = 'error'
      const delay = RESTORE_BACKOFF[Math.min(attempt, RESTORE_BACKOFF.length - 1)]!
      setTimeout(() => { void restore(attempt + 1) }, delay)
    }
  }

  return {
    ...adapter,
    status: () => status,
    attach: () => {
      stopped = false
      void restore()
      const onOnline = () => { if (!restored || pending) void restore() }
      window.addEventListener('online', onOnline)
      return () => {
        stopped = true
        generation++
        clearTimeout(writeTimer)
        window.removeEventListener('online', onOnline)
      }
    },
  }
}
