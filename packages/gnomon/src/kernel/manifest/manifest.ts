/**
 * @symbol #manifest-loader
 *
 * #manifest-loader — manifest validation (format 2, S0b; format 1 loads only through
 * the pure upgradeManifestV1), `manifestHash` and manifest widening (spec §3.6, §4.3,
 * §12.1–§12.5, §12.4.1, §15.4).
 *
 * S0b (mod naming and versioning, .paradigm/research/paradigm-8/gnomon-mod-naming-versioning.md): a mod is
 * `<publisher>.<name>` (contracts mod-id.ts). `manifest: 2` declares `publisher` and may declare
 * `engines.gnomon` (a small tokenizer, never a regex); provides.mcp has at most one entry and no `name` (the kernel
 * derives the server name, mcpServerName). readManifest is THE entry: raw bytes in, a V2 manifest out, with
 * manifestHash over the RAW bytes (format 1: the legacy canonical-JSON hash its grant rows were signed over) and, for
 * format 1, the upgradedHash of the upgraded V2 object. An unknown future major is refused FORMAT; a fresh format-1
 * install is refused FORMAT (format 1 only LOADS existing pins and historical first-party hashes).
 *
 * WIRE FORM. §4.3 writes manifests as YAML. The kernel has zero runtime
 * dependencies (G-SEC-01), so the on-disk form is the JSON subset of that YAML
 * in `gnomon-manifest.json` at the package root (MANIFEST_FILE); a YAML front
 * end is userland tooling (`gnomon mod new`). The value is the same object.
 *
 * Validation is producer-side strict (fail closed): unknown top-level keys are
 * refused, and so are `trust:` and `source:` by name (§4.3 — trust is the grant
 * table, source is an install-time fact). Checks, in order:
 *   - shape: `manifest: 1`, kind, name, semver version;
 *   - `kind: mod` needs `abi: "mod-abi:v1"`; any other abi is refused (ABI);
 *   - name ≠ a kernel namespace token (NAME);
 *   - `kind: adapter | provider` only from the first-party tier (TIER, A23-2);
 *     a provider ships ONLY `provides.knowledge` (§4.3);
 *   - provides.*: tool effects ⊆ read|write|network|spend; view slots and the
 *     append-only rule for `card.*` / `status.mod` (S22-H5); event kinds under
 *     `modns.<name>.*`; keybindings bind declared command ids and never the
 *     reserved decision keys (§12.2); knowledge entries (§8.10);
 *   - requires.capabilities: a §15.4 form, never a grant-derived-only one
 *     (`voice.approve:<class>`), first-party-only ones (`knowledge:federate`,
 *     `link:send`) only from first-party, `log.append` only on the mod's own
 *     `modns.<name>` namespace, never `approve` / `band:write`;
 *   - requires.egress: `none` or [{host, purpose}], Anthropic hosts refused
 *     (G-MAN-01), and never together with `provides.knowledge`;
 *   - provides.knowledge needs `knowledge:provide`.
 */
import { createHash } from 'node:crypto';
import {
  canonicalJson,
  FIRST_PARTY_DISPLAY_NAMES,
  FIRST_PARTY_MOD_NAMES as CONTRACT_FIRST_PARTY_MOD_NAMES,
  FOUNDER_BRANDS,
  isModId,
  MANIFEST_FORMAT,
  MOD_NAME_PATTERN,
  modEnvPrefix,
  modEventPrefix,
  modSkeleton,
  PUBLISHER_PATTERN,
  QUALIFIED_TOOL_NAME_MAX,
  qualifiedToolName,
  RESERVED_PUBLISHERS,
  WINDOWS_DEVICE_NAMES,
  CAPABILITY_FORMS,
  EVENT_KIND_NAMES,
  FIRST_PARTY_ONLY_CAPABILITIES,
  GRANT_DERIVED_ONLY_CAPABILITIES,
  isPlainObject,
  OFFERS_PER_MOD_MAX,
  validateOfferSpecV1,
  type OfferSpecV1,
} from '@a-company/gnomon-contracts';
import { GNOMON_VERSION } from '../../version.js';
import { checkEgressHost } from './egress.js';
import { ManifestRefusal, type ManifestRefusalCode } from './refusal.js';

export const MANIFEST_FILE = 'gnomon-manifest.json';
export const MOD_ABI_V1 = 'mod-abi:v1' as const;
export const KNOWN_ABIS = Object.freeze([MOD_ABI_V1]);

export const MANIFEST_KINDS = ['distro', 'mod', 'provider', 'adapter', 'skill-pack'] as const;
export type ManifestKind = (typeof MANIFEST_KINDS)[number];
/** Kinds accepted only from the first-party trust tier (A23-2, S25-H4). */
export const FIRST_PARTY_ONLY_KINDS: readonly ManifestKind[] = Object.freeze(['adapter', 'provider']);

export const TOOL_EFFECTS = ['read', 'write', 'network', 'spend'] as const;
export type ToolEffect = (typeof TOOL_EFFECTS)[number];

