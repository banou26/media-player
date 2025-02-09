import { useRef } from 'react'
import { ActorRefFrom } from 'xstate'

import useScrub from '../use-scrub'
import mediaMachine from '../state-machines/media'
import { useActorRef } from '@xstate/react'

export const ProgressBar = ({ mediaActor }: { mediaActor: ActorRefFrom<typeof mediaMachine> }) => {
  const [state, send, mediaActor] = useActorRef(mediaActor)
  const progressBarRef = useRef<HTMLDivElement>(null)
  const { scrub: seekScrub, value: seekScrubValue, setValue: setSeekValue } = useScrub({ ref: progressBarRef })
  
  
    const [progressBarOverTime, setProgressBarOverTime] = useState<number | undefined>(undefined)
  
    const onProgressBarOver: DOMAttributes<HTMLDivElement>['onMouseMove'] = (ev) => {
      const percentage = ev.nativeEvent.offsetX / ev.currentTarget.offsetWidth
      const time = percentage * (duration ?? 0)
      setProgressBarOverTime(time)
    }
  
    const hideProgressBarTime = () => {
      if (!progressBarRef.current) return
      setProgressBarOverTime(undefined)
    }

  return (
    <div
      ref={progressBarRef}
      className="progress-bar"
      onMouseMove={onProgressBarOver}
      onMouseOut={hideProgressBarTime}
    >
      <div className="background-bar"></div>
      {
        progressBarOverTime
          ? (
            <div className="cursor-time" data-tip={progressBarOverTime} style={{ left: `${1 / ((duration ?? 0) / (progressBarOverTime ?? 1)) * 100}%` }}>
              {
              new Date((progressBarOverTime ?? 0) * 1000)
                .toISOString()
                .substr(
                  (duration ?? 0) >= 3600
                    ? 11
                    : 14,
                  (duration ?? 0) >= 3600
                    ? 8
                    : 5
                  
                )
              }
            </div>
          )
          : undefined
      }
      <div className="progress"></div>
      {/* bar showing the currently loaded progress */}
      <div className="load" style={{ transform: `scaleX(${1 / ((duration ?? 0) / (loadedTime?.[1] ?? 0))})` }}></div>
      {/* bar to show when hovering to potentially seek */}
      <div className="hover"></div>
      {/* bar displaying the current playback progress */}
      <div className="play" style={{
        transform: `scaleX(${
          typeof duration !== 'number' || typeof currentTime !== 'number'
            ? 0
            : 1 / ((duration ?? 0) / (currentTime ?? 0))
        })`
      }}>
      </div>
      <div className="chapters"></div>
      <div className="scrubber"></div>
      <div className="padding" onMouseDown={seekScrub}></div>
    </div>
  )
}
