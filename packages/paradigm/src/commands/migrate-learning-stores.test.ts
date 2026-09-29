import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  migrateLearningStores,
  learningStoresMigrationNeeded,
  findStaleUniversityHabits,
  MARKER_REL,
} from './migrate-learning-stores.js';

let root: string;
let home: string;

function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out[path.relative(dir, p)] = fs.readFileSync(p, 'utf8');
    }
  };
  walk(dir);
  return out;
}

const WC = (id: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ id, agent: 'cid', brief: 'Captain: Work completed on #x — review outcome', triggered_by: [], timestamp: 't', surfaced: false, ...extra });

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'mls-root-'));
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'mls-home-'));
  const p = (...s: string[]) => path.join(root, '.paradigm', ...s);
  fs.mkdirSync(p('wisdom', 'decisions'), { recursive: true });
  fs.writeFileSync(p('wisdom', 'decisions', 'ADR-001-a.yaml'),
    'id: ADR-001\ntitle: A\nstatus: accepted\ndate: 2026-01-02\nsymbols: []\ndecision: do a\n');
  fs.mkdirSync(p('events'), { recursive: true });
  fs.writeFileSync(p('events', 'nominations.jsonl'), [
    WC('n1'), WC('n2', { engaged: true }),
    JSON.stringify({ id: 'n3', agent: 'security', brief: 'Security: Gate ^x added — verify', triggered_by: [], timestamp: 't', surfaced: false }),
  ].join('\n') + '\n');
  fs.mkdirSync(p('habits'), { recursive: true });
  fs.writeFileSync(p('habits', 'university-content-sync.habit'),
    'id: university-content-sync\ncheck:\n  type: file-modified\n  params:\n    patterns:\n      - packages/university/src/content/courses/.purpose\n');
  fs.writeFileSync(p('habits', 'release.habit'),
    'id: release\ncheck:\n  type: file-modified\n  params:\n    patterns:\n      - package.json\n');
  fs.mkdirSync(path.join(home, '.paradigm', 'wisdom', 'decisions'), { recursive: true });
  fs.writeFileSync(path.join(home, '.paradigm', 'wisdom', 'decisions', 'G-1.yaml'), 'id: G-1\n');
});

describe('paradigm migrate learning-stores', () => {
  it('--dry-run writes nothing and plans every step', () => {
    const before = snapshot(root);
    const homeBefore = snapshot(home);
    const r = migrateLearningStores(root, { dryRun: true, homeDir: home });
    expect(snapshot(root)).toEqual(before);
    expect(snapshot(home)).toEqual(homeBefore);
    expect(r.steps.map(s => s.id)).toEqual(['backup', 'wisdom-decisions', 'nomination-boilerplate', 'stale-habits', 'marker']);
    expect(r.steps[2].items).toEqual(['n1']);
    expect(r.globalWisdomDecisions.files).toBe(1);
  });

  it('migrates, backs up, and a 2nd run is a no-op', () => {
    const r = migrateLearningStores(root, { homeDir: home });
    expect(r.warnings).toEqual([]);
    expect(r.backupDir).toBeDefined();
    const backup = path.join(root, r.backupDir!);
    // backups
    expect(fs.existsSync(path.join(backup, 'originals', '.paradigm', 'wisdom', 'decisions', 'ADR-001-a.yaml'))).toBe(true);
    expect(fs.readFileSync(path.join(backup, 'nominations-boilerplate.jsonl'), 'utf8')).toContain('"n1"');
    // wisdom → TD, dir removed
    expect(fs.existsSync(path.join(root, '.paradigm', 'wisdom', 'decisions'))).toBe(false);
    const tds = fs.readdirSync(path.join(root, '.paradigm', 'decisions'));
    expect(tds).toHaveLength(1);
    expect(fs.readFileSync(path.join(root, '.paradigm', 'decisions', tds[0]), 'utf8')).toContain('wisdom-decision:ADR-001');
    // nominations: engaged + non-boilerplate kept
    const kept = fs.readFileSync(path.join(root, '.paradigm', 'events', 'nominations.jsonl'), 'utf8');
    expect(kept).not.toContain('"n1"');
    expect(kept).toContain('"n2"');
    expect(kept).toContain('"n3"');
    // habits: report-only without --apply
    expect(fs.existsSync(path.join(root, '.paradigm', 'habits', 'university-content-sync.habit'))).toBe(true);
    // global never touched
    expect(fs.existsSync(path.join(home, '.paradigm', 'wisdom', 'decisions', 'G-1.yaml'))).toBe(true);
    expect(fs.existsSync(path.join(root, MARKER_REL))).toBe(true);
    expect(learningStoresMigrationNeeded(root).needed).toBe(false);

    const snap = snapshot(root);
    const r2 = migrateLearningStores(root, { homeDir: home });
    expect(r2.noop).toBe(true);
    expect(snapshot(root)).toEqual(snap);
  });

  it('converts .yml legacy wisdom decisions too (same extensions as the planner)', () => {
    const dir = path.join(root, '.paradigm', 'wisdom', 'decisions');
    fs.writeFileSync(path.join(dir, 'ADR-002-b.yml'),
      'id: ADR-002\ntitle: B\nstatus: accepted\ndate: 2026-01-03\nsymbols: []\ndecision: do b\n');
    const dry = migrateLearningStores(root, { dryRun: true, homeDir: home });
    expect(dry.steps[1].items).toEqual(['ADR-001-a.yaml', 'ADR-002-b.yml']);
    const r = migrateLearningStores(root, { homeDir: home });
    expect(r.warnings).toEqual([]);
    expect(fs.existsSync(dir)).toBe(false);
    const tds = fs.readdirSync(path.join(root, '.paradigm', 'decisions'));
    expect(tds).toHaveLength(2);
    const all = tds.map(f => fs.readFileSync(path.join(root, '.paradigm', 'decisions', f), 'utf8')).join('\n');
    expect(all).toContain('wisdom-decision:ADR-002');
    // atomic rewrite leaves no temp file behind
    expect(fs.readdirSync(path.join(root, '.paradigm', 'events')).filter(f => f.includes('.tmp-'))).toEqual([]);
  });

  it('--apply moves stale University habits into the backup', () => {
    expect(findStaleUniversityHabits(root)).toEqual(['university-content-sync.habit']);
    const r = migrateLearningStores(root, { apply: true, homeDir: home });
    expect(fs.existsSync(path.join(root, '.paradigm', 'habits', 'university-content-sync.habit'))).toBe(false);
    expect(fs.existsSync(path.join(root, '.paradigm', 'habits', 'release.habit'))).toBe(true);
    expect(fs.existsSync(path.join(root, r.backupDir!, 'originals', '.paradigm', 'habits', 'university-content-sync.habit'))).toBe(true);
  });
});
