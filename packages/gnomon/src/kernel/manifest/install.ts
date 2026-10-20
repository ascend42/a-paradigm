/**
 * @symbol #manifest-loader
 *
 * #manifest-loader install / link / load / rollback (spec §3.6, §12.4, §12.5,
 * §15.4; G-MAN-02, G-MAN-03).
 *
 * STAGE, NEVER EFFECT. `stageInstall` (package install or linked folder)
 * validates the manifest, copies the source into a content-addressed snapshot,
 * computes the manifest widening and the file diff against the effective pin,
 * and writes a PENDING `card:v1` record of kind `install` with its detail to
 * `<home>/mods/<name>/staged/<cardId>.json` (`manifest.staged{…, by}`). It signs
 * nothing and grants nothing: a mod is effective only through a ROOT-signed
 * `grant.install` row (grants.ts), and what loads is decided only from those
 * rows. An agent-written manifest therefore always needs a card (G-MAN-02).
 *
 * TIER IS DERIVED, never asserted by the caller (Aegis F4): a linked folder is
 * `local` unless a signature over the manifestHash verifies against a trusted
 * key (none exist yet, so a signed claim is refused TIER); `first-party` only
 * when the packageHash is in the kernel's bundled allowlist
 * (FIRST_PARTY_PACKAGE_HASHES, empty until packages/gnomon-mods ships); every
 * other package is `local`.
 *
 * M1.6: the decision is owned by #approval-broker (broker/install-card.ts),
 * with presence BOUND to {cardId, contentHash}. Historical (M1.5):
 * THE DECISION WAS NOT A PRODUCTION API. The approval broker that decides
 * cards (fresh presence, root key, kernel-signed actions) is M1.6. Until then
 * `decideInstall` and `rollbackMod` are module-private and registered ONLY on
 * the internal seam channel (internal-seams.ts), read only by the internal test
 * entry (src/kernel/testing.ts); test/seams-fence.test.ts proves no CLI, daemon
 * or production entry can reach them. Both also demand a PresenceToken for
 * their purpose (`mod.install` / `mod.rollback`) and a RootAuthority that can
 * sign — which production cannot supply before M1.3.
 *
 * LOAD. `loadMod` resolves the effective `grant.install`, re-hashes the pinned
 * snapshot (INTEGRITY on mismatch), re-validates the manifest, checks it
 * against the grant table, and for a linked folder re-hashes the source: any
 * change pauses the mod (`mod.paused{name, reason:'changed', files[]}`) and
 * stages the re-approve card; nothing from the changed tree is loaded before a
 * decision (the snapshot keeps running bytes unchanged). Hot reload is by
 * packageHash from pinned snapshots only. Watching (`fs.watch` /
 * `ReadDirectoryChangesW`) and dev mode belong to #mod-host (M1.11), which
 * calls this primitive on every start and every watch event.
 *
 * S0b (mod ids and versions, §12.4.1). Every mod is `<publisher>.<name>`; the snapshot, staged cards and grant rows
 * are keyed by that id. The source is `package`, `linked:<realpath>` or `git:<canonical url>#<sha40>` (the fetch is
 * S4; stageInstall takes the fetched checkout plus its claimed git URL and commit). Publisher checks against the
 * source (checkPublisherSource, at stage AND load): a folder or package is "(unverified, local folder)" and never a
 * founder brand; github.com needs publisher = the URL owner; another host binds (host, namespace) on first approval
 * (TOFU grant.publisher) and a later claim from elsewhere is refused unless the human re-binds through a full card.
 * The card's index-3 line classifies the bytes against the approved history (first / update / downgrade /
 * same-version-new-bytes / format-only); the header verb is Install / Update / Downgrade / Re-approve "by
 * <publisher>"; a short card only when nothing widens and the source did not change. COLLISION: the derived MCP
 * server name may not equal another installed mod's nor one in the user's .mcp.json, at install AND load.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { canonicalJson, FOUNDER_BRANDS, gitSourceString, isModId, mcpServerName, mintId, modSkeleton, parseGitSource, parseModId, sanitizeDisplayText, validateCardV1, type CardFlag, type CardV1 } from '@a-company/gnomon-contracts';
import { MAX_LINE } from '../broker/card.js';
import type { RootAuthority } from '../identity/root-authority.js';
import type { RowVerifier } from '../identity/registry.js';
import { consumeBoundPresence } from '../identity/presence.js';
import { registerSeams } from '../internal-seams.js';
import { appendGrantRow, checkAgainstGrants, effectiveInstall, HISTORICAL_FIRST_PARTY_PINS, pinDirKey, readGrants, type GrantInstallRow, type ResolvedGrants } from './grants.js';
import { COMMAND_UNSAFE, compareVersions, detectWidening, MANIFEST_FILE, readManifest, type ManifestMcpConfig, type ManifestV2, type ReadManifestResult, type TrustTier, type WideningEntry } from './manifest.js';
import { ManifestRefusal, noEvents, type ManifestEventSink } from './refusal.js';
import { computePackageHash, diffTrees, hashPinnedTree, hashSourceTree, modDir, pinnedDir, removeTree, snapshotFolder, type TreeDiff, type TreeFile } from './snapshot.js';

export const STAGED_RECORD_SCHEMA = 'gnomon-staged-install:v1' as const;
const CARD_ID = /^card:[0-9A-HJKMNP-TV-Z]{26}$/;

/**
 * packageHashes of the first-party mods the kernel bundles (packages/gnomon-mods).
 * M1.11 slice 3: the Workshop (#workshop-mod); mod #1: the Ledger (#ledger-mod).
 * Any edit to a tree moves its hash; test/workshop-mod.test.ts and
 * test/ledger-mod.test.ts hold the pins.
 */
export const FIRST_PARTY_PACKAGE_HASHES: ReadonlySet<string> = new Set<string>([
  // S0b: manifest:2, publisher gnomon, 1.1.0
  'sha256:97d69bb8b35ffdc9bec8a38a9c4644e51a8cd8bb0014d30de10998f322d05aa7', // packages/gnomon-mods/workshop 1.1.0 (gnomon.workshop)
  'sha256:d63815e16e3b7f062a69e29efa2e62b6186836bb448564f856989eefe37c1852', // packages/gnomon-mods/ledger 1.1.0 (gnomon.ledger)
  'sha256:8a1e491e72e1743e5342863bcd74a0ca59efc45bc9422f47aefe32f744c1fcc0', // packages/gnomon-mods/paradigm-context 1.1.0 (gnomon.paradigm-context)
  'sha256:978705dfe2caa6dd26663ab9c5c8ace2d9cac755d86ee2b45bf582aff070862a', // packages/gnomon-mods/neurons 1.1.0 (gnomon.neurons, was neurons-brain)
  'sha256:1473214df42c5efe6f6d95739064d12e817515501591738c669c457e0a5f81c9', // packages/gnomon-mods/constellation 1.1.0 (gnomon.constellation)
  // the format-1 1.0.0 pins of workshop, ledger and paradigm-context (grants.ts; existing installs keep loading)
  ...HISTORICAL_FIRST_PARTY_PINS,
]);
/** Keys trusted to sign community manifests (`signed:<gkey>` tier). None in 8.0 Move 1. */
export const TRUSTED_MANIFEST_KEYS: ReadonlySet<string> = new Set<string>();

/** Derive the trust tier from provenance (never from the caller or the manifest). */
export function deriveTier(packageHash: string, signature?: { keyId: string; sig: string }): TrustTier {
  if (signature) {
    // no trusted manifest keys exist yet: a signed claim cannot verify, so it is refused rather than downgraded silently
    if (!TRUSTED_MANIFEST_KEYS.has(signature.keyId)) throw new ManifestRefusal('TIER', `manifest signature by ${signature.keyId} does not verify against a trusted key`, { keyId: signature.keyId });
  }
  return FIRST_PARTY_PACKAGE_HASHES.has(packageHash) ? 'first-party' : 'local';
}

export type InstallSource = 'package' | `linked:${string}` | `git:${string}`;

