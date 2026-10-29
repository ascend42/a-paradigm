/**
 * @symbol #supervisor
 * @symbol #local-runner
 *
 * Slice C6'a2-2 (TD-2026-10-28-956 / -969, "/" skills, kernel side): the human runs a repo skill from "/".
 *
 * request.session.skills.list{hsid} lists the skills of the kernel's sanitized copy STAGED for the session
 * (buildRepoContext: frontmatter allow-listed, shell preprocessing refused, symlinks refused). A refused skill, a
 * `user-invocable: false` skill and a name outside SKILL_NAME_PATTERN are listed `loaded:false` with a why.
 *
 * request.session.skill.run{hsid, name, args} — containment (the brief's items 1-6, 8):
 *   1. the template is built from the STAGED copy, never the live file: the SKILL.md body only, frontmatter stripped,
 *      nothing inlined (no @ import, no reference file);
 *   2. `$ARGUMENTS` is substituted ONCE with split/join (never String.replace and its `$&` / `$1` patterns);
 *   3. the kernel writes the first line: "The human ran repo skill X (from .claude/skills/X/SKILL.md, sha …).";
 *   4. human authority covers the prompt only: every tool call of the turn is a model call (cards and rules as normal);
 *   5. a local skill over SKILL_CONTEXT_SHARE of the context target is refused `over-budget` (its tokens, the limit);
 *   6. a Claude session runs the skill natively (`/project:<name> <args>`) only when SlashSkillsProbe says this Claude
 *      binary expands a plugin skill typed into a turn; the probe runs on a canary skill in a kernel scratch dir
 *      (never the user's repo), cached by the binary's sha256; a failed or absent probe means the template;
 *   8. a local session that takes in a skill template is TAINTED for the rest of its life (founder: skill text taints
 *      the session), so a destructive Always rule passes no model call in it again.
 * args: at most SKILL_ARGS_MAX_BYTES, NFC, badText-clean, one line, no `!`` and no "```!". `name` must be one of the
 * kernel's listed (loaded) names.
 */
import { createHash, randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { SKILL_NAME_PATTERN } from '@a-company/gnomon-contracts';
import { badText } from '../local/tool-broker.js';
import { cleanServerText } from '../local/capability-index.js';
import { hasShellPreprocessing, MAX_CONTEXT_FILE_BYTES, REPO_CONTEXT_PLUGIN, type RepoContext } from './repo-context.js';

/** The human's skill arguments: at most this many UTF-8 bytes. */
export const SKILL_ARGS_MAX_BYTES = 4096;
/** A local skill's template may take at most this share of the session's context target (else over-budget). */
export const SKILL_CONTEXT_SHARE = 0.5;
/** skills.list answers at most this many skills. */
export const SKILLS_LIST_MAX = 128;
/** Every repo-written string skills.list returns is cleaned and at most this long. */
export const SKILL_TEXT_MAX = 240;
/** The canary skill the slash probe stages (kernel scratch dir only). */
export const SLASH_CANARY_SKILL = 'gnomon-canary';

/** The skills staged for one session: the generated plugin dir (null: nothing staged) and the scan. */
export interface StagedSkills {
  dir: string | null;
  ctx: Pick<RepoContext, 'skills' | 'refused'>;
}

/** One skill as request.session.skills.list lists it. */
export interface SkillListing {
  name: string;
  loaded: boolean;
  why?: string;
  description?: string;
  argumentHint?: string;
}

const sha256 = (b: string | Buffer): string => createHash('sha256').update(b).digest('hex');

function capText(t: string, max: number = SKILL_TEXT_MAX): string {
  const c = [...cleanServerText(t)];
  return c.length > max ? `${c.slice(0, max - 1).join('')}…` : c.join('');
}

/** The staged SKILL.md of `name` (any letter case, at the skill dir's top), or null. */
export function stagedSkillFile(dir: string | null, name: string): string | null {
  if (!dir || !SKILL_NAME_PATTERN.test(name)) return null;
  const skillDir = path.join(dir, 'skills', name);
  let names: string[];
  try {
    names = fs.readdirSync(skillDir);
  } catch {
    return null;
  }
  const f = names.find((n) => n.toLowerCase() === 'skill.md');
  return f ? path.join(skillDir, f) : null;
}

/** Read the staged SKILL.md (a regular file, never a link, bounded): its text and sha256 hex, or null. */
export function readStagedSkill(dir: string | null, name: string): { text: string; sha: string; file: string } | null {
  const file = stagedSkillFile(dir, name);
  if (!file) return null;
  let fd: number;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  } catch {
    return null;
  }
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.size > MAX_CONTEXT_FILE_BYTES) return null;
    const buf = Buffer.alloc(st.size);
    let n = 0;
    while (n < st.size) {
      const r = fs.readSync(fd, buf, n, st.size - n, n);
      if (r <= 0) break;
      n += r;
    }
    const b = buf.subarray(0, n);
    return { text: b.toString('utf8'), sha: sha256(b), file: path.basename(file) };
  } catch {
    return null;
  } finally {
    fs.closeSync(fd);
  }
}

