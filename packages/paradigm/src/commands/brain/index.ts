/**
 * paradigm brain — the Paradigm Brain CLI (7.14.0, TD-2026-09-29-204).
 *
 * Structure for a personal folder without touching it: the index, labels and
 * logs live in ~/.paradigm/brains/<id>/, never inside the folder.
 *
 *   init <folder>                 allow-list a folder, flag private zones, scan
 *   scan                          refresh the index + read-only health report
 *   suggest                       next ≤10 topic suggestions (folders first)
 *   confirm <id> [--reject|--skip]
 *   status [--acceptance]
 *   share <pattern> / unshare     human-only; share asks on a terminal
 *   access <off|metadata>         agent (MCP) access; metadata asks on a terminal
 *   suggestions <auto|on|off>     suggestions feature flag
 *   purge [--yes] [--forget-log]  forget this folder (egress log archived first;
 *                                 --forget-log deletes it and earlier archives)
 *   egress                        what left this computer
 *
 * Engine: paradigm-mcp utils/brain (relative-import precedent, same edge the
 * memory CLI uses). Reads go through openBrainView(…, 'owner') only.
 */
import * as net from 'net';
import * as path from 'path';
import * as readline from 'readline';
import { spawn } from 'child_process';
import chalk from 'chalk';

import { out, success, warn, error, dim, header, kv, json } from '../../utils/cli-output.js';

import {
  initBrain,
  listBrains,
  loadBrainConfig,
  saveBrainConfig,
  addShare,
  removeShare,
  setAgentAccess,
  reviewBrainConfig,
  rootHashOf,
  isRootHash,
  BrainConfigError,
} from '../../../../paradigm-mcp/src/utils/brain/config.js';
import { openBrainView, scanBrain } from '../../../../paradigm-mcp/src/utils/brain/view.js';
import { readEgress, egressSummary } from '../../../../paradigm-mcp/src/utils/brain/egress.js';
import { purgeBrain } from '../../../../paradigm-mcp/src/utils/brain/purge.js';
import { TAMPER_BANNER } from '../../../../paradigm-mcp/src/utils/brain/types.js';
import { brainHealth } from '../../../../paradigm-mcp/src/utils/brain/health.js';
import {
  nextSuggestions,
  recordVerdict,
  acceptanceStats,
  suggestionsState,
  setSuggestionsMode,
  SuggestionError,
  ACCEPTANCE_THRESHOLD,
  MIN_DECIDED_FOR_FLAG,
  type SuggestionsMode,
} from '../../../../paradigm-mcp/src/utils/brain/suggest.js';
import { checkCrossLinks } from '../../../../paradigm-mcp/src/utils/brain/crosslink.js';
import { log as libraryLog } from '../../../../paradigm-mcp/src/utils/mcp-logger.js';

// ── quiet library logs ──────────────────────────────────────
// The brain engine logs INFO lines (#brain-config, #brain-index-store, …) to
// stderr for MCP/server use. On the CLI the user should only see cli-output
// lines, so library logs drop to warn unless LOG_LEVEL is set explicitly.
// ParadigmLogger resolves its level at construction and hands it to every
// log.component() call, so resetting the shared instance's level takes effect
// for all later calls regardless of when the logger module was first loaded.
export function quietLibraryLogs(): void {
  if (process.env.LOG_LEVEL) return;
  (libraryLog as unknown as { level: string }).level = 'warn';
}
quietLibraryLogs();

// ── shared surface ──────────────────────────────────────────

export interface BrainCliOptions {
  /** Brain id (16 hex). */
  brain?: string;
  /** Folder the brain was created for. */
  folder?: string;
  json?: boolean;
}

/** Injectable terminal (tests). */
export interface BrainPrompter {
  isTTY(): boolean;
  confirm(question: string): Promise<boolean>;
}

const defaultPrompter: BrainPrompter = {
  isTTY: () => Boolean(process.stdin.isTTY && process.stdout.isTTY),
  confirm: (question) =>
    new Promise((resolve) => {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl.question(`${question} [y/N] `, (answer) => {
        rl.close();
        resolve(/^y(es)?$/i.test(answer.trim()));
      });
    }),
};

