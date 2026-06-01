import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/server/index.ts'],
  format: ['esm'],
  dts: { resolve: true },
  clean: true,
  treeshake: true,
  minify: true,
  external: ['express', 'open'],
  // @a-company/university-core MUST be bundled INTO the serve output, not left
  // as an unresolved external. The CLI loads this server via a dynamic
  // `import('@a-company/university/server')` and `university` is NOT in the
  // standard build chain, so an externalized bare specifier would break `serve`
  // at runtime while every unit test still passes (extract-university-core spec
  // §6.4, TOP-3 RISK). tsup auto-externalizes everything in package.json
  // `dependencies`; noExternal overrides that for the lean shared core.
  noExternal: [/@a-company\/university-core/],
});
