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
import { appendGrantRow, appendSignedGrantRows, buildGrantRows, rowsOfDecision, type GrantRow, type GrantRowInput, checkAgainstGrants, effectiveInstall, historicalFirstPartyPins, isHistoricalFirstPartyPin, pinDirKey, readGrants, type GrantInstallRow, type ResolvedGrants } from './grants.js';
import { COMMAND_UNSAFE, compareVersions, detectWidening, MANIFEST_FILE, readManifest, type ManifestMcpConfig, type ManifestV2, type ReadManifestResult, type TrustTier, type WideningEntry } from './manifest.js';
import { ManifestRefusal, noEvents, type ManifestEventSink } from './refusal.js';
import { computePackageHash, diffTrees, hashPinnedTree, hashSourceTree, modDir, pinnedDir, pruneEmptyModDir, refuseSnapshot, removeTree, snapshotFolder, type SnapshotResult, type TreeDiff, type TreeFile } from './snapshot.js';

export const STAGED_RECORD_SCHEMA = 'gnomon-staged-install:v1' as const;
const CARD_ID = /^card:[0-9A-HJKMNP-TV-Z]{26}$/;

/**
 * packageHashes of the first-party mods the kernel bundles (packages/gnomon-mods).
 * M1.11 slice 3: the Workshop (#workshop-mod); mod #1: the Ledger (#ledger-mod).
 * Any edit to a tree moves its hash; test/workshop-mod.test.ts and
 * test/ledger-mod.test.ts hold the pins.
 */
/** The `modAbiId` of the release before the S1.2 move (`tool.call` gained `relayedFor`; no other method changed). */
const MOD_ABI_ID_BEFORE_S1_2 = 'sha256:7aaf92f46dc35fc35141557c1f89088958f220e6bf53ea31a630bb06430ba082';
/**
 * Format-2 first-party pins of the previous release: an EXACT package hash → the ONE prior `modAbiId` that tree
 * echoes at `init` (G-MOD-15, Aegis S1.2 point 9). An installed snapshot at one of these hashes keeps its tier and
 * the mod host starts it under that prior id, so an upgrade does not stop the bundled mods until the human approves
 * their Update cards. Limits, each held by a test:
 *  - exact hash, exact id, first-party by hash, source `package` only; nothing else ever earns the prior id;
 *  - no listed tree declares a tool (`tool.call` is the only method the ABI change touched);
 *  - never an alias source (that is HISTORICAL_FIRST_PARTY_PINS, format 1 only, and no format-1 pin is listed here);
 *  - never a NEW stage (stageInstall refuses one: rollback protection);
 *  - no chains: a prior id maps only to the ABI of SUPERSEDED_PINS_WRITTEN_FOR. When `modAbiId` next moves the
 *    table must be emptied or each entry re-justified (the expiry test fails until then).
 */
const SUPERSEDED_FIRST_PARTY_PINS = new Map<string, string>([
  ['sha256:97d69bb8b35ffdc9bec8a38a9c4644e51a8cd8bb0014d30de10998f322d05aa7', MOD_ABI_ID_BEFORE_S1_2], // workshop 1.1.0
  ['sha256:d63815e16e3b7f062a69e29efa2e62b6186836bb448564f856989eefe37c1852', MOD_ABI_ID_BEFORE_S1_2], // ledger 1.1.0
  ['sha256:22bab5bf24abbc01ac5594e6fe4ff72f3b562479677c93b9a483196943bce1cb', MOD_ABI_ID_BEFORE_S1_2], // paradigm-context 1.1.1
]);
/** The current `modAbiId` the table above was written for. A test compares it with MOD_ABI_ID. */
export const SUPERSEDED_PINS_WRITTEN_FOR = 'sha256:fb9bd26ac5577300dee3d6dc9c3dbe1e5927eca0655e976d7f4f372c273d3f66';

/**
 * RETIRED first-party pins: an EXACT package hash of a first-party tree this kernel no longer ships → why it was
 * retired. A different thing from SUPERSEDED_FIRST_PARTY_PINS, which exists only to let a tree that echoes a PRIOR
 * `modAbiId` keep starting; a retired tree speaks the current ABI and is retired for what it does.
 * What a retired hash means, each held by test/retired-pins.test.ts:
 *  - it is NOT in FIRST_PARTY_PACKAGE_HASHES, so `deriveTier` answers `local` for it and nothing new can earn the
 *    first-party tier from it;
 *  - an install that is ALREADY pinned at it is not touched: `loadMod` takes the tier from the root-signed
 *    `grant.trust` row of that install, never from `deriveTier`, so it keeps loading first-party until the person
 *    approves the Update card for the shipped tree (the documented refresh path: no kernel-side refresh);
 *  - it is never staged anew, and a card staged for it by an earlier kernel can only be denied (`stageInstall`,
 *    `prepareInstall`: TIER, why `retired`);
 *  - it is never a rollback target (`rollbackMod`: TIER, why `retired`). Without this, an update followed by a
 *    rollback would re-pin the retired tree and it would load first-party again from its old trust row.
 * An entry is never removed while a home may still hold a grant row at that hash.
 */
