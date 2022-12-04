/// <reference types="@emotion/react/types/css-prop" />
import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { css, Global } from '@emotion/react'

import FKNMediaPlayer from './index'

const mountStyle = css`
  display: grid;
  height: 100%;
  width: 100%;
`

const Mount = () => {
  const [videoElemRef, setVideoElemRef] = useState<HTMLVideoElement | null>()
  const [size, setSize] = useState<number>()

  useEffect(() => {
    if (!videoElemRef) return
    videoElemRef.addEventListener('error', err => console.log('err', err))
  }, [videoElemRef])

  const onFetch = (offset: number, end: number) =>
    // fetch('./video.mkv')
    // fetch('./video5.mkv')
    // fetch('./video4.mkv')
    // fetch('fucked-subtitles-and-FF-playback.mkv')
    // fetch('wrong-dts-3.mkv')
    fetch(
      '../build/video5.mkv',
      {
        headers: {
          Range: `bytes=${offset}-${end}`
        }
      }
    )

  useEffect(() => {
    onFetch(0, 1).then(({ headers, body }) => {
      if (!body) throw new Error('no body')
      const contentRangeContentLength = headers.get('Content-Range')?.split('/').at(1)
      const contentLength =
        contentRangeContentLength
          ? Number(contentRangeContentLength)
          : Number(headers.get('Content-Length'))
      setSize(contentLength)
    })
  }, [])

  return (
    <div css={mountStyle}>
      <FKNMediaPlayer
        ref={setVideoElemRef}
        size={size}
        fetch={onFetch}
        publicPath={'/build/'}
        workerPath={'/node_modules/@banou26/oz-libav/build/index2.js'}
        libassPath={'/build/subtitles-octopus-worker.js'}
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
