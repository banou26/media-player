import { useEffect, useMemo, useRef, useState } from 'react'
import { css } from '@emotion/react'

import { fonts } from '../../utils/fonts'
import { classifyChapters } from '../../utils/chapters'
import { usePlayer } from '../player'

/**
 * How far AHEAD of the chapter the offer appears, in seconds.
 *
 * It arrives just before the opening rather than during it, so the button is already on screen and
 * readable at the moment the theme starts rather than turning up over it. Waiting until the boundary
 * is crossed puts it a beat late, which is what this exists to fix.
 */
const OFFER_LEAD_S = 1
/**
 * How long the offer then stays on screen.
 *
 * Six, so that with the second of lead above about five of them fall inside the opening itself.
 *
 * Short on purpose. The button is a suggestion drawn from a chapter title, and a title can be wrong,
 * so the cost of a mistake is capped at a few seconds of a button nobody wanted rather than a jump
 * out of the episode. Nothing is ever skipped without a press.
 */
const OFFER_MS = 6_000
/** A jump back by more than this is a seek rather than playback, and re-opens the offer. */
const SEEK_BACK_S = 1

const LABELS = { opening: 'Skip Opening', ending: 'Skip Ending' } as const

const style = css`
  position: absolute;
  inset: 0;
  z-index: 2;
  pointer-events: none;

  button {
    position: absolute;
    /* clear of the control bar, which is 6 to 8px of padding plus a row of 18 to 28px controls and
       the seekbar above them */
    bottom: calc(7 * var(--mp-unit));
    right: calc(2.4 * var(--mp-unit));

    /* the one thing in this layer that can be pressed */
    pointer-events: auto;
    cursor: pointer;

    ${fonts.bMedium.bold}
    color: #fff;
    padding: calc(1 * var(--mp-unit)) calc(1.8 * var(--mp-unit));
    border: 1px solid rgba(255, 255, 255, .55);
    border-radius: calc(.4 * var(--mp-unit));
    background-color: rgba(20, 20, 22, .8);
    box-shadow: 0 0 calc(1 * var(--mp-unit)) rgba(0, 0, 0, .5);

    opacity: 0;
    transform: translateY(calc(.6 * var(--mp-unit)));
    /* visibility as well as opacity, so a faded button cannot be hovered or pressed */
    visibility: hidden;
    transition: opacity .18s ease, transform .18s ease, visibility .18s;

    &:hover, &:focus-visible {
      background-color: rgba(255, 255, 255, .92);
      color: #111;
      border-color: transparent;
    }
  }

  &.show button {
    opacity: 1;
    transform: none;
    visibility: visible;
  }

  @media (pointer: coarse) {
    button {
      /* a finger needs a target, and the control row below is already 44px */
      min-height: 44px;
      bottom: calc(9 * var(--mp-unit));
    }
  }
`

/**
 * Offers to jump past an opening or ending, when the chapter under the playhead looks like one.
 *
 * The whole feature is this button plus `classifyChapters`, and it is deliberately the weaker half
 * of the pair: the classifier reads titles written by whoever muxed the file, so it is sometimes
 * going to be wrong. Making the offer expire, and never acting on its own, is what makes being wrong
 * cheap. See the classifier for what it matches and the sample it was measured against.
 */
export const SkipChapter = () => {
  const chapters = usePlayer((state) => state.chapters)
  const currentTime = usePlayer((state) => state.currentTime)
  const requestSeek = usePlayer((state) => state.requestSeek)
  const player = usePlayer()

  const kinds = useMemo(() => classifyChapters(chapters), [chapters])

  /**
   * The chapter worth offering to skip, from a second before it starts until it ends.
   *
   * The window opens EARLY rather than on the boundary, which is the whole difference between the
   * button being on screen when the theme arrives and turning up on top of it.
   */
  const skippable = useMemo(() => {
    if (typeof currentTime !== 'number') return undefined
    // only skippable chapters are searched: a second before one starts the playhead is still inside
    // its neighbour, so looking for "the chapter containing the playhead" would find the wrong one
    const index = chapters.findIndex((chapter, i) =>
      kinds[i] !== undefined && chapter.start - OFFER_LEAD_S <= currentTime && currentTime < chapter.end)
    const kind = index >= 0 ? kinds[index] : undefined
    return kind ? { kind, end: chapters[index]!.end } : undefined
  }, [chapters, kinds, currentTime])

  /*
   * A backwards jump re-opens the offer.
   *
   * Without it, seeking back to watch an opening again leaves no way to skip it a second time: the
   * chapter has not changed, so the effect below would not re-run and the offer would stay closed.
   */
  const lastTime = useRef(0)
  const [seekEpoch, setSeekEpoch] = useState(0)
  useEffect(() => {
    const time = typeof currentTime === 'number' ? currentTime : 0
    const previous = lastTime.current
    lastTime.current = time
    if (time < previous - SEEK_BACK_S) setSeekEpoch((n) => n + 1)
  }, [currentTime])

  const [show, setShow] = useState(false)
  // keyed on which chapter it is, so playing through one offer does not re-open it
  const at = skippable ? `${skippable.kind}@${skippable.end}` : ''
  useEffect(() => {
    if (!at) {
      setShow(false)
      return
    }
    setShow(true)
    const close = setTimeout(() => setShow(false), OFFER_MS)
    return () => clearTimeout(close)
  }, [at, seekEpoch])

  // the offer closes the moment the playhead leaves, however it left
  useEffect(() => { if (!skippable) setShow(false) }, [skippable])

  if (!skippable) return null

  const skip = () => {
    setShow(false)
    // the chrome's own seek, which puts the data in place first: landing on unbuffered ground is
    // what wedges firefox's decoder, and the end of an opening is ground nothing has read yet
    if (requestSeek) requestSeek(skippable.end)
    else player.seek(skippable.end)
  }

  return (
    <div css={style} className={show ? 'show' : ''}>
      <button type='button' className='skip-chapter' onClick={skip}>
        {LABELS[skippable.kind]}
      </button>
    </div>
  )
}

export default SkipChapter
