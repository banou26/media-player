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

export const SUBRIP_FIXTURE = 'subtitle-subrip.mkv'
export const SUBRIP_FIXTURE_PATH = PUBLIC_DIR + SUBRIP_FIXTURE

/** The seek fixture's picture with a SubRip track kept as SubRip, its one line from 1 s to 3 s. */
export const ensureSubRipFixture = async () => {
  if (await exists(SUBRIP_FIXTURE_PATH)) return SUBRIP_FIXTURE_PATH
  await mkdir(PUBLIC_DIR, { recursive: true })

  const subs = SUBRIP_FIXTURE_PATH + '.srt'
  await writeFile(subs, '1\n00:00:01,000 --> 00:00:03,000\nHHHHHHHH\n\n')
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
    SUBRIP_FIXTURE_PATH,
  ])
  await rm(subs, { force: true })
  return SUBRIP_FIXTURE_PATH
}

export const MATRIX_FIXTURE = 'subtitle-matrix.mkv'
export const MATRIX_FIXTURE_PATH = PUBLIC_DIR + MATRIX_FIXTURE

/**
 * A BT.709 picture under a script that says `YCbCr Matrix: TV.601`. Its one line is red and has no
 * border or shadow, so every opaque pixel is the fill colour.
 */
export const MATRIX_HEADER = [
  '[Script Info]',
  'ScriptType: v4.00+',
  'PlayResX: 1280',
  'PlayResY: 720',
  'YCbCr Matrix: TV.601',
  '',
  '[V4+ Styles]',
  'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
  'Style: Default,Liberation Sans,80,&H000000FF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,2,10,10,15,1',
  '',
  '[Events]',
  'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  'Dialogue: 0,0:00:00.00,0:00:20.00,Default,,0,0,0,,HHHHHHHH',
  '',
].join('\n')

export const ensureMatrixFixture = async () => {
  if (await exists(MATRIX_FIXTURE_PATH)) return MATRIX_FIXTURE_PATH
  await mkdir(PUBLIC_DIR, { recursive: true })

  const subs = MATRIX_FIXTURE_PATH + '.ass'
  await writeFile(subs, MATRIX_HEADER)
  await run('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'color=c=0x101010:size=1920x1080:rate=24:duration=6',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6',
    '-i', subs,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-g', '24',
    '-x264-params', 'colorprim=bt709:transfer=bt709:colormatrix=bt709',
    '-c:a', 'aac',
    '-c:s', 'copy',
    '-map', '0:v', '-map', '1:a', '-map', '2:s',
    '-metadata:s:s:0', 'language=eng',
    MATRIX_FIXTURE_PATH,
  ])
  await rm(subs, { force: true })
  return MATRIX_FIXTURE_PATH
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

/**
 * The shape an anime episode actually has, so the skip offer can be driven end to end.
 *
 * Prologue, Opening, Episode, Ending, Preview is the second most common sequence in the sample the
 * classifier was built from. The two themes are 20s rather than the real 90s to keep the fixture
 * small, which is still well clear of the 15s below which nothing is offered at all.
 */
export const ANIME_FIXTURE = 'anime-chapters.mkv'
export const ANIME_FIXTURE_PATH = PUBLIC_DIR + ANIME_FIXTURE
export const ANIME_CHAPTERS = [
  { start: 0, end: 10, title: 'Prologue' },
  { start: 10, end: 30, title: 'Opening' },
  { start: 30, end: 70, title: 'Episode' },
  { start: 70, end: 90, title: 'Ending' },
  { start: 90, end: 100, title: 'Preview' },
]

export const ensureAnimeFixture = async () => {
  if (await exists(ANIME_FIXTURE_PATH)) return ANIME_FIXTURE_PATH
  await mkdir(PUBLIC_DIR, { recursive: true })

  const meta = ANIME_FIXTURE_PATH + '.ffmeta'
  await writeFile(meta, [
    ';FFMETADATA1',
    ...ANIME_CHAPTERS.flatMap(({ start, end, title }) => [
      '[CHAPTER]',
      'TIMEBASE=1/1000',
      `START=${start * 1000}`,
      `END=${end * 1000}`,
      `title=${title}`,
    ]),
  ].join('\n') + '\n')

  await run('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'testsrc=size=160x90:rate=12:duration=100',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=100',
    '-i', meta,
    '-map_metadata', '2',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-g', '24',
    '-c:a', 'aac',
    ANIME_FIXTURE_PATH,
  ])
  await rm(meta, { force: true })
  return ANIME_FIXTURE_PATH
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

