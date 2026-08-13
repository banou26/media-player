// What the seek change costs, measured rather than argued.
//
// Seeking now asks the pipeline for the target's data before moving the playhead, because an element
// that demuxes into a hole is what wedges firefox's decoder. That trades latency for correctness, so
// the trade has to be a number.
//
// Measures click-to-first-frame at the new position, driving the real seek bar so the path under
// test is the one a viewer uses. Arms ALTERNATE round by round, because a machine that warms up or a
// page cache that fills would otherwise be attributed to whichever arm ran second.
//
//   FILE=/path/to.mkv node scripts/bench-seek.mjs [rounds] [--port 4560]
//
// Headful per the house rules: headless firefox will not decode H.264 here at all.
import { firefox } from 'playwright'

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? fallback : process.argv[i + 1]
}

const ROUNDS = Number(process.argv[2]) || 3
const PORT = Number(arg('port', 4560))
const SEEKS = Number(arg('seeks', 6))
const FILE = process.env.FILE
if (!FILE) { console.error('set FILE to a media file'); process.exit(1) }

const env = { ...process.env }
if (process.env.FFMPEG_LIB) env.LD_LIBRARY_PATH = `${process.env.FFMPEG_LIB}:${process.env.LD_LIBRARY_PATH ?? ''}`

const ARMS = [
  { key: 'before', budget: 0 },     // seek immediately, which is how it behaved before
  { key: 'after', budget: 500 },    // wait for the data, up to the budget
]

const median = (xs) => {
  if (!xs.length) return NaN
  const s = [...xs].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}
const p90 = (xs) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * 0.9))] : NaN)

const runArm = async (budget, seed) => {
  const browser = await firefox.launch({
    headless: false,
    args: ['--mute-audio'],
    firefoxUserPrefs: { 'media.autoplay.default': 0, 'media.autoplay.blocking_policy': 0, 'media.volume_scale': '0.0' },
    env,
  })
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage()
  const seeks = []
  let startup = NaN
  try {
    const started = Date.now()
    await page.goto(`http://localhost:${PORT}/?seekBudget=${budget}`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await page.setInputFiles('input[type=file]', FILE)
    // first decoded frame is the only honest definition of "it started"
    await page.waitForFunction(() => {
      const v = document.querySelector('video')
      if (!v) return false
      if (v.paused) void v.play().catch(() => {})
      return (v.getVideoPlaybackQuality?.().totalVideoFrames ?? 0) > 0
    }, undefined, { timeout: 120_000 })
    startup = Date.now() - started
    await page.waitForTimeout(3000)

    // reveal the chrome, then measure against the real bar
    await page.mouse.move(640, 780)
    await page.waitForTimeout(400)
    const bar = await page.$('.progress-bar')
    if (!bar) throw new Error('no .progress-bar found')

    let x = seed
    for (let i = 0; i < SEEKS; i++) {
      x = (x * 1103515245 + 12345) % 2147483648
      const fraction = 0.05 + (x / 2147483648) * 0.85

      await page.mouse.move(640, 780)
      const box = await bar.boundingBox()
      if (!box) break
      const before = await page.evaluate(() => {
        const v = document.querySelector('video')
        return { frames: v.getVideoPlaybackQuality().totalVideoFrames, t: v.currentTime }
      })

      const t0 = Date.now()
      await page.mouse.click(box.x + box.width * fraction, box.y + box.height / 2)

      // the seek is done when the picture is actually moving again at the new position, which is
      // what a viewer waits for. Frames alone can tick from the old position for a moment.
      const ok = await page
        .waitForFunction(([framesBefore, was]) => {
          const v = document.querySelector('video')
          if (!v || v.error) return false
          const moved = Math.abs(v.currentTime - was) > 1
          return moved && v.getVideoPlaybackQuality().totalVideoFrames > framesBefore + 2
        }, [before.frames, before.t], { timeout: 30_000 })
        .then(() => true, () => false)

      if (ok) seeks.push(Date.now() - t0)
      // well clear of the 250ms drag window, so every one of these counts as a discrete seek
      await page.waitForTimeout(2500)
    }
  } catch (error) {
    console.log(`    arm error: ${String(error).slice(0, 120)}`)
  } finally {
    await browser.close().catch(() => {})
  }
  return { seeks, startup }
}

const results = Object.fromEntries(ARMS.map((a) => [a.key, { seeks: [], startups: [] }]))

for (let round = 1; round <= ROUNDS; round++) {
  // alternate the order too, so a within-round drift does not always favour the same arm
  const order = round % 2 ? ARMS : [...ARMS].reverse()
  for (const armSpec of order) {
    const { seeks, startup } = await runArm(armSpec.budget, round * 7919 + armSpec.budget)
    results[armSpec.key].seeks.push(...seeks)
    if (Number.isFinite(startup)) results[armSpec.key].startups.push(startup)
    console.log(`  round ${round} ${armSpec.key.padEnd(6)} seeks=[${seeks.join(', ')}]ms startup=${startup}ms`)
  }
}

console.log('\n=== seek: click to first frame at the new position ===')
for (const { key } of ARMS) {
  const s = results[key].seeks
  console.log(`  ${key.padEnd(6)} n=${String(s.length).padStart(2)}  median ${Math.round(median(s))}ms  p90 ${Math.round(p90(s))}ms  min ${Math.min(...s)}ms  max ${Math.max(...s)}ms`)
}
const deltaMedian = Math.round(median(results.after.seeks) - median(results.before.seeks))
const deltaP90 = Math.round(p90(results.after.seeks) - p90(results.before.seeks))
console.log(`  delta  median ${deltaMedian >= 0 ? '+' : ''}${deltaMedian}ms   p90 ${deltaP90 >= 0 ? '+' : ''}${deltaP90}ms`)

console.log('\n=== startup: load to first decoded frame ===')
for (const { key } of ARMS) {
  const s = results[key].startups
  console.log(`  ${key.padEnd(6)} n=${s.length}  median ${Math.round(median(s))}ms`)
}
