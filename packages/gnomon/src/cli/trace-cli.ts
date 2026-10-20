/**
 * @symbol #gnomon-trace
 *
 * `gnomon trace [--home <abs>] [--last | --session <hsid> | --since <ISO>] [--json] [--full]`
 * — a READ-ONLY audit timeline of one Gnomon session (or every session active
 * since a time), for the founder and for Claude to audit Gnomon usage while
 * dogfooding. CLI-only: not a socket method, so abiId and clientApiId do not
 * move.
 *
 * It joins, per session (hsid):
 *   (a) the kernel-log rows of that session — the rows whose envelope names
 *       the session or whose payload carries its hsid, the approval rows of
 *       the cards it raised (by cardId), and the daemon.start before / the
 *       daemon.exit after it. Rows are read from the same files `gnomon replay`
 *       reads (sealed segments, then kernel.db), opened so that NOTHING is
 *       created (openQuiet: `immutable=1` when no -wal exists — even a
 *       readOnly WAL open creates -wal/-shm, which verifyLog does), and the
 *       hash chain (envelope hash, prev link) is checked on the way.
 *       Signatures and anchors are not checked: `gnomon replay` is the
 *       verifier, and trace says so in its output;
 *   (b) the Claude Code transcript `<claude dir>/projects/<encoded cwd>/<uuid>.jsonl`
 *       for the session's uuid (session.open / session.drained), the cwd
 *       realpath'd and every non-alphanumeric character replaced by '-'
 *       (probes/results/p-resume.darwin.json): user prompts, assistant text,
 *       tool_use and tool_result;
 *   (c) the raw stream capture `<home>/trace/<project key>/<hsid>.jsonl`
 *       (TD-2026-10-19-057: in the Gnomon home, never the project; key =
 *       traceProjectKey(realpath of the session cwd); written only for a
 *       folder a human switched trace mode on for; one `{t, dir: in|out|ctl,
 *       line}` object per line) when present; absent or unparsable lines are
 *       skipped. Secret spans read `[redacted:<kind>]`, over-size records
 *       `{truncated, bytes, hash, head}`, records past the file bound
 *       `{skeleton, type, subtype, tools}`.
 *
 * SUBCOMMANDS `gnomon trace on | off | status [--home <abs>] [--folder <abs>]`
 * switch and list per-project trace mode (kernel/trace/mode.ts; the folder
 * defaults to the cwd's realpath). They write only `<home>/trace-folders.json`;
 * `gnomon trace path [--home <abs>] [--folder <abs>]` prints where that
 * folder's captures live and writes nothing; the reader above writes nothing.
 * Ordered by time (chain `at`, transcript `timestamp`, capture `t`), stable
 * within each source.
 *
 * VERIFICATION. Each turn.sent contentHash is checked against the
 * transcript's user prompts with the supervisor's own hash
 * (turnContentHash): `✓ matches log` or `✗ hash mismatch`. A transcript
 * prompt the log never sent is marked `not in log`.
 *
 * It writes nothing, connects to nothing and never changes the kernel. The
 * output carries prompt text (whatever the transcript holds); every string
 * shown on a terminal passes sanitizeDisplayText. `--json` prints one object
 * per session per line (JSON escapes control bytes; text there is raw for
 * the audit).
 *
 * Output: readout helpers only. The kernel package has zero runtime deps
 * (G-SEC-01), so there is no Paradigm logger here — like every gnomon CLI.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { sanitizeDisplayText, sha256Tagged } from '@a-company/gnomon-contracts';
import { resolveGnomonHome } from '../kernel/lifecycle/index.js';
import { ACTIVE_DB, listSealedSegments } from '../kernel/log/index.js';
import { turnContentHash } from '../kernel/supervisor/supervisor.js';
import { setTraceMode, traceDirOf, traceFileName, traceModeOf, tracedFolders } from '../kernel/trace/index.js';
import { GNOMON_VERSION } from '../version.js';
import { heading, readout, refused, type Out } from './readout.js';

export const TRACE_EXIT_OK = 0;
export const TRACE_EXIT_REFUSED = 1;
export const TRACE_EXIT_USAGE = 64;

export const TRACE_USAGE = `usage: gnomon trace [--home <abs>] [--last | --session <hsid> | --since <ISO time>] [--json] [--full]

  A read-only audit timeline of a Gnomon session: the kernel-log rows of the
  session (open, sandbox, turns sent, usage and cost, cards and decisions,
  permits, drain and resume, exit, the daemon start and exit around it), the
  Claude Code transcript of the session (prompts, replies, tool calls and
  results) and, when present, the raw stream capture in the Gnomon home
  (gnomon trace path; only for a folder with trace mode on),
  in time order. Each turn sent is checked against the transcript prompt by
  its content hash: "✓ matches log" or "✗ hash mismatch".

  --last            the most recent session (the default)
  --session <hsid>  that session (the full hsid, or a unique part of it)
  --since <ISO>     every session with a log row at or after that time
  --json            one JSON object per session per line, for an agent to read
  --full            no truncation (and the per-line turn.event rows)

  Writes nothing and never connects to or changes the kernel: it reads the
  log files directly and checks the hash chain; signatures are left to
  \`gnomon replay\`. THE OUTPUT CONTAINS PROMPT TEXT and whatever
  else the transcript holds: treat it like the transcript itself.

       gnomon trace on | off | status | path [--home <abs>] [--folder <abs>]

  on      record the prompts and outputs of Claude sessions in this folder
          (default: the current folder) to the Gnomon home
          (<home>/trace/<project key>/, never inside the folder); takes effect
          for new and resumed sessions. The files hold prompt and tool text in
          the clear, readable by your own user account outside Gnomon
  off     stop recording for the folder (files already written stay)
  status  list the folders with trace mode on
  path    print where the folder's captures live
`;

/** Display cap (code points) for one text field unless --full. */
export const TRACE_TEXT_CAP = 160;

