/**
 * @symbol #gnomon-staged
 *
 * TD-2026-10-27-833 (Aegis should-fix): the FIRST import of src/index.ts. ESM evaluates a module's imports in order,
 * depth first, so this side-effect module runs before any other module of the server evaluates: in the staged Gnomon
 * mode (PARADIGM_GNOMON_STAGED=1) the fs guard is in place before any dependency can capture or call an fs function.
 * It reads what it needs itself: the project root from argv[2] (the kernel passes the realpath'd repo root), HOME from
 * the env, and its own code dir from import.meta.url (the bundle file).
 */
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { gnomonStaged } from './utils/gnomon-staged.js';
import { installStagedGuard } from './utils/staged-guard.js';

if (gnomonStaged()) {
  installStagedGuard({ root: path.resolve(process.argv[2] ?? process.cwd()), home: os.homedir(), selfDir: path.dirname(fileURLToPath(import.meta.url)) });
}
