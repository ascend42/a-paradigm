import { defineConfig } from 'tsup';

// sherpa-onnx-node is an OPTIONAL native dependency: it is loaded with a dynamic import only when a real engine is
// built (src/engines/sherpa.ts), so it stays external and a host without it still runs the non-engine verbs.
export default defineConfig({
  entry: { index: 'src/index.ts', cli: 'src/cli.ts' },
  format: ['esm'],
  dts: { entry: { index: 'src/index.ts' } },
  clean: true,
  target: 'node24',
  platform: 'node',
  splitting: false,
  external: ['sherpa-onnx-node'],
  removeNodeProtocol: false,
});
