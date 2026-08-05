/// <reference types="@emotion/react/types/css-prop" />
import type { DownloadedRange } from './react/context'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { css, Global } from '@emotion/react'

import MediaPlayer from './index'

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
    fetch(url, { headers: { Range: 'bytes=0-1' } })
      .then(({ headers }) => {
        const contentRangeContentLength = headers.get('Content-Range')?.split('/').at(1)
        setContentLength(
          contentRangeContentLength
            ? Number(contentRangeContentLength)
            : Number(headers.get('Content-Length'))
        )
      })
  }, [])

  const origin = useMemo(() => new URL(window.location.toString()).origin, [])
  const publicPath = useMemo(() => new URL('/build/', origin).toString(), [origin])
  const libavWorkerUrl = useMemo(() => new URL('/build/libav-worker.js', origin).toString(), [origin])
  const jassubWasmUrl = useMemo(() => new URL('/build/jassub-worker-modern.wasm', origin).toString(), [origin])

  // jassub's prebuilt worker is a classic script, so it is wrapped via importScripts. A memo rather
  // than an effect, because a changing URL identity tears the pipeline down.
  const jassubWorkerUrl = useMemo(() => {
    const workerUrl = new URL('/build/jassub-worker.js', origin).toString()
    return URL.createObjectURL(new Blob([`importScripts(${JSON.stringify(workerUrl)})`], { type: 'application/javascript' }))
  }, [origin])
  useEffect(() => () => URL.revokeObjectURL(jassubWorkerUrl), [jassubWorkerUrl])

  const defaultFontUrl = useMemo(() => new URL('/build/default.woff2', origin).toString(), [origin])

  // a fake download ramp, so the seekbar's loaded layer has something to paint
  const [downloadedRanges, setDownloadedRanges] = useState<DownloadedRange[]>([])
  useEffect(() => {
    if (!contentLength) return
    let fraction = 0
    let timer: ReturnType<typeof setTimeout>
    const step = () => {
      setDownloadedRanges([{ startByteOffset: 0, endByteOffset: contentLength * fraction }])
      fraction += 0.1
      if (fraction < 1) timer = setTimeout(step, 1000)
    }
    step()
    return () => clearTimeout(timer)
  }, [contentLength])

  return (
    <div css={mountStyle}>
      <MediaPlayer
        title="video.mkv"
        downloadedRanges={contentLength ? downloadedRanges : undefined}
        bufferSize={BASE_BUFFER_SIZE}
        read={read}
        size={contentLength}
        autoplay={true}
        thumbnails={true}
        publicPath={publicPath}
        libavWorkerUrl={libavWorkerUrl}
        jassubWorkerUrl={jassubWorkerUrl}
        jassubWasmUrl={jassubWasmUrl}
        defaultFontUrl={defaultFontUrl}
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
const root = createRoot(document.body.appendChild(mountElement))

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
