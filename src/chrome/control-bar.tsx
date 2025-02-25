import { useContext } from 'react'
import { css } from '@emotion/react'

import { MediaPlayerContext } from '../context'
import { ProgressBar } from './progress-bar'

const style = css`
  position: absolute;
  bottom: 0;
  height: 100px;
  width: 100%;
  
`

export const ControlBar = () => {
  const chromeContext = useContext(MediaPlayerContext)
  return (
    <div css={style} style={{ ...chromeContext.hideUI ? { display: 'none' } : {} }}>
      <ProgressBar/>
    </div>
  )
}

export default ControlBar
