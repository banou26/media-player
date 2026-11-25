import { definePlayerFeature } from '@videojs/core/dom'
import { exitFullscreen as exitDocumentFullscreen, requestFullscreen as requestElementFullscreen } from '@banou/ponyfill/fullscreen'

type FullscreenAvailability = 'available' | 'unavailable' | 'unsupported'

type WebKitPresentationMode = 'inline' | 'fullscreen' | 'picture-in-picture'

type WebKitDocument = Document & {
  webkitFullscreenEnabled?: boolean
  webkitFullscreenElement?: Element | null
  webkitExitFullscreen?: () => Promise<void> | void
}

type WebKitVideoLike = {
  webkitPresentationMode?: WebKitPresentationMode
  webkitSupportsPresentationMode?: (mode: WebKitPresentationMode) => boolean
  webkitSetPresentationMode?: (mode: WebKitPresentationMode) => void
  webkitDisplayingFullscreen?: boolean
  webkitEnterFullscreen?: () => void
  webkitEnterFullScreen?: () => void
  webkitExitFullscreen?: () => void
  webkitExitFullScreen?: () => void
  requestFullscreen?: () => Promise<unknown>
  exitFullscreen?: () => Promise<unknown>
  isFullscreen?: boolean
  webkitRequestFullscreen?: () => Promise<void> | void
  isPictureInPicture?: boolean
  exitPictureInPicture?: () => Promise<unknown>
}

const isVideoFullscreenCapable = (video: WebKitVideoLike | null) =>
  !!video && (
    typeof video.webkitSetPresentationMode === 'function'
    || typeof video.webkitEnterFullscreen === 'function'
    || typeof video.webkitEnterFullScreen === 'function'
    || typeof video.requestFullscreen === 'function'
    || typeof video.webkitRequestFullscreen === 'function'
  )

const isFullscreenEnabled = (media: EventTarget | null) => {
  const doc = document as WebKitDocument
  if (doc.fullscreenEnabled || doc.webkitFullscreenEnabled) return true
  if (media && isVideoFullscreenCapable(media as WebKitVideoLike)) return true
  return isVideoFullscreenCapable(document.createElement('video') as unknown as WebKitVideoLike)
}

const getFullscreenElement = (doc: WebKitDocument) =>
  doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null

const matchesFullscreen = (element: EventTarget | null) => {
  if (!(element instanceof Element)) return false
  for (const selector of [':fullscreen', ':-webkit-full-screen']) {
    try {
      if (element.matches(selector)) return true
    } catch {}
  }
  return false
}

const isFullscreen = (container: HTMLElement | null, media: EventTarget | null) => {
  if (!media) return false
  const video = media as WebKitVideoLike
  if (video.webkitPresentationMode === 'fullscreen' || video.webkitDisplayingFullscreen === true) return true

  const doc = (container?.ownerDocument ?? (media instanceof Node ? media.ownerDocument : null) ?? document) as WebKitDocument
  const fullscreenElement = getFullscreenElement(doc)
  if (fullscreenElement && (fullscreenElement === container || fullscreenElement === media)) return true
  if (matchesFullscreen(container) || matchesFullscreen(media)) return true

  return video.isFullscreen ?? false
}

const isPictureInPicture = (media: EventTarget | null) => {
  if (!media) return false
  const video = media as WebKitVideoLike
  if (video.webkitPresentationMode === 'picture-in-picture') return true
  if (typeof document !== 'undefined' && document.pictureInPictureElement === media) return true
  return video.isPictureInPicture ?? false
}

const exitPictureInPicture = (media: EventTarget | null): Promise<void> => {
  if (!media) return Promise.resolve()
  const video = media as WebKitVideoLike
  if (video.webkitPresentationMode === 'picture-in-picture' && typeof video.webkitSetPresentationMode === 'function') {
    video.webkitSetPresentationMode('inline')
    return Promise.resolve()
  }
  if (typeof document !== 'undefined' && typeof document.exitPictureInPicture === 'function') {
    return Promise.resolve(document.exitPictureInPicture()).then(() => undefined)
  }
  if (typeof video.exitPictureInPicture === 'function') {
    return Promise.resolve(video.exitPictureInPicture()).then(() => undefined)
  }
  return Promise.resolve()
}

