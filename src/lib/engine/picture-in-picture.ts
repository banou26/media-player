/**
 * Picture in picture with the subtitles burned in.
 *
 * The window takes a video element and nothing else, so subtitles painted on a canvas over the video
 * cannot come along. Each frame is composited with the subtitle canvas onto an offscreen canvas, and
 * `captureStream()` backs a hidden mirror element, which is the one that enters the window. The
 * original element keeps playing and stays the only audio source.
 */

const DEFAULT_MAX_WIDTH = 1280
/**
 * Burn-in becomes the picture the viewer actually watches, so it gets a higher ceiling than the
 * thumbnail-sized window does. A 4K source is still halved; see the note on `compositeWidth`.
 */
const BURN_IN_MAX_WIDTH = 1920
/** The frame callback fires only for presented frames, so a paused video needs its own repaint. */
const PAUSED_REPAINT_INTERVAL = 250
/** Long enough for a paused mirror to present one frame of a fresh seek before it stops again. */
const FLUSH_FRAME_MS = 100

/**
 * `window` opens a real picture in picture window. `burn-in` cannot, and instead paints the
 * composite into the player itself so the browser's OWN picture in picture control carries the
 * subtitles with it.
 */
export type PictureInPictureMode = 'window' | 'burn-in'

export type PictureInPictureOptions = {
  video: HTMLVideoElement
  /** The subtitle canvas. jassub sizes it to the video's content rect, so it maps 1:1. */
  canvas: HTMLCanvasElement
  maxWidth?: number
  /** Where the mirror is mounted. It must be in the document. Defaults to the video's parent. */
  container?: HTMLElement
  /** Overrides detection. Passing a mode the browser cannot honour is the caller's problem. */
  mode?: PictureInPictureMode
  /** Burn-in only, so the chrome can light the control up and say what happened. */
  onBurnedInChange?: (burnedIn: boolean) => void
}

export type PictureInPictureController = {
  toggle: () => Promise<void>
  destroy: () => void
  mode: PictureInPictureMode
}

type Session = {
  composite: HTMLCanvasElement
  context: CanvasRenderingContext2D
  stream: MediaStream
  mirror: HTMLVideoElement
}

const canComposite = () =>
  typeof HTMLCanvasElement !== 'undefined' && 'captureStream' in HTMLCanvasElement.prototype

/**
 * `pictureInPictureEnabled` alone is not enough: a permissions policy can withhold it on a browser
 * that implements the API perfectly well, and the prototype method is not suppressible. Requiring
 * both keeps a restricted frame out of `burn-in`, which is for browsers that CANNOT open a window
 * rather than for ones that are merely not allowed to.
 */
const canOpenWindow = () =>
  typeof document !== 'undefined' &&
  typeof HTMLVideoElement !== 'undefined' &&
  typeof HTMLVideoElement.prototype.requestPictureInPicture === 'function' &&
  !!document.pictureInPictureEnabled

/**
 * Gecko, by a capability no other engine has and no policy can take away. A UA string would be
 * wrong twice over: it lies, and this has to stop applying the day Firefox ships the real API.
 */
const isGecko = () =>
  typeof HTMLVideoElement !== 'undefined' && 'mozCaptureStream' in HTMLVideoElement.prototype

/**
 * null means offer no control at all. That covers Safari, whose picture in picture is
 * `webkitSetPresentationMode` and not the W3C API, so neither arm here can drive it. A dead button
 * is worse than no button.
 */
export const pictureInPictureMode = (): PictureInPictureMode | null => {
  if (!canComposite()) return null
  if (canOpenWindow()) return 'window'
  if (isGecko()) return 'burn-in'
  return null
}

