/**
 * paradigm teach --home <repo|user> [entry-ids...] — confirm or flip the home
 * of taught lessons (scoped learning S3, TD-2026-10-28-820).
 *
 * The commit guard refuses a `human-taught` notebook entry whose home was only
 * inferred (`home_source: inferred`) in a public repository. This is the
 * human's answer:
 *   --home repo  the lesson belongs to the repo: stamp `home: repo` and
 *                `home_source: explicit`, so the commit passes;
 *   --home user  it is just yours: move the entry to your user notebooks
 *                (~/.paradigm/notebooks/<agent>/) with `home_source: explicit`.
 * With no ids, every inferred human-taught entry in the repo notebooks is
 * handled. Safe to run twice: an explicit entry is no longer selected.
 *
 * Symbol: #teach-command
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { out, success, warn, dim, json as jsonOut } from '../utils/cli-output.js';
import { pathFor, type LearningHome } from '../../../paradigm-mcp/src/utils/learning-stores.js';
import { isHumanTaughtInferred } from '../../../paradigm-mcp/src/utils/learning-commit-guard.js';
import { teachConfirmationLine } from '../../../paradigm-mcp/src/utils/teach-home.js';

export interface TeachHomeOptions {
  home: string;
  ids?: string[];
  json?: boolean;
}

export interface TeachHomeChange {
  id: string;
  agent: string;
  home: Extract<LearningHome, 'repo' | 'user'>;
  from: string;
  to: string;
}

type Entry = Record<string, unknown>;

function* repoNotebookFiles(root: string): Generator<{ agent: string; file: string }> {
  const dir = path.join(root, '.paradigm', 'notebooks');
  let agents: fs.Dirent[];
  try {
    agents = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const a of agents) {
    if (!a.isDirectory()) continue;
    let files: string[];
    try {
      files = fs.readdirSync(path.join(dir, a.name));
    } catch {
      continue;
    }
    for (const f of files) if (f.endsWith('.yaml') || f.endsWith('.yml')) yield { agent: a.name, file: path.join(dir, a.name, f) };
  }
}

/**
 * Confirm (`repo`) or flip (`user`) the home of repo notebook entries. Selects
 * the given ids, else every inferred human-taught entry. Returns the changes.
 */
export function confirmTeachHome(rootDir: string, home: 'repo' | 'user', ids?: string[]): TeachHomeChange[] {
  const root = path.resolve(rootDir);
  const wanted = ids && ids.length > 0 ? new Set(ids) : null;
  const changes: TeachHomeChange[] = [];
  for (const { agent, file } of repoNotebookFiles(root)) {
    let entry: Entry;
    try {
      const parsed = yaml.load(fs.readFileSync(file, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
      entry = parsed as Entry;
    } catch {
      continue;
    }
    const id = typeof entry.id === 'string' ? entry.id : path.basename(file, path.extname(file));
    if (wanted ? !wanted.has(id) : !isHumanTaughtInferred(entry)) continue;
    const next = { ...entry, home, home_source: 'explicit', updated: new Date().toISOString() };
    const body = yaml.dump(next, { lineWidth: 120, noRefs: true, sortKeys: false });
    if (home === 'repo') {
      fs.writeFileSync(file, body, 'utf8');
      changes.push({ id, agent, home, from: file, to: file });
    } else {
      const to = path.join(pathFor('notebooks', 'user', root), agent, path.basename(file));
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.writeFileSync(to, body, 'utf8');
      fs.unlinkSync(file);
      changes.push({ id, agent, home, from: file, to });
    }
  }
  return changes;
}

export async function teachHomeCommand(options: TeachHomeOptions): Promise<boolean> {
  if (options.home !== 'repo' && options.home !== 'user') {
    warn('--home must be repo or user');
    return false;
  }
  const changes = confirmTeachHome(process.cwd(), options.home, options.ids);
  if (options.json) {
    jsonOut({ home: options.home, changes });
    return true;
  }
  if (changes.length === 0) {
    success(options.ids?.length ? 'no matching repo notebook entries' : 'no inferred human-taught lessons to confirm');
    return true;
  }
  for (const c of changes) {
    out(`  ${teachConfirmationLine(c.agent, c.home, 'explicit')} (${c.id})`);
    if (c.from !== c.to) dim(`    ${c.from} -> ${c.to}`);
  }
  success(`${changes.length} lesson(s) now ${options.home}-home, home_source: explicit`);
  return true;
}
