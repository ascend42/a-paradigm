/**
 * #doctor-hook-health — `paradigm doctor` hook-health section (7.15.2).
 *
 * Three questions, each answered with a concrete remedy line:
 *  1. How do the hooks actually perform here? Per-hook p50/p95/max wall time,
 *     timeouts (kills) and over-budget runs, read from the #hook-monitor ring
 *     (.paradigm/events/hook-timings.jsonl). A start record with no end, older
 *     than its timeout + 5 s, is a hook the host killed.
 *  2. What about this repo makes hooks slow? Nested git repos/worktrees under
 *     the root, the .purpose count, the aspect-anchor line count, and a huge
 *     untracked tree.
 *  3. Is the plugin that runs the hooks stale? The installed user-scope
 *     version vs the marketplace (and, in the Paradigm repo, the repo) version,
 *     and project-scope pins older than the user install
 *     (~/.claude/plugins/installed_plugins.json).
 */
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';

export interface HookHealthCheck {
  name: string;
  status: 'ok' | 'warn' | 'error' | 'info';
  message: string;
  fix?: string;
}

export interface HookStats {
  hook: string;
  runs: number;
  p50: number;
  p95: number;
  max: number;
  killed: number;
  overBudget: number;
  budgetMs: number;
  timeoutMs: number;
  lastKilledAt?: number;
}

const GRACE_MS = 5000;

interface RingRow { ev?: string; hook?: string; id?: string; t?: number; ms?: number; outcome?: string; timeoutMs?: number; budgetMs?: number }

export function readHookRing(file: string): RingRow[] {
  if (!fs.existsSync(file)) return [];
  const rows: RingRow[] = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line) as RingRow);
    } catch {
      // a torn line (concurrent append, killed mid-write) is skipped
    }
  }
  return rows;
}

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];
}

export function summarizeHookRing(rows: RingRow[], nowMs: number): HookStats[] {
  const starts = new Map<string, RingRow>();
  const ended = new Set<string>();
  const by = new Map<string, { ms: number[]; killed: number; over: number; budget: number; timeout: number; lastKilled?: number }>();
  const slot = (h: string) => {
    let s = by.get(h);
    if (!s) by.set(h, (s = { ms: [], killed: 0, over: 0, budget: 0, timeout: 0 }));
    return s;
  };
  for (const r of rows) {
    if (!r.hook || !r.id) continue;
    if (r.ev === 'start') {
      starts.set(r.id, r);
      const s = slot(r.hook);
      s.budget = r.budgetMs ?? s.budget;
      s.timeout = r.timeoutMs ?? s.timeout;
    } else if (r.ev === 'end') {
      ended.add(r.id);
      const s = slot(r.hook);
      if (r.outcome === 'killed') {
        s.killed++;
        s.lastKilled = Math.max(s.lastKilled ?? 0, r.t ?? 0);
      } else if (typeof r.ms === 'number') {
        s.ms.push(r.ms);
        const b = starts.get(r.id)?.budgetMs ?? s.budget;
        if (b > 0 && r.ms > b) s.over++;
      }
    }
  }
  for (const [id, r] of starts) {
    if (ended.has(id) || typeof r.t !== 'number') continue;
    if (nowMs - r.t > (r.timeoutMs ?? 30000) + GRACE_MS) {
      const s = slot(r.hook!);
      s.killed++;
      s.lastKilled = Math.max(s.lastKilled ?? 0, r.t);
      // a killed run consumed its whole timeout: count it in the timings too
      s.ms.push(r.timeoutMs ?? 30000);
    }
  }
  return [...by.entries()]
    .map(([hook, s]) => {
      const sorted = [...s.ms].sort((a, b) => a - b);
      return { hook, runs: sorted.length, p50: pct(sorted, 0.5), p95: pct(sorted, 0.95), max: sorted[sorted.length - 1] ?? 0, killed: s.killed, overBudget: s.over, budgetMs: s.budget, timeoutMs: s.timeout, ...(s.lastKilled ? { lastKilledAt: s.lastKilled } : {}) };
    })
    .sort((a, b) => a.hook.localeCompare(b.hook));
}

const secs = (ms: number): string => `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)}s`;