export type TraceSource = 'log' | 'transcript' | 'capture';

export interface TraceEvent {
  t: string;
  source: TraceSource;
  kind: string;
  [k: string]: unknown;
}

export interface TraceSession {
  session: { hsid: string; uuid: string | null; cwd: string | null; principal: string | null };
  /** From the session.sandbox row: was raw capture on for this session (and why it was refused)? null = no row says. */
  traced: { traced: boolean; refused: string | null } | null;
  log: { rows: number; chainRows: number; hashChain: 'ok' | 'broken'; breaks: number; firstBreak: string | null; signatures: 'not-checked' };
  transcript: { path: string | null; lines: number };
  capture: { path: string | null; lines: number; skipped: number };
  turns: { sent: number; matched: number; mismatched: number; unchecked: number };
  usage: { tokens: number; costUsd: number };
  events: TraceEvent[];
}

export interface TraceDeps {
  /** The user's Claude dir (default `~/.claude`); a test passes a throwaway one. */
  claudeDir?: string;
  /** The Gnomon home whose `trace/` holds the raw captures (runTraceCommand passes the --home it read). */
  home?: string;
}

interface LogRow {
  seq: number;
  kind: string;
  at: string;
  principal: string;
  session: string | null;
  payload: Record<string, unknown>;
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/** Claude Code's project-dir name for a cwd: the realpath, every non-alphanumeric character replaced by '-'. */
export function encodeClaudeProjectDir(cwd: string): string {
  let real = cwd;
  try {
    real = fs.realpathSync.native(cwd);
  } catch {
    /* a cwd that no longer exists keeps its recorded spelling */
  }
  return real.replace(/[^a-zA-Z0-9]/g, '-');
}

interface ChainCheck {
  rows: number;
  ok: boolean;
  breaks: number;
  firstBreak: string | null;
}

/**
 * Open one log database WITHOUT writing: a WAL database opened even read-only
 * creates its `-wal`/`-shm` files when they are absent (verifyLog does), so a
 * quiescent database (no `-wal` beside it) is opened `immutable=1`, which
 * creates nothing; a database with a live `-wal` (the daemon is running) is
 * opened readOnly as replay opens it, so rows not yet checkpointed are seen.
 */
function openQuiet(file: string): DatabaseSync {
  if (fs.existsSync(`${file}-wal`)) return new DatabaseSync(file, { readOnly: true });
  const u = pathToFileURL(file);
  u.searchParams.set('immutable', '1');
  return new DatabaseSync(u, { readOnly: true });
}

/**
 * Read every row of the log (sealed segments, then the active db) and check
 * the hash chain on the way: each row's hash is the sha256 of its envelope
 * and its prev is the previous row's hash. Signatures and anchors are NOT
 * checked here — `gnomon replay` is the verifier; trace says so.
 */
function readRows(home: string): { rows: LogRow[]; chain: ChainCheck } {
  const files = listSealedSegments(home).map((x) => x.file);
  const active = path.join(home, ACTIVE_DB);
  if (fs.existsSync(active)) files.push(active);
  if (!files.length) throw new Error(`no kernel log in ${home}`);
  const rows: LogRow[] = [];
  const chain: ChainCheck = { rows: 0, ok: true, breaks: 0, firstBreak: null };
  const brk = (seq: number, why: string): void => {
    chain.ok = false;
    chain.breaks++;
    chain.firstBreak ??= `seq ${seq}: ${why}`;
  };
  let prev: string | null = null;
  for (const file of files) {
    const db = openQuiet(file);
    try {
      for (const r of db.prepare('SELECT seq, kind, envelope, hash FROM chain ORDER BY seq').iterate() as Iterable<{ seq: number; kind: string; envelope: string; hash: string }>) {
        chain.rows++;
        let e: Record<string, unknown>;
        try {
          e = obj(JSON.parse(r.envelope));
        } catch {
          brk(r.seq, 'envelope is not JSON');
          prev = r.hash;
          continue;
        }
        if (sha256Tagged(r.envelope) !== r.hash) brk(r.seq, 'hash does not match the envelope bytes');
        if (prev !== null && e.prev !== prev) brk(r.seq, 'prev does not chain to the previous row');
        prev = r.hash;
        rows.push({ seq: r.seq, kind: r.kind, at: str(e.at) ?? '', principal: str(e.principal) ?? '', session: str(e.session), payload: obj(e.payload) });
      }
    } finally {
      db.close();
    }
  }
  return { rows, chain };
}

const hsidOf = (r: LogRow): string | null => r.session ?? str(r.payload.hsid) ?? str(obj(r.payload.card).hsid) ?? str(obj(r.payload.permit).hsid) ?? str(obj(r.payload.scope).hsid);

/** Sessions in open order (first session.open seq). */
function sessionsOf(rows: readonly LogRow[]): string[] {
  const seen: string[] = [];
  for (const r of rows) {
    if (r.kind !== 'session.open') continue;
    const h = hsidOf(r);
    if (h && !seen.includes(h)) seen.push(h);
  }
  return seen;
}

function logEventOf(r: LogRow): TraceEvent {
  const p = r.payload;
  const base = { t: r.at, source: 'log' as const, kind: r.kind, seq: r.seq };
  switch (r.kind) {
    case 'session.open':
      return { ...base, cwd: p.cwd ?? null, uuid: p.uuid ?? null, by: p.by ?? null, model: p.model ?? null, ...(p.resume ? { resume: p.resume } : {}) };
    case 'turn.sent':
      return { ...base, turn: p.turn ?? null, permitId: p.permitId ?? null, contentHash: p.contentHash ?? null };
    case 'turn.usage':
    case 'turn.result':
      return { ...base, tokens: obj(p.usage).tokens ?? null, ...(r.kind === 'turn.result' ? { costUsd: p.cost ?? null, subtype: p.subtype ?? null, isError: p.isError ?? null, permissionDenials: p.permission_denials ?? null } : {}) };
    case 'approval.request': {
      const c = obj(p.card);
      return { ...base, cardId: c.cardId ?? null, cardKind: c.kind ?? null, tool: p.tool ?? null, title: c.title ?? c.summary ?? null, payload: p };
    }
    default:
      return { ...base, payload: p };
  }
}

interface TranscriptLine {
  type?: unknown;
  timestamp?: unknown;
  isMeta?: unknown;
  message?: { role?: unknown; content?: unknown };
}

/** The prompt text of a transcript user message as the supervisor sent it (string content, or the text blocks joined). */
/**
 * The human's prompt text of a transcript user message: the FIRST text block only. The kernel's contentHash is the
 * hash of the human's text alone; a second text block is the table-talk `<gnomon-voice>` guidance (TD-2026-10-20-294),
 * which is never part of the turn's content and is not checked against the log.
 */
export function promptText(content: unknown): string | null {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return null;
  const first = content.find((b) => obj(b).type === 'text');
  return first === undefined ? null : String(obj(first).text ?? '');
}

function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((b) => (obj(b).type === 'text' ? String(obj(b).text ?? '') : `[${String(obj(b).type ?? '?')}]`)).join('');
  return '';
}