export const CJK_FIXTURE = 'subtitle-cjk.mkv'
export const CJK_FIXTURE_PATH = PUBLIC_DIR + CJK_FIXTURE

/**
 * Four bands of a quarter of the picture each: the same Latin line in Arial, which the file does not carry,
 * and in Liberation Sans, then two lines of different kana in Liberation Sans, the way releases set song
 * lyrics. Placed at whole pixels in a script at the picture's own size, so two rows drawn from the same
 * glyphs are pixel for pixel identical.
 */
export const CJK_HEADER = [
  '[Script Info]',
  'ScriptType: v4.00+',
  'PlayResX: 1920',
  'PlayResY: 1080',
  '',
  '[V4+ Styles]',
  'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
  'Style: Lyrics,Liberation Sans,80,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1',
  'Style: Plain,Arial,80,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1',
  '',
  '[Events]',
  'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  'Dialogue: 0,0:00:00.00,0:00:20.00,Plain,,0,0,0,,{\\pos(200,90)}Hello there',
  'Dialogue: 0,0:00:00.00,0:00:20.00,Lyrics,,0,0,0,,{\\pos(200,360)}Hello there',
  'Dialogue: 0,0:00:00.00,0:00:20.00,Lyrics,,0,0,0,,{\\pos(200,630)}あいうえお',
  'Dialogue: 0,0:00:00.00,0:00:20.00,Lyrics,,0,0,0,,{\\pos(200,900)}かきくけこ',
  '',
].join('\n')

export const ensureCjkFixture = async () => {
  if (await exists(CJK_FIXTURE_PATH)) return CJK_FIXTURE_PATH
  await mkdir(PUBLIC_DIR, { recursive: true })

  const subs = CJK_FIXTURE_PATH + '.ass'
  await writeFile(subs, CJK_HEADER)
  await run('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'color=c=0x101010:size=1920x1080:rate=24:duration=6',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6',
    '-i', subs,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-g', '24',
    '-c:a', 'aac',
    '-c:s', 'copy',
    '-map', '0:v', '-map', '1:a', '-map', '2:s',
    '-metadata:s:s:0', 'language=jpn',
    CJK_FIXTURE_PATH,
  ])
  await rm(subs, { force: true })
  return CJK_FIXTURE_PATH
}

export const LOUD_FIXTURE = 'loud-tone.mkv'
export const LOUD_FIXTURE_PATH = PUBLIC_DIR + LOUD_FIXTURE

/** Thirty seconds of a stereo 440 Hz tone at about -9.8 LUFS, long and loud enough for the volume normalizer to act on. */
export const ensureLoudFixture = async () => {
  if (await exists(LOUD_FIXTURE_PATH)) return LOUD_FIXTURE_PATH
  await mkdir(PUBLIC_DIR, { recursive: true })
  await run('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=24:duration=30',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=30',
    '-af', 'volume=12dB',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-g', '24',
    '-c:a', 'aac', '-ac', '2',
    '-map', '0:v', '-map', '1:a',
    LOUD_FIXTURE_PATH,
  ])
  return LOUD_FIXTURE_PATH
}

export const CUE_FIXTURE = 'cue-tone.mkv'
export const CUE_FIXTURE_PATH = PUBLIC_DIR + CUE_FIXTURE

/** The loud tone's thirty seconds, with the first twelve 20 dB quieter (about -29.8 LUFS), which needs no cut. */
export const ensureCueFixture = async () => {
  if (await exists(CUE_FIXTURE_PATH)) return CUE_FIXTURE_PATH
  await mkdir(PUBLIC_DIR, { recursive: true })
  await run('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=24:duration=30',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=30',
    '-af', "volume='if(lt(t,12),0.3981,3.981)':eval=frame:precision=float",
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-g', '24',
    '-c:a', 'aac', '-ac', '2',
    '-map', '0:v', '-map', '1:a',
    CUE_FIXTURE_PATH,
  ])
  return CUE_FIXTURE_PATH
}

export const STEP_FIXTURE = 'step-tone.mkv'
export const STEP_FIXTURE_PATH = PUBLIC_DIR + STEP_FIXTURE

/**
 * A minute of the stereo tone at about -29.8 LUFS, 15 dB louder from 2 to 3 s of every 3, so the file's normal level
 * is the quiet tone and the loud seconds are what the normalizer cuts.
 */
