/**
 * @symbol #supervisor
 *
 * Repo context in `audited` sessions (P8-D97, founder ruling 2026-10-18; spec
 * §3.3; probe p10m-repo-context, real Claude Code 2.1.303, pass). A session
 * opened in a repo loads that repo's CLAUDE.md (with `@` imports), its
 * `.claude/skills`, `.claude/agents` and `.claude/commands` as plain Claude
 * Code would, while every repo hook stays audited (P8-D94). The session still
 * runs `--setting-sources user`, so the repo's settings layers never reach
 * Claude raw. Instead:
 *
 *   memory: `--add-dir <dir>` for the cwd and each ancestor up to the git
 *     top-level that holds a CLAUDE.md, `.claude/CLAUDE.md` or `.claude/rules`,
 *     with `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1` in the child env.
 *     Claude loads additional-dir memory without the project source (2.1.303,
 *     measured) and does NOT load the add-dir's skills or hooks. Without a git
 *     top-level only the cwd is added; the user home and above never are.
 *   skills, agents, commands: COPIED by the kernel into a session-owned local
 *     plugin (`<session dir>/context`, loaded with `--plugin-dir`; the session
 *     dir is read-allowed and write-denied by the session profile). Frontmatter
 *     is ALLOW-LISTED per kind: `hooks` (p10m-repo-context: a plugin skill's
 *     frontmatter hooks DO fire), `allowed-tools` (would skip the P8-D96 card),
 *     `permissionMode`, `mcpServers` and every unknown key are dropped. A
 *     frontmatter Gnomon cannot parse line by line (tabs, flow style at the
 *     top level, quoted or duplicate keys, an unterminated block) refuses that
 *     file: it is not loaded. Symlinks are refused. Bounded: MAX_CONTEXT_FILES
 *     files, MAX_CONTEXT_BYTES in total, MAX_CONTEXT_FILE_BYTES each.
 *     Plugin items are namespaced: `project:x`, `/project:z` (residual).
 *   frontmatter hooks are never approvable in this slice: they are stripped
 *     and listed (`frontmatterHooks`), never run.
 *   non-hook settings (permissions, env, everything else in the repo's
 *     `.claude/settings*.json`) are NOT loaded. `repoSettingsInfo` reports
 *     them (counts and env key names, never values) for the repo-hook cards
 *     and the `gate-class.detected{what:'repo-context'}` row.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { COMMAND_UNSAFE } from '../manifest/manifest.js';
import { realpathLoose } from '../manifest/policy.js';
import { readLayer, REPO_HOOK_FILES, uniqueRoots } from './repo-hooks.js';

/** The generated plugin's name: its items appear as `project:<name>`. */
export const REPO_CONTEXT_PLUGIN = 'project';
/** The child env that makes Claude load `--add-dir` memory (CLAUDE.md, .claude/CLAUDE.md, .claude/rules). */
export const REPO_CONTEXT_ENV: Readonly<Record<string, string>> = Object.freeze({ CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD: '1' });

export const SKILL_KEYS = Object.freeze(['name', 'description', 'when_to_use', 'argument-hint', 'arguments', 'disable-model-invocation', 'user-invocable', 'model', 'effort', 'context', 'agent', 'paths', 'license', 'version', 'metadata']);
export const AGENT_KEYS = Object.freeze(['name', 'description', 'tools', 'disallowedTools', 'model', 'color', 'effort', 'maxTurns', 'skills']);
export const COMMAND_KEYS = Object.freeze(['name', 'description', 'when_to_use', 'argument-hint', 'arguments', 'model', 'effort', 'disable-model-invocation']);

export const MAX_CONTEXT_FILES = 1024;
export const MAX_CONTEXT_BYTES = 16 * 1024 * 1024;
export const MAX_CONTEXT_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_TREE_DEPTH = 6;
/** A file or dir name the kernel copies: no dot-leading, separator, control or format character, bounded. */
const NAME_RE = /^[A-Za-z0-9_][A-Za-z0-9._ +@-]{0,127}$/;

