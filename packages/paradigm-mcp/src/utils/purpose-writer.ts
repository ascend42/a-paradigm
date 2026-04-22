/**
 * Purpose Writer - Read-modify-write helpers for .purpose files
 *
 * This module is the sole interface for mutating .purpose files.
 * AI agents pass structured parameters; this module handles all
 * YAML formatting, validation, and symbol prefix normalization.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  parsePurposeFileDetailed,
  serializePurposeFile,
  findPurposeFiles,
} from '@a-company/purpose-core';
import type {
  PurposeFile,
  PurposeItem,
  PurposeItemArray,
  FlowWithSteps,
  FlowDefinition,
} from '@a-company/purpose-core';
import {
  writeAndConfirm,
  WriteVerificationError,
  type WriteEnvelope,
} from './write-and-confirm.js';
import { log } from './mcp-logger.js';

// ============================================
// Symbol Prefix Utilities
// ============================================

const SYMBOL_PREFIXES = ['#', '$', '^', '!', '~'] as const;
type SymbolPrefix = typeof SYMBOL_PREFIXES[number];

/**
 * Strip any Paradigm symbol prefix (#, $, ^, !, ~) from a name.
 * e.g. "#payment-service" → "payment-service", "~rate-limited" → "rate-limited"
 */
export function stripSymbolPrefix(name: string): string {
  if (name.length > 1 && SYMBOL_PREFIXES.includes(name[0] as SymbolPrefix)) {
    return name.slice(1);
  }
  return name;
}

/**
 * Ensure a symbol reference has the correct prefix.
 * e.g. ensurePrefix("payment-completed", "!") → "!payment-completed"
 *      ensurePrefix("!payment-completed", "!") → "!payment-completed"
 */
export function ensurePrefix(name: string, prefix: SymbolPrefix): string {
  const stripped = stripSymbolPrefix(name);
  return `${prefix}${stripped}`;
}

// ============================================
// Path Resolution
// ============================================

/**
 * Resolve a .purpose file path. Accepts either:
 * - A path ending in .purpose (used as-is)
 * - A directory path (appends /.purpose)
 */
export function resolvePurposeFilePath(fileOrDir: string, rootDir: string): string {
  const resolved = path.isAbsolute(fileOrDir)
    ? fileOrDir
    : path.resolve(rootDir, fileOrDir);

  if (resolved.endsWith('.purpose')) {
    return resolved;
  }

  return path.join(resolved, '.purpose');
}

// ============================================
// Read / Write
// ============================================

/**
 * Read and parse a .purpose file. Returns empty PurposeFile if the file doesn't exist.
 */
export function readPurposeFile(filePath: string): PurposeFile {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  const result = parsePurposeFileDetailed(filePath);
  if (!result.data) {
    throw new Error(`Failed to parse ${filePath}: ${result.errors.join(', ')}`);
  }
  return result.data;
}

/**
 * Write a PurposeFile to disk. Creates parent directories if needed.
 */
export function writePurposeFile(filePath: string, data: PurposeFile): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const content = serializePurposeFile(data);
  fs.writeFileSync(filePath, content, 'utf8');
}

/**
 * Write a PurposeFile atomically with read-back verification.
 *
 * v5.38.0: closes silent-no-op failures for the high-value mutation handlers
 * (`purpose_add_component`, `purpose_link`, `purpose_remove`). The `verify`
 * callback is passed the RAW read-back string AND the parsed data so callers
 * can assert mutation-specific invariants.
 *
 * Returns a WriteEnvelope for downstream consumers (hashHint + bytes).
 * Throws if the mutation didn't land. Logs are redacted.
 */
