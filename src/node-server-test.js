import http from 'http'
import fs from 'fs'
import path from 'path'

import * as url from 'url'
import { Readable } from 'stream'
const __filename = url.fileURLToPath(import.meta.url)
const __dirname = url.fileURLToPath(new URL('.', import.meta.url))

console.log(path.resolve(__dirname, '../build/fucked-subtitles-and-FF-playback.mkv'))

http.createServer((req, res) => {
  if (req.url !== '/foo') {
    res.end('Hello World')
    return
  }
  res.writeHead(200, {'Access-Control-Allow-Origin': '*'})
  let i = 0
  const stream = Readable.fromWeb(new ReadableStream({
    start(controller) {
      controller.enqueue(`test ${i++}`)
    },
    async pull(controller) {
      console.log('being pulled', i)
      controller.enqueue(new Uint8Array(1_000_000).fill(0))
    }
  }))
  stream.pipe(res)
}).listen(3000, () => {})