export function hookTimingChecks(stats: HookStats[]): HookHealthCheck[] {
  if (stats.length === 0) {
    return [{ name: 'Hook timings', status: 'info', message: 'No hook timing records yet (.paradigm/events/hook-timings.jsonl)', fix: 'Records appear after the 7.15.2+ plugin hooks run; update the plugin if they never do: `claude plugin update paradigm@a-paradigm`' }];
  }
  return stats.map((s) => {
    const msg = `p50 ${secs(s.p50)}, p95 ${secs(s.p95)}, max ${secs(s.max)} over ${s.runs} run(s)` +
      (s.killed ? `; ${s.killed} killed at the ${secs(s.timeoutMs)} timeout` : '') +
      (s.overBudget ? `; ${s.overBudget} over the ${secs(s.budgetMs)} budget` : '');
    if (s.killed > 0) {
      return {
        name: `Hook ${s.hook}`, status: 'error' as const,
        message: `${msg}${s.hook === 'Stop' ? ' — enforcement did not run on those turns' : ''}`,
        fix: 'Update the plugin (`claude plugin update paradigm@a-paradigm`, then restart Claude Code), check the repo traits below, and time the hook by hand: `echo \'{}\' | CLAUDE_PROJECT_DIR=$PWD <plugin>/scripts/paradigm-<hook>.sh`',
      };
    }
    if (s.budgetMs > 0 && s.p95 > s.budgetMs) {
      return { name: `Hook ${s.hook}`, status: 'warn' as const, message: msg, fix: 'The hook is slow here but not killed yet; see the repo traits below and update the plugin' };
    }
    return { name: `Hook ${s.hook}`, status: 'ok' as const, message: msg };
  });
}

export interface RepoTraits {
  nestedRepos: string[];
  purposeCount: number;
  anchorLines: number;
  untrackedCount: number;
}

function gitLines(rootDir: string, args: string[]): string[] | null {
  try {
    return execFileSync('git', args, { cwd: rootDir, encoding: 'utf8', timeout: 10_000, maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }).split('\n').filter(Boolean);
  } catch {
    return null;
  }
}

/** Count anchor lines with the Stop hook's Check 4 rules (an "anchors:" line opens a list of "- " items). */
export function countAnchorLines(text: string): number {
  let n = 0;
  let inA = false;
  for (const line of text.split('\n')) {
    if (line.includes('anchors:')) { inA = true; continue; }
    if (line.includes('- ')) { if (inA) n++; continue; }
    inA = false;
  }
  return n;
}

export function repoTraits(rootDir: string, maxDepth = 4): RepoTraits {
  const nestedRepos: string[] = [];
  let visited = 0;
  const walk = (dir: string, depth: number): void => {
    if (depth > maxDepth || visited > 50_000) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      visited++;
      if (e.name === 'node_modules') continue;
      const full = path.join(dir, e.name);
      if (e.name === '.git') {
        if (dir !== rootDir) nestedRepos.push(path.relative(rootDir, dir));
        continue;
      }
      if (e.isDirectory() && !e.isSymbolicLink()) walk(full, depth + 1);
    }
  };
  walk(rootDir, 0);
  const files = gitLines(rootDir, ['ls-files', '-co', '--exclude-standard']) ?? [];
  const purposes = files.filter((f) => f === '.purpose' || f.endsWith('/.purpose'));
  let anchorLines = 0;
  for (const p of purposes) {
    try {
      anchorLines += countAnchorLines(fs.readFileSync(path.join(rootDir, p), 'utf8'));
    } catch {
      // unreadable .purpose: skip
    }
  }
  const untracked = gitLines(rootDir, ['ls-files', '-o', '--exclude-standard']) ?? [];
  return { nestedRepos, purposeCount: purposes.length, anchorLines, untrackedCount: untracked.length };
}