export async function writePurposeFileAndConfirm(
  filePath: string,
  data: PurposeFile,
  verify: (parsed: PurposeFile) => boolean,
  surface: string = 'purpose.yaml',
): Promise<WriteEnvelope> {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const content = serializePurposeFile(data);

  try {
    return await writeAndConfirm(filePath, content, (_readBack) => {
      // Parse the read-back file and pass the parsed PurposeFile to the caller's
      // verifier. If parse fails, treat as verify failure.
      const result = parsePurposeFileDetailed(filePath);
      if (!result.data) return false;
      try {
        return verify(result.data);
      } catch {
        return false;
      }
    });
  } catch (err) {
    if (err instanceof WriteVerificationError) {
      // Redacted: log the classifier surface and stage only.
      log.component('#purpose-writer').error('purpose write verification failed', {
        surface,
        stage: 'writeAndConfirm',
      });
      throw new Error(`purpose write verification failed (${surface})`);
    }
    throw err;
  }
}

// ============================================
// Normalization Helpers
// ============================================

/**
 * Convert features/components from array format [{id, description, ...}]
 * to record format {id: {description, ...}} (canonical form for writing).
 */
export function normalizeToRecord(
  items: Record<string, PurposeItem> | PurposeItemArray[] | undefined
): Record<string, PurposeItem> {
  if (!items) return {};

  // Already record format
  if (!Array.isArray(items)) return items;

  // Convert array → record
  const record: Record<string, PurposeItem> = {};
  for (const item of items) {
    const { id, ...rest } = item;
    record[id] = rest;
  }
  return record;
}

/**
 * Convert flows from array format [{name, steps}] to record format {id: {description, ...}}.
 */
export function normalizeFlowsToRecord(
  flows: FlowWithSteps[] | Record<string, FlowDefinition> | undefined
): Record<string, FlowDefinition> {
  if (!flows) return {};

  // Already record format
  if (!Array.isArray(flows)) return flows;

  // Convert array → record
  const record: Record<string, FlowDefinition> = {};
  for (const flow of flows) {
    record[flow.name] = {
      description: flow.description,
      steps: flow.steps,
    };
  }
  return record;
}

/**
 * Merge new items into an existing array, deduplicating by value.
 */
export function mergeArrayField(
  existing: string[] | undefined,
  additions: string[] | undefined
): string[] | undefined {
  if (!additions || additions.length === 0) return existing;
  if (!existing || existing.length === 0) return additions;

  const set = new Set(existing);
  for (const item of additions) {
    set.add(item);
  }
  return Array.from(set);
}

// ============================================
// Rename Across All Files
// ============================================

/**
 * Prefix map for symbol types
 */
const SYMBOL_TYPE_PREFIX: Record<string, SymbolPrefix> = {
  '#': '#',
  '^': '^',
  '!': '!',
  '$': '$',
  '~': '~',
};

/**
 * Rename a symbol across ALL .purpose files in the project.
 * Updates both definitions (keys) and references (in arrays).
 * Returns the list of modified file paths.
 */
