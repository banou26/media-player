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

export const STALL_FIXTURE = 'stall-source.mp4'
export const STALL_FIXTURE_PATH = PUBLIC_DIR + STALL_FIXTURE

/**
 * A FRAGMENTED mp4, which is the only thing a SourceBuffer will take.
 *
 * `test-video.mp4` is a plain progressive file with one `moov` and no `moof`, because its job is to
 * be played by the browser directly. This one exists to be appended by hand so a test can build an
 * element that is UN-PAUSED and presenting nothing, which is the buffering stall the subtitle
 * repaint has to survive and which no player-level test can produce on demand.
 */
export const ensureStallFixture = async () => {
  if (await exists(STALL_FIXTURE_PATH)) return STALL_FIXTURE_PATH
  await mkdir(PUBLIC_DIR, { recursive: true })
  await run('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=24:duration=4',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-profile:v', 'baseline', '-level', '3.0', '-g', '24',
    '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
    STALL_FIXTURE_PATH,
  ])
  return STALL_FIXTURE_PATH
}

export const SEEK_FIXTURE = 'subtitle-seek.mkv'
export const SEEK_FIXTURE_PATH = PUBLIC_DIR + SEEK_FIXTURE

/**
 * A line that COVERS ONLY THE FIRST HALF of the video, which no other fixture does.
 *
 * The scale and header tracks run to 20 seconds over a 6 second picture, so every moment of those
 * files has a line on screen and no seek within them can ever change what is drawn. That makes them
 * useless for the thing this one exists for: proving that scrubbing while PAUSED repaints, which
 * jassub 2 does not do by itself because it draws only from presented frames.
 *
 * Deliberately the same header as the scale fixture apart from the timing, so a failure here is
 * about the seek and not about anything libass had to resolve differently.
 */
export const SEEK_HEADER = SCALE_HEADER.replace(
  'Dialogue: 0,0:00:00.00,0:00:20.00,Default,,0,0,0,,HHHHHHHH',
  'Dialogue: 0,0:00:00.00,0:00:02.50,Default,,0,0,0,,HHHHHHHH',
)

export const ensureSeekFixture = async () => {
  if (await exists(SEEK_FIXTURE_PATH)) return SEEK_FIXTURE_PATH
  await mkdir(PUBLIC_DIR, { recursive: true })

  const subs = SEEK_FIXTURE_PATH + '.ass'
  await writeFile(subs, SEEK_HEADER)
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
    SEEK_FIXTURE_PATH,
  ])
  await rm(subs, { force: true })
  return SEEK_FIXTURE_PATH
}

export const HEADER_FIXTURE = 'subtitle-header.mkv'
export const HEADER_FIXTURE_PATH = PUBLIC_DIR + HEADER_FIXTURE

/**
 * A header whose every field has to reach libass untouched, in one frame.
 *
 * Two styles, neither called Default, so an event that resolved its style by anything other than the
 * right index would land on the wrong one and be obvious. Both carry a fat Outline in a bright colour
 * so the border is measurable rather than lost against the picture, and the lower line adds a blur.
 * That gives two independent probes of the two fields the player used to rewrite:
 *
 *   ScaledBorderAndShadow  scales Outline and Shadow with the script, so it moves the plain line's box
 *   LayoutResX/Y           scales blur radii, so it moves the GROWTH from the plain box to the blurred one
 *
 * The two lines sit at opposite alignments so a single frame carries both and each can be measured in
 * its own half of the canvas.
 */
export const HEADER_HEADER = [
  '[Script Info]',
  'ScriptType: v4.00+',
  'WrapStyle: 0',
  'PlayResX: 1280',
  'PlayResY: 720',
  'LayoutResX: 1280',
  'LayoutResY: 720',
  'ScaledBorderAndShadow: yes',
  '',
  '[V4+ Styles]',
  'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
  'Style: Plain,Liberation Sans,45,&H00FFFFFF,&H000000FF,&H0000FFFF,&H00000000,0,0,0,0,100,100,0,0,1,6,0,8,10,10,40,1',
  'Style: Blurred,Liberation Sans,45,&H00FFFFFF,&H000000FF,&H0000FFFF,&H00000000,0,0,0,0,100,100,0,0,1,6,0,2,10,10,40,1',
  '',
  '[Events]',
  'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  'Dialogue: 0,0:00:00.00,0:00:20.00,Plain,,0,0,0,,HHHHHHHH',
  'Dialogue: 0,0:00:00.00,0:00:20.00,Blurred,,0,0,0,,{\\blur6}HHHHHHHH',
  '',
].join('\n')

