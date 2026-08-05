import type { EmbedSource, PortRequest, PortResponse } from './protocol'

export type ResolvedSource = {
  length: number
  name?: string
  read: (offset: number, size: number) => Promise<ArrayBuffer>
  /** A non-prioritizing read for thumbnail generation. Falls back to `read`. */
  readQuiet: (offset: number, size: number) => Promise<ArrayBuffer>
  onSeek?: (byteOffset: number) => void
  close?: () => void
}

const RETRY_DELAYS = [100, 300, 900]

/**
 * libav treats a rejected read as fatal: the task dies with 'Cancelled' and playback ends. A source
 * that crosses a network or a frame boundary will occasionally fail a read for reasons that clear on
 * their own, so every read is retried a few times before libav is allowed to see a failure.
 */
const withRetry = (
  read: (offset: number, size: number) => Promise<ArrayBuffer>,
): ((offset: number, size: number) => Promise<ArrayBuffer>) =>
  async (offset, size) => {
    let lastError: unknown
    for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
      try {
        return await read(offset, size)
      } catch (error) {
        lastError = error
        const delay = RETRY_DELAYS[attempt]
        if (delay === undefined) break
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }
    throw lastError
  }

const fromBlob = (blob: Blob, name?: string): ResolvedSource => {
  const read = (offset: number, size: number) => blob.slice(offset, offset + size).arrayBuffer()
  return { length: blob.size, name, read: withRetry(read), readQuiet: withRetry(read) }
}

const probeLength = async (url: string, credentials: RequestCredentials) => {
  const response = await fetch(url, { headers: { Range: 'bytes=0-1' }, credentials })
  if (!response.ok) throw new Error(`The source could not be read: HTTP ${response.status}`)
  const fromRange = response.headers.get('Content-Range')?.split('/').at(1)
  const length = fromRange ? Number(fromRange) : Number(response.headers.get('Content-Length'))
  if (!Number.isFinite(length) || length <= 0) throw new Error('The source did not report its length')
  // An origin that ignores Range hands back the whole file, which cannot be streamed a piece at a time
  if (!fromRange && response.status !== 206) throw new Error('The source does not support range requests')
  return length
}

const fromUrl = async (url: string, declared: number | undefined, name: string | undefined, credentials: RequestCredentials): Promise<ResolvedSource> => {
  const length = declared ?? await probeLength(url, credentials)
  const read = async (offset: number, size: number) => {
    const response = await fetch(url, {
      headers: { Range: `bytes=${offset}-${Math.min(offset + size, length) - 1}` },
      credentials,
    })
    if (!response.ok) throw new Error(`The source could not be read: HTTP ${response.status}`)
    return response.arrayBuffer()
  }
  return { length, name, read: withRetry(read), readQuiet: withRetry(read) }
}

/**
 * A dedicated MessagePort carrying one request per read. Cheaper than proxying a function over the
 * RPC boundary, which allocates a return channel per call, and it lets several reads be in flight.
 */
const fromPort = (port: MessagePort, length: number, name?: string): ResolvedSource => {
  const pending = new Map<number, { resolve: (data: ArrayBuffer) => void, reject: (error: Error) => void }>()
  let nextId = 1
  port.onmessage = (event: MessageEvent<PortResponse>) => {
    const message = event.data
    const entry = pending.get(message.id)
    if (!entry) return
    pending.delete(message.id)
    if (message.ok) entry.resolve(message.data)
    else entry.reject(new Error(message.message))
  }
  port.start?.()

  const request = (offset: number, size: number, quiet: boolean) =>
    new Promise<ArrayBuffer>((resolve, reject) => {
      const id = nextId++
      pending.set(id, { resolve, reject })
      const message: PortRequest = { id, offset, size, quiet }
      port.postMessage(message)
    })

  return {
    length,
    name,
    read: withRetry((offset, size) => request(offset, size, false)),
    readQuiet: withRetry((offset, size) => request(offset, size, true)),
    close: () => {
      for (const entry of pending.values()) entry.reject(new Error('The source was closed'))
      pending.clear()
      port.close()
    },
  }
}

export const resolveSource = async (source: EmbedSource): Promise<ResolvedSource> => {
  switch (source.kind) {
    case 'blob':
      return fromBlob(source.blob, source.name ?? (source.blob instanceof File ? source.blob.name : undefined))
    case 'url':
      return fromUrl(source.url, source.length, source.name, source.credentials === 'include' ? 'include' : 'omit')
    case 'port':
      return fromPort(source.port, source.length, source.name)
    case 'reader': {
      const quiet = source.readQuiet ?? source.read
      return {
        length: source.length,
        name: source.name,
        read: withRetry((offset, size) => source.read(offset, size)),
        readQuiet: withRetry((offset, size) => quiet(offset, size)),
        onSeek: source.onSeek,
      }
    }
    default:
      throw new Error(`Unknown source kind: ${(source as { kind: string }).kind}`)
  }
}