// Not `async` so WebKit fallback methods run synchronously inside the user activation turn when `!doc.fullscreenEnabled`.
const enterFullscreen = (container: HTMLElement | null, media: EventTarget | null): Promise<void> => {
  if (!media) return Promise.resolve()
  const doc = (container?.ownerDocument ?? (media instanceof Node ? media.ownerDocument : null) ?? document) as WebKitDocument
  const video = media as WebKitVideoLike

  const hasMediaFullscreen =
    media instanceof Element
      ? isVideoFullscreenCapable(video)
      : typeof video.requestFullscreen === 'function'

  const requestMedia = (): Promise<void> => {
    if (media instanceof Element) return requestElementFullscreen(media)
    if (typeof video.requestFullscreen === 'function') {
      return Promise.resolve(video.requestFullscreen()).then(() => undefined)
    }
    return Promise.resolve()
  }

  if (container && (doc.fullscreenEnabled || doc.webkitFullscreenEnabled)) {
    return requestElementFullscreen(container).catch((error) => {
      if (hasMediaFullscreen) return requestMedia()
      return Promise.reject(error instanceof Error ? error : new Error(String(error)))
    })
  }

  return requestMedia()
}

const leaveFullscreen = (media: EventTarget | null): Promise<void> => {
  if (!media) return Promise.resolve()
  const doc = ((media instanceof Node ? media.ownerDocument : null) ?? document) as WebKitDocument
  const video = media as WebKitVideoLike

  if (doc.fullscreenElement || doc.webkitFullscreenElement) {
    return exitDocumentFullscreen(doc)
  }

  if (video.webkitPresentationMode === 'fullscreen' && typeof video.webkitSetPresentationMode === 'function') {
    video.webkitSetPresentationMode('inline')
    return Promise.resolve()
  }

  if (video.webkitDisplayingFullscreen) {
    const exitVideo = video.webkitExitFullscreen ?? video.webkitExitFullScreen
    if (typeof exitVideo === 'function') {
      exitVideo.call(video)
      return Promise.resolve()
    }
    if (media instanceof Element) return exitDocumentFullscreen(doc)
  }

  if (typeof video.exitFullscreen === 'function') {
    return Promise.resolve(video.exitFullscreen()).then(() => undefined)
  }

  if (typeof doc.exitFullscreen === 'function' || typeof doc.webkitExitFullscreen === 'function') {
    return exitDocumentFullscreen(doc)
  }

  return Promise.resolve()
}

type FullscreenState = {
  fullscreen: boolean
  fullscreenAvailability: FullscreenAvailability
  requestFullscreen: () => Promise<void>
  exitFullscreen: () => Promise<void>
  toggleFullscreen: () => Promise<void>
}

export const fullscreenFeature = definePlayerFeature({
  name: 'fullscreen',
  state: ({ target }): FullscreenState => ({
    fullscreen: false,
    fullscreenAvailability: 'unavailable',
    requestFullscreen() {
      const { media, container } = target()
      if (isPictureInPicture(media)) {
        return exitPictureInPicture(media).then(() => enterFullscreen(container, media))
      }
      return enterFullscreen(container, media)
    },
    exitFullscreen() {
      const { media } = target()
      return leaveFullscreen(media)
    },
    toggleFullscreen() {
      const { media, container } = target()
      if (isFullscreen(container, media)) return leaveFullscreen(media)
      if (isPictureInPicture(media)) {
        return exitPictureInPicture(media).then(() => enterFullscreen(container, media))
      }
      return enterFullscreen(container, media)
    },
  }),
  attach({ target, signal, set }) {
    const { media, container } = target
    set({ fullscreenAvailability: isFullscreenEnabled(media) ? 'available' : 'unsupported' })

    const sync = () => set({ fullscreen: isFullscreen(container, media) })
    sync()

    const doc = (container?.ownerDocument ?? (media instanceof Node ? media.ownerDocument : null) ?? document) as Document
    const mediaTarget = media as EventTarget
    const abort = { signal }
    doc.addEventListener('fullscreenchange', sync, abort)
    doc.addEventListener('webkitfullscreenchange', sync, abort)
    // Listen unconditionally on media: iPhone Safari lacks webkitPresentationMode and fires begin/end directly.
    mediaTarget.addEventListener('webkitpresentationmodechanged', sync, abort)
    mediaTarget.addEventListener('webkitbeginfullscreen', sync, abort)
    mediaTarget.addEventListener('webkitendfullscreen', sync, abort)
  },
})
