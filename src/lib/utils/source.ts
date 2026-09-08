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
    /*
     * A read that starts at or past the end answers empty, the way slicing a Blob does.
     *
     * Without this the range comes out as `bytes=<offset>-<length-1>` with the last byte before the
     * first, which is not a range a server can satisfy: it answers 416 and the read throws, so the
     * demuxer's ordinary walk into EOF surfaces as "Reading the video file failed" on a file that is
     * perfectly fine. The blob arm has always returned empty here, so this is also what makes the two
     * arms of `inputToRemuxerInput` behave the same.
     */
    const end = Math.min(offset + size, length) - 1
    if (end < offset) return new ArrayBuffer(0)
    const response = await fetch(url, {
      headers: { Range: `bytes=${offset}-${end}` },
      credentials,
    })
    if (!response.ok) throw new Error(`The source could not be read: HTTP ${response.status}`)
    return response.arrayBuffer()
  }
  return { length, name, read }
}

/** A source resolved down to what the remuxer needs: a total length and a byte-range reader. */
export type RemuxerInput = {
  length: number
  name?: string
  read: (offset: number, size: number) => Promise<ArrayBuffer>
}

export const inputToRemuxerInput = async (
  params:
    | Parameters<typeof fromBlob | typeof fromUrl>[0]
    // the general arm. `length` is required: nothing downstream can seek or report a duration
    // without it, and a caller supplying its own reader already knows the total.
    | {
      length: number
      name?: string
      read: (offset: number, size: number) => Promise<ArrayBuffer>
    }
// declared rather than inferred, so all three arms are checked against one contract
): Promise<RemuxerInput> => {
  if ('blob' in params) return fromBlob(params)
  if ('url' in params) return fromUrl(params)
  if ('read' in params) return { length: params.length, name: params.name, read: params.read }
  throw new Error(`Unknown source type: ${params}`)
}
