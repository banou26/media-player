import type { ExternalSubtitleFormat } from '../engine'

export const EXT_SUBTITLE_PREFIX = 'ext:'

export type ExternalSubtitleMeta = {
  id: string
  language: string
  label: string
  format: ExternalSubtitleFormat
}

export const toExternalTrackId = (id: string) => `${EXT_SUBTITLE_PREFIX}${id}`

export const isExternalTrackId = (id: string | number | undefined): id is string =>
  typeof id === 'string' && id.startsWith(EXT_SUBTITLE_PREFIX)

export const rawExternalTrackId = (storeId: string) => storeId.slice(EXT_SUBTITLE_PREFIX.length)

export const externalTrackLabel = (track: Pick<ExternalSubtitleMeta, 'id' | 'language' | 'label'>) =>
  track.label.trim() || track.language || track.id
