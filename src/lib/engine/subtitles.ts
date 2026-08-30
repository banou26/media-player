import type { ASS_Event } from 'jassub'
import type { Attachment, SubtitleFragment } from 'libav-wasm/build/worker'

import JASSUB from 'jassub'
import { parse } from 'ass-compiler'

export type SubtitleStream = { streamIndex: number, title: string, language: string }

/** -1 turns subtitles off. It frees the track and matches no header, so nothing is set. */
export const SUBTITLES_OFF = -1

/**
 * jassub's `ASS_Event` types `Style` as a string, which the library it wraps does not agree with:
 * the field is written straight through to libass's `int Style`, an index into the track's style
 * list. Corrected once, here, so a name cannot end up in it again.
 */
type StyledEvent = Omit<ASS_Event, 'Style'> & { Style: number }

const createEvent = (jassub: JASSUB, event: StyledEvent) => jassub.createEvent(event as unknown as ASS_Event)

type SubtitleHeaderPart = { type: 'header', streamIndex: number, content: string, eventsContent: string, styles: Map<string, number> }
type SubtitleDialoguePart = { type: 'dialogue', streamIndex: number, index: number, assEvent: StyledEvent }

export type SubtitleRendererOptions = {
  video: HTMLVideoElement
  canvas: HTMLCanvasElement
  workerUrl: string
  /** The SIMD build, `jassub-worker-modern.wasm`. Used wherever WebAssembly SIMD is available. */
  wasmUrl: string
  /**
   * The non-SIMD build, `jassub-worker.wasm`, for Safari before 16.4 and anything else without SIMD.
   *
   * Not optional in practice, only in the type. jassub picks `wasmUrl ?? 'jassub-worker.wasm'` when SIMD
   * is missing, and that bare relative name resolves against the blob: url the worker is built from,
   * which throws. So leaving this unset does not degrade to the slower build, it fails outright.
   */
  legacyWasmUrl?: string
  /**
   * Fallback face for `liberation sans`. Without it jassub falls back to whatever the wasm build embeds.
   *
   * May be relative: it is resolved against the document before the worker sees it, for the reason
   * given on `workerFetched`.
   */
  defaultFontUrl?: string
  onStreams?: (streams: SubtitleStream[]) => void
}

/**
 * A url the WORKER will fetch, resolved against the document first.
 *
 * jassub's worker is built from a `blob:` url, so a relative url handed to it resolves against that
 * blob inside the worker and the fetch never lands. For the wasm that fails loudly. For the fallback
 * font it fails in SILENCE: libass is left with no face to draw with, so the track renders nothing at
 * all and the picture simply has no subtitles on it, with no error anywhere to say why.
 *
 * `workerUrl` is deliberately not passed through here. `new Worker()` is called on the main thread,
 * where a relative url already resolves against the document.
 */
const workerFetched = (url: string | undefined) =>
  url === undefined ? undefined : new URL(url, document.baseURI).toString()

const convertTimestamp = (ms: number) => new Date(ms).toISOString().slice(11, 22)

/**
 * How many styles libass keeps in front of the ones the file declares.
 *
 * `ass_new_track` always allocates its own "Default" at index 0 before parsing a line of the header,
 * so the file's first style lands at 1. That number is what an event's `Style` field holds: libass
 * reads it as an index into the track's style list and nothing else. `subtitle-scale.browser.test.tsx`
 * is what pins this, by measuring the rendered text against what libass itself draws.
 */
const LIBASS_OWN_STYLES = 1

const headerStyles = (content: string) =>
  // a duplicated name resolves to the LAST one, the way libass's own lookup scans the list backwards
  new Map(parse(content).styles.style.map((style, index) => [style.Name, index + LIBASS_OWN_STYLES]))

/**
 * The index libass will resolve this event's style to.
 *
 * jassub types `ASS_Event.Style` as a string and writes it straight through to an `int`, so handing
 * it a style NAME stores 0, which is libass's own default: Arial at size 18, with margins and a drop
 * shadow of its own. Subtitles still appear, in a face and a size the file never asked for.
 *
 * Falling back to the header's own "Default", then to 0, is what libass does for a name it cannot
 * find. The leading-`*` strip and the case fold on "Default" are its normalisation, kept so a
 * `*Default` written by an older tool resolves here too.
 */
const styleIndex = (header: SubtitleHeaderPart, name: string) => {
  const stripped = name.replace(/^\*+/, '')
  const key = stripped.toLowerCase() === 'default' ? 'Default' : stripped
  return header.styles.get(key) ?? header.styles.get('Default') ?? 0
}

/**
 * `\r?\n`, not `\r\n`: an ASS header muxed straight out of a matroska file uses CRLF, but one libav
 * CONVERTED from another format (an srt track, most commonly) is LF only, and requiring CRLF rejected it.
 *
 * Returns null rather than throwing. A header this cannot read is a reason to have no subtitles, and it
 * used to be a reason to have no VIDEO: the throw crossed pushFragments into startPlayback's try, so one
 * unreadable track failed the whole file with "playback failed".
 */
const toHeaderPart = (fragment: SubtitleFragment & { type: 'header' }): SubtitleHeaderPart | null => {
  const eventsContent = fragment.content.match(/\r?\n\[Events\]\r?\nFormat: (.*)/)?.[0]
  if (!eventsContent) {
    console.warn(`subtitle stream ${fragment.streamIndex} has no Events format, ignoring the track`)
    return null
  }
  return { type: 'header', streamIndex: fragment.streamIndex, content: fragment.content, eventsContent, styles: headerStyles(fragment.content) }
}

