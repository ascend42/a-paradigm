import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/extension.ts'],
  format: ['cjs'],
  outDir: 'dist',
  external: ['vscode'],
  noExternal: [
    '@a-company/premise-core',
    '@a-company/purpose-core',
    '@a-company/portal-core',
  ],
  bundle: true,
  minify: false,
  sourcemap: true,
  clean: true,
  dts: false,
  shims: true,
  target: 'node18',
});