export function repoTraitChecks(t: RepoTraits): HookHealthCheck[] {
  const out: HookHealthCheck[] = [];
  out.push(t.nestedRepos.length > 0
    ? { name: 'Hook trait: nested repos', status: 'warn', message: `${t.nestedRepos.length} nested git repo(s)/worktree(s) under the root (e.g. ${t.nestedRepos.slice(0, 3).join(', ')})`, fix: 'Plugin hooks before 7.15.2 scanned every one of them on each Stop; update the plugin, and prune stale ones (`git worktree prune`, remove old .claude/worktrees/<name>)' }
    : { name: 'Hook trait: nested repos', status: 'ok', message: 'None under the root' });
  out.push(t.purposeCount > 1000 || t.anchorLines > 5000
    ? { name: 'Hook trait: .purpose / anchors', status: 'warn', message: `${t.purposeCount} .purpose file(s), ${t.anchorLines} aspect-anchor line(s) checked on every Stop`, fix: 'Remove stale ~aspect anchors and merge tiny .purpose files; each anchor is checked for existence on every Stop' }
    : { name: 'Hook trait: .purpose / anchors', status: 'ok', message: `${t.purposeCount} .purpose file(s), ${t.anchorLines} anchor line(s)` });
  out.push(t.untrackedCount > 5000
    ? { name: 'Hook trait: untracked tree', status: 'warn', message: `${t.untrackedCount} untracked, not-ignored file(s)`, fix: 'Add build outputs and caches to .gitignore; the hooks list untracked files on every Stop' }
    : { name: 'Hook trait: untracked tree', status: 'ok', message: `${t.untrackedCount} untracked file(s)` });
  return out;
}

function cmpSemver(a: string, b: string): number {
  const pa = a.split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = b.split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
}

function readVersion(file: string): string | null {
  try {
    const v = (JSON.parse(fs.readFileSync(file, 'utf8')) as { version?: unknown }).version;
    return typeof v === 'string' ? v : null;
  } catch {
    return null;
  }
}

interface InstallEntry { scope?: string; projectPath?: string; version?: string; installPath?: string }

export function pluginCacheChecks(rootDir: string, homeDir: string): HookHealthCheck[] {
  const pluginsDir = path.join(homeDir, '.claude', 'plugins');
  let installed: Record<string, InstallEntry[]> = {};
  try {
    installed = (JSON.parse(fs.readFileSync(path.join(pluginsDir, 'installed_plugins.json'), 'utf8')) as { plugins?: Record<string, InstallEntry[]> }).plugins ?? {};
  } catch {
    return [{ name: 'Plugin cache', status: 'info', message: 'No Claude Code plugin install record (~/.claude/plugins/installed_plugins.json)' }];
  }
  const out: HookHealthCheck[] = [];
  for (const [key, entries] of Object.entries(installed)) {
    if (!key.startsWith('paradigm@')) continue;
    const marketplace = key.slice('paradigm@'.length);
    const user = entries.find((e) => e.scope === 'user');
    const latest = [
      readVersion(path.join(pluginsDir, 'marketplaces', marketplace, 'plugins', 'paradigm', '.claude-plugin', 'plugin.json')),
      readVersion(path.join(rootDir, 'plugins', 'paradigm', '.claude-plugin', 'plugin.json')),
    ].filter((v): v is string => !!v).sort(cmpSemver).pop();
    if (user?.version && latest && cmpSemver(user.version, latest) < 0) {
      out.push({ name: `Plugin cache (${key})`, status: 'warn', message: `User install runs ${user.version}; ${latest} is available — hooks run the cached ${user.version} scripts`, fix: `\`claude plugin update ${key}\` (or /plugin -> update), then restart Claude Code` });
    } else if (user?.version) {
      out.push({ name: `Plugin cache (${key})`, status: 'ok', message: `User install ${user.version}${latest ? ` (latest ${latest})` : ''}` });
    }
    for (const e of entries) {
      if (e.scope !== 'project' || !e.version) continue;
      const ref = user?.version ?? latest;
      if (ref && cmpSemver(e.version, ref) < 0) {
        const here = e.projectPath && path.resolve(e.projectPath) === path.resolve(rootDir);
        out.push({ name: `Plugin pin (${key})`, status: here ? 'warn' : 'info', message: `Project-scope pin ${e.version} in ${e.projectPath ?? '?'} is older than ${ref} and shadows it there`, fix: `In ${e.projectPath ?? 'that project'}, open /plugin and update or uninstall the project-scope ${key}` });
      }
    }
  }
  if (out.length === 0) out.push({ name: 'Plugin cache', status: 'info', message: 'Paradigm plugin not installed in Claude Code' });
  return out;
}

export function hookHealthChecks(opts: { rootDir: string; homeDir: string; nowMs?: number }): HookHealthCheck[] {
  const ring = path.join(opts.rootDir, '.paradigm', 'events', 'hook-timings.jsonl');
  return [
    ...hookTimingChecks(summarizeHookRing(readHookRing(ring), opts.nowMs ?? Date.now())),
    ...repoTraitChecks(repoTraits(opts.rootDir)),
    ...pluginCacheChecks(opts.rootDir, opts.homeDir),
  ];
}
