/**
 * Mod identity (slice S0b of the Desk O1; .paradigm/research/paradigm-8/gnomon-mod-naming-versioning.md, ratified
 * 2026-10-20). A mod is named `<publisher>.<name>`; every derived name (events, MCP server, qualified tool names, env
 * own-prefix, principal label) comes from the id through the ONE helper here, so the kernel, the GUI and the mods
 * agree byte for byte.
 *
 *   publisher  ^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,38}$   1..39, ASCII only (no `u` flag; a test pins this)
 *   name       ^[a-z](?:[a-z0-9]|-(?=[a-z0-9])){0,23}$      1..24
 *   id         <publisher>.<name>, total ≤ MOD_ID_MAX (60), checked SEPARATELY from the segment regexes (39+1+24 = 64)
 *
 * The reserved lists are data; the kernel (#manifest-loader) applies them with the source of the install (folder,
 * github.com owner, other host) and the trust tier. Zero runtime dependencies (sha256 is the package's own).
 */

import { sha256 } from './internal.js';
import type { RefusalCode, RefusalGate } from './refusal.js';

/** A publisher segment (GitHub-owner shaped: no leading, trailing or doubled hyphen). */
export const PUBLISHER_PATTERN = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,38}$/;
/** A mod name segment. */
export const MOD_NAME_PATTERN = /^[a-z](?:[a-z0-9]|-(?=[a-z0-9])){0,23}$/;
/** A full mod id `<publisher>.<name>` (the length cap MOD_ID_MAX is a separate check: isModId). */
export const MOD_ID_PATTERN = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,38}\.[a-z](?:[a-z0-9]|-(?=[a-z0-9])){0,23}$/;
export const MOD_ID_LIMITS = Object.freeze({ publisher: 39, name: 24, id: 60 });
export const MOD_ID_MAX = MOD_ID_LIMITS.id;

/** Kernel and platform publishers (§1 Reserved publishers). `gnomon` is first-party only; `local` kernel-assigned only. */
export const RESERVED_PUBLISHERS: readonly string[] = Object.freeze([
  'gnomon', 'local', 'kernel', 'system', 'paradigm', 'claude', 'anthropic', 'admin', 'root', 'first-party', 'mod',
  'mods', 'modns', 'desk', 'mcp', 'core', 'builtin', 'human', 'user',
]);
/** Windows device names: never a publisher nor a name (a directory named `con` cannot exist on win32). */
export const WINDOWS_DEVICE_NAMES: readonly string[] = Object.freeze([
  'con', 'prn', 'aux', 'nul',
  ...Array.from({ length: 10 }, (_, i) => `com${i}`),
  ...Array.from({ length: 10 }, (_, i) => `lpt${i}`),
]);
/** The first-party mod names (bundled or planned): a publisher too, and never a non-gnomon mod name. */
export const FIRST_PARTY_MOD_NAMES: readonly string[] = Object.freeze(['workshop', 'ledger', 'paradigm-context', 'neurons', 'constellation']);
/**
 * Founder brands [F]: `ascend42` only as the github.com owner `ascend42`; the rest are refused from every source
 * (`a-company` always: github.com/a-company belongs to an unrelated person; the others until the founder binds an owner).
 */
export const FOUNDER_BRANDS: Readonly<Record<string, { githubOwner: string } | null>> = Object.freeze({
  ascend42: Object.freeze({ githubOwner: 'ascend42' }),
  'a-company': null,
  warpline: null,
  nevr: null,
  nevrland: null,
  conductor: null,
});
/**
 * Display names a NON-gnomon publisher's mod may never take, as a name, a prefix of the name, or a skeleton of
 * either (§1 Display: "always shows its publisher" is not reliable on MCP, LLM and truncated surfaces).
 */
export const FIRST_PARTY_DISPLAY_NAMES: readonly string[] = Object.freeze([...FIRST_PARTY_MOD_NAMES, 'gnomon', 'paradigm', 'claude', 'anthropic']);

/**
 * The confusable skeleton: a fixed compiled transform (never a table lookup at runtime that could drift).
 * lowercase, strip `-`, then 0→o, 1→l, i→l, 3→e, 5→s, then rn→m, vv→w, cl→d.
 */
export function modSkeleton(s: string): string {
  let out = '';
  for (const ch of s.toLowerCase()) {
    if (ch === '-') continue;
    out += ch === '0' ? 'o' : ch === '1' || ch === 'i' ? 'l' : ch === '3' ? 'e' : ch === '5' ? 's' : ch;
  }
  return out.split('rn').join('m').split('vv').join('w').split('cl').join('d');
}

export interface ModIdParts {
  publisher: string;
  name: string;
}

