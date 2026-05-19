/**
 * Section loader — v6.5 University Sections (architect-2 reconciliation).
 *
 * Sections group courses at the learning-path layer. They live in
 * `pack.yaml` under the `sections:` key. v6.5 implements only the
 * `track` style; other styles parse and warn (UI degrades to track).
 *
 * Server-local types — do NOT import from paradigm-mcp. The university
 * package has no dependency on paradigm-mcp at v6.x.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import chalk from 'chalk';

export type SectionStyle = 'track' | 'index' | 'chronological' | 'featured';

export interface Section {
  id: string;
  name: string;
  order: number;
  style: SectionStyle;
  description?: string;
  default?: boolean;
}

const VALID_STYLES: ReadonlySet<SectionStyle> = new Set<SectionStyle>([
  'track',
  'index',
  'chronological',
  'featured',
]);

// ── Local logger (mirrors index.ts shape; kept here to avoid a circular
// import between index.ts and routes/courses.ts) ──
function warn(component: string, msg: string, data?: Record<string, unknown>): void {
  const symbol = chalk.magenta(`#${component}`);
  const dataStr = data
    ? chalk.gray(` ${Object.entries(data).map(([k, v]) => `${k}=${v}`).join(' ')}`)
    : '';
  console.log(`${chalk.yellow('⚠')} ${symbol} ${msg}${dataStr}`);
}

export const IMPLICIT_DEFAULT_SECTIONS: Section[] = [
  { id: 'main', name: 'Main', order: 0, style: 'track', default: true },
];

/**
 * Validate and normalize a raw sections array from a pack manifest.
 * Drops invalid entries with a warn; coerces missing order to index.
 * Returns the implicit default if the resulting list is empty.
 */
export function normalizeSections(raw: unknown): Section[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    return [...IMPLICIT_DEFAULT_SECTIONS];
  }

  const out: Section[] = [];
  raw.forEach((entry, idx) => {
    if (!entry || typeof entry !== 'object') {
      warn('university-server', 'Dropping invalid section entry (not an object)', { index: idx });
      return;
    }
    const e = entry as Record<string, unknown>;
    const id = typeof e.id === 'string' ? e.id : null;
    const name = typeof e.name === 'string' ? e.name : null;
    const styleRaw = typeof e.style === 'string' ? e.style : null;

    if (!id || !name || !styleRaw) {
      warn('university-server', 'Dropping section: missing id/name/style', { index: idx, id: String(id) });
      return;
    }
    if (!VALID_STYLES.has(styleRaw as SectionStyle)) {
      warn('university-server', 'Dropping section: unknown style', { id, style: styleRaw });
      return;
    }
    const style = styleRaw as SectionStyle;

    let order: number;
    if (typeof e.order === 'number' && Number.isFinite(e.order)) {
      order = e.order;
    } else {
      order = idx;
    }

    const section: Section = { id, name, order, style };
    if (typeof e.description === 'string') section.description = e.description;
    if (e.default === true) section.default = true;

    if (style !== 'track') {
      warn('university-server', 'Section style not yet implemented — UI will fall back to track', { id, style });
    }

    out.push(section);
  });

  if (out.length === 0) {
    return [...IMPLICIT_DEFAULT_SECTIONS];
  }

  out.sort((a, b) => a.order - b.order);
  return out;
}

/**
 * Read sections from a pack.yaml file. Returns the implicit default
 * if the file is missing or has no `sections:` block.
 */
export function loadSectionsFromYamlFile(yamlPath: string): Section[] {
  if (!fs.existsSync(yamlPath)) {
    return [...IMPLICIT_DEFAULT_SECTIONS];
  }
  try {
    const raw = fs.readFileSync(yamlPath, 'utf-8');
    const data = (yaml.load(raw) as Record<string, unknown> | null) ?? {};
    return normalizeSections(data.sections);
  } catch {
    warn('university-server', 'Could not parse pack.yaml for sections — using implicit default', { path: yamlPath });
    return [...IMPLICIT_DEFAULT_SECTIONS];
  }
}

/**
 * Resolve sections for the current server instance based on mode +
 * project/content dirs. Used by both /api/pack-config and /api/courses.
 */
export function resolveSections(
  mode: 'paradigm' | 'project',
  contentDir: string,
  projectDir?: string,
): Section[] {
  if (mode === 'project' && projectDir) {
    return loadSectionsFromYamlFile(path.join(projectDir, '.paradigm', 'university', 'pack.yaml'));
  }
  // Paradigm mode (and bundled first-party path): pack.yaml inside contentDir.
  return loadSectionsFromYamlFile(path.join(contentDir, 'pack.yaml'));
}

/**
 * Section-assignment rule (architect-2 spec):
 *
 *   If a course's LP-*.yaml omits `section:`, assign it to the pack's
 *   default section (`default: true`). If no section is marked default
 *   but exactly one section is declared, use that section's id. Else
 *   fall back to `'main'`.
 *
 * If the course YAML provided a non-empty section value, that value is
 * returned verbatim (no validation against the section list — the spec
 * says section assignment is path-level authority, the UI handles
 * unknown ids gracefully).
 */
export function assignSectionId(courseSection: string | undefined, sections: Section[]): string {
  if (typeof courseSection === 'string' && courseSection.trim().length > 0) {
    return courseSection.trim();
  }
  const explicitDefault = sections.find(s => s.default === true);
  if (explicitDefault) return explicitDefault.id;
  if (sections.length === 1) return sections[0].id;
  return 'main';
}
