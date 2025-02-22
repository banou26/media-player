/// <reference types="@emotion/react/types/css-prop" />
import type { HTMLAttributes } from 'react'

import { css } from '@emotion/react'

import { MediaMachineContext } from '../state-machines'
import { Overlay } from './overlay'

const style = css`
  position: relative;

  canvas {
    height: 100%;
    width: 100%;
    pointer-events: none;
    position: absolute;
    z-index: 99999999;
  }

  video {
    /* pointer-events: none; */
    background-color: black;
  }
`

export type ChromeOptions = {

} & HTMLAttributes<HTMLDivElement>

export const Chrome = ({ children }: ChromeOptions) => {
  const mediaActor = MediaMachineContext.useActorRef()
  const status = MediaMachineContext.useSelector((state) => state.value)
  
  return (
    <div css={style}>
      <Overlay/>
      {children}
    </div>
  )
}

export default Chrome
