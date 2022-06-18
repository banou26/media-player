/// <reference types="@emotion/react/types/css-prop" />
import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { css, Global } from '@emotion/react'
import { updateSourceBuffer as _updateSourceBuffer } from './utils'

import FKNMediaPlayer from './index'

const mountStyle = css`
  display: grid;
  height: 100%;
  width: 100%;
`

const Mount = () => {
  const [videoElemRef, setVideoElemRef] = useState<HTMLVideoElement>()
  const [size, setSize] = useState<number>()
  const [stream, setStream] = useState<ReadableStream<Uint8Array>>()

  useEffect(() => {
    if (!videoElemRef) return
    videoElemRef.addEventListener('error', err => console.log('err', err))
  }, [videoElemRef])

  useEffect(() => {

    const magnet = 'magnet:?xt=urn:btih:dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c&dn=Big+Buck+Bunny&tr=http%3A%2F%2Fnyaa.tracker.wf%3A7777%2Fannounce&tr=udp%3A%2F%2Fopen.stealth.si%3A80%2Fannounce&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337%2Fannounce&tr=udp%3A%2F%2Fexodus.desync.com%3A6969%2Fannounce&tr=udp%3A%2F%2Ftracker.torrent.eu.org%3A451%2Fannounce&tr=wss%3A%2F%2Ftracker.btorrent.xyz&tr=wss%3A%2F%2Ftracker.openwebtorrent.com'

    // fetch(`http://localhost:4001/v0/torrent/${encodeURIComponent(magnet)}`)
    // fetch('./video.mkv')
    fetch('./video5.mkv')
    // fetch('./video4.mkv')
      .then(({ headers, body }) => {
        if (!body || !headers.get('Content-Length')) throw new Error('no stream or Content-Length returned from the response')
        setSize(Number(headers.get('Content-Length')))
        setStream(body)
      })
  }, [])

  return (
    <div css={mountStyle}>
      <FKNMediaPlayer ref={setVideoElemRef} id={'test'} size={size} stream={stream}/>
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

createRoot(
  document.body.appendChild(document.createElement('div'))
).render(
  <>
    <Global styles={globalStyle}/>
    <Mount/>
  </>
)
