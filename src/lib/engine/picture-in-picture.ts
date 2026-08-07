/**
 * Picture in picture with the subtitles burned in.
 *
 * Subtitles are painted by jassub onto a canvas that sits *over* the video, so a plain
 * `video.requestPictureInPicture()` hands the browser the bare video and the subtitles stay behind on
 * the page. The browser has no way to composite the two: picture in picture takes a video element and
 * nothing else.
 *
 * So the two layers are composited here. Each presented frame is drawn to an offscreen canvas, the
 * subtitle canvas is drawn on top, and `captureStream()` turns that canvas into a MediaStream backing
 * a second, hidden video element. That element is the one that goes into the picture in picture
 * window, and it carries the subtitles because they are part of its pixels.
 *
 * The original video element keeps playing and stays the only audio source: a canvas stream carries a
 * video track and nothing else, so there is no second audio output and nothing to keep in sync.
 */

/** Composite width ceiling. A picture in picture window is small, and every frame is a full redraw. */
const DEFAULT_MAX_WIDTH = 1280

/**
 * Repaint cadence while paused. The frame callback only fires for *presented* frames, so a paused
 * video produces none and the composite freezes: switching subtitle track or turning subtitles off
 * while paused then never reaches the window. Measured as a real gap, not a hypothetical one, by
 * toggling subtitles off against a frozen picture and diffing the picture in picture output, which
 * came back 0 pixels changed.
 */
const PAUSED_REPAINT_INTERVAL = 250

export type PictureInPictureOptions = {
  video: HTMLVideoElement
  /** The subtitle canvas. jassub sizes this to the video's *content* rect, so it maps 1:1. */
  canvas: HTMLCanvasElement
  maxWidth?: number
  /**
   * Where the hidden mirror element is mounted. It has to be in the document, because a detached
   * element cannot enter picture in picture. Defaults to the video's own parent, so the mirror stays
   * inside whatever container the consumer already owns rather than appearing on `document.body`.
   */
  container?: HTMLElement
  /**
   * Picture in picture without the compositing, for when the composite path is unavailable or fails.
   * It is a toggle: enter if not in the window, exit if already there.
   *
   * The React layer passes the player store's own `togglePictureInPicture`, which handles Safari's
   * `webkitSetPresentationMode` and exits fullscreen before opening the window. The default here does
   * neither, so a caller on Safari should supply one.
   */
  fallback?: () => Promise<void>
}

export type PictureInPictureController = {
  toggle: () => Promise<void>
  destroy: () => void
}

/** The resources of one picture in picture session. All four are created and released together. */
type Session = {
  composite: HTMLCanvasElement
  context: CanvasRenderingContext2D
  stream: MediaStream
  mirror: HTMLVideoElement
}

const supportsCompositing = () =>
  typeof HTMLCanvasElement !== 'undefined' &&
  'captureStream' in HTMLCanvasElement.prototype &&
  typeof document !== 'undefined' &&
  document.pictureInPictureEnabled

/**
 * Note on ownership: while a session is open this claims the document's Media Session `play` and
 * `pause` action handlers, and releases them to `null` rather than to whatever was there before,
 * because the Media Session API offers no way to read a handler back. An app that drives its own
 * Media Session should expect those two actions to be taken over for the duration.
 */
