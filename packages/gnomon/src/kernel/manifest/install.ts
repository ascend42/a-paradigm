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
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { canonicalJson, mintId, sanitizeDisplayText, validateCardV1, type CardFlag, type CardV1 } from '@a-company/gnomon-contracts';
import { MAX_LINE } from '../broker/card.js';
import type { RootAuthority } from '../identity/root-authority.js';
import type { RowVerifier } from '../identity/registry.js';
import { consumeBoundPresence } from '../identity/presence.js';
import { registerSeams } from '../internal-seams.js';
import { appendGrantRow, checkAgainstGrants, effectiveInstall, readGrants, type GrantInstallRow } from './grants.js';
import { COMMAND_UNSAFE, detectWidening, MANIFEST_FILE, manifestHash, validateManifest, type ManifestMcpConfig, type ManifestV1, type TrustTier, type WideningEntry } from './manifest.js';
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
  'sha256:3c09d9cb5d22c3e75773baf547456bc4b2a2b0bebdaff9d67baaad159ff06e1d', // packages/gnomon-mods/workshop 1.0.0 (S5: structured caps, 6 hues)
  'sha256:e840fb3902df137f280313d768e1cb1087a80eccfa78e0289ebacf52c1c43e83', // packages/gnomon-mods/ledger 1.0.0 (#ledger-mod)
  'sha256:be0cce015b2db126206973adddd899060b6a3e6ff28fd7e53d5d0842530cfd71', // packages/gnomon-mods/paradigm-context 1.0.0 (#paradigm-context-mod)
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

export type InstallSource = 'package' | `linked:${string}`;

/** What the install card shows (§12.5), and what its contentHash covers. */
export interface InstallCardDetail {
  name: string;
  kind: ManifestV1['kind'];
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
  manifest: ManifestV1;
  decision?: { decision: 'install' | 'deny'; at: string };
}

export interface StageOptions {
  home: string;
  /** the package path or the linked folder */
  source: string;
  via: 'package' | 'linked';
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

function readManifestFile(dir: string, name: string, emit: ManifestEventSink): unknown {
  const p = path.join(dir, MANIFEST_FILE);
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    emit('manifest.refuse', { name, code: 'SCHEMA', reason: 'manifest-unreadable' });
    throw new ManifestRefusal('SCHEMA', `${MANIFEST_FILE} is missing or not JSON`, { name });
  }
}

/** Best-effort name for refusal events before the manifest validates. */
function sourceName(source: string): string {
  try {
    const n = (JSON.parse(fs.readFileSync(path.join(source, MANIFEST_FILE), 'utf8')) as { name?: unknown }).name;
    if (typeof n === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(n)) return n;
  } catch {
    /* fall through */
  }
  return path.basename(path.resolve(source)).toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 64) || 'unnamed';
}

function sha(s: string): string {
  return `sha256:${createHash('sha256').update(s, 'utf8').digest('hex')}`;
}

type Surface = Pick<InstallCardDetail, 'effects' | 'egress' | 'capabilities' | 'events' | 'tools' | 'views' | 'commands' | 'keybindings' | 'knowledge' | 'mcp' | 'hooks' | 'offers' | 'opaque'>;
function surfaceOf(m: ManifestV1): Surface {
  const p = m.provides ?? {};
  const eg = m.requires?.egress;
  const opaque: Record<string, number> = {};
  for (const k of ['skills', 'agents', 'bands', 'steps', 'resolvers', 'blocks', 'oracles'] as const) if (p[k]?.length) opaque[k] = p[k]!.length;
  return {
    commands: (p.commands ?? []).map((c) => c.id).sort(),
    keybindings: (p.keybindings ?? []).map((k) => `${k.key}→${k.command}`).sort(),
    knowledge: (p.knowledge ?? []).map((k) => `${k.name} ${k.scheme} ${k.query} ≤${k.maxTier}`).sort(),
    mcp: (p.mcp ?? []).map((s) => `${s.name}: ${[s.command, ...(s.args ?? [])].join(' ')}${mcpConfigSuffix(s.config)}`).sort(),
    ...(p.offers?.length ? { offers: p.offers.map((o) => `${o.kind} (${o.phase}) → ${o.handoffTool}: ${o.title}`).sort() } : {}),
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
  return parts.length ? ` · user may set: ${parts.join('; ')}` : '';
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
  const compose = (src: string) => `${d.replaces ? 'Re-approve' : 'Install'} mod ${d.name} ${midTrunc(d.version, 64)} (${d.kind}) from ${src}, tier ${d.tier}`;
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
  const logical = [
    headerLine(d),
    `packageHash ${d.packageHash}`,
    // kernel-composed, before any manifest-controlled line (Aegis round 2 C2): the count cannot be pushed off-screen
    `runs commands: ${d.mcp.length} mcp server(s), ${d.hooks.length} hook(s)`,
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
  return path.join(modDir(home, name), 'staged', `${cardId.replace(':', '-')}.json`);
}

function writeStaged(home: string, rec: StagedRecord): void {
  const p = stagedPath(home, rec.detail.name, rec.card.cardId);
  fs.mkdirSync(path.dirname(p), { recursive: true, mode: 0o700 });
  fs.writeFileSync(p, `${JSON.stringify(rec)}\n`, { mode: 0o600 });
}

export function readStaged(home: string, name: string, cardId: string): StagedRecord | null {
  if (!CARD_ID.test(cardId) || !/^[a-z][a-z0-9-]{0,63}$/.test(name)) return null;
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
function pinnedManifest(home: string, row: GrantInstallRow): ManifestV1 | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(pinnedDir(home, row.name, row.packageHash), MANIFEST_FILE), 'utf8')) as ManifestV1;
  } catch {
    return null;
  }
}

