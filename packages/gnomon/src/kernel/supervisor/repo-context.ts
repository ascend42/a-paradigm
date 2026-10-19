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
 *   worktree: memory and the plugin come from the cwd only (Claude runs there);
 *     a worktree root is a sandbox and hook root, not a context source (M2).
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

/**
 * H2 (Aegis): Claude Code runs `!`cmd`` and ```! fenced blocks in skills and commands BEFORE the model sees them.
 * Fail closed: a skill or command that contains either is not loaded, and the session's policy.json also sets
 * REPO_CONTEXT_SETTINGS.disableSkillShellExecution (2.1.303: "Commands are replaced with a placeholder").
 */
export function hasShellPreprocessing(text: string): boolean {
  return text.includes('!`') || /^[ \t]*(?:`{3,}|~{3,})[ \t]*!/m.test(text);
}
/** Kernel settings merged into an audited session's policy.json (P8-D97, H2). */
export const REPO_CONTEXT_SETTINGS = Object.freeze({ disableSkillShellExecution: true });

export type SanitizeResult = { ok: true; text: string; dropped: string[]; hooks: boolean } | { ok: false; why: string };

const FENCE = /^---[ \t]*$/;
const FM_UNSAFE = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F\u2028\u2029]/;
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
  // M3 (Aegis): no C0 (tab included) or C1 control, NEL, LS or PS anywhere in the frontmatter
  if (FM_UNSAFE.test(lines.slice(1, end).join('\n'))) return { ok: false, why: 'a control or line-separator character in the frontmatter' };
  const out: string[] = [];
  const seen = new Set<string>();
  const dropped: string[] = [];
  let keep = false;
  let current: string | null = null;
  let contOk = false;
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
      // M3: only after an empty value, a block scalar (| or > with modifiers) or a `- ` list (which needs an empty value)
      if (!contOk) return { ok: false, why: `a continuation line after the inline value of ${current}` };
      if (keep) out.push(l);
      continue;
    }
    const m = KEY_LINE.exec(l);
    if (!m) return { ok: false, why: 'an unparseable frontmatter line' };
    const key = m[1]!;
    if (seen.has(key)) return { ok: false, why: `a duplicate frontmatter key ${key}` };
    seen.add(key);
    current = key;
    const value = l.slice(m[0].length).trim();
    contOk = value === '' || value.startsWith('#') || /^[|>](?:[1-9][+-]?|[+-][1-9]?)?(?:[ \t]+#.*)?$/.test(value);
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
  /** `--add-dir` targets for memory (outermost first), each passed by auditMemoryDir */
  memoryDirs: string[];
  /** H1: memory dirs NOT added (relative to the git top-level), with why: a symlink, or an @ import leaving the repo */
  memoryRefused: Array<{ dir: string; why: string }>;
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

/**
 * The memory chain: the cwd and its ancestors up to the git top-level (innermost first), never the user home or
 * above; without a git top-level, the cwd alone. `top` bounds every `@` import (the git top-level, else the cwd).
 */
export function memoryChainOf(cwd: string, userHome: string): { chain: string[]; top: string } {
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
  return top === null ? { chain: chain.slice(0, 1), top: start } : { chain, top };
}

/** The memory dirs that hold memory, outermost first (unaudited: buildRepoContext audits them). */
export function memoryDirsOf(cwd: string, userHome: string): string[] {
  return memoryChainOf(cwd, userHome).chain.filter(hasMemory).reverse();
}

/** Claude Code's `@` import grammar (2.1.303, memory loader): the token, `#…` cut, `\ ` unescaped, accepted forms. */
const IMPORT_RE = /(?:^|\s)@((?:[^\s\\]|\\ )+)/g;
export const MAX_IMPORT_DEPTH = 5;

/** The `@` import targets of a memory file, resolved the way Claude resolves them (`~/` = the user home). Code spans are NOT skipped: stricter than Claude. */
export function importTargets(text: string, file: string, userHome: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(IMPORT_RE)) {
    let t = m[1] ?? '';
    const hash = t.indexOf('#');
    if (hash !== -1) t = t.slice(0, hash);
    t = t.replaceAll('\\ ', ' ');
    if (!t) continue;
    const accepted = t.startsWith('./') || t.startsWith('~/') || (t.startsWith('/') && t !== '/') || (!t.startsWith('@') && !/^[#%^&*()]+/.test(t) && /^[a-zA-Z0-9._-]/.test(t));
    if (!accepted) continue;
    out.push(t.startsWith('~/') ? path.join(userHome, t.slice(2)) : path.isAbsolute(t) ? path.normalize(t) : path.resolve(path.dirname(file), t));
  }
  return out;
}

/** The memory files of one dir (CLAUDE.md, .claude/CLAUDE.md, .claude/rules/**.md); a symlink anywhere on the way refuses. */
function memoryFilesOf(dir: string): { ok: true; files: string[] } | { ok: false; why: string } {
  const files: string[] = [];
  const lst = (p: string): fs.Stats | null => {
    try {
      return fs.lstatSync(p);
    } catch {
      return null;
    }
  };
  for (const p of [path.join(dir, 'CLAUDE.md'), path.join(dir, '.claude')]) if (lst(p)?.isSymbolicLink()) return { ok: false, why: `${path.relative(dir, p)} is a symlink` };
  const top = lst(path.join(dir, 'CLAUDE.md'));
  if (top?.isFile()) files.push(path.join(dir, 'CLAUDE.md'));
  const inner = lst(path.join(dir, '.claude', 'CLAUDE.md'));
  if (inner?.isSymbolicLink()) return { ok: false, why: '.claude/CLAUDE.md is a symlink' };
  if (inner?.isFile()) files.push(path.join(dir, '.claude', 'CLAUDE.md'));
  const rules = path.join(dir, '.claude', 'rules');
  const rs = lst(rules);
  if (rs?.isSymbolicLink()) return { ok: false, why: '.claude/rules is a symlink' };
  if (rs?.isDirectory()) {
    const walk = (d: string, depth: number): string | null => {
      if (depth > MAX_TREE_DEPTH) return `${path.relative(dir, d)} is nested too deep`;
      let ents: fs.Dirent[];
      try {
        ents = fs.readdirSync(d, { withFileTypes: true });
      } catch (err) {
        return `${path.relative(dir, d)} is unreadable (${(err as NodeJS.ErrnoException).code ?? 'error'})`;
      }
      for (const e of ents) {
        const p = path.join(d, e.name);
        if (e.isSymbolicLink()) return `${path.relative(dir, p)} is a symlink`;
        if (e.isDirectory()) {
          const w = walk(p, depth + 1);
          if (w) return w;
        } else if (e.isFile() && e.name.endsWith('.md')) files.push(p);
      }
      return null;
    };
    const w = walk(rules, 0);
    if (w) return { ok: false, why: w.split(path.sep).join('/') };
  }
  return { ok: true, files };
}

/**
 * H1 (Aegis): audit one memory dir in the KERNEL. Refused (the whole dir is not added) when any memory file is a
 * symlink, unreadable or oversized, or when any `@` import followed recursively (depth MAX_IMPORT_DEPTH, `~`,
 * absolute and relative forms) names an existing path outside `top`, or a symlink. A target that does not exist is
 * nothing Claude can load and is ignored.
 */
export function auditMemoryDir(dir: string, top: string, userHome: string): { ok: true } | { ok: false; why: string } {
  const listed = memoryFilesOf(dir);
  if (!listed.ok) return listed;
  const topReal = realpathLoose(top);
  const rel = (p: string): string => (isUnder(topReal, p) ? path.relative(topReal, p).split(path.sep).join('/') || '.' : p);
  const seen = new Set<string>();
  const visit = (file: string, depth: number): string | null => {
    if (seen.has(file)) return null;
    seen.add(file);
    const got = readFile(file);
    if (!got.ok) return `${rel(file)}: ${got.why}`;
    if (depth >= MAX_IMPORT_DEPTH) return null;
    for (const t of importTargets(got.buf.toString('utf8'), file, userHome)) {
      let st: fs.Stats;
      try {
        st = fs.lstatSync(t);
      } catch {
        continue; // nothing there: nothing to load
      }
      if (!isUnder(topReal, path.resolve(t)) || !isUnder(topReal, realpathLoose(t))) return `${rel(file)}: an @ import reaches outside the repo (${t.length > 120 ? `${t.slice(0, 120)}…` : t})`;
      if (st.isSymbolicLink()) return `${rel(file)}: an @ import is a symlink (${rel(t)})`;
      if (st.isFile()) {
        const w = visit(t, depth + 1);
        if (w) return w;
      }
    }
    return null;
  };
  for (const f of listed.files) {
    const w = visit(f, 0);
    if (w) return { ok: false, why: w };
  }
  return { ok: true };
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
  const { chain, top } = memoryChainOf(cwd, i.userHome);
  const ctx: RepoContext = { pluginDir: null, memoryDirs: [], memoryRefused: [], skills: [], agents: [], commands: [], refused: [], dropped: [], frontmatterHooks: [] };
  for (const d of chain.filter(hasMemory).reverse()) {
    const a = auditMemoryDir(d, top, i.userHome);
    if (a.ok) ctx.memoryDirs.push(d);
    else ctx.memoryRefused.push({ dir: path.relative(top, d).split(path.sep).join('/') || '.', why: a.why });
  }
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
  const sanitized = (relPath: string, buf: Buffer, keys: readonly string[], shell = false): string | null => {
    const raw = buf.toString('utf8');
    if (shell && hasShellPreprocessing(raw)) {
      ctx.refused.push({ path: relPath, why: 'shell preprocessing (!`…` or a ```! block) is not loaded (H2)' });
      return null;
    }
    const s = sanitizeFrontmatter(raw, keys);
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
      if (e.isSymbolicLink()) {
        ctx.refused.push({ path: r, why: 'a symlink' });
        continue;
      }
      if (!e.isDirectory()) continue; // Claude loads skill DIRS only
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
        const fRel = `${r}/${f.split(path.sep).join('/')}`;
        if (path.basename(f) === 'SKILL.md') {
          // H3: EVERY SKILL.md, at any depth, is sanitized like the skill's own
          const t = sanitized(fRel, got.buf, SKILL_KEYS, true);
          if (t === null) {
            why = '';
            break;
          }
          mine.push({ dst: path.join('skills', e.name, f), data: t });
        } else if (f.endsWith('.md')) {
          // H3: any other .md whose frontmatter declares hooks (or cannot be read as frontmatter) refuses the skill
          const fm = sanitizeFrontmatter(got.buf.toString('utf8'), []);
          if (!fm.ok || fm.hooks) {
            why = `${f.split(path.sep).join('/')}: ${fm.ok ? 'a nested .md declares hooks' : fm.why}`;
            break;
          }
          mine.push({ dst: path.join('skills', e.name, f), data: got.buf });
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
        const t = sanitized(r, got.buf, COMMAND_KEYS, true);
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

/** The `gate-class.detected{what:'repo-context'}` payload (names and counts only, bounded). */
export function repoContextRow(hsid: string, ctx: RepoContext, info: RepoSettingsInfo): Record<string, unknown> {
  const cap = <T>(l: readonly T[]): T[] => l.slice(0, 64);
  return {
    what: 'repo-context', hsid, plugin: ctx.pluginDir !== null, memoryDirs: ctx.memoryDirs.length,
    memoryRefused: cap(ctx.memoryRefused), skills: cap(ctx.skills), agents: cap(ctx.agents), commands: cap(ctx.commands),
    refused: cap(ctx.refused), dropped: cap(ctx.dropped), frontmatterHooks: cap(ctx.frontmatterHooks), run: 0,
    notLoaded: { permissions: info.permissions, envKeys: cap(info.envKeys), otherKeys: cap(info.otherKeys), unreadable: info.unreadable },
  };
}

/** The repo-card lines about the context (kernel-composed): what memory and which items were refused. */
export function repoContextLines(ctx: RepoContext): string[] {
  const lines: string[] = [];
  for (const m of ctx.memoryRefused.slice(0, 8)) lines.push(`repo memory NOT loaded (P8-D97 audit): ${m.dir}: ${m.why}`);
  if (ctx.memoryRefused.length > 8) lines.push(`repo memory NOT loaded: ${ctx.memoryRefused.length - 8} more dirs`);
  if (ctx.refused.length) lines.push(`repo skills/agents/commands NOT loaded: ${ctx.refused.slice(0, 8).map((r) => `${r.path} (${r.why})`).join('; ')}${ctx.refused.length > 8 ? ` and ${ctx.refused.length - 8} more` : ''}`);
  return lines.map((l) => l.replace(COMMAND_UNSAFE_G, '?'));
}
const COMMAND_UNSAFE_G = new RegExp(COMMAND_UNSAFE.source, 'gu');
