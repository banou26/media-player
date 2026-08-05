import { createEmbed } from '@banou/media-player/embed'

const logEl = document.getElementById('log')!
const log = (...parts: unknown[]) => {
  const line = parts.map((part) => (typeof part === 'string' ? part : JSON.stringify(part))).join(' ')
  logEl.textContent += `${line}\n`
  logEl.scrollTop = logEl.scrollHeight
  console.warn('[embedder]', line)
}

// The player runs on localhost, this page on 127.0.0.1, so the two are genuinely different origins.
const PLAYER_ORIGIN = 'http://localhost:4570'

declare global {
  interface Window {
    harness: Record<string, unknown>
  }
}

const params = new URLSearchParams(window.location.search)
const sourceUrl = params.get('url')

const run = async () => {
  log('connecting to', PLAYER_ORIGIN)
  const embed = await createEmbed({
    container: document.getElementById('frame')!,
    playerOrigin: PLAYER_ORIGIN,
    name: 'embed harness',
    chrome: { title: 'fed over osra', autoplay: true },
    source: sourceUrl ? { kind: 'url', url: sourceUrl } : undefined,
  })
  log('connected, protocol', await embed.player.protocolVersion)

  const seen: string[] = []
  embed.addEventListener('ready', (event) => log('event ready, duration', event.duration))
  embed.addEventListener('subtitletracks', (event) => log('event subtitletracks', event.tracks.length))
  embed.addEventListener('error', (event) => log('event error', event.code, event.message))
  for (const type of ['play', 'pause', 'timeupdate', 'volumechange', 'ratechange'] as const) {
    embed.addEventListener(type, () => { if (!seen.includes(type)) { seen.push(type); log('first event:', type) } })
  }

  window.harness = {
    embed,
    seen,
    state: () => embed.player.getState(),
    play: () => embed.player.play(),
    pause: () => embed.player.pause(),
    seek: (t: number) => embed.player.seek(t),
    setVolume: (v: number) => embed.player.setVolume(v),
    setRate: (r: number) => embed.player.setPlaybackRate(r),
    subtitles: () => embed.player.getSubtitleTracks(),
    selectSubtitle: (i: number | undefined) => embed.player.selectSubtitleTrack(i),
    audio: () => embed.player.getAudioTracks(),
    loadBlob: async (blob: Blob, name: string) => embed.player.load({ kind: 'blob', blob, name }, { autoplay: true, title: name }),
  }
  ;(window as unknown as { harnessReady: boolean }).harnessReady = true
  log('harness ready')
}

run().catch((error) => log('FAILED:', String(error)))
