const fromBlob = ({ blob, name }: { blob: Blob, name?: string }) => ({
  length: blob.size,
  name: name ?? (blob instanceof File ? blob.name : undefined),
  read: (offset: number, size: number) => blob.slice(offset, offset + size).arrayBuffer(),
})

const probeLength = async (url: string, credentials?: RequestCredentials) => {
  const response = await fetch(url, { headers: { Range: 'bytes=0-1' }, credentials })
  if (!response.ok) throw new Error(`The source could not be read: HTTP ${response.status}`)
  const fromRange = response.headers.get('Content-Range')?.split('/').at(1)
  const length = fromRange ? Number(fromRange) : Number(response.headers.get('Content-Length'))
  if (!Number.isFinite(length) || length <= 0) throw new Error('The source did not report its length')
  if (!fromRange && response.status !== 206) throw new Error('The source does not support range requests')
  return length
}

const fromUrl = async (
  { url, length: _length, name, credentials }: {
    url: string
    length?: number
    name?: string
    credentials?: RequestCredentials
  }
) => {
  const length = _length ?? await probeLength(url, credentials)
  const read = async (offset: number, size: number) => {
    const response = await fetch(url, {
      headers: { Range: `bytes=${offset}-${Math.min(offset + size, length) - 1}` },
      credentials,
    })
    if (!response.ok) throw new Error(`The source could not be read: HTTP ${response.status}`)
    return response.arrayBuffer()
  }
  return { length, name, read }
}

export const inputToRemuxerInput = async (
  params:
    | Parameters<typeof fromBlob | typeof fromUrl>[0]
    // The general arm: any byte range answered by any means. `length` is required rather than
    // optional because a caller supplying its own reader is the one party that already knows the
    // total, and without it nothing downstream can seek or report a duration.
    | {
      length: number
      name?: string
      read: (offset: number, size: number) => Promise<ArrayBuffer>
    }
) => {
  if ('blob' in params) return fromBlob(params)
  if ('url' in params) return fromUrl(params)
  if ('read' in params) {
    return {
      length: params.length,
      name: params.name,
      read: (offset: number, size: number) => params.read(offset, size)
    }
  }
  throw new Error(`Unknown source type: ${params}`)
}

/** The resolved source, not the promise: `inputToRemuxerInput` is async. */
export type RemuxerInput = Awaited<ReturnType<typeof inputToRemuxerInput>>
