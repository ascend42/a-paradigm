import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'schema/index': 'src/schema/index.ts',
    'migration/index': 'src/migration/index.ts',
    logger: 'src/logger.ts',
    telemetry: 'src/telemetry.ts',
  },
  format: ['esm'],
  dts: true,
  clean: true,
});
