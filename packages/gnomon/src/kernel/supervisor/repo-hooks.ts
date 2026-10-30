/**
 * @symbol #supervisor
 *
 * Audited repo hooks (P8-D94, founder ruling 2026-10-18; spec §3.3, §15.7;
 * T-2026-10-18-010 L4). In the `audited` hooks mode a session loads only the
 * USER settings layer (`--setting-sources user`); the repo's project and
 * local layers (`<root>/.claude/settings.json`, `.claude/settings.local.json`)
 * are never handed to Claude raw. The KERNEL extracts their `hooks`, and only
 * the hooks the human approved are written into the session's own
 * `policy.json` (`--settings`, which Claude loads whatever the setting sources
 * are — `claude --help`, 2.1.302).
 *
 *   extractRepoHooks: strict parse, fail closed. A file that is a symlink,
 *     over MAX_SETTINGS_BYTES, unparseable or not an object ⇒ the whole set is
 *     `unreadable` (no repo hook runs). Each hook must be
 *     `{type: 'command', command, timeout?}` in a group `{matcher?, hooks}`
 *     under an event name /^[A-Za-z]{1,64}$/; any other shape, an unknown
 *     key, or COMMAND_UNSAFE (a line separator, format or control character —
 *     U+2028 included) in the event, matcher or command ⇒ that hook is
 *     REFUSED: listed by id only, never approvable, never run. More than
 *     MAX_REPO_HOOKS entries ⇒ the set is `too-many` (none run).
 *   ids: hookId = sha256(canonical entry); setHash = sha256 over the sorted
 *     hook ids + refused ids. Approvals are pinned to (repoKey, setHash): a
 *     changed set re-raises every card and no old decision applies.
 *   cards: one `gate-class` card PER HOOK (allow | deny — the only gate-class
 *     decisions; a multi-select card would need a new decision shape and
 *     move clientApiId). Allow-all / deny-all = deciding every card; per-hook
 *     deny = denying that card. "Modify" is deny now, edit later (deferred).
 *     Rendering = the install card's (wrappedBlock): a kernel-composed count
 *     line first, one line for the hook, never cut. Approve needs presence
 *     (M1.3): until a decision exists the hook does not run.
 *   decisions: the card effect logs `gate-class.decided{what: 'repo-hook',
 *     repoKey, setHash, hookId, decision}`; the daemon reads them back from
 *     the chain counting only KERNEL-signed rows (principal + kernel keyId).
 */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { canonicalJson } from '@a-company/gnomon-contracts';
import { COMMAND_UNSAFE } from '../manifest/manifest.js';
import { wrappedBlock } from '../manifest/install.js';
import { realpathLoose } from '../manifest/policy.js';

export const REPO_HOOK_FILES = Object.freeze([
  { source: 'project', rel: ['.claude', 'settings.json'] },
  { source: 'local', rel: ['.claude', 'settings.local.json'] },
] as const);
export const MAX_SETTINGS_BYTES = 256 * 1024;
export const MAX_REPO_HOOKS = 64;
/** pending (raised, undecided) cards remembered per process; the oldest is forgotten past this (re-raised on the next open) */
export const MAX_PENDING_HOOK_CARDS = 256;

export interface RepoHook {
  hookId: string;
  source: 'project' | 'local';
  event: string;
  matcher: string | null;
  command: string;
  timeout: number | null;
}

export type RepoHookSet =
  | { status: 'none'; repoKey: string; setHash: null; hooks: []; refused: [] }
  | { status: 'ok'; repoKey: string; setHash: string; hooks: RepoHook[]; refused: string[] }
  | { status: 'unreadable' | 'too-many'; repoKey: string; setHash: null; hooks: []; refused: []; why: string };

const sha = (s: string): string => `sha256:${createHash('sha256').update(s, 'utf8').digest('hex')}`;
const EVENT_RE = /^[A-Za-z]{1,64}$/;
const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

/** The session roots realpath'd and deduped (a worktree equal to cwd counts once). */
export function uniqueRoots(roots: readonly string[]): string[] {
  return [...new Set(roots.map((r) => realpathLoose(r)))];
}

/** One key per repo root (realpath'd, deduped cwd + worktree). */
export function repoKeyOf(roots: readonly string[]): string {
  return sha(uniqueRoots(roots).join('\u0000'));
}

/**
 * The hook events Claude Code supports (Aegis C1): anything else is refused,
 * so no repo-controlled name ever becomes a key the kernel did not expect.
 */
export const CLAUDE_HOOK_EVENTS = Object.freeze([
  'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PermissionRequest', 'Notification', 'UserPromptSubmit',
  'Stop', 'SubagentStart', 'SubagentStop', 'PreCompact', 'SessionStart', 'SessionEnd',
]);
/** refused hook ids carried on a gate-class.detected row (the set is bounded by MAX_REPO_HOOKS too) */
export const MAX_REFUSED_LOGGED = 64;

