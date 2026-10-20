/**
 * @symbol #supervisor
 *
 * #supervisor permission channel (spec §3.3, §3.4 "the card is the gate", §6.1; P8-D96).
 * PURE: what the kernel does with one `can_use_tool` request from a Claude
 * session (claude-code adapter `permission-request` event, probe p01b).
 *
 *   composePermission — either an AUTO answer with no card (a write under the
 *     policy's denyWrite; a malformed AskUserQuestion; a
 *     path-taking tool with no usable path; a malformed or sandbox-escaping
 *     input; a card too large to show in full) or a card: `plan` for
 *     ExitPlanMode (approve-plan | reject), `ask-user` for AskUserQuestion
 *     (answer; the questions validated and shown in a fixed line grammar the
 *     GUI picker reads, askLines; the answer checked by parseAskAnswer),
 *     `permission` for every other tool
 *     with decisions allow | deny | always (always: fresh presence, a standing exact-match rule, rules.ts). The lines
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
import { realpathFollow, realpathLoose, UnresolvablePath, type PolicyPath } from '../manifest/policy.js';
import { wrappedBlock } from '../manifest/install.js';
import { simpleArgv } from './shell-readonly.js';
import { prefixRefusal } from './prefix-policy.js';

export const ASK_USER_DENY = 'ask in your reply; the human answers in chat';
/** ask-user: an unanswered question card expires into deny with this message (10 min). */
export const ASK_USER_TIMEOUT_MS = 10 * 60_000;
export const ASK_USER_NO_ANSWER = 'no answer: the human did not answer the question in time (or it was withdrawn)';
export const ASK_USER_DECISIONS = Object.freeze(['answer'] as const);
/** Bounds on an AskUserQuestion input the kernel will show (over them: bad-input, never cut). */
export const ASK_MAX_QUESTIONS = 8;
export const ASK_MAX_OPTIONS = 16;
export const ASK_MAX_QUESTION_CHARS = 400;
export const ASK_MAX_LABEL_CHARS = 150;
export const ASK_MAX_TEXT_CHARS = 400;
export const ASK_MAX_ANSWER_CHARS = 1000;
/** The closed AskUserQuestion schema (p01b, claude 2.1.302): any other key is refused (Aegis C1). */
export const ASK_INPUT_KEYS = Object.freeze(['questions']);
export const ASK_QUESTION_KEYS = Object.freeze(['question', 'header', 'options', 'multiSelect']);
export const ASK_OPTION_KEYS = Object.freeze(['label', 'description']);
/** A question as the kernel holds it (validated, from the request input). */
export interface AskQuestion {
  question: string;
  header: string | null;
  options: Array<{ label: string; description: string | null }>;
  multiSelect: boolean;
}
export const PERMISSION_DECISIONS = Object.freeze(['allow', 'deny', 'always'] as const);
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
  /**
   * ExitPlanMode with no `plan` in the request (claude 2.1.302 sends `input:{}`, p01b planMode): the plan text the
   * session's own assistant message carried — the ExitPlanMode tool_use input.plan, else the latest plan-file Write
   * (`.claude/plans/*.md`) tool_use content. Display only, labelled as not part of the request; pinned by planHash.
   */
  planText?: { text: string; source: 'tool_use' | 'plan-file' };
}

/** Plan text larger than this is not attached to a plan card (the card says so instead of growing past MAX_CARD_CHARS). */
export const MAX_ATTACHED_PLAN_CHARS = 256 * 1024;
/** A Write to Claude Code's plan file (plan mode writes the plan there, then calls ExitPlanMode with input:{}). */
export const PLAN_FILE = /(^|[\\/])\.claude[\\/]plans[\\/][^\\/]+\.md$/;

export type AutoDenyWhy = 'deny-write' | 'no-path' | 'bad-input' | 'sandbox-escape' | 'too-large';

export type PermissionPlan =
  | { kind: 'auto-deny'; why: AutoDenyWhy; message: string; inputHash: string; denyClass?: string }
  | { kind: 'card'; cardKind: CardKindP; decisions: readonly string[]; detail: Record<string, unknown>; lines: string[]; block: Record<string, unknown>; inputHash: string; questions?: AskQuestion[] };

