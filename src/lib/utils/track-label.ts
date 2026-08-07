export type LabelledTrack = {
  streamIndex: number
  title: string
  language: string
}

/** One row of a track menu, already named. Mirrors `TrackChoice` without importing the store. */
export type NamedTrack = {
  id: string | number
  label: string
}

/**
 * Human name for a track's language tag. `fallback: 'none'` is what makes an unknown tag come back
 * undefined instead of echoing itself, so the caller can fall through to the title.
 */
export const displayLanguage = (language: string | undefined): string | undefined => {
  if (!language || language === 'und') return undefined
  try {
    return new Intl.DisplayNames([navigator.language || 'en'], { type: 'language', fallback: 'none' }).of(language) || undefined
  } catch {
    return undefined
  }
}

const tidy = (title: string | undefined) => title?.replace(/_/g, ' ').trim() || undefined

/**
 * Names a set of tracks for a menu, by language, falling back to the title then the stream index.
 * The title is appended only to break a tie, because on a MultiSub release every title is the same
 * source tag and titling every row gives nine identical entries.
 */
export const labelTracks = <T extends LabelledTrack>(tracks: T[]): { track: T, label: string }[] => {
  const bases = tracks.map((track) => displayLanguage(track.language) ?? tidy(track.title) ?? `Track ${track.streamIndex}`)
  const counts = bases.reduce<Record<string, number>>((acc, base) => ({ ...acc, [base]: (acc[base] ?? 0) + 1 }), {})
  return tracks.map((track, index) => {
    const base = bases[index]!
    const detail = tidy(track.title)
    const ambiguous = (counts[base] ?? 0) > 1
    return { track, label: ambiguous && detail && detail !== base ? `${base} (${detail})` : base }
  })
}

/**
 * Names the engine's streams once, on the way into the store, so the menu only ever reads rows.
 *
 * The store's ids are opaque so a source that owns its own player can use its own track ids; the id
 * here is the libav stream index, which is what this half of the code has to say.
 */
export const toNamedTracks = <T extends LabelledTrack>(tracks: T[]): NamedTrack[] =>
  labelTracks(tracks).map(({ track, label }) => ({ id: track.streamIndex, label }))
