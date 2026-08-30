// Test media, synthesized rather than committed. Nothing here is anyone's content, so there is no
// copyright question and no multi-megabyte blob in git history.
//
// One file is enough for what this repo tests. libav-wasm owns the container and codec matrix; what
// media-player has to prove is that its own pipeline runs end to end on something real: metadata,
// a first segment, a subtitle track and an audio track discovered and named.

import { execFile } from 'node:child_process'
import { mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)

export const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url))
export const FIXTURE = 'test-video.mkv'
export const FIXTURE_PATH = PUBLIC_DIR + FIXTURE
/**
 * A second file the browser can play by itself.
 *
 * matroska is right for the local arm precisely BECAUSE Chrome cannot play it: that is what makes
 * libav's remux worth doing. The remote arm is the opposite case, where the far document plays the
 * file with its own element and this player never sees a byte, so that fixture has to be a container
 * the browser actually supports.
 */
export const NATIVE_FIXTURE = 'test-video.mp4'
export const NATIVE_FIXTURE_PATH = PUBLIC_DIR + NATIVE_FIXTURE

const exists = async (path) => {
  try { return (await stat(path)).size > 0 } catch { return false }
}

/**
 * matroska with h264 video, aac audio and one subtitle track.
 *
 * The subtitle track is the point of using matroska rather than mp4: it is what exercises the ASS
 * path through jassub, and a file without one leaves the track menu untested.
 */
export const ensureNativeFixture = async () => {
  if (await exists(NATIVE_FIXTURE_PATH)) return NATIVE_FIXTURE_PATH
  await mkdir(PUBLIC_DIR, { recursive: true })
  await run('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=24:duration=5',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=5',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-g', '24',
    '-c:a', 'aac',
    '-movflags', '+faststart',
    NATIVE_FIXTURE_PATH,
  ])
  return NATIVE_FIXTURE_PATH
}

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

export const SCALE_FIXTURE = 'subtitle-scale.mkv'
export const SCALE_FIXTURE_PATH = PUBLIC_DIR + SCALE_FIXTURE

/**
 * 1080p video carrying an ASS track authored for 720p, which is what most releases ship.
 *
 * The header is the shape that matters: `PlayResY` smaller than the video, so libass has to scale
 * the script up, and one style the events name rather than inherit. Eight capital H's, because a
 * cap-height box is the one thing worth measuring about a glyph.
 *
 * Liberation Sans, unbolded, on purpose: it is the face jassub's own `default.woff2` carries, so the
 * browser and a reference render through ffmpeg's libass use the SAME outlines and the numbers can be
 * compared exactly rather than approximately.
 */
export const SCALE_HEADER = [
  '[Script Info]',
  'ScriptType: v4.00+',
  'WrapStyle: 0',
  'PlayResX: 1280',
  'PlayResY: 720',
  'ScaledBorderAndShadow: yes',
  '',
  '[V4+ Styles]',
  'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
  'Style: Default,Liberation Sans,45,&H00FFFFFF,&H000000FF,&H00020713,&H00000000,0,0,0,0,100,100,0,0,1,1.7,0,2,10,10,15,1',
  '',
  '[Events]',
  'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  'Dialogue: 0,0:00:00.00,0:00:20.00,Default,,0,0,0,,HHHHHHHH',
  '',
].join('\n')

export const ensureScaleFixture = async () => {
  if (await exists(SCALE_FIXTURE_PATH)) return SCALE_FIXTURE_PATH
  await mkdir(PUBLIC_DIR, { recursive: true })

  const subs = SCALE_FIXTURE_PATH + '.ass'
  await writeFile(subs, SCALE_HEADER)
  await run('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'color=c=0x101010:size=1920x1080:rate=24:duration=6',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6',
    '-i', subs,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-g', '24',
    '-c:a', 'aac',
    '-c:s', 'copy',
    '-map', '0:v', '-map', '1:a', '-map', '2:s',
    '-metadata:s:s:0', 'language=eng',
    SCALE_FIXTURE_PATH,
  ])
  await rm(subs, { force: true })
  return SCALE_FIXTURE_PATH
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const make of [ensureFixture, ensureNativeFixture, ensureScaleFixture]) {
    const path = await make()
    const { size } = await stat(path)
    console.log(`fixture ready: ${path} (${size} bytes)`)
  }
}