function transcriptEvents(file: string): { events: TraceEvent[]; lines: number } {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return { events: [], lines: 0 };
  }
  const events: TraceEvent[] = [];
  let lines = 0;
  for (const raw of text.split('\n')) {
    if (!raw.trim()) continue;
    lines++;
    let l: TranscriptLine;
    try {
      l = JSON.parse(raw) as TranscriptLine;
    } catch {
      continue;
    }
    const t = str(l.timestamp) ?? '';
    const content = l.message?.content;
    if (l.type === 'user') {
      if (Array.isArray(content)) {
        for (const b of content) {
          const o = obj(b);
          if (o.type === 'tool_result') events.push({ t, source: 'transcript', kind: 'tool_result', toolUseId: o.tool_use_id ?? null, isError: o.is_error === true, text: resultText(o.content) });
        }
      }
      const prompt = promptText(content);
      if (prompt !== null && l.isMeta !== true) events.push({ t, source: 'transcript', kind: 'prompt', text: prompt, contentHash: turnContentHash(prompt) });
    } else if (l.type === 'assistant' && Array.isArray(content)) {
      for (const b of content) {
        const o = obj(b);
        if (o.type === 'text') events.push({ t, source: 'transcript', kind: 'reply', text: String(o.text ?? '') });
        else if (o.type === 'tool_use') events.push({ t, source: 'transcript', kind: 'tool_use', toolUseId: o.id ?? null, name: o.name ?? null, input: o.input ?? null });
      }
    }
  }
  return { events, lines };
}