export type CardKindP = 'permission' | 'plan' | 'ask-user';

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
/** The prefix of every line of a field body: field text never begins a card line (Aegis L4). */
export const FIELD_BODY_PREFIX = '  │ ';
/**
 * Aegis L4 (shared helper; supersedes the hardening lane's T-032(2) copy): a
 * multi-line field as a kernel-owned label line, every body line fenced with
 * FIELD_BODY_PREFIX, and an end marker. Text inside a field can therefore
 * never start a card line, nor look like the line after the field.
 */
export function fieldLines(label: string, text: string): string[] {
  return [`${label}:`, ...text.split(/\r?\n/).map((l) => `${FIELD_BODY_PREFIX}${l}`), `  └ end of ${label}`];
}
const full = fieldLines;
const valueText = (v: unknown): string => {
  if (typeof v === 'string') return v;
  try {
    return canonicalJson(v);
  } catch {
    return JSON.stringify(v) ?? String(v);
  }
};
/**
 * Aegis A1: every input key the tool-specific rendering did not already show (sanitized + wrapped by the block).
 * Aegis L4: the key is model-chosen, so it is shown JSON-quoted on a kernel-prefixed label line and its value fenced.
 */
const rest = (input: Record<string, unknown>, shown: readonly string[]): string[] =>
  Object.keys(input).sort().filter((k) => !shown.includes(k)).flatMap((k) => fieldLines(`field ${JSON.stringify(k)}`, valueText(input[k])));

/** Fold case where the default filesystem is case-insensitive (darwin APFS/HFS+, win32 NTFS): a deny must match `.CLAUDE/Settings.json` too. */
export function foldsCase(platform: string = process.platform): boolean {
  return platform === 'darwin' || platform === 'win32';
}

/** P8-D97 F3: a path below a steering root that Claude may load as memory or settings (case-insensitive, like the SBPL regex). */
function isSteering(rel: string): boolean {
  const parts = rel.split(/[\\/]/).filter(Boolean);
  return parts.slice(0, -1).some((x) => x.toLowerCase() === '.claude') || parts.at(-1)?.toLowerCase() === '.claude' || /^claude[^/\\]*\.md$/i.test(parts.at(-1) ?? '');
}

/**
 * Is `p` under one of the deny entries? Returns the matching entry. Tested at the lexical path, at realpathLoose and
 * (Aegis H1) at realpathFollow — where the write LANDS, a dangling symlink followed — so `x -> .claude/settings.json`
 * with no settings file yet is denied like the file itself. A path whose symlinks cannot be followed (a loop, an
 * unreadable component) is denied outright: the first entry, else a synthetic `settings` literal.
 */