/** S0b §3: how the bytes compare with the approved history of this mod id (the card's index-3 line). */
/** What a publisher binding replaces (Aegis S0b M2). */
export type PublisherFrom = { host: string; namespace: string } | 'github.com' | null;

export type VersionClass = 'first' | 'update' | 'downgrade' | 'revert' | 'same-version-new-bytes' | 'format-only';

/** What the install card shows (§12.5), and what its contentHash covers. */
export interface InstallCardDetail {
  /** the mod id <publisher>.<name> */
  name: string;
  publisher: string;
  /** how the publisher is shown: `acme`, `acme (unverified, local folder)`, `acme @ gitlab.com` */
  publisherDisplay: string;
  /** manifest format of the staged bytes (1 only for a historical first-party pin) */
  format: 1 | 2;
  upgradedHash?: string;
  versionClass: VersionClass;
  /** the version of the pin this replaces (absent on a first install) */
  prevVersion?: string;
  /** the source this replaces when it differs in kind, owner, host or namespace (a source change: always the full card) */
  sourceChangedFrom?: string;
  /** another installed third-party publisher this one is a skeleton match of */
  looksLike?: string;
  /** the derived MCP server name (absent when the mod has no provides.mcp) */
  serverName?: string;
  /** a non-GitHub publisher re-bound to a new (host, namespace) by this card */
  /**
   * the publisher binding this install writes (Aegis S0b M2): `from` is the binding it replaces as seen at stage
   * ({host, namespace}, 'github.com' for the implicit owner claim, or null for a first binding); decide refuses
   * PUBLISHER unless the binding is still `from`
   */
  rebind?: { host: string; namespace: string; from?: PublisherFrom };
  kind: ManifestV2['kind'];
  version: string;
  source: InstallSource;
  tier: TrustTier;
  manifestHash: string;
  packageHash: string;
  effects: string[];
  egress: string[];
  capabilities: string[];
  events: string[];
  tools: string[];
  views: string[];
  readPaths: string[];
  packages: string[];
  commands: string[];
  keybindings: string[];
  knowledge: string[];
  mcp: string[];
  hooks: string[];
  /** the Desk (TD-2026-10-20-812): one line per declared offer; absent when the manifest declares none */
  offers?: string[];
  /** counts of the opaque provides arrays (skills, agents, bands, steps, resolvers, blocks, oracles) */
  opaque: Record<string, number>;
  /** the effective pin this card would replace, or null for a first install */
  replaces: { packageHash: string; manifestHash: string } | null;
  widened: WideningEntry[];
  files: TreeDiff;
  stagedBy: string;
  hsid?: string;
}

export interface StagedRecord {
  schemaVersion: typeof STAGED_RECORD_SCHEMA;
  card: CardV1;
  detail: InstallCardDetail;
  manifest: ManifestV2;
  decision?: { decision: 'install' | 'deny'; at: string };
}

export interface StageOptions {
  home: string;
  /** the package path or the linked folder */
  source: string;
  via: 'package' | 'linked' | 'git';
  /**
   * via 'git': the claimed URL and commit of the fetched checkout in `source` (the fetch itself is S4).
   * TODO(S4, Aegis S0b L4): the fetch seam MUST run git with `-c http.followRedirects=false` (spec
   * gnomon-mod-naming-versioning.md §3 Git source: repo-jacking) plus the other D4 clone flags; integrity stays the
   * packageHash verified here and at load, never the sha40 locator.
   */
  git?: { url: string; commit: string };
  /** the human asked to re-bind a non-GitHub publisher to this source's (host, namespace) (full card) */
  rebindPublisher?: boolean;
  /** MCP server names in the user's .mcp.json (COLLISION) */
  userMcpServers?: readonly string[];
  /**
   * kernel-internal (loadMod's upgradedHash re-card, Aegis S0b L2): the alias publisher of the pinned format-1 row,
   * and a re-card even when the bytes, manifestHash and source equal the current pin. Never set from a client.
   */
  recard?: { legacyPublisher?: 'gnomon' | 'local' };
  /** a signature over the manifestHash claiming the `signed:<gkey>` tier (refused until trusted keys exist) */
  signature?: { keyId: string; sig: string };
  /** the principal that staged it (an agent session principal for agent-written mods) */
  requestedBy: string;
  hsid?: string;
  attended?: boolean;
  /** extra read paths a knowledge:provide grant asks for (listed on the card) */
  readPaths?: string[];
  trust: RowVerifier;
  emit?: ManifestEventSink;
  now?: Date;
}

export type StageResult = { state: 'staged'; cardId: string; record: StagedRecord } | { state: 'unchanged'; packageHash: string };

function readManifestBytes(dir: string, name: string, emit: ManifestEventSink): Buffer {
  try {
    return fs.readFileSync(path.join(dir, MANIFEST_FILE));
  } catch {
    emit('manifest.refuse', { name, code: 'SCHEMA', reason: 'manifest-unreadable' });
    throw new ManifestRefusal('SCHEMA', `${MANIFEST_FILE} is missing or not JSON`, { name });
  }
}

