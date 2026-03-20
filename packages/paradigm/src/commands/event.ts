/**
 * paradigm event emit — Emit an event to the ambient event stream
 *
 * Designed for hook integration: fast (~100ms), writes to stream.jsonl only.
 * No nomination processing — that's deferred to next MCP tool call.
 *
 * Usage:
 *   paradigm event emit --type file-modified --source post-write-hook --path src/foo.ts
 *   paradigm event emit --type compliance-violation --source stop-hook --severity error --context "Missing .purpose"
 */

import * as fs from 'fs';
import * as path from 'path';

export interface EventEmitOptions {
  type: string;
  source: string;
  path?: string;
  symbols?: string[];
  context?: string;
  severity?: string;
}

export async function eventEmitCommand(options: EventEmitOptions) {
  const cwd = process.cwd();
  const eventsDir = path.join(cwd, '.paradigm', 'events');
  const streamFile = path.join(eventsDir, 'stream.jsonl');

  // Build the event object directly (no imports to keep startup fast)
  const now = Date.now();
  const rand = Math.floor(Math.random() * 9999).toString().padStart(4, '0');
  const event = {
    id: `ev-${now}-${rand}`,
    type: options.type,
    source: options.source,
    timestamp: new Date().toISOString(),
    ...(options.path ? { path: options.path } : {}),
    ...(options.symbols?.length ? { symbols: options.symbols } : {}),
    ...(options.context ? { context: options.context } : {}),
    ...(options.severity ? { severity: options.severity } : {}),
  };

  try {
    fs.mkdirSync(eventsDir, { recursive: true });
    fs.appendFileSync(streamFile, JSON.stringify(event) + '\n', 'utf8');
  } catch {
    // Fire-and-forget — failure is non-fatal for hooks
  }
}
