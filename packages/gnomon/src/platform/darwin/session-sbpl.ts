/**
 * @symbol #session-runner
 *
 * The darwin backend of the `session` sandbox profile (spec §15.5 row
 * `session`, §16 "Session denies"; p10m, p10m-claude-compat, P8-D79/D80;
 * T-2026-10-18-008). Generated from #manifest-loader's platform-neutral
 * SessionPolicy DATA (kernel/manifest/policy.ts) and the class → mechanism
 * table (platform/session-denies.ts): allow-default, then
 *   - `file-read*` deny on policy.denyRead (the whole Gnomon home included),
 *     then `allow file-read*` on policy.allowRead (own session dir, the exec'd
 *     binary copy, the runner copy), `allow file-read-metadata` on their
 *     literal ancestors (realpath lstat's them), and `file-read*` deny again
 *     on policy.denyReadAlways (keys, the kernel log) — last match wins
 *     (T-2026-10-18-010);
 *   - `file-write*` deny on
 *     policy.denyWrite + the T-008 git denies (a `.git` POINTER FILE literal,
 *     `<gitDir>/config.worktree`, `<commonDir>/modules/**​/{hooks,config,info}`
 *     by regex), then `allow file-write*` on policy.allowWrite (only
 *     `~/.claude/projects`, TD-2026-10-19-814) and `file-write*` deny again on
 *     policy.denyWriteAlways (denies inside the carve-back);
 *   - `network-outbound (remote ip "localhost:<port>")` per endpoint port;
 *   - `process-info*` denied except self, `kern.proc` sysctl, and the
 *     `com.apple.sysmond` mach-lookup (without it pgrep reads every argv);
 *   - unix-socket connects to the tmux dir (`/private/tmp/tmux-<uid>`) and
 *     the screen dirs (`$TMPDIR/.screen`, `/private/tmp/screens`, `~/.screen`);
 *   - `appleevent-send`, `device-microphone`, `device-camera`;
 *   - with `appleevent-send`, a service-level deny: `mach-lookup` of
 *     APPLEEVENT_MACH_SERVICES (appleeventsd), so a sender whose in-process
 *     `appleevent-send` check does not run still cannot reach the AppleEvent
 *     service (CI run 39100811385);
 *   - `process-exec` of /usr/bin/open, /usr/bin/osascript, lsregister and
 *     /bin/launchctl, by realpath (P8-D80; launchctl is the service-manager
 *     class).
 * Every path is realpath'd (loose: the longest existing prefix) — SBPL
 * matches resolved paths and an unresolved path is a deny that silently does
 * not apply (p10m). A path SBPL cannot express (a quote, backslash or
 * newline) refuses the whole profile (fail closed).
 * COPIES of these launchers: on macOS 15 (darwin 24) launch constraints
 * SIGKILL an Apple platform binary started from another path, sandboxed or
 * not (cp /bin/launchctl, /usr/bin/osascript, /usr/bin/open, also re-signed
 * ad hoc ⇒ exit 137). On macOS 14 (CI macos-14) a copied launchctl RUNS and
 * exits 1: launchd refuses submit/bootstrap/list from any sandbox-exec'd
 * caller (measured on 15 under `(allow default)`; the test asserts on every
 * version that a copied launchctl cannot submit a job and a copied osascript
 * cannot send an AppleEvent). A copied `open` on macOS < 15 is a
 * LaunchServices launcher — the accepted residual of §A.2(i).
 * COPIED_PLATFORM_BINARY_KILLED_FROM_MACOS is that version boundary (data,
 * read by tests; no kernel branch).
 * T-2026-10-18-028 M5 — the signed helper, ALWAYS (not a policy class): the
 * session can neither exec nor read GnomonHelper.app, the pinned bundle or any
 * copy of it, nor exec any file named `gnomon-helper` (HELPER_EXEC_DENY /
 * HELPER_READ_DENY, regexes on the RESOLVED path, so a symlink is no way round).
 * Unreadable means it cannot be copied out; a copy that keeps the executable
 * name is still denied; a bare copy of the executable alone is SIGKILLed by
 * the OS (its signature needs the bundle; measured 2026-10-18). Backstop: the
 * helper refuses `serve`/`once` under ANY sandbox (main.swift isSandboxed,
 * fail closed if the check cannot be made), and a session's children inherit
 * the profile. Residual: a copy renamed in BOTH bundle and executable needs an
 * edited Info.plist, which breaks the signature.
 * Not realised here (reported by sessionDenyCoverage): the helper's XPC
 * service name (`ipc:helper-service` — no XPC service yet).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { realpathLoose, type PolicyPath, type SessionPolicy } from '../../kernel/manifest/policy.js';

export const SESSION_PROFILE_VERSION = 5; // 4: T-2026-10-18-028 M5 helper exec/read denies; 5: TD-2026-10-19-814 transcript write carve-back

/** macOS major from which a relocated Apple platform binary is SIGKILLed (launch constraints; observed 15 yes, 14 no). */
export const COPIED_PLATFORM_BINARY_KILLED_FROM_MACOS = 15;
/**
 * The session profile's macOS floor (P8 note, CI run 39100281741): below 15 a
 * relocated platform binary is not SIGKILLed, and on macos-14 a copied
 * osascript reached System Events from inside the profile. The darwin
 * session backend REFUSES below this major (fail closed).
 */
