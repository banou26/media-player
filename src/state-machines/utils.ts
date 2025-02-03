import PQueue from 'p-queue'
import { AnyEventObject, CallbackActorRef, EventObject, fromCallback, NonReducibleUnknown } from 'xstate'
import { AnyActorSystem } from 'xstate/dist/declarations/src/system';

type Receiver<TEvent extends EventObject> = (listener: {
  bivarianceHack(event: TEvent): void;
}['bivarianceHack']) => void;
export type CallbackLogicFunction<TEvent extends EventObject = AnyEventObject, TSentEvent extends EventObject = AnyEventObject, TInput = NonReducibleUnknown, TEmitted extends EventObject = EventObject> = ({ input, system, self, sendBack, receive, emit }: {
    input: TInput;
    system: AnyActorSystem;
    self: CallbackActorRef<TEvent>;
    sendBack: (event: TSentEvent) => void;
    receive: Receiver<TEvent>;
    emit: (emitted: TEmitted) => void;
}) => (Promise<() => void>) | void;
type FromAsyncCallback = <TEvent extends EventObject, TInput = NonReducibleUnknown, TEmitted extends EventObject = EventObject>(callback: CallbackLogicFunction<TEvent, AnyEventObject, TInput, TEmitted>) => CallbackActorLogic<TEvent, TInput, TEmitted>

export const fromAsyncCallback =
  ((callback: (...args: any[]) => Promise<() => any>) =>
    fromCallback((...args: any[]) => {
      const callbackPromise = callback(...args)
      return () => {
        callbackPromise
          .then(callbackResult => callbackResult())
      }
    })) as FromAsyncCallback

export const getTimeRanges = (sourceBuffer: SourceBuffer) =>
  Array(sourceBuffer.buffered.length)
    .fill(undefined)
    .map((_, index) => ({
      index,
      start: sourceBuffer.buffered.start(index),
      end: sourceBuffer.buffered.end(index)
    }))

const setupListeners = (sourceBuffer: SourceBuffer, resolve: (value: Event) => void, reject: (reason: Event) => void) => {
  const updateEndListener = (ev: Event) => {
    resolve(ev)
    unregisterListeners()
  }
  const abortListener = (ev: Event) => {
    resolve(ev)
    unregisterListeners()
  }
  const errorListener = (ev: Event) => {
    console.error(ev)
    reject(ev)
    unregisterListeners()
  }
  const unregisterListeners = () => {
    sourceBuffer.removeEventListener('updateend', updateEndListener)
    sourceBuffer.removeEventListener('abort', abortListener)
    sourceBuffer.removeEventListener('error', errorListener)
  }
  sourceBuffer.addEventListener('updateend', updateEndListener, { once: true })
  sourceBuffer.addEventListener('abort', abortListener, { once: true })
  sourceBuffer.addEventListener('error', errorListener, { once: true })
}

export const updateSourceBuffer = (sourceBuffer: SourceBuffer) => {
  const queue = new PQueue({ concurrency: 1 })

  const appendBuffer = (buffer: ArrayBuffer) =>
    queue.add(() =>
      new Promise<Event>((resolve, reject) => {
        setupListeners(sourceBuffer, resolve, reject)
        sourceBuffer.appendBuffer(buffer)
      })
    )

  const unbufferRange = async (start: number, end: number) =>
    queue.add(() =>
      new Promise((resolve, reject) => {
        setupListeners(sourceBuffer, resolve, reject)
        sourceBuffer.remove(start, end)
      })
    )

  return {
    appendBuffer,
    unbufferRange
  }
}
