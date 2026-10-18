/**
 * @symbol #supervisor
 *
 * #supervisor permission channel (spec §3.3, §3.4 "the card is the gate", §6.1; P8-D96).
 * PURE: what the kernel does with one `can_use_tool` request from a Claude
 * session (claude-code adapter `permission-request` event, probe p01b).
 *
 *   composePermission — either an AUTO answer with no card (a write under the
 *     policy's denyWrite; AskUserQuestion, deferred: "ask in your reply"; a
 *     path-taking tool with no usable path; a malformed or sandbox-escaping
 *     input; a card too large to show in full) or a card: `plan` for
 *     ExitPlanMode (approve-plan | reject), `permission` for every other tool
 *     with decisions allow | deny ONLY (no `always` in this slice). The lines
 *     are kernel-composed from the request, split on newlines, then
 *     sanitized and WRAPPED by the install card's wrappedBlock (Aegis C1):
 *     a line longer than MAX_LINE continues on `  ↳ ` lines, never cut. The
 *     card is raised with that block. EVERY input field is shown (Aegis A1):
 *       Bash         — the full command, then every other key as key=value;
 *                      `dangerouslyDisableSandbox` set ⇒ auto-deny
 *                      `sandbox-escape`; a non-text command ⇒ `bad-input`;
 *       Edit         — the path, old and new text in full, every other key;
 *       MultiEdit    — the path, then each edit's old and new in full;
 *       NotebookEdit — the path, the cell source in full, every other key;
 *       Write        — the path, the byte count, a head excerpt and the
 *                      inputHash, stating that only an excerpt is shown (the
 *                      ONLY writing tool approved on an excerpt, Aegis A2);
 *       other        — the tool name, then every key as key=value.
 *     A card over MAX_CARD_CHARS is denied (`too-large`), never cut. Deny
 *     paths case-fold on darwin/win32 (case-insensitive default filesystems).
 *     detail = {tool, toolUseId, requestId, inputHash, repo, path?} — so the
 *     card's contentHash covers the input through inputHash.
 *   answerFor — the card's outcome ⇒ allow | deny. Only `allow` on a
 *     permission card and `approve-plan` on a plan card allow; everything
 *     else (deny, reject, expiry, an unknown string) denies. A reject note is
 *     carried in the deny message.
 *   inputHash — sha256 over canonical JSON of the input: the same function
 *     hashes the card's input and the `updatedInput` the kernel sends back.
 *
 * A permit never means allow (P8-D92: tool.permission reserves are always
 * granted by the meter); only the human's decision on the card does.
 */
import * as path from 'node:path';
import { canonicalJson } from '@a-company/gnomon-contracts';
import { createHash } from 'node:crypto';
import { realpathLoose, type PolicyPath } from '../manifest/policy.js';
import { wrappedBlock } from '../manifest/install.js';

export const ASK_USER_DENY = 'ask in your reply; the human answers in chat';
export const PERMISSION_DECISIONS = Object.freeze(['allow', 'deny'] as const);
export const PLAN_DECISIONS = Object.freeze(['approve-plan', 'reject'] as const);
/** pending can_use_tool requests per session; past it every new request is denied with no card */
export const MAX_PENDING_PERMISSIONS = 64;
export const WRITE_EXCERPT_CHARS = 1500;
/** A rendered card larger than this is denied rather than shown in part (writing tools never approve an excerpt, Aegis A2). */
export const MAX_CARD_CHARS = 512 * 1024;
/** tools whose input names a file they write (the denyWrite auto-deny) */
export const PATH_TOOLS: Readonly<Record<string, string>> = Object.freeze({ Write: 'file_path', Edit: 'file_path', MultiEdit: 'file_path', NotebookEdit: 'notebook_path' });

export interface PermissionRequestIn {
  requestId: string;
  toolName: string;
  toolUseId: string | null;
  input: Record<string, unknown>;
}

export interface PermissionContext {
  /** the session root (cwd, or worktree) — relative paths resolve against it */
  repo: string;
  denyWrite: readonly PolicyPath[];
}

export type AutoDenyWhy = 'deny-write' | 'ask-user-deferred' | 'no-path' | 'bad-input' | 'sandbox-escape' | 'too-large';

export type PermissionPlan =
  | { kind: 'auto-deny'; why: AutoDenyWhy; message: string; inputHash: string; denyClass?: string }
  | { kind: 'card'; cardKind: 'permission' | 'plan'; decisions: readonly string[]; detail: Record<string, unknown>; lines: string[]; block: Record<string, unknown>; inputHash: string };