/** The raw capture of a session: `traceDirOf(home, <realpath cwd>)/traceFileName(hsid)` (kernel/trace/capture.ts). */
function captureFile(home: string | undefined, cwd: string | null, hsid: string): string | null {
  if (!cwd || !home) return null;
  let project = cwd;
  try {
    project = fs.realpathSync.native(cwd);
  } catch {
    /* a cwd that no longer exists keeps its recorded spelling */
  }
  const f = path.join(traceDirOf(home, project), traceFileName(hsid));
  try {
    return fs.lstatSync(f).isFile() ? f : null; // never a link, a FIFO or a device (a FIFO would hang the read)
  } catch {
    return null;
  }
}

function captureEvents(file: string): { events: TraceEvent[]; lines: number; skipped: number } {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return { events: [], lines: 0, skipped: 0 };
  }
  const events: TraceEvent[] = [];
  let lines = 0;
  let skipped = 0;
  for (const raw of text.split('\n')) {
    if (!raw.trim()) continue;
    lines++;
    try {
      const o = obj(JSON.parse(raw));
      const dir = o.dir === 'in' || o.dir === 'out' || o.dir === 'ctl' ? o.dir : null;
      if (!dir || typeof o.t !== 'string') {
        skipped++;
        continue;
      }
      const line = obj(o.line);
      // a secret-shaped line is recorded as {redacted, hash, bytes}: shown as [redacted], never reconstructed
      if (typeof line.redacted === 'string') events.push({ t: o.t, source: 'capture', kind: `capture.${dir}`, redacted: line.redacted, hash: line.hash ?? null, bytes: line.bytes ?? null });
      else events.push({ t: o.t, source: 'capture', kind: `capture.${dir}`, type: line.type ?? null, subtype: line.subtype ?? null, line: o.line ?? null });
    } catch {
      skipped++;
    }
  }
  return { events, lines, skipped };
}

function findTranscript(claudeDir: string, cwd: string | null, uuid: string | null): string | null {
  if (!uuid || !/^[A-Za-z0-9-]+$/.test(uuid)) return null;
  const projects = path.join(claudeDir, 'projects');
  if (cwd) {
    const f = path.join(projects, encodeClaudeProjectDir(cwd), `${uuid}.jsonl`);
    if (fs.existsSync(f)) return f;
  }
  let dirs: string[];
  try {
    dirs = fs.readdirSync(projects);
  } catch {
    return null;
  }
  for (const d of dirs) {
    const f = path.join(projects, d, `${uuid}.jsonl`);
    if (fs.existsSync(f)) return f;
  }
  return null;
}