export const ensureStepFixture = async () => {
  if (await exists(STEP_FIXTURE_PATH)) return STEP_FIXTURE_PATH
  await mkdir(PUBLIC_DIR, { recursive: true })
  await run('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=24:duration=60',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=60',
    '-af', "volume='if(lt(mod(t,3),2),0.3981,2.2387)':eval=frame:precision=float",
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-g', '24',
    '-c:a', 'aac', '-ac', '2',
    '-map', '0:v', '-map', '1:a',
    STEP_FIXTURE_PATH,
  ])
  return STEP_FIXTURE_PATH
}

export const LONG_GOP_FIXTURE = 'long-gop.mkv'
export const LONG_GOP_FIXTURE_PATH = PUBLIC_DIR + LONG_GOP_FIXTURE

/** Thirty seconds of 720p at 23.976 fps with B-frames and a keyframe every 240 frames, at 0, 10.01 and 20.02 s. */
export const ensureLongGopFixture = async () => {
  if (await exists(LONG_GOP_FIXTURE_PATH)) return LONG_GOP_FIXTURE_PATH
  await mkdir(PUBLIC_DIR, { recursive: true })
  await run('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=24000/1001:duration=30',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=30',
    '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-g', '240', '-keyint_min', '240', '-sc_threshold', '0',
    '-c:a', 'aac',
    '-map', '0:v', '-map', '1:a',
    LONG_GOP_FIXTURE_PATH,
  ])
  return LONG_GOP_FIXTURE_PATH
}

export const SHORT_AUDIO_FIXTURE = 'short-audio-tone.mkv'
export const SHORT_VIDEO_FIXTURE = 'short-video-tone.mkv'
export const SHORTER_AUDIO_FIXTURE = 'shorter-audio-tone.mkv'

/**
 * The loud tone's thirty seconds with one track 0.4 s, or the audio 1 s, shorter than the other.
 *
 * While its MediaSource is open, a SourceBuffer's `buffered` is where both tracks have data, so it ends
 * at the shorter track, and only once the MediaSource is ended does it run to the longer one, which is
 * also the declared duration. The loud tone's tracks end 23 ms apart, too close to tell those apart.
 */
const ensureUnevenFixture = async (name, { video, audio }) => {
  const path = PUBLIC_DIR + name
  if (await exists(path)) return path
  await mkdir(PUBLIC_DIR, { recursive: true })
  await run('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-f', 'lavfi', '-i', `testsrc=size=320x240:rate=24:duration=${video}`,
    '-f', 'lavfi', '-i', `sine=frequency=440:duration=${audio}`,
    '-af', 'volume=12dB',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-g', '24',
    '-c:a', 'aac', '-ac', '2',
    '-map', '0:v', '-map', '1:a',
    path,
  ])
  return path
}
export const ensureShortAudioFixture = () => ensureUnevenFixture(SHORT_AUDIO_FIXTURE, { video: 30, audio: 29.6 })
export const ensureShortVideoFixture = () => ensureUnevenFixture(SHORT_VIDEO_FIXTURE, { video: 29.6, audio: 30 })
export const ensureShorterAudioFixture = () => ensureUnevenFixture(SHORTER_AUDIO_FIXTURE, { video: 30, audio: 29 })

export const SHORT_GOP_FIXTURE = 'short-gop-tone.mkv'
export const SHORT_GOP_FIXTURE_PATH = PUBLIC_DIR + SHORT_GOP_FIXTURE

/** The loud tone with a keyframe every 20 frames, 0.833 s, so a remuxer seek can leave a hole under 1 s. */
export const ensureShortGopFixture = async () => {
  if (await exists(SHORT_GOP_FIXTURE_PATH)) return SHORT_GOP_FIXTURE_PATH
  await mkdir(PUBLIC_DIR, { recursive: true })
  await run('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=24:duration=30',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=30',
    '-af', 'volume=12dB',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-g', '20', '-keyint_min', '20', '-sc_threshold', '0',
    '-c:a', 'aac', '-ac', '2',
    '-map', '0:v', '-map', '1:a',
    SHORT_GOP_FIXTURE_PATH,
  ])
  return SHORT_GOP_FIXTURE_PATH
}

export const FRAME_STEP_FIXTURE = 'frame-step.mkv'
export const FRAME_STEP_FIXTURE_PATH = PUBLIC_DIR + FRAME_STEP_FIXTURE
export const FRAME_STEP_60_FIXTURE = 'frame-step-60.mkv'
export const FRAME_STEP_60_FIXTURE_PATH = PUBLIC_DIR + FRAME_STEP_60_FIXTURE

