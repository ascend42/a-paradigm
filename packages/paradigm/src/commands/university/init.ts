/**
 * paradigm university init — scaffold a project-pack or discipline sub-pack.
 *
 * Bare:
 *   Writes .paradigm/university/pack.yaml with tenant_kind: project. Pack id
 *   is derived from .paradigm/config.yaml `project` (falling back to the
 *   working-directory basename).
 *
 * With --discipline <name>:
 *   Writes .paradigm/university/<name>/pack.yaml as a discipline sub-pack.
 *   The sub-pack id is `<parent-id>-<name>` for readability.
 *
 * Never overwrites existing manifests unless --force is set.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { out, success, warn, error, dim, header } from '../../utils/cli-output.js';

interface InitOptions {
  discipline?: string;
  force?: boolean;
}

const UNIVERSITY_DIR = '.paradigm/university';
const CONFIG_FILE = '.paradigm/config.yaml';
const PACK_MANIFEST_FILENAME = 'pack.yaml';

function deriveProjectPackId(cwd: string): string {
  const configPath = path.join(cwd, CONFIG_FILE);
  if (fs.existsSync(configPath)) {
    try {
      const raw = fs.readFileSync(configPath, 'utf8');
      const cfg = yaml.load(raw) as { project?: string } | null;
      if (cfg?.project && typeof cfg.project === 'string') {
        return slugify(cfg.project);
      }
    } catch {
      // fall through to basename
    }
  }
  return slugify(path.basename(cwd));
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'project';
}

export async function universityInitCommand(options: InitOptions): Promise<void> {
  const cwd = process.cwd();
  const parentPackId = deriveProjectPackId(cwd);

  const localUniDir = path.join(cwd, UNIVERSITY_DIR);

  if (options.discipline) {
    // Discipline sub-pack
    const disciplineName = slugify(options.discipline);
    const subPackDir = path.join(localUniDir, disciplineName);
    const manifestPath = path.join(subPackDir, PACK_MANIFEST_FILENAME);

    if (fs.existsSync(manifestPath) && !options.force) {
      warn(`discipline sub-pack already exists: ${path.relative(cwd, manifestPath)}`);
      dim('  use --force to overwrite');
      return;
    }

    const manifest = {
      id: `${parentPackId}-${disciplineName}`,
      name: `${parentPackId} — ${disciplineName}`,
      version: '0.1.0',
      schema_version: '1',
      tenant_kind: 'project',
      description: `${disciplineName} discipline sub-pack for ${parentPackId}.`,
      origin_hint: 'authored',
      disciplines: [disciplineName],
    };

    try {
      fs.mkdirSync(subPackDir, { recursive: true });
      fs.writeFileSync(
        manifestPath,
        yaml.dump(manifest, { lineWidth: -1, noRefs: true, sortKeys: false }),
        'utf8',
      );
    } catch (err) {
      error(`failed to scaffold discipline sub-pack: ${(err as Error).message}`);
      process.exit(1);
    }

    header('Discipline sub-pack scaffolded');
    success(`${path.relative(cwd, manifestPath)}`);
    dim(`  id:           ${manifest.id}`);
    dim(`  parent pack:  ${parentPackId}`);
    dim(`  discipline:   ${disciplineName}`);
    out('');
    return;
  }

  // Project-pack scaffold (bare)
  const manifestPath = path.join(localUniDir, PACK_MANIFEST_FILENAME);
  if (fs.existsSync(manifestPath) && !options.force) {
    warn(`pack.yaml already exists at ${path.relative(cwd, manifestPath)}`);
    dim('  use --force to overwrite');
    return;
  }

  const manifest = {
    id: parentPackId,
    name: parentPackId,
    version: '0.1.0',
    schema_version: '1',
    tenant_kind: 'project',
    description: `Team-authored content for ${parentPackId}.`,
    origin_hint: 'authored',
  };

  try {
    fs.mkdirSync(localUniDir, { recursive: true });
    fs.writeFileSync(
      manifestPath,
      yaml.dump(manifest, { lineWidth: -1, noRefs: true, sortKeys: false }),
      'utf8',
    );
  } catch (err) {
    error(`failed to scaffold project pack: ${(err as Error).message}`);
    process.exit(1);
  }

  header('Project pack scaffolded');
  success(`${path.relative(cwd, manifestPath)}`);
  dim(`  id:          ${manifest.id}`);
  dim(`  tenant_kind: project`);
  out('');
  dim('  next: paradigm university add note --title "Your first note"');
  out('');
}
