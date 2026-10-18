/**
 * @symbol #supervisor
 *
 * #supervisor permission channel (spec §3.3, §3.4 "the card is the gate", §6.1; P8-D96).
 * PURE: what the kernel does with one `can_use_tool` request from a Claude
 * session (claude-code adapter `permission-request` event, probe p01b).
 *
 *   composePermission — either an AUTO answer with no card (a write under the
 *     policy's denyWrite; AskUserQuestion, deferred: "ask in your reply"; a
 *     path-taking tool with no usable path) or a card: `plan` for
 *     ExitPlanMode (approve-plan | reject), `permission` for every other tool
 *     with decisions allow | deny ONLY (no `always` in this slice). The lines
 *     are kernel-composed from the request; the broker sanitizes and wraps
 *     them (never cut):
 *       Bash  — the full command;
 *       Edit  — the path, then old/new text (each capped, the cap stated);
 *       Write — the path, the byte count, a head excerpt and the inputHash,
 *               stating that only an excerpt is shown;
 *       other — the tool name plus capped canonical JSON of the input.
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

export const ASK_USER_DENY = 'ask in your reply; the human answers in chat';
export const PERMISSION_DECISIONS = Object.freeze(['allow', 'deny'] as const);
export const PLAN_DECISIONS = Object.freeze(['approve-plan', 'reject'] as const);
/** pending can_use_tool requests per session; past it every new request is denied with no card */
export const MAX_PENDING_PERMISSIONS = 64;
export const EDIT_MAX_CHARS = 4000;
export const WRITE_EXCERPT_CHARS = 1500;
export const JSON_MAX_CHARS = 2000;
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

export type PermissionPlan =
  | { kind: 'auto-deny'; why: 'deny-write' | 'ask-user-deferred' | 'no-path'; message: string; inputHash: string; denyClass?: string }
  | { kind: 'card'; cardKind: 'permission' | 'plan'; decisions: readonly string[]; detail: Record<string, unknown>; lines: string[]; inputHash: string };

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
const textLines = (label: string, t: string, n: number): string[] => {
  const c = cap(t, n);
  return [`${label}${c.cut ? ` (first ${n} of ${Array.from(t).length} characters shown)` : ''}:`, ...c.text.split(/\r?\n/)];
};

/** Is `p` (absolute, realpath'd loosely) under one of the deny entries? Returns the matching entry. */
export function deniedWrite(p: string, deny: readonly PolicyPath[]): PolicyPath | null {
  const real = realpathLoose(p);
  for (const cand of new Set([path.resolve(p), real])) {
    for (const d of deny) {
      if (d.match === 'literal' && cand === d.path) return d;
      if (d.match === 'subpath' && (cand === d.path || cand.startsWith(d.path.endsWith(path.sep) ? d.path : d.path + path.sep))) return d;
      if (d.match === 'prefix' && cand.startsWith(d.path)) return d;
    }
  }
  return null;
}

export function composePermission(req: PermissionRequestIn, ctx: PermissionContext): PermissionPlan {
  const h = inputHash(req.input);
  const tool = req.toolName;
  if (tool === 'AskUserQuestion') return { kind: 'auto-deny', why: 'ask-user-deferred', message: ASK_USER_DENY, inputHash: h };
  const detail: Record<string, unknown> = { tool, toolUseId: req.toolUseId, requestId: req.requestId, inputHash: h, repo: ctx.repo };
  if (tool === 'ExitPlanMode') {
    const plan = s(req.input.plan);
    return {
      kind: 'card', cardKind: 'plan', decisions: PLAN_DECISIONS, detail, inputHash: h,
      lines: ['The session proposes a plan', `repo: ${ctx.repo}`, ...(plan !== null ? textLines('plan', plan, EDIT_MAX_CHARS) : ['(the plan text is not in the request)']), 'approve-plan: the session leaves plan mode. reject: it stays, with your note.'],
    };
  }
  const pathKey = PATH_TOOLS[tool];
  let shownPath: string | null = null;
  if (pathKey !== undefined) {
    const raw = s(req.input[pathKey]);
    if (raw === null || raw === '' || raw.includes('\0')) return { kind: 'auto-deny', why: 'no-path', message: `${tool} needs a ${pathKey}`, inputHash: h };
    const abs = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(ctx.repo, raw);
    const d = deniedWrite(abs, ctx.denyWrite);
    if (d) return { kind: 'auto-deny', why: 'deny-write', message: `Gnomon's session policy denies writes there (${d.class})`, inputHash: h, denyClass: d.class };
    shownPath = abs;
    detail.path = abs;
  }
  let body: string[];
  if (tool === 'Bash') {
    const command = s(req.input.command) ?? '';
    body = ['command:', ...command.split(/\r?\n/), ...(s(req.input.description) !== null ? [`(the session's own description: ${s(req.input.description)})`] : [])];
  } else if (tool === 'Edit') {
    body = [`path: ${shownPath}`, ...(req.input.replace_all === true ? ['replace all occurrences'] : []), ...textLines('old', s(req.input.old_string) ?? '', EDIT_MAX_CHARS), ...textLines('new', s(req.input.new_string) ?? '', EDIT_MAX_CHARS)];
  } else if (tool === 'Write') {
    const content = s(req.input.content) ?? '';
    const ex = cap(content, WRITE_EXCERPT_CHARS);
    body = [
      `path: ${shownPath}`,
      `${Buffer.byteLength(content, 'utf8')} bytes · inputHash ${h}`,
      ex.cut ? `Only an excerpt is shown: the first ${WRITE_EXCERPT_CHARS} characters. The full content is pinned by the inputHash.` : 'Only an excerpt is shown when the content is long; this content is shown in full, pinned by the inputHash.',
      ...ex.text.split(/\r?\n/),
    ];
  } else {
    const j = cap(inputJson(req.input), JSON_MAX_CHARS);
    body = [...(shownPath ? [`path: ${shownPath}`] : []), `input${j.cut ? ` (first ${JSON_MAX_CHARS} characters shown; pinned by inputHash ${h})` : ''}:`, j.text];
  }
  return { kind: 'card', cardKind: 'permission', decisions: PERMISSION_DECISIONS, detail, inputHash: h, lines: [`The session asks to run ${tool}`, `repo: ${ctx.repo}`, ...body] };
}

function inputJson(v: unknown): string {
  try {
    return canonicalJson(v);
  } catch {
    return JSON.stringify(v) ?? 'null';
  }
}

/** The card's outcome ⇒ the answer. Fail closed: only allow (permission) / approve-plan (plan) allow. */
export function answerFor(cardKind: 'permission' | 'plan', decision: string, note?: string): { behavior: 'allow' } | { behavior: 'deny'; message: string } {
  if (cardKind === 'permission' && decision === 'allow') return { behavior: 'allow' };
  if (cardKind === 'plan' && decision === 'approve-plan') return { behavior: 'allow' };
  if (cardKind === 'plan' && decision === 'reject') return { behavior: 'deny', message: note ? `The human rejected the plan: ${note}` : 'The human rejected the plan.' };
  if (decision === 'deny') return { behavior: 'deny', message: note ? `The human denied this: ${note}` : 'The human denied this tool use.' };
  return { behavior: 'deny', message: 'No approval was given (the request expired or was withdrawn).' };
}