/** §12.2 reserved decision keys (and the digits): never bindable by a mod (`G-MOD-06`). */
export const RESERVED_DECISION_KEYS = Object.freeze(['y', 'n', 'a', 'd', 'enter', 'esc', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9']);

/** Trust tiers (§12.4 "Trust"): judged on provenance + hash, never self-description. */
export type TrustTier = 'first-party' | 'local' | `signed:${string}`;
export const TRUST_TIER_PATTERN = /^(first-party|local|signed:gkey-[a-z0-9-]+:v1:[0-9a-f]{64})$/;

/** Capabilities no mod manifest may request whatever its tier (§12.4 "Trust"). */
export const NEVER_REQUESTABLE = Object.freeze(['approve', 'band:write']);

const TOP_KEYS = ['manifest', 'kind', 'publisher', 'name', 'version', 'engines', 'abi', 'compat', 'provides', 'requires', 'config_schema', 'description'] as const;
/** The format-1 top-level keys (upgradeManifestV1 reads only these). */
const V1_TOP_KEYS = ['manifest', 'kind', 'name', 'version', 'abi', 'compat', 'provides', 'requires', 'config_schema', 'description'] as const;
/** Keys whose meaning never changes across manifest formats (S0b §3). */
export const FORMAT_INVARIANT_KEYS = Object.freeze(['manifest', 'publisher', 'name', 'version', 'engines']);
export const MANIFEST_FORMAT_CURRENT = MANIFEST_FORMAT.current;
export const MANIFEST_FORMATS_ACCEPTED: readonly number[] = MANIFEST_FORMAT.accepted;
/** The version cap (semver, ≤ 64) and the prerelease bound (≤ 4 identifiers of ≤ 16 characters). */
export const VERSION_MAX = 64;
const PROVIDES_KEYS = ['mcp', 'skills', 'agents', 'hooks', 'bands', 'steps', 'resolvers', 'blocks', 'oracles', 'tools', 'views', 'events', 'commands', 'keybindings', 'knowledge', 'offers'] as const;
/** Knowledge entry names (not mod names; those are MOD_NAME_PATTERN). */
const NAME_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const DOTTED_ID = /^[a-z][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)*$/;
const SCHEME = /^[a-z][a-z0-9-]*:$/;
const TIER_LABEL = /^T[0-9]$/;
const FIXED_SLOTS = ['sidebar', 'panel', 'status.mod', 'composer.footer'];

export interface ManifestTool {
  name: string;
  schema?: Record<string, unknown>;
  effects: ToolEffect[];
}
export interface ManifestView {
  id: string;
  slot: string;
  placement: 'append' | 'replace';
  fixtures?: string[];
}
export interface ManifestCommand {
  id: string;
  title: string;
  args?: Record<string, unknown>;
}
export interface ManifestKeybinding {
  key: string;
  command: string;
}
export interface ManifestKnowledge {
  name: string;
  scheme: string;
  query: string;
  maxTier: string;
}
export interface ManifestHook {
  event: string;
  command: string;
}
/** A manifest:2 provides.mcp entry: no `name` (the kernel derives it: mcpServerName(id)). */
export interface ManifestMcp {
  command: string;
  args?: string[];
  /** what a per-user override may replace (TD-2026-10-20-812): absent = nothing (the manifest's command runs as is) */
  config?: ManifestMcpConfig;
}
/** The author-declared override surface of one provides.mcp server (closed). */
export interface ManifestMcpConfig {
  command?: true;
  args?: true;
  /** env var NAMES the user may set (never a launch-critical name, MCP_ENV_DENY) */
  env?: string[];
  /** env names (a subset of env) that hold SECRETS; refused in a per-user override until a secret store exists (Aegis S1 M2) */
  secret?: string[];
}
/** A per-user override of a provides.mcp server's launch (validateMcpUserConfig); only what config permits. */
export interface McpUserConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
}
/**
 * A declarable env name: uppercase only. Lowercase names (http_proxy, no_proxy, …, which curl and others honour) are
 * therefore unreachable by construction, so the denylist below lists only uppercase forms.
 */
export const MCP_ENV_NAME = /^[A-Z][A-Z0-9_]{0,126}$/;
/**
 * Env names no override may set (Aegis M1): they change how a process loads code, resolves a binary, trusts TLS,
 * routes traffic, finds its home/temp/config, or where its keys live.
 */
export const MCP_ENV_DENY: ReadonlySet<string> = new Set([
  'PATH', 'HOME', 'USER', 'SHELL', 'ENV', 'ZDOTDIR', 'SHELLOPTS', 'PS4', 'IFS', 'PROMPT_COMMAND', 'CLASSPATH', 'GEM_PATH',
  'RUSTC_WRAPPER', 'GOFLAGS', 'GOPROXY', 'GOROOT', 'GOPATH', 'GOTOOLCHAIN', 'GOINSECURE', 'GCONV_PATH', 'LOCPATH',
  'NLSPATH', 'HOSTALIASES', 'RES_OPTIONS', 'REQUESTS_CA_BUNDLE', 'CURL_CA_BUNDLE', 'HTTPS_PROXY', 'HTTP_PROXY',
  'ALL_PROXY', 'NO_PROXY', 'FTP_PROXY', 'GNUPGHOME', 'EDITOR', 'VISUAL', 'PAGER', 'BROWSER', 'TMP', 'TEMP', 'TMPDIR',
  'LOGNAME', 'DISPLAY', 'APPDATA', 'LOCALAPPDATA', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'SYSTEMROOT', 'COMSPEC',
  'PATHEXT',
]);
/** Prefix families no override may set (no bare GO prefix: GOOGLE_… stays declarable; the Go names are exact above). */
export const MCP_ENV_DENY_PREFIXES = Object.freeze([
  'LD_', 'DYLD_', 'ANTHROPIC_', 'CLAUDE_', 'GNOMON_', 'NPM_CONFIG_', 'GIT_', 'NODE_', 'ELECTRON_', 'NPM_', 'PYTHON',
  'PERL', 'RUBY', 'JAVA_', 'JDK_', 'DOTNET_', 'COMPLUS_', 'CORECLR_', 'OPENSSL_', 'SSL_', 'SSH_', 'GPG_', 'XDG_',
  'MALLOC_', 'CARGO_', 'RUST', 'PIP_', 'UV_', 'BUN_', 'DENO_', 'YARN_', 'PNPM_', 'BASH',
]);
/**
 * Below the first-party tier a declared env name must start with the mod's own prefix (S0b: `<PUB>__<NAME>__`, double
 * underscore, contracts modEnvPrefix) or be a credential (`…_API_KEY`, `…_TOKEN`). The denylist runs after and is never skipped.
 */
export function mcpEnvOwnPrefix(modId: string): string {
  return modEnvPrefix(modId);
}
export const MCP_CONFIG_LIMITS = Object.freeze({ env: 16, args: 64, value: 4096 });
export interface ManifestEgress {
  host: string;
  purpose: string;
}

export interface ManifestV2 {
  manifest: 2;
  kind: ManifestKind;
  publisher: string;
  name: string;
  version: string;
  /** compatibility: `engines.gnomon` comparators (S0b §3), refused ENGINE at stage and load */
  engines?: { gnomon?: string };
  abi?: string;
  description?: string;
  compat?: { kernel?: string; claudeCode?: string };
  provides?: {
    mcp?: ManifestMcp[];
    skills?: unknown[];
    agents?: unknown[];
    hooks?: ManifestHook[];
    bands?: unknown[];
    steps?: unknown[];
    resolvers?: unknown[];
    blocks?: unknown[];
    oracles?: unknown[];
    tools?: ManifestTool[];
    views?: ManifestView[];
    events?: string[];
    commands?: ManifestCommand[];
    keybindings?: ManifestKeybinding[];
    knowledge?: ManifestKnowledge[];
    /** the Desk (TD-2026-10-20-812): playbook offers, offer-spec:v1, at most OFFERS_PER_MOD_MAX */
    offers?: OfferSpecV1[];
  };
  requires?: { capabilities?: string[]; egress?: 'none' | ManifestEgress[] };
  config_schema?: Record<string, unknown>;
}

/** Mod names reserved outright (Aegis, Desk reviews): never a mod name at any tier or publisher. */
export const RESERVED_MOD_NAMES: ReadonlySet<string> = new Set([
  'kernel', 'gnomon', 'system', 'paradigm', 'claude', 'anthropic', 'desk', 'mod', 'mods', 'mcp', 'core', 'builtin',
  'admin', 'root', 'human', 'user', 'local', 'first-party',
]);
/**
 * Names of the first-party mods (contracts FIRST_PARTY_MOD_NAMES). S0b: the tier rule is the publisher now (gnomon ⇔
 * first-party); the old name-prefix list is gone, and a NON-gnomon publisher is refused any first-party display name,
 * as the name, a prefix of it, or a skeleton of either (FIRST_PARTY_DISPLAY_NAMES).
 */
export const FIRST_PARTY_MOD_NAMES: ReadonlySet<string> = new Set(CONTRACT_FIRST_PARTY_MOD_NAMES);

/** Namespace tokens the kernel owns (the §9.1 registry's namespaces + the reserved prefixes). */
export const KERNEL_NAMESPACE_TOKENS: ReadonlySet<string> = new Set([
  ...EVENT_KIND_NAMES.map((k) => k.split('.')[0]!),
  'kernel',
  'gnomon',
  'modns',
  'grant',
  'key',
  'hsid',
  'ev',
  'sym',
]);

/** S0b: `sha256:<hex>` of the manifest file's RAW bytes (what the human approved, byte for byte). */
export function manifestHash(raw: Uint8Array | string): string {
  return `sha256:${createHash('sha256').update(raw).digest('hex')}`;
}
/**
 * `sha256:<hex>` of the canonical JSON of a manifest object: the format-1 manifestHash (the hash every pre-S0b grant
 * row was signed over), the upgradedHash of an upgraded V2 object, and the distro generator's marker.
 */
export function canonicalManifestHash(m: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJson(m), 'utf8').digest('hex')}`;
}

/* ── engines.gnomon: a small tokenizer (S0b §3), never a regex ─────────── */

export const ENGINES_MAX = 64;
const ENGINE_OPS = ['>=', '<=', '>', '<', '='] as const;
type EngineOp = (typeof ENGINE_OPS)[number];

/** `x.y.z` (digits only, no leading zero beyond a lone 0) → [x, y, z], or null. Character loop, no regex. */
function coreVersion(s: string): [number, number, number] | null {
  const parts = s.split('.');
  if (parts.length !== 3) return null;
  const out: number[] = [];
  for (const p of parts) {
    if (p.length === 0 || p.length > 9 || (p.length > 1 && p[0] === '0')) return null;
    for (let i = 0; i < p.length; i++) if (p.charCodeAt(i) < 0x30 || p.charCodeAt(i) > 0x39) return null;
    out.push(Number(p));
  }
  return out as [number, number, number];
}

function cmp(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < 3; i++) if (a[i]! !== b[i]!) return a[i]! < b[i]! ? -1 : 1;
  return 0;
}

/**
 * Parse `engines.gnomon`: space-joined comparators (AND), each one of `>= > <= < =` followed by `x.y.z`; at most
 * ENGINES_MAX characters. Returns the comparators or null when malformed.
 */
export function parseEngines(range: unknown): Array<{ op: EngineOp; v: [number, number, number] }> | null {
  if (typeof range !== 'string' || range.length === 0 || range.length > ENGINES_MAX) return null;
  const toks = range.split(' ');
  const out: Array<{ op: EngineOp; v: [number, number, number] }> = [];
  for (const t of toks) {
    const op = ENGINE_OPS.find((o) => t.startsWith(o));
    if (!op) return null;
    const v = coreVersion(t.slice(op.length));
    if (!v) return null;
    out.push({ op, v });
  }
  return out;
}

/** Does `engines.gnomon` admit this kernel version? null when the range is malformed. */
export function enginesAdmit(range: unknown, version: string = GNOMON_VERSION): boolean | null {
  const cs = parseEngines(range);
  const have = coreVersion(version.split('-')[0]!.split('+')[0]!);
  if (!cs || !have) return null;
  return cs.every(({ op, v }) => {
    const c = cmp(have, v);
    return op === '>=' ? c >= 0 : op === '<=' ? c <= 0 : op === '>' ? c > 0 : op === '<' ? c < 0 : c === 0;
  });
}

/** Compare two semver strings by their core (prerelease sorts below its release); null if either is not semver. */
export function compareVersions(a: string, b: string): number | null {
  const pa = coreVersion(a.split('+')[0]!.split('-')[0]!);
  const pb = coreVersion(b.split('+')[0]!.split('-')[0]!);
  if (!pa || !pb) return null;
  const c = cmp(pa, pb);
  if (c !== 0) return c;
  const ra = a.split('+')[0]!.includes('-');
  const rb = b.split('+')[0]!.includes('-');
  return ra === rb ? (a === b ? 0 : a < b ? -1 : 1) : ra ? -1 : 1;
}

/** A §15.4 capability form compiled to a matcher (`<x>` = one non-empty token). */
const CAPABILITY_MATCHERS: ReadonlyArray<{ form: string; re: RegExp }> = CAPABILITY_FORMS.map((form) => {
  const esc = form.replace(/[.*+?^${}()|[\]\\]/g, (c) => (c === '<' || c === '>' ? c : `\\${c}`));
  return { form, re: new RegExp(`^${esc.replace(/<[a-z]+>/g, '[A-Za-z0-9][A-Za-z0-9._:-]*')}$`) };
});

/** The §15.4 form a capability string instantiates, or undefined. */
export function capabilityForm(cap: string): string | undefined {
  return CAPABILITY_MATCHERS.find((m) => m.re.test(cap))?.form;
}

export interface ValidateManifestOptions {
  /** The trust tier of the install (provenance, recorded on the card and the grant.trust row). */
  tier: TrustTier;
  /**
   * Only for a format-1 manifest upgraded under the frozen alias table (grants.ts LEGACY_ALIASES): the bare legacy
   * name, whose `modns.<legacyName>.*` the mod may keep writing (S0b §4). Never set for a format-2 manifest.
   */
  legacyName?: string;
  /** The kernel assigned `local` (the format-1 alias mapping); a manifest that declares `local` itself is refused. */
  kernelAssignedLocal?: boolean;
}

/** Publisher and name checks that need only the manifest and the tier (the source checks are install.ts). */
function checkIdentity(publisher: string, name: string, opts: ValidateManifestOptions): void {
  const id = `${publisher}.${name}`;
  if (!isModId(id)) fail('SCHEMA', `mod id ${String(id).slice(0, 80)} is longer than 60 characters`, { field: 'name', id: String(id).slice(0, 80) });
  const dev = (s: string) => WINDOWS_DEVICE_NAMES.includes(s);
  if (dev(publisher)) fail('PUBLISHER', `publisher "${publisher}" is a Windows device name`, { publisher });
  if (dev(name)) fail('NAME', `name "${name}" is a Windows device name`, { name });
  // a first-party mod name under publisher gnomon is exempt (gnomon.neurons: its namespace is modns.gnomon.neurons.*,
  // never the kernel's neurons.*); every other name is checked against the kernel namespace tokens
  if (KERNEL_NAMESPACE_TOKENS.has(name) && !(publisher === 'gnomon' && FIRST_PARTY_MOD_NAMES.has(name))) fail('NAME', `name "${name}" collides with a kernel namespace token`, { name });
  if (RESERVED_MOD_NAMES.has(name)) fail('NAME', `name "${name}" is reserved`, { name });
  // publisher ⇔ tier (both directions refused)
  if (publisher === 'gnomon' && opts.tier !== 'first-party') fail('PUBLISHER', 'publisher gnomon is first-party only', { publisher, tier: opts.tier });
  if (opts.tier === 'first-party' && publisher !== 'gnomon') fail('PUBLISHER', `the first-party tier is publisher gnomon only, not ${publisher}`, { publisher, tier: opts.tier });
  if (publisher === 'local') {
    if (!opts.kernelAssignedLocal) fail('PUBLISHER', 'publisher local is assigned by the kernel only', { publisher });
  } else if (publisher !== 'gnomon') {
    if (RESERVED_PUBLISHERS.includes(publisher) || KERNEL_NAMESPACE_TOKENS.has(publisher) || FIRST_PARTY_MOD_NAMES.has(publisher)) {
      fail('PUBLISHER', `publisher "${publisher}" is reserved`, { publisher });
    }
    const brand = Object.prototype.hasOwnProperty.call(FOUNDER_BRANDS, publisher) ? FOUNDER_BRANDS[publisher] : undefined;
    if (brand === null) fail('PUBLISHER', `publisher "${publisher}" is reserved (founder brand)`, { publisher });
    const sk = modSkeleton(publisher);
    const reserved = [...RESERVED_PUBLISHERS, ...FIRST_PARTY_MOD_NAMES, ...Object.keys(FOUNDER_BRANDS), ...KERNEL_NAMESPACE_TOKENS];
    const look = reserved.find((r) => r !== publisher && modSkeleton(r) === sk);
    if (look) fail('PUBLISHER', `publisher "${publisher}" looks like the reserved "${look}"`, { publisher, looksLike: look });
    // first-party display names: never as a non-gnomon name, a prefix of it, or a skeleton of either
    const nsk = modSkeleton(name);
    const fp = FIRST_PARTY_DISPLAY_NAMES.find((d) => name === d || name.startsWith(`${d}-`) || nsk === modSkeleton(d) || nsk.startsWith(modSkeleton(d)));
    if (fp) fail('PUBLISHER', `name "${name}" is a first-party display name (${fp}); only publisher gnomon may use it`, { publisher, name, firstParty: fp });
  }
}

/**
 * The PURE format-1 upgrader (S0b §3): reads only the raw object and the kernel-derived publisher (the alias table:
 * `gnomon` or `local`), never the disk, never mutates its input. provides.mcp entries lose `name`; a `local` mod's
 * `modns.<N>.` kinds and log.append become `modns.local.<N>.` (only alias-table `gnomon` mods keep their legacy
 * namespace). The full V2 validator always runs after (readManifest).
 */
export function upgradeManifestV1(raw: unknown, publisher: 'gnomon' | 'local'): Record<string, unknown> {
  if (!isPlainObject(raw) || raw.manifest !== 1) fail('FORMAT', 'upgradeManifestV1 reads a format-1 manifest only', {});
  const src = JSON.parse(JSON.stringify(raw)) as Record<string, unknown>;
  for (const k of Object.keys(src)) if (!(V1_TOP_KEYS as readonly string[]).includes(k)) fail('SCHEMA', `manifest has unknown property "${k}"`, { field: k });
  const name = typeof src.name === 'string' ? src.name : '';
  const out: Record<string, unknown> = { manifest: 2, kind: src.kind, publisher, name, version: src.version };
  for (const k of ['abi', 'description', 'compat', 'config_schema'] as const) if (src[k] !== undefined) out[k] = src[k];
  const legacyNs = `modns.${name}.`;
  const localNs = `modns.local.${name}.`;
  const reNs = (s: unknown): unknown => (publisher === 'local' && typeof s === 'string' && s.startsWith(legacyNs) ? `${localNs}${s.slice(legacyNs.length)}` : s);
  if (isPlainObject(src.provides)) {
    const p = { ...src.provides };
    if (Array.isArray(p.mcp)) p.mcp = p.mcp.map((e) => (isPlainObject(e) ? Object.fromEntries(Object.entries(e).filter(([k]) => k !== 'name')) : e));
    if (Array.isArray(p.events)) p.events = p.events.map(reNs);
    out.provides = p;
  } else if (src.provides !== undefined) out.provides = src.provides;
  if (isPlainObject(src.requires)) {
    const r = { ...src.requires };
    if (Array.isArray(r.capabilities)) r.capabilities = r.capabilities.map((c) => (typeof c === 'string' && c.startsWith(`log.append:${legacyNs}`) ? `log.append:${reNs(c.slice('log.append:'.length))}` : c));
    out.requires = r;
  } else if (src.requires !== undefined) out.requires = src.requires;
  return out;
}

export interface ReadManifestOptions extends Omit<ValidateManifestOptions, 'legacyName' | 'kernelAssignedLocal'> {
  /**
   * The alias publisher of a format-1 manifest (grants.ts aliasOf, or `gnomon` for a historical first-party
   * packageHash at stage). Absent ⇒ format 1 is a FRESH install and is refused FORMAT.
   */
  legacyPublisher?: 'gnomon' | 'local';
}

export interface ReadManifestResult {
  manifest: ManifestV2;
  /** raw-bytes hash (format 2); the legacy canonical hash its rows were signed over (format 1) */
  manifestHash: string;
  format: 1 | 2;
  /** format 1 only: canonicalManifestHash of the upgraded V2 object (recorded on the install grant) */
  upgradedHash?: string;
}

/** THE manifest entry (S0b): raw bytes → a validated V2 manifest and its hashes. Throws ManifestRefusal. */
export function readManifest(raw: Uint8Array | string, opts: ReadManifestOptions): ReadManifestResult {
  let v: unknown;
  try {
    v = JSON.parse(typeof raw === 'string' ? raw : Buffer.from(raw).toString('utf8'));
  } catch {
    return fail('SCHEMA', `${MANIFEST_FILE} is not JSON`, {});
  }
  const f = isPlainObject(v) ? v.manifest : undefined;
  if (typeof f !== 'number' || !Number.isInteger(f) || f < 1) return fail('SCHEMA', 'manifest must be an integer format', { field: 'manifest' });
  if (f > MANIFEST_FORMAT_CURRENT) {
    const eng = isPlainObject(v) && isPlainObject(v.engines) ? parseEngines(v.engines.gnomon)?.find((c) => c.op === '>=' || c.op === '>' || c.op === '=') : undefined;
    return fail('FORMAT', `manifest format ${f} needs Gnomon ≥ ${eng ? eng.v.join('.') : 'a newer release'} (this kernel ${GNOMON_VERSION} reads formats ${MANIFEST_FORMATS_ACCEPTED.join(', ')})`, { format: f });
  }
  if (f === 1) {
    if (!opts.legacyPublisher) return fail('FORMAT', 'a fresh install must declare manifest: 2 (format 1 loads only existing pins and historical first-party hashes)', { format: 1 });
    const up = upgradeManifestV1(v, opts.legacyPublisher);
    const manifest = validateManifest(up, { tier: opts.tier, kernelAssignedLocal: opts.legacyPublisher === 'local', ...(opts.legacyPublisher === 'gnomon' ? { legacyName: String((v as { name?: unknown }).name) } : {}) });
    return { manifest, manifestHash: canonicalManifestHash(v), format: 1, upgradedHash: canonicalManifestHash(up) };
  }
  return { manifest: validateManifest(v, { tier: opts.tier }), manifestHash: manifestHash(raw), format: 2 };
}

const fail = (code: ManifestRefusalCode, msg: string, detail: Record<string, unknown> = {}): never => {
  throw new ManifestRefusal(code, msg, detail);
};

function arr(v: unknown, where: string): unknown[] {
  if (v === undefined) return [];
  if (!Array.isArray(v)) fail('SCHEMA', `${where} must be an array`, { field: where });
  return v as unknown[];
}
function obj(v: unknown, where: string): Record<string, unknown> {
  if (!isPlainObject(v)) fail('SCHEMA', `${where} must be an object`, { field: where });
  return v as Record<string, unknown>;
}
/** C0 (incl. ESC), DEL and C1 controls: never legitimate in a manifest string, and they would reach install cards (Aegis M2). */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/;
/**
 * The stricter class for every COMMAND-RUNNING field (mcp.command, mcp.args,
 * hooks.command, hooks.event; Aegis round 2 C1): C0/C1 plus Zl (U+2028), Zp
 * (U+2029) and Cf (format characters: bidi controls, zero-widths, tags). The
 * §4.5 sanitizer turns LS/PS into a newline, so one in a hook command could
 * draw a fake install-card line; here they are refused SCHEMA instead.
 */
// eslint-disable-next-line no-control-regex
export const COMMAND_UNSAFE = /[\u0000-\u001F\u007F-\u009F\p{Zl}\p{Zp}\p{Cf}]/u;
function cmdStr(v: unknown, where: string): string {
  const s = str(v, where);
  if (COMMAND_UNSAFE.test(s)) fail('SCHEMA', `${where} contains a line separator, format or control character`, { field: where });
  return s;
}
function str(v: unknown, where: string, re?: RegExp): string {
  if (typeof v !== 'string' || v.length === 0 || v.length > 512) fail('SCHEMA', `${where} must be a non-empty string`, { field: where });
  if (CONTROL_CHARS.test(v as string)) fail('SCHEMA', `${where} contains a control character`, { field: where });
  if (re && !re.test(v as string)) fail('SCHEMA', `${where} is malformed`, { field: where, value: v });
  return v as string;
}
function closed(o: Record<string, unknown>, keys: readonly string[], where: string): void {
  for (const k of Object.keys(o)) if (!keys.includes(k)) fail('SCHEMA', `${where} has unknown property "${k}"`, { field: `${where}.${k}` });
}

function validSlot(slot: string): boolean {
  if (FIXED_SLOTS.includes(slot)) return true;
  const tv = /^tool\.view:(.+)$/.exec(slot);
  if (tv) return DOTTED_ID.test(tv[1]!);
  const cd = /^card\.detail:([a-z][a-z0-9-]*)$/.exec(slot);
  return cd !== null;
}

/**
 * Validate a parsed manifest. Returns the manifest (typed) or throws a
 * ManifestRefusal naming the manifest code.
 */
export function validateManifest(value: unknown, opts: ValidateManifestOptions): ManifestV2 {
  if (!TRUST_TIER_PATTERN.test(opts.tier)) fail('TIER', `unknown trust tier ${String(opts.tier)}`);
  const m = obj(value, 'manifest');
  if ('trust' in m) fail('SCHEMA', 'a manifest carries no trust: field (the grant table does)', { field: 'trust' });
  if ('source' in m) fail('SCHEMA', 'a manifest carries no source: field (an install-time fact on grant.install)', { field: 'source' });
  if ('postinstall' in m || 'scripts' in m) fail('POSTINSTALL', 'no postinstall anywhere (§3.6)', { field: 'postinstall' in m ? 'postinstall' : 'scripts' });
  closed(m, TOP_KEYS, 'manifest');
  if (m.manifest === 1) fail('FORMAT', 'format 1 is read only through readManifest (upgradeManifestV1); a fresh install declares manifest: 2', { format: 1 });
  if (typeof m.manifest === 'number' && Number.isInteger(m.manifest) && m.manifest > MANIFEST_FORMAT_CURRENT) fail('FORMAT', `manifest format ${m.manifest} needs a newer Gnomon (this kernel reads ${MANIFEST_FORMATS_ACCEPTED.join(', ')})`, { format: m.manifest });
  if (m.manifest !== 2) fail('SCHEMA', 'manifest must be 2', { field: 'manifest' });
  if (typeof m.kind !== 'string' || !(MANIFEST_KINDS as readonly string[]).includes(m.kind)) fail('SCHEMA', `kind must be one of ${MANIFEST_KINDS.join('|')}`, { field: 'kind' });
  const kind = m.kind as ManifestKind;
  const publisher = str(m.publisher, 'publisher', PUBLISHER_PATTERN);
  const name = str(m.name, 'name', MOD_NAME_PATTERN);
  const id = `${publisher}.${name}`;
  const version = str(m.version, 'version', SEMVER);
  if (version.length > VERSION_MAX) fail('SCHEMA', `version is at most ${VERSION_MAX} characters`, { field: 'version' });
  const pre = version.split('+')[0]!.split('-').slice(1).join('-');
  if (pre && (pre.split('.').length > 4 || pre.split('.').some((x) => x.length > 16))) fail('SCHEMA', 'version prerelease is at most 4 identifiers of 16 characters', { field: 'version' });
  if (m.description !== undefined) str(m.description, 'description');
  checkIdentity(publisher, name, opts);
  if (m.engines !== undefined) {
    const e = obj(m.engines, 'engines');
    closed(e, ['gnomon'], 'engines');
    if (e.gnomon !== undefined) {
      const ok = enginesAdmit(e.gnomon);
      if (ok === null) fail('SCHEMA', `engines.gnomon must be space-joined >= > <= < = comparators of x.y.z (≤ ${ENGINES_MAX})`, { field: 'engines.gnomon' });
      if (ok === false) fail('ENGINE', `engines.gnomon ${String(e.gnomon)} does not admit this Gnomon ${GNOMON_VERSION}`, { id, engines: e.gnomon });
    }
  }

  // abi (§4.3: required for kind: mod; the kernel refuses an unknown abi)
  if (kind === 'mod' && m.abi === undefined) fail('ABI', 'kind: mod requires abi', { name });
  if (m.abi !== undefined && !(KNOWN_ABIS as readonly unknown[]).includes(m.abi)) fail('ABI', `unknown abi ${String(m.abi)}`, { name, abi: m.abi });

  if (FIRST_PARTY_ONLY_KINDS.includes(kind) && opts.tier !== 'first-party') {
    fail('TIER', `kind: ${kind} is accepted from the first-party trust tier only`, { name, kind, tier: opts.tier });
  }

  if (m.compat !== undefined) {
    const c = obj(m.compat, 'compat');
    closed(c, ['kernel', 'claudeCode'], 'compat');
    if (c.kernel !== undefined) str(c.kernel, 'compat.kernel');
    if (c.claudeCode !== undefined) str(c.claudeCode, 'compat.claudeCode');
  }
  if (m.config_schema !== undefined) obj(m.config_schema, 'config_schema');

  const provides = m.provides === undefined ? {} : obj(m.provides, 'provides');
  closed(provides, PROVIDES_KEYS, 'provides');
  if (kind === 'provider') {
    const other = Object.keys(provides).filter((k) => k !== 'knowledge');
    if (other.length > 0 || !Array.isArray(provides.knowledge) || provides.knowledge.length === 0) {
      fail('KNOWLEDGE', 'kind: provider ships only provides.knowledge', { name, other });
    }
  }
  for (const k of ['skills', 'agents', 'bands', 'steps', 'resolvers', 'blocks', 'oracles'] as const) arr(provides[k], `provides.${k}`);

  const mcpEntries = arr(provides.mcp, 'provides.mcp');
  // S0b: one server per mod, named by the kernel (mcpServerName(id))
  if (mcpEntries.length > 1) fail('SCHEMA', 'provides.mcp lists at most one server (manifest: 2)', { field: 'provides.mcp' });
  mcpEntries.forEach((e, i) => {
    const o = obj(e, `provides.mcp[${i}]`);
    closed(o, ['command', 'args', 'config'], `provides.mcp[${i}]`);
    cmdStr(o.command, `provides.mcp[${i}].command`);
    arr(o.args, `provides.mcp[${i}].args`).forEach((a, j) => {
      if (typeof a !== 'string' || COMMAND_UNSAFE.test(a)) fail('SCHEMA', `provides.mcp[${i}].args[${j}] must be a string without line separator, format or control characters`, { field: `provides.mcp[${i}].args[${j}]` });
    });
    if (o.config !== undefined) {
      const w = `provides.mcp[${i}].config`;
      const cfg = obj(o.config, w);
      closed(cfg, ['command', 'args', 'env', 'secret'], w);
      for (const k of ['command', 'args'] as const) if (cfg[k] !== undefined && cfg[k] !== true) fail('SCHEMA', `${w}.${k} must be true when present`, { field: `${w}.${k}` });
      const names = arr(cfg.env, `${w}.env`);
      if (names.length > MCP_CONFIG_LIMITS.env) fail('SCHEMA', `${w}.env lists at most ${MCP_CONFIG_LIMITS.env} names`, { field: `${w}.env` });
      const seen = new Set<string>();
      names.forEach((n, j) => {
        const name = str(n, `${w}.env[${j}]`, MCP_ENV_NAME);
        if (mcpEnvDenied(name)) fail('SCHEMA', `${w}.env[${j}]: ${name} is never user-settable`, { field: `${w}.env[${j}]`, name });
        if (opts.tier !== 'first-party' && !name.startsWith(mcpEnvOwnPrefix(id)) && !name.endsWith('_API_KEY') && !name.endsWith('_TOKEN')) {
          fail('SCHEMA', `${w}.env[${j}]: below the first-party tier a declared name starts with ${mcpEnvOwnPrefix(id)} or ends _API_KEY / _TOKEN`, { field: `${w}.env[${j}]`, name });
        }
        if (seen.has(name)) fail('SCHEMA', `${w}.env: duplicate ${name}`, { field: `${w}.env[${j}]` });
        seen.add(name);
      });
      arr(cfg.secret, `${w}.secret`).forEach((n, j) => {
        if (typeof n !== 'string' || !seen.has(n)) fail('SCHEMA', `${w}.secret[${j}] must name an env entry of this config`, { field: `${w}.secret[${j}]` });
      });
    }
  });
  const offers = arr(provides.offers, 'provides.offers');
  if (offers.length > OFFERS_PER_MOD_MAX) fail('SCHEMA', `provides.offers lists at most ${OFFERS_PER_MOD_MAX} offers`, { field: 'provides.offers', count: offers.length });
  if (offers.length > 0 && arr(provides.mcp, 'provides.mcp').length === 0) fail('SCHEMA', 'provides.offers reach the mod through its MCP server (reach: mcp); provides.mcp is empty', { field: 'provides.offers' });
  const offerKinds = new Set<string>();
  offers.forEach((e, i) => {
    const errors = validateOfferSpecV1(e);
    if (errors.length) fail('SCHEMA', `provides.offers[${i}] is not offer-spec:v1: ${errors.slice(0, 3).join('; ')}`, { field: `provides.offers[${i}]`, errors });
    const k = (e as OfferSpecV1).kind;
    // S0b §2: the whole mcp__<server>__<tool> fits 64 (checked here, so at install AND at load)
    const q = qualifiedToolName(id, (e as OfferSpecV1).handoffTool);
    if (q.length > QUALIFIED_TOOL_NAME_MAX) fail('SCHEMA', `provides.offers[${i}]: ${q} is longer than ${QUALIFIED_TOOL_NAME_MAX} characters`, { field: `provides.offers[${i}].handoffTool`, length: q.length });
    if (offerKinds.has(k)) fail('SCHEMA', `duplicate offer ${k}`, { field: `provides.offers[${i}]` });
    offerKinds.add(k);
  });
  arr(provides.hooks, 'provides.hooks').forEach((e, i) => {
    const o = obj(e, `provides.hooks[${i}]`);
    closed(o, ['event', 'command'], `provides.hooks[${i}]`);
    cmdStr(o.event, `provides.hooks[${i}].event`);
    cmdStr(o.command, `provides.hooks[${i}].command`);
  });

  const toolNames = new Set<string>();
  arr(provides.tools, 'provides.tools').forEach((e, i) => {
    const o = obj(e, `provides.tools[${i}]`);
    closed(o, ['name', 'schema', 'effects'], `provides.tools[${i}]`);
    const tn = str(o.name, `provides.tools[${i}].name`, DOTTED_ID);
    if (toolNames.has(tn)) fail('SCHEMA', `duplicate tool ${tn}`);
    toolNames.add(tn);
    if (o.schema !== undefined) obj(o.schema, `provides.tools[${i}].schema`);
    const effects = arr(o.effects, `provides.tools[${i}].effects`);
    if (effects.length === 0) fail('SCHEMA', `provides.tools[${i}].effects must name at least one effect`);
    for (const ef of effects) {
      if (!(TOOL_EFFECTS as readonly unknown[]).includes(ef)) fail('SCHEMA', `tool effect ${String(ef)} ⊄ ${TOOL_EFFECTS.join('|')}`, { tool: tn });
    }
  });

  const viewIds = new Set<string>();
  arr(provides.views, 'provides.views').forEach((e, i) => {
    const o = obj(e, `provides.views[${i}]`);
    closed(o, ['id', 'slot', 'placement', 'fixtures'], `provides.views[${i}]`);
    const id = str(o.id, `provides.views[${i}].id`, DOTTED_ID);
    if (viewIds.has(id)) fail('SCHEMA', `duplicate view ${id}`);
    viewIds.add(id);
    const slot = str(o.slot, `provides.views[${i}].slot`);
    if (!validSlot(slot)) fail('SCHEMA', `unknown view slot ${slot}`, { view: id });
    if (o.placement !== 'append' && o.placement !== 'replace') fail('SCHEMA', `view placement must be append|replace`, { view: id });
    if (o.placement === 'replace' && (slot.startsWith('card.') || slot === 'status.mod')) {
      fail('SCHEMA', `card.* and status.mod slots are append-only (S22-H5)`, { view: id, slot });
    }
    arr(o.fixtures, `provides.views[${i}].fixtures`).forEach((f, j) => str(f, `provides.views[${i}].fixtures[${j}]`));
  });

  const ownNs = modEventPrefix(id);
  // only an alias-table format-1 mod keeps its legacy modns.<legacyName>.* (S0b §4)
  const legacyNs = opts.legacyName !== undefined && publisher === 'gnomon' ? `modns.${opts.legacyName}.` : null;
  const owns = (k: string) => (k.startsWith(ownNs) && k.length > ownNs.length) || (legacyNs !== null && k.startsWith(legacyNs) && k.length > legacyNs.length);
  const events = arr(provides.events, 'provides.events');
  for (const [i, ev] of events.entries()) {
    const k = str(ev, `provides.events[${i}]`);
    if (!owns(k)) fail('CAPABILITY', `mod event kinds live under ${ownNs}* (A23-1); ${k} is not`, { kind: k });
  }

  const commandIds = new Set<string>();
  arr(provides.commands, 'provides.commands').forEach((e, i) => {
    const o = obj(e, `provides.commands[${i}]`);
    closed(o, ['id', 'title', 'args'], `provides.commands[${i}]`);
    const id = str(o.id, `provides.commands[${i}].id`, DOTTED_ID);
    if (commandIds.has(id)) fail('SCHEMA', `duplicate command ${id}`);
    commandIds.add(id);
    str(o.title, `provides.commands[${i}].title`);
    if (o.args !== undefined) obj(o.args, `provides.commands[${i}].args`);
  });
  arr(provides.keybindings, 'provides.keybindings').forEach((e, i) => {
    const o = obj(e, `provides.keybindings[${i}]`);
    closed(o, ['key', 'command'], `provides.keybindings[${i}]`);
    const key = str(o.key, `provides.keybindings[${i}].key`);
    const cmd = str(o.command, `provides.keybindings[${i}].command`);
    if (RESERVED_DECISION_KEYS.includes(key.trim().toLowerCase())) fail('SCHEMA', `reserved decision key ${key} is never bindable (§12.2)`, { key });
    if (!commandIds.has(cmd)) fail('SCHEMA', `keybinding binds ${cmd}, which is not a declared command id`, { key, command: cmd });
  });

  const knowledge = arr(provides.knowledge, 'provides.knowledge');
  knowledge.forEach((e, i) => {
    const o = obj(e, `provides.knowledge[${i}]`);
    closed(o, ['name', 'scheme', 'query', 'maxTier'], `provides.knowledge[${i}]`);
    str(o.name, `provides.knowledge[${i}].name`, NAME_PATTERN);
    str(o.scheme, `provides.knowledge[${i}].scheme`, SCHEME);
    str(o.query, `provides.knowledge[${i}].query`, DOTTED_ID);
    str(o.maxTier, `provides.knowledge[${i}].maxTier`, TIER_LABEL);
  });

  const requires = m.requires === undefined ? {} : obj(m.requires, 'requires');
  closed(requires, ['capabilities', 'egress'], 'requires');
  const caps = arr(requires.capabilities, 'requires.capabilities').map((c, i) => str(c, `requires.capabilities[${i}]`));
  for (const cap of caps) {
    if (NEVER_REQUESTABLE.includes(cap)) fail('CAPABILITY', `a manifest cannot request ${cap}`, { capability: cap });
    const form = capabilityForm(cap);
    if (form === undefined) fail('CAPABILITY', `unknown capability ${cap} (§15.4)`, { capability: cap });
    if ((GRANT_DERIVED_ONLY_CAPABILITIES as readonly string[]).includes(form!)) {
      fail('CAPABILITY', `${cap} is derived only from a root-signed grant row, never from a manifest`, { capability: cap });
    }
    if ((FIRST_PARTY_ONLY_CAPABILITIES as readonly string[]).includes(form!) && opts.tier !== 'first-party') {
      fail('TIER', `${cap} is first-party only`, { capability: cap, tier: opts.tier });
    }
    if (form === 'log.append:<ns>.*' && cap !== `log.append:${ownNs}*` && !(legacyNs !== null && cap === `log.append:${legacyNs}*`)) {
      fail('CAPABILITY', `log.append is grantable only on the mod's own ${ownNs}* (kernel-owned kinds are refused)`, { capability: cap });
    }
  }
  const hasKnowledgeCap = caps.includes('knowledge:provide');
  if (knowledge.length > 0 && !hasKnowledgeCap) fail('KNOWLEDGE', 'provides.knowledge needs capability knowledge:provide', { name });

  const egress = requires.egress;
  if (egress !== undefined && egress !== 'none') {
    const list = arr(egress, 'requires.egress');
    if (knowledge.length > 0 || hasKnowledgeCap) fail('EGRESS', 'a manifest with provides.knowledge cannot list egress (§3.6)', { name });
    list.forEach((e, i) => {
      const o = obj(e, `requires.egress[${i}]`);
      closed(o, ['host', 'purpose'], `requires.egress[${i}]`);
      str(o.purpose, `requires.egress[${i}].purpose`);
      const v = checkEgressHost(o.host);
      if (!v.ok) fail('EGRESS', v.why === 'anthropic' ? `egress to an Anthropic API host is refused (${v.host})` : `egress host ${v.host} is refused (${v.why})`, { host: v.host, why: v.why });
    });
  }
  // Aegis M1 (#ledger-mod): usage numbers (tokens, cache share, cost, compactions) plus a network path is an exfiltration
  // shape; a local-tier mod may hold log.read:usage or egress, never both
  if (caps.includes('log.read:usage') && opts.tier === 'local' && egress !== undefined && egress !== 'none' && Array.isArray(egress) && egress.length > 0) {
    fail('EGRESS', 'a local-tier mod with log.read:usage cannot list egress', { capability: 'log.read:usage', tier: opts.tier });
  }
  // K1 (#paradigm-context-mod): repo task/decision/lore titles plus a network path is an exfiltration shape;
  // a mod holding paradigm.read:summary may list no egress, at ANY tier
  if (caps.includes('paradigm.read:summary') && Array.isArray(egress) && egress.length > 0) {
    fail('EGRESS', 'a mod with paradigm.read:summary cannot list egress', { capability: 'paradigm.read:summary', tier: opts.tier });
  }
  return value as ManifestV2;
}

