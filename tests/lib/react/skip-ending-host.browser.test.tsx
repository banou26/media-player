import { afterEach, describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'

import MediaPlayer from '../../../src/lib/react/video-player'
import { mediaPlayer } from '../../../src/lib/remote/index'
import { createFakeRemoteMedia } from './remote-media.fixture'

/**
 * The offer of the last ending, taken away by a mirror whose page fills that corner itself.
 *
 * The other half of the race: the page draws in the corner once the mirror reads false, so the button
 * must be gone by then.
 */
const DURATION = 1440
const CHAPTERS = [
  { start: 0, end: 90, title: 'Opening' },
  { start: 90, end: 700, title: 'Part A' },
  { start: 700, end: 790, title: 'Ending' },
  { start: 790, end: 1320, title: 'Part B' },
  { start: 1320, end: 1410, title: 'Ending' },
  { start: 1410, end: 1440, title: 'Part C' },
]

const MOUNTED = 'skip-ending-host-case'
const skipButton = (root: ParentNode) => root.querySelector<HTMLElement>('button.skip-chapter')
const offer = (root: ParentNode) => {
  const button = skipButton(root)
  return button && getComputedStyle(button).visibility === 'visible' ? button.textContent : undefined
}

const serve = async () => {
  const container = document.createElement('div')
  container.className = MOUNTED
  container.style.cssText = 'width: 960px; height: 540px;'
  document.body.append(container)
  const { port1, port2 } = new MessageChannel()
  const media = createFakeRemoteMedia({ duration: DURATION })
  await render(<MediaPlayer media={media} chapters={CHAPTERS} expose={{ transport: port1 }} />, { container })
  const mirror = mediaPlayer(port2)
  await mirror.ready
  await expect.poll(() => mirror.chapters).toEqual(CHAPTERS)
  return { container, media, mirror }
}

afterEach(() => { for (const stale of document.querySelectorAll(`.${MOUNTED}`)) stale.remove() })

describe('a mirror that takes the last ending out of the skip offer', () => {
  it('finds the button gone by the time it reads false, and has it back on asking', async () => {
    const { container, media, mirror } = await serve()
    try {
      media.advanceTo(1330)
      await expect.poll(() => offer(container), { timeout: 5_000 }).toBe('Skip Ending')

      const heard: [boolean, boolean][] = []
      mirror.addEventListener('chapterschange', () => heard.push([mirror.endingOffered, !!skipButton(container)]))
      mirror.endingOffered = false
      await expect.poll(() => heard, { timeout: 5_000 }).toEqual([[false, false]])

      media.advanceTo(1340)
      await new Promise((resolve) => setTimeout(resolve, 300))
      expect(skipButton(container)).toBeNull()

      mirror.endingOffered = true
      await expect.poll(() => offer(container), { timeout: 5_000 }).toBe('Skip Ending')
      expect(mirror.endingOffered).toBe(true)
    } finally {
      mirror.destroy()
    }
  })

  it('keeps the opening and an earlier ending on offer', async () => {
    const { container, media, mirror } = await serve()
    try {
      const said = new Promise((resolve) => mirror.addEventListener('chapterschange', resolve, { once: true }))
      mirror.endingOffered = false
      await said
      media.advanceTo(20)
      await expect.poll(() => offer(container), { timeout: 5_000 }).toBe('Skip Opening')
      media.advanceTo(710)
      await expect.poll(() => offer(container), { timeout: 5_000 }).toBe('Skip Ending')
      media.advanceTo(1330)
      await expect.poll(() => skipButton(container), { timeout: 5_000 }).toBeNull()
    } finally {
      mirror.destroy()
    }
  })
})
