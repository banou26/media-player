import type { ASSEvent } from 'jassub/dist/worker/util'
import type { Attachment, SubtitleFragment } from 'libav-wasm/build/worker'

import JASSUB from 'jassub'
import { parse } from 'ass-compiler'

export type SubtitleStream = { streamIndex: number, title: string, language: string }

/** -1 turns subtitles off. It frees the track and matches no header, so nothing is set. */
export const SUBTITLES_OFF = -1

type SubtitleHeaderPart = { type: 'header', streamIndex: number, content: string, eventsContent: string, styles: Map<string, number> }
type SubtitleDialoguePart = { type: 'dialogue', streamIndex: number, index: number, assEvent: ASSEvent }

export type SubtitleRendererOptions = {
  video: HTMLVideoElement
  /**
   * Where the subtitle surface is mounted.
   *
   * A container, not the canvas itself. From jassub 2 the canvas belongs to the renderer: the
   * constructor transfers it to a worker, which an element accepts exactly once for its whole life,
   * and `destroy()` removes it from the document. Neither is survivable for an element someone else
   * owns, and this pipeline is rebuilt in place on an audio track change and on an element recovery.
   * So one canvas is created here per jassub instance, inside this container.
   *
   * The live canvas is `container.querySelector('canvas')`, and it is replaced on every rebuild.
   */
  container: HTMLElement
  workerUrl: string
  /** The SIMD build, `jassub-worker-modern.wasm`. Used wherever WebAssembly SIMD is available. */
  wasmUrl: string
  /**
   * The non-SIMD build, `jassub-worker.wasm`, for anything without WebAssembly SIMD.
   *
   * Optional in practice as well as in the type, unlike under jassub 1: v2 defaults both wasm urls to
   * its own files resolved against `import.meta.url`, so leaving this unset degrades to whatever the
   * bundler emitted rather than failing outright.
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
 * A relative url handed to the worker resolves against the worker's own url inside it, which is not
 * the document's. For the wasm that fails loudly. For the fallback font it fails in SILENCE: libass
 * is left with no face to draw with, so the track renders nothing at all and the picture simply has
 * no subtitles on it, with no error anywhere to say why.
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
 * `ASSEvent.Style` is written straight through to an `int`, so handing it a style NAME stores 0,
 * which is libass's own default: Arial at size 18, with margins and a drop shadow of its own.
 * Subtitles still appear, in a face and a size the file never asked for. jassub 1 typed the field as
 * a string, which is what made that easy to do; jassub 2 types it `number` and agrees with libass,
 * but the resolution still has to happen somewhere and this is it.
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
      Name: event.Name ?? '',
      // libass wants the raw effect field and ass-compiler has already destructured it into an
      // object, so only the name survives the round trip. That is parity rather than a regression:
      // jassub 1 was handed the object itself, which reached libass's `char*` as "[object Object]",
      // and libass matches an effect by a "Banner;" or "Scroll up;" prefix, so neither form has ever
      // selected one.
      Effect: event.Effect?.name ?? '',
      Layer: event.Layer,
      MarginL: event.MarginL,
      MarginR: event.MarginR,
      MarginV: event.MarginV,
      Style: styleIndex(header, event.Style),
      Text: event.Text.raw,
      Start: event.Start * 1000,
      Duration: (event.End - event.Start) * 1000,
      ReadOrder: dialogueIndex,
    },
  }
}

export type SubtitleRenderer = ReturnType<typeof createSubtitleRenderer>

export const createSubtitleRenderer = (options: SubtitleRendererOptions) => {
  const { video, container, workerUrl } = options
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
  /**
   * Terminal, unlike a null `jassub`.
   *
   * `pushFragments` boots on the first header it sees and tests `!jassub` to decide, so a fragment
   * that lands after teardown (a demuxer read resolving into a torn-down pipeline, which is ordinary
   * on the `./engine` surface) would start a SECOND worker with a second canvas inside a container
   * nobody is watching any more. The live canvas is found with `querySelector`, so the stale one
   * would win and picture in picture would composite a surface that is never painted again.
   */
  let destroyed = false

  const rendererFailed = (error: unknown) => {
    console.warn('the subtitle renderer failed; the file plays without subtitles', error)
  }

  /**
   * Run something against the worker, once there is a worker to run it against.
   *
   * `instance.renderer` is assigned by the promise `ready` resolves, so nothing can be called before
   * then and a call made too early throws on `undefined`. Ordering after that is free rather than
   * something this has to arrange: abslink posts each call synchronously from its proxy's `apply`
   * trap, and the worker runs the method synchronously in its own message handler, so calls land in
   * the order they were made whether or not each one is awaited. Reactions registered on one
   * already-settled promise also run in registration order, so this preserves it too.
   *
   * The identity check is what stops a teardown that happened during the boot from talking to a
   * worker that is on its way out.
   *
   * `run` RETURNS its calls rather than dropping them. Every proxied call is a promise that rejects
   * when the worker throws, which libass does on a header it will not take and once it is over its
   * glyph or memory limit, and a dropped one surfaces as a bare `unhandledrejection` in the host app
   * with nothing naming subtitles in it.
   */
  const onRenderer = (run: (renderer: JASSUB['renderer']) => unknown) => {
    const instance = jassub
    if (!instance) return
    void instance.ready
      .then(() => (jassub === instance ? run(instance.renderer) : undefined))
      .catch(rendererFailed)
  }

  let repaintQueued = false
  /**
   * Ask for one frame.
   *
   * jassub 2 draws only from `requestVideoFrameCallback`, so a PAUSED video presents no frames and
   * nothing repaints. Anything that changes what libass would draw has to ask for a frame itself, or
   * a track switch and a seek while paused both leave the previous line on screen until playback
   * resumes. jassub 1 needed none of this because the 100ms `setCurrentTime` tick this replaces
   * redrew unconditionally.
   *
   * Coalesced through a microtask because events arrive in bursts of hundreds and one frame covers
   * the whole burst. The burst is synchronous, so the microtask always runs after all of it, and a
   * playing video therefore costs at most one extra draw per burst.
   */
  const repaint = () => {
    if (repaintQueued) return
    repaintQueued = true
    queueMicrotask(() => {
      repaintQueued = false
      const instance = jassub
      // `videoWidth` is 0 until metadata arrives, and asking jassub to draw then sizes its surface to
      // nothing. Nothing else is required: this deliberately does NOT skip the draw when the element
      // is playing. "Playing" is not "presenting frames", and the gap between them is exactly where
      // subtitles get stuck. A torrent-backed source whose SourceBuffer runs dry keeps `paused` false
      // while presenting nothing, so a viewer who turns subtitles off mid-stall would watch the line
      // stay on screen until the buffer refilled. One forced draw per change is far cheaper than
      // reasoning about which stalls count.
      if (!instance || !video.videoWidth) return
      void instance.ready
        .then(() => {
          if (jassub !== instance) return undefined
          return instance.manualRender({
            expectedDisplayTime: performance.now(),
            width: video.videoWidth,
            height: video.videoHeight,
            mediaTime: video.currentTime,
          }, true)
        })
        .catch(rendererFailed)
    })
  }

  /**
   * The element events that change what should be on screen without presenting a frame.
   *
   * `loadedmetadata` is the one that is easy to miss and fatal to leave out: the first subtitle
   * fragments arrive BEFORE the element has parsed metadata, so the repaint they ask for is skipped
   * for having no `videoWidth` to size a surface from, and if nothing asks again a paused player
   * shows no subtitles at all. `seeked` covers scrubbing while paused, and `pause` covers landing on
   * a frame whose line arrived after it was presented.
   *
   * Trimming this list was tried and reverted. `['loadedmetadata']` alone fails
   * `subtitle-paused-repaint.browser.test.tsx`'s turn-off case four runs out of four, while adding
   * back EITHER of the other two passes. Neither of those events fires in that test, so what the
   * extra listener buys is timing rather than a trigger, and the honest conclusion is that the clear
   * after a `freeTrack` is more delicate than it looks. Do not shorten this list without running that
   * case several times.
   */
  const REPAINT_ON = ['loadedmetadata', 'seeked', 'pause'] as const
  const onRepaintEvent = () => repaint()

  const bootJassub = (header: SubtitleHeaderPart) => {
    const canvas = document.createElement('canvas')
    container.append(canvas)
    try {
      jassub = new JASSUB({
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
        // jassub 2 defaults this to 'local', which asks the browser for the local-fonts permission
        // the first time libass reports a face it does not have. The container ships its own fonts
        // and a player has no business raising that prompt.
        queryFonts: false,
      })
    } catch (error) {
      canvas.remove()
      rendererFailed(error)
      return
    }
    // A boot that fails worker-side rejects `ready`, and jassub's own ResizeObserver awaits `ready`
    // on every layout change, so an instance left in that state throws a fresh unhandled rejection
    // for the rest of the session.
    void jassub.ready.catch(rendererFailed)
    for (const type of REPAINT_ON) video.addEventListener(type, onRepaintEvent)
    /*
     * The default face is the one font jassub loads LAZILY. Attachments are handed to the constructor
     * and `ready` waits for them, but `availableFonts` is consulted only when libass reports a
     * missing face part way through a draw, and the fetch that follows lands after the frame that
     * needed it. Driven by rVFC the next frame picks it up and the cost is one frame of unstyled
     * text; PAUSED there is no next frame, so the first line stays unpainted until the viewer presses
     * play. Measured as a RACE rather than a certainty: three runs of subtitle-header.browser.test.tsx
     * against one repaint scored two blank and one painted.
     *
     * `addFonts` is the fix because it is a signal rather than a delay: it resolves when the face is
     * in libass, which is the moment a repaint is worth asking for.
     */
    if (defaultFontUrl) {
      onRenderer((renderer) => {
        void Promise.resolve(renderer.addFonts([defaultFontUrl])).then(repaint, rendererFailed)
      })
    }
    repaint()
  }

  const pushAttachments = (incoming: Attachment[]) => {
    attachments = [...attachments, ...incoming.map((a) => [a.filename, new Uint8Array(a.data)] as [string, Uint8Array])]
  }

  const pushFragments = (fragments: SubtitleFragment[]) => {
    const incoming: ASSEvent[] = []
    for (const fragment of fragments) {
      if (fragment.type === 'header') {
        if (headers.has(fragment.streamIndex)) continue
        const header = toHeaderPart(fragment)
        if (!header) continue
        headers.set(fragment.streamIndex, header)
        streams.push({ streamIndex: fragment.streamIndex, title: fragment.title, language: fragment.language })
        onStreams?.([...streams])
        if (selected === undefined) selected = fragment.streamIndex
        if (!jassub && !destroyed) bootJassub(header)
      } else {
        const header = headers.get(fragment.streamIndex)
        if (!header) continue
        let byIndex = dialogues.get(fragment.streamIndex)
        if (!byIndex) { byIndex = new Map(); dialogues.set(fragment.streamIndex, byIndex) }
        const part = toDialoguePart(header, fragment)
        if (byIndex.has(part.index)) continue
        byIndex.set(part.index, part)
        if (selected === fragment.streamIndex) incoming.push(part.assEvent)
      }
    }
    if (!incoming.length) return
    // one hop for the whole burst rather than one per event
    onRenderer((renderer) => Promise.all(incoming.map((event) => renderer.createEvent(event))))
    repaint()
  }

  const selectStream = (streamIndex: number | undefined) => {
    const next = streamIndex ?? SUBTITLES_OFF
    if (next === selected || !jassub) return
    selected = next
    const header = headers.get(next)
    const events = [...dialogues.get(next)?.values() ?? []].map((part) => part.assEvent)
    onRenderer((renderer) => {
      const calls: unknown[] = [renderer.freeTrack()]
      if (header) {
        calls.push(renderer.setTrack(header.content))
        for (const event of events) calls.push(renderer.createEvent(event))
      }
      return Promise.all(calls)
    })
    // outside the callback so that turning subtitles OFF while paused clears the picture too
    repaint()
  }

  return {
    pushAttachments,
    pushFragments,
    selectStream,
    getStreams: () => [...streams],
    getSelectedStream: () => selected,
    setOnStreams: (cb: (streams: SubtitleStream[]) => void) => { onStreams = cb },
    destroy: () => {
      destroyed = true
      const instance = jassub
      jassub = undefined
      for (const type of REPAINT_ON) video.removeEventListener(type, onRepaintEvent)
      // jassub removes its own canvas at the top of destroy(), before it awaits anything, so the
      // element is gone synchronously. The rest is a worker round trip that a dead worker never
      // answers, which is why nothing here waits for it.
      void instance?.destroy().catch(() => {})
    },
  }
}