export type SanitizeResult = { ok: true; text: string; dropped: string[]; hooks: boolean } | { ok: false; why: string };

const FENCE = /^---[ \t]*$/;
const KEY_LINE = /^([A-Za-z][A-Za-z0-9_-]{0,63})[ \t]*:(?:[ \t]|$)/;

/**
 * Keep only the allowed top-level frontmatter keys (and their indented or `- ` continuation lines). Fail closed:
 * anything that is not a plain `key:` line, a continuation, a blank or a comment refuses the whole file.
 */
export function sanitizeFrontmatter(raw: string, allowed: readonly string[]): SanitizeResult {
  let text = raw.startsWith('﻿') ? raw.slice(1) : raw;
  text = text.replace(/\r\n/g, '\n');
  if (text.includes('\r')) return { ok: false, why: 'a bare carriage return' };
  if (!text.trimStart().startsWith('---')) return { ok: true, text, dropped: [], hooks: false }; // no frontmatter
  const lines = text.split('\n');
  if (!FENCE.test(lines[0]!)) return { ok: false, why: 'frontmatter must open on the first line' };
  const end = lines.findIndex((l, i) => i > 0 && FENCE.test(l));
  if (end < 0) return { ok: false, why: 'unterminated frontmatter' };
  const out: string[] = [];
  const seen = new Set<string>();
  const dropped: string[] = [];
  let keep = false;
  let current: string | null = null;
  let hooks = false;
  for (const l of lines.slice(1, end)) {
    if (l.trim() === '') {
      if (current === null || keep) out.push(l);
      continue;
    }
    if (l.startsWith('#')) continue; // a comment: dropped
    if (l.startsWith('\t')) return { ok: false, why: 'a tab-indented frontmatter line' };
    if (l.startsWith(' ') || l === '-' || l.startsWith('- ')) {
      if (current === null) return { ok: false, why: 'a continuation line before any key' };
      if (keep) out.push(l);
      continue;
    }
    const m = KEY_LINE.exec(l);
    if (!m) return { ok: false, why: 'an unparseable frontmatter line' };
    const key = m[1]!;
    if (seen.has(key)) return { ok: false, why: `a duplicate frontmatter key ${key}` };
    seen.add(key);
    current = key;
    keep = allowed.includes(key);
    if (key === 'hooks') hooks = true;
    if (keep) out.push(l);
    else dropped.push(key);
  }
  return { ok: true, text: ['---', ...out, ...lines.slice(end)].join('\n'), dropped, hooks };
}

export interface RepoContext {
  /** the generated plugin dir, or null when the repo has no skill, agent or command to load */
  pluginDir: string | null;
  /** `--add-dir` targets for memory (outermost first) */
  memoryDirs: string[];
  skills: string[];
  agents: string[];
  commands: string[];
  /** repo-relative paths not loaded, with why */
  refused: Array<{ path: string; why: string }>;
  /** repo-relative paths whose frontmatter lost keys (hooks, allowed-tools, permissionMode, unknown) */
  dropped: Array<{ path: string; keys: string[] }>;
  /** repo-relative paths whose frontmatter declared `hooks` (stripped: never run) */
  frontmatterHooks: string[];
}

const isUnder = (a: string, b: string): boolean => a === b || b.startsWith(a.endsWith(path.sep) ? a : a + path.sep);

function hasMemory(dir: string): boolean {
  const file = (p: string): boolean => {
    try {
      return fs.statSync(p).isFile();
    } catch {
      return false;
    }
  };
  let rules = false;
  try {
    rules = fs.statSync(path.join(dir, '.claude', 'rules')).isDirectory();
  } catch {
    /* none */
  }
  return file(path.join(dir, 'CLAUDE.md')) || file(path.join(dir, '.claude', 'CLAUDE.md')) || rules;
}

