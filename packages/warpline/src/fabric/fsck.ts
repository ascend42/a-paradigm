/**
 * #fabric-fsck — `warpline fsck`: the INTEGRITY UMBRELLA (M3-lite I5,
 * m3-integrity-design-2026-08-23.md §3 + §6).
 *
 * ONE read-only pass aggregating every custody check the individual verbs
 * already run — fsck adds AGGREGATION and SECTIONING, never verification
 * machinery of its own:
 *
 *   1. fabric   — verifyFabric verbatim (integrity + chain + DAG + bindings +
 *                 anchor + the I4 signature walk + the signing summary).
 *   2. objects  — ObjectStore.verify() verbatim (the `objects verify` re-hash
 *                 of every loose object against its content-address).
 *   3. refs     — the refs cross-checks verifyFabric ALREADY exposes
 *                 (ref-unresolved failures + the abandoned-heads report),
 *                 re-sectioned; nothing re-implemented. (Selvage-tip drift
 *                 surfaces as a fabric chain-break — verify's existing
 *                 vocabulary — and stays in the fabric section.)
 *   4. registry — readKeyRegistry / listKeySummaries diagnostics: a malformed
 *                 row is a FAILURE (a garbled line in an append-only registry
 *                 is tamper/corruption evidence — it is already skipped
 *                 fail-closed by every reader; fsck makes it non-deniable); a
 *                 latest-row key FILE missing is a WARNING, never a failure (a
 *                 verifier box may hold no private keys — verification uses
 *                 REGISTRY public keys, never key files); extra signed-from
 *                 rows are NOTED as warnings (ignored by design — the first
 *                 pin is authoritative forever); a signed-from row naming a
 *                 pickId absent from the fabric is a FAILURE (verifyFabric's
 *                 registry-invalid, routed here — the boundary itself is
 *                 unverifiable).
 *   5. stakes   — the C-6 stake-journal cross-check verifyFabric ALREADY runs
 *                 (stake-journal-orphan), re-sectioned. A grades↔fabric
 *                 cross-check is deliberately ABSENT: no exported check exists
 *                 (gradeFabric is a scoring report, not an integrity check),
 *                 and I5's rule is reuse-only — noted in the section.
 *
 * Overall ok = every section ok; a section is ok iff it has no FAIL-level
 * finding (warnings never fail — exit stays 0).
 *
 * Read-only — never writes .warpline/. Library code: no console output — the
 * CLI prints.
 */

import { verifyFabric, type FabricVerifyFailure, type FabricVerifyReport } from './verify.js';
import { readKeyRegistry, listKeySummaries } from './keys.js';
import { ObjectStore, type VerifyReport as ObjectsVerifyReport } from '../warp/object-store.js';

export type FsckLevel = 'warn' | 'fail';

export interface FsckFinding {
  level: FsckLevel;
  /** the failure vocabulary — FabricVerifyKind for routed verify failures, fsck's own kinds for registry diagnostics. */
  kind: string;
  message: string;
}

export interface FsckSection {
  /** no FAIL-level findings (warnings never fail a section). */
  ok: boolean;
  findings: FsckFinding[];
  /** informational lines the CLI prints alongside the verdict (counts, epoch state). */
  notes: string[];
}

export interface FsckSections {
  fabric: FsckSection;
  objects: FsckSection;
  refs: FsckSection;
  registry: FsckSection;
  stakes: FsckSection;
}

export interface FsckReport {
  /** every section ok. */
  ok: boolean;
  sections: FsckSections;
}

export interface FsckOptions {
  /** inject an ObjectStore (tests); defaults to the store at `root`. */
  store?: ObjectStore;
}

/** verifyFabric kinds re-sectioned out of `fabric` into their owning section. */
const REFS_KINDS = new Set<string>(['ref-unresolved']);
const REGISTRY_KINDS = new Set<string>(['registry-invalid']);
const STAKE_KINDS = new Set<string>(['stake-journal-orphan']);

function findingOfFailure(f: FabricVerifyFailure): FsckFinding {
  return {
    level: 'fail',
    kind: f.kind,
    message: `seq ${f.seq}  ${f.pickId}  ${f.detail}`,
  };
}

function sectionOf(findings: FsckFinding[], notes: string[]): FsckSection {
  return { ok: findings.every((f) => f.level !== 'fail'), findings, notes };
}

/** The signing summary line — same vocabulary the `fabric verify` CLI renders. */
function signingNoteOf(report: FabricVerifyReport): string {
  if (!report.signing.epochPinned) {
    return 'signing epoch: none (no signed-from pinned — every strand exempt)';
  }
  const from = report.signing.signedFromPickId ?? '(genesis)';
  return `signing epoch from ${from} — ${report.signing.signed} signed, ${report.signing.exempt} exempt`;
}

/**
 * Run every custody check in one pass. Pure over the on-disk ledger, object
 * store, refs, key registry and stake journal — reuses the existing verify
 * functions verbatim and only re-sections their findings.
 */