/** The raw manifest object of a folder, or null. */
function rawManifestOf(dir: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(fs.readFileSync(path.join(dir, MANIFEST_FILE), 'utf8')) as unknown;
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Best-effort mod id for refusal events and the snapshot directory before the manifest validates. */
function sourceName(source: string, legacyPublisher?: string): string {
  const m = rawManifestOf(source);
  const id = m && typeof m.name === 'string' ? `${typeof m.publisher === 'string' ? m.publisher : (legacyPublisher ?? 'local')}.${m.name}` : '';
  if (isModId(id)) return id;
  return `local.${path.basename(path.resolve(source)).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^[^a-z]+|-+$/g, '').slice(0, 24) || 'unnamed'}`;
}

/** The kind and identity of a source, compared for a source change (S0b §3). */
function sourceIdentity(source: string): string {
  if (source === 'package') return 'package';
  if (source.startsWith('linked:')) return 'linked';
  const g = parseGitSource(source);
  return g ? `git:${g.host}/${g.namespace}` : source;
}

/**
 * The structured publisher display carried in status.mods (Aegis S0b L1): `host` for a non-GitHub git publisher
 * (shown "acme @ host"), and whether the publisher is verified by its source (gnomon; a github.com owner; a
 * TOFU-bound git namespace). A folder or package install is unverified.
 */
export function publisherDisplayOf(publisher: string, source: string): { host: string | null; verified: boolean } {
  if (publisher === 'gnomon') return { host: null, verified: true };
  const g = parseGitSource(source);
  if (!g) return { host: null, verified: false };
  return { host: g.host === 'github.com' ? null : g.host, verified: true };
}

/** How a publisher is shown for this source (S0b §1 Display). */
export function publisherDisplay(publisher: string, source: string): string {
  if (publisher === 'gnomon') return publisher;
  if (source === 'package' || source.startsWith('linked:')) return `${publisher} (unverified, local folder)`;
  const g = parseGitSource(source);
  return g && g.host !== 'github.com' ? `${publisher} @ ${g.host}` : publisher;
}

/**
 * S0b §1: the publisher against the source and the TOFU bindings (at stage AND at load). Returns the (host, namespace)
 * a non-GitHub git install binds (or re-binds), or null. Throws PUBLISHER.
 */
export function checkPublisherSource(manifest: ManifestV2, source: string, grants: ResolvedGrants, opts: { rebind?: boolean; tier?: TrustTier } = {}): { host: string; namespace: string; rebind: boolean; from: PublisherFrom } | null {
  const pub = manifest.publisher;
  const refuse = (msg: string, detail: Record<string, unknown> = {}): never => {
    throw new ManifestRefusal('PUBLISHER', msg, { publisher: pub, ...detail });
  };
  const brand = Object.prototype.hasOwnProperty.call(FOUNDER_BRANDS, pub) ? FOUNDER_BRANDS[pub] : undefined;
  if (brand === null) refuse(`publisher ${pub} is a reserved founder brand`);
  // ascend42 and its skeleton matches: only as the github.com owner ascend42
  const ascendLike = Object.entries(FOUNDER_BRANDS).find(([b, v]) => v !== null && modSkeleton(b) === modSkeleton(pub));
  if (pub === 'gnomon' || pub === 'local') return null; // tier rule in validateManifest; local is kernel-assigned
  if (source === 'package' || source.startsWith('linked:')) {
    if (ascendLike) refuse(`publisher ${pub} is accepted only from github.com/${ascendLike[1]!.githubOwner}`);
    return null;
  }
  const g = parseGitSource(source);
  if (!g) return refuse('the git source is not canonical', { source: source.slice(0, 200) });
  if (g.host === 'github.com') {
    if (g.owner !== pub) refuse(`publisher ${pub} does not match the github.com owner ${g.owner}`, { owner: g.owner });
    if (ascendLike && (pub !== ascendLike[0] || g.owner !== ascendLike[1]!.githubOwner)) refuse(`publisher ${pub} looks like the founder brand ${ascendLike[0]}`);
    const bound = grants.publishers.get(pub);
    // Aegis S0b M4: a github.com binding for this owner is the same identity; any other binding needs a re-bind,
    // which records grant.publisher{github.com, <owner>} so the binding table follows the move back to GitHub
    const here = bound !== undefined && bound.host === 'github.com' && bound.namespace === pub;
    if (bound && !here && !opts.rebind) refuse(`publisher ${pub} is bound to ${bound.host}/${bound.namespace}; re-bind it through a full card`, { boundHost: bound.host });
    return bound && !here ? { host: 'github.com', namespace: pub, rebind: true, from: { host: bound.host, namespace: bound.namespace } } : null;
  }
  if (ascendLike) refuse(`publisher ${pub} is accepted only from github.com/${ascendLike[1]!.githubOwner}`);
  const bound = grants.publishers.get(pub);
  // a github.com owner binds implicitly: another host claiming an installed github publisher needs a re-bind too
  // Aegis S0b L3: only the EFFECTIVE pin of each id of this publisher counts, never every historical row
  const githubClaim = [...new Set(grants.installs.map((r) => r.name))].some((id) => id.startsWith(`${pub}.`) && parseGitSource(effectiveInstall(grants, id)?.source ?? '')?.host === 'github.com');
  const same = bound !== undefined && bound.host === g.host && bound.namespace === g.namespace;
  if (!same && (bound !== undefined || githubClaim) && !opts.rebind) refuse(`publisher ${pub} is bound to ${bound ? `${bound.host}/${bound.namespace}` : 'github.com'}; re-bind it through a full card`, { host: g.host, namespace: g.namespace });
  return same ? null : { host: g.host, namespace: g.namespace, rebind: bound !== undefined || githubClaim, from: bound ? { host: bound.host, namespace: bound.namespace } : githubClaim ? 'github.com' : null };
}

/** S0b §2: the mod's derived MCP server name against installed mods and the user's .mcp.json (COLLISION). */
export function checkServerCollision(home: string, manifest: ManifestV2, grants: ResolvedGrants, userMcpServers: readonly string[] = []): string | undefined {
  if (!manifest.provides?.mcp?.length) return undefined;
  const id = `${manifest.publisher}.${manifest.name}`;
  const server = mcpServerName(id);
  if (userMcpServers.includes(server)) throw new ManifestRefusal('COLLISION', `MCP server name ${server} is already in your .mcp.json`, { name: id, server });
  for (const other of new Set(grants.installs.map((r) => r.name))) {
    if (other === id || !effectiveInstall(grants, other)) continue;
    // only mods that declare a server occupy a name; the derived name is a function of the id
    const row = effectiveInstall(grants, other)!;
    const m = pinnedManifest(home, row);
    if (m?.provides?.mcp?.length && isModId(other) && mcpServerName(other) === server) throw new ManifestRefusal('COLLISION', `MCP server name ${server} is already used by ${other}`, { name: id, server, other });
  }
  return server;
}

/** S0b §3: the version class of staged bytes against the approved history of this id. */
function classify(grants: ResolvedGrants, id: string, current: GrantInstallRow | undefined, prev: ReadManifestResult | null, next: ReadManifestResult, packageHash: string): VersionClass {
  // only a mod with no effective pin is a first install; a pin whose manifest cannot be re-read is never `first`
  if (!current) return 'first';
  const c = prev ? compareVersions(next.manifest.version, prev.manifest.version) : null;
  if (c !== null && c < 0) return 'downgrade';
  // Aegis S0b M3: bytes approved EARLIER that are not the current pin are a revert (e.g. after a rollback, or
  // re-approving an old snapshot under a bumped version), shown with the prominent DOWNGRADE line
  const earlier = grants.installs.some((r) => r.name === id && r.packageHash === packageHash && r.packageHash !== current.packageHash);
  if (earlier) return 'revert';
  if (c !== null && c > 0) return 'update';
  if (!prev) return 'same-version-new-bytes';
  return prev.format !== next.format ? 'format-only' : 'same-version-new-bytes';
}

/** The index-3 card line (S0b §3). A downgrade is always prominent, even to a previously approved version. */
function versionLine(d: InstallCardDetail): string {
  switch (d.versionClass) {
    case 'first':
      return `version: first install of ${d.name} ${d.version}`;
    case 'update':
      return `version: update ${d.prevVersion} → ${d.version}`;
    case 'downgrade':
      return `DOWNGRADE: ${d.prevVersion} → ${d.version} (older version; check why)`;
    case 'revert':
      return `DOWNGRADE: revert to previously approved bytes, ${d.prevVersion ?? 'unknown'} → ${d.version} (check why)`;
    case 'format-only':
      return `version: ${d.version} unchanged, manifest format ${d.format === 1 ? 1 : 2} (format-only change)`;
    default:
      return `version: ${d.version} unchanged, NEW BYTES under the same version`;
  }
}

function sha(s: string): string {
  return `sha256:${createHash('sha256').update(s, 'utf8').digest('hex')}`;
}

type Surface = Pick<InstallCardDetail, 'effects' | 'egress' | 'capabilities' | 'events' | 'tools' | 'views' | 'commands' | 'keybindings' | 'knowledge' | 'mcp' | 'hooks' | 'offers' | 'opaque'>;
function surfaceOf(m: ManifestV2): Surface {
  const p = m.provides ?? {};
  const eg = m.requires?.egress;
  const opaque: Record<string, number> = {};
  for (const k of ['skills', 'agents', 'bands', 'steps', 'resolvers', 'blocks', 'oracles'] as const) if (p[k]?.length) opaque[k] = p[k]!.length;
  return {
    commands: (p.commands ?? []).map((c) => c.id).sort(),
    keybindings: (p.keybindings ?? []).map((k) => `${k.key}→${k.command}`).sort(),
    knowledge: (p.knowledge ?? []).map((k) => `${k.name} ${k.scheme} ${k.query} ≤${k.maxTier}`).sort(),
    mcp: (p.mcp ?? []).map((s) => `${mcpServerName(`${m.publisher}.${m.name}`)}: ${[s.command, ...(s.args ?? [])].join(' ')}${mcpConfigSuffix(s.config)}`).sort(),
    ...(p.offers?.length ? { offers: p.offers.map((o) => `${o.kind} (${o.phase}) → ${o.handoffTool}: ${o.title} · takes: ${o.contextIn.join(', ') || 'nothing'}`).sort() } : {}),
    hooks: (p.hooks ?? []).map((h) => `${h.event}: ${h.command}`).sort(),
    opaque,
    effects: [...new Set((p.tools ?? []).flatMap((t) => t.effects))].sort(),
    egress: Array.isArray(eg) ? eg.map((e) => e.host).sort() : [],
    capabilities: [...(m.requires?.capabilities ?? [])].sort(),
    events: [...(p.events ?? [])].sort(),
    tools: (p.tools ?? []).map((t) => t.name).sort(),
    views: (p.views ?? []).map((v) => `${v.id}@${v.slot}`).sort(),
  };
}

/** What a user may override on an mcp server's launch, shown on its card line (absent config: nothing). */
function mcpConfigSuffix(c: ManifestMcpConfig | undefined): string {
  if (!c) return '';
  const parts = [...(c.command ? ['command'] : []), ...(c.args ? ['args'] : []), ...(c.env?.length ? [`env ${c.env.join(', ')}`] : [])];
  // Aegis S1 M2: say where env values go (the session's mcp.json, which the session can read)
  return parts.length ? ` · user may set: ${parts.join('; ')}${c.env?.length ? " · env values are written to this session's mcp.json and readable by the session" : ''}` : '';
}

/** Middle-truncate by code points for DISPLAY only (the detail, inside contentHash, keeps the full value). */
function midTrunc(s: string, max: number): string {
  const cps = Array.from(s);
  if (cps.length <= max) return s;
  const head = Math.ceil((max - 1) / 2);
  return `${cps.slice(0, head).join('')}…${cps.slice(cps.length - (max - 1 - head)).join('')}`;
}

/**
 * The header line, always ONE display line (Aegis round 3): the version and the
 * linked source path are middle-truncated for display so the header never
 * wraps and the kernel-composed count line stays at index 2.
 */
function headerLine(d: InstallCardDetail): string {
  const verb = !d.replaces ? 'Install' : d.versionClass === 'update' ? 'Update' : d.versionClass === 'downgrade' || d.versionClass === 'revert' ? 'Downgrade' : 'Re-approve';
  const compose = (src: string) => `${verb} mod ${d.name} ${midTrunc(d.version, 64)} (${d.kind}) by ${d.publisherDisplay} from ${src}, tier ${d.tier}`;
  const budget = Math.max(16, MAX_LINE - Array.from(compose('')).length);
  return compose(midTrunc(d.source, budget));
}

/** The prefix of a wrapped line's continuation. */
export const INSTALL_CONTINUATION = '  ↳ ';

/**
 * One logical card line as display lines that are NEVER cut (T-2026-10-18-015
 * item 2): the text is sanitized here (§4.5, the same published sanitizer the
 * broker applies; it is idempotent on its own output, so the broker's pass
 * changes nothing) and its flags are collected, then it is wrapped by code
 * points into lines of at most MAX_LINE (card.ts), continuations prefixed
 * `  ↳ `. A wrap never puts a variation selector at the start of a line (a
 * re-sanitize would strip it there). No cap on the number of lines: the card
 * is bounded by the same manifest the full detail (inside contentHash)
 * already carries, so nothing on an install card is hidden by truncation.
 */
function wrapLine(text: string, flags: Set<CardFlag>): string[] {
  const s = sanitizeDisplayText(text);
  for (const f of s.flags) flags.add(f);
  const cps = Array.from(s.text);
  if (cps.length <= MAX_LINE) return [s.text];
  const isVs = (ch: string | undefined): boolean => ch !== undefined && ch.codePointAt(0)! >= 0xfe00 && ch.codePointAt(0)! <= 0xfe0f;
  const out: string[] = [];
  const contLen = Array.from(INSTALL_CONTINUATION).length;
  let i = 0;
  while (i < cps.length) {
    const room = out.length === 0 ? MAX_LINE : MAX_LINE - contLen;
    let end = Math.min(cps.length, i + room);
    while (end < cps.length && end > i + 1 && isVs(cps[end])) end--;
    out.push(`${out.length === 0 ? '' : INSTALL_CONTINUATION}${cps.slice(i, end).join('')}`);
    i = end;
  }
  return out;
}

/** The install-card rendering for any kernel card (P8-D94 repo hooks): each logical line sanitized and wrapped, never cut. */
export function wrappedBlock(logical: readonly string[]): { block: Record<string, unknown>; flags: CardFlag[] } {
  const flags = new Set<CardFlag>();
  const children = logical.flatMap((l) => wrapLine(l, flags)).map((text) => ({ type: 'Text', text }));
  return { block: { schemaVersion: 'display-block:v1', type: 'Box', children }, flags: [...flags].sort() };
}

/**
 * The install card's display block and the sanitizer flags of every line. mcp
 * servers and hooks run commands, so each entry is its OWN line (`mcp: …`,
 * `hooks: …`): a long mcp argument list can no longer push a hook past a
 * line cap (T-2026-10-18-015 item 2).
 */
export function blockFor(d: InstallCardDetail): { block: Record<string, unknown>; flags: CardFlag[] } {
  const flags = new Set<CardFlag>();
  const head = [
    headerLine(d),
    `packageHash ${d.packageHash}`,
    // kernel-composed, before any manifest-controlled line (Aegis round 2 C2): the count cannot be pushed off-screen
    `runs commands: ${d.mcp.length} mcp server(s), ${d.hooks.length} hook(s)`,
    // S0b: index 3, kernel-composed: what these bytes are against the approved history
    versionLine(d),
    ...(d.sourceChangedFrom ? [`SOURCE CHANGED: ${d.sourceChangedFrom} → ${d.source}`] : []),
    ...(d.rebind
      ? [d.rebind.from === null || d.rebind.from === undefined
          ? `publisher ${d.publisher}: first binding to ${d.rebind.host}/${d.rebind.namespace}`
          : `PUBLISHER RE-BIND from ${d.rebind.from === 'github.com' ? 'github.com' : `${d.rebind.from.host}/${d.rebind.from.namespace}`}: ${d.publisher} → ${d.rebind.host}/${d.rebind.namespace}`]
      : []),
    ...(d.looksLike ? [`publisher ${d.publisher} looks like ${d.looksLike} (installed)`] : []),
  ];
  // S0b §3: a short card only when nothing widens and the source did not change (a downgrade line stays at index 3)
  if (d.replaces && !d.widened.length && !d.sourceChangedFrom && !d.rebind) {
    const short = [...head, `nothing widens · files: +${d.files.added.length} ~${d.files.changed.length} -${d.files.removed.length}`];
    const children = short.flatMap((l) => wrapLine(l, flags)).map((text) => ({ type: 'Text', text }));
    return { block: { schemaVersion: 'display-block:v1', type: 'Box', children }, flags: [...flags].sort() };
  }
  const logical = [
    ...head,
    ...(d.serverName ? [`mcp server name: ${d.serverName}`] : []),
    `effects: ${d.effects.join(', ') || 'none'} · egress: ${d.egress.join(', ') || 'none'}`,
    `capabilities: ${d.capabilities.join(', ') || 'none'} · read paths: ${d.readPaths.join(', ') || 'none'}`,
    `events: ${d.events.join(', ') || 'none'} · tools: ${d.tools.join(', ') || 'none'} · views: ${d.views.join(', ') || 'none'}`,
    `commands: ${d.commands.join(', ') || 'none'} · keybindings: ${d.keybindings.join(', ') || 'none'} · knowledge: ${d.knowledge.join(', ') || 'none'}`,
    ...(d.mcp.length ? d.mcp.map((m) => `mcp: ${m}`) : ['mcp: none']),
    ...(d.hooks.length ? d.hooks.map((h) => `hooks: ${h}`) : ['hooks: none']),
    ...(d.offers?.length ? d.offers.map((o) => `offer: ${o}`) : []),
    ...(Object.keys(d.opaque).length ? [`also ships: ${Object.entries(d.opaque).map(([k, n]) => `${k} ×${n}`).join(', ')}`] : []),
    ...(d.packages.length ? [`packages: ${d.packages.join(', ')}`] : []),
    ...(d.widened.length && d.replaces ? [`WIDENED: ${d.widened.map((w) => `${w.field} +${w.added.join(' +')}`).join('; ')}`] : []),
    ...(d.replaces ? [`files: +${d.files.added.length} ~${d.files.changed.length} -${d.files.removed.length}`] : []),
  ];
  const children = logical.flatMap((l) => wrapLine(l, flags)).map((text) => ({ type: 'Text', text }));
  return { block: { schemaVersion: 'display-block:v1', type: 'Box', children }, flags: [...flags].sort() };
}

function stagedPath(home: string, name: string, cardId: string): string {
  // a mod id contains '.', never a URL or ':' (Windows-safe directory name)
  return path.join(modDir(home, name), 'staged', `${cardId.replace(':', '-')}.json`);
}

function writeStaged(home: string, rec: StagedRecord): void {
  const p = stagedPath(home, rec.detail.name, rec.card.cardId);
  fs.mkdirSync(path.dirname(p), { recursive: true, mode: 0o700 });
  fs.writeFileSync(p, `${JSON.stringify(rec)}\n`, { mode: 0o600 });
}

export function readStaged(home: string, name: string, cardId: string): StagedRecord | null {
  if (!CARD_ID.test(cardId) || !isModId(name)) return null;
  try {
    const r = JSON.parse(fs.readFileSync(stagedPath(home, name, cardId), 'utf8')) as StagedRecord;
    return r.schemaVersion === STAGED_RECORD_SCHEMA ? r : null;
  } catch {
    return null;
  }
}

/** A still-pending card for the same snapshot (a re-stage never raises a second card). */
function pendingFor(home: string, name: string, packageHash: string, mh: string, source: InstallSource): StagedRecord | null {
  const dir = path.join(modDir(home, name), 'staged');
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir).sort();
  } catch {
    return null;
  }
  for (const n of names) {
    try {
      const r = JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8')) as StagedRecord;
      if (r.schemaVersion === STAGED_RECORD_SCHEMA && r.card.state === 'pending' && r.detail.packageHash === packageHash && r.detail.manifestHash === mh && r.detail.source === source) return r;
    } catch {
      /* unreadable staged record: ignored, never decided */
    }
  }
  return null;
}

