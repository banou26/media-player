import { describe, expect, it } from 'vitest'

import { labelTracks, toNamedTracks } from './track-label'

const track = (streamIndex: number, language: string, title = '') => ({ streamIndex, language, title })

describe('labelTracks', () => {
  it('names a track by its language', () => {
    expect(labelTracks([track(0, 'eng')]).map(({ label }) => label)).toEqual(['English'])
  })

  it('falls back to the title when the language tag says nothing', () => {
    // 'und' is the explicit "undetermined" tag, which is not a name
    expect(labelTracks([track(0, 'und', 'Signs and Songs')]).map(({ label }) => label))
      .toEqual(['Signs and Songs'])
  })

  it('falls back to the index when there is neither', () => {
    expect(labelTracks([track(3, '', '')]).map(({ label }) => label)).toEqual(['Track 3'])
  })

  it('tidies underscores out of a title', () => {
    expect(labelTracks([track(0, '', 'Full_Subtitles')]).map(({ label }) => label))
      .toEqual(['Full Subtitles'])
  })

  it('leaves unambiguous rows alone even when they carry a title', () => {
    // the title only earns its place as a tiebreak, or every row on a normal release is doubled up
    expect(labelTracks([track(0, 'eng', 'Dialogue'), track(1, 'jpn', 'Dialogue')]).map(({ label }) => label))
      .toEqual(['English', 'Japanese'])
  })

  it('disambiguates same-language rows with the title', () => {
    expect(
      labelTracks([track(0, 'eng', 'Full'), track(1, 'eng', 'Signs')]).map(({ label }) => label),
    ).toEqual(['English (Full)', 'English (Signs)'])
  })

  it('does not repeat a title that is already the base name', () => {
    const labels = labelTracks([track(0, '', 'Signs'), track(1, '', 'Signs')]).map(({ label }) => label)
    expect(labels).toEqual(['Signs', 'Signs'])
  })

  it('keeps the track it was given, so a caller can map back to it', () => {
    const input = [track(7, 'eng')]
    expect(labelTracks(input)[0]!.track).toBe(input[0])
  })
})

describe('toNamedTracks', () => {
  it('carries the stream index across as the id', () => {
    expect(toNamedTracks([track(0, 'eng'), track(4, 'jpn')])).toEqual([
      { id: 0, label: 'English' },
      { id: 4, label: 'Japanese' },
    ])
  })

  it('keeps index 0, which is falsy and is a real track', () => {
    const [first] = toNamedTracks([track(0, 'eng')])
    expect(first!.id).toBe(0)
  })

  it('is empty for no tracks rather than throwing', () => {
    expect(toNamedTracks([])).toEqual([])
  })
})