let prompter: BrainPrompter = defaultPrompter;

/** Test hook — pass null to restore the real terminal. */
export function setBrainPrompter(p: BrainPrompter | null): void {
  prompter = p ?? defaultPrompter;
}

/** Injectable Platform launcher (tests). Returns the URL it opened, or null. */
export interface BrainLauncher {
  launch(): Promise<string | null>;
}

const PLATFORM_PORT = 3850;
export const BRAIN_URL = `http://localhost:${PLATFORM_PORT}/brain`;

function portOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect({ port, host: '127.0.0.1' });
    const done = (ok: boolean) => { sock.destroy(); resolve(ok); };
    sock.setTimeout(300, () => done(false));
    sock.once('connect', () => done(true));
    sock.once('error', () => done(false));
  });
}

/**
 * Start `paradigm serve` DETACHED (so init returns), wait briefly for it to
 * listen, then open the Brain section. If a Platform already listens on the
 * port, just open it.
 */
const defaultLauncher: BrainLauncher = {
  async launch() {
    if (!(await portOpen(PLATFORM_PORT))) {
      const cli = process.argv[1];
      if (!cli) return null;
      const child = spawn(process.execPath, [cli, 'serve', '--no-open', '--port', String(PLATFORM_PORT)], {
        detached: true,
        stdio: 'ignore',
        cwd: process.cwd(),
      });
      child.unref();
      let up = false;
      for (let i = 0; i < 25 && !up; i++) {
        await new Promise((r) => setTimeout(r, 200));
        up = await portOpen(PLATFORM_PORT);
      }
      if (!up) return null;
    }
    try {
      const { default: open } = await import('open');
      await open(BRAIN_URL);
    } catch {
      /* no browser — the printed URL is enough */
    }
    return BRAIN_URL;
  },
};

let launcher: BrainLauncher = defaultLauncher;

/** Test hook — pass null to restore the real launcher. */
export function setBrainLauncher(l: BrainLauncher | null): void {
  launcher = l ?? defaultLauncher;
}

function fail(message: string): void {
  error(message);
  process.exitCode = 1;
}

/** Which brain: --brain id, --folder path, or the only one there is. */
export function resolveBrain(options: BrainCliOptions): string | null {
  if (options.brain) {
    if (!isRootHash(options.brain)) { fail('That is not a brain id (run `paradigm brain status` to list them).'); return null; }
    return options.brain;
  }
  if (options.folder) {
    try { return rootHashOf(options.folder); } catch { fail('That folder does not exist.'); return null; }
  }
  const all = listBrains();
  if (all.length === 1) return all[0].rootHash;
  if (all.length === 0) { fail('No brain yet. Start with `paradigm brain init <folder>`.'); return null; }
  fail('More than one brain — pick one with --folder <path> or --brain <id>:');
  for (const b of all) dim(`  ${b.rootHash}  ${b.root}`);
  return null;
}

function guard<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch (e) {
    if (e instanceof BrainConfigError || e instanceof SuggestionError) fail(e.message);
    else fail(`Brain error: ${(e as Error).message}`);
    return undefined;
  }
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function gateLabel(gate: string): string {
  return ({ medical: 'health', financial: 'money', identity: 'identity papers', 'third-party-data': "other people's messages", quarantined: 'possible secrets' } as Record<string, string>)[gate] ?? gate;
}

// ── init ────────────────────────────────────────────────────

