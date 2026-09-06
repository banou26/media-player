// A real <video> in another document, driven through mediaPlayer and nothing else.
//
// remote.test.ts proves the protocol over a port in one realm; what only this can show is the
// default topology: a player document serving `window.parent` and an embedder pointing
// `mediaPlayer` at an iframe, with the browser's own message channel and origins between them.
import { afterEach, describe, expect, it } from 'vitest'

import { mediaPlayer } from './index'

const FIXTURE = '/test-video.mp4'
const available = async () => (await fetch(FIXTURE, { method: 'HEAD' })).ok

// The player's document: a bare element served to whoever frames it. srcdoc inherits this origin,
// so the module import resolves against the same dev server the test runs under.
const PLAYER_DOCUMENT = (src: string) => `<!doctype html><meta charset="utf-8">
<video playsinline muted src="${src}"></video>
<script type="module">
  import { exposePlayer } from '/src/lib/remote/index.ts'
  exposePlayer(document.querySelector('video'))
</script>`

const frames: HTMLIFrameElement[] = []
afterEach(() => { for (const frame of frames.splice(0)) frame.remove() })

const mount = (): HTMLIFrameElement => {
  const frame = document.createElement('iframe')
  frame.name = 'player'
  frame.style.cssText = 'width: 320px; height: 180px;'
  frame.srcdoc = PLAYER_DOCUMENT(new URL(FIXTURE, location.origin).toString())
  document.body.append(frame)
  frames.push(frame)
  return frame
}

const until = async (read: () => boolean, timeout = 15_000) => {
  const started = Date.now()
  while (!read()) {
    if (Date.now() - started > timeout) throw new Error('timed out')
    await new Promise(resolve => setTimeout(resolve, 50))
  }
}

describe('a player in another document', () => {
  it('is read, moved and heard through mediaPlayer alone', async () => {
    if (!await available()) { console.warn('skipped: run `node scripts/fixture.mjs`'); return }
    const player = mediaPlayer(mount(), { origin: location.origin })
    await player.ready
    // metadata arrives as an event from the far side, so a duration here means the mirror is live
    await until(() => player.duration > 0)
    expect(player.duration).toBeGreaterThan(4)
    expect(player.paused).toBe(true)

    await player.play()
    await until(() => !player.paused && player.currentTime > 0.2)

    // Waited on the far side's OWN events, not on the mirror: a write answers from the mirror at
    // once, which is right for a seek bar reading itself back and wrong for a test asking whether
    // the far element did anything.
    const heard = (name: string) => new Promise<void>(resolve => player.addEventListener(name, () => resolve(), { once: true }))
    const paused = heard('pause')
    player.pause()
    await paused
    const at = player.currentTime
    const seeked = heard('seeked')
    player.currentTime = at + 2
    await seeked
    expect(Math.abs(player.currentTime - (at + 2))).toBeLessThan(0.5)

    // and the element itself agrees, read from inside the frame
    const inside = frames[0]!.contentDocument!.querySelector('video')!
    expect(inside.paused).toBe(true)
    expect(Math.abs(inside.currentTime - (at + 2))).toBeLessThan(0.5)
    player.destroy()
  })

  // The isolation story itself: a SIBLING frame with a handle to the player's window asks for it and
  // is never answered, while the framing page is. Both halves in one test, so a rig that could not
  // hear the parent either would fail rather than pass on silence.
  it('only the window that frames the player is served; a sibling asking is ignored', async () => {
    if (!await available()) return
    const playerFrame = mount()
    const parent = mediaPlayer(playerFrame, { origin: location.origin })
    await parent.ready
    expect(parent.readyState).toBeGreaterThanOrEqual(0)

    const sibling = document.createElement('iframe')
    // the player frame by NAME: the test itself runs inside vitest's own frame, whose frames[0] is
    // not necessarily the one mounted above; and every way the script can fail is reported, so a
    // sibling that never asked is not mistaken for one that was refused
    sibling.srcdoc = `<!doctype html><meta charset="utf-8"><script type="module">
      const report = verdict => parent.postMessage({ sibling: verdict }, '*')
      addEventListener('error', event => report('error: ' + event.message))
      addEventListener('unhandledrejection', event => report('error: ' + String(event.reason)))
      const { mediaPlayer } = await import('/src/lib/remote/index.ts')
      const target = window.parent.frames.player
      if (!target) { report('error: no player frame'); throw new Error('no player frame') }
      // no origin: a srcdoc document's own location.origin is the string "null", which the api
      // refuses, and the sender check is the thing under test here anyway
      const player = mediaPlayer(target, { signal: AbortSignal.timeout(2500) })
      player.ready.then(() => report('answered'), () => report('ignored'))
    </script>`
    frames.push(sibling)
    const verdict = new Promise<string>(resolve => {
      window.addEventListener('message', function onMessage(event) {
        if (event.source !== sibling.contentWindow || !event.data?.sibling) return
        window.removeEventListener('message', onMessage)
        resolve(event.data.sibling)
      })
    })
    document.body.append(sibling)
    expect(await verdict).toBe('ignored')
    parent.destroy()
  })

  // The case a MessagePort cannot produce: a player document that RELOADS sends no close, so the old
  // connection is superseded rather than torn down. A mirror has to follow the new document, and a
  // call left in flight on the old one has to settle rather than hang for the life of the page.
  it('a player document that reloads is followed, and a call left on the old one settles', async () => {
    if (!await available()) return
    const frame = mount()
    const player = mediaPlayer(frame, { origin: location.origin })
    await player.ready
    await until(() => player.duration > 0)

    // a play that will never be answered: the document goes away mid-call
    const stranded = player.play()
    stranded.catch(() => {})
    frame.contentWindow!.location.reload()

    const settled = await Promise.race([
      stranded.then(() => 'resolved', () => 'settled'),
      new Promise(resolve => setTimeout(() => resolve('still hanging'), 8_000)),
    ])
    expect(settled, 'the call did not hang past the reload').not.toBe('still hanging')

    // and the mirror is on the new document, which reports its own duration again
    await until(() => player.duration > 0, 20_000)
    expect(player.duration).toBeGreaterThan(4)
    player.destroy()
  })

  it('a frame on a different claimed origin is never heard', async () => {
    if (!await available()) return
    // the same frame, but the embedder claims the far side is somewhere else: nothing it says is
    // admitted, so the mirror never becomes ready
    const player = mediaPlayer(mount(), { origin: 'https://elsewhere.example' })
    const answered = await Promise.race([player.ready.then(() => true), new Promise<boolean>(resolve => setTimeout(() => resolve(false), 2_000))])
    expect(answered).toBe(false)
    player.destroy()
  })
})
