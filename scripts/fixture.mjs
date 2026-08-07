// Test media, synthesized rather than committed. Nothing here is anyone's content, so there is no
// copyright question and no multi-megabyte blob in git history.
//
// One file is enough for what this repo tests. libav-wasm owns the container and codec matrix; what
// media-player has to prove is that its own pipeline runs end to end on something real: metadata,
// a first segment, a subtitle track and an audio track discovered and named.

import { execFile } from 'node:child_process'
import { mkdir, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)

export const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url))
export const FIXTURE = 'test-video.mkv'
export const FIXTURE_PATH = PUBLIC_DIR + FIXTURE

const exists = async (path) => {
  try { return (await stat(path)).size > 0 } catch { return false }
}

/**
 * matroska with h264 video, aac audio and one subtitle track.
 *
 * The subtitle track is the point of using matroska rather than mp4: it is what exercises the ASS
 * path through jassub, and a file without one leaves the track menu untested.
 */
export const ensureFixture = async () => {
  if (await exists(FIXTURE_PATH)) return FIXTURE_PATH
  await mkdir(PUBLIC_DIR, { recursive: true })

  const subs = FIXTURE_PATH + '.srt'
  await run('sh', ['-c', `printf '1\\n00:00:00,500 --> 00:00:04,000\\nfixture subtitle\\n\\n' > ${JSON.stringify(subs)}`])
  await run('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=24:duration=5',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=5',
    '-i', subs,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-g', '24',
    '-c:a', 'aac',
    '-c:s', 'ass',
    '-map', '0:v', '-map', '1:a', '-map', '2:s',
    '-metadata:s:s:0', 'language=eng',
    FIXTURE_PATH,
  ])
  await run('sh', ['-c', `rm -f ${JSON.stringify(subs)}`])
  return FIXTURE_PATH
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const path = await ensureFixture()
  const { size } = await stat(path)
  console.log(`fixture ready: ${path} (${size} bytes)`)
}