export async function initCommand(folder: string, options: BrainCliOptions & { workspace?: string; open?: boolean } = {}): Promise<void> {
  const res = guard(() => {
    const init = initBrain(folder);
    if (options.workspace) {
      const cfg = loadBrainConfig(init.rootHash);
      saveBrainConfig(init.rootHash, { ...cfg, workspace: path.resolve(options.workspace) });
    }
    const report = scanBrain(init.rootHash);
    const view = openBrainView(init.rootHash, 'owner');
    return { init, report, locked: view.lockedZones(), summary: view.summary() };
  });
  if (!res) return;
  const { init, report, locked, summary } = res;
  if (options.json) {
    json({ rootHash: init.rootHash, created: init.created, root: init.config.root, scan: report, locked, visible: summary.visible });
    return;
  }
  success(`${init.created ? 'Brain ready' : 'Brain already set up'} for ${init.config.root}`);
  kv('Brain id', init.rootHash);
  kv('Files', `${summary.visible} visible, ${summary.locked} locked`);
  printLocked(locked);
  dim('Nothing has left this Mac. Agents cannot see this folder unless you share parts of it.');
  dim('Next: `paradigm brain scan` for link health, `paradigm brain suggest` for topics.');
  if (options.open !== false && prompter.isTTY()) {
    const url = await launcher.launch().catch(() => null);
    if (url) {
      success(`Opened the Brain in Paradigm Platform: ${url}`);
      dim('The Platform keeps running in the background. Stop it any time; your notes are unaffected.');
    } else {
      dim(`To browse it: run \`paradigm serve\` and open ${BRAIN_URL}`);
    }
  } else if (options.open !== false) {
    dim(`To browse it: run \`paradigm serve\` and open ${BRAIN_URL}`);
  }
}

function printLocked(locked: Array<{ folder: string | null; gate: string; count: number }>): void {
  if (locked.length === 0) return;
  header('Private & locked (never shown to agents, never suggested)');
  for (const z of locked) out(`  ${chalk.yellow('●')} ${z.folder ?? '(individual files)'} — ${plural(z.count, 'file')} (${gateLabel(z.gate)})`);
}

// ── scan ────────────────────────────────────────────────────

