/**
 * #brain-egress — append-only log of everything that left this computer.
 * One JSON row per line: {at, channel:'mcp'|'cloud'|'config', op, fileIds, bytes, root}.
 * 'config' rows are local security events (e.g. brain.yaml tamper-detected) —
 * they are shown to the owner but never count as "left this Mac".
 * Never rewritten; purge archives it first (or deletes it with forgetLog).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { log } from '../mcp-logger.js';
import { assertBrainWritePath, brainFile } from './config.js';
import type { BrainOptions, EgressRow } from './types.js';

export function appendEgress(rootHash: string, row: EgressRow, opts?: BrainOptions): void {
  const file = brainFile(rootHash, 'egress', opts);
  assertBrainWritePath(file, row.root, opts);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const clean: EgressRow = {
    at: row.at,
    channel: row.channel === 'cloud' ? 'cloud' : row.channel === 'config' ? 'config' : 'mcp',
    op: String(row.op).slice(0, 80),
    fileIds: row.fileIds.filter((id) => /^f_[0-9a-f]{10}$/.test(id)),
    bytes: Math.max(0, Math.floor(row.bytes) || 0),
    root: row.root,
  };
  fs.appendFileSync(file, JSON.stringify(clean) + '\n', { mode: 0o600, flag: 'a' });
  log.component('#brain-egress').debug('Egress recorded', { rootHash, channel: clean.channel, op: clean.op, bytes: clean.bytes });
}

export function readEgress(rootHash: string, opts?: BrainOptions): EgressRow[] {
  let text = '';
  try { text = fs.readFileSync(brainFile(rootHash, 'egress', opts), 'utf8'); } catch { return []; }
  const out: EgressRow[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line) as EgressRow;
      if (r && typeof r.at === 'string' && Array.isArray(r.fileIds)) out.push(r);
    } catch { /* skip malformed line */ }
  }
  return out;
}

export interface EgressSummary {
  /** true → "Nothing has left this Mac". */
  nothingLeft: boolean;
  count: number;
  bytes: number;
  last: string | null;
  byChannel: { mcp: number; cloud: number };
}

export function egressSummary(rootHash: string, opts?: BrainOptions): EgressSummary {
  const rows = readEgress(rootHash, opts);
  const s: EgressSummary = { nothingLeft: true, count: 0, bytes: 0, last: null, byChannel: { mcp: 0, cloud: 0 } };
  const left = rows.filter((r) => r.channel !== 'config');
  for (const r of left) {
    s.count++;
    s.bytes += r.bytes || 0;
    s.byChannel[r.channel === 'cloud' ? 'cloud' : 'mcp']++;
    if (!s.last || r.at > s.last) s.last = r.at;
  }
  // Only rows that actually carried file metadata count as "left".
  s.nothingLeft = left.every((r) => r.fileIds.length === 0);
  return s;
}
