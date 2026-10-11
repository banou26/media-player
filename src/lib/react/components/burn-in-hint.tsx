import { useEffect, useState } from 'react'
import { css } from '@emotion/react'

import { fonts } from '../../utils/fonts'
import { usePlayer } from '../player'

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

  .text {
    ${fonts.bMedium.medium}
    color: #fff;
  }

  /* Points at the edge the browser's control lives on, which is the whole message. */
  .arrow {
    flex: none;
    font-size: calc(2.6 * var(--mp-unit));
    line-height: 1;
    color: #fff;
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
        <div className='text'>Now click your browser&apos;s pop out button</div>
        <div className='arrow' aria-hidden='true'>&rarr;</div>
      </div>
    </div>
  )
}

export default BurnInHint