const toDialoguePart = (header: SubtitleHeaderPart, fragment: SubtitleFragment & { type: 'dialogue' }): SubtitleDialoguePart => {
  const [dialogueIndexString, layer] = fragment.content.split(',')
  const dialogueIndex = Number(dialogueIndexString)
  const start = convertTimestamp(fragment.start)
  const end = convertTimestamp(fragment.end)
  const rest = fragment.content.replace(`${dialogueIndex},${layer},`, '')
  const dialogueContent = `Dialogue: ${layer},${start},${end},${rest}`
  const event = parse(`${header.eventsContent}\r\n${dialogueContent}`).events.dialogue[0]
  if (!event) throw new Error('dialogue event is undefined')
  return {
    type: 'dialogue',
    streamIndex: fragment.streamIndex,
    index: dialogueIndex,
    assEvent: {
      ...event,
      Style: styleIndex(header, event.Style),
      Effect: event.Effect ?? '',
      Text: event.Text.raw,
      Duration: (event.End - event.Start) * 1000,
      Start: event.Start * 1000,
      End: event.End * 1000,
      ReadOrder: dialogueIndex,
      _index: dialogueIndex,
    } as StyledEvent,
  }
}

export type SubtitleRenderer = ReturnType<typeof createSubtitleRenderer>

export const createSubtitleRenderer = (options: SubtitleRendererOptions) => {
  const { video, canvas, workerUrl } = options
  const wasmUrl = workerFetched(options.wasmUrl)!
  const legacyWasmUrl = workerFetched(options.legacyWasmUrl)
  const defaultFontUrl = workerFetched(options.defaultFontUrl)
  let jassub: JASSUB | undefined
  let attachments: [string, Uint8Array][] = []
  const headers = new Map<number, SubtitleHeaderPart>()
  const streams: SubtitleStream[] = []
  const dialogues = new Map<number, Map<number, SubtitleDialoguePart>>()
  let selected: number | undefined
  let onStreams = options.onStreams

  const tick = setInterval(() => {
    jassub?.setCurrentTime(video.paused, video.currentTime, video.playbackRate)
  }, 100)

  const onRateChange = () => jassub?.setRate(video.playbackRate)

  const bootJassub = (header: SubtitleHeaderPart) => {
    jassub = new JASSUB({
      onDemandRender: false,
      video,
      canvas,
      subContent: header.content,
      workerUrl,
      modernWasmUrl: wasmUrl,
      ...legacyWasmUrl ? { wasmUrl: legacyWasmUrl } : {},
      fonts: attachments.map(([, data]) => data),
      availableFonts: {
        ...Object.fromEntries(attachments),
        ...(defaultFontUrl ? { 'liberation sans': defaultFontUrl } : {}),
      },
    })
    // jassub 1.8.x binds setRate as the ratechange listener, so the Event becomes the rate
    video.removeEventListener('ratechange', (jassub as unknown as { _boundSetRate: EventListener })._boundSetRate)
    video.addEventListener('ratechange', onRateChange)
  }

  const pushAttachments = (incoming: Attachment[]) => {
    attachments = [...attachments, ...incoming.map((a) => [a.filename, new Uint8Array(a.data)] as [string, Uint8Array])]
  }

  const pushFragments = (fragments: SubtitleFragment[]) => {
    for (const fragment of fragments) {
      if (fragment.type === 'header') {
        if (headers.has(fragment.streamIndex)) continue
        const header = toHeaderPart(fragment)
        if (!header) continue
        headers.set(fragment.streamIndex, header)
        streams.push({ streamIndex: fragment.streamIndex, title: fragment.title, language: fragment.language })
        onStreams?.([...streams])
        if (selected === undefined) selected = fragment.streamIndex
        if (!jassub) bootJassub(header)
      } else {
        const header = headers.get(fragment.streamIndex)
        if (!header) continue
        let byIndex = dialogues.get(fragment.streamIndex)
        if (!byIndex) { byIndex = new Map(); dialogues.set(fragment.streamIndex, byIndex) }
        const part = toDialoguePart(header, fragment)
        if (byIndex.has(part.index)) continue
        byIndex.set(part.index, part)
        if (selected === fragment.streamIndex && jassub) createEvent(jassub, part.assEvent)
      }
    }
  }

  const selectStream = (streamIndex: number | undefined) => {
    const next = streamIndex ?? SUBTITLES_OFF
    if (next === selected || !jassub) return
    selected = next
    jassub.freeTrack()
    const header = headers.get(next)
    if (!header) return
    jassub.setTrack(header.content)
    for (const part of dialogues.get(next)?.values() ?? []) createEvent(jassub, part.assEvent)
    jassub.setCurrentTime(video.paused, video.currentTime, video.playbackRate)
  }

  return {
    pushAttachments,
    pushFragments,
    selectStream,
    getStreams: () => [...streams],
    getSelectedStream: () => selected,
    setOnStreams: (cb: (streams: SubtitleStream[]) => void) => { onStreams = cb },
    destroy: () => {
      clearInterval(tick)
      video.removeEventListener('ratechange', onRateChange)
      jassub?.destroy()
      jassub = undefined
    },
  }
}
