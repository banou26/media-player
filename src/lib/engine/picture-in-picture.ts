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
/**
 * Frame callbacks follow the BROWSER window's rendering, not the picture in picture window's: none with that window
 * minimized or off screen (one a second on niri), while the picture in picture window is still shown. A timer paints
 * once they have been silent this long. A paused video presents no frames either, and is repainted only every
 * `PAUSED_REPAINT_MS`, for a seek or a subtitle change. `scripts/measure-picture-in-picture.mjs`, 2026-11-09, Chrome 156
 * on weston, a 24 fps video, minimized or off screen: 0 different frames a second in the window before, 24 with this
 * and `hidePicture`.
 */
const STALLED_MS = 100
const REPAINT_TICK_MS = 1000 / 60
const PAUSED_REPAINT_MS = 250
/**
 * The subtitle surface is rendered on the same frame callbacks, from a worker whose frames reach the page only while
 * the page renders, so with the browser window off screen it keeps its last line. Drawn only while it is at most this
 * far behind the video's time, which a page rendering once a second still is.
 */
const STALE_SUBTITLES_S = 2
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
  /**
   * The subtitle LAYER, not the canvas inside it.
   *
   * From jassub 2 the canvas is created and removed by the subtitle renderer, one per pipeline
   * build, so an element captured here would stop being the one being painted the moment the audio
   * track changed. The layer is what React owns for the life of the player, so hiding and restoring
   * it stays correct across a rebuild, and the canvas is looked up per frame.
   */
  subtitles: HTMLElement
  maxWidth?: number
  /**
   * Where the mirror is mounted. It must be in the document. Defaults to the video's parent in burn-in, where the
   * mirror is the picture, and to the body in a window, so the window can outlive the player (see `destroy`).
   */
  container?: HTMLElement
  /** Overrides detection. Passing a mode the browser cannot honour is the caller's problem. */
  mode?: PictureInPictureMode
  /** Burn-in only, so the chrome can light the control up and say what happened. */
  onBurnedInChange?: (burnedIn: boolean) => void
}

export type PictureInPictureController = {
  toggle: () => Promise<void>
  /**
   * Burn-in, or a window that is not open, ends here. An open window stays open for a second, and the
   * next controller created in the document in that time draws its own video into it, at that video's
   * shape: an app that replaces the player for the next episode keeps the window with no click, which
   * a new window would need. If no controller takes it in that second, it closes.
   */
  destroy: () => void
  mode: PictureInPictureMode
}

type Session = {
  composite: HTMLCanvasElement
  context: CanvasRenderingContext2D
  stream: MediaStream
  mirror: HTMLVideoElement
}

/** How long a destroyed controller's window waits for the next one; a remounted player asks within a few frames. */
export const HAND_OVER_MS = 1000

let handedOver: { session: Session, close: () => void, cancel: () => void } | undefined

const handOver = (session: Session) => {
  handedOver?.close()
  const cancel = () => {
    clearTimeout(timer)
    session.mirror.removeEventListener('leavepictureinpicture', close)
    handedOver = undefined
  }
  const close = () => {
    cancel()
    if (document.pictureInPictureElement === session.mirror) void document.exitPictureInPicture().catch(() => {})
    for (const track of session.stream.getTracks()) track.stop()
    session.mirror.remove()
  }
  const timer = setTimeout(close, HAND_OVER_MS)
  session.mirror.addEventListener('leavepictureinpicture', close)
  handedOver = { session, close, cancel }
}