export const createPictureInPicture = (options: PictureInPictureOptions): PictureInPictureController => {
  const { video, canvas, maxWidth = DEFAULT_MAX_WIDTH } = options

  let session: Session | undefined
  let handle: number | undefined
  let pausedRepaint: ReturnType<typeof setInterval> | undefined
  // Mirrored play/pause would otherwise bounce between the two elements forever
  let syncing = false
  // `enter` awaits, and until it resolves nothing else can tell a session is being built. Without
  // this a second click starts a whole second pipeline whose timer and mirror are then unreachable.
  let entering = false
  let destroyed = false

  const active = () => !!session && document.pictureInPictureElement === session.mirror

  // Takes its target rather than reading `session`, so `enter` can lay down the first frame before
  // the capture starts, while the session object is still being assembled.
  const draw = (composite: HTMLCanvasElement, context: CanvasRenderingContext2D) => {
    context.drawImage(video, 0, 0, composite.width, composite.height)
    // Before jassub has booted, or with subtitles off, the canvas can still be 0x0, and drawImage
    // throws on a zero-sized source rather than treating it as a no-op.
    if (canvas.width > 0 && canvas.height > 0) {
      context.drawImage(canvas, 0, 0, composite.width, composite.height)
    }
  }

  const paint = () => {
    if (session) draw(session.composite, session.context)
  }

  // requestVideoFrameCallback fires once per *presented* frame, so the composite tracks the video
  // exactly and idles when it does, including while paused after a seek. rAF would redraw at display
  // rate whatever the video is doing, which on a 24fps source is more than double the work.
  const useFrameCallback = 'requestVideoFrameCallback' in video

  const loop = () => {
    paint()
    schedule()
  }

  const schedule = () => {
    if (destroyed || !session) return
    handle = useFrameCallback ? video.requestVideoFrameCallback(loop) : requestAnimationFrame(loop)
  }

  const stopLoop = () => {
    if (handle !== undefined) {
      if (useFrameCallback) video.cancelVideoFrameCallback(handle)
      else cancelAnimationFrame(handle)
    }
    if (pausedRepaint !== undefined) clearInterval(pausedRepaint)
    handle = undefined
    pausedRepaint = undefined
  }

  /**
   * The mirror is NEVER paused, and that is the whole trick.
   *
   * A paused video element stops rendering its MediaStream, so pausing the mirror to reflect the real
   * element's state froze the picture in picture window on whatever frame it last drew. Measured:
   * seeking to a different scene while paused moved 54,371 of 57,600 sampled pixels in the video and
   * 0 in the window. The window kept showing the old scene until playback resumed.
   *
   * So the mirror runs continuously and the transport state is carried by the Media Session instead,
   * which is what the picture in picture window reads for its play/pause button.
   */
  const publishState = () => {
    if (!('mediaSession' in navigator)) return
    navigator.mediaSession.playbackState = video.paused ? 'paused' : 'playing'
  }

  const onMirrorPlay = () => {
    if (syncing || !video.paused) return
    void video.play().catch(() => {})
  }

  // Reached only when the window's button pauses the mirror directly, on a browser whose picture in
  // picture controls bypass the Media Session. Forward the intent, then put the mirror back to work.
  const onMirrorPause = () => {
    if (syncing) return
    if (!video.paused) video.pause()
    syncing = true
    void session?.mirror.play().catch(() => {}).finally(() => { syncing = false })
  }

  const onVideoPlay = () => {
    publishState()
    void session?.mirror.play().catch(() => {})
  }

  const onVideoPause = () => {
    publishState()
    // deliberately does not pause the mirror
  }

  const mediaSessionActions: [MediaSessionAction, MediaSessionActionHandler][] = [
    ['play', () => { void video.play().catch(() => {}) }],
    ['pause', () => video.pause()],
  ]

  const bindMediaSession = (bind: boolean) => {
    if (!('mediaSession' in navigator)) return
    for (const [action, handler] of mediaSessionActions) {
      try {
        navigator.mediaSession.setActionHandler(action, bind ? handler : null)
      } catch {
        // an action the browser does not know is not a failure worth surfacing
      }
    }
  }

  const teardown = () => {
    stopLoop()
    bindMediaSession(false)
    video.removeEventListener('play', onVideoPlay)
    video.removeEventListener('pause', onVideoPause)
    if (!session) return
    const { stream, mirror } = session
    mirror.removeEventListener('play', onMirrorPlay)
    mirror.removeEventListener('pause', onMirrorPause)
    mirror.removeEventListener('leavepictureinpicture', onLeave)
    for (const track of stream.getTracks()) track.stop()
    mirror.remove()
    session = undefined
  }

  const onLeave = () => teardown()

  const fallback = options.fallback ?? (async () => {
    if (document.pictureInPictureElement === video) await document.exitPictureInPicture()
    else await video.requestPictureInPicture()
  })

  const enter = async () => {
    // The composite is sized off the video's intrinsic dimensions, never off the layout, so resizing
    // the page or going fullscreen cannot resize a canvas that a MediaStream is already capturing.
    const width = Math.min(video.videoWidth || maxWidth, maxWidth)
    const height = Math.round(width * ((video.videoHeight || 9) / (video.videoWidth || 16)))

    const composite = document.createElement('canvas')
    composite.width = width
    composite.height = height
    // The alpha channel is unused (every paint covers the whole canvas with the video first) but it
    // has to stay. With `{ alpha: false }` Chrome's captureStream delivers the first frame and then
    // nothing: the track stays "live", the canvas keeps repainting, and the mirror sits frozen.
    // Measured at 36 paints and 1099 changed canvas pixels against 0 changed pixels in the window.
    const context = composite.getContext('2d')
    if (!context) throw new Error('the picture in picture composite has no 2d context')

    const mirror = document.createElement('video')
    mirror.muted = true
    mirror.playsInline = true
    // Kept out of view because it is never meant to be seen on the page.
    mirror.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;left:-1px;top:-1px'

    // One frame before the capture starts, so the stream has content from its first moment
    draw(composite, context)

    session = { composite, context, stream: composite.captureStream(), mirror }
    mirror.srcObject = session.stream
    ;(options.container ?? video.parentElement ?? document.body).appendChild(mirror)

    schedule()
    // Only paints while paused, so during playback the frame callback stays the single writer and
    // this costs one comparison every quarter second.
    pausedRepaint = setInterval(() => { if (video.paused) paint() }, PAUSED_REPAINT_INTERVAL)
    void mirror.play().catch(() => {})

    // requestPictureInPicture rejects while readyState is 0. The wait is a few milliseconds against a
    // transient user activation that lasts seconds, so the gesture from the click survives it.
    if (mirror.readyState === 0) {
      await new Promise<void>((resolve) => {
        const done = () => { clearTimeout(timer); resolve() }
        const timer = setTimeout(done, 1000)
        mirror.addEventListener('loadedmetadata', done, { once: true })
      })
    }

    mirror.addEventListener('play', onMirrorPlay)
    mirror.addEventListener('pause', onMirrorPause)
    mirror.addEventListener('leavepictureinpicture', onLeave)
    video.addEventListener('play', onVideoPlay)
    video.addEventListener('pause', onVideoPause)
    bindMediaSession(true)
    publishState()

    await mirror.requestPictureInPicture()
  }

  const toggle = async () => {
    if (destroyed || entering) return
    if (active()) {
      await document.exitPictureInPicture().catch(() => {})
      return
    }
    if (!supportsCompositing()) {
      await fallback()
      return
    }
    // Another element (including our own last mirror) may still hold the single picture in picture slot
    if (document.pictureInPictureElement) await document.exitPictureInPicture().catch(() => {})

    entering = true
    try {
      await enter()
    } catch (error) {
      // Compositing is the enhancement, not the feature. Anything unexpected falls back to handing
      // the browser the bare video, which plays without subtitles rather than not at all.
      console.warn('subtitle compositing for picture in picture failed, falling back', error)
      teardown()
      await fallback().catch(() => {})
    } finally {
      entering = false
    }
  }

  return {
    toggle,
    destroy: () => {
      destroyed = true
      if (active()) void document.exitPictureInPicture().catch(() => {})
      teardown()
    },
  }
}