const RETIRED_FIRST_PARTY_PINS = new Map<string, string>([
  // gnomon.dimension 1.0.0 (S1.3 P2). Retired by S1.4 P0: its bundled dim-shape reads a node's strings pair by pair
  // with no cap, misses a credential cut by combining marks, and shows stored fields in the view unchecked.
  ['sha256:7e79c8439b116dbbc1dd542dba84e848546247c820e59954ce20ee49b4ee34c9', 'dimension 1.0.0: its write checks were tightened in 1.0.1'],
]);
/** The one refusal for a retired pin, wherever it is met. */
function refuseRetired(name: string, packageHash: string, what: 'stage' | 'decide' | 'rollback', emit: ManifestEventSink): never {
  emit('manifest.refuse', { name, code: 'TIER', why: 'retired' });
  const said = what === 'rollback' ? 'the earlier snapshot is a retired first-party build and is not re-pinned by rollback' : 'this is a retired first-party build; install the one shipped with this Gnomon';
  throw new ManifestRefusal('TIER', `${name}: ${said}`, { name, why: 'retired', ...(what === 'rollback' ? { toPackageHash: packageHash } : {}) });
}

/**
 * The prior `modAbiId` an installed snapshot may answer `init` with, or null. Every condition must hold: the hash is
 * listed, the tier is first-party, the source is `package`, the publisher is gnomon, the tree declares no tool, and
 * the table was written for the ABI this kernel speaks.
 */
export function compatModAbiId(loaded: { packageHash: string; tier?: string | undefined; source: string; manifest: { publisher?: unknown; provides?: { tools?: readonly unknown[] } } }, currentModAbiId: string): string | null {
  if (currentModAbiId !== SUPERSEDED_PINS_WRITTEN_FOR) return null;
  if (loaded.tier !== 'first-party' || loaded.source !== 'package' || loaded.manifest.publisher !== 'gnomon') return null;
  if ((loaded.manifest.provides?.tools ?? []).length > 0) return null;
  return SUPERSEDED_FIRST_PARTY_PINS.get(loaded.packageHash) ?? null;
}
const FIRST_PARTY_PACKAGE_HASHES = new Set<string>([
  // S1.2: the modAbiId move (relayedFor on tool.call) changes the three trees that echo the id
  'sha256:a5745505b524cf5675cea5d70f0a6219a729ed78e6f6ce6adef071bdc0b1a8b1', // packages/gnomon-mods/workshop 1.1.1 (gnomon.workshop)
  'sha256:504da78f2a97ffb4b51b103025aa2f9629485ff00d089d5448c7fc8df347d217', // packages/gnomon-mods/ledger 1.1.1 (gnomon.ledger)
  'sha256:bd25b714bff0cc79910399c8aa48248184f30a87d360ce71694e4da8029e0dad', // packages/gnomon-mods/paradigm-context 1.1.2 (gnomon.paradigm-context)
  // S0b: manifest:2, publisher gnomon (no index.mjs, so no modAbiId echo: unchanged by the S1.2 move)
  'sha256:978705dfe2caa6dd26663ab9c5c8ace2d9cac755d86ee2b45bf582aff070862a', // packages/gnomon-mods/neurons 1.1.0 (gnomon.neurons, was neurons-brain)
  'sha256:1473214df42c5efe6f6d95739064d12e817515501591738c669c457e0a5f81c9', // packages/gnomon-mods/constellation 1.1.0 (gnomon.constellation)
  // S1.3: the dimension mod (the one writer of dimension rows; echoes the current modAbiId, declares two tools).
  // S1.4 P0 replaces the 1.0.0 pin (sha256:7e79c843…) with 1.0.1: dim-shape.mjs is rebuilt from the tightened
  // contract. The old hash is in RETIRED_FIRST_PARTY_PINS, not here and not in the superseded table. An install
  // already pinned at 1.0.0 KEEPS LOADING first-party (its tier is its signed grant.trust row) until the person
  // approves the Update card; it can no longer be staged, decided or rolled back to.
  'sha256:8a83b014a4bddbd5234ff483322e2f271e9bf64c57154c8c8de60b036913f394', // packages/gnomon-mods/dimension 1.1.0 (gnomon.dimension)
  // superseded format-2 pins: an existing install keeps its first-party tier (it is refused at init for its old
  // modAbiId echo, not re-tiered, until `gnomon mod install` refreshes it)
  ...SUPERSEDED_FIRST_PARTY_PINS.keys(),
  // the format-1 1.0.0 pins of workshop, ledger and paradigm-context (grants.ts; existing installs keep loading)
  ...historicalFirstPartyPins(),
]);