const FENCE = /^---[ \t]*$/;

/** The staged frontmatter's top-level scalar values (the staged copy is canonical: sanitizeFrontmatter wrote it). */
export function frontmatterOf(text: string): Record<string, string> {
  const lines = text.split('\n');
  if (!FENCE.test(lines[0] ?? '')) return {};
  const end = lines.findIndex((l, i) => i > 0 && FENCE.test(l));
  if (end < 0) return {};
  const out: Record<string, string> = Object.create(null) as Record<string, string>;
  let block: { key: string; parts: string[] } | null = null;
  const flush = (): void => {
    if (block) out[block.key] = block.parts.join(' ').trim();
    block = null;
  };
  for (const l of lines.slice(1, end)) {
    if (block && (l.startsWith(' ') || l.trim() === '')) {
      if (l.trim()) block.parts.push(l.trim());
      continue;
    }
    flush();
    const m = /^([A-Za-z][A-Za-z0-9_-]{0,63})[ \t]*:[ \t]*(.*)$/.exec(l);
    if (!m) continue;
    const key = m[1]!;
    let v = m[2]!.trim();
    if (/^[|>][0-9+-]*$/.test(v)) {
      block = { key, parts: [] };
      continue;
    }
    if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) v = v.slice(1, -1);
    else v = v.replace(/(?:^|[ \t]+)#.*$/, '').trim(); // Aegis L4: a ` #` comment ends a plain YAML scalar
    out[key] = v;
  }
  flush();
  return out;
}

/** The SKILL.md body: everything after the frontmatter's closing fence (the whole text when there is none). */
export function skillBody(text: string): string {
  const lines = text.split('\n');
  if (!FENCE.test(lines[0] ?? '')) return text;
  const end = lines.findIndex((l, i) => i > 0 && FENCE.test(l));
  return end < 0 ? text : lines.slice(end + 1).join('\n');
}

/**
 * The skills staged for a session, as skills.list answers: each staged skill (loaded unless its name is outside
 * SKILL_NAME_PATTERN, its staged SKILL.md is unreadable, or it says `user-invocable: false`) and each refused one
 * (loaded:false, the scan's why). Sorted by name, deduplicated, at most SKILLS_LIST_MAX.
 */
export function listSkills(st: StagedSkills): SkillListing[] {
  const out = new Map<string, SkillListing>();
  for (const raw of st.ctx.skills) {
    const name = capText(raw, 64);
    if (!SKILL_NAME_PATTERN.test(raw)) {
      out.set(name, { name, loaded: false, why: 'its name is not lowercase letters, digits and hyphens' });
      continue;
    }
    const got = readStagedSkill(st.dir, raw);
    if (!got) {
      out.set(name, { name, loaded: false, why: 'its staged copy could not be read' });
      continue;
    }
    const fm = frontmatterOf(got.text);
    const extra = { ...(fm.description ? { description: capText(fm.description) } : {}), ...(fm['argument-hint'] ? { argumentHint: capText(fm['argument-hint'], 120) } : {}) };
    if ((fm['user-invocable'] ?? '').toLowerCase() === 'false') out.set(name, { name, loaded: false, why: 'it is not user-invocable (user-invocable: false)', ...extra });
    else out.set(name, { name, loaded: true, ...extra });
  }
  for (const r of st.ctx.refused) {
    const parts = r.path.split('/');
    if (parts[0] !== '.claude' || parts[1] !== 'skills' || !parts[2]) continue;
    const name = capText(parts[2], 64);
    if (!name || out.has(name)) continue;
    out.set(name, { name, loaded: false, why: capText(`not loaded: ${r.why}`) });
  }
  return [...out.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)).slice(0, SKILLS_LIST_MAX);
}