export const SESSION_SANDBOX_MIN_MACOS = 15;

/**
 * The AppleEvent service (appleeventsd), denied by name with
 * `(deny appleevent-send)` (CI run 39100811385). Narrow on purpose: a
 * `com.apple.coreservices.*` / `com.apple.lsd.*` deny would take
 * LaunchServices from Claude Code; measured 2026-10-17 that even a
 * deny-ALL mach-lookup does not stop `tell application "System Events" to get
 * name`, which AppleScript answers without sending an event (see spec §A.2(iv)).
 */
export const APPLEEVENT_MACH_SERVICES = Object.freeze(['com.apple.coreservices.appleevents']);

export const DARWIN_LAUNCHERS = Object.freeze([
  '/usr/bin/open',
  '/usr/bin/osascript',
  '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister',
  '/bin/launchctl',
  '/usr/bin/shortcuts',
  '/usr/bin/automator',
]);

/** M5: exec of the helper bundle (pinned or a copy) and of any file named gnomon-helper (SBPL regex, resolved paths). */
export const HELPER_EXEC_DENY = Object.freeze(['/GnomonHelper\\.app(/|$)', '/gnomon-helper$']);
/** M5: the helper bundle is unreadable from a session, so it cannot be copied out. */
export const HELPER_READ_DENY = Object.freeze(['/GnomonHelper\\.app(/|$)']);

/** The M5 helper deny lines, appended to every session profile. */
export function helperDenySbpl(): string[] {
  const rx = (r: string): string => `(regex #"${r}")`;
  return [`(deny process-exec ${HELPER_EXEC_DENY.map(rx).join(' ')})`, `(deny file-read* ${HELPER_READ_DENY.map(rx).join(' ')})`];
}

export interface DarwinSessionExtras {
  uid: number;
  /** the daemon's TMPDIR (screen's socket dir lives under it) */
  tmpdir: string;
  home: string;
  /** cwd + worktree: their git pointer files / config.worktree / modules are denied */
  roots: readonly string[];
}

export class SbplError extends Error {}