export async function scanCommand(options: BrainCliOptions = {}): Promise<void> {
  const rootHash = resolveBrain(options);
  if (!rootHash) return;
  const res = guard(() => ({ report: scanBrain(rootHash), health: brainHealth(rootHash, 'owner'), links: checkCrossLinks(rootHash, 'owner') }));
  if (!res) return;
  const { report, health, links } = res;
  if (options.json) { json({ scan: report, health, crossLinks: links }); return; }
  success(`Scanned ${plural(report.files, 'file')} in ${report.durationMs} ms (${report.added} new, ${report.changed} changed, ${report.removed} removed)`);
  if (report.quarantined || report.thirdParty) warn(`${plural(report.quarantined + report.thirdParty, 'file')} locked by local checks — only name and size are kept.`);
  header('Health');
  kv('Broken links', String(health.counts.brokenLinks));
  for (const b of health.brokenLinks.slice(0, 10)) dim(`    ${b.relpath} → ${b.target}${b.heading ? `#${b.heading}` : ''}`);
  kv('Loose notes', String(health.counts.looseNotes));
  for (const l of health.looseNotes.slice(0, 10)) dim(`    ${l.relpath}`);
  kv('Same-name notes', String(health.counts.sameNameNotes));
  for (const g of health.sameNameNotes.slice(0, 10)) dim(`    ${g.name}: ${g.files.map((f) => f.relpath).join(', ')}`);
  const stale = links.filter((l) => l.verdict === 'provably-stale');
  const unknown = links.filter((l) => l.verdict === 'unknown');
  if (links.length) {
    kv('Links to code', `${links.length} (${stale.length} out of date)`);
    for (const l of stale) dim(`    ${l.relpath} → ${l.target} no longer exists`);
    if (unknown.length) {
      dim(`    ${unknown.length === 1 ? '1 link' : `${unknown.length} links`} to code couldn't be checked — the code index is missing or out of date. Run \`paradigm index\` in that project.`);
    }
  }
}

// ── suggest / confirm ───────────────────────────────────────

export async function suggestCommand(options: BrainCliOptions & { limit?: string } = {}): Promise<void> {
  const rootHash = resolveBrain(options);
  if (!rootHash) return;
  let limit: number | undefined;
  if (options.limit !== undefined) {
    limit = Number(options.limit);
    if (!/^\s*\d+\s*$/.test(String(options.limit)) || !Number.isFinite(limit) || limit < 1) {
      fail(`--limit must be a whole number from 1 to 10 (got "${options.limit}").`);
      return;
    }
  }
  const batch = guard(() => nextSuggestions(rootHash, { limit }));
  if (!batch) return;
  if (options.json) { json(batch); return; }
  if (!batch.state.enabled) {
    warn(suggestionsOffText(batch.state));
    return;
  }
  if (batch.suggestions.length === 0) { dim('No new suggestions. Scan again after your notes change.'); return; }
  header(`Suggested topics (${batch.suggestions.length}${batch.remaining ? `, ${batch.remaining} more waiting` : ''})`);
  for (const s of batch.suggestions) {
    const where = s.scope === 'folder' ? `folder ${s.target || '(top)'}` : `${plural(s.anchors.length, 'note')}`;
    out(`  ${s.id}  ${s.label}  — ${where}  (${Math.round(s.score * 100)}%)`);
    for (const e of s.evidence) dim(`      because ${e.detail}`);
  }
  dim('Keep one: `paradigm brain confirm <id>`   Not right: `--reject`   Not now: `--skip` (it comes back later)');
}

/** Plain copy for a disabled suggestions flag (auto-pause vs. turned off). */
export function suggestionsOffText(state: { paused?: boolean; enabled: boolean }): string {
  return state.paused
    ? 'Suggestions paused (too many dismissed). Turn back on with `paradigm brain suggestions on`.'
    : 'Suggestions are off. Turn back on with `paradigm brain suggestions on`.';
}

export async function confirmCommand(id: string, options: BrainCliOptions & { reject?: boolean; skip?: boolean } = {}): Promise<void> {
  if (options.reject && options.skip) { fail('Use --reject or --skip, not both.'); return; }
  const rootHash = resolveBrain(options);
  if (!rootHash) return;
  const verdict = options.reject ? 'reject' : options.skip ? 'skip' : 'accept';
  const res = guard(() => recordVerdict(rootHash, id, verdict));
  if (!res) return;
  if (options.json) { json(res); return; }
  if (verdict === 'accept') success(`Kept topic "${res.suggestion.label}"${res.declared?.backupPath ? ' (previous labels backed up)' : ''}`);
  else if (verdict === 'reject') success(`Dropped "${res.suggestion.label}"`);
  else dim(`Skipped "${res.suggestion.label}" for now — it will come back after the other suggestions.`);
}

// ── status ──────────────────────────────────────────────────

export async function statusCommand(options: BrainCliOptions & { acceptance?: boolean } = {}): Promise<void> {
  const all = listBrains();
  if (!options.brain && !options.folder && all.length !== 1) {
    if (options.json) { json({ brains: all }); return; }
    if (all.length === 0) { dim('No brain yet. Start with `paradigm brain init <folder>`.'); return; }
    header('Brains');
    for (const b of all) out(`  ${b.rootHash}  ${b.root}  (agents: ${b.tampered ? 'paused — settings changed outside Paradigm' : b.agentAccess === 'metadata' ? 'shared files only' : 'off'})`);
    if (all.some((b) => b.tampered)) warn(TAMPER_BANNER);
    return;
  }
  const rootHash = resolveBrain(options);
  if (!rootHash) return;
  const res = guard(() => {
    const cfg = loadBrainConfig(rootHash);
    const view = openBrainView(rootHash, 'owner');
    return { cfg, summary: view.summary(), locked: view.lockedZones(), egress: egressSummary(rootHash), stats: acceptanceStats(rootHash), flag: suggestionsState(rootHash) };
  });
  if (!res) return;
  const { cfg, summary, locked, egress, stats, flag } = res;
  if (options.json) {
    json({ rootHash, root: cfg.root, summary, locked, shared: cfg.share, agentAccess: cfg.agent_access, tampered: cfg.tampered === true, banner: cfg.tampered ? TAMPER_BANNER : null, egress, acceptance: stats, suggestions: flag });
    return;
  }
  if (cfg.tampered) {
    warn(TAMPER_BANNER);
    dim('Review the folder, shared patterns and zones below. If the change was yours, turn agents back on with `paradigm brain access metadata`.');
  }
  header(`Brain ${rootHash}`);
  kv('Folder', cfg.root);
  kv('Files', `${summary.visible} visible (${summary.byKind.markdown} notes, ${summary.byKind.text} text, ${summary.byKind.other} other), ${summary.locked} locked`);
  kv('Last scan', summary.scannedAt ?? 'never');
  kv('Shared with agents', cfg.share.length ? cfg.share.join(', ') : 'nothing');
  kv('Agent access', cfg.tampered ? 'paused (settings changed outside Paradigm)' : cfg.agent_access === 'metadata' ? 'names and headings of shared files' : 'off');
  kv('Left this Mac', egress.nothingLeft ? 'nothing' : `${plural(egress.count, 'response')}, ${egress.bytes} bytes (see \`paradigm brain egress\`)`);
  printLocked(locked);
  if (!flag.enabled) {
    out('');
    warn(suggestionsOffText(flag));
  }
  if (options.acceptance) {
    header('Suggestion acceptance');
    kv('Kept', String(stats.accept));
    kv('Dropped', String(stats.reject));
    kv('Skipped', String(stats.skip));
    kv('Acceptance', stats.acceptance === null ? 'not measured yet' : `${Math.round(stats.acceptance * 100)}% (target ≥ ${ACCEPTANCE_THRESHOLD * 100}% after ${MIN_DECIDED_FOR_FLAG} decisions)`);
    kv('Suggestions', flag.paused ? 'paused (too many dismissed)' : `${flag.enabled ? 'on' : 'off'} — ${flag.reason} (mode: ${flag.mode})`);
  }
}

// ── share / unshare / access / suggestions flag ─────────────

export async function shareCommand(glob: string, options: BrainCliOptions & { yes?: boolean } = {}): Promise<void> {
  if (!prompter.isTTY()) { fail('Sharing must be confirmed by a person at a terminal. Run this command interactively.'); return; }
  const rootHash = resolveBrain(options);
  if (!rootHash) return;
  const ok = await prompter.confirm(`Let agents see names and headings of files matching "${glob}"? Locked zones stay locked.`);
  if (!ok) { dim('Nothing shared.'); return; }
  const cfg = guard(() => addShare(rootHash, glob));
  if (!cfg) return;
  if (options.json) { json({ shared: cfg.share }); return; }
  success(`Shared "${glob}".${cfg.agent_access === 'off' ? ' Agent access is still off — `paradigm brain access metadata` to allow it.' : ''}`);
}

export async function unshareCommand(glob: string, options: BrainCliOptions = {}): Promise<void> {
  const rootHash = resolveBrain(options);
  if (!rootHash) return;
  const cfg = guard(() => removeShare(rootHash, glob));
  if (!cfg) return;
  if (options.json) { json({ shared: cfg.share }); return; }
  success(`Stopped sharing "${glob}".`);
}

export async function accessCommand(mode: string, options: BrainCliOptions = {}): Promise<void> {
  if (mode !== 'off' && mode !== 'metadata') { fail('Use `off` or `metadata`.'); return; }
  const rootHash = resolveBrain(options);
  if (!rootHash) return;
  const review = guard(() => reviewBrainConfig(rootHash));
  if (!review) return;
  if (review.tampered) {
    // Never rubber-stamp an out-of-band edit: show what changed since the last
    // settings Paradigm wrote, and require a person at a terminal to accept it.
    warn(TAMPER_BANNER);
    header('Changed since Paradigm last saved these settings');
    if (review.changes.length === 0) out('  (no difference in shared patterns, zones, workspace or agent access)');
    for (const c of review.changes) out(`  ${c}`);
    if (!prompter.isTTY()) { fail('Accepting settings changed outside Paradigm must be confirmed by a person at a terminal.'); return; }
    const accept = await prompter.confirm('Keep these settings as they are now?');
    if (!accept) { dim('Nothing changed. Agent access stays paused — fix brain.yaml or re-run this command.'); return; }
  }
  if (mode === 'metadata') {
    if (!prompter.isTTY()) { fail('Turning on agent access must be confirmed by a person at a terminal.'); return; }
    const ok = await prompter.confirm('Let agents see names and headings of SHARED files (every response is logged)?');
    if (!ok) { dim('Agent access unchanged.'); return; }
  }
  const cfg = guard(() => setAgentAccess(rootHash, mode, { acknowledgeTamper: review.tampered }));
  if (!cfg) return;
  if (options.json) { json({ agentAccess: cfg.agent_access }); return; }
  success(mode === 'off' ? 'Agents can no longer see this brain.' : 'Agents can now see names and headings of shared files. Every response is logged.');
}

export async function suggestionsFlagCommand(mode: string, options: BrainCliOptions = {}): Promise<void> {
  if (mode !== 'auto' && mode !== 'on' && mode !== 'off') { fail('Use `auto`, `on` or `off`.'); return; }
  const rootHash = resolveBrain(options);
  if (!rootHash) return;
  const state = guard(() => { setSuggestionsMode(rootHash, mode as SuggestionsMode); return suggestionsState(rootHash); });
  if (!state) return;
  if (options.json) { json(state); return; }
  if (!state.enabled && state.paused) { warn(suggestionsOffText(state)); return; }
  success(`Suggestions ${state.enabled ? 'on' : 'off'} (${state.reason}).`);
}

// ── purge / egress ──────────────────────────────────────────

export async function purgeCommand(options: BrainCliOptions & { yes?: boolean; forgetLog?: boolean } = {}): Promise<void> {
  const rootHash = resolveBrain(options);
  if (!rootHash) return;
  const forgetLog = options.forgetLog === true;
  if (!options.yes) {
    if (!prompter.isTTY()) { fail('Add --yes to forget this folder non-interactively.'); return; }
    const ok = await prompter.confirm(forgetLog
      ? 'Forget this folder AND the record of what left this Mac? Labels, index, suggestions and the log are deleted (your files are not touched).'
      : 'Forget this folder? Labels, index and suggestions are deleted (your files are not touched).');
    if (!ok) { dim('Nothing removed.'); return; }
  }
  const res = guard(() => purgeBrain(rootHash, { forgetLog }));
  if (!res) return;
  if (options.json) { json(res); return; }
  if (!res.removed && res.archivesDeleted === 0) { dim('Nothing to forget.'); return; }
  if (res.removed) success('Forgot this folder. Your files were not touched.');
  if (res.egressArchive) dim(`The record of what left this Mac was kept (until you run \`paradigm brain purge --forget-log\`): ${res.egressArchive}`);
  if (forgetLog) dim(`The record of what left this Mac was deleted${res.archivesDeleted ? ` (${res.archivesDeleted} earlier ${res.archivesDeleted === 1 ? 'copy' : 'copies'} too)` : ''}.`);
}

export async function egressCommand(options: BrainCliOptions & { limit?: string } = {}): Promise<void> {
  const rootHash = resolveBrain(options);
  if (!rootHash) return;
  const res = guard(() => ({ rows: readEgress(rootHash), summary: egressSummary(rootHash) }));
  if (!res) return;
  if (options.json) { json(res); return; }
  if (res.summary.nothingLeft) success('Nothing has left this Mac.');
  else warn(`${plural(res.summary.count, 'response')} left this Mac (${res.summary.bytes} bytes; last ${res.summary.last}).`);
  const limit = options.limit ? Math.max(1, parseInt(options.limit, 10) || 20) : 20;
  for (const r of res.rows.slice(-limit)) {
    dim(`  ${r.at}  ${r.channel}  ${r.op}  ${plural(r.fileIds.length, 'file')}  ${r.bytes} bytes`);
  }
}
