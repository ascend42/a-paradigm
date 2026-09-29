/**
 * Skills primitive — type definitions (Phase 1, T-2026-09-26-002).
 *
 * A skill is an agent-owned `SKILL.md` source (agentskills.io / Claude Code
 * format) whose Paradigm metadata lives NESTED under `metadata.paradigm`.
 * Sources resolve project `.paradigm/skills/<id>/` › global
 * `~/.paradigm/skills/<id>/`. Projection (#skill-projector) FLATTENS the nested
 * block into a host-conformant string→string map (`paradigm-id`, …) — projected
 * files never carry nested objects.
 *
 * `SkillStatus` is COMPUTED (#skill-loader computeStatus), never stored.
 */

export type SkillTrust = 'certified' | 'provisional' | 'external';

export type SkillScope = 'project' | 'global' | 'bundled';

export type SkillProvenanceSource = 'bundled' | 'authored' | 'adopted' | 'registry';

export interface SkillCertification {
  /** The human (founder) who confirmed at the TTY. */
  approvedBy: string;
  approvedAt: string;
  /** Project the sign-off happened in. Certification is GLOBAL (founder resolution). */
  project: string;
  /** Qualifying scenario ids. */
  scenarios: string[];
  /** `sha256:<hex>` — computeContentHash of the certified source. */
  contentHash: string;
}

export interface ParadigmSkillMeta {
  id: string;
  /** semver */
  version: string;
  /** Agent id that owns the skill. */
  steward: string;
  triggers?: { concepts?: string[]; symbols?: string[]; paths?: string[] };
  trust: SkillTrust;
  provenance: {
    source: SkillProvenanceSource;
    createdBy: string;
    originProject?: string;
    upstream?: string;
    /** e.g. "designer.agent#behaviors.review-checklist" */
    migratedFrom?: string;
  };
  /** "<agent>/<nb-id>" */
  notebooks?: string[];
  protocols?: string[];
  /** tool name → "sha256:<hex>" | semver | "host" | "*" */
  tools?: Record<string, string>;
  hosts?: string[];
  certification?: SkillCertification;
}

/** The frontmatter as written in a SOURCE SKILL.md. */
export interface SkillFrontmatter {
  name: string;
  description: string;
  'allowed-tools'?: string;
  metadata: { paradigm: ParadigmSkillMeta };
}

export interface SkillFile extends SkillFrontmatter {
  /** Markdown body (everything after the closing `---`). */
  body: string;
  /** Absolute skill directory (contains SKILL.md). */
  dir: string;
  scope: SkillScope;
}

/** 'ok' = certified + hash-valid; 'uncertified' = provisional/external/tampered; 'stale' = pin mismatch; 'invalid' = lint errors. */
export type SkillStatus = 'ok' | 'uncertified' | 'stale' | 'invalid';

export interface SkillSummary {
  id: string;
  /** Invocable name: `pdg-<id>` when projected, else the source `name`. */
  name: string;
  description: string;
  /** Projected dir if it exists, else the source dir. */
  path: string;
  trust: SkillTrust;
  status: SkillStatus;
  role: 'owns' | 'uses';
  /** Additive (not in spec schema): needed for steward-only visibility. */
  steward: string;
  version: string;
}

export interface SkillUsageRow {
  ts: string;
  skillId: string;
  version: string;
  agent?: string;
  orchestrationId?: string;
  host: string;
  /** `skill:<id>@<version>` — identical to the scenario probe learning_ref and cert row entryId. */
  entryId?: string;
}

/** Flattened projected metadata — strings only (founder resolution). */
export interface ProjectedSkillMetadata {
  'paradigm-id': string;
  'paradigm-version': string;
  'paradigm-steward': string;
  'paradigm-trust': string;
  'paradigm-source': string;
}

/** `.pdg-generated.json` sidecar written next to a projected SKILL.md. */
export interface ProjectionMarker {
  skillId: string;
  version: string;
  sourcePath: string;
  /** computeContentHash of the source at projection time. */
  sourceHash: string;
  /** Tree hash of the projected dir (marker excluded). */
  contentHash: string;
  pinsUnverified: boolean;
  /** scripts/ was NOT projected because the skill is not certified. Absent = false. */
  scriptsWithheld?: boolean;
  generatedAt: string;
}