const q = (p: string): string => {
  if (/["\\\n\r]/.test(p)) throw new SbplError(`path not expressible in SBPL: ${JSON.stringify(p)}`);
  return `"${p}"`;
};

const reEscape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/** One letter-case-insensitive SBPL regex fragment for an ASCII word (`claude` => `[Cc][Ll]…`). */
const ci = (w: string): string => [...w].map((c) => (/[a-z]/i.test(c) ? `[${c.toUpperCase()}${c.toLowerCase()}]` : reEscape(c))).join('');

function filter(p: PolicyPath): string {
  if (p.match === 'steering') {
    // P8-D97 R1: under the root, at any depth, any case: CLAUDE*.md files, and .claude dirs with everything in them
    q(p.path); // refuse an inexpressible root before it reaches the regex
    const r = reEscape(p.path);
    return `(regex #"^${r}/(.+/)?${ci('claude')}[^/]*\\.${ci('md')}$") (regex #"^${r}/(.+/)?\\.${ci('claude')}(/.*)?$")`;
  }
  if (p.match === 'dep-steering') {
    // P8-D97 F2: under the root, inside any node_modules, any case: CLAUDE*.md files and .claude dirs (read-deny)
    q(p.path);
    const r = reEscape(p.path);
    const nm = '(.+/)?node_modules/(.+/)?';
    return `(regex #"^${r}/${nm}${ci('claude')}[^/]*\\.${ci('md')}$") (regex #"^${r}/${nm}\\.${ci('claude')}(/.*)?$")`;
  }
  return `(${p.match === 'subpath' ? 'subpath' : p.match === 'prefix' ? 'prefix' : 'literal'} ${q(p.path)})`;
}

/** T-008: the git denies beyond policy.ts's hooks/config/info (pointer file, config.worktree, submodules). */
export function extraGitDenies(roots: readonly string[]): { filters: string[]; paths: string[] } {
  const filters: string[] = [];
  const paths: string[] = [];
  for (const r of roots) {
    const dotgit = path.join(r, '.git');
    let st: fs.Stats | null = null;
    try {
      st = fs.lstatSync(dotgit);
    } catch {
      st = null;
    }
    if (!st) continue;
    let gitDir = dotgit;
    if (st.isFile()) {
      paths.push(realpathLoose(dotgit));
      filters.push(`(literal ${q(realpathLoose(dotgit))})`);
      const m = /^gitdir:\s*(.+?)\s*$/m.exec(fs.readFileSync(dotgit, 'utf8'));
      if (m) gitDir = path.resolve(r, m[1]!);
    }
    let commonDir = gitDir;
    try {
      commonDir = path.resolve(gitDir, fs.readFileSync(path.join(gitDir, 'commondir'), 'utf8').trim());
    } catch {
      commonDir = gitDir;
    }
    for (const g of new Set([realpathLoose(gitDir), realpathLoose(commonDir)])) {
      paths.push(path.join(g, 'config.worktree'));
      filters.push(`(literal ${q(path.join(g, 'config.worktree'))})`);
      q(g); // refuse an inexpressible root before it reaches the regex
      filters.push(`(regex #"^${reEscape(g)}/modules/.*/(hooks|info)(/.*)?$")`, `(regex #"^${reEscape(g)}/modules/.*/config$")`);
    }
  }
  return { filters: [...new Set(filters)], paths: [...new Set(paths)] };
}

export function sessionProfileSbpl(policy: SessionPolicy, x: DarwinSessionExtras): string {
  const git = extraGitDenies(x.roots);
  const screenDirs = [path.join(x.tmpdir, '.screen'), '/private/tmp/screens', path.join(x.home, '.screen')].map(realpathLoose);
  const launchers = DARWIN_LAUNCHERS.map(realpathLoose);
  const lines = [
    `;; gnomon session profile v${SESSION_PROFILE_VERSION} (spec §15.5) — generated from ${policy.schemaVersion}, every path realpath'd`,
    '(version 1)',
    '(allow default)',
  ];
  if (policy.denyRead.length) lines.push(`(deny file-read* ${policy.denyRead.map(filter).join(' ')})`);
  // T-2026-10-18-010: SBPL's last matching rule wins — the carve-backs follow the home deny, and keys + the kernel log are re-denied after them
  if (policy.allowRead.length) lines.push(`(allow file-read* ${policy.allowRead.map(filter).join(' ')})`);
  if (policy.allowReadMetadata.length) lines.push(`(allow file-read-metadata ${policy.allowReadMetadata.map(filter).join(' ')})`);
  if (policy.denyReadAlways.length) lines.push(`(deny file-read* ${policy.denyReadAlways.map(filter).join(' ')})`);
  lines.push(`(deny file-write* ${[...policy.denyWrite.map(filter), ...git.filters].join(' ')})`);
  // TD-2026-10-19-814 item 1 (probe p-resume): the transcript carve-back AFTER the ~/.claude deny (last match wins),
  // then every deny inside it again (and the T-008 git denies, whose regexes cannot be judged by path: harmless
  // repeats); no later rule in this profile allows file-write*
  // a policy object without the fields (built before TD-2026-10-19-814) renders no carve-back: fail closed
  const allowWrite = policy.allowWrite ?? [];
  if (allowWrite.length) {
    lines.push(`(allow file-write* ${allowWrite.map(filter).join(' ')})`);
    const again = [...(policy.denyWriteAlways ?? []).map(filter), ...git.filters];
    if (again.length) lines.push(`(deny file-write* ${again.join(' ')})`);
  }
  for (const port of policy.denyLoopbackPorts) lines.push(`(deny network-outbound (remote ip "localhost:${port}"))`);
  if (policy.processInfo === 'deny-others') {
    lines.push('(deny process-info*)', '(allow process-info* (target self))', '(deny sysctl-read (sysctl-name-prefix "kern.proc"))', '(deny mach-lookup (global-name "com.apple.sysmond"))');
  }
  const classes = new Set(policy.denyClasses);
  if (classes.has('unix-socket:tmux')) lines.push(`(deny network-outbound (remote unix-socket (subpath ${q(realpathLoose(`/private/tmp/tmux-${x.uid}`))})))`);
  if (classes.has('unix-socket:screen')) lines.push(`(deny network-outbound ${screenDirs.map((d) => `(remote unix-socket (subpath ${q(d)}))`).join(' ')})`);
  if (classes.has('automation:apple-events')) lines.push('(deny appleevent-send)', `(deny mach-lookup ${APPLEEVENT_MACH_SERVICES.map((n) => `(global-name ${q(n)})`).join(' ')})`);
  if (classes.has('media:microphone')) lines.push('(deny device-microphone)');
  if (classes.has('media:camera')) lines.push('(deny device-camera)');
  if (policy.launchers === 'deny' || classes.has('launchers') || classes.has('service-manager')) lines.push(`(deny process-exec ${launchers.map((l) => `(literal ${q(l)})`).join(' ')})`);
  // M5: last, so no later allow can re-open it
  lines.push(...helperDenySbpl());
  lines.push('');
  return lines.join('\n');
}
