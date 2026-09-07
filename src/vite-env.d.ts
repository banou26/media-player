/// <reference types="vite/client" />

/**
 * `?no-inline&url`, which vite understands and vite's own ambient `*?url` declaration does not match.
 *
 * The wildcard in `declare module '*?url'` only matches a specifier ENDING in `?url`, so appending
 * any second query parameter takes the import out of its reach. jassub's wasm and fallback font need
 * `no-inline` to stay files rather than base64 in a library build, so they need this.
 */
declare module '*?no-inline&url' {
  const url: string
  export default url
}
