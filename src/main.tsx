/// <reference types="@emotion/react/types/css-prop" />
import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { css, Global } from '@emotion/react'

import MediaPlayer from './index'
import { bufferStream } from './utils'

const mountStyle = css`
  display: grid;
  height: 100%;
  width: 100%;
`

const BASE_BUFFER_SIZE = 5_000_000

const Mount = () => {
  const [videoElemRef, setVideoElemRef] = useState<HTMLVideoElement | null>()
  const [size, setSize] = useState<number>()

  useEffect(() => {
    if (!videoElemRef) return
    videoElemRef.addEventListener('error', err => console.log('err', err))
  }, [videoElemRef])

  const [currentStreamOffset, setCurrentStreamOffset] = useState<number>(0)
  const [streamReader, setStreamReader] = useState<ReadableStreamDefaultReader<Uint8Array>>()

  useEffect(() => {
    if (!streamReader) return
    return () => {
      streamReader.cancel()
    }
  }, [streamReader])

  const setupStream = async (offset: number) => {
    if (streamReader) {
      streamReader.cancel()
    }
    const streamResponse = await onFetch(offset, undefined, true)
    if (!streamResponse.body) throw new Error('no body')
    const stream = bufferStream({ stream: streamResponse.body, size: BASE_BUFFER_SIZE })
    const reader = stream.getReader()
    setStreamReader(reader)
    setCurrentStreamOffset(offset)
    return reader
  }

  const onFetch = async (offset: number, end?: number, force?: boolean) => {
    if (force || end !== undefined && ((end - offset) + 1) !== BASE_BUFFER_SIZE) {
      return (
        fetch(
          '/video3.mkv',
          {
            headers: {
              Range: `bytes=${offset}-${end ?? ''}`
            }
          }
        )
      )
    }
    const _streamReader =
      currentStreamOffset !== offset
        ? await setupStream(offset)
        : streamReader

    if (!_streamReader) throw new Error('Stream reader not ready')
    return new Response(
      await _streamReader
        .read()
        .then(({ value }) => {
          if (value) {
            setCurrentStreamOffset(offset => offset + value.byteLength)
          }
          return value
        })
    )
  }

  useEffect(() => {
    onFetch(0, 1, true).then(async ({ headers, body }) => {
      if (!body) throw new Error('no body')
      const contentRangeContentLength = headers.get('Content-Range')?.split('/').at(1)
      const contentLength =
        contentRangeContentLength
          ? Number(contentRangeContentLength)
          : Number(headers.get('Content-Length'))
      await setupStream(0)
      setSize(contentLength)
    })
  }, [])

  return (
    <div css={mountStyle}>
      <MediaPlayer
        baseBufferSize={BASE_BUFFER_SIZE}
        ref={setVideoElemRef}
        size={size}
        fetch={onFetch}
        publicPath={'/build/'}
        workerPath={'/node_modules/@banou26/libav-wasm/build/worker.js'}
        libassPath={'/build/jassub-worker.js'}
      />
    </div>
  )
}

const globalStyle = css`
  @import url('https://fonts.googleapis.com/css2?family=Fira+Code:wght@300;400;500;600;700&family=Fira+Sans:ital,wght@0,100;0,200;0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,100;1,200;1,300;1,500;1,600;1,700;1,800;1,900&family=Montserrat:ital,wght@0,100;0,200;0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,100;1,200;1,300;1,400;1,500;1,600;1,700;1,800;1,900&family=Roboto:ital,wght@0,100;0,300;0,400;0,500;0,700;0,900;1,100;1,300;1,400;1,500;1,700;1,900&display=swap');

  *, *::before, *::after {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  html {
    font-size: 62.5%;
    height: 100%;
    width: 100%;
  }

  body {
    margin: 0;
    height: 100%;
    width: 100%;
    font-size: 1.6rem;
    font-family: Fira Sans;
    color: #fff;
    
    font-family: Montserrat;
    // font-family: "Segoe UI", Roboto, "Fira Sans",  "Helvetica Neue", Arial, sans-serif;
  }

  body > div {
    height: 100%;
    width: 100%;
  }

  a {
    color: #777777;
    text-decoration: none;
  }

  a:hover {
    color: #fff;
    text-decoration: underline;
  }

  ul {
    list-style: none;
  }
`

const mountElement = document.createElement('div')

const root = createRoot(
  document.body.appendChild(mountElement)
)

root.render(
  <>
    <Global styles={globalStyle}/>
    <Mount/>
  </>
)

if (import.meta.hot) {
  import.meta.hot.dispose((data) => {
    root.unmount()
    mountElement.remove()
  })
}