/** Build one session's trace (pure read). */
export function traceSession(rows: readonly LogRow[], chain: ChainCheck, hsid: string, deps: TraceDeps = {}): TraceSession {
  const claudeDir = deps.claudeDir ?? path.join(os.homedir(), '.claude');
  const cards = new Set<string>();
  const mine: LogRow[] = [];
  for (const r of rows) {
    if (hsidOf(r) === hsid) {
      mine.push(r);
      const c = str(obj(r.payload.card).cardId);
      if (r.kind === 'approval.request' && c) cards.add(c);
    } else if (r.kind.startsWith('approval.') && cards.has(str(r.payload.cardId) ?? '')) mine.push(r);
  }
  const first = mine[0]?.seq ?? 0;
  const last = mine[mine.length - 1]?.seq ?? 0;
  const start = [...rows].reverse().find((r) => r.kind === 'daemon.start' && r.seq < first);
  const exit = rows.find((r) => r.kind === 'daemon.exit' && r.seq > last);
  const logRows = [...(start ? [start] : []), ...mine, ...(exit ? [exit] : [])];

  const open = mine.find((r) => r.kind === 'session.open');
  const drained = mine.find((r) => r.kind === 'session.drained');
  const uuid = str(open?.payload.uuid) ?? str(drained?.payload.uuid);
  const cwd = str(open?.payload.cwd);
  const principal = str(open?.payload.by);
  const tracedRow = [...mine].reverse().find((r) => r.kind === 'session.sandbox' && typeof r.payload.traced === 'boolean');
  const traced = tracedRow ? { traced: tracedRow.payload.traced === true, refused: tracedRow.payload.traceRefused === undefined ? null : String(tracedRow.payload.traceRefused) } : null;

  const logEvents = logRows.map(logEventOf);
  const tFile = findTranscript(claudeDir, cwd, uuid);
  const tr = tFile ? transcriptEvents(tFile) : { events: [], lines: 0 };
  const cFile = captureFile(deps.home, cwd, hsid);
  const cap = cFile ? captureEvents(cFile) : { events: [], lines: 0, skipped: 0 };

  // verification: each turn.sent against the transcript prompts, by the supervisor's own hash
  const prompts = tr.events.filter((e) => e.kind === 'prompt');
  const unpaired = new Set(prompts);
  const turns = { sent: 0, matched: 0, mismatched: 0, unchecked: 0 };
  const loggedHashes = new Set<string>();
  for (const e of logEvents) {
    if (e.kind !== 'turn.sent') continue;
    turns.sent++;
    const h = str(e.contentHash);
    if (h) loggedHashes.add(h);
    if (!tFile) {
      e.verify = 'no-transcript';
      turns.unchecked++;
      continue;
    }
    const hit = prompts.find((p) => unpaired.has(p) && p.contentHash === h);
    if (hit) {
      unpaired.delete(hit);
      hit.verify = 'matches-log';
      hit.turn = e.turn;
      e.verify = 'matches-log';
      turns.matched++;
    } else {
      e.verify = 'hash-mismatch';
      turns.mismatched++;
    }
  }
  for (const p of prompts) if (!p.verify && !loggedHashes.has(String(p.contentHash))) p.verify = 'not-in-log';
  // a turn.sent with no matching prompt names the prompt it most likely was (the next unpaired one after it)
  for (const e of logEvents) {
    if (e.verify !== 'hash-mismatch') continue;
    const near = prompts.find((p) => unpaired.has(p) && p.t >= e.t) ?? [...unpaired][0];
    if (near) {
      unpaired.delete(near);
      near.verify = 'hash-mismatch';
      near.turn = e.turn;
    }
  }

  const tagged = [...logEvents.map((e, i) => ({ e, s: 0, i })), ...tr.events.map((e, i) => ({ e, s: 1, i })), ...cap.events.map((e, i) => ({ e, s: 2, i }))];
  tagged.sort((a, b) => {
    const ta = Date.parse(a.e.t);
    const tb = Date.parse(b.e.t);
    if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta - tb;
    return a.s - b.s || a.i - b.i;
  });

  let tokens = 0;
  let costUsd = 0;
  for (const e of logEvents) {
    if (e.kind === 'turn.result') {
      if (typeof e.tokens === 'number') tokens += e.tokens;
      if (typeof e.costUsd === 'number') costUsd += e.costUsd;
    }
  }
  return {
    session: { hsid, uuid, cwd, principal },
    traced,
    log: { rows: logRows.length, chainRows: chain.rows, hashChain: chain.ok ? 'ok' : 'broken', breaks: chain.breaks, firstBreak: chain.firstBreak, signatures: 'not-checked' },
    transcript: { path: tFile, lines: tr.lines },
    capture: { path: cFile, lines: cap.lines, skipped: cap.skipped },
    turns,
    usage: { tokens, costUsd },
    events: tagged.map((x) => x.e),
  };
}