/*
 * THE PIN TABLES ARE MODULE-PRIVATE (S1.4 P0 review, Aegis F2). FIRST_PARTY_PACKAGE_HASHES, SUPERSEDED_FIRST_PARTY_PINS
 * and RETIRED_FIRST_PARTY_PINS decide who is first-party, so no importer may hold the Set or the Maps: a holder
 * could add a hash. Everything outside this file asks a predicate or takes a frozen copy. Tests that need "the
 * kernel of another release" get the tables through the internal seam channel only (`withPinTables`, registered
 * below, read by src/kernel/testing.ts); test/pin-tables.test.ts holds that this module exports no collection.
 */
/** Is this package hash first-party by pin: a current, a superseded or a historical one? (A retired one is not.) */
export function isFirstPartyPin(packageHash: string): boolean {
  return FIRST_PARTY_PACKAGE_HASHES.has(packageHash);
}
/** Is this a superseded format-2 pin (a tree that echoes the one prior `modAbiId` listed for it)? */
export function isSupersededPin(packageHash: string): boolean {
  return SUPERSEDED_FIRST_PARTY_PINS.has(packageHash);
}
/** Is this a retired first-party pin (never staged, approved or rolled back to)? */
export function isRetiredPin(packageHash: string): boolean {
  return RETIRED_FIRST_PARTY_PINS.has(packageHash);
}
/** The ONE prior `modAbiId` listed for a superseded pin, or null. */
export function supersededPriorModAbiId(packageHash: string): string | null {
  return SUPERSEDED_FIRST_PARTY_PINS.get(packageHash) ?? null;
}
/** Why a pin was retired, or null when it is not retired. */
export function retiredPinReason(packageHash: string): string | null {
  return RETIRED_FIRST_PARTY_PINS.get(packageHash) ?? null;
}
/** Copies for readers and tests: a fresh frozen list on every call, so changing one changes nothing here. */
export function firstPartyPins(): readonly string[] {
  return Object.freeze([...FIRST_PARTY_PACKAGE_HASHES]);
}
export function supersededPins(): ReadonlyArray<readonly [packageHash: string, priorModAbiId: string]> {
  return Object.freeze([...SUPERSEDED_FIRST_PARTY_PINS].map((e) => Object.freeze(e)));
}
export function retiredPins(): ReadonlyArray<readonly [packageHash: string, why: string]> {
  return Object.freeze([...RETIRED_FIRST_PARTY_PINS].map((e) => Object.freeze(e)));
}
/** What the test seam hands out: the live tables, for the length of one call. */
export interface PinTables {
  firstParty: Set<string>;
  superseded: Map<string, string>;
  retired: Map<string, string>;
}
/**
 * TEST SEAM (reachable only through src/kernel/testing.ts): run `fn` with the pin tables edited, then put every
 * table back exactly as it was, whatever `fn` or `edit` did or threw. Synchronous on purpose: the tables are never
 * left edited across an await.
 */
function withPinTables<T>(edit: (tables: PinTables) => void, fn: () => T): T {
  const saved = { firstParty: [...FIRST_PARTY_PACKAGE_HASHES], superseded: [...SUPERSEDED_FIRST_PARTY_PINS], retired: [...RETIRED_FIRST_PARTY_PINS] };
  try {
    edit({ firstParty: FIRST_PARTY_PACKAGE_HASHES, superseded: SUPERSEDED_FIRST_PARTY_PINS, retired: RETIRED_FIRST_PARTY_PINS });
    return fn();
  } finally {
    FIRST_PARTY_PACKAGE_HASHES.clear();
    for (const h of saved.firstParty) FIRST_PARTY_PACKAGE_HASHES.add(h);
    SUPERSEDED_FIRST_PARTY_PINS.clear();
    for (const [h, id] of saved.superseded) SUPERSEDED_FIRST_PARTY_PINS.set(h, id);
    RETIRED_FIRST_PARTY_PINS.clear();
    for (const [h, why] of saved.retired) RETIRED_FIRST_PARTY_PINS.set(h, why);
  }
}
/** Keys trusted to sign community manifests (`signed:<gkey>` tier). None in 8.0 Move 1. */
const TRUSTED_MANIFEST_KEYS: ReadonlySet<string> = new Set<string>(); // module-private, like the pin tables (no importer may add a key)

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

