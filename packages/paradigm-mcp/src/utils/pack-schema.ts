/**
 * pack-schema.ts — v6.5 University Sections: Zod schemas + constants.
 *
 * Canonical home for the Section schema. Consumed by `pack-loader.ts` for
 * manifest validation and synthesis. Centralized here so future schema
 * touches don't drift between writer (loader) and validator (CLI/MCP tools).
 *
 * Security contract:
 *   - Schema error messages are CLASSIFIER-only — never echo field values.
 *     `pack-loader.ts` further wraps Zod failures in `PackLoadError(
 *     'manifest-invalid', <fixed-classifier>)` so the SECRET_SENTINEL
 *     discipline established in pack-loader.test.ts is preserved.
 */

import { z } from 'zod';

/** Identifier discipline for section ids — kebab-case, ≤ 64 chars. */
export const SECTION_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Allowed section presentation styles. UI dispatches on this enum. */
export const SECTION_STYLES = ['track', 'index', 'chronological', 'featured'] as const;

/** Hard cap on sections per pack (defence-in-depth against runaway manifests). */
export const MAX_SECTIONS_PER_PACK = 64;

/**
 * Zod schema for a single Section. `.strict()` to reject unknown fields —
 * forward-compat additions go through a schema bump, not silent acceptance.
 */
export const SectionSchema = z
  .object({
    id: z.string().regex(SECTION_ID_RE, 'invalid section id'),
    name: z.string().min(1).max(120),
    order: z.number().int().min(0).max(9999),
    style: z.enum(SECTION_STYLES, {
      errorMap: () => ({ message: `section.style must be one of ${SECTION_STYLES.join('|')}` }),
    }),
    description: z.string().max(1000).optional(),
    // Strict boolean — rejects "true"/"false" strings and 0/1 numerics.
    default: z.boolean({ invalid_type_error: 'section.default must be a boolean' }).optional(),
  })
  .strict();

/** Zod array schema with the per-pack section cap. */
export const SectionsArraySchema = z
  .array(SectionSchema)
  .max(MAX_SECTIONS_PER_PACK, `sections must contain ≤${MAX_SECTIONS_PER_PACK} entries`);

/**
 * Loose schema for the slice of `pack.yaml` we care about at v6.5 — only
 * `sections`. `.passthrough()` because the rest of the manifest is validated
 * elsewhere in pack-loader.
 */
export const PackManifestSectionsSchema = z
  .object({
    sections: SectionsArraySchema.optional(),
  })
  .passthrough();

/**
 * Schema for the v6.5-additive entry frontmatter fields. `.passthrough()`
 * because frontmatter carries many more fields than these two — we only
 * validate the section reference here.
 */
export const EntrySectionRefSchema = z
  .object({
    section: z.string().regex(SECTION_ID_RE).optional(),
    order: z.number().int().min(0).max(9999).optional(),
  })
  .passthrough();