/* ── human rendering ─────────────────────────────────────────────────────── */

function show(v: unknown, full: boolean): string {
  let s = typeof v === 'string' ? v : v === undefined ? '' : JSON.stringify(v);
  if (!full) {
    s = s.replace(/\r?\n/g, ' ⏎ ');
    const cps = [...s];
    if (cps.length > TRACE_TEXT_CAP) s = `${cps.slice(0, TRACE_TEXT_CAP).join('')}…`;
  }
  return sanitizeDisplayText(s).text;
}

const VERIFY_MARK: Record<string, string> = {
  'matches-log': '✓ matches log',
  'hash-mismatch': '✗ hash mismatch',
  'not-in-log': '· not in log',
  'no-transcript': '· no transcript to check',
};

function detailOf(e: TraceEvent, full: boolean): string {
  const v = typeof e.verify === 'string' ? `  ${VERIFY_MARK[e.verify] ?? e.verify}` : '';
  const p = obj(e.payload);
  switch (e.kind) {
    case 'prompt':
      return `${show(e.text, full)}${v}`;
    case 'reply':
    case 'tool_result':
      return `${e.isError ? 'ERROR ' : ''}${show(e.text, full)}`;
    case 'tool_use':
      return `${show(e.name, full)} ${show(e.input, full)}`;
    case 'session.open':
      return show(`${e.resume ? 'RESUME ' : ''}by ${String(e.by)}  cwd ${String(e.cwd)}  uuid ${String(e.uuid)}  model ${String(e.model)}`, full);
    case 'turn.sent':
      return `${show(e.turn, full)}  ${show(e.contentHash, full)}${v}`;
    case 'turn.usage':
      return `tokens ${String(e.tokens)}`;
    case 'turn.result':
      return show(`tokens ${String(e.tokens)}  cost $${typeof e.costUsd === 'number' ? e.costUsd.toFixed(4) : '?'}  ${String(e.subtype)}${e.isError ? '  ERROR' : ''}`, full);
    case 'approval.request':
      return show(`card ${String(e.cardId)}  ${String(e.cardKind)}${e.tool ? `  tool ${String(e.tool)}` : ''}${e.title ? `  ${String(e.title)}` : ''}`, full);
    case 'approval.decide':
      return show(`card ${String(p.cardId)}  ${String(p.decision ?? '?')}${p.approver ? `  by ${String(p.approver)}` : ''}`, full);
    case 'approval.expire':
      return show(`card ${String(p.cardId)}  into ${String(p.into ?? '?')}${p.why ? `  (${String(p.why)})` : ''}`, full);
    case 'approval.auto': {
      // P8-D87: a request answered allow with NO card — by run mode auto-edits, or by a standing always rule
      const ref = String(p.modeRef ?? '?');
      const why = ref.startsWith('mode:') ? `run mode ${ref.slice(5)}` : ref.startsWith('rule:') ? `always rule ${ref.slice(5)}` : ref;
      return show(`AUTO-APPROVED ${String(p.tool ?? '?')}${typeof p.path === 'string' ? `  ${p.path}` : ''}  (${why}, no card)  ${String(p.inputHash ?? '')}`, full);
    }
    case 'approval.mode.set': {
      const sc = obj(p.scope);
      return show(`run mode ${String(p.from ?? '?')} → ${String(p.to ?? '?')}  ${typeof sc.hsid === 'string' ? 'this session' : `repo ${String(sc.repo ?? '?')}`}  presence ${String(p.presence ?? '?')}`, full);
    }
    case 'request.mode.set':
      return show(`asked for run mode ${String(p.to ?? '?')}${typeof p.hsid === 'string' ? '  (this session)' : `  (repo ${String(p.repo ?? '?')})`}`, full);
    default:
      if (e.source === 'capture' && typeof e.redacted === 'string') return show(`[redacted] ${e.redacted}  ${String(e.hash)}  ${String(e.bytes)} bytes`, full);
      if (e.source === 'capture') return show(`${String(e.type)}${e.subtype ? `/${String(e.subtype)}` : ''}${full ? `  ${JSON.stringify(e.line)}` : ''}`, full);
      return show(e.payload ?? '', full);
  }
}

