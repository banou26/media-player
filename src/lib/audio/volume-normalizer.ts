import { createMediaElementSource } from '@banou/ponyfill/web-audio'

/** Read once, when the node is made. Every field defaults to the value the HOR-291 measurements chose. */
export type VolumeNormalizerOptions = {
  targetLufs?: number
  maxCutDb?: number
  attackSeconds?: number
  releaseSeconds?: number
  gateLufs?: number
  enabled?: boolean
  inputGainDb?: number
}

/** The worklet at `workletUrl`, as a node. A context takes the module once: make a node per context. */
export const createVolumeNormalizerNode = async (
  context: BaseAudioContext,
  workletUrl: string,
  options: VolumeNormalizerOptions = {},
) => {
  await context.audioWorklet.addModule(workletUrl)
  return new AudioWorkletNode(context, 'banou-volume-normalizer', {
    // with one input, one output and no outputChannelCount, the output follows the input's channels
    channelCountMode: 'max',
    processorOptions: options,
  })
}

export type VolumeNormalizer = {
  context: AudioContext
  /** Settles once the element is routed, which waits for the context to run. Rejects if it never can be. */
  routed: Promise<AudioWorkletNode>
  /** Engage or bypass. A routed element stays routed: it cannot be handed back. */
  setEnabled: (enabled: boolean) => void
  /**
   * For an element going away. One still in the document has its context suspended, and attaching it again resumes
   * it. One out of the document is gone for good, so its context is closed.
   */
  release: () => void
}

const attached = new WeakMap<HTMLMediaElement, VolumeNormalizer & { wake: () => void }>()

const running = (context: AudioContext) => new Promise<void>((resolve, reject) => {
  const check = () => {
    if (context.state !== 'running' && context.state !== 'closed') return
    context.removeEventListener('statechange', check)
    if (context.state === 'running') resolve()
    else reject(new DOMException('The AudioContext closed before it ran', 'InvalidStateError'))
  }
  context.addEventListener('statechange', check)
  check()
})

/**
 * Routes `element` through the normalizer, once for its whole life, and returns the same handle on every later
 * call. Measured in Chrome 153, Firefox 151 and WebKit 26.5 (HOR-291):
 *
 * - An element routed into a context that autoplay rules hold suspended goes silent (Firefox, WebKit) or stops
 *   advancing (Chrome). So nothing is routed until the context runs; until then the element plays as it always did,
 *   and the next pointerdown or keydown resumes the context.
 * - Chrome and WebKit refuse a second source for one element, and Chrome stops a playing element whose context is
 *   closed, so the context is closed only once the element has left the document, and off is a bypass in the same
 *   graph.
 * - Chrome and Firefox apply the element's volume before the graph, so the worklet is told the volume and judges
 *   loudness without it: otherwise a viewer at 25% would read as a quiet episode and nothing would be cut.
 * - WebKit loses the volume and mute once routed, so `@banou/ponyfill` refuses it and `routed` rejects with a
 *   `NotSupportedError` before the element is touched.
 */
export const attachVolumeNormalizer = (
  element: HTMLMediaElement,
  workletUrl: string,
  options: VolumeNormalizerOptions = {},
): VolumeNormalizer => {
  const existing = attached.get(element)
  if (existing) {
    existing.wake()
    return existing
  }

  const context = new AudioContext()
  let enabled = options.enabled !== false
  let node: AudioWorkletNode | undefined
  let released = false
  const inputGainDb = () => 20 * Math.log10(Math.max(element.volume, 1e-6))

  const document = element.ownerDocument
  const resume = () => { if (context.state === 'suspended') context.resume().catch(() => {}) }
  const listen = (on: boolean) => {
    for (const type of ['pointerdown', 'keydown']) {
      if (on) document.addEventListener(type, resume, true)
      else document.removeEventListener(type, resume, true)
    }
  }
  const follow = () => listen(!released && context.state === 'suspended')
  context.addEventListener('statechange', follow)
  follow()

  const routed = (async () => {
    const created = await createVolumeNormalizerNode(context, workletUrl, { ...options, enabled, inputGainDb: inputGainDb() })
    await running(context)
    const source = createMediaElementSource(context, element)
    created.port.postMessage({ enabled, inputGainDb: inputGainDb() })
    source.connect(created).connect(context.destination)
    element.addEventListener('volumechange', () => created.port.postMessage({ inputGainDb: inputGainDb() }))
    // the 3 s window describes where the playhead was, and a new file owes nothing to the last one's cut
    element.addEventListener('seeking', () => created.port.postMessage({ reset: 'seek' }))
    element.addEventListener('emptied', () => created.port.postMessage({ reset: 'source' }))
    node = created
    return created
  })()
  routed.catch(() => {
    released = true
    listen(false)
    // never routed, so closing it cannot touch the element
    context.close().catch(() => {})
  })

  const handle = {
    context,
    routed,
    setEnabled: (value: boolean) => {
      enabled = value
      node?.port.postMessage({ enabled })
    },
    release: () => {
      released = true
      listen(false)
      // Chrome keeps a context that is not closed alive, with its worklet node, for the life of the page
      if (!element.isConnected) {
        attached.delete(element)
        context.close().catch(() => {})
      } else if (context.state === 'running') context.suspend().catch(() => {})
    },
    wake: () => {
      if (context.state === 'closed') return
      released = false
      resume()
      follow()
    },
  }
  attached.set(element, handle)
  return handle
}
