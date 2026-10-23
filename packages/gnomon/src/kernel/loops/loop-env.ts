/**
 * @symbol #loop-check
 * @symbol #loop-act
 *
 * Loop secrets from env FILES (TD-2026-10-23-268 follow-up; docs/specs/gnomon-loops.md §4 "Environment"). The daemon
 * re-execs with a clean env (lifecycle/env.ts cleanReexecEnv), so a loop's named variables never come from the
 * daemon's process.env. The kernel reads them, at resolve time and never in the child, in this order:
 *   1. the home file `<gnomon home>/loop-env` (`~/.gnomon/loop-env`), read FIRST (Aegis M4: a repo file can never
 *      shadow a value the human keeps there). It is refused (the node fails, with the reason) unless it is a regular
 *      file owned by this user with mode 0600 or 0400 (never a symlink). An absent home file is simply skipped;
 *   2. the loop's `envFiles` (repo-relative, `~/…` or absolute; at most 8; on the trust card and in its hash), in
 *      order. A linked file that is missing, unreadable, a symlink, not a regular file (a FIFO is refused without
 *      blocking: O_NONBLOCK, Aegis M2) or over 1 MiB fails the node. A repo-relative file must resolve inside the
 *      repo (its parent realpath'd: a directory link cannot escape, M3); no file may resolve inside the Gnomon home
 *      (but loop-env itself); a file named like a config the tools run (package.json, tsconfig.json … isClosureName,
 *      the `.env*` rule excepted) is refused (L1). Credential stores are NOT refused (founder: no gatekeeping); the
 *      card shows every file's real path and whether it is outside the repo or tracked by git (M4). A file outside
 *      the repo fails with a short "cannot be used: <path>" (L3).
 * Only the names a node declares in `env:` are taken; nothing else in the files is used. A declared name found in no
 * file (or found empty) is `env-missing`, naming the files tried. Every open is O_NOFOLLOW. Values are never hashed,
 * stored, logged or put in rows: editing a value needs no re-trust.
 *
 * Dotenv format: KEY=value, an optional `export ` prefix, single quotes (literal) and double quotes (\n \r \t \" \\
 * escapes), both may span lines; `#` comments (a whole line, or after whitespace in an unquoted value); CRLF and a
 * BOM tolerated. NO variable expansion and NO command substitution: `$X` and `$(cmd)` stay literal text.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { loopEnvHazard } from '../runner/env.js';
import { isConfigNamedEnvFile } from '../manifest/layers.js';
import type { CompiledLoop } from '../../loops/index.js';

/** TD-2026-10-23-268: every env name the loop's check and act nodes declare, first-seen order, no duplicates. */
export function loopEnvNames(c: Pick<CompiledLoop, 'nodes'>): string[] {
  const out = new Set<string>();
  for (const n of c.nodes) if ((n.type === 'check' || n.type === 'model') && n.env) for (const k of n.env) out.add(k);
  return [...out];
}

export const LOOP_ENV_FILE_MAX_BYTES = 1024 * 1024;
export const LOOP_ENV_FILES_MAX = 8;
/** The home-level env file, inside the Gnomon home. */
export const LOOP_HOME_ENV_FILE = 'loop-env';
/** How the card and the reasons name the home file. */
export const LOOP_HOME_ENV_SHOWN = '~/.gnomon/loop-env';

export interface LoopEnvFile {
  /** the absolute path the kernel opens */
  path: string;
  /** how the loop wrote it (the card's and the reasons' name) */
  shown: string;
  /** a repo-relative entry: the repo root it must resolve inside */
  repoRoot?: string;
}

export interface LoopEnvSource {
  /** the loop's envFiles, resolved (loopEnvFilesOf) */
  files: readonly LoopEnvFile[];
  /** the home file's absolute path (`<gnomon home>/loop-env`); absent: no home file */
  home?: string;
}

export type LoopEnvResolution =
  | { ok: true; env: Record<string, string> }
  | { ok: false; code: 'env-refused' | 'env-missing' | 'env-file'; reason: string };

/** One value a loop handed out, for literal redaction (never stored). */
export interface LoopLiteral {
  name: string;
  value: string;
}

