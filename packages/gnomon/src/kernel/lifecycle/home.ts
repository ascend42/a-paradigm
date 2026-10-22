/**
 * @symbol $daemon-lifecycle
 *
 * $daemon-lifecycle (spec §2.4, M1.9 "home dir creation with the owner-only
 * ACL read back") — where the per-user kernel lives.
 *
 * `~/.gnomon` by default. `GNOMON_HOME` overrides it — a TEST SEAM: the clean
 * re-exec env drops every `GNOMON_*` (§2.4 rule 2, §15.3), so a detached daemon
 * learns its home from its argv (`--home`), never from the environment.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ownerOnlyDir } from '../../platform/owner-only.js';
import { LifecycleRefusal } from './refusal.js';

export const GNOMON_HOME_ENV = 'GNOMON_HOME';
export const OWNER_ONLY_DIR_MODE = 0o700;

export interface HomeResolveOptions {
  env?: Readonly<Record<string, string | undefined>>;
  homedir?: string;
}

/** The Gnomon home directory: `$GNOMON_HOME` (absolute only) or `~/.gnomon`. */
export function resolveGnomonHome(opts: HomeResolveOptions = {}): string {
  const env = opts.env ?? process.env;
  const override = env[GNOMON_HOME_ENV];
  if (override !== undefined && override !== '') {
    if (!path.isAbsolute(override)) {
      throw new LifecycleRefusal('unsafe-home', `${GNOMON_HOME_ENV} must be an absolute path`, { home: override });
    }
    return path.resolve(override);
  }
  return path.join(opts.homedir ?? os.homedir(), '.gnomon');
}

/** The current uid, or null where the OS has none (Windows). */
export function currentUid(): number | null {
  return typeof process.getuid === 'function' ? process.getuid() : null;
}

/**
 * Create the home directory owner-only (0700) and READ THE MODE BACK. An
 * existing home that is wider is tightened, then re-read; a symlink, a
 * non-directory, a foreign owner, or a mode that will not tighten refuses.
 */
export function ensureGnomonHome(home: string): string {
  if (!path.isAbsolute(home)) {
    throw new LifecycleRefusal('unsafe-home', 'home must be an absolute path', { home });
  }
  fs.mkdirSync(home, { recursive: true, mode: OWNER_ONLY_DIR_MODE });
  let st = fs.lstatSync(home);
  if (st.isSymbolicLink() || !st.isDirectory()) {
    throw new LifecycleRefusal('unsafe-home', `home ${home} is not a plain directory`, { home });
  }
  const uid = currentUid();
  if (uid !== null && st.uid !== uid) {
    throw new LifecycleRefusal('unsafe-home', `home ${home} is owned by uid ${st.uid}, not ${uid}`, { home });
  }
  if (process.platform === 'win32') {
    // G-WIN-02: a protected owner-only DACL applied by the helper and accepted only from its read-back (the owner
    // SID is checked there too); everything the kernel creates below inherits it (platform/owner-only.ts)
    try {
      ownerOnlyDir(home);
    } catch (e) {
      throw new LifecycleRefusal('unsafe-home', `home ${home}: ${e instanceof Error ? e.message : String(e)}`, { home });
    }
    return home;
  }
  if ((st.mode & 0o777) !== OWNER_ONLY_DIR_MODE) {
    fs.chmodSync(home, OWNER_ONLY_DIR_MODE);
    st = fs.lstatSync(home);
    if ((st.mode & 0o777) !== OWNER_ONLY_DIR_MODE) {
      throw new LifecycleRefusal('unsafe-home', `home ${home} mode ${(st.mode & 0o777).toString(8)} is not 700`, {
        home,
      });
    }
  }
  return home;
}