function render(out: Out, s: TraceSession, n: number, of: number, full: boolean): void {
  heading(out, 'trace', `${show(s.session.hsid, true)}${of > 1 ? `  (session ${n} of ${of})` : ''}`);
  const t = s.turns;
  readout(out, [
    ['uuid', show(s.session.uuid ?? '-', true)],
    ['cwd', show(s.session.cwd ?? '-', true)],
    ['principal', show(s.session.principal ?? '-', true)],
    ['log', `${s.log.rows} rows of this session; hash chain ${s.log.hashChain === 'ok' ? `ok over ${s.log.chainRows} rows` : `BROKEN: ${s.log.breaks} break(s), first ${show(s.log.firstBreak ?? '?', full)}`}; signatures not checked (gnomon replay verifies them)`],
    ['transcript', s.transcript.path ? `${show(s.transcript.path, true)}  (${s.transcript.lines} lines)` : 'not found'],
    ['traced', s.traced === null ? 'not recorded' : s.traced.traced ? 'yes (raw capture on)' : `no${s.traced.refused ? ` (refused: ${show(s.traced.refused, full)})` : ''}`],
    ['capture', s.capture.path ? `${show(s.capture.path, true)}  (${s.capture.lines} lines${s.capture.skipped ? `, ${s.capture.skipped} skipped` : ''})` : 'absent'],
    ['turns', `${t.sent} sent  ${t.matched} ✓ matches log  ${t.mismatched} ✗ hash mismatch${t.unchecked ? `  ${t.unchecked} unchecked` : ''}`],
    ['usage', `tokens ${s.usage.tokens}  cost $${s.usage.costUsd.toFixed(4)}`],
    ['note', 'contains prompt text'],
  ]);
  for (const e of s.events) {
    if (!full && (e.kind === 'turn.event' || e.kind === 'turn.partial')) continue;
    const time = /T(\d\d:\d\d:\d\d)/.exec(e.t)?.[1] ?? '--:--:--';
    out.write(`  ${time}  ${e.source.padEnd(10)}  ${show(e.kind, true).padEnd(18)}  ${detailOf(e, full)}\n`);
  }
}

/** `gnomon trace …` */
export async function runTraceCommand(argv: readonly string[], io: { stdout: Out; stderr: Out }, deps: TraceDeps = {}): Promise<number> {
  const sub = argv[0];
  if (sub === 'on' || sub === 'off' || sub === 'status' || sub === 'path') return runTraceMode(sub, argv.slice(1), io);
  let home: string | undefined;
  let mode: { by: 'last' } | { by: 'session'; hsid: string } | { by: 'since'; at: number; iso: string } = { by: 'last' };
  let picked = 0;
  let json = false;
  let full = false;
  const usage = (msg: string): number => {
    refused(io.stderr, 'BAD_REQUEST', 'usage', msg, ['gnomon trace --help']);
    return TRACE_EXIT_USAGE;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--help' || a === '-h') {
      io.stdout.write(`gnomon ${GNOMON_VERSION}\n${TRACE_USAGE}`);
      return TRACE_EXIT_OK;
    } else if (a === '--json') json = true;
    else if (a === '--full') full = true;
    else if (a === '--home') {
      const v = argv[++i];
      if (!v || !path.isAbsolute(v)) return usage('--home needs an absolute path');
      home = v;
    } else if (a === '--last') {
      picked++;
      mode = { by: 'last' };
    } else if (a === '--session') {
      const v = argv[++i];
      if (!v) return usage('--session needs an hsid');
      picked++;
      mode = { by: 'session', hsid: v };
    } else if (a === '--since') {
      const v = argv[++i];
      const at = v ? Date.parse(v) : Number.NaN;
      if (!v || !Number.isFinite(at)) return usage('--since needs an ISO time');
      picked++;
      mode = { by: 'since', at, iso: v };
    } else return usage(`unknown argument (${a.length} chars)`);
  }
  if (picked > 1) return usage('choose one of --last, --session, --since');
  home = path.resolve(home ?? resolveGnomonHome());

  let read: ReturnType<typeof readRows>;
  try {
    read = readRows(home);
  } catch (err) {
    refused(io.stderr, 'ENGINE', 'trace-unreadable', `could not read the log: ${sanitizeDisplayText((err as Error).message).text}`, ['check --home']);
    return TRACE_EXIT_REFUSED;
  }
  const all = sessionsOf(read.rows);
  let chosen: string[];
  if (mode.by === 'last') chosen = all.slice(-1);
  else if (mode.by === 'session') {
    const want = mode.hsid;
    const exact = all.filter((h) => h === want);
    chosen = exact.length ? exact : all.filter((h) => h.includes(want));
    if (chosen.length > 1) {
      refused(io.stderr, 'BAD_REQUEST', 'ambiguous-session', `${chosen.length} sessions match; give more of the hsid`, chosen.slice(0, 5).map((h) => `gnomon trace --session ${sanitizeDisplayText(h).text}`));
      return TRACE_EXIT_USAGE;
    }
  } else {
    const at = mode.at;
    chosen = all.filter((h) => read.rows.some((r) => hsidOf(r) === h && Date.parse(r.at) >= at));
  }
  if (!chosen.length) {
    refused(io.stderr, 'NOT_FOUND', 'no-session', all.length ? 'no session matches' : `no session in the log of ${sanitizeDisplayText(home).text}`, ['gnomon trace --help']);
    return TRACE_EXIT_REFUSED;
  }
  chosen.forEach((h, i) => {
    const s = traceSession(read.rows, read.chain, h, { ...deps, home });
    if (json) io.stdout.write(`${JSON.stringify(s)}\n`);
    else {
      if (i > 0) io.stdout.write('\n');
      render(io.stdout, s, i + 1, chosen.length, full);
    }
  });
  return TRACE_EXIT_OK;
}

