import { describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'

// in order: the first leaves the browser's pointer on a box the second still has, as an earlier file would
describe('the browser pointer a test starts with', () => {
  const box = document.createElement('div')
  box.style.cssText = 'position: fixed; left: 400px; top: 300px; width: 200px; height: 200px;'

  it('is wherever the test puts it', async () => {
    document.body.append(box)
    await userEvent.hover(box)
    expect(box.matches(':hover')).toBe(true)
  })

  it('is no longer where the last test left it', () => {
    expect(box.isConnected).toBe(true)
    expect(box.matches(':hover')).toBe(false)
  })
})