export function inputHash(input: unknown): string {
  let c: string;
  try {
    c = canonicalJson(input);
  } catch {
    c = JSON.stringify(input) ?? 'null';
  }
  return `sha256:${createHash('sha256').update(c, 'utf8').digest('hex')}`;
}

const s = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const cap = (t: string, n: number): { text: string; cut: boolean } => {
  const cps = Array.from(t);
  return cps.length > n ? { text: cps.slice(0, n).join(''), cut: true } : { text: t, cut: false };
};
/** A text field in FULL: a label line, then its lines (wrapped by the block, never cut). */
const full = (label: string, t: string): string[] => [`${label}:`, ...t.split(/\r?\n/)];
const valueText = (v: unknown): string => {
  if (typeof v === 'string') return v;
  try {
    return canonicalJson(v);
  } catch {
    return JSON.stringify(v) ?? String(v);
  }
};
/** Aegis A1: every input key the tool-specific rendering did not already show, as `key=value` (sanitized + wrapped by the block). */
const rest = (input: Record<string, unknown>, shown: readonly string[]): string[] =>
  Object.keys(input).sort().filter((k) => !shown.includes(k)).flatMap((k) => `${k}=${valueText(input[k])}`.split(/\r?\n/));

/** Fold case where the default filesystem is case-insensitive (darwin APFS/HFS+, win32 NTFS): a deny must match `.CLAUDE/Settings.json` too. */
export function foldsCase(platform: string = process.platform): boolean {
  return platform === 'darwin' || platform === 'win32';
}

/** Is `p` (absolute, realpath'd loosely) under one of the deny entries? Returns the matching entry. */
export function deniedWrite(p: string, deny: readonly PolicyPath[], platform: string = process.platform): PolicyPath | null {
  const fold = foldsCase(platform) ? (x: string) => x.toLowerCase() : (x: string) => x;
  const real = realpathLoose(p);
  for (const raw of new Set([path.resolve(p), real])) {
    const cand = fold(raw);
    for (const d of deny) {
      const dp = fold(d.path);
      if (d.match === 'literal' && cand === dp) return d;
      if (d.match === 'subpath' && (cand === dp || cand.startsWith(dp.endsWith(path.sep) ? dp : dp + path.sep))) return d;
      if (d.match === 'prefix' && cand.startsWith(dp)) return d;
    }
  }
  return null;
}

type Deny = Extract<PermissionPlan, { kind: 'auto-deny' }>;