export async function renameSymbolAcrossFiles(
  rootDir: string,
  oldId: string,
  newId: string,
  symbolType: string
): Promise<string[]> {
  const prefix = SYMBOL_TYPE_PREFIX[symbolType];
  if (!prefix) {
    throw new Error(`Invalid symbol type: ${symbolType}. Expected one of: # ^ ! $ ~`);
  }

  const oldBare = stripSymbolPrefix(oldId);
  const newBare = stripSymbolPrefix(newId);
  const oldPrefixed = ensurePrefix(oldBare, prefix);
  const newPrefixed = ensurePrefix(newBare, prefix);

  const files = await findPurposeFiles(rootDir);
  const modifiedFiles: string[] = [];

  for (const filePath of files) {
    const data = readPurposeFile(filePath);
    let modified = false;

    // Determine which section the symbol is defined in
    const sectionMap: Record<string, string> = {
      '#': 'components', // Also check features
      '^': 'gates',
      '!': 'signals',
      '$': 'flows',
      '~': 'aspects',
    };

    // Rename definition keys
    const section = sectionMap[prefix];
    if (section && section !== 'flows') {
      const sectionData = (data as Record<string, unknown>)[section] as Record<string, unknown> | undefined;
      if (sectionData && !Array.isArray(sectionData) && oldBare in sectionData) {
        sectionData[newBare] = sectionData[oldBare];
        delete sectionData[oldBare];
        modified = true;
      }
    }

    // For components, also check features section
    if (prefix === '#') {
      for (const sec of ['features', 'components']) {
        const sectionData = (data as Record<string, unknown>)[sec] as Record<string, unknown> | undefined;
        if (sectionData && !Array.isArray(sectionData) && oldBare in sectionData) {
          sectionData[newBare] = sectionData[oldBare];
          delete sectionData[oldBare];
          modified = true;
        }
      }
    }

    // Rename flow definitions (record format)
    if (prefix === '$' && data.flows && !Array.isArray(data.flows)) {
      if (oldBare in data.flows) {
        (data.flows as Record<string, FlowDefinition>)[newBare] = (data.flows as Record<string, FlowDefinition>)[oldBare];
        delete (data.flows as Record<string, FlowDefinition>)[oldBare];
        modified = true;
      }
    }

    // Rename references in all components/features
    for (const sec of ['features', 'components']) {
      const items = normalizeToRecord((data as Record<string, unknown>)[sec] as Record<string, PurposeItem> | PurposeItemArray[] | undefined);
      for (const [_key, item] of Object.entries(items)) {
        modified = renameInRefArrays(item, oldPrefixed, newPrefixed) || modified;
      }
      // Write back normalized form if we modified it
      if (modified && Object.keys(items).length > 0) {
        (data as Record<string, unknown>)[sec] = items;
      }
    }

    // Rename references in flow steps
    if (data.flows) {
      const flows = normalizeFlowsToRecord(data.flows);
      for (const [_key, flow] of Object.entries(flows)) {
        if (flow.gates) {
          const idx = flow.gates.indexOf(oldPrefixed);
          if (idx !== -1) { flow.gates[idx] = newPrefixed; modified = true; }
        }
        if (flow.signals) {
          const idx = flow.signals.indexOf(oldPrefixed);
          if (idx !== -1) { flow.signals[idx] = newPrefixed; modified = true; }
        }
        if (flow.components) {
          const idx = flow.components.indexOf(oldPrefixed);
          if (idx !== -1) { flow.components[idx] = newPrefixed; modified = true; }
        }
        if (flow.steps) {
          for (const step of flow.steps) {
            if (typeof step === 'object' && 'component' in step) {
              if (step.component === oldPrefixed || step.component === oldBare) {
                step.component = prefix === '#' ? newBare : newPrefixed;
                modified = true;
              }
            }
          }
        }
      }
      if (modified) {
        data.flows = flows;
      }
    }

    // Rename references in gate definitions
    if (data.gates) {
      for (const [_key, gate] of Object.entries(data.gates)) {
        if (gate.signals) {
          const idx = gate.signals.indexOf(oldPrefixed);
          if (idx !== -1) { gate.signals[idx] = newPrefixed; modified = true; }
        }
      }
    }

    // Rename references in aspect definitions
    if (data.aspects) {
      for (const [_key, aspect] of Object.entries(data.aspects)) {
        if (aspect['applies-to']) {
          const idx = aspect['applies-to'].indexOf(oldPrefixed);
          if (idx !== -1) { aspect['applies-to'][idx] = newPrefixed; modified = true; }
        }
      }
    }

    if (modified) {
      writePurposeFile(filePath, data);
      modifiedFiles.push(filePath);
    }
  }

  return modifiedFiles;
}

/**
 * Rename a symbol in reference arrays of a PurposeItem.
 */
function renameInRefArrays(item: PurposeItem, oldRef: string, newRef: string): boolean {
  let modified = false;
  const refFields: Array<keyof PurposeItem> = ['signals', 'gates', 'flows', 'components', 'states'];

  for (const field of refFields) {
    const arr = item[field] as string[] | undefined;
    if (arr) {
      const idx = arr.indexOf(oldRef);
      if (idx !== -1) {
        arr[idx] = newRef;
        modified = true;
      }
    }
  }

  // Also check aspects (array of string references)
  if (item.aspects && Array.isArray(item.aspects)) {
    const idx = item.aspects.indexOf(oldRef);
    if (idx !== -1) {
      item.aspects[idx] = newRef;
      modified = true;
    }
  }

  return modified;
}
