/// <reference types="@emotion/react/types/css-prop" />
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { css, Global } from '@emotion/react'

import MediaPlayer from './index'
import { DownloadedRange } from './utils/context'

const mountStyle = css`
  display: grid;
  height: 100vh;
  width: 100vw;
`

const BASE_BUFFER_SIZE = 2_500_000
const url = '/video2.mkv'

const Mount = () => {
  const [contentLength, setContentLength] = useState<number>()

  const read = useCallback(
    (offset: number, size: number) => {
      if (contentLength === undefined) return Promise.resolve(new Uint8Array(0).buffer)
      if (offset >= contentLength) return Promise.resolve(new Uint8Array(0).buffer)
      return (
        fetch(url, { headers: { Range: `bytes=${offset}-${Math.min(offset + size, contentLength) - 1}` } })
          .then(res => res.arrayBuffer())
      )
    },
    [contentLength]
  )

  useEffect(() => {
    fetch(url, { headers: { Range: `bytes=${0}-${1}` } })
      .then(async ({ headers, body }) => {
        if (!body) throw new Error('no body')
        const contentRangeContentLength = headers.get('Content-Range')?.split('/').at(1)
        const contentLength =
          contentRangeContentLength
            ? Number(contentRangeContentLength)
            : Number(headers.get('Content-Length'))
        setContentLength(contentLength)
      })
  }, [])

  const jassubWorkerUrl = useMemo(() => {
    const workerUrl = new URL('/build/jassub-worker.js', import.meta.url).toString()
    const blob = new Blob([`importScripts(${JSON.stringify(workerUrl)})`], { type: 'application/javascript' })
    return URL.createObjectURL(blob)
  }, [])

  const libavWorkerUrl = useMemo(() => {
    const workerUrl = new URL('/build/libav.js', new URL(window.location.toString()).origin).toString()
    const blob = new Blob([`importScripts(${JSON.stringify(workerUrl)})`], { type: 'application/javascript' })
    return URL.createObjectURL(blob)
  }, [])

  const jassubWasmUrl = useMemo(() => {
    return new URL('/build/jassub-worker.wasm', new URL(window.location.toString()).origin).toString()
  }, [])

  const jassubModernWasmUrl = useMemo(() => {
    return new URL('/build/jassub-modern-worker.wasm', new URL(window.location.toString()).origin).toString()
  }, [])

  const [downloadedRanges, setDownloadedRanges] = useState<DownloadedRange[]>([])

  useEffect(() => {
    if (!contentLength) return
    let i = 0
    const increaseDownloadedRanges = () => {
      setDownloadedRanges(() => [
        {
          startByteOffset: 0,
          endByteOffset: contentLength * i
        }
      ])
      i += 0.1
      if (i < 1) {
        setTimeout(increaseDownloadedRanges, 1000)
      }
    }
    increaseDownloadedRanges()
  }, [contentLength])

  return (
    <div css={mountStyle}>
      <MediaPlayer
        title={'video.mkv'}
        downloadedRanges={contentLength ? downloadedRanges : undefined}
        bufferSize={BASE_BUFFER_SIZE}
        read={read}
        size={contentLength}
        autoplay={true}
        publicPath={new URL('/build/', new URL(import.meta.url).origin).toString()}
        jassubModernWasmUrl={jassubModernWasmUrl}
        jassubWorkerUrl={jassubWorkerUrl}
        jassubWasmUrl={jassubWasmUrl}
        libavWorkerUrl={libavWorkerUrl}
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
  import.meta.hot.dispose(() => {
    root.unmount()
    mountElement.remove()
  })
}
