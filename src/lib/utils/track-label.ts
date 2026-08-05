export type LabelledTrack = {
  streamIndex: number
  title: string
  language: string
}

/**
 * Human name for a track's language tag.
 *
 * Matroska usually carries ISO 639-2/B (`fre`, `ger`, `chi`), which Intl resolves alongside the
 * 639-2/T and 639-1 forms. `fallback: 'none'` is what makes an unknown or `und` tag come back
 * undefined instead of echoing the tag, so the caller can fall through to the title.
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
 * Names a set of tracks for a menu.
 *
 * The language is the label, because it is what a viewer is choosing by. The track title is only
 * appended where it has to be, which is when two tracks would otherwise read the same. That matters
 * on real releases: a MultiSub episode carries nine tracks whose titles are all the source tag
 * ("CR"), so titling every row gives nine identical entries, while languages alone collide on the
 * two Spanish tracks and nothing else. Only those two get "(Latin America CR)" and "(CR)".
 *
 * Falls back to the title, then to the stream index, so a track always has some label.
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
