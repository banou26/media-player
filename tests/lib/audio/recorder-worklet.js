// Records the first channel of each of its two inputs, with the context frame of every render quantum, and posts
// them in batches of 32 quanta.
class Recorder extends AudioWorkletProcessor {
  constructor() {
    super()
    this.batch = { frames: [], first: [], second: [] }
  }

  process(inputs) {
    const first = inputs[0][0], second = inputs[1][0]
    if (first && second) {
      this.batch.frames.push(currentFrame)
      this.batch.first.push(first.slice())
      this.batch.second.push(second.slice())
    }
    if (this.batch.frames.length >= 32) {
      this.port.postMessage(this.batch)
      this.batch = { frames: [], first: [], second: [] }
    }
    return true
  }
}

registerProcessor('test-recorder', Recorder)