export function composePermission(req: PermissionRequestIn, ctx: PermissionContext, platform: string = process.platform): PermissionPlan {
  const h = inputHash(req.input);
  const tool = req.toolName;
  const inp = req.input;
  const deny = (why: AutoDenyWhy, message: string, extra: { denyClass?: string } = {}): Deny => ({ kind: 'auto-deny', why, message, inputHash: h, ...extra });
  if (tool === 'AskUserQuestion') return deny('ask-user-deferred', ASK_USER_DENY);
  const detail: Record<string, unknown> = { tool, toolUseId: req.toolUseId, requestId: req.requestId, inputHash: h, repo: ctx.repo };
  if (tool === 'ExitPlanMode') {
    const plan = s(inp.plan);
    if (inp.plan !== undefined && plan === null) return deny('bad-input', 'ExitPlanMode plan must be text');
    const lines = ['The session proposes a plan', `repo: ${ctx.repo}`, ...(plan !== null ? full('plan', plan) : ['(the plan text is not in the request)']), ...rest(inp, ['plan']), 'approve-plan: the session leaves plan mode. reject: it stays, with your note.'];
    if (size(lines) > MAX_CARD_CHARS) return deny('too-large', 'the plan is too large to show in full on a card');
    return card('plan', PLAN_DECISIONS, detail, h, lines);
  }
  const pathKey = PATH_TOOLS[tool];
  let shownPath: string | null = null;
  if (pathKey !== undefined) {
    const raw = s(inp[pathKey]);
    if (raw === null || raw === '' || raw.includes('\0')) return deny('no-path', `${tool} needs a ${pathKey}`);
    const abs = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(ctx.repo, raw);
    const d = deniedWrite(abs, ctx.denyWrite, platform);
    if (d) return deny('deny-write', `Gnomon's session policy denies writes there (${d.class})`, { denyClass: d.class });
    shownPath = abs;
    detail.path = abs;
  }
  let body: string[];
  if (tool === 'Bash') {
    if (typeof inp.command !== 'string') return deny('bad-input', 'Bash command must be text');
    // Aegis A1: a request to run outside the session sandbox is never a card
    if (inp.dangerouslyDisableSandbox !== undefined && inp.dangerouslyDisableSandbox !== false) return deny('sandbox-escape', 'Gnomon sessions never run commands outside the sandbox');
    body = [...full('command', inp.command), ...rest(inp, ['command'])];
  } else if (tool === 'Edit') {
    if (typeof inp.old_string !== 'string' || typeof inp.new_string !== 'string') return deny('bad-input', 'Edit old_string and new_string must be text');
    body = [`path: ${shownPath}`, ...full('old', inp.old_string), ...full('new', inp.new_string), ...rest(inp, ['file_path', 'old_string', 'new_string'])];
  } else if (tool === 'MultiEdit') {
    const edits = inp.edits;
    if (!Array.isArray(edits) || edits.length === 0) return deny('bad-input', 'MultiEdit edits must be a non-empty list');
    body = [`path: ${shownPath}`, `${edits.length} edit(s)`];
    for (const [i, e] of edits.entries()) {
      const o = e !== null && typeof e === 'object' && !Array.isArray(e) ? (e as Record<string, unknown>) : null;
      if (!o || typeof o.old_string !== 'string' || typeof o.new_string !== 'string') return deny('bad-input', `MultiEdit edit ${i + 1} needs text old_string and new_string`);
      body.push(`edit ${i + 1} of ${edits.length} on ${shownPath}`, ...full('old', o.old_string), ...full('new', o.new_string), ...rest(o, ['old_string', 'new_string']));
    }
    body.push(...rest(inp, ['file_path', 'edits']));
  } else if (tool === 'NotebookEdit') {
    if (inp.new_source !== undefined && typeof inp.new_source !== 'string') return deny('bad-input', 'NotebookEdit new_source must be text');
    body = [`path: ${shownPath}`, ...(typeof inp.new_source === 'string' ? full('cell source', inp.new_source) : []), ...rest(inp, ['notebook_path', 'new_source'])];
  } else if (tool === 'Write') {
    if (typeof inp.content !== 'string') return deny('bad-input', 'Write content must be text');
    const content = inp.content;
    const ex = cap(content, WRITE_EXCERPT_CHARS);
    body = [
      `path: ${shownPath}`,
      `${Buffer.byteLength(content, 'utf8')} bytes · inputHash ${h}`,
      ex.cut ? `Only an excerpt is shown: the first ${WRITE_EXCERPT_CHARS} characters. The full content is pinned by the inputHash.` : 'Only an excerpt is shown when the content is long; this content is shown in full, pinned by the inputHash.',
      ...ex.text.split(/\r?\n/),
      ...rest(inp, ['file_path', 'content']),
    ];
  } else {
    body = [...(shownPath ? [`path: ${shownPath}`] : []), ...rest(inp, pathKey ? [pathKey] : [])];
    if (!Object.keys(inp).length) body.push('(no input)');
  }
  const lines = [`The session asks to run ${tool}`, `repo: ${ctx.repo}`, ...body];
  if (size(lines) > MAX_CARD_CHARS) return deny('too-large', `the ${tool} request is too large to show in full on a card`);
  return card('permission', PERMISSION_DECISIONS, detail, h, lines);
}

const size = (lines: readonly string[]): number => lines.reduce((n, l) => n + l.length, 0);

/** Aegis C1: the display block is the install card's wrap of every logical line — never cut. */
function card(cardKind: 'permission' | 'plan', decisions: readonly string[], detail: Record<string, unknown>, h: string, lines: string[]): PermissionPlan {
  return { kind: 'card', cardKind, decisions, detail, inputHash: h, lines, block: wrappedBlock(lines).block };
}

/** The card's outcome ⇒ the answer. Fail closed: only allow (permission) / approve-plan (plan) allow. */
export function answerFor(cardKind: 'permission' | 'plan', decision: string, note?: string): { behavior: 'allow' } | { behavior: 'deny'; message: string } {
  if (cardKind === 'permission' && decision === 'allow') return { behavior: 'allow' };
  if (cardKind === 'plan' && decision === 'approve-plan') return { behavior: 'allow' };
  if (cardKind === 'plan' && decision === 'reject') return { behavior: 'deny', message: note ? `The human rejected the plan: ${note}` : 'The human rejected the plan.' };
  if (decision === 'deny') return { behavior: 'deny', message: note ? `The human denied this: ${note}` : 'The human denied this tool use.' };
  return { behavior: 'deny', message: 'No approval was given (the request expired or was withdrawn).' };
}
