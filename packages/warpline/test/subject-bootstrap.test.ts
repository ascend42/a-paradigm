/**
 * subject-bootstrap.test — the subject onboarding scaffold (PRE-APP KIT).
 *
 * init-subject writes a greengate.json that readGreenGate (oracle.ts) parses, a
 * behavioral-checklist template, and the ordered runbook §0 checklist; it refuses
 * to clobber an existing greengate.json without --force, and never mints keys.
 */

import { describe, it, expect } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { readGreenGate, greenGatePathOf } from '../src/field/oracle.js';
import { initSubject, preRunChecklist } from '../src/field/subject-bootstrap.js';

function tmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-bootstrap-'));
}

describe('SUBJECT BOOTSTRAP — init-subject', () => {
  it('writes a greengate.json that readGreenGate parses (tsc + expo export)', () => {
    const root = tmpRoot();
    try {
      const res = initSubject(root);
      expect(res.greengateWritten).toBe(true);
      const cfg = readGreenGate(root);
      expect(cfg).not.toBeNull();
      expect(cfg!.checks.map((c) => c.name)).toEqual(['typecheck', 'bundle']);
      expect(cfg!.checks[0]).toMatchObject({ cmd: 'npx', args: ['tsc', '--noEmit'] });
      expect(cfg!.checks[1]).toMatchObject({ cmd: 'npx', args: ['expo', 'export'] });
      expect(cfg!.behavioral).toEqual({ script: '', assertions: [] });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('writes the behavioral-checklist template + returns the ordered §0 checklist and reminders', () => {
    const root = tmpRoot();
    try {
      const res = initSubject(root);
      expect(res.checklistTemplateWritten).toBe(true);
      expect(fs.existsSync(res.checklistTemplatePath)).toBe(true);
      expect(res.checklist.length).toBeGreaterThan(0);
      expect(res.checklist.every((i) => i.mode === 'auto' || i.mode === 'manual')).toBe(true);
      // the keys-before-propose reminder is load-bearing (Build-D fixture finding)
      expect(res.reminders.some((r) => /MINT AGENT KEYS BEFORE/.test(r))).toBe(true);
      // it does NOT run init / mint keys: no keys dir created
      expect(fs.existsSync(path.join(root, '.warpline', 'keys'))).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('refuses to clobber an existing greengate.json without --force', () => {
    const root = tmpRoot();
    try {
      const gp = greenGatePathOf(root);
      fs.mkdirSync(path.dirname(gp), { recursive: true });
      fs.writeFileSync(gp, JSON.stringify({ checks: [{ name: 'custom', cmd: 'echo', args: ['hi'] }] }, null, 2));

      const res = initSubject(root);
      expect(res.greengateWritten).toBe(false);
      expect(res.greengateSkippedReason).toMatch(/already exists/);
      // the operator's frozen gate is untouched
      expect(readGreenGate(root)!.checks[0].name).toBe('custom');

      // --force replaces it
      const forced = initSubject(root, { force: true });
      expect(forced.greengateWritten).toBe(true);
      expect(readGreenGate(root)!.checks.map((c) => c.name)).toEqual(['typecheck', 'bundle']);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('preRunChecklist is stable and covers both auto and manual items', () => {
    const list = preRunChecklist();
    expect(list.some((i) => i.mode === 'auto')).toBe(true);
    expect(list.some((i) => i.mode === 'manual')).toBe(true);
    expect(list.some((i) => /seed verify/.test(i.text))).toBe(true);
  });
});