/** Why the human's skill arguments are refused, or null. */
export function skillArgsRefusal(args: unknown): string | null {
  if (typeof args !== 'string') return 'args must be a string';
  if (Buffer.byteLength(args, 'utf8') > SKILL_ARGS_MAX_BYTES) return `args are over ${SKILL_ARGS_MAX_BYTES} bytes`;
  if (/[\n\r\u2028\u2029\u0085]/.test(args)) return 'args must be one line';
  const bad = badText(args);
  if (bad) return `args ${bad}`;
  if (args.includes('!`') || args.includes('```!')) return 'args may not hold !` or ```!';
  return null;
}

/** The repo path a skill's SKILL.md came from (its staged file name keeps the letter case). */
export const skillSourcePath = (name: string, file = 'SKILL.md'): string => `.claude/skills/${name}/${file}`;

/**
 * The kernel's template of a skill run: the kernel-written first line, then the staged body with `$ARGUMENTS` replaced
 * ONCE by split/join (an argument holding `$ARGUMENTS`, `$&` or `$1` comes through literally). A body without the
 * placeholder gets the arguments on an `ARGUMENTS:` line, as Claude Code does.
 */
export function skillTemplate(i: { name: string; file?: string; sha: string; body: string; args: string }): string {
  const first = `The human ran repo skill ${i.name} (from ${skillSourcePath(i.name, i.file)}, sha ${i.sha.slice(0, 12)}).`;
  const body = i.body.replace(/^\n+/, '').replace(/\s+$/, '');
  const has = body.includes('$ARGUMENTS');
  const filled = has ? body.split('$ARGUMENTS').join(i.args) : body;
  return [first, '', filled, ...(!has && i.args ? ['', `ARGUMENTS: ${i.args}`] : [])].join('\n');
}

/** A Claude session's native run of a staged skill: the plugin's namespaced slash command. */
export const nativeSkillText = (name: string, args: string): string => `/${REPO_CONTEXT_PLUGIN}:${name}${args ? ` ${args}` : ''}`;

/** Aegis L3: a Claude session's skill template is capped too (half of a 200k-token window; the local lane: half its target). */
export const CLAUDE_SKILL_TOKEN_LIMIT = 100_000;

/**
 * Aegis L2: the ONE read of a skill a run uses — a staged, listed name (SKILL_NAME_PATTERN), its staged SKILL.md read
 * once, and the listing checks re-made on THAT text (not user-invocable: false; no shell preprocessing). Null: the
 * run is `not-listed`.
 */
export function stagedSkillForRun(st: StagedSkills | undefined, name: string): { text: string; sha: string; file: string } | null {
  if (!st || !SKILL_NAME_PATTERN.test(name) || !st.ctx.skills.includes(name)) return null;
  const got = readStagedSkill(st.dir, name);
  if (!got) return null;
  if ((frontmatterOf(got.text)['user-invocable'] ?? '').toLowerCase() === 'false') return null;
  if (hasShellPreprocessing(got.text)) return null;
  return got;
}

/**
 * The template of a run and why it is refused (null: it may run). Aegis L1: the SUBSTITUTED template is re-checked with
 * hasShellPreprocessing (the args check sees only the literal spellings; joined with the body they could form a fence),
 * for the template and the native path alike.
 */
export function skillRunTemplate(i: { name: string; staged: { text: string; sha: string; file: string }; args: string }): { template: string; refusal: string | null } {
  const template = skillTemplate({ name: i.name, file: i.staged.file, sha: i.staged.sha, body: skillBody(i.staged.text), args: i.args });
  return { template, refusal: hasShellPreprocessing(template) ? 'with these args the skill holds shell preprocessing (!` or a ```! block)' : null };
}

/** What one slash-skill probe gets: the Claude binary, the canary plugin in a kernel scratch dir and the nonce. */
export interface SlashProbeInput {
  exec: string;
  binarySha256: string;
  scratch: string;
  pluginDir: string;
  skill: string;
  /** the canary skill asks the model to reply with exactly this word */
  nonce: string;
  /** the turn text that runs the canary natively */
  text: string;
}
/** Runs the canary (true: the reply held the nonce, so the binary expanded the plugin skill). */
export type SlashProbeRun = (i: SlashProbeInput) => Promise<boolean>;

const SHA_HEX = /^[0-9a-f]{64}$/;

/**
 * Brief item 6: whether a Claude binary runs a plugin skill typed into a turn (`/project:<name>`). Probed on a canary
 * skill staged in a kernel scratch dir under the Gnomon home (never the user's repo), once per binary sha256; the
 * answer (either way) is cached in memory and in `<home>/probes/slash-skills.json`. No runner, a runner that throws
 * (not cached: tried again later) or a reply without the nonce (cached): false, and the kernel's template is used.
 */
