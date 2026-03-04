/**
 * Habit Loader - Loads habit definitions from YAML + seeds
 *
 * Merge order (later wins):
 * 1. Built-in seed habits (seed-habits.json)
 * 2. Global habits (~/.paradigm/habits.yaml)
 * 3. Project habits (.paradigm/habits.yaml)
 *
 * Overrides can tune severity/enabled without redefining the whole habit.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import type {
  HabitDefinition,
  HabitsConfig,
  HabitOverride,
  HabitTrigger,
} from './types.js';

// Import seed habits
import seedHabitsData from './seed-habits.json' with { type: 'json' };
const SEED_HABITS: HabitDefinition[] = seedHabitsData as HabitDefinition[];

/** Default TTL for habits cache (30 seconds) */
const DEFAULT_HABITS_CACHE_TTL_MS = 30 * 1000;

/** Get habits cache TTL — configurable via .paradigm/config.yaml limits.habitsCacheTtlMs */
function getHabitsCacheTtl(rootDir: string): number {
  try {
    const configPath = path.join(rootDir, '.paradigm', 'config.yaml');
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, 'utf8');
      const config = yaml.load(content) as Record<string, unknown>;
      const limits = config?.limits as Record<string, unknown> | undefined;
      if (limits?.habitsCacheTtlMs && typeof limits.habitsCacheTtlMs === 'number') {
        return limits.habitsCacheTtlMs;
      }
    }
  } catch {
    // Fall through to default
  }
  return DEFAULT_HABITS_CACHE_TTL_MS;
}

interface HabitsCacheEntry {
  habits: HabitDefinition[];
  loadedAt: number;
}

const habitsCache: Map<string, HabitsCacheEntry> = new Map();

/**
 * Load all habits for a project (with caching)
 */
export function loadHabits(rootDir: string): HabitDefinition[] {
  const absoluteRoot = path.resolve(rootDir);

  const cached = habitsCache.get(absoluteRoot);
  const ttl = getHabitsCacheTtl(absoluteRoot);
  if (cached && Date.now() - cached.loadedAt < ttl) {
    return cached.habits;
  }

  const habits = loadHabitsFresh(absoluteRoot);

  habitsCache.set(absoluteRoot, {
    habits,
    loadedAt: Date.now(),
  });

  return habits;
}

/**
 * Load habits without caching
 */
function loadHabitsFresh(rootDir: string): HabitDefinition[] {
  const habitsById = new Map<string, HabitDefinition>();

  // 1. Seed habits (embedded JSON)
  for (const seed of SEED_HABITS) {
    habitsById.set(seed.id, { ...seed });
  }

  const home = process.env.HOME || process.env.USERPROFILE || '~';

  // 2. Global habits.yaml
  const globalConfig = loadHabitsYaml(path.join(home, '.paradigm', 'habits.yaml'));
  if (globalConfig) {
    mergeHabits(habitsById, globalConfig);
  }

  // 3. Global .habit files
  const globalHabitFiles = loadHabitFiles(path.join(home, '.paradigm', 'habits'));
  for (const habit of globalHabitFiles) {
    habitsById.set(habit.id, habit);
  }

  // 4. Project habits.yaml
  const projectConfig = loadHabitsYaml(path.join(rootDir, '.paradigm', 'habits.yaml'));
  if (projectConfig) {
    mergeHabits(habitsById, projectConfig);
  }

  // 5. Project .habit files
  const projectHabitFiles = loadHabitFiles(path.join(rootDir, '.paradigm', 'habits'));
  for (const habit of projectHabitFiles) {
    habitsById.set(habit.id, habit);
  }

  return Array.from(habitsById.values());
}

/**
 * Load individual .habit files from a directory
 */
function loadHabitFiles(dir: string): HabitDefinition[] {
  if (!fs.existsSync(dir)) return [];
  try {
    const files = fs.readdirSync(dir)
      .filter(f => f.endsWith('.habit'))
      .sort();
    const habits: HabitDefinition[] = [];
    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(dir, file), 'utf8');
        const habit = yaml.load(content) as HabitDefinition;
        if (habit?.id && habit?.name) {
          habits.push(habit);
        }
      } catch {
        // Skip malformed files
      }
    }
    return habits;
  } catch {
    return [];
  }
}

/**
 * Load a habits.yaml file
 */
function loadHabitsYaml(filePath: string): HabitsConfig | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return yaml.load(content) as HabitsConfig;
  } catch {
    return null;
  }
}

/**
 * Merge habits from a config into the habits map.
 * Custom habits are added; overrides tune existing habits.
 */
function mergeHabits(
  habitsById: Map<string, HabitDefinition>,
  config: HabitsConfig
): void {
  // Add/replace custom habits
  if (config.habits) {
    for (const habit of config.habits) {
      habitsById.set(habit.id, { ...habit });
    }
  }

  // Apply overrides to existing habits
  if (config.overrides) {
    for (const [habitId, override] of Object.entries(config.overrides)) {
      const existing = habitsById.get(habitId);
      if (existing) {
        applyOverride(existing, override);
      }
    }
  }
}

/**
 * Apply an override to a habit definition (mutates in place)
 */
function applyOverride(habit: HabitDefinition, override: HabitOverride): void {
  if (override.severity !== undefined) {
    habit.severity = override.severity;
  }
  if (override.enabled !== undefined) {
    habit.enabled = override.enabled;
  }
}

/**
 * Get habits filtered by trigger point
 */
export function getHabitsByTrigger(
  habits: HabitDefinition[],
  trigger: HabitTrigger
): HabitDefinition[] {
  return habits.filter((h) => h.enabled && h.trigger === trigger);
}

/**
 * Get only enabled habits
 */
export function getEnabledHabits(habits: HabitDefinition[]): HabitDefinition[] {
  return habits.filter((h) => h.enabled);
}

/**
 * Invalidate habits cache for a project
 */
export function invalidateHabitsCache(rootDir: string): void {
  const absoluteRoot = path.resolve(rootDir);
  habitsCache.delete(absoluteRoot);
}

/**
 * Clear all habits caches
 */
export function clearHabitsCache(): void {
  habitsCache.clear();
}