/**
 * Twenty seconds with a keyframe every two, which is what makes generation ORDER observable.
 *
 * The other fixtures are a few seconds long and yield one or two thumbnail slots, so any order is
 * the same order. Nine slots is enough that a preview jumped to the front lands nowhere near where
 * a start-to-end walk would have put it. Tiny and flat-coloured because the picture is never looked
 * at here, only the sequence the slots come back in.
 */
export const THUMBNAIL_FIXTURE = 'thumbnail-order.mkv'
export const THUMBNAIL_FIXTURE_PATH = PUBLIC_DIR + THUMBNAIL_FIXTURE
/** Seconds between keyframes, which the generator is then asked to match with `interval`. */
export const THUMBNAIL_KEYFRAME_INTERVAL = 2
export const THUMBNAIL_DURATION = 20

export const ensureThumbnailFixture = async () => {
  if (await exists(THUMBNAIL_FIXTURE_PATH)) return THUMBNAIL_FIXTURE_PATH
  await mkdir(PUBLIC_DIR, { recursive: true })
  await run('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-f', 'lavfi', '-i', `testsrc=size=160x90:rate=24:duration=${THUMBNAIL_DURATION}`,
    '-f', 'lavfi', '-i', `sine=frequency=440:duration=${THUMBNAIL_DURATION}`,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
    // -g alone is a ceiling the encoder may undercut, so the cadence is forced outright
    '-g', String(24 * THUMBNAIL_KEYFRAME_INTERVAL),
    '-force_key_frames', `expr:gte(t,n_forced*${THUMBNAIL_KEYFRAME_INTERVAL})`,
    '-c:a', 'aac',
    THUMBNAIL_FIXTURE_PATH,
  ])
  return THUMBNAIL_FIXTURE_PATH
}

/**
 * Twenty seconds carrying three chapters of deliberately UNEQUAL length.
 *
 * Equal chapters would let a layout bug that divides the bar evenly pass, which is the whole thing
 * the segmented seekbar has to get right. 4s, 8s and 8s against a 20s picture are 20%, 40% and 40%.
 *
 * The chapters also stop at 20.0 while the file runs to 20.023, which is not a mistake: libav
 * reports exactly that for this file, so the tail beyond the last chapter is real and the bar has to
 * survive chapters that do not tile the whole duration.
 */
export const CHAPTER_FIXTURE = 'chapters.mkv'
export const CHAPTER_FIXTURE_PATH = PUBLIC_DIR + CHAPTER_FIXTURE
/** What libav reports back for this file, in seconds, and what the tests assert against. */
export const CHAPTERS = [
  { start: 0, end: 4, title: 'Intro' },
  { start: 4, end: 12, title: 'The Middle Bit' },
  { start: 12, end: 20, title: 'Outro' },
]

export const ensureChapterFixture = async () => {
  if (await exists(CHAPTER_FIXTURE_PATH)) return CHAPTER_FIXTURE_PATH
  await mkdir(PUBLIC_DIR, { recursive: true })

  // ffmpeg takes chapters only as an FFMETADATA input mapped over the output, never as a flag
  const meta = CHAPTER_FIXTURE_PATH + '.ffmeta'
  await writeFile(meta, [
    ';FFMETADATA1',
    ...CHAPTERS.flatMap(({ start, end, title }) => [
      '[CHAPTER]',
      'TIMEBASE=1/1000',
      `START=${start * 1000}`,
      `END=${end * 1000}`,
      `title=${title}`,
    ]),
  ].join('\n') + '\n')

  await run('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'testsrc=size=160x90:rate=24:duration=20',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=20',
    '-i', meta,
    '-map_metadata', '2',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-g', '48',
    '-c:a', 'aac',
    CHAPTER_FIXTURE_PATH,
  ])
  await rm(meta, { force: true })
  return CHAPTER_FIXTURE_PATH
}

export const ensureHeaderFixture = async () => {
  if (await exists(HEADER_FIXTURE_PATH)) return HEADER_FIXTURE_PATH
  await mkdir(PUBLIC_DIR, { recursive: true })

  const subs = HEADER_FIXTURE_PATH + '.ass'
  await writeFile(subs, HEADER_HEADER)
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
    HEADER_FIXTURE_PATH,
  ])
  await rm(subs, { force: true })
  return HEADER_FIXTURE_PATH
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const make of [ensureFixture, ensureNativeFixture, ensureScaleFixture, ensureSeekFixture, ensureHeaderFixture, ensureStallFixture, ensureThumbnailFixture, ensureChapterFixture]) {
    const path = await make()
    const { size } = await stat(path)
    console.log(`fixture ready: ${path} (${size} bytes)`)
  }
}
