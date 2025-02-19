import { createActorContext } from '@xstate/react'

import mediaMachine from './media'

export const MediaMachineContext = createActorContext(mediaMachine)
