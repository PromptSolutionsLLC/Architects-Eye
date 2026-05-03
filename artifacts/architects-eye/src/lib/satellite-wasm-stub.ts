/**
 * Build-time stub for satellite.js v7's wasm-build entry files.
 *
 * `satellite.js` re-exports `dist/wasm/index.js`, whose `runtimes/index.js`
 * does `await import('#wasm-single-thread')` and `await import('#wasm-multi-thread')`.
 * Those subpath imports resolve to:
 *   - wasm-build/base-release/index.js
 *   - wasm-build/pthreads-release/index.js
 * Both pull in `node:module` / `node:worker_threads` and the pthreads
 * one uses top-level await, which Rollup's iife output cannot emit.
 *
 * Architect's Eye only uses the pure-JS classic API
 * (twoline2satrec, propagate, gstime, eciToGeodetic) which lives in
 * `dist/io.js`, `dist/propagation.js`, `dist/transforms.js` and does
 * NOT touch the wasm runtimes. We therefore alias both wasm-build
 * entries to this stub at build time. If anything ever calls
 * `createSingleThreadRuntime()` / `createMultiThreadRuntime()` at
 * runtime, the dynamic import will resolve to the stub below and
 * the rejection will be loud and traceable.
 */
const stub = async () => {
  throw new Error(
    "[satellite.js wasm runtime stubbed at build time] " +
      "Architect's Eye does not use the wasm runtime; only the pure-JS " +
      "classic API (twoline2satrec / propagate / gstime / eciToGeodetic) " +
      "is available. See artifacts/architects-eye/src/lib/satellite-wasm-stub.ts.",
  );
};

export default stub;