function mcpEnvDenied(name: string): boolean {
  return MCP_ENV_DENY.has(name) || MCP_ENV_DENY_PREFIXES.some((p) => name.startsWith(p));
}

/**
 * Validate a per-user override of one provides.mcp server (TD-2026-10-20-812: first-party servers launch as
 * `node <absolute path>` from another repo, so the manifest's fixed command cannot name them). Closed: only what the
 * manifest entry's `config` permits; the same COMMAND_UNSAFE rule as the manifest; env names from the declared list
 * only. Throws ManifestRefusal SCHEMA.
 */
export function validateMcpUserConfig(entry: ManifestMcp, value: unknown): McpUserConfig {
  const w = 'mcp config';
  const o = obj(value, w);
  closed(o, ['command', 'args', 'env'], w);
  const allow = entry.config ?? {};
  const out: McpUserConfig = {};
  if (o.command !== undefined) {
    if (allow.command !== true) fail('SCHEMA', `${w}: the manifest does not let the user set command`, { field: 'command' });
    out.command = cmdStr(o.command, `${w}.command`);
    // Aegis L4: an absolute path only (no PATH lookup). The launcher (S1) must spawn with shell:false.
    if (!/^(?:\/|[A-Za-z]:[\\/])/.test(out.command) || out.command.startsWith('//') || out.command.startsWith('\\\\')) {
      fail('SCHEMA', `${w}.command must be an absolute path`, { field: 'command' });
    }
  }
  if (o.args !== undefined) {
    if (allow.args !== true) fail('SCHEMA', `${w}: the manifest does not let the user set args`, { field: 'args' });
    const a = arr(o.args, `${w}.args`);
    if (a.length > MCP_CONFIG_LIMITS.args) fail('SCHEMA', `${w}.args: at most ${MCP_CONFIG_LIMITS.args}`, { field: 'args' });
    out.args = a.map((x, j) => {
      if (typeof x !== 'string' || x.length > MCP_CONFIG_LIMITS.value || COMMAND_UNSAFE.test(x)) fail('SCHEMA', `${w}.args[${j}] must be a string without line separator, format or control characters`, { field: `args[${j}]` });
      return x as string;
    });
  }
  if (o.env !== undefined) {
    const e = obj(o.env, `${w}.env`);
    const declared = allow.env ?? [];
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(e)) {
      if (!declared.includes(k) || mcpEnvDenied(k)) fail('SCHEMA', `${w}.env: ${k} is not a user-settable name of this server`, { field: `env.${k}` });
      // Aegis S1 M2: an override's env values land in the session's mcp.json (readable by the session); no secrets there
      if (allow.secret?.includes(k)) fail('SCHEMA', `${w}.env: ${k} is marked secret; secrets cannot be set through an override yet`, { field: `env.${k}` });
      if (typeof v !== 'string' || v.length > MCP_CONFIG_LIMITS.value || COMMAND_UNSAFE.test(v)) fail('SCHEMA', `${w}.env.${k} must be a string without line separator, format or control characters`, { field: `env.${k}` });
      env[k] = v as string;
    }
    out.env = env;
  }
  return out;
}

