import { css } from '@emotion/react'
import { useContext } from 'react'

import { MediaMachineContext } from '../state-machines'
import { MediaPlayerContext } from '../context'

const style = css`
  position: absolute;
  bottom: 0;
  left: 0;
  z-index: 1;
`

export default () => {
  const mediaActor = MediaMachineContext.useActorRef()
  const isPaused = MediaMachineContext.useSelector((state) => state.context.media.paused)
  const mediaPlayerContext = useContext(MediaPlayerContext)
  
  const togglePlay = () => {
    if (!mediaActor) return
    if (isPaused) {
      mediaActor.send({ type: 'PLAY' })
      // mediaPlayerContext.videoElement?.play()
    }
    else {
      mediaActor.send({ type: 'PAUSE' })
      // mediaPlayerContext.videoElement?.pause()
    }
  }

  return (
    <div css={style}>
      <button onClick={() => togglePlay()}>togglePlay</button>
    </div>
  )
}
 