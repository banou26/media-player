import { Actor, AnyActorLogic } from "xstate"

export const togglePlay = (
  mediaActor: Actor<AnyActorLogic>,
  isPaused: boolean,
  duration: number | undefined,
  currentTime: number
) => {
  if (!mediaActor) throw new Error('Media actor not found')
  if (!duration) throw new Error('Duration not found')
  if (duration === currentTime) {
    mediaActor.send({ type: 'SET_TIME', value: 0 })
    mediaActor.send({ type: 'PLAY' })
  } else if (isPaused) {
    mediaActor.send({ type: 'PLAY' })
  } else {
    mediaActor.send({ type: 'PAUSE' })
  }
}
