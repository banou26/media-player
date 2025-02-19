/// <reference types="@emotion/react/types/css-prop" />
import type { HTMLAttributes } from 'react'

import { css } from '@emotion/react'

import { MediaMachineContext } from '../state-machines'
import { Overlay } from './overlay'

const style = css`
  --background-padding: 2rem;
  display: grid;
  grid-template-rows: 1fr;
  overflow: hidden;
`

export type ChromeOptions = {

} & HTMLAttributes<HTMLDivElement>

export default ({ children }: ChromeOptions) => {
  const mediaActor = MediaMachineContext.useActorRef()
  const status = MediaMachineContext.useSelector((state) => state.value)
  
  return (
    <div css={style}>
      <Overlay/>
      {children}
    </div>
  )
}