/** Stage an install (package) or a link (folder). Raises a pending card; takes no effect. */
export function stageInstall(opts: StageOptions): StageResult {
  const emit = opts.emit ?? noEvents;
  const now = opts.now ?? new Date();
  const name0 = sourceName(opts.source);
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
  const snap = snapshotFolder(opts.home, opts.source, name0, emit);
  let manifest: ManifestV1;
  let tier: TrustTier;
  try {
    tier = opts.via === 'linked' && !opts.signature ? 'local' : deriveTier(snap.packageHash, opts.signature);
    const raw = readManifestFile(snap.dir, name0, emit);
    try {
      manifest = validateManifest(raw, { tier });
    } catch (err) {
      if (err instanceof ManifestRefusal) emit('manifest.refuse', { name: name0, code: err.manifestCode, ...err.detail });
      throw err;
    }
    if (manifest.name !== name0) throw new ManifestRefusal('SCHEMA', `manifest name ${manifest.name} changed during the copy`, { name: manifest.name });
  } catch (err) {
    // a snapshot of a refused manifest is never kept
    if (snap.created) removeTree(snap.dir);
    throw err;
  }
  const name = manifest.name;
  const mh = manifestHash(manifest);
  const source: InstallSource = opts.via === 'package' ? 'package' : `linked:${fs.realpathSync.native(opts.source)}`;
  const grants = readGrants(opts.home, opts.trust);
  const current = effectiveInstall(grants, name);
  if (current && current.packageHash === snap.packageHash && current.manifestHash === mh) return { state: 'unchanged', packageHash: snap.packageHash };
  const pending = pendingFor(opts.home, name, snap.packageHash, mh, source);
  if (pending) return { state: 'staged', cardId: pending.card.cardId, record: pending };
  const prevManifest = current ? pinnedManifest(opts.home, current) : null;
  const prevFiles: TreeFile[] = current ? hashPinnedTree(pinnedDir(opts.home, name, current.packageHash)) : [];
  const widened = detectWidening(prevManifest, manifest);
  const detail: InstallCardDetail = {
    name,
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

export interface DecideOptions {
  presenceToken: unknown;
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
  if (typeof name !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(name)) throw new ManifestRefusal('SCHEMA', 'malformed mod name', { name: String(name) });
  const rec = readStaged(home, name, cardId);
  if (!rec || rec.card.cardId !== cardId || rec.detail.name !== name) throw new ManifestRefusal('NOT_INSTALLED', `no install card ${cardId} for ${name}`, { name, cardId });
  const dir = pinnedDir(home, name, rec.detail.packageHash);
  if (computePackageHash(fs.existsSync(dir) ? hashPinnedTree(dir) : []) !== rec.detail.packageHash) throw new ManifestRefusal('INTEGRITY', `pinned snapshot of ${name} no longer hashes to ${rec.detail.packageHash}`, { name });
  const tier = rec.detail.source.startsWith('linked:') ? 'local' : deriveTier(rec.detail.packageHash);
  const manifest = validateManifest(JSON.parse(fs.readFileSync(path.join(dir, MANIFEST_FILE), 'utf8')), { tier });
  const mh = manifestHash(manifest);
  const surf = surfaceOf(manifest);
  const derived: InstallCardDetail = { ...rec.detail, ...surf, name: manifest.name, kind: manifest.kind, version: manifest.version, tier, manifestHash: mh };
  const claimed = canonicalJson({ mh: rec.detail.manifestHash, tier: rec.detail.tier, name: rec.detail.name, ...pick(rec.detail) });
  if (claimed !== canonicalJson({ mh, tier, name: manifest.name, ...pick(derived) })) throw new ManifestRefusal('INTEGRITY', `install card ${cardId} does not match its pinned snapshot`, { name, cardId });
  // Aegis C4: readPaths and source are not trusted from the staged file either
  if (derived.readPaths.length && !derived.capabilities.includes('knowledge:provide')) throw new ManifestRefusal('INTEGRITY', `install card ${cardId}: read paths without knowledge:provide`, { name, cardId });
  for (const p of derived.readPaths) {
    if (typeof p !== 'string' || !path.isAbsolute(p) || path.normalize(p) !== p || p.split(/[\\/]/).includes('..')) throw new ManifestRefusal('INTEGRITY', `install card ${cardId}: read path ${String(p).slice(0, 80)} is not an absolute normalized path`, { name, cardId });
  }
  if (derived.source !== 'package') {
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
  if (typeof name !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(name)) throw new ManifestRefusal('SCHEMA', 'malformed mod name', { name: String(name) });
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
    const tier = rec.detail.source.startsWith('linked:') ? 'local' : deriveTier(rec.detail.packageHash);
    const manifest = validateManifest(JSON.parse(fs.readFileSync(path.join(dir, MANIFEST_FILE), 'utf8')), { tier });
    const mh = manifestHash(manifest);
    const surf = surfaceOf(manifest);
    const claimed = canonicalJson({ mh: rec.detail.manifestHash, tier: rec.detail.tier, name: rec.detail.name, ...pick(rec.detail) });
    const derived = canonicalJson({ mh, tier, name: manifest.name, ...pick({ ...rec.detail, ...surf }) });
    if (claimed !== derived) throw new ManifestRefusal('INTEGRITY', `install card ${cardId} does not match its pinned snapshot`, { name, cardId });
    const { packageHash, source, readPaths } = rec.detail;
    appendGrantRow(home, opts.authority, { kind: 'grant.trust', manifestHash: mh, tier }, now);
    if (surf.capabilities.length) {
      appendGrantRow(home, opts.authority, { kind: 'grant.capability', manifestHash: mh, capabilities: surf.capabilities, ...(readPaths.length ? { read: readPaths } : {}) }, now);
    }
    if (surf.egress.length) appendGrantRow(home, opts.authority, { kind: 'grant.egress', manifestHash: mh, hosts: surf.egress }, now);
    appendGrantRow(home, opts.authority, { kind: 'grant.install', name, manifestHash: mh, packageHash, cardId, source }, now); // LAST
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
  if (typeof name !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(name)) throw new ManifestRefusal('SCHEMA', 'malformed mod name', { name: String(name) });
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
  const files = hashPinnedTree(pinnedDir(home, name, target.packageHash));
  if (computePackageHash(files) !== target.packageHash) throw new ManifestRefusal('INTEGRITY', `snapshot ${target.packageHash} of ${name} is damaged`, { name });
  const row = appendGrantRow(home, opts.authority, { kind: 'grant.install', name, manifestHash: target.manifestHash, packageHash: target.packageHash, cardId: target.cardId, source: current.source }, now) as GrantInstallRow;
  emit('mod.rolled-back', { name, toPackageHash: target.packageHash });
  return row;
}

export type LoadResult =
  | { state: 'ready'; name: string; snapshotDir: string; manifest: ManifestV1; packageHash: string; manifestHash: string; tier: TrustTier | undefined; readPaths: string[] }
  | { state: 'paused'; name: string; reason: 'changed'; cardId: string | null; files: TreeDiff; snapshotDir: string };

export interface LoadOptions {
  home: string;
  name: string;
  trust: RowVerifier;
  emit?: ManifestEventSink;
  /** principal recorded on a re-approve card raised by a linked-folder change (the kernel) */
  kernelPrincipal?: string;
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
  const dir = pinnedDir(opts.home, row.name, row.packageHash);
  const files = fs.existsSync(dir) ? hashPinnedTree(dir) : [];
  if (computePackageHash(files) !== row.packageHash) {
    emit('manifest.refuse', { name: row.name, code: 'INTEGRITY', packageHash: row.packageHash });
    throw new ManifestRefusal('INTEGRITY', `pinned snapshot of ${row.name} does not hash to ${row.packageHash}`, { name: row.name });
  }
  const tier = grants.trust.get(row.manifestHash);
  const manifest = validateManifest(JSON.parse(fs.readFileSync(path.join(dir, MANIFEST_FILE), 'utf8')), { tier: tier ?? 'local' });
  if (manifestHash(manifest) !== row.manifestHash) throw new ManifestRefusal('INTEGRITY', `manifestHash of ${row.name} does not match its grant`, { name: row.name });
  const check = checkAgainstGrants(manifest, row.manifestHash, grants);
  if (!check.ok) {
    emit('manifest.refuse', { name: row.name, code: 'GRANT', missingCapabilities: check.missingCapabilities, missingEgress: check.missingEgress });
    throw new ManifestRefusal('GRANT', `${row.name} requires ungranted capabilities or egress`, { name: row.name, missingCapabilities: check.missingCapabilities, missingEgress: check.missingEgress });
  }
  if (row.source.startsWith('linked:')) {
    const folder = row.source.slice(7);
    let changed: TreeDiff | null = null;
    try {
      const t = hashSourceTree(folder, row.name, noEvents);
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
  return { state: 'ready', name: row.name, snapshotDir: dir, manifest, packageHash: row.packageHash, manifestHash: row.manifestHash, tier, readPaths: check.read };
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
