/**
 * #frontmatter-parser — the ONE shared YAML-frontmatter splitter (D8, 7.12.0).
 *
 * Replaces three hand-rolled copies (memory-scan fail-open, skill-loader
 * strict/throwing, docs-loader null-returning) with a single regex + two modes:
 *
 *   - lenient (default): never throws. No frontmatter → whole input is body,
 *     `hasFrontmatter:false`. Malformed YAML or a non-mapping block → `data:{}`,
 *     body = text after the closing fence, `hasFrontmatter:true`, `error` set.
 *   - strict: throws FrontmatterError on missing frontmatter, malformed YAML
 *     (message = the YAML parser's own message, unchanged), or non-mapping.
 *
 * The strict error messages are a CONTRACT — skill-loader surfaces them verbatim
 * inside SkillParseError. Do not reword them.
 *
 * Library code: no console output.
 */

import * as yaml from 'js-yaml';

export type FrontmatterMode = 'lenient' | 'strict';

export interface FrontmatterResult {
  /** Parsed YAML mapping ({} when absent / malformed in lenient mode). */
  data: Record<string, unknown>;
  /** Everything after the closing fence (the whole input when there is no frontmatter). */
  body: string;
  /** True when a `--- … ---` block was found at the very start of the input. */
  hasFrontmatter: boolean;
  /** Lenient mode only: why `data` is empty despite a fenced block. */
  error?: string;
}

/**
 * Opening fence, captured block, closing fence on its own line (then newline or
 * EOF), captured body. Accepts LF and CRLF.
 */
export const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/;

/** Adjacent fences (`---\n---`) — FRONTMATTER_RE needs a newline between them. */
const EMPTY_FRONTMATTER_RE = /^---\r?\n---(?:\r?\n|$)([\s\S]*)$/;

/** Strict-mode message when no fenced block opens the input. */
export const FRONTMATTER_MISSING_MESSAGE = 'missing YAML frontmatter (--- … ---)';
/** Strict-mode message when the block parses to a scalar / array / null. */
export const FRONTMATTER_NOT_MAPPING_MESSAGE = 'frontmatter is not a YAML mapping';

export class FrontmatterError extends Error {
  constructor(
    message: string,
    public readonly reason: 'missing' | 'yaml' | 'not-mapping',
  ) {
    super(message);
    this.name = 'FrontmatterError';
  }
}

/**
 * Split leading YAML frontmatter from a markdown-ish document.
 * @see FrontmatterMode for lenient vs strict semantics.
 */
export function parseFrontmatter(
  raw: string,
  opts?: { mode?: FrontmatterMode },
): FrontmatterResult {
  const strict = opts?.mode === 'strict';
  const m = FRONTMATTER_RE.exec(raw);
  if (!m) {
    // Strict keeps the pre-7.12 skill-loader behavior EXACTLY: `---\n---\n`
    // (adjacent fences) never matched its regex → 'missing'.
    if (strict) throw new FrontmatterError(FRONTMATTER_MISSING_MESSAGE, 'missing');
    // Lenient: adjacent fences = present-but-empty frontmatter.
    const empty = EMPTY_FRONTMATTER_RE.exec(raw);
    if (empty) return { data: {}, body: empty[1] ?? '', hasFrontmatter: true };
    return { data: {}, body: raw, hasFrontmatter: false };
  }

  const fmText = m[1];
  const body = m[2] ?? '';

  let loaded: unknown;
  try {
    loaded = yaml.load(fmText);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (strict) throw new FrontmatterError(message, 'yaml');
    return { data: {}, body, hasFrontmatter: true, error: message };
  }

  if (!loaded || typeof loaded !== 'object' || Array.isArray(loaded)) {
    if (strict) throw new FrontmatterError(FRONTMATTER_NOT_MAPPING_MESSAGE, 'not-mapping');
    return { data: {}, body, hasFrontmatter: true, error: FRONTMATTER_NOT_MAPPING_MESSAGE };
  }

  return { data: loaded as Record<string, unknown>, body, hasFrontmatter: true };
}
