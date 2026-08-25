/**
 * `bare-tap`, declared only as far as these suites drive it.
 *
 * `sodium-native` is declared here and not in `artifact-kit`, which is the rule
 * `platform-documents/vendor.d.ts` states working as intended rather than an
 * oddity. A sibling's vendor declarations deliberately do not travel through a
 * `file:` link — two ambient definitions of one specifier is a duplicate the
 * consumer cannot edit its way out of — so a consumer that type-checks a
 * sibling's source declares what that source needs. `artifact-kit/lib/page.js`
 * hashes its script with it; these are the two symbols it touches.
 *
 * `bare-buffer` is required by name instead, because it ships real types.
 * `platform-listen` learned that the expensive way: a hand-written declaration
 * for a module that has its own is a typechecker agreeing with you rather than
 * with the code.
 */
declare module 'sodium-native' {
  export const crypto_hash_sha256_BYTES: number
  export function crypto_hash_sha256 (out: Uint8Array, input: Uint8Array): void
}
declare module 'bare-tap' {
  const tap: {
    plan (n: number): void
    pass (message?: string): void
    fail (message?: string): void
  }
  export = tap
}

/**
 * `require.resolve`, which the suites use to read this package's own source.
 *
 * Bare's `require` is a real global here; only the member these files touch is
 * declared, so a suite reaching for `require.cache` gets an error that is a
 * prompt rather than a silent `any`.
 */
declare const require: {
  (specifier: string): any
  resolve (specifier: string): string
}

/**
 * Two Bare globals these suites use: the directory a test file sits in, so it
 * can read the manifests beside this repository, and the timer that lets a case
 * wait for the page's first drawing to land.
 *
 * Declared rather than pulled in with `"types": ["bare"]` for the reason above:
 * a hand-written declaration is only ever as narrow as what is actually touched,
 * so reaching for something else is an error that prompts rather than an `any`.
 */
declare const __dirname: string
declare function setTimeout (fn: () => void, ms?: number): number
