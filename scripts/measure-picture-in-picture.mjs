// How many different frames a second the picture in picture window gets, with the browser window shown, behind
// another tab, minimized and off screen.
//
// Off screen is the state that needs a real compositor: Chrome restored its window, the compositor kept it minimized,
// so the page reads visible but gets no frame callbacks (niri gives such a window one a second). So this runs Chrome on
// a nested headless weston, its own socket and never the desktop's, and drives it over raw CDP. Not Playwright: it
// launches Chrome with background throttling off and keeps every page visible, so it measures nothing here.
//
//   npm run dev                                   # serves the player on 4560
//   nix shell nixpkgs#weston -c node scripts/measure-picture-in-picture.mjs [--port 4560] [--native]
//
// `--native` puts the page's own video in the window instead of the composite, as with no subtitles. Each state prints
// one line: `composite` paints and `compositeNew` different frames a second, `subtitles` changes of the subtitle
// surface, `frameCallbacks` and `raf` of the page, and `window` changes of the window's pixels in compositor
// screenshots, which saturate at `shots` a second.
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? fallback : process.argv[i + 1]
}
const PORT = Number(arg('port', 4560))
const NATIVE = process.argv.includes('--native')
const SOCKET = `measure-pip-${process.pid}`
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const scratch = mkdtempSync(join(tmpdir(), 'measure-pip-'))

// 2 minutes of a picture that changes every frame at 24 fps, with a subtitle line changing every second
const FIXTURE = fileURLToPath(new URL('../public/picture-in-picture.mkv', import.meta.url))
if (!existsSync(FIXTURE)) {
  const time = (s) => `00:${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')},000`
  const srt = join(scratch, 'lines.srt')
  writeFileSync(srt, Array.from({ length: 120 }, (_, i) => `${i + 1}\n${time(i)} --> ${time(i + 1)}\nline ${i + 1}\n`).join('\n'))
  execFileSync('ffmpeg', [
    '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=24:duration=120', '-f', 'lavfi', '-i', 'sine=duration=120',
    '-i', srt, '-map', '0', '-map', '1', '-map', '2', '-c:v', 'libx264', '-preset', 'veryfast', '-g', '48', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-c:s', 'ass', FIXTURE,
  ])
}

const weston = spawn('weston', ['--backend=headless', '--renderer=gl', '--width=1600', '--height=900', `--socket=${SOCKET}`, '--idle-time=0', '--debug'], { stdio: 'ignore' })
for (let i = 0; i < 40 && !existsSync(join(process.env.XDG_RUNTIME_DIR, SOCKET)); i++) await sleep(250)
const env = { ...process.env, WAYLAND_DISPLAY: SOCKET, DISPLAY: '' }
delete env.NIXOS_OZONE_WL
const debugPort = 9300 + Math.floor(Math.random() * 500)
const chrome = spawn(process.env.CHROME ?? 'google-chrome-stable', [
  `--user-data-dir=${join(scratch, 'profile')}`, `--remote-debugging-port=${debugPort}`, '--mute-audio', '--ozone-platform=wayland',
  '--no-first-run', '--no-default-browser-check', '--autoplay-policy=no-user-gesture-required', '--window-size=1280,800', 'about:blank',
], { stdio: 'ignore', env })
const finish = (code) => {
  chrome.kill('SIGKILL')
  weston.kill()
  setTimeout(() => { rmSync(scratch, { recursive: true, force: true }); process.exit(code) }, 500)
}
setTimeout(() => { console.error('gave up after 4 minutes'); finish(1) }, 240_000)

let version
for (let i = 0; i < 80 && !version; i++) {
  try { version = await (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).json() } catch { await sleep(250) }
}
if (!version) {
  console.error('Chrome did not start')
  finish(1)
  await new Promise(() => {})
}
const ws = new WebSocket(version.webSocketDebuggerUrl)
await new Promise((resolve) => ws.addEventListener('open', resolve, { once: true }))
let nextId = 1
const pending = new Map()
ws.addEventListener('message', (event) => {
  const message = JSON.parse(event.data)
  const call = pending.get(message.id)
  if (!call) return
  pending.delete(message.id)
  if (message.error) call.reject(new Error(JSON.stringify(message.error)))
  else call.resolve(message.result)
})
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const id = nextId++
  pending.set(id, { resolve, reject })
  ws.send(JSON.stringify({ id, method, params, sessionId }))
})
const { targetInfos } = await send('Target.getTargets')
const page = targetInfos.find((target) => target.type === 'page')
const { sessionId } = await send('Target.attachToTarget', { targetId: page.targetId, flatten: true })
const evaluate = async (expression, userGesture = false) => {
  const { result, exceptionDetails } = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture }, sessionId)
  if (exceptionDetails) throw new Error(JSON.stringify(exceptionDetails).slice(0, 400))
  return result.value
}
const until = async (expression, what, ms = 60_000) => {
  const end = Date.now() + ms
  while (Date.now() < end) {
    try { if (await evaluate(expression)) return } catch {}
    await sleep(250)
  }
  throw new Error(`timed out waiting for ${what}`)
}

