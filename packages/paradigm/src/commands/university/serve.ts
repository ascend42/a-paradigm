/**
 * University serve — 7.11.0 redirect. The standalone University UI + server
 * were retired; content packs now live in the Platform's Academy section.
 * This launches the Platform with only the Academy enabled and opens it.
 * (Pack selectors are accepted for compatibility; the Academy lists every pack.)
 */

import { out } from '../../utils/cli-output.js';

export interface UniversityServeOptions {
  port?: string;
  open?: boolean;
  pack?: string;
  project?: boolean;
  discipline?: string;
}

export async function universityServeCommand(_path: string | undefined, options: UniversityServeOptions): Promise<void> {
  const port = parseInt(options.port || '3839', 10);
  out('University moved to Platform → Academy');
  const { startPlatformServer } = await import('../../platform-server/index.js');
  await startPlatformServer({ port, projectDir: process.cwd(), open: false, sections: ['academy'] });
  const url = `http://localhost:${port}/academy`;
  out(`Academy running at ${url}`);
  if (options.open !== false) {
    import('open').then((m) => m.default(url)).catch(() => undefined);
  }
  await new Promise(() => {});
}
