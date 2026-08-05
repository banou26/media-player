import type { ResolvedSource } from '@banou/media-player/embed'

import { useCallback, useEffect, useRef, useState } from 'react'
import { css } from '@emotion/react'
import MediaPlayer from '@banou/media-player'
import { resolveSource } from '@banou/media-player/embed'

import { playerAssets } from '../asset-urls'
import { createCloudSettings } from '../settings/cloud'

// One store for the document. Cloud sync is attached only here, never in the embed: the unlock card
// is modal inside the broker's own full-viewport frame and would be drawn over a third party's page.
const settings = createCloudSettings()

const pageStyle = css`
  height: 100%;
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #111;
  color: #fff;

  .panel {
    width: min(56rem, 90vw);
    text-align: center;
    padding: 2.4rem 1.8rem;
    border: 2px dashed rgba(255, 255, 255, 0.18);
    border-radius: 1.2rem;
    transition: border-color 0.15s ease, background-color 0.15s ease;
    @media (min-width: 768px) {
      padding: 4rem 3rem;
    }
  }

  &.dragging .panel {
    border-color: #f03;
    background-color: rgba(255, 0, 51, 0.06);
  }

  h1 {
    font-size: 2.1rem;
    font-weight: 600;
    margin-bottom: 0.8rem;
    @media (min-width: 768px) {
      font-size: 2.8rem;
    }
  }

  p {
    color: #aaa;
    font-size: 1.4rem;
    line-height: 2rem;
    margin-bottom: 2.4rem;
    @media (min-width: 768px) {
      font-size: 1.5rem;
      line-height: 2.2rem;
    }
  }

  button {
    font: inherit;
    font-size: 1.5rem;
    color: #fff;
    background: #f03;
    border: none;
    border-radius: 0.6rem;
    padding: 1rem 2rem;
    min-height: 4.4rem;
    cursor: pointer;
  }

  button:hover {
    filter: brightness(1.1);
  }

  .url {
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
    margin-top: 2rem;
    @media (min-width: 480px) {
      flex-direction: row;
    }
  }

  .url input {
    flex: 1;
    min-width: 0;
    font: inherit;
    /* under 16px iOS Safari zooms the page when the field takes focus */
    font-size: 1.6rem;
    color: #fff;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 0.6rem;
    padding: 1rem 1.2rem;
    min-height: 4.4rem;
  }

  .url button {
    background: rgba(255, 255, 255, 0.12);
  }

  .error {
    margin-top: 1.6rem;
    color: #ff8080;
    font-size: 1.4rem;
  }

  .note {
    margin-top: 2.4rem;
    font-size: 1.3rem;
    color: #777;
  }
`

const playerStyle = css`
  height: 100%;
  width: 100%;
`

export const Home = () => {
  const [source, setSource] = useState<ResolvedSource | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const [url, setUrl] = useState('')

  // Fire and forget. Nothing here is awaited and nothing gates playback on it: with no account, no
  // broker or no network the player runs exactly as it does for an anonymous visitor.
  useEffect(() => settings.attach(), [])

  const openBlob = useCallback(async (file: File) => {
    setError(null)
    try {
      setSource(await resolveSource({ kind: 'blob', blob: file, name: file.name }))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [])

  const openUrl = useCallback(async (value: string) => {
    setError(null)
    try {
      setSource(await resolveSource({ kind: 'url', url: value, name: value.split('/').pop() }))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [])

  // Dropping anywhere works, so the whole document listens rather than only the panel
  useEffect(() => {
    const over = (event: DragEvent) => { event.preventDefault(); setDragging(true) }
    const leave = (event: DragEvent) => { if (!event.relatedTarget) setDragging(false) }
    const drop = (event: DragEvent) => {
      event.preventDefault()
      setDragging(false)
      const file = event.dataTransfer?.files?.[0]
      if (file) void openBlob(file)
    }
    document.addEventListener('dragover', over)
    document.addEventListener('dragleave', leave)
    document.addEventListener('drop', drop)
    return () => {
      document.removeEventListener('dragover', over)
      document.removeEventListener('dragleave', leave)
      document.removeEventListener('drop', drop)
    }
  }, [openBlob])

  if (source) {
    return (
      <div css={playerStyle}>
        <MediaPlayer
          {...playerAssets}
          read={source.read}
          thumbnailRead={source.readQuiet}
          size={source.length}
          title={source.name}
          settings={settings}
          autoplay
          thumbnails
          loadingInformation="Reading the file..."
        />
      </div>
    )
  }

  return (
    <div css={pageStyle} className={dragging ? 'dragging' : ''}>
      <div className="panel">
        <h1>Play any video, in your browser</h1>
        <p>
          Drop a file anywhere on this page. Containers and codecs your browser cannot open natively
          are remuxed as they play, a piece at a time. Nothing is uploaded and nothing leaves your
          device.
        </p>
        <button type="button" onClick={() => inputRef.current?.click()}>Choose a file</button>
        <input
          ref={inputRef}
          type="file"
          accept="video/*,.mkv,.avi,.ts,.mov,.webm,.flv,.ogv,.m2ts"
          style={{ display: 'none' }}
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) void openBlob(file)
          }}
        />
        <div className="url">
          <input
            type="url"
            placeholder="or paste a video URL"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter' && url) void openUrl(url) }}
          />
          <button type="button" onClick={() => url && void openUrl(url)}>Open</button>
        </div>
        {error ? <div className="error">{error}</div> : null}
        <div className="note">
          A URL has to allow this origin and answer range requests.
        </div>
      </div>
    </div>
  )
}

export default Home