/** `gnomon trace on | off | status | path [--home <abs>] [--folder <abs>]` — per-project trace mode. */
function runTraceMode(sub: 'on' | 'off' | 'status' | 'path', argv: readonly string[], io: { stdout: Out; stderr: Out }): number {
  let home: string | undefined;
  let folder: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--help' || a === '-h') {
      io.stdout.write(`gnomon ${GNOMON_VERSION}\n${TRACE_USAGE}`);
      return TRACE_EXIT_OK;
    } else if (a === '--home' || a === '--folder') {
      const v = argv[++i];
      if (!v || !path.isAbsolute(v)) {
        refused(io.stderr, 'BAD_REQUEST', 'usage', `${a} needs an absolute path`, ['gnomon trace --help']);
        return TRACE_EXIT_USAGE;
      }
      if (a === '--home') home = v;
      else folder = v;
    } else {
      refused(io.stderr, 'BAD_REQUEST', 'usage', `unknown argument (${a.length} chars)`, ['gnomon trace --help']);
      return TRACE_EXIT_USAGE;
    }
  }
  home = path.resolve(home ?? resolveGnomonHome());
  let dir = folder ?? process.cwd();
  try {
    dir = fs.realpathSync.native(dir);
  } catch {
    if (sub !== 'off') {
      refused(io.stderr, 'NOT_FOUND', 'no-folder', `the folder does not exist: ${sanitizeDisplayText(dir).text}`, ['gnomon trace on --folder <an existing folder>']);
      return TRACE_EXIT_REFUSED;
    }
  }
  const shown = sanitizeDisplayText(dir).text;
  if (sub === 'status') {
    const all = tracedFolders(home);
    heading(io.stdout, 'trace', all.length ? `${all.length} folder(s) traced` : 'no folder traced');
    for (const f of all) io.stdout.write(`  ${sanitizeDisplayText(f).text}${f === dir ? '  (this folder)' : ''}\n`);
    if (!all.length) io.stdout.write('  next: gnomon trace on   (in the folder to record)\n');
    return TRACE_EXIT_OK;
  }
  const where = sanitizeDisplayText(traceDirOf(home, dir)).text;
  if (sub === 'path') {
    io.stdout.write(`${where}\n`);
    return TRACE_EXIT_OK;
  }
  const was = traceModeOf(home, dir);
  setTraceMode(home, dir, sub === 'on');
  if (sub === 'on') {
    heading(io.stdout, 'trace on', shown);
    readout(io.stdout, [
      ['records', 'the prompts and outputs of Claude sessions in this folder'],
      ['to', `${where}${path.sep}  (in the Gnomon home, never inside the folder)`],
      ['contains', 'prompt and tool text IN THE CLEAR; your own user account can read it outside Gnomon'],
      ['effect', 'new and resumed sessions; a running session is not recorded until it resumes'],
      ['state', was ? 'already on' : 'switched on'],
      ['read it', 'gnomon trace'],
      ['off', 'gnomon trace off'],
    ]);
  } else {
    heading(io.stdout, 'trace off', shown);
    readout(io.stdout, [
      ['state', was ? 'switched off' : 'was not on'],
      ['kept', `files already in ${where} stay; delete them yourself if you want them gone`],
    ]);
  }
  return TRACE_EXIT_OK;
}
