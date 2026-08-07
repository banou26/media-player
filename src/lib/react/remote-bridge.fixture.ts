import type { PlayerMedia } from './media'

/**
 * A real video in another document, driven over a real message port.
 *
 * This exists because every other remote test here drives an object in the same realm, which proves
 * the wiring and hides the actual risk: `Media` is entirely SYNCHRONOUS (`currentTime` is a getter
 * that must answer now) while any cross-document transport is asynchronous. The only shape that can
 * satisfy both is a locally-held mirror with synchronous getters, updated by messages, with commands
 * posted out and never awaited. Handing an async proxy straight to `setMedia` cannot work, and this
 * fixture is what proves the mirror does.
 *
 * The protocol deliberately mirrors what @fkn/lib's `RemoteVideoElement` already implements: a
 * snapshot of readable state, optimistic writes reconciled from a returned snapshot, and events
 * forwarded from the far side. Nothing here is FKN-specific, so a passing test says the contract is
 * satisfiable rather than that one implementation happens to work.
 */

/** exactly the readable state @fkn/lib carries, so the two are interchangeable */
export type RemoteState = {
  currentTime: number
  duration: number
  paused: boolean
  ended: boolean
  seeking: boolean
  readyState: number
  volume: number
  muted: boolean
  playbackRate: number
  src: string
  currentSrc: string
  buffered: [number, number][]
  seekable: [number, number][]
}

const EVENTS = [
  'loadedmetadata', 'durationchange', 'timeupdate', 'play', 'pause', 'seeking', 'seeked',
  'progress', 'ratechange', 'volumechange', 'ended', 'waiting', 'canplay', 'error',
] as const

/** the document that owns the element: everything it knows leaves as a message, nothing is shared */
export const REMOTE_FRAME_SOURCE = `
<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;background:#000}video{width:100%;height:100%}</style>
<video playsinline></video>
<script type="module">
const video = document.querySelector('video')
const EVENTS = ${JSON.stringify(EVENTS)}
const ranges = (r) => { const out = []; for (let i = 0; i < r.length; i++) out.push([r.start(i), r.end(i)]); return out }
const snapshot = () => ({
  currentTime: video.currentTime, duration: Number.isFinite(video.duration) ? video.duration : 0,
  paused: video.paused, ended: video.ended, seeking: video.seeking, readyState: video.readyState,
  volume: video.volume, muted: video.muted, playbackRate: video.playbackRate,
  src: video.src, currentSrc: video.currentSrc,
  buffered: ranges(video.buffered), seekable: ranges(video.seekable),
})
let port
addEventListener('message', (event) => {
  if (event.data?.type !== 'connect') return
  port = event.ports[0]
  port.onmessage = async ({ data }) => {
    if (data.type === 'set') { try { video[data.name] = data.value } catch {} }
    if (data.type === 'call') { try { await video[data.name]?.() } catch {} }
    // Muted, and not incidentally. A remote play() runs under the FAR document's autoplay policy,
    // and a postMessage carries no user activation across, so an unmuted element there refuses to
    // start no matter who clicked what over here. Muted playback is always permitted. Real callers
    // face the same rule: the click has to reach the document that owns the element, or the media
    // has to be muted until it does.
    if (data.type === 'load') { video.muted = true; video.src = data.src; video.load() }
    port.postMessage({ type: 'state', state: snapshot() })
  }
  for (const name of EVENTS) {
    video.addEventListener(name, () => port.postMessage({ type: 'event', name, state: snapshot() }))
  }
  port.postMessage({ type: 'state', state: snapshot() })
})
</script>`

const toTimeRanges = (pairs: [number, number][]) => ({
  length: pairs.length,
  start: (i: number) => pairs[i]?.[0] ?? 0,
  end: (i: number) => pairs[i]?.[1] ?? 0,
})

export type RemoteBridge = {
  media: PlayerMedia
  /** every command that actually crossed the boundary, for asserting on */
  sent: string[]
  destroy: () => void
}

/**
 * The mirror. Reads answer from local state; writes go out optimistically and are reconciled by
 * whatever snapshot comes back.
 */
export const createRemoteBridge = (port: MessagePort): RemoteBridge => {
  const target = new EventTarget()
  const sent: string[] = []
  const state: RemoteState = {
    currentTime: 0, duration: 0, paused: true, ended: false, seeking: false, readyState: 0,
    volume: 1, muted: false, playbackRate: 1, src: '', currentSrc: '',
    buffered: [], seekable: [],
  }

  port.onmessage = ({ data }) => {
    if (data.type === 'state' || data.type === 'event') Object.assign(state, data.state)
    // Re-dispatched locally so the store hears the far side exactly as it would hear an element.
    if (data.type === 'event') target.dispatchEvent(new Event(data.name))
  }
  port.start?.()

  const media = target as unknown as PlayerMedia & Record<string, unknown>

  const readable = <K extends keyof RemoteState>(name: K, map?: (value: RemoteState[K]) => unknown) =>
    Object.defineProperty(media, name, { get: () => map ? map(state[name]) : state[name], configurable: true })

  for (const name of ['duration', 'paused', 'ended', 'seeking', 'readyState', 'currentSrc', 'src'] as const) {
    readable(name)
  }
  readable('buffered', toTimeRanges)
  readable('seekable', toTimeRanges)

  // Writable: the local value moves at once so a getter read in the same tick sees it, which is what
  // the seek bar does, and the write is posted out to be applied for real.
  for (const name of ['currentTime', 'volume', 'muted', 'playbackRate'] as const) {
    Object.defineProperty(media, name, {
      get: () => state[name],
      set: (value) => {
        ;(state as Record<string, unknown>)[name] = value
        sent.push(`set:${name}`)
        port.postMessage({ type: 'set', name, value })
      },
      configurable: true,
    })
  }

  media.error = null
  media.play = () => { sent.push('play'); port.postMessage({ type: 'call', name: 'play' }); return Promise.resolve() }
  media.pause = () => { sent.push('pause'); port.postMessage({ type: 'call', name: 'pause' }) }
  media.load = () => { sent.push('load') }

  return { media, sent, destroy: () => port.close() }
}

/** mounts the far document and connects a port to it */
export const mountRemoteFrame = async (parent: HTMLElement, src: string) => {
  const iframe = document.createElement('iframe')
  iframe.style.cssText = 'width:100%;height:100%;border:0'
  iframe.srcdoc = REMOTE_FRAME_SOURCE
  parent.append(iframe)
  await new Promise<void>((resolve) => { iframe.onload = () => resolve() })

  const channel = new MessageChannel()
  iframe.contentWindow!.postMessage({ type: 'connect' }, '*', [channel.port2])
  const bridge = createRemoteBridge(channel.port1)
  channel.port1.postMessage({ type: 'load', src })
  return { iframe, ...bridge }
}
