/**
 * Shift Guaranteed Files — manifest of all files/directories that must
 * exist after `paradigm shift` completes.
 *
 * Creation is idempotent: re-running shift never overwrites existing content.
 * See docs/specs/agent-adoption.md "Shift Guaranteed Files" section.
 */

import * as fs from 'fs/promises';
import * as path from 'path';

// ============================================================================
// Types
// ============================================================================

export interface GuaranteedFile {
  path: string;
  defaultContent: string;
  isDir?: boolean;
}

// ============================================================================
// Manifest
// ============================================================================

export const GUARANTEED_FILES: GuaranteedFile[] = [
  // ── Core Structure ──────────────────────────────────────────────────────
  {
    path: '.paradigm/config.yaml',
    defaultContent: [
      'version: "2.0"',
      'project: ""',
      'description: ""',
      'initialized: ""',
    ].join('\n') + '\n',
  },
  {
    path: '.paradigm/agents.yaml',
    defaultContent: [
      'version: "1.0"',
      'agents: []',
    ].join('\n') + '\n',
  },
  {
    path: '.paradigm/roster.yaml',
    defaultContent: [
      'version: "1.0"',
      'active: []',
    ].join('\n') + '\n',
  },
  {
    path: '.paradigm/adoptions.yaml',
    defaultContent: [
      'version: "1.0"',
      'adopted-at: ""',
      'project-type: ""',
      'agents: {}',
    ].join('\n') + '\n',
  },
  {
    path: '.paradigm/team-state.yaml',
    defaultContent: [
      'version: "1.0"',
      'models: {}',
      'state: {}',
    ].join('\n') + '\n',
  },
  {
    path: '.paradigm/fixtures.yaml',
    defaultContent: [
      'version: "1.0"',
      'fixtures: []',
    ].join('\n') + '\n',
  },
  {
    path: '.paradigm/navigator.yaml',
    defaultContent: [
      'version: "1.0"',
      'entries: []',
    ].join('\n') + '\n',
  },
  {
    path: '.paradigm/flows.yaml',
    defaultContent: [
      'version: "1.0"',
      'flows: []',
    ].join('\n') + '\n',
  },
  {
    path: '.paradigm/tags.yaml',
    defaultContent: [
      'version: "1.0"',
      'tags: []',
    ].join('\n') + '\n',
  },
  {
    path: '.paradigm/habits.yaml',
    defaultContent: [
      'version: "1.0"',
      'habits: []',
    ].join('\n') + '\n',
  },
  {
    path: '.paradigm/graduation.yaml',
    defaultContent: [
      'version: "1.0"',
      'graduations: []',
    ].join('\n') + '\n',
  },
  {
    path: 'portal.yaml',
    defaultContent: [
      'version: "2.0"',
      'gates: {}',
      'routes: {}',
    ].join('\n') + '\n',
  },
  {
    path: '.purpose',
    defaultContent: [
      'version: "2.0"',
      'id: root',
      'description: ""',
      'components: []',
    ].join('\n') + '\n',
  },
  {
    path: '.premise',
    defaultContent: [
      'version: "1.0"',
      'premise: ""',
    ].join('\n') + '\n',
  },

  // ── Event Streams ──────────────────────────────────────────────────────
  { path: '.paradigm/events/stream.jsonl', defaultContent: '' },
  { path: '.paradigm/events/nominations.jsonl', defaultContent: '' },
  { path: '.paradigm/events/debates.jsonl', defaultContent: '' },
  { path: '.paradigm/events/notebook-refs.jsonl', defaultContent: '' },
  { path: '.paradigm/events/session-log.jsonl', defaultContent: '' },

  // ── History & Knowledge ────────────────────────────────────────────────
  {
    path: '.paradigm/history/index.yaml',
    defaultContent: [
      'version: "1.0"',
      'entries: []',
    ].join('\n') + '\n',
  },
  { path: '.paradigm/history/log.jsonl', defaultContent: '' },
  {
    path: '.paradigm/lore/timeline.yaml',
    defaultContent: [
      'version: "1.0"',
      'entries: []',
    ].join('\n') + '\n',
  },
  {
    path: '.paradigm/wisdom/antipatterns.yaml',
    defaultContent: [
      'version: "1.0"',
      'antipatterns: []',
    ].join('\n') + '\n',
  },
  {
    path: '.paradigm/personas/index.yaml',
    defaultContent: [
      'version: "1.0"',
      'personas: {}',
    ].join('\n') + '\n',
  },
  {
    path: '.paradigm/protocols/index.yaml',
    defaultContent: [
      'version: "1.0"',
      'protocols: []',
    ].join('\n') + '\n',
  },
  { path: '.paradigm/notebooks/', defaultContent: '', isDir: true },

  // ── University ─────────────────────────────────────────────────────────
  {
    path: '.paradigm/university/config.yaml',
    defaultContent: [
      'version: "1.0"',
      'enabled: true',
      'auto-enroll: true',
    ].join('\n') + '\n',
  },
  {
    path: '.paradigm/university/index.yaml',
    defaultContent: [
      'version: "1.0"',
      'entries: []',
    ].join('\n') + '\n',
  },
  { path: '.paradigm/university/content/notes/', defaultContent: '', isDir: true },
  { path: '.paradigm/university/content/policies/', defaultContent: '', isDir: true },
  { path: '.paradigm/university/content/quizzes/', defaultContent: '', isDir: true },
  { path: '.paradigm/university/content/paths/', defaultContent: '', isDir: true },

  // ── IDE & Hooks ────────────────────────────────────────────────────────
  {
    path: 'CLAUDE.md',
    defaultContent: '# Project Context\n\nGenerated by paradigm shift.\n',
  },
  {
    path: 'AGENTS.md',
    defaultContent: '# Agents\n\nGenerated by paradigm shift.\n',
  },
  { path: '.cursor/rules/', defaultContent: '', isDir: true },
  { path: '.claude/hooks/', defaultContent: '', isDir: true },
];

// ============================================================================
// Ensure all guaranteed files exist
// ============================================================================

/**
 * Iterates the GUARANTEED_FILES manifest and creates any missing
 * files or directories. Existing content is never overwritten.
 *
 * @param rootDir - Absolute path to the project root
 * @returns Lists of created and already-existing paths
 */
export async function ensureGuaranteedFiles(
  rootDir: string,
): Promise<{ created: string[]; existed: string[] }> {
  const created: string[] = [];
  const existed: string[] = [];

  for (const entry of GUARANTEED_FILES) {
    const fullPath = path.join(rootDir, entry.path);

    if (entry.isDir) {
      const dirExists = await fileExists(fullPath);
      if (dirExists) {
        existed.push(entry.path);
      } else {
        await fs.mkdir(fullPath, { recursive: true });
        created.push(entry.path);
      }
    } else {
      const exists = await fileExists(fullPath);
      if (exists) {
        existed.push(entry.path);
      } else {
        // Ensure parent directory exists
        const parentDir = path.dirname(fullPath);
        await fs.mkdir(parentDir, { recursive: true });
        await fs.writeFile(fullPath, entry.defaultContent, 'utf-8');
        created.push(entry.path);
      }
    }
  }

  return { created, existed };
}

// ============================================================================
// Helpers
// ============================================================================

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