/** Read the manifest stored inside a pinned snapshot. */
function pinnedManifest(home: string, row: GrantInstallRow): ManifestV2 | null {
  return pinnedRead(home, row, undefined)?.manifest ?? null;
}

/** Read a pin's manifest (format 1 through the alias publisher of its row), or null. */
function pinnedRead(home: string, row: GrantInstallRow, tier: TrustTier | undefined): ReadManifestResult | null {
  try {
    const bytes = fs.readFileSync(path.join(pinnedDir(home, pinDirKey(row), row.packageHash), MANIFEST_FILE));
    const pub = parseModId(row.name)?.publisher;
    return readManifest(bytes, { tier: tier ?? (pub === 'gnomon' ? 'first-party' : 'local'), ...(row.legacyName ? { legacyPublisher: pub === 'gnomon' ? 'gnomon' : 'local' } : {}) });
  } catch {
    return null;
  }
}

/** Stage an install (package), a link (folder) or a fetched git checkout. Raises a pending card; takes no effect. */
export function stageInstall(opts: StageOptions): StageResult {
  const emit = opts.emit ?? noEvents;
  const now = opts.now ?? new Date();
  // format 1 is staged only for a historical first-party pin (its id is then gnomon.<name>); the hash decides
  const raw0 = rawManifestOf(opts.source);
  let legacyPublisher: 'gnomon' | 'local' | undefined = opts.recard?.legacyPublisher;
  if (!legacyPublisher && raw0?.manifest === 1 && typeof raw0.name === 'string') {
    let h = '';
    try {
      h = hashSourceTree(opts.source, `local.${raw0.name}`, noEvents).packageHash;
    } catch {
      h = '';
    }
    if (HISTORICAL_FIRST_PARTY_PINS.has(h) && opts.via !== 'linked') legacyPublisher = 'gnomon';
  }
  const name0 = sourceName(opts.source, legacyPublisher);
  // a linked source path reaches the card header: refuse line separators, format and control characters (Aegis round 3)
  if (opts.via === 'linked') {
    let real = '';
    try {
      real = fs.realpathSync.native(opts.source);
    } catch {
      real = '';
    }
    if (COMMAND_UNSAFE.test(real)) {
      emit('manifest.refuse', { name: name0, code: 'SCHEMA', field: 'source' });
      throw new ManifestRefusal('SCHEMA', 'the linked folder path contains a line separator, format or control character', { name: name0, field: 'source' });
    }
  }
  let source: InstallSource;
  if (opts.via === 'git') {
    // TODO(S4, Aegis S0b L4): this is the git fetch seam; the S4 fetcher must pass http.followRedirects=false (spec §3)
    try {
      source = gitSourceString(opts.git?.url ?? '', opts.git?.commit ?? '') as InstallSource;
    } catch (err) {
      emit('manifest.refuse', { name: name0, code: 'SCHEMA', field: 'source' });
      throw new ManifestRefusal('SCHEMA', `git source: ${(err as Error).message}`, { name: name0, field: 'source' });
    }
  } else source = opts.via === 'package' ? 'package' : `linked:${fs.realpathSync.native(opts.source)}`;
  const snap = snapshotFolder(opts.home, opts.source, name0, emit);
  let read: ReadManifestResult;
  let tier: TrustTier;
  const grants = readGrants(opts.home, opts.trust);
  let binding: ReturnType<typeof checkPublisherSource> = null;
  let serverName: string | undefined;
  try {
    tier = opts.via === 'linked' && !opts.signature ? 'local' : deriveTier(snap.packageHash, opts.signature);
    const bytes = readManifestBytes(snap.dir, name0, emit);
    try {
      read = readManifest(bytes, { tier, ...(legacyPublisher ? { legacyPublisher } : {}) });
      const id = `${read.manifest.publisher}.${read.manifest.name}`;
      if (id !== name0) throw new ManifestRefusal('SCHEMA', `manifest id ${id} changed during the copy`, { name: id });
      binding = checkPublisherSource(read.manifest, source, grants, { rebind: opts.rebindPublisher === true, tier });
      serverName = checkServerCollision(opts.home, read.manifest, grants, opts.userMcpServers);
    } catch (err) {
      if (err instanceof ManifestRefusal) emit('manifest.refuse', { name: name0, code: err.manifestCode, ...err.detail });
      throw err;
    }
  } catch (err) {
    // a snapshot of a refused manifest is never kept
    if (snap.created) removeTree(snap.dir);
    throw err;
  }
  const manifest = read.manifest;
  const name = name0;
  const mh = read.manifestHash;
  const current = effectiveInstall(grants, name);
  if (!opts.recard && current && current.packageHash === snap.packageHash && current.manifestHash === mh && current.source === source) return { state: 'unchanged', packageHash: snap.packageHash };
  const pending = pendingFor(opts.home, name, snap.packageHash, mh, source);
  if (pending) return { state: 'staged', cardId: pending.card.cardId, record: pending };
  const prevRead = current ? pinnedRead(opts.home, current, grants.trust.get(current.manifestHash)) : null;
  const prevManifest = prevRead?.manifest ?? null;
  const prevFiles: TreeFile[] = current ? hashPinnedTree(pinnedDir(opts.home, pinDirKey(current), current.packageHash)) : [];
  const widened = detectWidening(prevManifest, manifest);
  // a third-party publisher that is a skeleton match of another installed third-party publisher (S0b §1)
  const others = [...new Set(grants.installs.map((r) => parseModId(r.name)?.publisher).filter((p): p is string => !!p && p !== 'gnomon' && p !== 'local' && p !== manifest.publisher))];
  const looksLike = manifest.publisher === 'gnomon' ? undefined : others.find((o) => modSkeleton(o) === modSkeleton(manifest.publisher));
  const sourceChangedFrom = current && sourceIdentity(current.source) !== sourceIdentity(source) ? current.source : undefined;
  const detail: InstallCardDetail = {
    name,
    publisher: manifest.publisher,
    publisherDisplay: publisherDisplay(manifest.publisher, source),
    format: read.format,
    ...(read.upgradedHash ? { upgradedHash: read.upgradedHash } : {}),
    versionClass: classify(grants, name, current, prevRead, read, snap.packageHash),
    ...(prevManifest ? { prevVersion: prevManifest.version } : {}),
    ...(sourceChangedFrom ? { sourceChangedFrom } : {}),
    ...(looksLike ? { looksLike } : {}),
    ...(serverName ? { serverName } : {}),
    ...(binding ? { rebind: { host: binding.host, namespace: binding.namespace, from: binding.from } } : {}),
    kind: manifest.kind,
    version: manifest.version,
    source,
    tier,
    manifestHash: mh,
    packageHash: snap.packageHash,
    ...surfaceOf(manifest),
    readPaths: [...(opts.readPaths ?? [])].sort(),
    packages: snap.packages,
    replaces: current ? { packageHash: current.packageHash, manifestHash: current.manifestHash } : null,
    widened,
    files: diffTrees(prevFiles, snap.files),
    stagedBy: opts.requestedBy,
    ...(opts.hsid ? { hsid: opts.hsid } : {}),
  };
  const shown = blockFor(detail);
  const card: CardV1 = {
    schemaVersion: 'card:v1',
    cardId: mintId('card'),
    kind: 'install',
    requestedBy: opts.requestedBy,
    ...(opts.hsid ? { hsid: opts.hsid } : {}),
    attended: opts.attended ?? false,
    approverPolicy: { kind: 'self' },
    block: shown.block,
    contentHash: sha(canonicalJson(detail)),
    ...(shown.flags.length ? { flags: shown.flags } : {}),
    actions: [], // kernel-signed actions are the broker's (M1.6)
    state: 'pending',
  };
  const errors = validateCardV1(card, { mode: 'strict' });
  if (errors.length) throw new ManifestRefusal('SCHEMA', `install card does not validate: ${errors.join('; ')}`, { name });
  const record: StagedRecord = { schemaVersion: STAGED_RECORD_SCHEMA, card, detail, manifest };
  writeStaged(opts.home, record);
  if (current && widened.length) emit('manifest.widened', { name, fields: widened.map((w) => w.field) });
  emit('manifest.staged', { name, cardId: card.cardId, manifestHash: mh, packageHash: snap.packageHash, source, by: opts.requestedBy, ...(opts.hsid ? { hsid: opts.hsid } : {}), at: now.toISOString() });
  return { state: 'staged', cardId: card.cardId, record };
}

