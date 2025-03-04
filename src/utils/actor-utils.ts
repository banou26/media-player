import { Actor, AnyActorLogic } from "xstate"

export const togglePlay = (mediaActor: Actor<AnyActorLogic>, isPaused: boolean) => {
  if (!mediaActor) throw new Error('Media actor not found')
  if (isPaused) {
    mediaActor.send({ type: 'PLAY' })
  } else {
    mediaActor.send({ type: 'PAUSE' })
  }
}