const O_NOFOLLOW: number = fs.constants.O_NOFOLLOW ?? 0;
const O_NONBLOCK: number = fs.constants.O_NONBLOCK ?? 0;

/**
 * The raw manifest object of a folder, or null. Read only from a regular file: the path is opened without following
 * a symlink and without blocking (a FIFO here would otherwise hang the read), and the open descriptor is checked.
 */
function rawManifestOf(dir: string): Record<string, unknown> | null {
  let fd: number | undefined;
  try {
    const p = path.join(dir, MANIFEST_FILE);
    if (!fs.lstatSync(p).isFile()) return null;
    fd = fs.openSync(p, fs.constants.O_RDONLY | O_NOFOLLOW | O_NONBLOCK);
    if (!fs.fstatSync(fd).isFile()) return null;
    const v = JSON.parse(fs.readFileSync(fd, 'utf8')) as unknown;
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

/** The id a source folder is named by when its manifest gives none. */
function folderName(source: string): string {
  return `local.${path.basename(path.resolve(source)).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^[^a-z]+|-+$/g, '').slice(0, 24) || 'unnamed'}`;
}

/**
 * Refuse a manifest path that is not a regular file BEFORE anything reads it (the walk's symlink and special-file
 * checks run later). lstat only: nothing is followed or opened. A missing manifest is left to the later refusal.
 */
function refuseIrregularManifest(source: string, emit: ManifestEventSink): void {
  let st: fs.Stats;
  try {
    st = fs.lstatSync(path.join(source, MANIFEST_FILE));
  } catch {
    return;
  }
  if (st.isSymbolicLink()) refuseSnapshot('symlink', MANIFEST_FILE, folderName(source), emit);
  if (!st.isFile()) refuseSnapshot('special-file', MANIFEST_FILE, folderName(source), emit);
}

/** Best-effort mod id for refusal events and the snapshot directory before the manifest validates. */
function sourceName(source: string, legacyPublisher?: string): string {
  const m = rawManifestOf(source);
  const id = m && typeof m.name === 'string' ? `${typeof m.publisher === 'string' ? m.publisher : (legacyPublisher ?? 'local')}.${m.name}` : '';
  if (isModId(id)) return id;
  return folderName(source);
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
    // S1.4: the effects a command declares count too, so a mod whose only `write` is on a command says so on its card
    effects: [...new Set([...(p.tools ?? []).flatMap((t) => t.effects), ...(p.commands ?? []).flatMap((c) => c.effects ?? [])])].sort(),
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
  // Written beside the record and renamed over it: a failed write never leaves a partly written record, and never
  // touches the record already there (commitInstall rewrites a pending record AFTER its grant rows are appended).
  const tmp = `${p}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, `${JSON.stringify(rec)}\n`, { mode: 0o600 });
    fs.renameSync(tmp, p);
  } catch (err) {
    try {
      if (fs.lstatSync(tmp).isFile()) fs.rmSync(tmp, { force: true });
    } catch {
      /* nothing was created */
    }
    throw err;
  }
}

/**
 * Drop the snapshot of a stage that did not end in a card, and the empty directories around it. Only a snapshot
 * directory THIS call created is removed (`created`; a reused `pinned/<hex>` belongs to an install or an earlier
 * stage), and not even that one when the effective install pins it or a staged record names it (another process
 * may have reused it since). Never throws: the refusal that brought us here is what the caller must see.
 */
function discardSnapshot(home: string, name: string, snap: SnapshotResult, grants: ResolvedGrants): void {
  try {
    if (snap.created && effectiveInstall(grants, name)?.packageHash !== snap.packageHash && !stagedNames(home, name, snap.packageHash)) removeTree(snap.dir);
    pruneEmptyModDir(home, name);
  } catch {
    /* best effort */
  }
}

/** Whether any readable staged record of this mod names the snapshot, decided or not. */
function stagedNames(home: string, name: string, packageHash: string): boolean {
  const dir = path.join(modDir(home, name), 'staged');
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return false;
  }
  for (const n of names) {
    try {
      const st = fs.lstatSync(path.join(dir, n));
      if (!st.isFile() || st.size > 1024 * 1024) continue;
      const r = JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8')) as StagedRecord;
      if (r?.detail?.packageHash === packageHash) return true;
    } catch {
      /* unreadable: names nothing */
    }
  }
  return false;
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
  refuseIrregularManifest(opts.source, emit);
  const raw0 = rawManifestOf(opts.source);
  let legacyPublisher: 'gnomon' | 'local' | undefined = opts.recard?.legacyPublisher;
  if (!legacyPublisher && raw0?.manifest === 1 && typeof raw0.name === 'string') {
    let h = '';
    try {
      h = hashSourceTree(opts.source, `local.${raw0.name}`, noEvents).packageHash;
    } catch {
      h = '';
    }
    if (isHistoricalFirstPartyPin(h) && opts.via !== 'linked') legacyPublisher = 'gnomon';
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
    // a retired first-party build is never staged anew (RETIRED_FIRST_PARTY_PINS); the catch below drops its snapshot
    if (RETIRED_FIRST_PARTY_PINS.has(snap.packageHash)) refuseRetired(name0, snap.packageHash, 'stage', emit);
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
    // a snapshot of a refused manifest is never kept, nor the empty directories made for it
    discardSnapshot(opts.home, name0, snap, grants);
    throw err;
  }
  // from here to the written card: any throw (a missing current pin, a card that does not validate, a failed write)
  // leaves no snapshot this call created. A result of either state keeps its snapshot, as before.
  try {
    return cardForSnapshot(opts, emit, now, { name: name0, source, snap, read, tier, grants, binding, serverName });
  } catch (err) {
    discardSnapshot(opts.home, name0, snap, grants);
    throw err;
  }
}

interface StagedSnapshot {
  name: string;
  source: InstallSource;
  snap: SnapshotResult;
  read: ReadManifestResult;
  tier: TrustTier;
  grants: ResolvedGrants;
  binding: ReturnType<typeof checkPublisherSource>;
  serverName: string | undefined;
}

/** The second half of stageInstall: the card for a snapshot whose manifest was accepted (its caller cleans up a throw). */
function cardForSnapshot(opts: StageOptions, emit: ManifestEventSink, now: Date, s: StagedSnapshot): StageResult {
  const { name, source, snap, read, tier, grants, binding, serverName } = s;
  const manifest = read.manifest;
  const mh = read.manifestHash;
  const current = effectiveInstall(grants, name);
  if (!opts.recard && current && current.packageHash === snap.packageHash && current.manifestHash === mh && current.source === source) return { state: 'unchanged', packageHash: snap.packageHash };
  // Rollback protection (Aegis S1.2 point 9a): a superseded first-party tree keeps the tier of an EXISTING install only.
  // A new stage of one (not the tree pinned now) is refused here, and rollbackMod refuses to re-pin one from an
  // earlier grant row, so an old first-party build is not put back by a stage or by a rollback. (An install that is
  // still pinned at a superseded hash stays as it is until its Update card is approved.)
  if (SUPERSEDED_FIRST_PARTY_PINS.has(snap.packageHash) && !(current && current.packageHash === snap.packageHash)) {
    emit('manifest.refuse', { name, code: 'TIER', why: 'superseded' });
    throw new ManifestRefusal('TIER', `${name}: this is a superseded first-party build; install the one shipped with this Gnomon`, { name, why: 'superseded' });
  }
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
  // Another stage of the identical content may have created this snapshot, failed and removed it while this call
  // reused it: a card must never name a snapshot that is gone. Take the card back and refuse; staging again copies afresh.
  if (!fs.existsSync(snap.dir)) {
    fs.rmSync(stagedPath(opts.home, name, card.cardId), { force: true });
    refuseSnapshot('changed-during-copy', '.', name, emit);
  }
  if (current && widened.length) emit('manifest.widened', { name, fields: widened.map((w) => w.field) });
  emit('manifest.staged', { name, cardId: card.cardId, manifestHash: mh, packageHash: snap.packageHash, source, by: opts.requestedBy, ...(opts.hsid ? { hsid: opts.hsid } : {}), at: now.toISOString() });
  return { state: 'staged', cardId: card.cardId, record };
}

/** Re-read a staged/pinned snapshot's manifest under the tier its source derives (format 1 only for a historical pin). */
function snapshotRead(home: string, name: string, packageHash: string, source: string): { read: ReadManifestResult; tier: TrustTier } {
  const tier: TrustTier = source.startsWith('linked:') ? 'local' : deriveTier(packageHash);
  const bytes = fs.readFileSync(path.join(pinnedDir(home, name, packageHash), MANIFEST_FILE));
  const legacy = tier === 'first-party' && isHistoricalFirstPartyPin(packageHash) ? { legacyPublisher: 'gnomon' as const } : {};
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
  // a card an earlier kernel staged for a build retired since: said plainly, BEFORE the snapshot is re-read (its tier
  // no longer derives first-party, so the re-read would refuse with a reason that hides the real one)
  if (RETIRED_FIRST_PARTY_PINS.has(rec.detail.packageHash)) refuseRetired(name, rec.detail.packageHash, 'decide', noEvents);
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
/** TD-2026-10-20-514: an install decision checked and its rows BUILT (unsigned), ready for one decision.sign. */
export interface PreparedInstall {
  home: string;
  name: string;
  cardId: string;
  decision: 'install' | 'deny';
  /** the rows commitInstall writes, in order, grant.install LAST (empty: deny, or already installed) */
  rows: GrantRow[];
  /** the card was already decided this way: commit is a no-op */
  done: boolean;
  /**
   * Aegis F4: the rows are ALREADY in grants.jsonl (an earlier commit appended them, then its pin read-back or staged
   * write threw): `rows` are those written rows; commit appends nothing and finishes the decision idempotently
   */
  finishing?: boolean;
  rec: StagedRecord;
  events: Array<[string, Record<string, unknown>]>;
}

export interface PrepareOptions {
  userMcpServers?: readonly string[];
  authority: RowVerifier;
  now?: Date;
  /** Aegis C1b: the card's detail.rootRows; the built rows (createdAt dropped) must deep-equal them, in order */
  expectedRootRows?: readonly unknown[];
}

/**
 * Close a PENDING staged card whose tree is a retired first-party build: the record is rewritten `expired`, with no
 * decision (nobody decided it), so the pickup never lists it again and no approvable file for a retired build stays
 * on disk. Returns whether it closed one. Anything else (no record, already decided, not retired) is left alone.
 */
export function expireRetiredStaged(home: string, name: string, cardId: string): boolean {
  if (typeof cardId !== 'string' || !CARD_ID.test(cardId) || !isModId(name)) return false;
  const rec = readStaged(home, name, cardId);
  if (!rec || rec.card.cardId !== cardId || rec.detail.name !== name || rec.card.state !== 'pending' || !RETIRED_FIRST_PARTY_PINS.has(rec.detail.packageHash)) return false;
  writeStaged(home, { ...rec, card: { ...rec.card, state: 'expired' } });
  return true;
}

/**
 * Check an install decision and BUILD its grant rows (TD-2026-10-20-514): every check decideInstall makes (cardId,
 * contentHash, the snapshot, the re-derived surface, the publisher binding, the server collision), no presence
 * consumed, nothing signed, nothing written. Every row carries the cardId (Aegis Q1). With expectedRootRows, the rows
 * the card SHOWED must be exactly the rows built (C1b), or it refuses INTEGRITY before any prompt.
 */
export function prepareInstall(home: string, name: string, cardId: string, decision: 'install' | 'deny', opts: PrepareOptions): PreparedInstall {
  const now = opts.now ?? new Date();
  if (typeof cardId !== 'string' || !CARD_ID.test(cardId)) throw new ManifestRefusal('SCHEMA', 'cardId must be card:<ULID>', { cardId: String(cardId) });
  if (!isModId(name)) throw new ManifestRefusal('SCHEMA', 'malformed mod id', { name: String(name) });
  const rec = readStaged(home, name, cardId);
  if (!rec || rec.card.cardId !== cardId || rec.detail.name !== name) throw new ManifestRefusal('NOT_INSTALLED', `no install card ${cardId} for ${name}`, { name, cardId });
  if (sha(canonicalJson(rec.detail)) !== rec.card.contentHash) throw new ManifestRefusal('INTEGRITY', `install card ${cardId}: contentHash does not match its detail`, { name, cardId });
  const out: PreparedInstall = { home, name, cardId, decision, rows: [], done: false, rec, events: [] };
  if (rec.card.state !== 'pending') {
    if (rec.decision?.decision === decision) return { ...out, done: true }; // idempotent re-decide
    throw new ManifestRefusal('NOT_INSTALLED', `install card ${cardId} is already decided`, { name, cardId });
  }
  const already = readGrants(home, opts.authority).installs.find((r) => r.cardId === cardId && r.packageHash === rec.detail.packageHash);
  if (decision === 'deny' && rowsOfDecision(home, opts.authority, cardId).at(-1)?.kind === 'grant.install') {
    // Aegis M3: this card's rows are ALREADY written (trust, capability, install live); a deny would record a denial
    // over a live install
    throw new ManifestRefusal('GRANT', `install card ${cardId}: its rows are already written; finish the install (decide install) or uninstall the mod`, { name, cardId, written: true });
  }
  if (decision === 'install' && already) {
    // Aegis F4: written but not decided: the rows this card's decision wrote, verified; commit only records the decision
    const written = rowsOfDecision(home, opts.authority, cardId);
    if (written.at(-1)?.kind === 'grant.install') {
      out.rows = written;
      out.finishing = true;
      const pin = written.at(-1) as GrantInstallRow;
      out.events.push(['manifest.installed', { name, manifestHash: pin.manifestHash, packageHash: pin.packageHash, cardId, source: pin.source }]);
      out.events.push(['mod.installed', { name, packageHash: pin.packageHash, ...(rec.detail.replaces ? { replaces: rec.detail.replaces.packageHash } : {}) }]);
      if (pin.source.startsWith('linked:') && !rec.detail.replaces) out.events.push(['mod.linked', { name, path: pin.source.slice(7), packageHash: pin.packageHash }]);
    }
  }
  if (decision === 'install' && !already) {
    // a card an earlier kernel staged for a build retired since then can only be denied
    if (RETIRED_FIRST_PARTY_PINS.has(rec.detail.packageHash)) refuseRetired(name, rec.detail.packageHash, 'decide', noEvents);
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
    // Aegis S0b M2 (TOFU race): the binding must still be what the card showed it replacing
    if (bind) {
      const shown = rec.detail.rebind;
      if (!shown || shown.host !== bind.host || shown.namespace !== bind.namespace || canonicalJson(shown.from ?? null) !== canonicalJson(bind.from)) {
        throw new ManifestRefusal('PUBLISHER', `publisher ${manifest.publisher}: the binding changed since this card was staged; stage it again`, { name, cardId, publisher: manifest.publisher });
      }
    }
    checkServerCollision(home, manifest, g, opts.userMcpServers);
    const inputs: GrantRowInput[] = [
      { kind: 'grant.trust', manifestHash: mh, tier, cardId },
      ...(surf.capabilities.length ? [{ kind: 'grant.capability' as const, manifestHash: mh, capabilities: surf.capabilities, ...(readPaths.length ? { read: readPaths } : {}), cardId }] : []),
      ...(surf.egress.length ? [{ kind: 'grant.egress' as const, manifestHash: mh, hosts: surf.egress, cardId }] : []),
      ...(bind ? [{ kind: 'grant.publisher' as const, publisher: manifest.publisher, host: bind.host, namespace: bind.namespace, cardId }] : []),
      { kind: 'grant.install', name, manifestHash: mh, packageHash, cardId, source, ...(read.upgradedHash ? { upgradedHash: read.upgradedHash } : {}) }, // LAST
    ];
    out.rows = buildGrantRows(home, opts.authority, inputs, now);
    out.events.push(['manifest.installed', { name, manifestHash: mh, packageHash, cardId, source }]);
    out.events.push(['mod.installed', { name, packageHash, ...(rec.detail.replaces ? { replaces: rec.detail.replaces.packageHash } : {}) }]);
    if (source.startsWith('linked:') && !rec.detail.replaces) out.events.push(['mod.linked', { name, path: source.slice(7), packageHash }]);
  }
  if (opts.expectedRootRows !== undefined && canonicalJson(out.rows.map(rootRowIntent)) !== canonicalJson(opts.expectedRootRows)) {
    throw new ManifestRefusal('INTEGRITY', `install card ${cardId}: the rows it would sign are not the rows the card showed; it must be raised again`, { name, cardId });
  }
  return out;
}

/** A built row as a card shows it (detail.rootRows): createdAt dropped (identity/decision-batch.ts intentOf). */
function rootRowIntent(r: GrantRow): Record<string, unknown> {
  const { createdAt: _c, ...rest } = r as GrantRow & { createdAt: string };
  return rest;
}

/** The rows an install card shows it will sign (Aegis C1a): detail.rootRows. Throws what prepareInstall throws. */
export function installRootRows(home: string, name: string, cardId: string, opts: PrepareOptions): Record<string, unknown>[] {
  return prepareInstall(home, name, cardId, 'install', { ...opts, expectedRootRows: undefined }).rows.map(rootRowIntent);
}

/**
 * Commit a prepared install with its root signatures (TD-2026-10-20-514): the bound `mod.install` token is consumed
 * HERE, inside the decision (Aegis C6); the signed rows are appended through appendSignedGrantRows (one write,
 * grant.install last, every row re-checked against the table under the lock); then the events and the staged state.
 */
export function commitInstall(p: PreparedInstall, rowSigs: ReadonlyArray<{ signer: string; sig: string }>, presenceToken: unknown, opts: { authority: RowVerifier; emit?: ManifestEventSink; now?: Date }): StagedRecord {
  const emit = opts.emit ?? noEvents;
  const now = opts.now ?? new Date();
  const verdict = consumeBoundPresence(presenceToken, 'mod.install', installPresenceBinding(p.cardId, p.rec.card.contentHash, p.decision));
  if (verdict !== 'ok') throw new ManifestRefusal('GRANT', `install decision needs fresh presence (${verdict})`, { name: p.name, cardId: p.cardId, presence: verdict });
  if (p.done) return p.rec;
  const cur = readStaged(p.home, p.name, p.cardId);
  if (!cur || cur.card.state !== 'pending') throw new ManifestRefusal('NOT_INSTALLED', `install card ${p.cardId} is already decided`, { name: p.name, cardId: p.cardId });
  if (p.finishing) {
    // Aegis F4: the rows are written already; they must still be there, verbatim, and nothing is appended again
    if (canonicalJson(rowsOfDecision(p.home, opts.authority, p.cardId)) !== canonicalJson(p.rows)) throw new ManifestRefusal('GRANT', `install card ${p.cardId}: its written rows changed; decide again`, { name: p.name, cardId: p.cardId, stale: true });
  } else {
    appendSignedGrantRows(p.home, opts.authority, p.rows, rowSigs);
  }
  for (const [k, v] of p.events) emit(k as Parameters<ManifestEventSink>[0], v);
  const decided: StagedRecord = { ...p.rec, card: { ...p.rec.card, state: 'decided' }, decision: { decision: p.decision, at: now.toISOString() } };
  writeStaged(p.home, decided);
  return decided;
}

/**
 * Decide a staged install card in one call (the test seam and the legacy single-signer form): prepareInstall, a
 * root signature per row from the authority, commitInstall. Production reaches install ONLY through
 * #approval-broker (broker/install-card.ts), which signs the rows in the same decision.sign as the decision.
 */
export function decideInstall(home: string, name: string, cardId: string, decision: 'install' | 'deny', opts: DecideOptions): StagedRecord {
  const p = prepareInstall(home, name, cardId, decision, { authority: opts.authority, ...(opts.userMcpServers ? { userMcpServers: opts.userMcpServers } : {}), ...(opts.now ? { now: opts.now } : {}) });
  const sigs = p.rows.map((r) => opts.authority.signRow(r));
  return commitInstall(p, sigs, opts.presenceToken, { authority: opts.authority, ...(opts.emit ? { emit: opts.emit } : {}), ...(opts.now ? { now: opts.now } : {}) });
}

/** The security-relevant detail fields re-derived on decide. */
function pick(d: Surface & { packageHash: string }): Record<string, unknown> {
  return { packageHash: d.packageHash, effects: d.effects, egress: d.egress, capabilities: d.capabilities, events: d.events, tools: d.tools, views: d.views, commands: d.commands, keybindings: d.keybindings, knowledge: d.knowledge, mcp: d.mcp, hooks: d.hooks, opaque: d.opaque, ...(d.offers?.length ? { offers: d.offers } : {}) };
}

/**
 * Human-only rollback: re-pin a previous APPROVED snapshot (an earlier
 * grant.install row for the mod), never an unapproved one; keeps the link.
 * A target in SUPERSEDED_FIRST_PARTY_PINS or RETIRED_FIRST_PARTY_PINS is refused TIER (rollback protection).
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
  // Rollback protection (Aegis S1.2 point 9a, S1.1 carry-over): an earlier approved row at a superseded first-party
  // pin is not a rollback target. Only the tree pinned now may stay at such a hash (the same rule as stageInstall).
  // "Pinned now" is the EFFECTIVE install, which honours grant.uninstall: `current` above is only the last install
  // row, and after an uninstall nothing is pinned, so no hash is exempt (S1.4 P0 review, Aegis F1).
  const pinnedNow = effectiveInstall(grants, name)?.packageHash;
  if (SUPERSEDED_FIRST_PARTY_PINS.has(target.packageHash) && target.packageHash !== pinnedNow) {
    emit('manifest.refuse', { name, code: 'TIER', why: 'superseded' });
    throw new ManifestRefusal('TIER', `${name}: the earlier snapshot is a superseded first-party build and is not re-pinned by rollback`, { name, why: 'superseded', toPackageHash: target.packageHash });
  }
  // The same for a RETIRED first-party build: after its Update was approved, a rollback must not put it back (it
  // would load first-party again from the trust row of its old install).
  if (RETIRED_FIRST_PARTY_PINS.has(target.packageHash) && target.packageHash !== pinnedNow) refuseRetired(name, target.packageHash, 'rollback', emit);
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
    registerSeams('manifest', { decideInstall, rollbackMod, withPinTables });
  }
}
