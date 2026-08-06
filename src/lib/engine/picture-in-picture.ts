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
  onChange?: (active: boolean) => void
}

export type PictureInPictureController = {
  toggle: () => Promise<void>
  isActive: () => boolean
  destroy: () => void
}

const supportsCompositing = () =>
  typeof HTMLCanvasElement !== 'undefined' &&
  'captureStream' in HTMLCanvasElement.prototype &&
  typeof document !== 'undefined' &&
  document.pictureInPictureEnabled

export const createPictureInPicture = (options: PictureInPictureOptions): PictureInPictureController => {
  const { video, canvas, maxWidth = DEFAULT_MAX_WIDTH } = options

  let composite: HTMLCanvasElement | undefined
  let context: CanvasRenderingContext2D | null = null
  let stream: MediaStream | undefined
  let mirror: HTMLVideoElement | undefined
  let frameHandle: number | undefined
  let rafHandle: number | undefined
  let pausedRepaint: ReturnType<typeof setInterval> | undefined
  // Mirrored play/pause would otherwise bounce between the two elements forever
  let syncing = false
  let destroyed = false

  const active = () => !!mirror && document.pictureInPictureElement === mirror

  const paint = () => {
    if (!composite || !context) return
    context.drawImage(video, 0, 0, composite.width, composite.height)
    // Before jassub has booted, or with subtitles off, the canvas can still be 0x0, and drawImage
    // throws on a zero-sized source rather than treating it as a no-op.
    if (canvas.width > 0 && canvas.height > 0) {
      context.drawImage(canvas, 0, 0, composite.width, composite.height)
    }
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
    if (destroyed || !composite) return
    if (useFrameCallback) frameHandle = video.requestVideoFrameCallback(loop)
    else rafHandle = requestAnimationFrame(loop)
  }

  const stopLoop = () => {
    if (frameHandle !== undefined && 'cancelVideoFrameCallback' in video) {
      video.cancelVideoFrameCallback(frameHandle)
    }
    if (rafHandle !== undefined) cancelAnimationFrame(rafHandle)
    if (pausedRepaint !== undefined) clearInterval(pausedRepaint)
    frameHandle = undefined
    rafHandle = undefined
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
    void mirror?.play().catch(() => {}).finally(() => { syncing = false })
  }

  const onVideoPlay = () => {
    publishState()
    void mirror?.play().catch(() => {})
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
    mirror?.removeEventListener('play', onMirrorPlay)
    mirror?.removeEventListener('pause', onMirrorPause)
    mirror?.removeEventListener('leavepictureinpicture', onLeave)
    for (const track of stream?.getTracks() ?? []) track.stop()
    mirror?.remove()
    mirror = undefined
    stream = undefined
    composite = undefined
    context = null
  }

  const onLeave = () => {
    teardown()
    options.onChange?.(false)
  }

  const enter = async () => {
    // The composite is sized off the video's intrinsic dimensions, never off the layout, so resizing
    // the page or going fullscreen cannot resize a canvas that a MediaStream is already capturing.
    const width = Math.min(video.videoWidth || maxWidth, maxWidth)
    const height = Math.round(width * ((video.videoHeight || 9) / (video.videoWidth || 16)))

    composite = document.createElement('canvas')
    composite.width = width
    composite.height = height
    context = composite.getContext('2d')
    if (!context) throw new Error('the picture in picture composite has no 2d context')

    // One frame before the capture starts, so the stream has content from its first moment
    paint()

    stream = composite.captureStream()
    mirror = document.createElement('video')
    mirror.muted = true
    mirror.playsInline = true
    mirror.srcObject = stream
    // Kept in the document because a detached element cannot enter picture in picture, and kept out
    // of view because it is never meant to be seen on the page.
    mirror.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;left:-1px;top:-1px'
    document.body.appendChild(mirror)

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
        mirror?.addEventListener('loadedmetadata', done, { once: true })
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
    options.onChange?.(true)
  }

  const toggle = async () => {
    if (destroyed) return
    if (active()) {
      await document.exitPictureInPicture().catch(() => {})
      return
    }
    // Another element (including our own last mirror) may still hold the single picture in picture slot
    if (document.pictureInPictureElement) await document.exitPictureInPicture().catch(() => {})

    if (!supportsCompositing()) {
      await video.requestPictureInPicture()
      return
    }
    try {
      await enter()
    } catch (error) {
      // Compositing is the enhancement, not the feature. Anything unexpected falls back to handing
      // the browser the bare video, which plays without subtitles rather than not at all.
      console.warn('subtitle compositing for picture in picture failed, falling back', error)
      teardown()
      await video.requestPictureInPicture().catch(() => {})
    }
  }

  return {
    toggle,
    isActive: active,
    destroy: () => {
      destroyed = true
      if (active()) void document.exitPictureInPicture().catch(() => {})
      teardown()
    },
  }
}
