import type { TimeRangesLike } from '../../../src/lib/react/media'

import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'

import MediaPlayer from '../../../src/lib/react/video-player'
import { createFakeRemoteMedia } from '../../../src/lib/react/remote-media.fixture'

/**
 * A media the player does not own shows its buffered time on the seekbar.
 *
 * The seekbar used to draw only byte ranges mapped through the keyframe index, and a remote media has
 * neither, so a Crunchyroll episode buffering fine in its own frame showed an empty bar here while
 * video.js's store already held the range.
 */
const DURATION = 100

const sized = () => {
  const container = document.createElement('div')
  container.style.cssText = 'width: 960px; height: 540px;'
  document.body.append(container)
  return { container }
}

const timeRanges = (pairs: [number, number][]): TimeRangesLike => ({
  length: pairs.length,
  start: (i) => pairs[i]![0],
  end: (i) => pairs[i]![1],
})

const parts = (root: ParentNode) =>
  [...root.querySelectorAll<HTMLElement>('.loaded-part')]
    .map(({ style }) => `${style.marginLeft} ${style.transform}`)

describe('the seekbar over a remote media', () => {
  it('draws the media\'s buffered ranges and follows them on progress', async () => {
    const media = createFakeRemoteMedia({ duration: DURATION })
    media.buffered = timeRanges([[0, 25]])

    const screen = await render(<MediaPlayer media={media} />, sized())

    await expect.poll(() => parts(screen.container)).toEqual(['0% scaleX(0.25)'])

    media.buffered = timeRanges([[0, 25], [50, 60]])
    media.dispatchEvent(new Event('progress'))

    await expect.poll(() => parts(screen.container)).toEqual(['0% scaleX(0.25)', '50% scaleX(0.1)'])
  })
})