/** The launch of one provides.mcp server under an optional per-user override (validated here). */
export function resolveMcpLaunch(entry: ManifestMcp, override?: unknown): { command: string; args: string[]; env: Record<string, string> } {
  const u = override === undefined ? {} : validateMcpUserConfig(entry, override);
  return { command: u.command ?? entry.command, args: u.args ?? entry.args ?? [], env: u.env ?? {} };
}

/* ── manifest widening (§3.6, §12.5) ──────────────────────────────────────── */

/** §12.5's list plus `mcp` and `hooks` (Aegis F3): both run commands, so an addition is always a widening; plus
 * `offers` (TD-2026-10-20-812): a new offer is a new way the model may steer the human to the mod. */
export const WIDENING_FIELDS = ['effects', 'egress', 'capabilities', 'events', 'tools', 'views', 'commands', 'keybindings', 'knowledge', 'mcp', 'hooks', 'offers'] as const;
export type WideningField = (typeof WIDENING_FIELDS)[number];

export interface WideningEntry {
  field: WideningField;
  added: string[];
}

function surface(m: ManifestV2 | null): Record<WideningField, Set<string>> {
  const p = m?.provides ?? {};
  const eg = m?.requires?.egress;
  return {
    effects: new Set((p.tools ?? []).flatMap((t) => t.effects.map((e) => `${t.name}:${e}`))),
    egress: new Set(Array.isArray(eg) ? eg.map((e) => checkEgressHost(e.host).host) : []),
    capabilities: new Set(m?.requires?.capabilities ?? []),
    events: new Set(p.events ?? []),
    tools: new Set((p.tools ?? []).map((t) => t.name)),
    views: new Set((p.views ?? []).map((v) => `${v.id}@${v.slot}:${v.placement}`)),
    commands: new Set((p.commands ?? []).map((c) => c.id)),
    keybindings: new Set((p.keybindings ?? []).map((k) => `${k.key.trim().toLowerCase()}→${k.command}`)),
    knowledge: new Set((p.knowledge ?? []).map((k) => `${k.name}|${k.scheme}|${k.query}|${k.maxTier}`)),
    // an entry with no config keeps its pre-812 key; a config (what a user may override) is part of the surface
    // S0b: the entry has no name (one server per mod, named by the kernel); V2 vs V2 only
    mcp: new Set((p.mcp ?? []).map((s) => canonicalJson(s.config ? [s.command, s.args ?? [], s.config] : [s.command, s.args ?? []]))),
    // Aegis M2: contextIn is a data-flow grant, so each source is its own key and adding one widens
    offers: new Set((p.offers ?? []).flatMap((o) => [`${o.kind}@${o.phase}→${o.handoffTool}`, ...o.contextIn.map((src) => `${o.kind}:in:${src}`)])),
    hooks: new Set((p.hooks ?? []).map((h) => canonicalJson([h.event, h.command]))),
  };
}

/**
 * Any ADDITION between two snapshots' manifests, by field (`prev = null`
 * means a first install: everything is an addition). An empty result means
 * the new manifest asks for nothing the old one did not.
 */
export function detectWidening(prev: ManifestV2 | null, next: ManifestV2): WideningEntry[] {
  const a = surface(prev);
  const b = surface(next);
  const out: WideningEntry[] = [];
  for (const f of WIDENING_FIELDS) {
    const added = [...b[f]].filter((x) => !a[f].has(x)).sort();
    if (added.length) out.push({ field: f, added });
  }
  return out;
}