/**
 * Every frame paints its own number, so a test reads the frame on screen off the picture rather than off a timestamp:
 * the left half is 16 + (n mod 16) * 14, the right half 16 + (floor(n / 16) mod 16) * 14. A keyframe every 240
 * frames, B-frames, and one subtitle line from 2.00 to 4.00 s.
 */
const frameStepFixture = async (path, rate, duration) => {
  if (await exists(path)) return path
  await mkdir(PUBLIC_DIR, { recursive: true })

  const subs = path + '.ass'
  await writeFile(subs, SCALE_HEADER.replace(
    'Dialogue: 0,0:00:00.00,0:00:20.00,Default,,0,0,0,,HHHHHHHH',
    'Dialogue: 0,0:00:02.00,0:00:04.00,Default,,0,0,0,,HHHHHHHH',
  ))
  await run('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-f', 'lavfi', '-i', `color=c=black:s=640x360:r=${rate}:d=${duration},format=gray,geq=lum='if(lt(X,320),16+mod(N,16)*14,16+mod(floor(N/16),16)*14)',format=yuv420p`,
    '-f', 'lavfi', '-i', `sine=frequency=440:duration=${duration}`,
    '-i', subs,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '8', '-g', '240', '-keyint_min', '240', '-sc_threshold', '0',
    '-c:a', 'aac',
    '-c:s', 'copy',
    '-map', '0:v', '-map', '1:a', '-map', '2:s',
    '-metadata:s:s:0', 'language=eng',
    path,
  ])
  await rm(subs, { force: true })
  return path
}

/** Twenty seconds at 23.976 fps, keyframes at 0 and 10.01 s. */
export const ensureFrameStepFixture = () => frameStepFixture(FRAME_STEP_FIXTURE_PATH, '24000/1001', 20)

/** Ten seconds at 60 fps, keyframes every 4 s. */
export const ensureFrameStep60Fixture = () => frameStepFixture(FRAME_STEP_60_FIXTURE_PATH, '60', 10)

/**
 * The volume normalizer's own signal: a minute of synthetic dialogue at about -24 LUFS over a room tone, with loud
 * events at starts off the 1 ms grid (HOR-498 review, shortened from its 240 s). Written as float WAVs, the mix and
 * the dialogue alone on the same timeline, with the events in `normalizer-events.json`, then encoded into the
 * containers and codecs playback passes through. Seeded, so every run writes the same samples.
 */
export const NORMALIZER_RATE = 48000
export const NORMALIZER_SECONDS = 60
export const NORMALIZER_FIXTURES = {
  'normalizer-aac.mkv': ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-g', '48', '-c:a', 'aac', '-b:a', '192k'],
  'normalizer-aac.mp4': ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-g', '48', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart'],
  'normalizer-aac44.mkv': ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-g', '48', '-c:a', 'aac', '-b:a', '192k', '-ar', '44100'],
  'normalizer-opus.webm': ['-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-g', '48', '-c:a', 'libopus', '-b:a', '160k'],
  'normalizer-flac.mkv': ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-g', '48', '-c:a', 'flac'],
}