/** A well-formed mod id: the pattern AND the total length cap (≤ 60). */
export function isModId(v: unknown): v is string {
  return typeof v === 'string' && v.length <= MOD_ID_MAX && MOD_ID_PATTERN.test(v);
}

/** Split a mod id, or null when it is not one. */
export function parseModId(id: unknown): ModIdParts | null {
  if (!isModId(id)) return null;
  const dot = id.indexOf('.');
  return { publisher: id.slice(0, dot), name: id.slice(dot + 1) };
}

/** Join a publisher and a name; throws TypeError when the result is not a mod id. */
export function formatModId(publisher: string, name: string): string {
  const id = `${publisher}.${name}`;
  if (!PUBLISHER_PATTERN.test(publisher) || !MOD_NAME_PATTERN.test(name) || !isModId(id)) throw new TypeError(`not a mod id: ${id.slice(0, 80)}`);
  return id;
}

/**
 * The manifest refusal codes S0b publishes (they ride `refusal.data.manifestCode` and `manifest.refuse{code}`; the
 * kernel's other manifest codes stay kernel-internal). Each maps to a closed refusal code and gate.
 *   FORMAT     an unknown future manifest major ("needs Gnomon ≥ X"), or a FRESH format-1 install
 *   ENGINE     engines.gnomon does not admit this kernel (at stage and at load)
 *   PUBLISHER  a reserved, founder-brand, skeleton-confusable or source-mismatched publisher, or a first-party name
 *   COLLISION  the mod's MCP server name equals one already installed or in the user's .mcp.json (install and load)
 */
export const MOD_REFUSAL_ROUTES: Readonly<Record<'FORMAT' | 'ENGINE' | 'PUBLISHER' | 'COLLISION', { code: RefusalCode; gate: RefusalGate }>> = Object.freeze({
  FORMAT: Object.freeze({ code: 'UNSUPPORTED', gate: 'usage' }),
  ENGINE: Object.freeze({ code: 'UNSUPPORTED', gate: 'usage' }),
  PUBLISHER: Object.freeze({ code: 'FORBIDDEN', gate: 'trust' }),
  COLLISION: Object.freeze({ code: 'BAD_REQUEST', gate: 'usage' }),
} as const);
export const MOD_REFUSAL_CODES = Object.freeze(Object.keys(MOD_REFUSAL_ROUTES)) as readonly ('FORMAT' | 'ENGINE' | 'PUBLISHER' | 'COLLISION')[];

/** Manifest formats: CURRENT is what a fresh install must declare; ACCEPTED is what LOADS (existing pins, historical first-party hashes). */
export const MANIFEST_FORMAT = Object.freeze({ current: 2, accepted: Object.freeze([1, 2]) });

/* ── derived names ───────────────────────────────────────────────────────── */

/** The longest `gm_<publisher>_<name>` server name; longer ids get the hashed `gx_` form. */
export const MCP_SERVER_NAME_MAX = 28;
/** The whole qualified tool name `mcp__<server>__<tool>` (Claude Code's limit). */
export const QUALIFIED_TOOL_NAME_MAX = 64;
const B32 = 'abcdefghijklmnopqrstuvwxyz234567';

/** Lowercase RFC 4648 base32 (no padding). */
function base32(bytes: Uint8Array): string {
  let out = '';
  let bits = 0;
  let value = 0;
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

/** The first 10 characters of lowercase base32(sha256(id)). */
export function modIdHash10(id: string): string {
  return base32(sha256(id)).slice(0, 10);
}

/**
 * The MCP server name of a mod (§2): `gm_<publisher>_<name>` when ≤ 28 characters, else
 * `gx_<name[0..13]>_<hash10>`. `-` is never turned into `_` (a publisher has no `_`, so `gm_` names are injective).
 */
export function mcpServerName(id: string): string {
  const p = parseModId(id);
  if (!p) throw new TypeError(`not a mod id: ${String(id).slice(0, 80)}`);
  const gm = `gm_${p.publisher}_${p.name}`;
  return gm.length <= MCP_SERVER_NAME_MAX ? gm : `gx_${p.name.slice(0, 13)}_${modIdHash10(id)}`;
}

/** `mcp__<server>__<tool>` for a mod's tool (check its length against QUALIFIED_TOOL_NAME_MAX). */
export function qualifiedToolName(id: string, tool: string): string {
  return `mcp__${mcpServerName(id)}__${tool}`;
}

/**
 * The env own-prefix (§2): third-party `<PUB>__<NAME>__` (hyphens become a single `_`, and a segment never has two
 * hyphens in a row, so `__` cannot be forged); first-party (publisher gnomon) `<NAME>__`.
 */
export function modEnvPrefix(id: string): string {
  const p = parseModId(id);
  if (!p) throw new TypeError(`not a mod id: ${String(id).slice(0, 80)}`);
  const up = (s: string) => s.toUpperCase().replace(/-/g, '_');
  return p.publisher === 'gnomon' ? `${up(p.name)}__` : `${up(p.publisher)}__${up(p.name)}__`;
}

/** The mod's own event namespace prefix `modns.<publisher>.<name>.` (ownership is matched by whole segments). */
export function modEventPrefix(id: string): string {
  return `modns.${id}.`;
}

/** The principal label of a mod (`mod-<publisher>.<name>`). */
export function modPrincipalLabel(id: string): string {
  return `mod-${id}`;
}

/* ── git sources ─────────────────────────────────────────────────────────── */

export interface GitSource {
  /** `https://<lowercase host>/<path>` with no userinfo, port, query, fragment, percent-encoding or dot segment */
  url: string;
  host: string;
  /** every path segment except the repo, lowercased, joined by `/` (GitLab subgroups included) */
  namespace: string;
  repo: string;
  /** github.com: the URL owner (first path segment, lowercased); undefined on other hosts */
  owner?: string;
}

const HOST = /^[a-z0-9](?:[a-z0-9-]{0,62})(?:\.[a-z0-9](?:[a-z0-9-]{0,62}))*$/;
const SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,99}$/;
/** A git commit id in 8.0: SHA-1 (40 hex). A sha256-format repo (64 hex) is refused. */
export const GIT_COMMIT_PATTERN = /^[0-9a-f]{40}$/;

