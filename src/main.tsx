import { createRoot } from 'react-dom/client'
import { css, Global } from '@emotion/react'

import Home from './routes/home'

// The chrome is sized in rem against a 62.5% root. A host page has to set the same base or every
// control renders 1.6x too large.
const globalStyle = css`
  @import url('https://fonts.googleapis.com/css2?family=Montserrat:ital,wght@0,300;0,400;0,500;0,600;0,700;1,400&display=swap');

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
    /* dvh, not vh: a mobile browser counts its collapsing address bar in vh, so a 100vh player is
       taller than the screen and its control bar sits under the chrome until the user scrolls. */
    height: 100dvh;
    width: 100%;
    font-size: 1.6rem;
    font-family: Montserrat, system-ui, sans-serif;
    color: #fff;
    background: #000;
    overflow: hidden;
    overscroll-behavior: none;
  }

  body > div {
    height: 100%;
    width: 100%;
  }
`

const mountElement = document.createElement('div')
const root = createRoot(document.body.appendChild(mountElement))

root.render(
  <>
    <Global styles={globalStyle} />
    <Home />
  </>,
)