const normalizerSignal = () => {
  const RATE = NORMALIZER_RATE, N = NORMALIZER_SECONDS * RATE
  let seed = 987654321
  // Math.imul: a plain product passes 2^53 and rounds, and the generator fell into a loop of 419 values, so the noise
  // repeated every 419 samples and matching the audio found it 8.7 ms off as readily as in place (HOR-498, 2026-10-17)
  const rand = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed / 4294967296 }
  const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand())
  const uni = (a, b) => a + (b - a) * rand()
  const bandpass = (f, q) => {
    const w = 2 * Math.PI * f / RATE, alpha = Math.sin(w) / (2 * q), a0 = 1 + alpha
    const b0 = alpha / a0, b2 = -alpha / a0, a1 = -2 * Math.cos(w) / a0, a2 = (1 - alpha) / a0
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0
    return (x) => { const y = b0 * x + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x; y2 = y1; y1 = y; return y }
  }
  // BS.1770's 48 kHz K-weighting, for setting levels
  const kweight = (x) => {
    const y = new Float64Array(x.length)
    let s1 = 0, s2 = 0, t1 = 0, t2 = 0
    for (let i = 0; i < x.length; i++) {
      const v = x[i]
      const a = 1.53512485958697 * v + s1; s1 = -2.69169618940638 * v + 1.69065929318241 * a + s2; s2 = 1.19839281085285 * v - 0.73248077421585 * a
      const b = a + t1; t1 = -2 * a + 1.99004745483398 * b + t2; t2 = a - 0.99007225036621 * b
      y[i] = b
    }
    return y
  }
  // gated loudness of a mono signal on both channels
  const loudness = (x) => {
    const y = kweight(x), block = 0.4 * RATE, hop = 0.1 * RATE, blocks = []
    for (let s = 0; s + block <= y.length; s += hop) {
      let e = 0
      for (let i = s; i < s + block; i++) e += y[i] * y[i]
      blocks.push(2 * e / block)
    }
    const absolute = blocks.filter((e) => -0.691 + 10 * Math.log10(e) > -70)
    const mean = absolute.reduce((a, b) => a + b, 0) / absolute.length
    const relative = absolute.filter((e) => e > mean * 0.1)
    return -0.691 + 10 * Math.log10(relative.reduce((a, b) => a + b, 0) / relative.length)
  }

  const dialogue = new Float32Array(N)
  for (let t = Math.round(0.4 * RATE); t < N;) {
    const words = Math.floor(uni(3, 12))
    for (let w = 0; w < words && t < N; w++) {
      const length = Math.round(uni(0.08, 0.35) * RATE), amp = uni(0.5, 1)
      const f0a = uni(95, 260), f0b = f0a * uni(0.8, 1.2)
      const formants = [bandpass(uni(350, 900), 5), bandpass(uni(1000, 2400), 8), bandpass(uni(2500, 3400), 10)]
      const fricative = rand() < 0.35, hiss = bandpass(uni(4000, 7000), 2)
      let phase = 0
      for (let i = 0; i < length && t + i < N; i++) {
        const u = i / length
        const env = Math.min(1, i / (0.012 * RATE)) * Math.min(1, (length - i) / (0.03 * RATE)) * (0.8 + 0.2 * Math.sin(2 * Math.PI * 4 * u))
        phase += (f0a + (f0b - f0a) * u) / RATE
        phase -= Math.floor(phase)
        const saw = 2 * phase - 1
        let v = formants[0](saw) + 0.6 * formants[1](saw) + 0.3 * formants[2](saw)
        if (fricative && i < 0.06 * RATE) v += 0.25 * hiss(gauss())
        dialogue[t + i] += amp * env * v
      }
      t += length + Math.round(uni(0.02, 0.1) * RATE)
    }
    t += Math.round(uni(0.25, 1.2) * RATE)
  }
  const scale = Math.pow(10, (-24 - loudness(dialogue)) / 20)
  for (let i = 0; i < N; i++) dialogue[i] *= scale

  const left = new Float32Array(N), right = new Float32Array(N)
  for (let i = 0; i < N; i++) { left[i] = dialogue[i] + 0.0012 * gauss(); right[i] = dialogue[i] + 0.0012 * gauss() }
  const events = []
  // a burst at the dialogue's level plus `lu` over its own length (a decaying one: over its first 50 ms)
  const burst = (start, seconds, lu, label, shape = 'flat') => {
    const n = Math.round(seconds * RATE), s0 = Math.round(start * RATE), x = new Float32Array(n), tone = bandpass(uni(600, 1500), 0.7)
    for (let i = 0; i < n; i++) {
      const env = shape === 'decay'
        ? Math.min(1, i / (0.001 * RATE)) * Math.exp(-i / (0.04 * RATE))
        : Math.min(1, i / (0.0002 * RATE)) * Math.min(1, (n - i) / (0.0005 * RATE))
      x[i] = env * (0.6 * gauss() + 0.8 * tone(gauss()))
    }
    const y = kweight(x), m = shape === 'decay' ? Math.min(n, Math.round(0.05 * RATE)) : n
    let e = 0
    for (let i = 0; i < m; i++) e += y[i] * y[i]
    const g = Math.pow(10, (-24 + lu + 0.691 - 10 * Math.log10(2 * e / m)) / 20)
    for (let i = 0; i < n && s0 + i < N; i++) { left[s0 + i] += g * x[i]; right[s0 + i] += 0.9 * g * x[i] }
    events.push({ label, start, seconds, lu })
  }
  burst(6.3337, 0.003, 20, 'click 3 ms +20')
  burst(10.1234, 0.010, 15, 'burst 10 ms +15')
  burst(14.5678, 0.030, 15, 'burst 30 ms +15')
  burst(18.9012, 0.100, 12, 'burst 100 ms +12')
  burst(22.2468, 0.25, 20, 'gunshot +20', 'decay')
  for (let k = 0; k < 6; k++) burst(26.7531 + 0.06 * k, 0.008, 18, `shot ${k + 1} of 6, 8 ms +18`)
  {
    const s0 = Math.round(30.4321 * RATE), n = Math.round(1.5 * RATE), g = Math.pow(10, 9 / 20) - 1
    for (let i = 0; i < n; i++) { left[s0 + i] += g * dialogue[s0 + i]; right[s0 + i] += g * dialogue[s0 + i] }
    events.push({ label: 'shout 1.5 s +9', start: 30.4321, seconds: 1.5, lu: 9 })
  }
  burst(34.3210, 0.05, 18, 'burst 50 ms +18')
  burst(38.6543, 1.0, 18, 'burst 1 s +18')
  burst(42.2222, 0.2, 12, 'burst 200 ms +12')
  burst(46.4567, 0.02, 18, 'burst 20 ms +18')
  burst(50.7654, 0.05, 15, 'burst 50 ms +15')
  burst(56.5003, 0.02, 18, 'burst 20 ms +18 near the end')
  burst(59.9502, 0.03, 18, 'burst 30 ms +18 in the last 50 ms')

  let peak = 0
  for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]))
  if (peak > 0.99) {
    const g = 0.99 / peak
    for (let i = 0; i < N; i++) { left[i] *= g; right[i] *= g; dialogue[i] *= g }
  }
  return { left, right, dialogue, events }
}

