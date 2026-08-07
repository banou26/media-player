/**
 * Picture in picture with the subtitles burned in.
 *
 * The window takes a video element and nothing else, so subtitles painted on a canvas over the video
 * cannot come along. Each frame is composited with the subtitle canvas onto an offscreen canvas, and
 * `captureStream()` backs a hidden mirror element, which is the one that enters the window. The
 * original element keeps playing and stays the only audio source.
 */

const DEFAULT_MAX_WIDTH = 1280
/** The frame callback fires only for presented frames, so a paused video needs its own repaint. */
const PAUSED_REPAINT_INTERVAL = 250

export type PictureInPictureOptions = {
  video: HTMLVideoElement
  /** The subtitle canvas. jassub sizes it to the video's content rect, so it maps 1:1. */
  canvas: HTMLCanvasElement
  maxWidth?: number
  /** Where the hidden mirror is mounted. It must be in the document. Defaults to the video's parent. */
  container?: HTMLElement
  /**
   * Toggle used when compositing is unavailable or fails. The React layer passes the player store's
   * own action, which handles Safari and exits fullscreen first; the default here does neither.
   */
  fallback?: () => Promise<void>
}

export type PictureInPictureController = {
  toggle: () => Promise<void>
  destroy: () => void
}

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

/** Takes over the document's Media Session play/pause handlers while a session is open. */
export const createPictureInPicture = (options: PictureInPictureOptions): PictureInPictureController => {
  const { video, canvas, maxWidth = DEFAULT_MAX_WIDTH } = options

  let session: Session | undefined
  let handle: number | undefined
  let pausedRepaint: ReturnType<typeof setInterval> | undefined
  let syncing = false
  // Nothing can tell a session is being built until `enter` resolves, so without this a second click
  // starts a second pipeline whose timer and mirror are then unreachable.
  let entering = false
  let destroyed = false

  const active = () => !!session && document.pictureInPictureElement === session.mirror

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
    if (syncing || !video.paused) return
    void video.play().catch(() => {})
  }

  // Reached on a browser whose window controls pause the mirror directly instead of going through the
  // Media Session. Forward the intent, then put the mirror back to work.
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

  /**
   * NEVER pause the mirror. A paused element stops rendering its MediaStream, so the window freezes on
   * its last frame: measured at 0 of 57,600 pixels moving on a seek. Transport state travels through
   * the Media Session instead, which is what the window reads for its button.
   */
  const onVideoPause = () => {
    publishState()
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
    mirror.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;left:-1px;top:-1px'

    // one frame before the capture starts, so the stream has content from its first moment
    draw(composite, context)

    session = { composite, context, stream: composite.captureStream(), mirror }
    mirror.srcObject = session.stream
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
    // another element, including our own last mirror, may still hold the single slot
    if (document.pictureInPictureElement) await document.exitPictureInPicture().catch(() => {})

    entering = true
    try {
      await enter()
    } catch (error) {
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