/** Takes over the document's Media Session play/pause handlers while a session is open. */
export const createPictureInPicture = (options: PictureInPictureOptions): PictureInPictureController => {
  const { video, canvas } = options
  const mode = options.mode ?? pictureInPictureMode() ?? 'window'
  const maxWidth = options.maxWidth ?? (mode === 'burn-in' ? BURN_IN_MAX_WIDTH : DEFAULT_MAX_WIDTH)

  let session: Session | undefined
  let handle: number | undefined
  let pausedRepaint: ReturnType<typeof setInterval> | undefined
  let syncing = false
  /** Burn-in only: a deliberate play/pause pair to push one frame, which must not reach the video. */
  let flushing = false
  // Nothing can tell a session is being built until `enter` resolves, so without this a second click
  // starts a second pipeline whose timer and mirror are then unreachable. It covers EVERY branch of
  // `toggle`, not only the one that builds a session.
  let busy = false
  let destroyed = false
  let restore: (() => void) | undefined

  // In burn-in there is no window to be in: the session itself IS the mode being on.
  const active = () =>
    mode === 'burn-in'
      ? !!session
      : !!session && document.pictureInPictureElement === session.mirror

  const draw = (composite: HTMLCanvasElement, context: CanvasRenderingContext2D) => {
    context.drawImage(video, 0, 0, composite.width, composite.height)
    // drawImage throws on a zero-sized source, which the canvas is until jassub has painted
    if (canvas.width > 0 && canvas.height > 0) {
      context.drawImage(canvas, 0, 0, composite.width, composite.height)
    }
  }

  const paint = () => {
    if (session) draw(session.composite, session.context)
  }

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

  const publishState = () => {
    if (!('mediaSession' in navigator)) return
    navigator.mediaSession.playbackState = video.paused ? 'paused' : 'playing'
  }

  const onMirrorPlay = () => {
    if (syncing || flushing || !video.paused) return
    void video.play().catch(() => {})
  }

  /**
   * Reached on a browser whose window controls drive the popped out element directly instead of going
   * through the Media Session. Firefox is that browser, and in burn-in its window is driving the
   * element the viewer is watching, so its pause IS the intent and has to stick.
   *
   * Both arms are idempotent by comparing against the video rather than by holding a flag: if the
   * video is already paused this event is the echo of our own `mirror.pause()` and means nothing.
   */
  const onMirrorPause = () => {
    if (syncing || flushing) return
    if (!video.paused) video.pause()
    // In window mode the mirror must never be left paused; see `onVideoPause`.
    if (mode === 'burn-in') return
    syncing = true
    void session?.mirror.play().catch(() => {}).finally(() => { syncing = false })
  }

  const onVideoPlay = () => {
    publishState()
    void session?.mirror.play().catch(() => {})
  }

  /**
   * In WINDOW mode, never pause the mirror. A paused element stops rendering its MediaStream, so the
   * window freezes on its last frame: measured at 0 of 57,600 pixels moving on a seek. Transport
   * state travels through the Media Session instead, which is what the window reads for its button.
   *
   * In BURN-IN the mirror must follow the video exactly, or the browser's own window shows "playing"
   * over a picture that is not moving and its pause button can never resume. A frozen mirror is
   * correct there because the picture is not moving either; `onVideoSeeked` covers the one case where
   * the frame has to change while paused.
   */
  const onVideoPause = () => {
    publishState()
    if (mode === 'burn-in') session?.mirror.pause()
  }

  /** A paused mirror renders nothing, so a scrub would leave the old frame on screen forever. */
  const onVideoSeeked = () => {
    if (mode !== 'burn-in' || !session || !video.paused || flushing) return
    flushing = true
    const { mirror } = session
    paint()
    void mirror.play()
      .then(() => new Promise<void>((resolve) => { setTimeout(resolve, FLUSH_FRAME_MS) }))
      .catch(() => {})
      .finally(() => {
        mirror.pause()
        // the pause event is queued, so the guard has to outlive this tick
        setTimeout(() => { flushing = false }, FLUSH_FRAME_MS)
      })
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
        // an action the browser does not know is not worth surfacing
      }
    }
  }

  const teardown = () => {
    stopLoop()
    bindMediaSession(false)
    video.removeEventListener('play', onVideoPlay)
    video.removeEventListener('pause', onVideoPause)
    video.removeEventListener('seeked', onVideoSeeked)
    if (!session) {
      // a burn-in that never built a session can still have swapped the picture
      restore?.()
      return
    }
    const { stream, mirror } = session
    mirror.removeEventListener('play', onMirrorPlay)
    mirror.removeEventListener('pause', onMirrorPause)
    mirror.removeEventListener('leavepictureinpicture', onLeave)
    for (const track of stream.getTracks()) track.stop()
    mirror.remove()
    session = undefined
    // AFTER the mirror is gone. Restoring first puts the real picture and the overlay back while the
    // composite is still mounted and painting, which is the doubled subtitles this mode exists to avoid.
    restore?.()
  }

  const onLeave = () => teardown()

  /**
   * Swap the composite in as the player's picture.
   *
   * The real element is dimmed, never `display: none`: jassub sizes the subtitle canvas from its
   * `offsetWidth`/`offsetHeight`, and a collapsed box silently yields a composite with no subtitles
   * in it, which is exactly the thing being asked for.
   */
  const present = (mirror: HTMLVideoElement) => {
    const videoOpacity = video.style.opacity
    const canvasDisplay = canvas.style.display
    mirror.style.cssText =
      'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#000;z-index:1'
    video.style.opacity = '0'
    canvas.style.display = 'none'
    restore = () => {
      restore = undefined
      video.style.opacity = videoOpacity
      canvas.style.display = canvasDisplay
    }
  }

  const enter = async () => {
    // Sized off the intrinsic dimensions, never the layout, so a resize cannot resize a canvas that a
    // MediaStream is already capturing.
    const width = Math.min(video.videoWidth || maxWidth, maxWidth)
    const height = Math.round(width * ((video.videoHeight || 9) / (video.videoWidth || 16)))

    const composite = document.createElement('canvas')
    composite.width = width
    composite.height = height
    // The alpha channel is unused but has to stay: with `{ alpha: false }` Chrome's captureStream
    // delivers the first frame and then nothing, with the track still "live" and no error anywhere.
    const context = composite.getContext('2d')
    if (!context) throw new Error('the picture in picture composite has no 2d context')

    const mirror = document.createElement('video')
    mirror.muted = true
    mirror.playsInline = true
    // Burn-in gets its real size from `present`. Firefox will not offer its own control below 140px
    // in either dimension, so the 1px parking spot the window arm uses can never qualify.
    if (mode === 'burn-in') present(mirror)
    else mirror.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;left:-1px;top:-1px'

    // one frame before the capture starts, so the stream has content from its first moment
    draw(composite, context)

    const mine: Session = { composite, context, stream: composite.captureStream(), mirror }
    session = mine
    mirror.srcObject = mine.stream
    ;(options.container ?? video.parentElement ?? document.body).appendChild(mirror)

    schedule()
    pausedRepaint = setInterval(() => { if (video.paused) paint() }, PAUSED_REPAINT_INTERVAL)
    void mirror.play().catch(() => {})

    // requestPictureInPicture rejects while readyState is 0, and the wait is short enough that the
    // click's transient user activation survives it.
    if (mirror.readyState === 0) {
      await new Promise<void>((resolve) => {
        const done = () => { clearTimeout(timer); resolve() }
        const timer = setTimeout(done, 1000)
        mirror.addEventListener('loadedmetadata', done, { once: true })
      })
    }

    // A destroy or a re-entered toggle can land inside that wait. Binding anyway would leave listeners
    // and a Media Session handler pointing at a dead session for the rest of the page's life.
    if (destroyed || session !== mine) {
      mirror.remove()
      return
    }

    mirror.addEventListener('play', onMirrorPlay)
    mirror.addEventListener('pause', onMirrorPause)
    mirror.addEventListener('leavepictureinpicture', onLeave)
    video.addEventListener('play', onVideoPlay)
    video.addEventListener('pause', onVideoPause)
    video.addEventListener('seeked', onVideoSeeked)
    bindMediaSession(true)
    publishState()

    if (mode === 'burn-in') {
      // No window to open: the browser's own control does that, on the element now on screen.
      if (video.paused) mirror.pause()
      options.onBurnedInChange?.(true)
      return
    }

    await mirror.requestPictureInPicture()
  }

  const toggle = async () => {
    if (destroyed || busy) return
    busy = true
    try {
      if (active()) {
        if (mode === 'burn-in') {
          teardown()
          options.onBurnedInChange?.(false)
          return
        }
        await document.exitPictureInPicture().catch(() => {})
        return
      }
      // another element, including our own last mirror, may still hold the single slot
      if (mode !== 'burn-in' && document.pictureInPictureElement) {
        await document.exitPictureInPicture().catch(() => {})
      }

      try {
        await enter()
      } catch (error) {
        // There is nowhere left to fall back TO. The old fallback called the React layer's own
        // toggle, which is this function, so an unsupported browser recursed until the stack blew.
        console.warn('subtitle compositing for picture in picture failed', error)
        teardown()
        if (mode === 'burn-in') options.onBurnedInChange?.(false)
      }
    } finally {
      busy = false
    }
  }

  return {
    toggle,
    mode,
    destroy: () => {
      destroyed = true
      if (mode !== 'burn-in' && active()) void document.exitPictureInPicture().catch(() => {})
      teardown()
      if (mode === 'burn-in') options.onBurnedInChange?.(false)
    },
  }
}
