import type { MediaPlayerSource, RemuxerInput } from '@banou/media-player'

import { useCallback, useEffect, useRef, useState } from 'react'
import { css } from '@emotion/react'

import MediaPlayer, { inputToRemuxerInput } from '@banou/media-player'
import { playerAssets } from '../asset-urls'

const style = css`
  position: relative;
  height: 100%;
  width: 100%;
  background: #000;

  /* The empty player is deliberately bare, so there is no chrome at rest. This appears only while a
     file is actually over the window, and goes away with it. */
  .drop-hint {
    position: absolute;
    inset: 0;
    z-index: 5;
    pointer-events: none;
    border: 2px dashed rgba(255, 255, 255, 0.35);
    background: rgba(255, 0, 51, 0.06);
  }

  /* Covers the picture while nothing is loaded, so a click anywhere opens a file. Not rendered once a
     source exists, which leaves the player's own click-to-pause alone. */
  .picker {
    position: absolute;
    inset: 0;
    z-index: 3;
    cursor: pointer;
  }

  .source-error {
    position: absolute;
    inset: auto 0 12%;
    z-index: 4;
    padding: 0 2rem;
    text-align: center;
    color: #ff8080;
    font-size: 1.4rem;
    text-shadow: 0 0 4px rgba(0, 0, 0, 1);
    pointer-events: none;
  }
`

export const Home = () => {
  const [source, setSource] = useState<RemuxerInput | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const open = useCallback(async (next: Parameters<typeof inputToRemuxerInput>[0]) => {
    setError(null)
    try {
      setSource(await inputToRemuxerInput(next))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [])

  const openFile = useCallback((file: File) => open({ blob: file, name: file.name }), [open])

  useEffect(() => {
    const over = (event: DragEvent) => { event.preventDefault(); setDragging(true) }
    const leave = (event: DragEvent) => { if (!event.relatedTarget) setDragging(false) }
    const drop = (event: DragEvent) => {
      event.preventDefault()
      setDragging(false)
      const file = event.dataTransfer?.files?.[0]
      if (file) void openFile(file)
    }

    const paste = (event: ClipboardEvent) => {
      const file = event.clipboardData?.files?.[0]
      if (file) { void openFile(file); return }
      const text = event.clipboardData?.getData('text')?.trim()
      if (!text) return
      try {
        const url = new URL(text)
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return
        void open({ url: text, name: decodeURIComponent(url.pathname.split('/').pop() || '') })
      } catch {}
    }
    document.addEventListener('dragover', over)
    document.addEventListener('dragleave', leave)
    document.addEventListener('drop', drop)
    document.addEventListener('paste', paste)
    return () => {
      document.removeEventListener('dragover', over)
      document.removeEventListener('dragleave', leave)
      document.removeEventListener('drop', drop)
      document.removeEventListener('paste', paste)
    }
  }, [open, openFile])

  // named rather than spread inline, because an inline ternary widens to two optional keys
  const sourceProps: MediaPlayerSource = source ? { read: source.read, size: source.length } : {}

  return (
    <div css={style}>
      <MediaPlayer
        {...playerAssets}
        {...sourceProps}
        title={source?.name}
        autoplay
      >
        {source
          ? null
          : (
            <div
              className="picker"
              onClick={(event) => { event.stopPropagation(); inputRef.current?.click() }}
            />
          )}
        {error ? <div className="source-error">{error}</div> : null}
      </MediaPlayer>
      {dragging ? <div className="drop-hint" /> : null}
      <input
        ref={inputRef}
        type="file"
        accept="video/*,.mkv,.avi,.ts,.mov,.webm,.flv,.ogv,.m2ts"
        style={{ display: 'none' }}
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) openFile(file)
        }}
      />
    </div>
  )
}

export default Home
