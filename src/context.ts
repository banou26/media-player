import { createContext } from 'react'

export type DownloadedRange =
  | {
    startTimestamp: number
    endTimestamp: number
  }
  | {
    startByteOffset: number
    endByteOffset: number
  }

export type MediaPlayerContextType = {
  title?: string
  subtitle?: string
  downloadedRanges?: DownloadedRange[]
  hideUI: boolean
  update: (context: Omit<MediaPlayerContextType, 'update'>) => void
}

export const MediaPlayerContext = createContext<MediaPlayerContextType>({} as MediaPlayerContextType)
