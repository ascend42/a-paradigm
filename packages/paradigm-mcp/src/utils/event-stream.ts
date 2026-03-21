/**
 * Event Stream — emit, store, query, and score events for ambient coordination
 *
 * Events are stored as JSONL in .paradigm/events/stream.jsonl (append-only).
 * The stream is bounded by max_events (default 1000) with automatic pruning.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { StreamEvent, EventType, EventSource, AttentionScore, EventStreamConfig } from '../types/ambient.js';
import type { AgentAttention } from '../types/agents.js';

const EVENTS_DIR = '.paradigm/events';
const STREAM_FILE = 'stream.jsonl';
const DEFAULT_MAX_EVENTS = 1000;

let memoryStream: StreamEvent[] = [];

function getStreamPath(rootDir: string): string {
  return path.join(rootDir, EVENTS_DIR, STREAM_FILE);
}

// ── ID Generation ──

function generateEventId(): string {
  const now = Date.now();
  const rand = Math.floor(Math.random() * 9999).toString().padStart(4, '0');
  return `ev-${now}-${rand}`;
}

// ── Emit ──

export function emitEvent(rootDir: string, event: Omit<StreamEvent, 'id' | 'timestamp'>): StreamEvent {
  const full: StreamEvent = {
    id: generateEventId(),
    timestamp: new Date().toISOString(),
    ...event,
  };

  // Always keep in memory
  memoryStream.push(full);
  if (memoryStream.length > DEFAULT_MAX_EVENTS) {
    memoryStream = memoryStream.slice(-DEFAULT_MAX_EVENTS);
  }

  // Persist to file
  try {
    const dir = path.join(rootDir, EVENTS_DIR);
    fs.mkdirSync(dir, { recursive: true });
    const streamPath = getStreamPath(rootDir);
    fs.appendFileSync(streamPath, JSON.stringify(full) + '\n', 'utf8');

    // Prune if over limit
    pruneIfNeeded(streamPath);
  } catch {
    // File write failure is non-fatal — memory stream still works
  }

  return full;
}

function pruneIfNeeded(streamPath: string) {
  try {
    const stat = fs.statSync(streamPath);
    // Prune if file exceeds ~500KB (rough estimate of 1000 events)
    if (stat.size > 512 * 1024) {
      const content = fs.readFileSync(streamPath, 'utf8');
      const lines = content.trim().split('\n');
      if (lines.length > DEFAULT_MAX_EVENTS) {
        const kept = lines.slice(-DEFAULT_MAX_EVENTS);
        fs.writeFileSync(streamPath, kept.join('\n') + '\n', 'utf8');
      }
    }
  } catch {
    // Prune failure is non-fatal
  }
}

// ── Query ──

export function queryEvents(rootDir: string, opts?: {
  type?: EventType;
  source?: EventSource;
  symbol?: string;
  agent?: string;
  since?: string;
  limit?: number;
}): StreamEvent[] {
  let events = loadEventsFromDisk(rootDir);

  if (opts?.type) events = events.filter(e => e.type === opts.type);
  if (opts?.source) events = events.filter(e => e.source === opts.source);
  if (opts?.symbol) events = events.filter(e => e.symbols?.includes(opts.symbol!));
  if (opts?.agent) events = events.filter(e => e.agent === opts.agent);
  if (opts?.since) events = events.filter(e => e.timestamp >= opts.since!);

  events.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  if (opts?.limit) events = events.slice(0, opts.limit);

  return events;
}

function loadEventsFromDisk(rootDir: string): StreamEvent[] {
  const streamPath = getStreamPath(rootDir);
  if (!fs.existsSync(streamPath)) return [...memoryStream];

  try {
    const content = fs.readFileSync(streamPath, 'utf8');
    const events = content.trim().split('\n')
      .filter(line => line.trim())
      .map(line => {
        try { return JSON.parse(line) as StreamEvent; }
        catch { return null; }
      })
      .filter((e): e is StreamEvent => e !== null);

    return events;
  } catch {
    return [...memoryStream];
  }
}

// ── Attention Scoring ──

export function scoreEventForAgent(
  event: StreamEvent,
  agentId: string,
  attention: AgentAttention
): AttentionScore {
  let symbolMatch = 0;
  let pathMatch = 0;
  let conceptMatch = 0;
  let signalMatch = 0;

  // Symbol pattern matching
  if (attention.symbols?.length && event.symbols?.length) {
    for (const pattern of attention.symbols) {
      for (const symbol of event.symbols) {
        if (matchGlob(pattern, symbol)) {
          symbolMatch = Math.max(symbolMatch, 1.0);
        }
      }
    }
  }

  // Path pattern matching
  if (attention.paths?.length && event.path) {
    for (const pattern of attention.paths) {
      if (matchGlob(pattern, event.path)) {
        pathMatch = 1.0;
        break;
      }
    }
  }

  // Concept matching (keyword overlap)
  if (attention.concepts?.length) {
    const eventText = [
      event.context || '',
      ...(event.keywords || []),
      event.type,
    ].join(' ').toLowerCase();

    let matched = 0;
    for (const concept of attention.concepts) {
      if (eventText.includes(concept.toLowerCase())) {
        matched++;
      }
    }
    if (attention.concepts.length > 0) {
      conceptMatch = matched / attention.concepts.length;
    }
  }

  // Signal type matching
  if (attention.signals?.length) {
    for (const signal of attention.signals) {
      if (signal.type === event.type) {
        signalMatch = 1.0;
        break;
      }
    }
  }

  // Weighted scoring: primary dimension gets 0.5 weight, secondary dimensions contribute 0.15 each
  // This prevents every match from being 1.0 and creates gradient between partial and full matches
  const dimensions = [symbolMatch, pathMatch, conceptMatch, signalMatch].sort((a, b) => b - a);
  const score = dimensions[0] * 0.5 + dimensions[1] * 0.2 + dimensions[2] * 0.15 + dimensions[3] * 0.15;
  const threshold = attention.threshold ?? 0.6;

  return {
    agentId,
    score,
    breakdown: { symbolMatch, pathMatch, conceptMatch, signalMatch },
    shouldNominate: score >= threshold,
    quietReason: score < threshold ? 'below-threshold' : undefined,
  };
}

/**
 * Simple glob matcher supporting * and ** patterns.
 */
function matchGlob(pattern: string, value: string): boolean {
  // Exact match
  if (pattern === value) return true;

  // * matches any single segment
  // ** matches any number of segments
  const regex = pattern
    .replace(/\*\*/g, '§§')
    .replace(/\*/g, '[^/]*')
    .replace(/§§/g, '.*');

  try {
    return new RegExp(`^${regex}$`).test(value);
  } catch {
    return false;
  }
}

// ── Reset (for testing) ──

export function resetMemoryStream(): void {
  memoryStream = [];
}
