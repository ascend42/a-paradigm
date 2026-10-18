/**
 * @symbol #session-runner
 *
 * The darwin backend of the `session` sandbox profile (spec §15.5 row
 * `session`, §16 "Session denies"; p10m, p10m-claude-compat, P8-D79/D80;
 * T-2026-10-18-008). Generated from #manifest-loader's platform-neutral
 * SessionPolicy DATA (kernel/manifest/policy.ts) and the class → mechanism
 * table (platform/session-denies.ts): allow-default, then
 *   - `file-read*` deny on policy.denyRead, `file-write*` deny on
 *     policy.denyWrite + the T-008 git denies (a `.git` POINTER FILE literal,
 *     `<gitDir>/config.worktree`, `<commonDir>/modules/**​/{hooks,config,info}`
 *     by regex);
 *   - `network-outbound (remote ip "localhost:<port>")` per endpoint port;
 *   - `process-info*` denied except self, `kern.proc` sysctl, and the
 *     `com.apple.sysmond` mach-lookup (without it pgrep reads every argv);
 *   - unix-socket connects to the tmux dir (`/private/tmp/tmux-<uid>`) and
 *     the screen dirs (`$TMPDIR/.screen`, `/private/tmp/screens`, `~/.screen`);
 *   - `appleevent-send`, `device-microphone`, `device-camera`;
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
 * Not realised here (reported by sessionDenyCoverage): the helper's XPC
 * service name (`ipc:helper-service` — the helper is M1.3; no name yet).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { realpathLoose, type PolicyPath, type SessionPolicy } from '../../kernel/manifest/policy.js';

export const SESSION_PROFILE_VERSION = 1;

/** macOS major from which a relocated Apple platform binary is SIGKILLed (launch constraints; observed 15 yes, 14 no). */
export const COPIED_PLATFORM_BINARY_KILLED_FROM_MACOS = 15;

export const DARWIN_LAUNCHERS = Object.freeze([
  '/usr/bin/open',
  '/usr/bin/osascript',
  '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister',
  '/bin/launchctl',
  '/usr/bin/shortcuts',
  '/usr/bin/automator',
]);

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

function filter(p: PolicyPath): string {
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
  lines.push(`(deny file-write* ${[...policy.denyWrite.map(filter), ...git.filters].join(' ')})`);
  for (const port of policy.denyLoopbackPorts) lines.push(`(deny network-outbound (remote ip "localhost:${port}"))`);
  if (policy.processInfo === 'deny-others') {
    lines.push('(deny process-info*)', '(allow process-info* (target self))', '(deny sysctl-read (sysctl-name-prefix "kern.proc"))', '(deny mach-lookup (global-name "com.apple.sysmond"))');
  }
  const classes = new Set(policy.denyClasses);
  if (classes.has('unix-socket:tmux')) lines.push(`(deny network-outbound (remote unix-socket (subpath ${q(realpathLoose(`/private/tmp/tmux-${x.uid}`))})))`);
  if (classes.has('unix-socket:screen')) lines.push(`(deny network-outbound ${screenDirs.map((d) => `(remote unix-socket (subpath ${q(d)}))`).join(' ')})`);
  if (classes.has('automation:apple-events')) lines.push('(deny appleevent-send)');
  if (classes.has('media:microphone')) lines.push('(deny device-microphone)');
  if (classes.has('media:camera')) lines.push('(deny device-camera)');
  if (policy.launchers === 'deny' || classes.has('launchers') || classes.has('service-manager')) lines.push(`(deny process-exec ${launchers.map((l) => `(literal ${q(l)})`).join(' ')})`);
  lines.push('');
  return lines.join('\n');
}