/** The memory dirs: the cwd and its ancestors up to the git top-level (outermost first); never the user home or above. */
export function memoryDirsOf(cwd: string, userHome: string): string[] {
  const home = realpathLoose(userHome);
  const start = realpathLoose(cwd);
  const chain: string[] = [];
  let top: string | null = null;
  for (let d = start; ; ) {
    if (isUnder(d, home)) break; // the user home itself, or above it
    chain.push(d);
    if (fs.existsSync(path.join(d, '.git'))) {
      top = d;
      break;
    }
    const parent = path.dirname(d);
    if (parent === d) break;
    d = parent;
  }
  const dirs = top === null ? chain.slice(0, 1) : chain;
  return dirs.filter(hasMemory).reverse();
}

interface Budget {
  files: number;
  bytes: number;
}

/** Read a regular file (no symlink), bounded. */
function readFile(p: string): { ok: true; buf: Buffer } | { ok: false; why: string } {
  let fd: number;
  try {
    fd = fs.openSync(p, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return { ok: false, why: code === 'ELOOP' ? 'a symlink' : `unreadable (${code ?? 'error'})` };
  }
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile()) return { ok: false, why: 'not a regular file' };
    if (st.size > MAX_CONTEXT_FILE_BYTES) return { ok: false, why: `over ${MAX_CONTEXT_FILE_BYTES} bytes` };
    const buf = Buffer.alloc(st.size);
    let n = 0;
    while (n < st.size) {
      const r = fs.readSync(fd, buf, n, st.size - n, n);
      if (r <= 0) break;
      n += r;
    }
    return { ok: true, buf: buf.subarray(0, n) };
  } finally {
    fs.closeSync(fd);
  }
}

const okName = (n: string): boolean => NAME_RE.test(n) && !COMMAND_UNSAFE.test(n);

/** Collect a tree's regular files (relative paths), refusing symlinks, bad names and depth; null = refused. */
function listTree(dir: string, depth = 0): { ok: true; files: string[] } | { ok: false; why: string } {
  if (depth > MAX_TREE_DEPTH) return { ok: false, why: 'nested too deep' };
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (!okName(e.name)) return { ok: false, why: `an unsupported name ${JSON.stringify(e.name.slice(0, 64))}` };
    if (e.isSymbolicLink()) return { ok: false, why: `a symlink (${e.name})` };
    if (e.isDirectory()) {
      const sub = listTree(path.join(dir, e.name), depth + 1);
      if (!sub.ok) return sub;
      out.push(...sub.files.map((f) => path.join(e.name, f)));
    } else if (e.isFile()) out.push(e.name);
    else return { ok: false, why: `not a regular file (${e.name})` };
  }
  return { ok: true, files: out };
}

function writeOut(dst: string, data: string | Buffer): void {
  fs.mkdirSync(path.dirname(dst), { recursive: true, mode: 0o700 });
  fs.writeFileSync(dst, data, { mode: 0o600 });
}