/** Re-read a staged/pinned snapshot's manifest under the tier its source derives (format 1 only for a historical pin). */
function snapshotRead(home: string, name: string, packageHash: string, source: string): { read: ReadManifestResult; tier: TrustTier } {
  const tier: TrustTier = source.startsWith('linked:') ? 'local' : deriveTier(packageHash);
  const bytes = fs.readFileSync(path.join(pinnedDir(home, name, packageHash), MANIFEST_FILE));
  const legacy = tier === 'first-party' && HISTORICAL_FIRST_PARTY_PINS.has(packageHash) ? { legacyPublisher: 'gnomon' as const } : {};
  return { read: readManifest(bytes, { tier, ...legacy }), tier };
}

export interface DecideOptions {
  presenceToken: unknown;
  /** MCP server names in the user's .mcp.json (COLLISION, re-checked at decide) */
  userMcpServers?: readonly string[];
  authority: RootAuthority;
  emit?: ManifestEventSink;
  now?: Date;
}

/**
 * Decide a staged install card (M1.6's broker will own this; seam-only until
 * then). Nothing in the staged record is trusted (Aegis F5): the cardId is
 * checked, the card's contentHash is recomputed from the detail, and the
 * detail's security surface is RE-DERIVED from the pinned snapshot and
 * compared; the manifest is re-validated (egress, capabilities, tier).
 * grant.install is appended LAST, so a crash before it leaves supporting rows
 * that grant nothing on their own; a re-decide of a card whose grant.install
 * already exists completes idempotently without new rows.
 */