/** The window a destroyed controller left, until it closes. */
const takeOver = () => {
  const held = handedOver
  held?.cancel()
  return held?.session
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
  const { video, subtitles } = options
  const mode = options.mode ?? pictureInPictureMode() ?? 'window'
  const maxWidth = options.maxWidth ?? (mode === 'burn-in' ? BURN_IN_MAX_WIDTH : DEFAULT_MAX_WIDTH)

  let session: Session | undefined
  let handle: number | undefined
  let repaint: ReturnType<typeof setInterval> | undefined
  let lastFrame = 0
  let lastPaint = 0
  /** The video's time at the last frame callback, which the subtitle surface was rendered for. */
  let frameTime = 0
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
    // Resolved per frame: the renderer replaces this element on every pipeline rebuild. A canvas
    // jassub has transferred reports the size of the last frame its worker committed, so the zero
    // check still keeps drawImage off a source with no dimensions to read.
    const surface = subtitles.querySelector('canvas')
    if (surface && surface.width > 0 && surface.height > 0 && Math.abs(video.currentTime - frameTime) <= STALE_SUBTITLES_S) {
      context.drawImage(surface, 0, 0, composite.width, composite.height)
    }
  }

  // Sized off the intrinsic dimensions, never the layout, so only a video of another size resizes a
  // canvas that a MediaStream is capturing. A window taken over starts at the size of the video before.
  const compositeSize = () => {
    const width = Math.min(video.videoWidth || maxWidth, maxWidth)
    return { width, height: Math.round(width * ((video.videoHeight || 9) / (video.videoWidth || 16))) }
  }

  const paint = () => {
    if (!session) return
    const { composite, context } = session
    const { width, height } = compositeSize()
    if (video.videoWidth && (composite.width !== width || composite.height !== height)) {
      Object.assign(composite, { width, height })
    }
    lastPaint = performance.now()
    draw(composite, context)
  }

  const useFrameCallback = 'requestVideoFrameCallback' in video

  const loop = () => {
    lastFrame = performance.now()
    frameTime = video.currentTime
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
    if (repaint !== undefined) clearInterval(repaint)
    handle = undefined
    repaint = undefined
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

  const start = () => {
    frameTime = video.currentTime
    schedule()
    repaint = setInterval(() => {
      const now = performance.now()
      if (now - lastFrame < STALLED_MS || (video.paused && now - lastPaint < PAUSED_REPAINT_MS)) return
      paint()
    }, REPAINT_TICK_MS)
  }

  const listen = (mirror: HTMLVideoElement) => {
    mirror.addEventListener('play', onMirrorPlay)
    mirror.addEventListener('pause', onMirrorPause)
    mirror.addEventListener('leavepictureinpicture', onLeave)
    video.addEventListener('play', onVideoPlay)
    video.addEventListener('pause', onVideoPause)
    video.addEventListener('seeked', onVideoSeeked)
    bindMediaSession(true)
    publishState()
  }

  /** Lets go of the session, mirror and window left as they are. */
  const detach = () => {
    stopLoop()
    bindMediaSession(false)
    video.removeEventListener('play', onVideoPlay)
    video.removeEventListener('pause', onVideoPause)
    video.removeEventListener('seeked', onVideoSeeked)
    const held = session
    session = undefined
    held?.mirror.removeEventListener('play', onMirrorPlay)
    held?.mirror.removeEventListener('pause', onMirrorPause)
    held?.mirror.removeEventListener('leavepictureinpicture', onLeave)
    return held
  }

  const teardown = () => {
    const held = detach()
    if (held) {
      for (const track of held.stream.getTracks()) track.stop()
      held.mirror.remove()
    }
    // AFTER the mirror is gone. Restoring first puts the real picture and the overlay back while the
    // composite is still mounted and painting, which is the doubled subtitles this mode exists to avoid.
    // A burn-in that never built a session can still have swapped the picture.
    restore?.()
  }

  const onLeave = () => teardown()

  /**
   * Window only, while it is open. A video shown in the page moves its picture on the page's rendering only, so with the
   * browser window minimized or off screen every read got the same frame for 250 ms: 4 different frames a second
   * however fast the timer painted. A hidden one gives a fresh frame on each read. Chrome's own picture in picture
   * leaves only a placeholder in the page too.
   */
  const hidePicture = () => {
    const visibility = video.style.visibility
    video.style.visibility = 'hidden'
    restore = () => {
      restore = undefined
      video.style.visibility = visibility
    }
  }

  /**
   * Swap the composite in as the player's picture.
   *
   * The real element is dimmed, never `display: none`: jassub sizes the subtitle canvas from its
   * `offsetWidth`/`offsetHeight`, and a collapsed box silently yields a composite with no subtitles
   * in it, which is exactly the thing being asked for.
   *
   * The LAYER is what gets hidden, rather than the canvas inside it. The canvas is replaced whenever
   * the pipeline is rebuilt, so hiding that would leave the replacement visible over the composite
   * (doubled subtitles) and would restore `display` onto an element that is no longer in the tree
   * (subtitles gone for the rest of the session). The layer outlives both.
   */
  const present = (mirror: HTMLVideoElement) => {
    const videoOpacity = video.style.opacity
    const subtitlesDisplay = subtitles.style.display
    mirror.style.cssText =
      'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#000;z-index:1'
    video.style.opacity = '0'
    subtitles.style.display = 'none'
    restore = () => {
      restore = undefined
      video.style.opacity = videoOpacity
      subtitles.style.display = subtitlesDisplay
    }
  }

  const enter = async () => {
    const composite = Object.assign(document.createElement('canvas'), compositeSize())
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
    ;(options.container ?? (mode === 'burn-in' ? video.parentElement : null) ?? document.body).appendChild(mirror)

    start()
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

    listen(mirror)

    if (mode === 'burn-in') {
      // No window to open: the browser's own control does that, on the element now on screen.
      if (video.paused) mirror.pause()
      options.onBurnedInChange?.(true)
      return
    }

    await mirror.requestPictureInPicture()
    if (session === mine) hidePicture()
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

  const taken = mode === 'window' ? takeOver() : undefined
  if (taken) {
    session = taken
    // the last frame of the video before would otherwise stay up until this one has a frame
    taken.context.fillRect(0, 0, taken.composite.width, taken.composite.height)
    start()
    listen(taken.mirror)
    hidePicture()
  }

  return {
    toggle,
    mode,
    destroy: () => {
      destroyed = true
      if (mode === 'window' && active()) {
        const held = detach()!
        restore?.()
        return handOver(held)
      }
      teardown()
      if (mode === 'burn-in') options.onBurnedInChange?.(false)
    },
  }
}