/** A dir entry is a real dir (lstat, never a symlink). */
function realDir(p: string): boolean {
  try {
    return fs.lstatSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Build the session's repo context: the memory dirs and the generated plugin under `outDir` (wiped first).
 * Reads only `<cwd>/.claude/{skills,agents,commands}` and the memory files' presence; writes only under outDir.
 */
export function buildRepoContext(i: { cwd: string; userHome: string; outDir: string }): RepoContext {
  const cwd = realpathLoose(i.cwd);
  const ctx: RepoContext = { pluginDir: null, memoryDirs: memoryDirsOf(cwd, i.userHome), skills: [], agents: [], commands: [], refused: [], dropped: [], frontmatterHooks: [] };
  fs.rmSync(i.outDir, { recursive: true, force: true });
  const claudeDir = path.join(cwd, '.claude');
  try {
    if (fs.lstatSync(claudeDir).isSymbolicLink()) {
      ctx.refused.push({ path: '.claude', why: 'a symlink' });
      return ctx;
    }
  } catch {
    return ctx; // no .claude dir
  }
  const budget: Budget = { files: 0, bytes: 0 };
  const take = (n: number): boolean => {
    if (budget.files + 1 > MAX_CONTEXT_FILES || budget.bytes + n > MAX_CONTEXT_BYTES) return false;
    budget.files++;
    budget.bytes += n;
    return true;
  };
  const rel = (...p: string[]): string => ['.claude', ...p].join('/');
  const sanitized = (relPath: string, buf: Buffer, keys: readonly string[]): string | null => {
    const s = sanitizeFrontmatter(buf.toString('utf8'), keys);
    if (!s.ok) {
      ctx.refused.push({ path: relPath, why: s.why });
      return null;
    }
    if (s.dropped.length) ctx.dropped.push({ path: relPath, keys: s.dropped });
    if (s.hooks) ctx.frontmatterHooks.push(relPath);
    return s.text;
  };
  const writes: Array<{ dst: string; data: string | Buffer }> = [];

  // skills: <name>/SKILL.md plus the skill's own files (copied verbatim; only SKILL.md is frontmatter-parsed)
  const skillsDir = path.join(claudeDir, 'skills');
  if (realDir(skillsDir)) {
    for (const e of fs.readdirSync(skillsDir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const r = rel('skills', e.name);
      if (!okName(e.name)) {
        ctx.refused.push({ path: r, why: 'an unsupported name' });
        continue;
      }
      if (!e.isDirectory() || e.isSymbolicLink()) continue; // Claude loads skill DIRS only
      const tree = listTree(path.join(skillsDir, e.name));
      if (!tree.ok) {
        ctx.refused.push({ path: r, why: tree.why });
        continue;
      }
      if (!tree.files.includes('SKILL.md')) continue;
      const mine: Array<{ dst: string; data: string | Buffer }> = [];
      let why: string | null = null;
      for (const f of tree.files) {
        const got = readFile(path.join(skillsDir, e.name, f));
        if (!got.ok) {
          why = `${f}: ${got.why}`;
          break;
        }
        if (!take(got.buf.length)) {
          why = 'over the context budget';
          break;
        }
        if (f === 'SKILL.md') {
          const t = sanitized(`${r}/SKILL.md`, got.buf, SKILL_KEYS);
          if (t === null) {
            why = '';
            break;
          }
          mine.push({ dst: path.join('skills', e.name, f), data: t });
        } else mine.push({ dst: path.join('skills', e.name, f), data: got.buf });
      }
      if (why !== null) {
        if (why) ctx.refused.push({ path: r, why });
        continue;
      }
      writes.push(...mine);
      ctx.skills.push(e.name);
    }
  }
  // agents: top-level *.md
  const agentsDir = path.join(claudeDir, 'agents');
  if (realDir(agentsDir)) {
    for (const e of fs.readdirSync(agentsDir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (!e.name.endsWith('.md')) continue;
      const r = rel('agents', e.name);
      if (!okName(e.name) || !e.isFile()) {
        ctx.refused.push({ path: r, why: e.isSymbolicLink() ? 'a symlink' : 'an unsupported name or not a regular file' });
        continue;
      }
      const got = readFile(path.join(agentsDir, e.name));
      if (!got.ok || !take(got.buf.length)) {
        ctx.refused.push({ path: r, why: got.ok ? 'over the context budget' : got.why });
        continue;
      }
      const t = sanitized(r, got.buf, AGENT_KEYS);
      if (t === null) continue;
      writes.push({ dst: path.join('agents', e.name), data: t });
      ctx.agents.push(e.name.slice(0, -3));
    }
  }
  // commands: *.md, nested dirs kept (Claude namespaces them)
  const commandsDir = path.join(claudeDir, 'commands');
  if (realDir(commandsDir)) {
    const tree = listTree(commandsDir);
    if (!tree.ok) ctx.refused.push({ path: rel('commands'), why: tree.why });
    else {
      for (const f of tree.files.filter((x) => x.endsWith('.md'))) {
        const r = rel('commands', ...f.split(path.sep));
        const got = readFile(path.join(commandsDir, f));
        if (!got.ok || !take(got.buf.length)) {
          ctx.refused.push({ path: r, why: got.ok ? 'over the context budget' : got.why });
          continue;
        }
        const t = sanitized(r, got.buf, COMMAND_KEYS);
        if (t === null) continue;
        writes.push({ dst: path.join('commands', f), data: t });
        ctx.commands.push(f.slice(0, -3).split(path.sep).join(':'));
      }
    }
  }
  if (!writes.length) return ctx;
  fs.mkdirSync(i.outDir, { recursive: true, mode: 0o700 });
  writeOut(path.join(i.outDir, '.claude-plugin', 'plugin.json'), `${JSON.stringify({ name: REPO_CONTEXT_PLUGIN, version: '0.0.0', description: "This repo's skills, agents and commands, copied by Gnomon with frontmatter hooks stripped (P8-D97)" }, null, 2)}\n`);
  for (const w of writes) writeOut(path.join(i.outDir, w.dst), w.data);
  ctx.pluginDir = i.outDir;
  return ctx;
}

/** What the repo's settings layers carry besides hooks: NOT loaded (P8-D97), reported only. Never a value. */
export interface RepoSettingsInfo {
  files: string[];
  permissions: { allow: number; ask: number; deny: number; other: string[] };
  envKeys: string[];
  otherKeys: string[];
  unreadable: string[];
}

const SAFE_KEY = /^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/;
const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

export function repoSettingsInfo(roots: readonly string[]): RepoSettingsInfo {
  const info: RepoSettingsInfo = { files: [], permissions: { allow: 0, ask: 0, deny: 0, other: [] }, envKeys: [], otherKeys: [], unreadable: [] };
  const add = (list: string[], k: string): void => {
    const name = SAFE_KEY.test(k) ? k : '(unprintable)';
    if (!list.includes(name)) list.push(name);
  };
  for (const root of uniqueRoots(roots)) {
    for (const f of REPO_HOOK_FILES) {
      const rel = f.rel.join('/');
      const layer = readLayer(path.join(root, ...f.rel));
      if (layer === null) continue;
      if (!layer.ok) {
        info.unreadable.push(rel);
        continue;
      }
      let doc: unknown;
      try {
        doc = JSON.parse(layer.text);
      } catch {
        info.unreadable.push(rel);
        continue;
      }
      if (!isObj(doc)) {
        info.unreadable.push(rel);
        continue;
      }
      if (!info.files.includes(rel)) info.files.push(rel);
      for (const [k, v] of Object.entries(doc)) {
        if (k === 'hooks') continue;
        if (k === 'permissions' && isObj(v)) {
          for (const [pk, pv] of Object.entries(v)) {
            if ((pk === 'allow' || pk === 'ask' || pk === 'deny') && Array.isArray(pv)) info.permissions[pk] += pv.length;
            else add(info.permissions.other, pk);
          }
        } else if (k === 'env' && isObj(v)) for (const ek of Object.keys(v)) add(info.envKeys, ek);
        else add(info.otherKeys, k);
      }
    }
  }
  for (const l of [info.permissions.other, info.envKeys, info.otherKeys]) l.sort();
  return info;
}

/** The informational card lines (kernel-composed, bounded): empty when the repo sets nothing besides hooks. */
export function repoSettingsLines(info: RepoSettingsInfo): string[] {
  const p = info.permissions;
  const parts: string[] = [];
  if (p.allow || p.ask || p.deny || p.other.length) parts.push(`permissions (allow ${p.allow}, ask ${p.ask}, deny ${p.deny}${p.other.length ? `, ${p.other.slice(0, 8).join(', ')}` : ''})`);
  if (info.envKeys.length) parts.push(`env ${info.envKeys.slice(0, 16).join(', ')}${info.envKeys.length > 16 ? ` and ${info.envKeys.length - 16} more` : ''}`);
  if (info.otherKeys.length) parts.push(`other settings ${info.otherKeys.slice(0, 16).join(', ')}${info.otherKeys.length > 16 ? ` and ${info.otherKeys.length - 16} more` : ''}`);
  if (info.unreadable.length) parts.push(`unreadable ${info.unreadable.join(', ')}`);
  return parts.length ? [`not loaded from this repo (informational, P8-D97): ${parts.join('; ')}`] : [];
}
