import type { Remote } from 'osra'
import type {
  EmbedChrome, EmbedEvent, EmbedGreeting, EmbedPlayerApi, EmbedSource, EmbedderApi,
} from './protocol'

import { expose, transfer } from 'osra'

import { GREETER_KEY, PLAYER_ORIGIN, PROTOCOL_VERSION } from './protocol'

/**
 * Re-exported so an embedder can move a buffer without taking its own osra dependency. A returned
 * ArrayBuffer is copied, not moved, unless it is wrapped in this.
 */
export { transfer }

export type EmbedHandle = {
  /** The live player, replaced transparently when the iframe reloads and reconnects. */
  readonly player: Remote<EmbedPlayerApi>
  readonly iframe: HTMLIFrameElement
  addEventListener: <T extends EmbedEvent['type']>(
    type: T,
    listener: (event: Extract<EmbedEvent, { type: T }>) => void,
  ) => () => void
  destroy: () => void
}

export type CreateEmbedOptions = {
  /** Where the iframe is mounted. */
  container: HTMLElement
  source?: EmbedSource | (() => Promise<EmbedSource | null>)
  chrome?: EmbedChrome
  /** Defaults to the hosted player. Pass a bare origin when self-hosting. */
  playerOrigin?: string
  /** Display hint sent to the player. */
  name?: string
  /** How long to wait for the first connection before giving up. */
  timeout?: number
}

const DEFAULT_TIMEOUT = 15_000

/**
 * Embeds the player and connects to it.
 *
 * The iframe needs `allow="autoplay; fullscreen; picture-in-picture"` or play() is refused and
 * fullscreen is unavailable, so it is set here rather than left to the caller.
 */
export const createEmbed = async (options: CreateEmbedOptions): Promise<EmbedHandle> => {
  const { container, chrome, name, timeout = DEFAULT_TIMEOUT } = options
  // A BARE origin. `iframe.src` is a url, and even the trailing slash of a one-path url makes every
  // comparison against a browser-set origin false, in both directions and with nothing thrown.
  const playerOrigin = new URL(options.playerOrigin ?? PLAYER_ORIGIN).origin

  const iframe = document.createElement('iframe')
  iframe.src = `${playerOrigin}/embed`
  iframe.allow = 'autoplay; fullscreen; picture-in-picture'
  iframe.style.border = '0'
  iframe.style.width = '100%'
  iframe.style.height = '100%'
  container.appendChild(iframe)

  const controller = new AbortController()
  const listeners = new Map<string, Set<(event: EmbedEvent) => void>>()
  const dispatch = (event: EmbedEvent) => {
    for (const listener of listeners.get(event.type) ?? []) listener(event)
    for (const listener of listeners.get('*') ?? []) listener(event)
  }

  const sourceFor = async (): Promise<EmbedSource | null> => {
    if (typeof options.source === 'function') return options.source()
    return options.source ?? null
  }

  let player: Remote<EmbedPlayerApi> | null = null
  let sessionAbort: AbortController | null = null
  let resolveFirst: ((value: Remote<EmbedPlayerApi>) => void) | null = null
  let rejectFirst: ((error: Error) => void) | null = null
  const first = new Promise<Remote<EmbedPlayerApi>>((resolve, reject) => {
    resolveFirst = resolve
    rejectFirst = reject
  })

  const onGreeting = async (greeting: EmbedGreeting) => {
    if (greeting.protocolVersion !== PROTOCOL_VERSION) {
      rejectFirst?.(new Error(`The player speaks embed protocol ${greeting.protocolVersion}, this client speaks ${PROTOCOL_VERSION}`))
      return
    }
    // A reconnect means the old session is dead; its pending calls would otherwise hang forever.
    sessionAbort?.abort()
    sessionAbort = new AbortController()

    const remote = await expose<EmbedPlayerApi>({} as Record<string, never>, {
      transport: { receive: window, emit: iframe.contentWindow! },
      key: greeting.sessionKey,
      origin: playerOrigin,
      unregisterSignal: sessionAbort.signal,
    })

    player = remote
    await remote.subscribe((event) => dispatch(event))
    const source = await sourceFor()
    if (source) await remote.load(source, chrome ?? {})
    resolveFirst?.(remote)
  }

  const embedderApi: EmbedderApi = {
    greet: (greeting) => { void onGreeting(greeting).catch((error) => rejectFirst?.(error as Error)) },
    ...(name ? { name } : {}),
    source: sourceFor,
  }

  // A loop, not a single await: the iframe can reload (a service worker update does exactly that) and
  // every reload announces again.
  void (async () => {
    for await (const _peer of expose(embedderApi, {
      transport: { receive: window, emit: iframe.contentWindow! },
      key: GREETER_KEY,
      origin: playerOrigin,
      unregisterSignal: controller.signal,
    })) {
      // the player greets us; nothing to do with its greeter value
    }
  })().catch(() => {})

  const timer = setTimeout(
    () => rejectFirst?.(new Error(`The player at ${playerOrigin} did not connect within ${timeout}ms`)),
    timeout,
  )

  try {
    await first
  } finally {
    clearTimeout(timer)
  }

  return {
    get player() {
      if (!player) throw new Error('The player is not connected')
      return player
    },
    iframe,
    addEventListener: (type, listener) => {
      const set = listeners.get(type) ?? new Set()
      listeners.set(type, set)
      set.add(listener as (event: EmbedEvent) => void)
      return () => set.delete(listener as (event: EmbedEvent) => void)
    },
    destroy: () => {
      controller.abort()
      sessionAbort?.abort()
      listeners.clear()
      iframe.remove()
    },
  }
}