const writeWav = async (path, left, right) => {
  const n = left.length, data = Buffer.alloc(n * 8), header = Buffer.alloc(44)
  for (let i = 0; i < n; i++) { data.writeFloatLE(left[i], 8 * i); data.writeFloatLE(right[i], 8 * i + 4) }
  header.write('RIFF', 0); header.writeUInt32LE(36 + data.length, 4); header.write('WAVE', 8)
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(3, 20); header.writeUInt16LE(2, 22)
  header.writeUInt32LE(NORMALIZER_RATE, 24); header.writeUInt32LE(NORMALIZER_RATE * 8, 28); header.writeUInt16LE(8, 32); header.writeUInt16LE(32, 34)
  header.write('data', 36); header.writeUInt32LE(data.length, 40)
  await writeFile(path, Buffer.concat([header, data]))
}

export const ensureNormalizerFixtures = async () => {
  const paths = Object.keys(NORMALIZER_FIXTURES).map((name) => PUBLIC_DIR + name)
  const wav = PUBLIC_DIR + 'normalizer-signal.wav'
  if ((await Promise.all([wav, ...paths].map(exists))).every(Boolean)) return wav
  await mkdir(PUBLIC_DIR, { recursive: true })
  const { left, right, dialogue, events } = normalizerSignal()
  await writeWav(wav, left, right)
  await writeWav(PUBLIC_DIR + 'normalizer-dialogue.wav', dialogue, dialogue)
  await writeFile(PUBLIC_DIR + 'normalizer-events.json', JSON.stringify(events, null, 1))
  for (const [name, codecs] of Object.entries(NORMALIZER_FIXTURES)) {
    await run('ffmpeg', [
      '-y', '-loglevel', 'error',
      '-f', 'lavfi', '-i', `testsrc=size=160x90:rate=24:duration=${NORMALIZER_SECONDS}`,
      '-i', wav,
      ...codecs,
      '-map', '0:v', '-map', '1:a',
      PUBLIC_DIR + name,
    ])
  }
  return wav
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const make of [ensureNormalizerFixtures, ensureLoudFixture, ensureCueFixture, ensureStepFixture, ensureLongGopFixture, ensureShortAudioFixture, ensureShortVideoFixture, ensureShorterAudioFixture, ensureShortGopFixture, ensureFixture, ensureNativeFixture, ensureScaleFixture, ensureSeekFixture, ensureSubRipFixture, ensureMatrixFixture, ensureHeaderFixture, ensureCjkFixture, ensureStallFixture, ensureThumbnailFixture, ensureChapterFixture, ensureAnimeFixture, ensureFrameStepFixture, ensureFrameStep60Fixture]) {
    const path = await make()
    const { size } = await stat(path)
    console.log(`fixture ready: ${path} (${size} bytes)`)
  }
}
