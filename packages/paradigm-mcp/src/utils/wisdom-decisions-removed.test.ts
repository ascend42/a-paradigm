/**
 * D2 (7.12.0): legacy .paradigm/wisdom/decisions/ is no longer read; the
 * paradigm://wisdom/decisions resource aliases the TD store.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadWisdomContext } from './wisdom-loader.js';
import { handleWisdomResource } from '../resources/wisdom.js';

function project(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wis-dec-'));
  const legacy = path.join(root, '.paradigm', 'wisdom', 'decisions');
  fs.mkdirSync(legacy, { recursive: true });
  fs.writeFileSync(path.join(legacy, 'ADR-001-x.yaml'), 'id: ADR-001\ntitle: Legacy\nstatus: accepted\ndate: 2026-01-01\nsymbols: []\n');
  const td = path.join(root, '.paradigm', 'decisions');
  fs.mkdirSync(td, { recursive: true });
  fs.writeFileSync(path.join(td, 'TD-2026-09-29-001.yaml'),
    'id: TD-2026-09-29-001\ntitle: Canonical\ntimestamp: 2026-09-29T00:00:00Z\nparticipants: []\ndecision: d\nrationale: r\nstatus: active\n');
  return root;
}

describe('legacy wisdom/decisions read path removed', () => {
  it('loadWisdomContext ignores wisdom/decisions', async () => {
    const ctx = await loadWisdomContext(project());
    expect(ctx.decisions).toEqual([]);
  });

  it('paradigm://wisdom/decisions lists the TD store, not the legacy dir', async () => {
    const root = project();
    const res = await handleWisdomResource('wisdom/decisions', { rootDir: root } as never);
    const body = JSON.parse(res.text);
    expect(body.decisions.map((d: { id: string }) => d.id)).toEqual(['TD-2026-09-29-001']);
    const one = await handleWisdomResource('wisdom/decision/TD-2026-09-29-001', { rootDir: root } as never);
    expect(JSON.parse(one.text).title).toBe('Canonical');
  });
});
