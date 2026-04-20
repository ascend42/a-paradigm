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
 */
export function readPortalFile(rootDir: string): { data: RawPortalData; filePath: string } {
  const filePath = path.join(rootDir, 'portal.yaml');

  if (!fs.existsSync(filePath)) {
    return {
      data: { version: '1.0.0', gates: {} },
      filePath,
    };
  }

  const content = fs.readFileSync(filePath, 'utf8');
  const data = yaml.load(content) as RawPortalData;

  return {
    data: data || { version: '1.0.0', gates: {} },
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
 * Returns the path to the portal.yaml file.
 */
export function addGateToPortal(
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
): string {
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

  writePortalFile(filePath, data);

  // Defense-in-depth: re-read the file and confirm the gate persisted.
  // Converts silent no-op failures into loud, actionable errors.
  const verify = readPortalFile(rootDir).data;
  const gatesAfter = verify.gates;
  if (!gatesAfter || Array.isArray(gatesAfter) || !gatesAfter[gateId]) {
    const shape = Array.isArray(gatesAfter) ? 'array' : typeof gatesAfter;
    log.gate(`^${gateId}`).error('portal_add_gate write verification failed', {
      file: filePath,
      gateId,
      shape,
    });
    throw new Error(
      `portal_add_gate write verification failed: gate "${gateId}" not found in ` +
      `${filePath} after write. Read-back gates shape: ${shape}.`
    );
  }

  return filePath;
}

// ============================================
// Route Operations
// ============================================

/**
 * Add a route with gates to portal.yaml.
 * Format: "METHOD /path": [^gate1, ^gate2]
 */
export function addRouteToPortal(
  rootDir: string,
  params: {
    route: string;
    method: string;
    gates: string[];
  }
): string {
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

  writePortalFile(filePath, data);

  // Defense-in-depth: verify the route landed on disk
  const verify = readPortalFile(rootDir).data;
  const routesAfter = verify.routes;
  if (!routesAfter || Array.isArray(routesAfter) || !routesAfter[routeKey]) {
    const shape = Array.isArray(routesAfter) ? 'array' : typeof routesAfter;
    log.component('#portal-writer').error('portal_add_route write verification failed', {
      file: filePath,
      routeKey,
      shape,
    });
    throw new Error(
      `portal_add_route write verification failed: route "${routeKey}" not found in ` +
      `${filePath} after write. Read-back routes shape: ${shape}.`
    );
  }

  return filePath;
}
