/**
 * @symbol #manifest-loader
 *
 * #manifest-loader — `manifest:v1` validation, `manifestHash` and manifest
 * widening (spec §3.6, §4.3, §12.1–§12.5, §15.4).
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
  CAPABILITY_FORMS,
  EVENT_KIND_NAMES,
  FIRST_PARTY_ONLY_CAPABILITIES,
  GRANT_DERIVED_ONLY_CAPABILITIES,
  isPlainObject,
} from '@a-company/gnomon-contracts';
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

const TOP_KEYS = ['manifest', 'kind', 'name', 'version', 'abi', 'compat', 'provides', 'requires', 'config_schema', 'description'] as const;
const PROVIDES_KEYS = ['mcp', 'skills', 'agents', 'hooks', 'bands', 'steps', 'resolvers', 'blocks', 'oracles', 'tools', 'views', 'events', 'commands', 'keybindings', 'knowledge'] as const;
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
export interface ManifestMcp {
  name: string;
  command: string;
  args?: string[];
}
export interface ManifestEgress {
  host: string;
  purpose: string;
}

export interface ManifestV1 {
  manifest: 1;
  kind: ManifestKind;
  name: string;
  version: string;
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
  };
  requires?: { capabilities?: string[]; egress?: 'none' | ManifestEgress[] };
  config_schema?: Record<string, unknown>;
}

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

/** `sha256:<hex>` of the canonical JSON of the manifest (§4.3). */
export function manifestHash(m: ManifestV1): string {
  return `sha256:${createHash('sha256').update(canonicalJson(m), 'utf8').digest('hex')}`;
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
function str(v: unknown, where: string, re?: RegExp): string {
  if (typeof v !== 'string' || v.length === 0 || v.length > 512) fail('SCHEMA', `${where} must be a non-empty string`, { field: where });
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
export function validateManifest(value: unknown, opts: ValidateManifestOptions): ManifestV1 {
  if (!TRUST_TIER_PATTERN.test(opts.tier)) fail('TIER', `unknown trust tier ${String(opts.tier)}`);
  const m = obj(value, 'manifest');
  if ('trust' in m) fail('SCHEMA', 'a manifest carries no trust: field (the grant table does)', { field: 'trust' });
  if ('source' in m) fail('SCHEMA', 'a manifest carries no source: field (an install-time fact on grant.install)', { field: 'source' });
  if ('postinstall' in m || 'scripts' in m) fail('POSTINSTALL', 'no postinstall anywhere (§3.6)', { field: 'postinstall' in m ? 'postinstall' : 'scripts' });
  closed(m, TOP_KEYS, 'manifest');
  if (m.manifest !== 1) fail('SCHEMA', 'manifest must be 1', { field: 'manifest' });
  if (typeof m.kind !== 'string' || !(MANIFEST_KINDS as readonly string[]).includes(m.kind)) fail('SCHEMA', `kind must be one of ${MANIFEST_KINDS.join('|')}`, { field: 'kind' });
  const kind = m.kind as ManifestKind;
  const name = str(m.name, 'name', NAME_PATTERN);
  str(m.version, 'version', SEMVER);
  if (m.description !== undefined) str(m.description, 'description');
  if (KERNEL_NAMESPACE_TOKENS.has(name)) fail('NAME', `name "${name}" collides with a kernel namespace token`, { name });

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

  arr(provides.mcp, 'provides.mcp').forEach((e, i) => {
    const o = obj(e, `provides.mcp[${i}]`);
    closed(o, ['name', 'command', 'args'], `provides.mcp[${i}]`);
    str(o.name, `provides.mcp[${i}].name`, NAME_PATTERN);
    str(o.command, `provides.mcp[${i}].command`);
    arr(o.args, `provides.mcp[${i}].args`).forEach((a, j) => {
      if (typeof a !== 'string') fail('SCHEMA', `provides.mcp[${i}].args[${j}] must be a string`);
    });
  });
  arr(provides.hooks, 'provides.hooks').forEach((e, i) => {
    const o = obj(e, `provides.hooks[${i}]`);
    closed(o, ['event', 'command'], `provides.hooks[${i}]`);
    str(o.event, `provides.hooks[${i}].event`);
    str(o.command, `provides.hooks[${i}].command`);
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

  const ownNs = `modns.${name}.`;
  const events = arr(provides.events, 'provides.events');
  for (const [i, ev] of events.entries()) {
    const k = str(ev, `provides.events[${i}]`);
    if (!k.startsWith(ownNs)) fail('CAPABILITY', `mod event kinds live under ${ownNs}* (A23-1); ${k} is not`, { kind: k });
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
    if (form === 'log.append:<ns>.*' && cap !== `log.append:${ownNs}*`) {
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
  return value as ManifestV1;
}

/* ── manifest widening (§3.6, §12.5) ──────────────────────────────────────── */

/** §12.5's list plus `mcp` and `hooks` (Aegis F3): both run commands, so an addition is always a widening. */
export const WIDENING_FIELDS = ['effects', 'egress', 'capabilities', 'events', 'tools', 'views', 'commands', 'keybindings', 'knowledge', 'mcp', 'hooks'] as const;
export type WideningField = (typeof WIDENING_FIELDS)[number];

export interface WideningEntry {
  field: WideningField;
  added: string[];
}

function surface(m: ManifestV1 | null): Record<WideningField, Set<string>> {
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
    mcp: new Set((p.mcp ?? []).map((s) => canonicalJson([s.name, s.command, s.args ?? []]))),
    hooks: new Set((p.hooks ?? []).map((h) => canonicalJson([h.event, h.command]))),
  };
}

/**
 * Any ADDITION between two snapshots' manifests, by field (`prev = null`
 * means a first install: everything is an addition). An empty result means
 * the new manifest asks for nothing the old one did not.
 */
export function detectWidening(prev: ManifestV1 | null, next: ManifestV1): WideningEntry[] {
  const a = surface(prev);
  const b = surface(next);
  const out: WideningEntry[] = [];
  for (const f of WIDENING_FIELDS) {
    const added = [...b[f]].filter((x) => !a[f].has(x)).sort();
    if (added.length) out.push({ field: f, added });
  }
  return out;
}