/** What a `mod.install` presence token is bound to (T-2026-10-18-008): the card and the hash of the detail it shows. */
export function installPresenceBinding(cardId: string, contentHash: string, decision: 'install' | 'deny'): Readonly<Record<string, string>> {
  return { action: 'mod.install', cardId, contentHash, decision };
}

/** What a `mod.rollback` presence token is bound to: the mod and the snapshot it re-pins (`(previous)` = the one before the current pin). */
export function rollbackPresenceBinding(name: string, toPackageHash: string | undefined): Readonly<Record<string, string>> {
  return { action: 'mod.rollback', name, toPackageHash: toPackageHash ?? '(previous)' };
}

/**
 * Re-derive an install card's detail from the PINNED SNAPSHOT (T-2026-10-18-008,
 * M1.6): the broker renders the card from this, never from the writable staged
 * file. Throws INTEGRITY when the staged detail's security surface differs
 * from what the snapshot derives, or when the snapshot no longer hashes to its
 * packageHash. Read-only.
 */
export function rederiveInstallDetail(home: string, name: string, cardId: string): { record: StagedRecord; detail: InstallCardDetail; lines: string[]; flags: CardFlag[]; detailHash: string } {
  if (typeof cardId !== 'string' || !CARD_ID.test(cardId)) throw new ManifestRefusal('SCHEMA', 'cardId must be card:<ULID>', { cardId: String(cardId) });
  if (!isModId(name)) throw new ManifestRefusal('SCHEMA', 'malformed mod id', { name: String(name) });
  const rec = readStaged(home, name, cardId);
  if (!rec || rec.card.cardId !== cardId || rec.detail.name !== name) throw new ManifestRefusal('NOT_INSTALLED', `no install card ${cardId} for ${name}`, { name, cardId });
  const dir = pinnedDir(home, name, rec.detail.packageHash);
  if (computePackageHash(fs.existsSync(dir) ? hashPinnedTree(dir) : []) !== rec.detail.packageHash) throw new ManifestRefusal('INTEGRITY', `pinned snapshot of ${name} no longer hashes to ${rec.detail.packageHash}`, { name });
  const { read, tier } = snapshotRead(home, name, rec.detail.packageHash, rec.detail.source);
  const manifest = read.manifest;
  const mh = read.manifestHash;
  const surf = surfaceOf(manifest);
  const id = `${manifest.publisher}.${manifest.name}`;
  const derived: InstallCardDetail = { ...rec.detail, ...surf, name: id, publisher: manifest.publisher, publisherDisplay: publisherDisplay(manifest.publisher, rec.detail.source), kind: manifest.kind, version: manifest.version, tier, manifestHash: mh };
  const claimed = canonicalJson({ mh: rec.detail.manifestHash, tier: rec.detail.tier, name: rec.detail.name, display: rec.detail.publisherDisplay, ...pick(rec.detail) });
  if (claimed !== canonicalJson({ mh, tier, name: id, display: derived.publisherDisplay, ...pick(derived) })) throw new ManifestRefusal('INTEGRITY', `install card ${cardId} does not match its pinned snapshot`, { name, cardId });
  // Aegis C4: readPaths and source are not trusted from the staged file either
  if (derived.readPaths.length && !derived.capabilities.includes('knowledge:provide')) throw new ManifestRefusal('INTEGRITY', `install card ${cardId}: read paths without knowledge:provide`, { name, cardId });
  for (const p of derived.readPaths) {
    if (typeof p !== 'string' || !path.isAbsolute(p) || path.normalize(p) !== p || p.split(/[\\/]/).includes('..')) throw new ManifestRefusal('INTEGRITY', `install card ${cardId}: read path ${String(p).slice(0, 80)} is not an absolute normalized path`, { name, cardId });
  }
  if (derived.source.startsWith('git:')) {
    if (!parseGitSource(derived.source)) throw new ManifestRefusal('INTEGRITY', `install card ${cardId}: the git source is not canonical`, { name, cardId });
  } else if (derived.source !== 'package') {
    const src = derived.source.startsWith('linked:') ? derived.source.slice(7) : '';
    if (COMMAND_UNSAFE.test(src)) throw new ManifestRefusal('INTEGRITY', `install card ${cardId}: the linked source path contains a line separator, format or control character`, { name, cardId });
    let linkedHash: string | null = null;
    try {
      linkedHash = src && path.isAbsolute(src) ? hashSourceTree(src, name, noEvents).packageHash : null;
    } catch {
      linkedHash = null;
    }
    if (linkedHash !== derived.packageHash) throw new ManifestRefusal('INTEGRITY', `install card ${cardId}: the linked source no longer hashes to the snapshot`, { name, cardId });
  }
  const shown = blockFor(derived);
  const children = (shown.block as { children: Array<{ text: string }> }).children;
  // Aegis C4: requestedBy / hsid / attended come from the writable staged file: shown as CLAIMS, after the kernel-composed lines
  const claim = wrappedBlock([`claimed by the staged record (unverified): requested by ${rec.card.requestedBy} · session ${rec.card.hsid ?? 'none'} · attended ${rec.card.attended ? 'yes' : 'no'}`]);
  const lines = [...children.map((c) => c.text), ...(claim.block as { children: Array<{ text: string }> }).children.map((c) => c.text)];
  const flags = [...new Set([...shown.flags, ...claim.flags])].sort();
  return { record: rec, detail: derived, lines, flags, detailHash: sha(canonicalJson(derived)) };
}

