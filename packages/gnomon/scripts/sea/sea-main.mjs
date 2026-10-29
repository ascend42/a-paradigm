/**
 * @symbol #kernel-sea
 *
 * The SEA kernel's main (scripts/build-sea.mjs bundles it, with dist/cli/gnomon.js and dist/cli/gnomond.js, into one
 * CommonJS file: Node 24's SEA runs a CommonJS main only). sea-prelude.mjs runs first (env, argv, import.meta.url);
 * then exactly one dist entry is initialised. esbuild turns each `import()` below into a lazy in-bundle init, so the
 * kernel code is embedded in the signed binary and nothing is loaded from disk.
 */
import './sea-prelude.mjs';

if (globalThis.__gnomonSeaEntry === 'gnomond') void import('../../dist/cli/gnomond.js');
else void import('../../dist/cli/gnomon.js');
