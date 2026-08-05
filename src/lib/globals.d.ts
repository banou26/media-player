/**
 * The library ships an inline SVG asset, so it declares the module shape itself rather than relying
 * on `vite/client`, which belongs to the app and is not in the library's type surface.
 */
declare module '*.svg' {
  const src: string
  export default src
}
