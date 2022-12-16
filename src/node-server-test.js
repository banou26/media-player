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
  res.writeHead(200, {
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store'
  })
  
  let i = 0
  // const stream = Readable.fromWeb(new ReadableStream({
  //   start(controller) {
  //     controller.enqueue(`test ${i++}`)
  //   },
  //   async pull(controller) {
  //     console.log('being pulled', i)
  //     await new Promise(resolve => setTimeout(resolve, 100))
  //     controller.enqueue(new Uint8Array(1_000_000).fill(0))
  //   },
  //   cancel() {
  //     console.log('cancelled')
  //   }
  // }))
  // stream.pipe(res)
  fs.createReadStream(path.resolve(__dirname, '../video3.mkv')).pipe(res)
}).listen(3000, () => {})

// clientside
// fetch('http://localhost:3000/foo', { headers: { 'Cache-Control': 'no-store' } })
//   .then(async (res) => {
//       console.log(res.body)
//     const reader = res.body?.getReader()
//     for (let i = 100000; i > 0; i--) {
//       await new Promise(resolve => setTimeout(resolve, 100))
//       const res = await reader?.read()
//       if (res.done) break
//       console.log(await reader?.read(), i)
//     }
//     console.log('done')
//   })



  // // const stream = Readable.fromWeb(new ReadableStream({
  // //   start(controller) {
  // //     controller.enqueue(`test ${i++}`)
  // //   },
  // //   async pull(controller) {
  // //     console.log('being pulled', i)
  // //     await new Promise(resolve => setTimeout(resolve, 1000))
  // //     controller.enqueue(new Uint8Array(1_000_000).fill(0))
  // //   }
  // // }))
  // // stream.pipe(res)
  // fs.createReadStream(path.resolve(__dirname, '../video3.mkv')).pipe(res)