/**
 * The install-card decision. Production reaches it ONLY through
 * #approval-broker (broker/install-card.ts, M1.6), which supplies a presence
 * token BOUND to `{cardId, contentHash}` of the detail it rendered; tests
 * reach it through the internal test entry.
 */
export function decideInstall(home: string, name: string, cardId: string, decision: 'install' | 'deny', opts: DecideOptions): StagedRecord {
  const emit = opts.emit ?? noEvents;
  const now = opts.now ?? new Date();
  if (typeof cardId !== 'string' || !CARD_ID.test(cardId)) throw new ManifestRefusal('SCHEMA', 'cardId must be card:<ULID>', { cardId: String(cardId) });
  if (!isModId(name)) throw new ManifestRefusal('SCHEMA', 'malformed mod id', { name: String(name) });
  const rec = readStaged(home, name, cardId);
  if (!rec || rec.card.cardId !== cardId || rec.detail.name !== name) throw new ManifestRefusal('NOT_INSTALLED', `no install card ${cardId} for ${name}`, { name, cardId });
  if (sha(canonicalJson(rec.detail)) !== rec.card.contentHash) throw new ManifestRefusal('INTEGRITY', `install card ${cardId}: contentHash does not match its detail`, { name, cardId });
  // bound presence (T-2026-10-18-008): the token names this card and the hash of THIS detail; trusted clock
  const verdict = consumeBoundPresence(opts.presenceToken, 'mod.install', installPresenceBinding(cardId, rec.card.contentHash, decision));
  if (verdict !== 'ok') throw new ManifestRefusal('GRANT', `install decision needs fresh presence (${verdict})`, { name, cardId, presence: verdict });
  const already = readGrants(home, opts.authority).installs.find((r) => r.cardId === cardId && r.packageHash === rec.detail.packageHash);
  if (rec.card.state !== 'pending') {
    if (rec.decision?.decision === decision) return rec; // idempotent re-decide
    throw new ManifestRefusal('NOT_INSTALLED', `install card ${cardId} is already decided`, { name, cardId });
  }
  if (decision === 'install' && !already) {
    const dir = pinnedDir(home, name, rec.detail.packageHash);
    if (computePackageHash(fs.existsSync(dir) ? hashPinnedTree(dir) : []) !== rec.detail.packageHash) throw new ManifestRefusal('INTEGRITY', `pinned snapshot of ${name} no longer hashes to ${rec.detail.packageHash}`, { name });
    const { read, tier } = snapshotRead(home, name, rec.detail.packageHash, rec.detail.source);
    const manifest = read.manifest;
    const mh = read.manifestHash;
    const surf = surfaceOf(manifest);
    const claimed = canonicalJson({ mh: rec.detail.manifestHash, tier: rec.detail.tier, name: rec.detail.name, up: rec.detail.upgradedHash ?? null, ...pick(rec.detail) });
    const derived = canonicalJson({ mh, tier, name: `${manifest.publisher}.${manifest.name}`, up: read.upgradedHash ?? null, ...pick({ ...rec.detail, ...surf }) });
    if (claimed !== derived) throw new ManifestRefusal('INTEGRITY', `install card ${cardId} does not match its pinned snapshot`, { name, cardId });
    const { packageHash, source, readPaths } = rec.detail;
    // the publisher and the server name are re-checked against the grant table as it is NOW (S0b)
    const g = readGrants(home, opts.authority);
    const bind = checkPublisherSource(manifest, source, g, { rebind: rec.detail.rebind !== undefined, tier });
    // Aegis S0b M2 (TOFU race): the binding must still be what the card showed it replacing; a binding that appeared
    // (or changed) since stage, or one the card never showed, refuses PUBLISHER and the install must be re-staged
    if (bind) {
      const shown = rec.detail.rebind;
      if (!shown || shown.host !== bind.host || shown.namespace !== bind.namespace || canonicalJson(shown.from ?? null) !== canonicalJson(bind.from)) {
        throw new ManifestRefusal('PUBLISHER', `publisher ${manifest.publisher}: the binding changed since this card was staged; stage it again`, { name, cardId, publisher: manifest.publisher });
      }
    }
    checkServerCollision(home, manifest, g, opts.userMcpServers);
    appendGrantRow(home, opts.authority, { kind: 'grant.trust', manifestHash: mh, tier }, now);
    if (surf.capabilities.length) {
      appendGrantRow(home, opts.authority, { kind: 'grant.capability', manifestHash: mh, capabilities: surf.capabilities, ...(readPaths.length ? { read: readPaths } : {}) }, now);
    }
    if (surf.egress.length) appendGrantRow(home, opts.authority, { kind: 'grant.egress', manifestHash: mh, hosts: surf.egress }, now);
    if (bind) appendGrantRow(home, opts.authority, { kind: 'grant.publisher', publisher: manifest.publisher, host: bind.host, namespace: bind.namespace }, now);
    appendGrantRow(home, opts.authority, { kind: 'grant.install', name, manifestHash: mh, packageHash, cardId, source, ...(read.upgradedHash ? { upgradedHash: read.upgradedHash } : {}) }, now); // LAST
    emit('manifest.installed', { name, manifestHash: mh, packageHash, cardId, source });
    emit('mod.installed', { name, packageHash, ...(rec.detail.replaces ? { replaces: rec.detail.replaces.packageHash } : {}) });
    if (source.startsWith('linked:') && !rec.detail.replaces) emit('mod.linked', { name, path: source.slice(7), packageHash });
  }
  const decided: StagedRecord = { ...rec, card: { ...rec.card, state: 'decided' }, decision: { decision, at: now.toISOString() } };
  writeStaged(home, decided);
  return decided;
}

/** The security-relevant detail fields re-derived on decide. */
function pick(d: Surface & { packageHash: string }): Record<string, unknown> {
  return { packageHash: d.packageHash, effects: d.effects, egress: d.egress, capabilities: d.capabilities, events: d.events, tools: d.tools, views: d.views, commands: d.commands, keybindings: d.keybindings, knowledge: d.knowledge, mcp: d.mcp, hooks: d.hooks, opaque: d.opaque, ...(d.offers?.length ? { offers: d.offers } : {}) };
}

/**
 * Human-only rollback: re-pin a previous APPROVED snapshot (an earlier
 * grant.install row for the mod), never an unapproved one; keeps the link.
 */
export function rollbackMod(home: string, name: string, toPackageHash: string | undefined, opts: DecideOptions): GrantInstallRow {
  const emit = opts.emit ?? noEvents;
  const now = opts.now ?? new Date();
  if (!isModId(name)) throw new ManifestRefusal('SCHEMA', 'malformed mod id', { name: String(name) });
  const verdict = consumeBoundPresence(opts.presenceToken, 'mod.rollback', rollbackPresenceBinding(name, toPackageHash));
  if (verdict !== 'ok') throw new ManifestRefusal('GRANT', `rollback needs fresh presence (${verdict})`, { name, presence: verdict });
  const grants = readGrants(home, opts.authority);
  const rows = grants.installs.filter((r) => r.name === name);
  const current = rows[rows.length - 1];
  if (!current) throw new ManifestRefusal('NOT_INSTALLED', `${name} is not installed`, { name });
  const target = toPackageHash
    ? [...rows].reverse().find((r) => r.packageHash === toPackageHash)
    : [...rows].reverse().find((r) => r.packageHash !== current.packageHash);
  if (!target) throw new ManifestRefusal('NOT_INSTALLED', `no previously approved snapshot ${toPackageHash ?? '(previous)'} for ${name}`, { name, toPackageHash });
  const files = hashPinnedTree(pinnedDir(home, pinDirKey(target), target.packageHash));
  if (computePackageHash(files) !== target.packageHash) throw new ManifestRefusal('INTEGRITY', `snapshot ${target.packageHash} of ${name} is damaged`, { name });
  // a rollback to a legacy (format-1) pin keeps it as a v1 row would resolve; S0b rows carry the full id
  if (target.legacyName) throw new ManifestRefusal('FORMAT', `${name}: a format-1 snapshot is not re-pinned by rollback (re-install it)`, { name });
  const row = appendGrantRow(home, opts.authority, { kind: 'grant.install', name, manifestHash: target.manifestHash, packageHash: target.packageHash, cardId: target.cardId, source: current.source, ...(target.upgradedHash ? { upgradedHash: target.upgradedHash } : {}) }, now) as GrantInstallRow;
  emit('mod.rolled-back', { name, toPackageHash: target.packageHash });
  return row;
}