/** The loop's envFiles as absolute paths: `~/x` under the OS home, a relative path under the repo. */
export function loopEnvFilesOf(envFiles: readonly string[] | undefined, repoRoot: string, userHome: string): LoopEnvFile[] {
  return (envFiles ?? []).map((shown) => ({
    shown,
    path: shown === '~' || shown.startsWith('~/') ? path.join(userHome, shown.slice(2)) : path.isAbsolute(shown) ? shown : path.join(repoRoot, shown),
    ...(shown.startsWith('~') || path.isAbsolute(shown) ? {} : { repoRoot }),
  }));
}

/** The repo-relative env files (as repo paths, `./` dropped): kept out of the config closure and the check copy. */
export function repoEnvFiles(envFiles: readonly string[] | undefined): string[] {
  return (envFiles ?? []).filter((f) => !f.startsWith('/') && !f.startsWith('~') && !/^[A-Za-z]:[\\/]/.test(f)).map((f) => path.posix.normalize(f).replace(/^(\.\/)+/, ''));
}

/** Parse dotenv text (see the header). Later assignments of a name win. */
export function parseDotenv(text: string): Map<string, string> {
  const out = new Map<string, string>();
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.replace(/^\s+/, '');
    if (!line || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s?(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1]!;
    let rest = m[2]!.replace(/^\s+/, '');
    const q = rest[0];
    if (q === '"' || q === "'") {
      // a quoted value: up to the closing quote, across lines when it does not close on this one
      let body = rest.slice(1);
      let close = closingQuote(body, q);
      while (close < 0 && i + 1 < lines.length) {
        body += `\n${lines[++i]!}`;
        close = closingQuote(body, q);
      }
      if (close < 0) continue; // never closed: not a value
      const raw = body.slice(0, close);
      out.set(key, q === "'" ? raw : raw.replace(/\\([nrt"\\])/g, (_, c: string) => (c === 'n' ? '\n' : c === 'r' ? '\r' : c === 't' ? '\t' : c)));
      continue;
    }
    rest = rest.replace(/\s+#.*$/, '');
    out.set(key, rest.trim());
  }
  return out;
}

function closingQuote(body: string, q: string): number {
  for (let j = 0; j < body.length; j++) {
    if (q === '"' && body[j] === '\\') {
      j++;
      continue;
    }
    if (body[j] === q) return j;
  }
  return -1;
}

const NOFOLLOW = fs.constants.O_NOFOLLOW ?? 0;
// Aegis M2: a FIFO (or a device) opens without blocking, then fstat refuses it
const NONBLOCK = fs.constants.O_NONBLOCK ?? 0;

/** Read one env file in the kernel: O_NOFOLLOW, a regular file, ≤ 1 MiB; `owner` also needs this user and 0600/0400. */
export function readEnvFile(p: string, shown: string, o: { owner?: boolean } = {}): { ok: true; vars: Map<string, string> } | { ok: false; absent: boolean; reason: string } {
  let fd: number;
  try {
    fd = fs.openSync(p, fs.constants.O_RDONLY | NOFOLLOW | NONBLOCK);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return { ok: false, absent: true, reason: `the env file ${shown} does not exist` };
    if (code === 'ELOOP' || code === 'EMLINK') return { ok: false, absent: false, reason: `the env file ${shown} is a symlink (env files are read without following links)` };
    return { ok: false, absent: false, reason: `the env file ${shown} cannot be read (${code ?? 'error'})` };
  }
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile()) return { ok: false, absent: false, reason: `the env file ${shown} is not a regular file` };
    if (st.size > LOOP_ENV_FILE_MAX_BYTES) return { ok: false, absent: false, reason: `the env file ${shown} is larger than 1 MiB` };
    if (o.owner && process.platform !== 'win32') {
      const uid = process.getuid?.();
      const mode = st.mode & 0o777;
      if ((uid !== undefined && st.uid !== uid) || (mode !== 0o600 && mode !== 0o400)) {
        return { ok: false, absent: false, reason: `${shown} must be owner-only (chmod 600 ${shown}); it is ${mode.toString(8).padStart(4, '0')}${uid !== undefined && st.uid !== uid ? ' and owned by another user' : ''}` };
      }
    }
    const buf = Buffer.alloc(st.size);
    let off = 0;
    while (off < st.size) {
      const n = fs.readSync(fd, buf, off, st.size - off, off);
      if (n <= 0) break;
      off += n;
    }
    return { ok: true, vars: parseDotenv(buf.subarray(0, off).toString('utf8')) };
  } catch (err) {
    return { ok: false, absent: false, reason: `the env file ${shown} cannot be read (${(err as NodeJS.ErrnoException).code ?? 'error'})` };
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * The values of `names` from the loop's env files, then the home file (see the header). Every name must pass
 * loopEnvHazard; every linked file must read; every name must be found non-empty.
 */
export function resolveLoopEnvFiles(names: readonly string[] | undefined, src: LoopEnvSource): LoopEnvResolution {
  const want = [...(names ?? [])];
  if (!want.length) return { ok: true, env: {} };
  for (const n of want) {
    const why = loopEnvHazard(n);
    if (why) return { ok: false, code: 'env-refused', reason: `env ${n.slice(0, 64)} is refused: ${why}` };
  }
  const env: Record<string, string> = {};
  const take = (vars: Map<string, string>): void => {
    for (const n of want) if (env[n] === undefined && vars.get(n)) env[n] = vars.get(n)!;
  };
  const tried: string[] = [];
  if (src.home) {
    tried.push(LOOP_HOME_ENV_SHOWN);
    const r = readEnvFile(src.home, LOOP_HOME_ENV_SHOWN, { owner: true });
    if (r.ok) take(r.vars);
    else if (!r.absent) return { ok: false, code: 'env-file', reason: r.reason };
  }
  for (const f of src.files) {
    tried.push(f.shown);
    const bad = envFileRefusal(f, src.home);
    if (bad) return { ok: false, code: 'env-file', reason: bad };
    const home = isHomeFile(f, src.home);
    const r = readEnvFile(f.path, home ? LOOP_HOME_ENV_SHOWN : f.shown, { owner: home });
    if (!r.ok) return { ok: false, code: 'env-file', reason: f.repoRoot || home ? r.reason : `the env file cannot be used: ${f.shown}` };
    take(r.vars);
  }
  const missing = want.filter((n) => env[n] === undefined);
  if (missing.length) {
    return { ok: false, code: 'env-missing', reason: `env ${missing.join(', ')} ${missing.length === 1 ? 'was' : 'were'} not found in ${tried.length ? tried.join(', ') : 'any env file (the loop names none, and there is no ~/.gnomon/loop-env)'}` };
  }
  return { ok: true, env };
}

const insideDir = (p: string, dir: string): boolean => {
  const rel = path.relative(dir, p);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

/** Where a linked env file really is: its parent realpath'd plus its own name (O_NOFOLLOW refuses a final link). */
export function envFileReal(f: Pick<LoopEnvFile, 'path'>): string | null {
  try {
    return path.join(fs.realpathSync.native(path.dirname(f.path)), path.basename(f.path));
  } catch {
    return null;
  }
}

/** A linked entry that IS ~/.gnomon/loop-env (read with the same owner-only rule). */
function isHomeFile(f: LoopEnvFile, homeFile?: string): boolean {
  if (!homeFile) return false;
  const real = envFileReal(f);
  const h = envFileReal({ path: homeFile });
  return real !== null && real === h;
}

/**
 * Aegis M3 / L1: why a linked env file cannot be used (null: it can). A repo-relative file must resolve inside its
 * repo; no file may resolve inside the Gnomon home (loop-env itself is the home file, never linked); a name the tools
 * run as config (isClosureName, the `.env*` rule excepted) is refused. Outside the repo the reason stays short (L3).
 */
export function envFileRefusal(f: LoopEnvFile, homeFile?: string): string | null {
  const name = path.basename(f.path);
  if (isConfigNamedEnvFile(name)) return `the env file ${f.shown} is named like a config file tools run (${name}); use a dotenv file such as .env.loop`;
  const real = envFileReal(f);
  if (real === null) return f.repoRoot ? `the env file ${f.shown} does not exist` : `the env file cannot be used: ${f.shown}`;
  if (f.repoRoot) {
    let root: string;
    try {
      root = fs.realpathSync.native(f.repoRoot);
    } catch {
      return `the env file ${f.shown} does not exist`;
    }
    if (!insideDir(real, root)) return `the env file ${f.shown} resolves outside this repo (${real})`;
  }
  if (homeFile) {
    const gnomonHome = (() => {
      try {
        return fs.realpathSync.native(path.dirname(homeFile));
      } catch {
        return path.dirname(homeFile);
      }
    })();
    if (insideDir(real, gnomonHome) && real !== path.join(gnomonHome, path.basename(homeFile))) return `the env file cannot be used: ${f.shown} (inside the Gnomon home)`;
  }
  return null;
}

/** Best effort, for redaction only: every value of `names` the files give now (unreadable files skipped). Never stored. */
export function loopLiterals(names: readonly string[], src: LoopEnvSource): LoopLiteral[] {
  if (!names.length) return [];
  const found = new Map<string, string>();
  const take = (vars: Map<string, string>): void => {
    for (const n of names) if (!found.has(n) && vars.get(n)) found.set(n, vars.get(n)!);
  };
  if (src.home) {
    const r = readEnvFile(src.home, LOOP_HOME_ENV_SHOWN, { owner: true });
    if (r.ok) take(r.vars);
  }
  for (const f of src.files) {
    if (envFileRefusal(f, src.home)) continue;
    const r = readEnvFile(f.path, f.shown, { owner: isHomeFile(f, src.home) });
    if (r.ok) take(r.vars);
  }
  return [...found].map(([name, value]) => ({ name, value }));
}

/** Resolved values as literals (for one node's own redaction). */
export const literalsOf = (env: Readonly<Record<string, string>>): LoopLiteral[] => Object.entries(env).map(([name, value]) => ({ name, value }));

export interface EnvCardContext {
  repoRoot: string;
  userHome: string;
  /** the Gnomon home (its loop-env is read first) */
  gnomonHome: string;
  /** is this repo-relative path tracked by git? (default: never asked) */
  tracked?: (rel: string) => boolean;
}

/**
 * Aegis M3/M4: the card's env lines. "reads env from:" lists every source in lookup order with its real path and
 * where it lives (repo, tracked by git, outside this repo); then one line per name with the source that holds it NOW
 * (names only: the kernel reads the files and keeps nothing), or its candidates when no file holds it yet; and, with
 * network on, the plain warning that the repo's code can read and send the values.
 */
export function envCardLines(c: Pick<CompiledLoop, 'nodes' | 'envFiles' | 'network'>, x: EnvCardContext): string[] {
  const names = loopEnvNames(c);
  if (!names.length && !c.envFiles?.length) return [];
  const homeFile = path.join(x.gnomonHome, LOOP_HOME_ENV_FILE);
  const files = loopEnvFilesOf(c.envFiles, x.repoRoot, x.userHome);
  const label = (f: LoopEnvFile): string => {
    if (!f.repoRoot) return `${f.shown} (outside this repo)`;
    const rel = repoEnvFiles([f.shown])[0] ?? f.shown;
    return `${f.shown} (repo${x.tracked?.(rel) ? ', tracked by git' : ''})`;
  };
  const out: string[] = [];
  const shownFiles = files.map((f) => {
    const real = envFileReal(f);
    const bad = envFileRefusal(f, homeFile);
    return `${label(f)}${real ? ` → ${real}` : ''}${bad ? ' [cannot be used now]' : ''}`;
  });
  out.push(`reads env from: ${[`${LOOP_HOME_ENV_SHOWN} (read first)`, ...shownFiles].join(', then ')}`);
  // which source holds each name now (values read and dropped at once)
  const holder = new Map<string, string>();
  const home = readEnvFile(homeFile, LOOP_HOME_ENV_SHOWN, { owner: true });
  if (home.ok) for (const n of names) if (home.vars.get(n) && !holder.has(n)) holder.set(n, LOOP_HOME_ENV_SHOWN);
  for (const f of files) {
    if (envFileRefusal(f, homeFile)) continue;
    const r = readEnvFile(f.path, f.shown);
    if (r.ok) for (const n of names) if (r.vars.get(n) && !holder.has(n)) holder.set(n, label(f));
  }
  const candidates = [LOOP_HOME_ENV_SHOWN, ...files.map(label)].join(', then ');
  for (const n of names) out.push(holder.has(n) ? `${n} ← ${holder.get(n)}` : `${n} ← not set yet (looks in ${candidates})`);
  if (names.length && c.network === 'on') out.push(`this loop runs this repo's code with ${names.join(', ')} and network access: anyone who can change the repo's code can read and send them.`);
  return out;
}