export class SlashSkillsProbe {
  readonly #home: string;
  readonly #run: SlashProbeRun | undefined;
  readonly #cache = new Map<string, boolean>();
  readonly #inflight = new Map<string, Promise<boolean>>();
  #loaded = false;

  constructor(o: { home: string; run?: SlashProbeRun }) {
    this.#home = o.home;
    this.#run = o.run;
  }

  get #file(): string {
    return path.join(this.#home, 'probes', 'slash-skills.json');
  }

  #load(): void {
    if (this.#loaded) return;
    this.#loaded = true;
    try {
      const j = JSON.parse(fs.readFileSync(this.#file, 'utf8')) as unknown;
      if (j === null || typeof j !== 'object' || Array.isArray(j)) return;
      for (const [k, v] of Object.entries(j as Record<string, unknown>)) {
        if (SHA_HEX.test(k) && v !== null && typeof v === 'object' && typeof (v as { native?: unknown }).native === 'boolean') this.#cache.set(k, (v as { native: boolean }).native);
      }
    } catch {
      /* none yet, or unreadable: probe again */
    }
  }

  #save(): void {
    try {
      fs.mkdirSync(path.dirname(this.#file), { recursive: true, mode: 0o700 });
      const tmp = `${this.#file}.${randomBytes(6).toString('hex')}.tmp`;
      fs.writeFileSync(tmp, `${JSON.stringify(Object.fromEntries([...this.#cache].map(([k, v]) => [k, { native: v }])), null, 2)}\n`, { mode: 0o600 });
      fs.renameSync(tmp, this.#file);
    } catch {
      /* memory only */
    }
  }

  /** The cached answer for a binary (undefined: not probed yet). */
  cached(binarySha256: string): boolean | undefined {
    this.#load();
    return this.#cache.get(binarySha256.replace(/^sha256:/, ''));
  }

  /** Whether skills run natively under this binary (probing once per sha256; concurrent asks join). */
  async native(bin: { exec: string; sha256: string }): Promise<boolean> {
    const key = bin.sha256.replace(/^sha256:/, '');
    if (!SHA_HEX.test(key)) return false;
    const hit = this.cached(key);
    if (hit !== undefined) return hit;
    if (!this.#run) return false; // no probe runner in this daemon: the template, nothing cached
    const running = this.#inflight.get(key);
    if (running) return running;
    const p = this.#probe(bin.exec, key).finally(() => this.#inflight.delete(key));
    this.#inflight.set(key, p);
    return p;
  }

  async #probe(exec: string, key: string): Promise<boolean> {
    const base = path.join(this.#home, 'probes', 'slash-skills');
    let scratch: string | null = null;
    let ok = false;
    let threw = false;
    try {
      fs.mkdirSync(base, { recursive: true, mode: 0o700 });
      scratch = fs.mkdtempSync(path.join(base, 'canary-'));
      const pluginDir = path.join(scratch, 'plugin');
      const nonce = `gnomon-${randomBytes(8).toString('hex')}`;
      fs.mkdirSync(path.join(pluginDir, '.claude-plugin'), { recursive: true, mode: 0o700 });
      fs.mkdirSync(path.join(pluginDir, 'skills', SLASH_CANARY_SKILL), { recursive: true, mode: 0o700 });
      fs.writeFileSync(path.join(pluginDir, '.claude-plugin', 'plugin.json'), `${JSON.stringify({ name: REPO_CONTEXT_PLUGIN, version: '0.0.0', description: "Gnomon's slash-skill probe canary" })}\n`, { mode: 0o600 });
      fs.writeFileSync(path.join(pluginDir, 'skills', SLASH_CANARY_SKILL, 'SKILL.md'), `---\nname: ${SLASH_CANARY_SKILL}\ndescription: Gnomon's slash-skill probe canary\n---\nReply with exactly this word and nothing else: ${nonce}\n`, { mode: 0o600 });
      ok = (await this.#run!({ exec, binarySha256: `sha256:${key}`, scratch, pluginDir, skill: SLASH_CANARY_SKILL, nonce, text: nativeSkillText(SLASH_CANARY_SKILL, '') })) === true;
    } catch {
      ok = false;
      threw = true; // a probe that could not run answers the template now and is tried again later (never cached)
    } finally {
      if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
    }
    if (threw) return false;
    this.#cache.set(key, ok);
    this.#save();
    return ok;
  }
}
