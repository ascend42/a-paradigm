/**
 * Registry types — Full B (a) marketplace primitives, contracts-only.
 *
 * No live consumer at v6.0.3. These shapes are forward-compat surfaces for
 * the eventual nevr.land marketplace. Local code MAY emit/consume them but
 * MUST NOT depend on registry-side behavior beyond the typed shape itself.
 *
 * See docs/guides/agents.md#partners for narrative context.
 */

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
 * Contracts-only at v6.0.3 — install resolution against this shape lands with
 * nevr.land MVP. Until then, this type exists to keep the install hint
 * surface forward-compat.
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
