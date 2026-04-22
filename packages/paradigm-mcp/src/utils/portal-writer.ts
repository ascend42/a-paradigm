/**
 * Portal Writer - Read-modify-write helpers for portal.yaml
 *
 * Uses raw yaml.load/yaml.dump instead of ParsedGateConfig to preserve
 * custom fields (type, location, requires, grants, emits, check) that
 * the ParsedGateConfig normalizer strips.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { stripSymbolPrefix } from './purpose-writer.js';
import { log } from './mcp-logger.js';
import { safeLoad } from './yaml-validator.js';
import {
  writeAndConfirm,
  WriteVerificationError,
  type WriteEnvelope,
} from './write-and-confirm.js';

// ============================================
// Types (raw portal.yaml structure)
// ============================================

export interface RawPortalGate {
  description?: string;
  type?: string;
  location?: string;
  requires?: string[];
  check?: string;
  grants?: string[];
  emits?: string[];
  prizes?: Array<{ id: string; oneTime?: boolean; metadata?: Record<string, unknown> }>;
  locks?: Array<{
    id: string;
    description?: string;
    keys?: Array<string | { expression: string; description?: string }>;
    mode?: 'all' | 'any';
  }>;
  [key: string]: unknown;
}

export interface RawPortalData {
  version?: string;
  gates?: Record<string, RawPortalGate>;
  routes?: Record<string, string[]>;
  flows?: Record<string, unknown>;
  settings?: Record<string, unknown>;
  [key: string]: unknown;
}

// ============================================
// Read / Write
// ============================================

/**
 * Read portal.yaml as raw data. Creates default structure if file doesn't exist.
 *
 * v5.37.12 fail-closed: if the file exists but is unparseable, this throws
 * (with a redacted classifier, never file contents) rather than silently
 * returning an empty default — which would let `addGateToPortal` "succeed"
 * against a freshly-defaulted structure, nuking the user's gates on next
 * write (Scenario E in the 2026-04-22 security audit).
 */
export function readPortalFile(rootDir: string): { data: RawPortalData; filePath: string } {
  const filePath = path.join(rootDir, 'portal.yaml');

  const result = safeLoad<RawPortalData>(filePath);
  if (result.status === 'missing') {
    return {
      data: { version: '1.0.0', gates: {} },
      filePath,
    };
  }
  if (result.status === 'unparseable' || result.status === 'invalid') {
    log.component('#portal-writer').error('portal.yaml unparseable on read', {
      errorClass: result.errorClass,
    });
    throw new Error(
      `portal.yaml unparseable (${result.errorClass}). ` +
        `Refusing to overwrite. Run 'paradigm doctor' for line-specific details.`,
    );
  }
  return {
    data: result.data || { version: '1.0.0', gates: {} },
    filePath,
  };
}

/**
 * Write portal.yaml to disk.
 */
export function writePortalFile(filePath: string, data: RawPortalData): void {
  const content = yaml.dump(data, {
    indent: 2,
    lineWidth: -1,
    noRefs: true,
    sortKeys: false,
  });
  fs.writeFileSync(filePath, content, 'utf8');
}

// ============================================
// Gate Operations
// ============================================

/**
 * Add or update a gate in portal.yaml.
 *
 * v5.38.0: returns a `WriteEnvelope` with atomic-write + read-back verify
 * semantics. Back-compat callers can still access `.path` on the envelope.
 */
