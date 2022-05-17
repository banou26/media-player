import path from 'path'
import http from 'http'
import fs from 'fs'

import esbuild from 'esbuild'
import alias from 'esbuild-plugin-alias'
import mime from 'mime'

const polyfills = alias({
  'zlib': path.resolve('./node_modules/browserify-zlib/lib/index.js'),
  'stream': path.resolve('./node_modules/stream-browserify/index.js'),
  'crypto': path.resolve('./node_modules/crypto-browserify/index.js'),
  'http': path.resolve('./node_modules/stream-http/index.js'),
  'https': path.resolve('./node_modules/stream-http/index.js'),
  'fs': path.resolve('./node_modules/browserify-fs/index.js'),
  'buffer': path.resolve('./node_modules/buffer/index.js'),
  'events': path.resolve('./node_modules/events/events.js'),
  'util': path.resolve('./node_modules/util/util.js'),
  'url': path.resolve('./node_modules/url/url.js'),
  'assert': path.resolve('./node_modules/assert/build/assert.js'),
  'path': path.resolve('./node_modules/path/path.js'),
})

const config = {
  watch: process.argv.includes('-w') || process.argv.includes('--watch'),
  // entryPoints: ['./src/index.tsx'],
  format: 'esm',
  bundle: true,
  // inject: ['./src/react-shim.ts'],
  // outfile: './build/index.js',
  publicPath: '/',
  minify: process.argv.includes('-m') || process.argv.includes('--minify'),
  jsxFactory: 'jsx',
  loader: {
    '.ttf': 'file',
    '.eot': 'file',
    '.woff': 'file',
    '.woff2': 'file',
    '.png': 'file',
    '.jpg': 'file',
    '.svg': 'file'
  },
  plugins: [polyfills],
  define: {
    'global': 'globalThis',
    'process.platform': '"web"',
    'process.env.WEB_ORIGIN': '"http://localhost:1234"',
    'process.env.WEB_SANDBOX_ORIGIN': '"http://localhost:2345"',
    'process.env.PROXY_ORIGIN': '"http://localhost:4001"', // https://dev.proxy.fkn.app // http://localhost:4001
    'process.env.PROXY_VERSION': '"v0"'
  }
}

esbuild.build({
  ...config,
  entryPoints: ['./src/index.tsx'],
  outfile: './build/index.js',
  inject: ['./src/react-shim.ts'],
  external: [
    'react',
    '@emotion/react',
    'react-dom'
  ]
  // plugins: [
  //   ...config.plugins,
  //   {
  //     name: 'make-all-packages-external',
  //     setup(build) {
  //       let filter = /^[^.\/]|^\.[^.\/]|^\.\.[^\/]/ // Must not start with "/" or "./" or "../"
  //       build.onResolve({ filter }, async args => {
  //         const resolvedPath = await esbuildResolve(args.path, '.')
  //         const result = resolvedPath ? path.relative('./node_modules', resolvedPath).replaceAll('\\', '/') : args.path
  //         return ({ path: result, external: true })
  //       })
  //     },
  //   }
  // ]
}).catch(err => console.error(err))

esbuild.build({
  ...config,
  entryPoints: ['./src/test.tsx'],
  outfile: './build/test.js',
  inject: ['./src/react-shim.ts']
}).catch(err => console.error(err))

esbuild.build({
  ...config,
  entryPoints: ['./src/worker.ts'],
  outfile: './build/worker.js',
  inject: ['./src/worker-shim.ts']
}).catch(err => console.error(err))

if (process.argv.includes('-s') || process.argv.includes('--serve')) {
  http
    .createServer(async (req, res) => {
      const url = new URL(req.url, 'http://localhost:1234')
      try {
        res.setHeader('Content-Type', mime.getType(path.resolve('./', path.join('build', url.pathname))))
        res.setHeader('Content-Length', fs.statSync(path.resolve('./', path.join('build', url.pathname))).size)
        await new Promise((resolve, reject) =>
          fs
            .createReadStream(path.resolve('./', path.join('build', url.pathname)))
            .on('error', reject)
            .on('finish', resolve)
            .pipe(res)
        )
      } catch (err) {
        res.setHeader('Content-Type', mime.getType(path.resolve('./', 'build/index.html')))
        res.setHeader('Content-Length', fs.statSync(path.resolve('./', 'build/index.html')).size)
        fs
          .createReadStream(path.resolve('./', 'build/index.html'))
          .pipe(res)
      }
    })
    .listen(1234)
}