/** Read one settings layer: O_NOFOLLOW + fstat (no symlink, a regular file, bounded). null = absent. */
export function readLayer(file: string): { ok: true; text: string } | { ok: false; why: string } | null {
  let fd: number;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return null;
    return { ok: false, why: code === 'ELOOP' ? 'a symlink' : `unopenable (${code ?? 'error'})` };
  }
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile()) return { ok: false, why: 'not a regular file' };
    if (st.size > MAX_SETTINGS_BYTES) return { ok: false, why: `over ${MAX_SETTINGS_BYTES} bytes` };
    const buf = Buffer.alloc(st.size);
    let n = 0;
    while (n < st.size) {
      const r = fs.readSync(fd, buf, n, st.size - n, n);
      if (r <= 0) break;
      n += r;
    }
    return { ok: true, text: buf.subarray(0, n).toString('utf8') };
  } finally {
    fs.closeSync(fd);
  }
}

/** Extract the repo hooks of the session roots (strict, fail closed). Pure but for reading the two settings files per root. */
export function extractRepoHooks(roots: readonly string[]): RepoHookSet {
  const repoKey = repoKeyOf(roots);
  const hooks = new Map<string, RepoHook>();
  const refused = new Set<string>();
  let total = 0;
  const tooMany = (): RepoHookSet => ({ status: 'too-many', repoKey, setHash: null, hooks: [], refused: [], why: `more than ${MAX_REPO_HOOKS} repo hooks` });
  for (const root of uniqueRoots(roots)) {
    for (const f of REPO_HOOK_FILES) {
      const unreadable = (why: string): RepoHookSet => ({ status: 'unreadable', repoKey, setHash: null, hooks: [], refused: [], why: `${f.source}: ${why}` });
      // the .claude dir itself must not be a link (O_NOFOLLOW guards only the last component)
      try {
        if (fs.lstatSync(path.join(root, f.rel[0])).isSymbolicLink()) return unreadable('.claude is a symlink');
      } catch {
        continue; // no .claude dir
      }
      const layer = readLayer(path.join(root, ...f.rel));
      if (layer === null) continue; // no such layer
      if (!layer.ok) return unreadable(layer.why);
      let doc: unknown;
      try {
        doc = JSON.parse(layer.text);
      } catch {
        return unreadable('unparseable');
      }
      if (!isObj(doc)) return unreadable('not an object');
      if (doc.hooks === undefined) continue;
      if (!isObj(doc.hooks)) return unreadable('hooks is not an object');
      for (const [event, groups] of Object.entries(doc.hooks)) {
        if (!Array.isArray(groups)) {
          if (++total > MAX_REPO_HOOKS) return tooMany(); // round 2: the cap holds on EVERY increment
          refused.add(sha(canonicalJson({ source: f.source, event, groups })));
          continue;
        }
        for (const g of groups as unknown[]) {
          const gHooks = isObj(g) && Array.isArray(g.hooks) ? g.hooks : [g];
          for (const h of gHooks) {
            if (++total > MAX_REPO_HOOKS) return tooMany();
            const raw = sha(canonicalJson({ source: f.source, event, group: isObj(g) ? Object.fromEntries(Object.entries(g).filter(([k]) => k !== 'hooks')) : (g ?? null), hook: h ?? null }));
            const matcher = isObj(g) ? g.matcher : undefined;
            const ok =
              EVENT_RE.test(event) && CLAUDE_HOOK_EVENTS.includes(event) && !COMMAND_UNSAFE.test(event) &&
              isObj(g) && Object.keys(g).every((k) => k === 'matcher' || k === 'hooks') && Array.isArray(g.hooks) &&
              (matcher === undefined || (typeof matcher === 'string' && matcher.length <= 1024 && !COMMAND_UNSAFE.test(matcher))) &&
              isObj(h) && Object.keys(h).every((k) => k === 'type' || k === 'command' || k === 'timeout') &&
              h.type === 'command' && typeof h.command === 'string' && h.command.length > 0 && h.command.length <= 8192 && !COMMAND_UNSAFE.test(h.command) &&
              (h.timeout === undefined || (typeof h.timeout === 'number' && Number.isInteger(h.timeout) && h.timeout > 0 && h.timeout <= 3600));
            if (!ok) {
              refused.add(raw);
              continue;
            }
            const entry = { source: f.source, event, matcher: (matcher as string | undefined) ?? null, command: h.command as string, timeout: (h.timeout as number | undefined) ?? null };
            const hookId = sha(canonicalJson(entry));
            hooks.set(hookId, { hookId, ...entry });
          }
        }
      }
    }
  }
  if (!hooks.size && !refused.size) return { status: 'none', repoKey, setHash: null, hooks: [], refused: [] };
  const list = [...hooks.values()].sort((a, b) => (a.hookId < b.hookId ? -1 : 1));
  const ref = [...refused].sort();
  return { status: 'ok', repoKey, setHash: sha(canonicalJson({ hooks: list.map((h) => h.hookId), refused: ref })), hooks: list, refused: ref };
}