// Counted in the page by a 60 Hz timer, which Chrome keeps running in every state measured here.
const counters = `(() => {
  const m = window.__measure = { paints: 0, composite: null, compositeNew: 0, subtitles: 0, frameCallbacks: 0, raf: 0 }
  const capture = HTMLCanvasElement.prototype.captureStream
  HTMLCanvasElement.prototype.captureStream = function (...args) { m.composite = this; return capture.apply(this, args) }
  const drawImage = CanvasRenderingContext2D.prototype.drawImage
  CanvasRenderingContext2D.prototype.drawImage = function (source, ...rest) {
    if (this.canvas === m.composite && source instanceof HTMLVideoElement) m.paints++
    return drawImage.call(this, source, ...rest)
  }
  const raf = () => { m.raf++; requestAnimationFrame(raf) }
  requestAnimationFrame(raf)
  const hasher = (width, height) => {
    const context = Object.assign(document.createElement('canvas'), { width, height }).getContext('2d', { willReadFrequently: true })
    return (source) => {
      context.clearRect(0, 0, width, height)
      drawImage.call(context, source, 0, 0, width, height)
      const data = context.getImageData(0, 0, width, height).data
      let hash = 0
      for (let i = 0; i < data.length; i += 4) hash = (hash * 31 + data[i] + data[i + 1] * 7 + data[i + 3] * 13) | 0
      return hash
    }
  }
  const small = hasher(64, 36), large = hasher(480, 270)
  const last = {}
  const changed = (key, hash) => { const was = last[key]; last[key] = hash; return hash !== was }
  setInterval(() => {
    const surface = document.querySelector('.subtitles canvas')
    if (m.composite && changed('composite', small(m.composite))) m.compositeNew++
    if (surface?.width && changed('subtitles', large(surface))) m.subtitles++
  }, 1000 / 60)
})()`
await send('Page.enable', {}, sessionId)
await send('Page.addScriptToEvaluateOnNewDocument', { source: counters }, sessionId)
await send('Page.navigate', { url: `http://localhost:${PORT}/?src=/picture-in-picture.mkv` }, sessionId)

const video = `[...document.querySelectorAll('video')].find((v) => !v.srcObject)`
/** Compositor screenshots for `ms`, then how often the pixels below weston's panel changed. */
const windowChanges = (ms) => {
  const dir = mkdtempSync(join(scratch, 'shots-'))
  const start = Date.now()
  const shots = []
  while (Date.now() - start < ms) {
    spawnSync('weston-screenshooter', [], { cwd: dir, env: { ...env, HOME: dir, XDG_PICTURES_DIR: dir } })
    // named by the second, so two in one second would share a name
    for (const name of readdirSync(dir)) {
      if (!name.startsWith('wayland-screenshot')) continue
      shots.push(`${String(shots.length).padStart(4, '0')}.png`)
      renameSync(join(dir, name), join(dir, shots.at(-1)))
    }
  }
  const seconds = (Date.now() - start) / 1000
  let changes = 0
  let last
  for (const shot of shots) {
    const hash = spawnSync('ffmpeg', ['-v', 'error', '-i', join(dir, shot), '-vf', 'crop=in_w:in_h-40:0:40', '-f', 'md5', '-'], { encoding: 'utf8' }).stdout
    if (last !== undefined && hash !== last) changes++
    last = hash
  }
  rmSync(dir, { recursive: true, force: true })
  return { window: Math.round((changes / seconds) * 10) / 10, shots: Math.round((shots.length / seconds) * 10) / 10 }
}
const sample = () => evaluate(`(() => {
  const m = window.__measure
  return { at: performance.now(), visibility: document.visibilityState, paints: m.paints, compositeNew: m.compositeNew, subtitles: m.subtitles, frameCallbacks: m.frameCallbacks, raf: m.raf }
})()`)
const measure = async (state) => {
  await sleep(2500)
  const before = await sample()
  const shots = windowChanges(6000)
  const after = await sample()
  const seconds = (after.at - before.at) / 1000
  const rate = (key) => Math.round(((after[key] - before[key]) / seconds) * 10) / 10
  console.log(JSON.stringify({
    state, visibility: after.visibility, composite: rate('paints'), compositeNew: rate('compositeNew'), subtitles: rate('subtitles'),
    frameCallbacks: rate('frameCallbacks'), raf: rate('raf'), ...shots,
  }))
}

try {
  await until(`(${video})?.currentTime > 1 && !(${video}).paused`, 'playback')
  await evaluate(`(() => {
    const v = ${video}
    const tick = () => { window.__measure.frameCallbacks++; v.requestVideoFrameCallback(tick) }
    v.requestVideoFrameCallback(tick)
  })()`)
  if (NATIVE) await evaluate(`(${video}).requestPictureInPicture().then(() => true)`, true)
  else await evaluate(`document.querySelector('button.picture-in-picture').click()`, true)
  await until('!!document.pictureInPictureElement', 'the window', 10_000)
  const { windowId } = await send('Browser.getWindowForTarget', { targetId: page.targetId })

  await measure('shown')
  const tab = await send('Target.createTarget', { url: 'about:blank' })
  await measure('another tab in front')
  await send('Target.closeTarget', { targetId: tab.targetId })
  await send('Target.activateTarget', { targetId: page.targetId })
  await send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'minimized' } })
  await measure('minimized')
  await send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } })
  await measure('off screen, page reads visible')
  finish(0)
} catch (error) {
  console.error(String(error))
  finish(1)
}
