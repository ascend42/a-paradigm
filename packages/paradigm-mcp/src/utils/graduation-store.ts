/**
 * Graduation Store — #graduation-store
 *
 * YAML read/write for .paradigm/graduation.yaml.
 * Manages graduation state for habits that have been promoted to hooks.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import type {
  GraduationConfig,
  GraduationState,
  GraduationTier,
  GraduationYaml,
} from './graduation-types.js';
import { DEFAULT_GRADUATION_CONFIG } from './graduation-types.js';

// ═══════════════════════════════════════════════════════════════════
// FILE PATH
// ═══════════════════════════════════════════════════════════════════

function graduationPath(rootDir: string): string {
  return path.join(rootDir, '.paradigm', 'graduation.yaml');
}

// ═══════════════════════════════════════════════════════════════════
// LOAD
// ═══════════════════════════════════════════════════════════════════

let cachedData: GraduationYaml | null = null;
let cachedRoot: string | null = null;
let cachedAt = 0;
const CACHE_TTL = 30_000;

export function loadGraduation(rootDir: string): GraduationYaml {
  const absRoot = path.resolve(rootDir);
  if (cachedData && cachedRoot === absRoot && Date.now() - cachedAt < CACHE_TTL) {
    return cachedData;
  }

  const filePath = graduationPath(absRoot);
  let data: GraduationYaml;

  if (fs.existsSync(filePath)) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      data = yaml.load(content) as GraduationYaml;
    } catch {
      data = { version: '1.0', config: {}, states: {} };
    }
  } else {
    data = { version: '1.0', config: {}, states: {} };
  }

  // Ensure structure
  if (!data.version) data.version = '1.0';
  if (!data.config) data.config = {};
  if (!data.states) data.states = {};

  cachedData = data;
  cachedRoot = absRoot;
  cachedAt = Date.now();
  return data;
}

// ═══════════════════════════════════════════════════════════════════
// SAVE
// ═══════════════════════════════════════════════════════════════════

export function saveGraduation(rootDir: string, data: GraduationYaml): void {
  const absRoot = path.resolve(rootDir);
  const filePath = graduationPath(absRoot);
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const content = yaml.dump(data, { lineWidth: 120, noRefs: true, sortKeys: true });
  fs.writeFileSync(filePath, content, 'utf8');

  // Update cache
  cachedData = data;
  cachedRoot = absRoot;
  cachedAt = Date.now();
}

// ═══════════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════════

export function getConfig(rootDir: string): GraduationConfig {
  const data = loadGraduation(rootDir);
  return {
    ...DEFAULT_GRADUATION_CONFIG,
    ...data.config,
    thresholds: { ...DEFAULT_GRADUATION_CONFIG.thresholds, ...data.config?.thresholds },
    demotion: { ...DEFAULT_GRADUATION_CONFIG.demotion, ...data.config?.demotion },
    neverGraduate: data.config?.neverGraduate ?? DEFAULT_GRADUATION_CONFIG.neverGraduate,
  };
}

// ═══════════════════════════════════════════════════════════════════
// STATE ACCESSORS
// ═══════════════════════════════════════════════════════════════════

function defaultState(habitId: string): GraduationState {
  return {
    habitId,
    tier: 'habit',
    previousTier: null,
    graduatedAt: null,
    demotedAt: null,
    complianceAtGraduation: 0,
    hookScript: null,
    failureCount: 0,
    cooldownUntil: null,
    neverGraduate: false,
  };
}

export function getState(rootDir: string, habitId: string): GraduationState {
  const data = loadGraduation(rootDir);
  const stored = data.states[habitId];
  if (!stored) return defaultState(habitId);
  return { ...defaultState(habitId), ...stored, habitId };
}

export function getAllStates(rootDir: string): Record<string, GraduationState> {
  const data = loadGraduation(rootDir);
  const result: Record<string, GraduationState> = {};
  for (const [id, partial] of Object.entries(data.states)) {
    result[id] = { ...defaultState(id), ...partial, habitId: id };
  }
  return result;
}

export function isGraduated(rootDir: string, habitId: string): boolean {
  return getState(rootDir, habitId).tier === 'hook';
}

// ═══════════════════════════════════════════════════════════════════
// MUTATIONS
// ═══════════════════════════════════════════════════════════════════

export function setTier(
  rootDir: string,
  habitId: string,
  tier: GraduationTier,
  extra?: Partial<GraduationState>
): void {
  const data = loadGraduation(rootDir);
  const current = data.states[habitId] || {};
  data.states[habitId] = {
    ...current,
    tier,
    previousTier: (current.tier as GraduationTier) || 'habit',
    ...(tier === 'hook' ? { graduatedAt: new Date().toISOString(), failureCount: 0 } : {}),
    ...(tier === 'habit' && current.tier === 'hook' ? { demotedAt: new Date().toISOString() } : {}),
    ...extra,
  };
  saveGraduation(rootDir, data);
}

export function markNeverGraduate(rootDir: string, habitId: string): void {
  const data = loadGraduation(rootDir);
  if (!data.states[habitId]) data.states[habitId] = {};
  data.states[habitId].neverGraduate = true;
  data.states[habitId].tier = 'habit';
  saveGraduation(rootDir, data);
}

export function incrementFailure(rootDir: string, habitId: string): number {
  const data = loadGraduation(rootDir);
  if (!data.states[habitId]) data.states[habitId] = {};
  const count = ((data.states[habitId].failureCount as number) || 0) + 1;
  data.states[habitId].failureCount = count;
  saveGraduation(rootDir, data);
  return count;
}

export function invalidateGraduationCache(): void {
  cachedData = null;
  cachedRoot = null;
  cachedAt = 0;
}