export function runFsck(root: string, opts: FsckOptions = {}): FsckReport {
  const store = opts.store ?? new ObjectStore(root);

  /* ── 1+3+5. one verifyFabric call feeds three sections ─────────────────── */
  const fabricReport = verifyFabric(root);
  const fabricFindings: FsckFinding[] = [];
  const refsFindings: FsckFinding[] = [];
  const registryFindings: FsckFinding[] = [];
  const stakesFindings: FsckFinding[] = [];
  for (const f of fabricReport.failures) {
    if (REFS_KINDS.has(f.kind)) refsFindings.push(findingOfFailure(f));
    else if (REGISTRY_KINDS.has(f.kind)) registryFindings.push(findingOfFailure(f));
    else if (STAKE_KINDS.has(f.kind)) stakesFindings.push(findingOfFailure(f));
    else fabricFindings.push(findingOfFailure(f));
  }

  const fabricNotes: string[] = [
    `${fabricReport.checked} strand(s): v1 ${fabricReport.v1Prefix.count} · v2 ${fabricReport.v2Chain.count} · v3 ${fabricReport.v3Dag.count}`,
    signingNoteOf(fabricReport),
  ];
  if (fabricReport.legacyUnverifiable.count) {
    fabricNotes.push(`${fabricReport.legacyUnverifiable.count} grandfathered legacy strand(s) (soft — TD-2026-07-01-202)`);
  }

  /* ── 2. objects — the `objects verify` re-hash, verbatim ───────────────── */
  const objectsReport: ObjectsVerifyReport = store.verify();
  const objectsFindings: FsckFinding[] = objectsReport.corrupt.map((id) => ({
    level: 'fail' as const,
    kind: 'corrupt-object',
    message: `${id} does not recompute to its on-disk location (tampered/corrupt loose object)`,
  }));
  const objectsNotes = [`${objectsReport.checked} loose object(s) re-hashed`];

  /* ── 3. refs — abandoned heads are REPORTED, never failures ────────────── */
  for (const h of fabricReport.abandonedHeads) {
    refsFindings.push({
      level: 'warn',
      kind: 'abandoned-head',
      message: `headless tip ${h} — no ref names it (legal; recover with \`warpline refs set <name> ${h}\`)`,
    });
  }

  /* ── 4. registry health — readKeyRegistry diagnostics ──────────────────── */
  const registry = readKeyRegistry(root);
  for (const m of registry.malformed) {
    registryFindings.push({
      level: 'fail',
      kind: 'registry-malformed-row',
      message:
        `registry.jsonl line ${m.line}: ${m.reason} — skipped fail-closed (can never resolve to a key); ` +
        `a garbled row in an append-only registry is tamper/corruption evidence`,
    });
  }
  const summaries = listKeySummaries(root);
  for (const k of summaries.keys) {
    if (k.latest && !k.keyFilePresent) {
      registryFindings.push({
        level: 'warn',
        kind: 'key-file-missing',
        message:
          `principal "${k.principal}": latest registry key ${k.keyId} has no matching key file on this box — ` +
          `verification is UNAFFECTED (the registry public key verifies; a verifier box may hold no private keys); ` +
          `sealing as "${k.principal}" here will refuse until re-mint`,
      });
    }
  }
  const signedFromRows = registry.rows.filter((r) => r.kind === 'signed-from');
  if (signedFromRows.length > 1) {
    registryFindings.push({
      level: 'warn',
      kind: 'signed-from-duplicate',
      message:
        `${signedFromRows.length - 1} extra signed-from row(s) — IGNORED by design (the first pin is ` +
        `authoritative forever; a movable boundary would un-sign history)`,
    });
  }
  const agentKeyCount = registry.rows.filter((r) => r.kind === 'agent-key').length;
  const registryNotes = [
    agentKeyCount
      ? `${agentKeyCount} agent-key row(s), ${signedFromRows.length} signed-from row(s)`
      : 'no key registry (pre-M3 world — nothing to check)',
  ];

  /* ── 5. stakes — the C-6 cross-check verifyFabric already ran ──────────── */
  const stakesNotes = [
    fabricReport.stakeJournal.present
      ? `${fabricReport.stakeJournal.attested} checkpoint attestation(s) cross-checked`
      : 'no stake journal (advisory-in — absence of evidence is not evidence of truncation)',
    'grades: no exported grade↔fabric cross-check exists — skipped (I5 is reuse-only)',
  ];

  const sections: FsckSections = {
    fabric: sectionOf(fabricFindings, fabricNotes),
    objects: sectionOf(objectsFindings, objectsNotes),
    refs: sectionOf(refsFindings, []),
    registry: sectionOf(registryFindings, registryNotes),
    stakes: sectionOf(stakesFindings, stakesNotes),
  };

  return {
    ok: Object.values(sections).every((s) => s.ok),
    sections,
  };
}