/**
 * Canonical form of a git https URL, or null. Strict: https only; no userinfo, port, query, fragment or `%`; the host
 * lowercased; segments of [A-Za-z0-9._-] with no `.` / `..` segment and no empty segment; a trailing `/` or `.git` dropped.
 */
export function canonicalGitUrl(raw: unknown): GitSource | null {
  if (typeof raw !== 'string' || raw.length > 512 || !raw.startsWith('https://')) return null;
  const rest = raw.slice(8);
  if (/[?#%@\s\\]/.test(rest)) return null;
  const slash = rest.indexOf('/');
  if (slash <= 0) return null;
  const host = rest.slice(0, slash).toLowerCase();
  if (host.includes(':') || !HOST.test(host) || host.length > 253) return null;
  // Aegis S0b M5: single-label hosts and IP literals are refused (no TOFU identity worth binding), and every
  // GitHub-owned look-alike other than exactly github.com (gist.github.com, raw.githubusercontent.com, …) is refused
  if (!host.includes('.') || /^[0-9.]+$/.test(host) || /^[0-9]+$/.test(host.slice(host.lastIndexOf('.') + 1))) return null;
  if (host !== 'github.com' && (host.endsWith('.github.com') || host === 'githubusercontent.com' || host.endsWith('.githubusercontent.com'))) return null;
  let p = rest.slice(slash + 1);
  if (p.endsWith('/')) p = p.slice(0, -1);
  if (p.endsWith('.git')) p = p.slice(0, -4);
  const segs = p.split('/');
  if (segs.length < 2 || segs.length > 16) return null;
  for (const s of segs) if (!SEGMENT.test(s) || s === '.' || s === '..' || /^\.+$/.test(s)) return null;
  const repo = segs[segs.length - 1]!;
  const namespace = segs.slice(0, -1).join('/').toLowerCase();
  const url = `https://${host}/${segs.join('/')}`;
  return host === 'github.com' ? { url, host, namespace, repo, owner: segs[0]!.toLowerCase() } : { url, host, namespace, repo };
}

/** The github.com owner of a git URL (first path segment, lowercased), or null for another host or a bad URL. */
export function gitOwnerOf(raw: unknown): string | null {
  return canonicalGitUrl(raw)?.owner ?? null;
}

/** The install source string of a git mod: `git:<canonical https url>#<sha40>`. Throws TypeError on a bad input. */
export function gitSourceString(raw: string, commit: string): string {
  const g = canonicalGitUrl(raw);
  if (!g) throw new TypeError('not a canonical-able https git URL');
  if (!GIT_COMMIT_PATTERN.test(commit)) throw new TypeError('commit must be 40 lowercase hex (a sha256-format repo is refused in 8.0)');
  return `git:${g.url}#${commit}`;
}

/** Parse a `git:<url>#<sha40>` source string (the url must already be canonical), or null. */
export function parseGitSource(s: unknown): (GitSource & { commit: string }) | null {
  if (typeof s !== 'string' || !s.startsWith('git:')) return null;
  const hash = s.lastIndexOf('#');
  if (hash < 0) return null;
  const commit = s.slice(hash + 1);
  const g = canonicalGitUrl(s.slice(4, hash));
  if (!g || g.url !== s.slice(4, hash) || !GIT_COMMIT_PATTERN.test(commit)) return null;
  return { ...g, commit };
}
