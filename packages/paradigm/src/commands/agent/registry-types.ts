/**
 * Registry types — Full B (a) marketplace primitives, contracts-only.
 *
 * Typed shapes written for a marketplace registry. The nevr.land registry they
 * were designed for was removed in 8.0.2 and must not be re-added. Local code
 * MAY emit/consume them but MUST NOT depend on registry-side behavior beyond
 * the typed shape itself. NOTE: `PartnerCoverage` now has a live consumer
 * (registry.ts) — treat "contracts-only" per-type, not file-wide.
 *
 * See docs/guides/agents.md#partners for narrative context.
 */

import type { ExerciseIntensity } from '@a-company/premise-core';

/**
 * Groups partnered agents into a single SKU.
 *
 * The bundle is the explicit grouping primitive (vs reciprocal-install which
 * is an implicit grouping derived from `partners[]`).
 */
export interface PartnerBundle {
  /** Bundle slug — kebab-case, unique within registry */
  id: string;
  /** Display name (e.g., "Scholar + Sheila Pair") */
  name: string;
  /** Agent ids that travel together; must be ≥2 */
  members: string[];
  /** Short description of why these agents pair */
  description?: string;
  /** Optional version pin per member; absent = registry-default */
  versions?: Record<string, string>;
}

/**
 * Typed metadata that an agent's install should prompt-install its partners.
 *
 * Contracts-only: nothing resolves an install against this shape. The registry
 * it was written for (nevr.land) was removed in 8.0.2; the type remains so the
 * install hint surface keeps its shape.
 */
export interface ReciprocalInstallMeta {
  /** Partner agent id whose install is recommended */
  partnerId: string;
  /** Whether the prompt should default to "install" or "skip" */
  defaultAction: 'install' | 'skip';
  /** Free-form rationale shown in the prompt (e.g., "scholar + sheila are stronger together") */
  rationale?: string;
}

/**
 * Registry-index indicator marking which agents have partners and showing pairs.
 *
 * Useful at registry render time (e.g., a search result page can mark "↔ paired"
 * agents). Locally, surfaced via paradigm_agent_get when present in registry response.
 */
export interface PartnerCoverage {
  /** Agent id this coverage describes */
  agentId: string;
  /** Whether the agent has any partners declared */
  hasPartners: boolean;
  /** Partner agent ids (empty when hasPartners=false) */
  partnerIds: string[];
  /** Whether all declared partners are reciprocal in the registry */
  fullyReciprocal: boolean;
}

/**
 * CalibrationPrior — the ONLY calibration signal safe to publish (decision
 * TD-2026-06-26-881, accepted): a notebook-hash's POPULATION outcome
 * distribution, never a local trust number. An imported prior sets a fresh
 * install's START-POINT shape; local trust is earned per-project.
 *
 * ⚠️ DO NOT RENDER a scalar `calibration: X%` from this until (amend 1/7):
 *   (a) `exerciseIntensity.adversarialProbes` clears a floor, AND
 *   (b) `sampleSize` clears a floor.
 * Below the floor, render "unproven (n=…)", never a percentage — a survivalShape
 * of decay-minted (idle-project) survivals would otherwise launder the moat.
 *
 * Contracts-only: no publish pipeline ships until TD-2026-06-26-881's
 * blocking_prerequisites (real resolved certs + a tamper-evident notebookHash)
 * are met. `notebookHash` is a PLACEHOLDER identity, not yet defined.
 */
export interface CalibrationPrior {
  /** Population identity = hash(training/notebook). PLACEHOLDER — see amend 2. */
  notebookHash: string;
  /** # of projects/terms aggregated (0 ⇒ omit the prior). */
  sampleSize: number;
  /** Distribution, NOT a scalar: keep `pending`+`unproven` for transparency (amend 4). */
  survivalShape: {
    survived: number;
    overturned: number;
    pending: number;
    /** Aged without exercise — the honest floor (never folded into a rate). */
    unproven: number;
  };
  /**
   * The exercise-intensity denominator (amend 1) — the cross-project SUM of the
   * SAME `ExerciseIntensity` shape carried per-cert locally (one contract, not
   * two; defined in premise-core). High `survived` with near-zero
   * `adversarialProbes` MUST render "unproven".
   */
  exerciseIntensity: ExerciseIntensity;
  /** # distinct projects contributing (idle throwaway projects can't inflate). */
  distinctProjects: number;
  /** ISO; priors decay and must be refreshed (amend 9 — enforced by consumer). */
  asOf: string;
}
