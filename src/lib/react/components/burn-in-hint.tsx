import { useEffect, useState } from 'react'
import { css } from '@emotion/react'

import { fonts } from '../../utils/fonts'
import { usePlayer } from '../player'

/** Long enough to read twice, short enough not to sit over the picture. */
const VISIBLE_MS = 9000

const style = css`
  position: absolute;
  inset: 0;
  z-index: 2;
  pointer-events: none;

  .card {
    position: absolute;
    /* Where Firefox draws its own toggle: right aligned, a little past the middle of the height. */
    top: 52%;
    right: calc(7 * var(--mp-unit));
    transform: translateY(-50%);

    display: flex;
    align-items: center;
    gap: calc(1.2 * var(--mp-unit));

    max-width: min(calc(42 * var(--mp-unit)), 60%);
    padding: calc(1.4 * var(--mp-unit)) calc(1.8 * var(--mp-unit));
    border-radius: calc(0.8 * var(--mp-unit));
    background-color: rgba(20, 20, 22, 0.94);
    box-shadow: 0 0 calc(2 * var(--mp-unit)) rgba(0, 0, 0, 0.6);

    opacity: 0;
    transition: opacity 0.25s ease;
  }

  &.show .card {
    opacity: 1;
  }

  .words {
    display: flex;
    flex-direction: column;
    gap: calc(0.3 * var(--mp-unit));
  }

  .title {
    ${fonts.bMedium.bold}
    color: #fff;
  }

  .body {
    ${fonts.bSmall.regular}
    color: rgba(255, 255, 255, 0.75);
  }

  /* Points at the edge the browser's control lives on, which is the whole message. */
  .arrow {
    flex: none;
    font-size: calc(2.6 * var(--mp-unit));
    line-height: 1;
    color: #6EA8FE;
  }
`

/**
 * Says what to do next, because turning burn-in on looks like nothing happening.
 *
 * The composite is pixel identical to the picture it replaces, so without this the click has no
 * visible result at all and the viewer has no way to learn that the browser's own picture in picture
 * control is now the thing to press.
 */
export const BurnInHint = () => {
  const burnedInSubtitles = usePlayer((state) => state.burnedInSubtitles)
  const mode = usePlayer((state) => state.pictureInPictureMode)
  const [show, setShow] = useState(false)

  useEffect(() => {
    if (mode !== 'burn-in' || !burnedInSubtitles) {
      setShow(false)
      return
    }
    setShow(true)
    const timer = setTimeout(() => setShow(false), VISIBLE_MS)
    return () => clearTimeout(timer)
  }, [mode, burnedInSubtitles])

  if (mode !== 'burn-in' || !burnedInSubtitles) return null

  return (
    <div css={style} className={show ? 'show' : ''} role='status'>
      <div className='card'>
        <div className='words'>
          <div className='title'>Subtitles are in the picture</div>
          <div className='body'>
            Now hover the video and click your browser&apos;s own pop out button
          </div>
        </div>
        <div className='arrow' aria-hidden='true'>&rarr;</div>
      </div>
    </div>
  )
}

export default BurnInHint