export async function addGateToPortal(
  rootDir: string,
  params: {
    id: string;
    description: string;
    type?: string;
    location?: string;
    requires?: string[];
    check?: string;
    grants?: string[];
    emits?: string[];
    prizes?: Array<{ id: string; oneTime?: boolean; metadata?: Record<string, unknown> }>;
  }
): Promise<WriteEnvelope> {
  const { data, filePath } = readPortalFile(rootDir);

  // Normalize: v2 scaffold writes `gates: []` (empty sequence), which js-yaml
  // parses as a JavaScript Array. Named-property assignments on Arrays are
  // silently dropped by yaml.dump, so we must coerce to an object here.
  if (!data.gates || Array.isArray(data.gates)) {
    const prev = data.gates;
    data.gates = {};
    // Defensive: migrate any array-of-gate-objects entries (non-standard form)
    if (Array.isArray(prev) && prev.length > 0) {
      for (const item of prev) {
        if (item && typeof item === 'object' && 'id' in item) {
          const id = stripSymbolPrefix((item as { id: string }).id);
          data.gates[id] = item as RawPortalGate;
        }
      }
    }
  }

  const gateId = stripSymbolPrefix(params.id);
  const gate: RawPortalGate = data.gates[gateId] || {};

  gate.description = params.description;
  if (params.type !== undefined) gate.type = params.type;
  if (params.location !== undefined) gate.location = params.location;
  if (params.requires !== undefined) gate.requires = params.requires;
  if (params.check !== undefined) gate.check = params.check;
  if (params.grants !== undefined) gate.grants = params.grants;
  if (params.emits !== undefined) gate.emits = params.emits;
  if (params.prizes !== undefined) gate.prizes = params.prizes;

  // Ensure prizes array exists (v2 requirement)
  if (!gate.prizes) {
    gate.prizes = [];
  }

  data.gates[gateId] = gate;

  const content = yaml.dump(data, {
    indent: 2,
    lineWidth: -1,
    noRefs: true,
    sortKeys: false,
  });

  try {
    return await writeAndConfirm(filePath, content, (readBack) => {
      // Verify gate landed and the gates section is an object (not an array).
      let parsed: RawPortalData;
      try {
        parsed = yaml.load(readBack) as RawPortalData;
      } catch {
        return false;
      }
      const gatesAfter = parsed?.gates;
      if (!gatesAfter || Array.isArray(gatesAfter)) return false;
      return Boolean(gatesAfter[gateId]);
    });
  } catch (err) {
    if (err instanceof WriteVerificationError) {
      // Redacted: no gate name / file path in the log or rethrown message.
      log.component('#portal-writer').error('portal_add_gate write verification failed', {
        stage: 'writeAndConfirm',
      });
      throw new Error('portal_add_gate write verification failed');
    }
    throw err;
  }
}

// ============================================
// Route Operations
// ============================================

/**
 * Add a route with gates to portal.yaml.
 * Format: "METHOD /path": [^gate1, ^gate2]
 *
 * v5.38.0: returns a `WriteEnvelope` with atomic-write + read-back verify.
 */
export async function addRouteToPortal(
  rootDir: string,
  params: {
    route: string;
    method: string;
    gates: string[];
  }
): Promise<WriteEnvelope> {
  const { data, filePath } = readPortalFile(rootDir);

  // Normalize: v2 scaffold writes `routes: []` which js-yaml parses as Array;
  // named-property assignment would silently serialize back to []. Coerce to {}.
  if (!data.routes || Array.isArray(data.routes)) {
    data.routes = {};
  }

  const routeKey = `${params.method} ${params.route}`;
  // Normalize gate references to have ^ prefix
  const gates = params.gates.map(g => {
    const bare = stripSymbolPrefix(g);
    return `^${bare}`;
  });

  data.routes[routeKey] = gates;

  const content = yaml.dump(data, {
    indent: 2,
    lineWidth: -1,
    noRefs: true,
    sortKeys: false,
  });

  try {
    return await writeAndConfirm(filePath, content, (readBack) => {
      let parsed: RawPortalData;
      try {
        parsed = yaml.load(readBack) as RawPortalData;
      } catch {
        return false;
      }
      const routesAfter = parsed?.routes;
      if (!routesAfter || Array.isArray(routesAfter)) return false;
      return Boolean(routesAfter[routeKey]);
    });
  } catch (err) {
    if (err instanceof WriteVerificationError) {
      log.component('#portal-writer').error('portal_add_route write verification failed', {
        stage: 'writeAndConfirm',
      });
      throw new Error('portal_add_route write verification failed');
    }
    throw err;
  }
}
