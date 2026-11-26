import { definePlayerFeature } from '@videojs/core/dom'
import {
  exitFullscreen as exitDocumentFullscreen,
  fullscreenElement as getFullscreenElement,
  fullscreenEnabled as checkFullscreenEnabled,
  requestFullscreen as requestElementFullscreen,
} from '@banou/ponyfill/fullscreen'

type FullscreenAvailability = 'available' | 'unavailable' | 'unsupported'

type WebKitPresentationMode = 'inline' | 'fullscreen' | 'picture-in-picture'

type WebKitPiPLike = {
  webkitPresentationMode?: WebKitPresentationMode
  webkitSetPresentationMode?: (mode: WebKitPresentationMode) => void
  isPictureInPicture?: boolean
  exitPictureInPicture?: () => Promise<unknown>
}

type RemoteFullscreenLike = {
  requestFullscreen?: () => Promise<unknown>
  exitFullscreen?: () => Promise<unknown>
  isFullscreen?: boolean
}

const docOf = (container: HTMLElement | null, media: EventTarget | null): Document =>
  container?.ownerDocument ?? (media instanceof Node ? media.ownerDocument : null) ?? document

const isFullscreenEnabled = (container: HTMLElement | null, media: EventTarget | null) =>
  media !== null && checkFullscreenEnabled(docOf(container, media), media instanceof Element ? media : null)

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
  const active = getFullscreenElement(docOf(container, media), media instanceof Element ? media : null)
  if (active && (active === container || active === media)) return true
  if (matchesFullscreen(container) || matchesFullscreen(media)) return true
  return (media as RemoteFullscreenLike).isFullscreen ?? false
}

const isPictureInPicture = (container: HTMLElement | null, media: EventTarget | null) => {
  if (!media) return false
  const video = media as WebKitPiPLike
  if (video.webkitPresentationMode === 'picture-in-picture') return true
  const doc = docOf(container, media)
  if (doc.pictureInPictureElement === media) return true
  return video.isPictureInPicture ?? false
}

const exitPictureInPicture = (container: HTMLElement | null, media: EventTarget | null): Promise<void> => {
  if (!media) return Promise.resolve()
  const video = media as WebKitPiPLike
  if (video.webkitPresentationMode === 'picture-in-picture' && typeof video.webkitSetPresentationMode === 'function') {
    video.webkitSetPresentationMode('inline')
    return Promise.resolve()
  }
  const doc = docOf(container, media)
  if (doc.pictureInPictureElement === media && typeof doc.exitPictureInPicture === 'function') {
    return Promise.resolve(doc.exitPictureInPicture()).then(() => undefined)
  }
  if (typeof video.exitPictureInPicture === 'function') {
    return Promise.resolve(video.exitPictureInPicture()).then(() => undefined)
  }
  return Promise.resolve()
}

// Not `async` so WebKit fallback methods run synchronously inside the user activation turn when `!doc.fullscreenEnabled`.
const enterFullscreen = (container: HTMLElement | null, media: EventTarget | null): Promise<void> => {
  if (!media) return Promise.resolve()
  const doc = docOf(container, media)
  const remote = media as RemoteFullscreenLike
  const hasMediaFullscreen = media instanceof Element || typeof remote.requestFullscreen === 'function'

  const requestMedia = (): Promise<void> => {
    if (media instanceof Element) return requestElementFullscreen(media)
    if (typeof remote.requestFullscreen === 'function') {
      return Promise.resolve(remote.requestFullscreen()).then(() => undefined)
    }
    return Promise.resolve()
  }

  if (container && checkFullscreenEnabled(doc)) {
    return requestElementFullscreen(container).catch((error) => {
      if (hasMediaFullscreen) return requestMedia()
      return Promise.reject(error instanceof Error ? error : new Error(String(error)))
    })
  }

  return requestMedia()
}

const leaveFullscreen = (container: HTMLElement | null, media: EventTarget | null): Promise<void> => {
  if (!media) return Promise.resolve()
  const remote = media as RemoteFullscreenLike
  if (!(media instanceof Element) && typeof remote.exitFullscreen === 'function') {
    return Promise.resolve(remote.exitFullscreen()).then(() => undefined)
  }
  return exitDocumentFullscreen(docOf(container, media), media instanceof Element ? media : null)
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
      if (isPictureInPicture(container, media)) {
        return exitPictureInPicture(container, media).then(() => enterFullscreen(container, media))
      }
      return enterFullscreen(container, media)
    },
    exitFullscreen() {
      const { media, container } = target()
      return leaveFullscreen(container, media)
    },
    toggleFullscreen() {
      const { media, container } = target()
      if (isFullscreen(container, media)) return leaveFullscreen(container, media)
      if (isPictureInPicture(container, media)) {
        return exitPictureInPicture(container, media).then(() => enterFullscreen(container, media))
      }
      return enterFullscreen(container, media)
    },
  }),
  attach({ target, signal, set }) {
    const { media, container } = target
    const syncAvailability = () => set({
      fullscreenAvailability: isFullscreenEnabled(container, media) ? 'available' : 'unsupported',
    })
    syncAvailability()

    const sync = () => set({ fullscreen: isFullscreen(container, media) })
    sync()

    const doc = docOf(container, media)
    const mediaTarget = media as EventTarget
    const abort = { signal }
    doc.addEventListener('fullscreenchange', sync, abort)
    doc.addEventListener('webkitfullscreenchange', sync, abort)
    // Listen unconditionally on media: iPhone Safari lacks webkitPresentationMode and fires begin/end directly.
    mediaTarget.addEventListener('webkitpresentationmodechanged', sync, abort)
    mediaTarget.addEventListener('webkitbeginfullscreen', sync, abort)
    mediaTarget.addEventListener('webkitendfullscreen', sync, abort)
    mediaTarget.addEventListener('loadedmetadata', syncAvailability, abort)
  },
})
