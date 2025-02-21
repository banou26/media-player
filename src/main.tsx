/// <reference types="@emotion/react/types/css-prop" />
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { css, Global } from '@emotion/react'

import MediaPlayer from './index'

const mountStyle = css`
  display: grid;
  height: 100%;
  width: 100%;
`

const BASE_BUFFER_SIZE = 5_000_000
const BACKPRESSURE_STREAM_ENABLED = !navigator.userAgent.includes("Firefox")

const Mount = () => {
  const [size, setSize] = useState<number>()

  const fetchData = useCallback(
    async (offset: number, end?: number) =>
      fetch(
        '/video.mkv',
        {
          headers: {
            Range: `bytes=${offset}-${end ?? (!BACKPRESSURE_STREAM_ENABLED ? Math.min(offset + BASE_BUFFER_SIZE, size!) : '')}`
          }
        }
      ),
    []
  )

  useEffect(() => {
    fetchData(0, 1).then(async ({ headers, body }) => {
      if (!body) throw new Error('no body')
      const contentRangeContentLength = headers.get('Content-Range')?.split('/').at(1)
      const contentLength =
        contentRangeContentLength
          ? Number(contentRangeContentLength)
          : Number(headers.get('Content-Length'))
      setSize(contentLength)
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

  return (
    <div css={mountStyle}>
      <MediaPlayer
        fetchData={fetchData}
        size={size}
        publicPath={new URL('/build/', new URL(import.meta.url).origin).toString()}
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
  import.meta.hot.dispose(() => {
    root.unmount()
    mountElement.remove()
  })
}