export type LoadResult =
  | { state: 'ready'; name: string; snapshotDir: string; manifest: ManifestV2; packageHash: string; manifestHash: string; tier: TrustTier | undefined; readPaths: string[]; source: InstallSource }
  | { state: 'paused'; name: string; reason: 'changed'; cardId: string | null; files: TreeDiff; snapshotDir: string };

export interface LoadOptions {
  home: string;
  name: string;
  trust: RowVerifier;
  emit?: ManifestEventSink;
  /** principal recorded on a re-approve card raised by a linked-folder change (the kernel) */
  kernelPrincipal?: string;
  /** MCP server names in the user's .mcp.json (COLLISION, re-checked at load) */
  userMcpServers?: readonly string[];
}

/** Resolve what may load for a mod: from the pinned snapshot only, under its grants. */
export function loadMod(opts: LoadOptions): LoadResult {
  const emit = opts.emit ?? noEvents;
  const grants = readGrants(opts.home, opts.trust);
  const row = effectiveInstall(grants, opts.name);
  if (!row) {
    emit('manifest.refuse', { name: opts.name, code: 'NOT_INSTALLED' });
    throw new ManifestRefusal('NOT_INSTALLED', `${opts.name} has no root-signed grant.install (a staged card takes no effect until decided)`, { name: opts.name });
  }
  const dir = pinnedDir(opts.home, pinDirKey(row), row.packageHash);
  const files = fs.existsSync(dir) ? hashPinnedTree(dir) : [];
  if (computePackageHash(files) !== row.packageHash) {
    emit('manifest.refuse', { name: row.name, code: 'INTEGRITY', packageHash: row.packageHash });
    throw new ManifestRefusal('INTEGRITY', `pinned snapshot of ${row.name} does not hash to ${row.packageHash}`, { name: row.name });
  }
  const tier = grants.trust.get(row.manifestHash);
  const pub = parseModId(row.name)?.publisher;
  let read: ReadManifestResult;
  try {
    // format 1 loads ONLY for a resolved legacy row, under its alias publisher (S0b §4)
    read = readManifest(fs.readFileSync(path.join(dir, MANIFEST_FILE)), { tier: tier ?? 'local', ...(row.legacyName ? { legacyPublisher: pub === 'gnomon' ? 'gnomon' : 'local' } : {}) });
    if (`${read.manifest.publisher}.${read.manifest.name}` !== row.name) throw new ManifestRefusal('INTEGRITY', `${row.name}: the pinned manifest names another mod`, { name: row.name });
    checkPublisherSource(read.manifest, row.source, grants, { tier });
    checkServerCollision(opts.home, read.manifest, grants, opts.userMcpServers);
  } catch (err) {
    if (err instanceof ManifestRefusal) emit('manifest.refuse', { name: row.name, code: err.manifestCode, ...err.detail });
    throw err;
  }
  const manifest = read.manifest;
  if (read.manifestHash !== row.manifestHash) throw new ManifestRefusal('INTEGRITY', `manifestHash of ${row.name} does not match its grant`, { name: row.name });
  // S0b §3: the upgraded V2 object must be the one the human approved; a different upgrader re-cards
  if (row.upgradedHash !== undefined && read.upgradedHash !== row.upgradedHash) {
    emit('mod.paused', { name: row.name, reason: 'changed', files: [] });
    let cardId: string | null = null;
    try {
      // Aegis S0b L2: re-card under the row's ORIGINAL source and alias publisher (never as a fresh 'package')
      const g = parseGitSource(row.source);
      const via: StageOptions['via'] = row.source.startsWith('linked:') ? 'linked' : g ? 'git' : 'package';
      const st = stageInstall({
        home: opts.home,
        source: via === 'linked' ? row.source.slice(7) : dir,
        via,
        ...(g ? { git: { url: g.url, commit: g.commit } } : {}),
        recard: row.legacyName ? { legacyPublisher: pub === 'gnomon' ? 'gnomon' : 'local' } : {},
        requestedBy: opts.kernelPrincipal ?? 'p:00000000/kernel',
        trust: opts.trust,
        emit,
        ...(opts.userMcpServers ? { userMcpServers: opts.userMcpServers } : {}),
      });
      if (st.state === 'staged') cardId = st.cardId;
    } catch (err) {
      if (!(err instanceof ManifestRefusal)) throw err;
    }
    return { state: 'paused', name: row.name, reason: 'changed', cardId, files: { added: [], changed: [], removed: [] }, snapshotDir: dir };
  }
  const check = checkAgainstGrants(manifest, row.manifestHash, grants);
  if (!check.ok) {
    emit('manifest.refuse', { name: row.name, code: 'GRANT', missingCapabilities: check.missingCapabilities, missingEgress: check.missingEgress });
    throw new ManifestRefusal('GRANT', `${row.name} requires ungranted capabilities or egress`, { name: row.name, missingCapabilities: check.missingCapabilities, missingEgress: check.missingEgress });
  }
  if (row.source.startsWith('linked:')) {
    const folder = row.source.slice(7);
    let changed: TreeDiff | null = null;
    try {
      const t = hashSourceTree(folder, pinDirKey(row), noEvents);
      if (t.packageHash !== row.packageHash) changed = diffTrees(files, t.files);
    } catch (err) {
      if (!(err instanceof ManifestRefusal)) throw err;
      changed = { added: [], changed: [], removed: [] }; // the folder now fails the copier: paused, the refusal is logged by the stage below
    }
    if (changed) {
      const listed = [...changed.added.map((f) => f.path), ...changed.changed.map((f) => f.path), ...changed.removed.map((f) => f.path)];
      emit('mod.paused', { name: row.name, reason: 'changed', files: listed });
      let cardId: string | null = null;
      try {
        const st = stageInstall({ home: opts.home, source: folder, via: 'linked', requestedBy: opts.kernelPrincipal ?? 'p:00000000/kernel', trust: opts.trust, emit });
        if (st.state === 'staged') cardId = st.cardId;
      } catch (err) {
        if (!(err instanceof ManifestRefusal)) throw err; // copier/manifest refusal: logged, mod stays paused on its snapshot
      }
      return { state: 'paused', name: row.name, reason: 'changed', cardId, files: changed, snapshotDir: dir };
    }
  }
  emit('manifest.load', { name: row.name, packageHash: row.packageHash, manifestHash: row.manifestHash });
  return { state: 'ready', name: row.name, snapshotDir: dir, manifest, packageHash: row.packageHash, manifestHash: row.manifestHash, tier, readPaths: check.read, source: row.source };
}

/** Linked folders of every effective install (the session profile's write denies, regenerated per spawn). */
export function linkedFolders(home: string, trust: RowVerifier): string[] {
  const g = readGrants(home, trust);
  const names = [...new Set(g.installs.map((r) => r.name))];
  return names
    .map((n) => effectiveInstall(g, n))
    .filter((r): r is GrantInstallRow => r !== undefined && r.source.startsWith('linked:'))
    .map((r) => r.source.slice(7))
    .sort();
}

/** The seam owner (class static block, like #kernel-log / presence). */
export class ManifestDecisions {
  private constructor() {}
  static {
    registerSeams('manifest', { decideInstall, rollbackMod });
  }
}