export function deniedWrite(p: string, deny: readonly PolicyPath[], platform: string = process.platform): PolicyPath | null {
  const fold = foldsCase(platform) ? (x: string) => x.toLowerCase() : (x: string) => x;
  const real = realpathLoose(p);
  let lands: string;
  try {
    lands = realpathFollow(p);
  } catch (e) {
    if (e instanceof UnresolvablePath) return deny.find((d) => d.match === 'steering') ?? deny[0] ?? { path: path.resolve(p), match: 'literal', class: 'settings' };
    throw e;
  }
  for (const raw of new Set([path.resolve(p), real, lands])) {
    const cand = fold(raw);
    for (const d of deny) {
      const dp = fold(d.path);
      if (d.match === 'literal' && cand === dp) return d;
      if (d.match === 'subpath' && (cand === dp || cand.startsWith(dp.endsWith(path.sep) ? dp : dp + path.sep))) return d;
      if (d.match === 'prefix' && cand.startsWith(dp)) return d;
      // P8-D97 F3: the steering subtree (CLAUDE*.md files, anything in a .claude dir, any case) is auto-denied like the rest
      if (d.match === 'steering' && cand.startsWith(dp.endsWith(path.sep) ? dp : dp + path.sep) && isSteering(cand.slice(dp.length))) return d;
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
  const detail: Record<string, unknown> = { tool, toolUseId: req.toolUseId, requestId: req.requestId, inputHash: h, repo: ctx.repo };
  if (tool === 'AskUserQuestion') {
    const qs = askQuestions(inp);
    if (typeof qs === 'string') return deny('bad-input', `AskUserQuestion: ${qs}`);
    // Aegis C1: the questions are STRUCTURED card detail (inside contentHash); the GUI builds its picker from the
    // `ask-user` block node carrying this exact detail, verified against contentHash — never from display text
    detail.questions = qs;
    detail.maxAnswerChars = ASK_MAX_ANSWER_CHARS;
    const lines = [`The session asks you ${qs.length === 1 ? 'a question' : `${qs.length} questions`}`, `repo: ${ctx.repo}`, ...askLines(qs), 'answer: pick an option or type your own answer for each question.'];
    if (size(lines) > MAX_CARD_CHARS) return deny('too-large', 'the questions are too large to show in full on a card');
    const c = card('ask-user', ASK_USER_DECISIONS, detail, h, lines) as Extract<PermissionPlan, { kind: 'card' }>;
    const children = [...((c.block.children as unknown[]) ?? []), { type: 'ask-user', detail: structuredClone(detail) }];
    return { ...c, block: { ...c.block, children }, questions: qs };
  }
  if (tool === 'ExitPlanMode') {
    const plan = s(inp.plan);
    if (inp.plan !== undefined && plan === null) return deny('bad-input', 'ExitPlanMode plan must be text');
    const att = plan === null && ctx.planText && cps(ctx.planText.text) <= MAX_ATTACHED_PLAN_CHARS ? ctx.planText : null;
    if (att) detail.planHash = `sha256:${createHash('sha256').update(att.text, 'utf8').digest('hex')}`;
    const planLines =
      plan !== null
        ? full('plan', plan)
        : att
          ? [`(the plan text is not in the request; shown ${att.source === 'plan-file' ? 'from a Write the session requested (it may not have run)' : "from the session's ExitPlanMode tool use"})`, ...full('plan', att.text)]
          : ['(the plan text is not in the request)'];
    const lines = ['The session proposes a plan', `repo: ${ctx.repo}`, ...planLines, ...rest(inp, ['plan']), 'approve-plan: the session leaves plan mode. reject: it stays, with your note.'];
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
    body = [...full('command', inp.command), ...rest(inp, ['command']), 'always: the rule pins this exact command text, not what it runs (a script or binary it calls can change).'];
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
      ...fieldLines('excerpt', ex.text),
      ...rest(inp, ['file_path', 'content']),
    ];
  } else {
    body = [...(shownPath ? [`path: ${shownPath}`] : []), ...rest(inp, pathKey ? [pathKey] : [])];
    if (!Object.keys(inp).length) body.push('(no input)');
  }
  const lines = [`The session asks to run ${tool}`, `repo: ${ctx.repo}`, ...body];
  if (size(lines) > MAX_CARD_CHARS) return deny('too-large', `the ${tool} request is too large to show in full on a card`);
  // TD-2026-10-20-294: a Bash command that is ONE literal simple command offers prefix-scoped always choices (its
  // first two argv words, when #prefix-policy allows them) as STRUCTURED detail inside contentHash, plus a {type:'bash-prefix', detail} block node the
  // GUI verifies (like ask-user); the broker re-checks any prefix against the same simpleArgv rule
  const argv = tool === 'Bash' && typeof inp.command === 'string' ? simpleArgv(inp.command) : null;
  // Aegis H1: only prefixes #prefix-policy passes are offered (never one word, never an interpreter/runner, git
  // read-ish subcommands only); the broker and the rule fold re-check the same policy
  const offered = argv && argv.length >= 2 && prefixRefusal([argv[0]!, argv[1]!]) === null ? [[argv[0]!, argv[1]!]] : [];
  if (offered.length) {
    detail.prefixOptions = offered;
    const c = card('permission', PERMISSION_DECISIONS, detail, h, lines) as Extract<PermissionPlan, { kind: 'card' }>;
    const children = [...((c.block.children as unknown[]) ?? []), { type: 'bash-prefix', detail: structuredClone(detail) }];
    return { ...c, block: { ...c.block, children } };
  }
  return card('permission', PERMISSION_DECISIONS, detail, h, lines);
}

const size = (lines: readonly string[]): number => lines.reduce((n, l) => n + l.length, 0);

/** Aegis C1: the display block is the install card's wrap of every logical line — never cut. */
function card(cardKind: CardKindP, decisions: readonly string[], detail: Record<string, unknown>, h: string, lines: string[]): PermissionPlan {
  return { kind: 'card', cardKind, decisions, detail, inputHash: h, lines, block: wrappedBlock(lines).block };
}

/** The card's outcome ⇒ the answer. Fail closed: only allow (permission) / approve-plan (plan) allow. */
export function answerFor(cardKind: CardKindP, decision: string, note?: string): { behavior: 'allow' } | { behavior: 'deny'; message: string } {
  // ask-user: the allow (with the validated answers) is built by the supervisor from parseAskAnswer; here only the deny
  if (cardKind === 'ask-user') return { behavior: 'deny', message: decision === 'answer' ? 'Denied: the answer could not be used.' : ASK_USER_NO_ANSWER };
  if (cardKind === 'permission' && (decision === 'allow' || decision === 'always')) return { behavior: 'allow' };
  if (cardKind === 'plan' && decision === 'approve-plan') return { behavior: 'allow' };
  if (cardKind === 'plan' && decision === 'reject') return { behavior: 'deny', message: note ? `The human rejected the plan: ${note}` : 'The human rejected the plan.' };
  if (decision === 'deny') return { behavior: 'deny', message: note ? `The human denied this: ${note}` : 'The human denied this tool use.' };
  return { behavior: 'deny', message: 'No approval was given (the request expired or was withdrawn).' };
}

/* ── ask-user (spec §3.4 ask-user: cached class; the answer is the human's) ── */

const LINE_BREAK = new RegExp("[\\r\\n\\u2028\\u2029]");
const oneLine = (t: string): boolean => !LINE_BREAK.test(t);
const cps = (t: string): number => Array.from(t).length;

/** Validate AskUserQuestion input.questions: the questions the kernel holds, or why not (fail closed: never cut). */
export function askQuestions(input: Record<string, unknown>): AskQuestion[] | string {
  // Aegis C1: a closed schema — any other key (at any level) is refused, never rendered
  const extra = (o: Record<string, unknown>, keys: readonly string[]): string | null => Object.keys(o).find((k) => !keys.includes(k)) ?? null;
  if (extra(input, ASK_INPUT_KEYS) !== null) return 'unknown input key (only questions)';
  const q = input.questions;
  if (!Array.isArray(q) || q.length === 0) return 'questions must be a non-empty list';
  if (q.length > ASK_MAX_QUESTIONS) return `at most ${ASK_MAX_QUESTIONS} questions`;
  const out: AskQuestion[] = [];
  const seen = new Set<string>();
  for (const [i, raw] of q.entries()) {
    const o = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
    if (!o || typeof o.question !== 'string' || o.question.trim() === '') return `question ${i + 1} needs text`;
    if (extra(o, ASK_QUESTION_KEYS) !== null) return `question ${i + 1} has an unknown key`;
    if (!oneLine(o.question) || cps(o.question) > ASK_MAX_QUESTION_CHARS) return `question ${i + 1} must be one line of at most ${ASK_MAX_QUESTION_CHARS} characters`;
    if (seen.has(o.question)) return `question ${i + 1} repeats an earlier question`;
    seen.add(o.question);
    if (o.header !== undefined && (typeof o.header !== 'string' || !oneLine(o.header) || cps(o.header) > ASK_MAX_LABEL_CHARS)) return `question ${i + 1} header must be one short line`;
    if (o.multiSelect !== undefined && typeof o.multiSelect !== 'boolean') return `question ${i + 1} multiSelect must be true or false`;
    const opts = o.options === undefined ? [] : o.options;
    if (!Array.isArray(opts) || opts.length > ASK_MAX_OPTIONS) return `question ${i + 1} options must be a list of at most ${ASK_MAX_OPTIONS}`;
    const options: AskQuestion['options'] = [];
    for (const [j, op] of opts.entries()) {
      const p = op !== null && typeof op === 'object' && !Array.isArray(op) ? (op as Record<string, unknown>) : null;
      if (p && extra(p, ASK_OPTION_KEYS) !== null) return `question ${i + 1} option ${j + 1} has an unknown key`;
      if (!p || typeof p.label !== 'string' || p.label.trim() === '' || !oneLine(p.label) || cps(p.label) > ASK_MAX_LABEL_CHARS) return `question ${i + 1} option ${j + 1} needs a one-line label of at most ${ASK_MAX_LABEL_CHARS} characters`;
      if (p.description !== undefined && (typeof p.description !== 'string' || !oneLine(p.description) || cps(p.description) > ASK_MAX_TEXT_CHARS)) return `question ${i + 1} option ${j + 1} description must be one line of at most ${ASK_MAX_TEXT_CHARS} characters`;
      options.push({ label: p.label, description: typeof p.description === 'string' ? p.description : null });
    }
    out.push({ question: o.question, header: typeof o.header === 'string' ? o.header : null, options, multiSelect: o.multiSelect === true });
  }
  return out;
}

/**
 * The card lines of the questions: a FIXED line grammar the GUI picker reads
 * back (`question N: …`, `option N.M: …`). Every value is one line under the
 * wrap width, so no line is ever continued. The GUI's parse is display only:
 * the kernel validates every answer against the questions it holds.
 */
export function askLines(qs: readonly AskQuestion[]): string[] {
  const out: string[] = [];
  for (const [i, q] of qs.entries()) {
    const n = i + 1;
    out.push(`question ${n}: ${q.question}`);
    if (q.header) out.push(`header ${n}: ${q.header}`);
    if (q.multiSelect) out.push(`multi-select ${n}: yes`);
    for (const [j, o] of q.options.entries()) {
      out.push(`option ${n}.${j + 1}: ${o.label}`);
      if (o.description) out.push(`about ${n}.${j + 1}: ${o.description}`);
    }
  }
  return out;
}

/**
 * The human's answer note ⇒ `answers` keyed by the kernel-held question text,
 * or why it is refused. One question: the plain note text (or the JSON form).
 * Several: JSON `{answers:{<question text>: <answer>}}` naming EXACTLY the
 * held questions. Each answer is non-empty text of at most ASK_MAX_ANSWER_CHARS.
 */
export function parseAskAnswer(qs: readonly AskQuestion[], note: unknown): { answers: Record<string, string> } | { error: string } {
  if (typeof note !== 'string' || note.trim() === '') return { error: 'an answer needs a note: the answer text, or JSON {answers:{question: answer}}' };
  let obj: Record<string, unknown> | null = null;
  const t = note.trim();
  if (t.startsWith('{')) {
    try {
      const v = JSON.parse(t) as unknown;
      if (v !== null && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 1 && 'answers' in v) {
        const a = (v as { answers: unknown }).answers;
        if (a === null || typeof a !== 'object' || Array.isArray(a)) return { error: 'answers must be an object {question: answer}' };
        obj = a as Record<string, unknown>;
      }
    } catch {
      /* not JSON: plain text */
    }
  }
  if (obj === null) {
    if (qs.length !== 1) return { error: `this card asks ${qs.length} questions: answer with JSON {answers:{question: answer}}` };
    obj = Object.create(null) as Record<string, unknown>;
    obj[qs[0]!.question] = note; // null prototype: a question named __proto__ is an ordinary key (Aegis L1)
  }
  const want = new Set(qs.map((q) => q.question));
  const keys = Object.keys(obj);
  const extra = keys.filter((k) => !want.has(k));
  const missing = [...want].filter((k) => !Object.hasOwn(obj!, k));
  if (extra.length || missing.length) return { error: `the answer keys must be exactly the card's questions (${extra.length} unknown, ${missing.length} missing)` };
  const answers = Object.create(null) as Record<string, string>;
  for (const q of qs) {
    const a = obj[q.question];
    if (typeof a !== 'string' || a.trim() === '' || cps(a) > ASK_MAX_ANSWER_CHARS) return { error: `each answer must be non-empty text of at most ${ASK_MAX_ANSWER_CHARS} characters` };
    answers[q.question] = a;
  }
  return { answers };
}