/** The approved hooks as a Claude settings `hooks` block (merged into the session's policy.json). */
export function hooksBlock(approved: readonly RepoHook[]): Record<string, Array<{ matcher?: string; hooks: Array<{ type: 'command'; command: string; timeout?: number }> }>> {
  // Aegis C1: a null-prototype object — an event named like an Object.prototype member is just a key
  const out: Record<string, Array<{ matcher?: string; hooks: Array<{ type: 'command'; command: string; timeout?: number }> }>> = Object.create(null);
  for (const h of approved) {
    (out[h.event] ??= []).push({ ...(h.matcher !== null ? { matcher: h.matcher } : {}), hooks: [{ type: 'command', command: h.command, ...(h.timeout !== null ? { timeout: h.timeout } : {}) }] });
  }
  return out;
}

/** Merge two settings `hooks` blocks (generated first, then approved repo hooks). */
export function mergeHooks(a: unknown, b: Record<string, unknown[]>): Record<string, unknown[]> {
  const out: Record<string, unknown[]> = Object.create(null);
  if (isObj(a)) for (const [k, v] of Object.entries(a)) out[k] = Array.isArray(v) ? [...v] : [v];
  for (const [k, v] of Object.entries(b)) out[k] = [...(out[k] ?? []), ...v];
  return out;
}

/** Aegis C2: the kernel's warning line on every repo-hook card. */
export const REPO_HOOK_WARNING = 'approving trusts the command and every file it runs; a repo change, a pull, or a session edit can change what runs';

/** The card for one hook: the install-card rendering (count line first, one line for the hook, never cut). */
/** Hook events whose hook can answer a tool permission itself (p01b (i)), so the card warns about it. */
export const TOOL_APPROVING_EVENTS: readonly string[] = Object.freeze(['PreToolUse', 'PermissionRequest']);
export const TOOL_APPROVAL_WARNING = 'This hook can approve tool uses with no card: a PreToolUse or PermissionRequest hook that answers allow runs the tool without asking you (P8-D96).';

export function repoHookCard(set: Extract<RepoHookSet, { status: 'ok' }>, h: RepoHook, root: string, info: readonly string[] = []): { detail: Record<string, unknown>; lines: string[]; block: Record<string, unknown> } {
  const i = set.hooks.indexOf(h) + 1;
  const lines = [
    // kernel-composed, before any repo-controlled text: the count cannot be pushed off-screen
    `runs commands: repo hook ${i} of ${set.hooks.length}${set.refused.length ? ` (${set.refused.length} more refused: unsafe or unsupported, never run)` : ''}`,
    `repo: ${root}`,
    `hooks: ${h.source}: ${h.event}${h.matcher !== null ? ` [${h.matcher}]` : ''}${h.timeout !== null ? ` (timeout ${h.timeout}s)` : ''}: ${h.command}`,
    // Aegis C2 (kernel-written, every card): the pin is the command string, not the code it runs (spec §A.9, T-2026-10-18-027)
    REPO_HOOK_WARNING,
    // P8-D96 (Aegis): p01b (i) — a PreToolUse/PermissionRequest hook answering allow runs the tool with no card
    ...(TOOL_APPROVING_EVENTS.includes(h.event) ? [TOOL_APPROVAL_WARNING] : []),
    // P8-D97: what the repo sets besides hooks, NOT loaded (kernel-composed counts and key names, never values)
    ...info,
    'allow: this hook runs in this repo\'s sessions until the hook set changes. deny: it never runs (edit-in-place is deferred).',
  ];
  return {
    detail: { event: 'repo-hook', repoKey: set.repoKey, setHash: set.setHash, hookId: h.hookId, source: h.source, hookEvent: h.event, matcher: h.matcher, command: h.command, timeout: h.timeout },
    lines,
    block: wrappedBlock(lines).block,
  };
}

/** A chain row as the decision reader sees it (a full-view event). */
export interface DecisionRow {
  /** Aegis S2 H-2: the row seq, so a sealed legacy kernel key is trusted only up to its seal */
  seq?: number;
  principal: string;
  keyId?: unknown;
  payload?: unknown;
}

/**
 * P8-D94: the human's per-hook decisions for (repoKey, setHash), read back from the chain. Only KERNEL-signed
 * rows count (principal === the kernel principal AND keyId a kernel key): a forged `gate-class.decided` from
 * any other principal or key is ignored. The last decision per hook wins.
 */
export function repoHookDecisionsFrom(rows: Iterable<DecisionRow>, kernel: { principal: string; isKernelKey: (keyId: string, seq?: number) => boolean }, repoKey: string, setHash: string): Map<string, 'allow' | 'deny'> {
  const out = new Map<string, 'allow' | 'deny'>();
  for (const r of rows) {
    if (r.principal !== kernel.principal || typeof r.keyId !== 'string' || !kernel.isKernelKey(r.keyId, r.seq)) continue;
    const p = r.payload as { what?: unknown; repoKey?: unknown; setHash?: unknown; hookId?: unknown; decision?: unknown } | undefined;
    if (p?.what !== 'repo-hook' || p.repoKey !== repoKey || p.setHash !== setHash || typeof p.hookId !== 'string') continue;
    if (p.decision !== 'allow' && p.decision !== 'deny') continue;
    out.set(p.hookId, p.decision);
  }
  return out;
}
