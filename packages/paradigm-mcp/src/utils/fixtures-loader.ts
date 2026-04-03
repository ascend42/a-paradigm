/**
 * Fixtures Loader - Loads test fixtures from .paradigm/fixtures.yaml
 *
 * Features:
 * - Cached loading with TTL
 * - Category-based retrieval (users, resources, payloads)
 * - Individual fixture lookup
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { log } from './mcp-logger.js';

/** TTL for fixtures cache (60 seconds - fixtures change less frequently) */
const FIXTURES_CACHE_TTL_MS = 60 * 1000;

/** Fixtures cache entry */
interface FixturesCacheEntry {
  fixtures: TestFixtures;
  loadedAt: number;
}

/** In-memory cache for fixtures by root directory */
const fixturesCache: Map<string, FixturesCacheEntry> = new Map();

/**
 * Test fixtures file structure
 */
export interface TestFixtures {
  version?: string;
  users?: Record<string, UserFixture>;
  resources?: Record<string, ResourceFixture>;
  payloads?: Record<string, unknown>;
}

/**
 * User fixture for auth testing
 */
export interface UserFixture {
  id: string;
  email?: string;
  role?: string;
  token?: string;
  [key: string]: unknown;
}

/**
 * Resource fixture for entity testing
 */
export interface ResourceFixture {
  id: string;
  [key: string]: unknown;
}

/**
 * Load fixtures from a project directory (with caching)
 */
export async function loadFixtures(rootDir: string): Promise<TestFixtures | null> {
  const absoluteRoot = path.resolve(rootDir);

  // Check cache first
  const cached = fixturesCache.get(absoluteRoot);
  if (cached && Date.now() - cached.loadedAt < FIXTURES_CACHE_TTL_MS) {
    return cached.fixtures;
  }

  // Load fresh fixtures
  const fixtures = await loadFixturesFresh(absoluteRoot);

  if (fixtures) {
    // Cache it
    fixturesCache.set(absoluteRoot, {
      fixtures,
      loadedAt: Date.now(),
    });
  }

  return fixtures;
}

/**
 * Load fixtures without caching (internal)
 */
async function loadFixturesFresh(rootDir: string): Promise<TestFixtures | null> {
  const fixturesPath = path.join(rootDir, '.paradigm', 'fixtures.yaml');

  if (!fs.existsSync(fixturesPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(fixturesPath, 'utf8');
    return yaml.load(content) as TestFixtures;
  } catch (error) {
    log.component('#fixtures-loader').error('Error parsing fixtures.yaml', { error });
    return null;
  }
}

/**
 * Invalidate fixtures cache for a project
 */
export function invalidateFixturesCache(rootDir: string): void {
  const absoluteRoot = path.resolve(rootDir);
  fixturesCache.delete(absoluteRoot);
}

/**
 * Clear all fixtures caches
 */
export function clearFixturesCache(): void {
  fixturesCache.clear();
}

/**
 * Get fixtures by category
 */
export function getFixturesByCategory(
  fixtures: TestFixtures,
  category: 'users' | 'resources' | 'payloads' | 'all'
): unknown {
  switch (category) {
    case 'users':
      return fixtures.users || {};
    case 'resources':
      return fixtures.resources || {};
    case 'payloads':
      return fixtures.payloads || {};
    case 'all':
      return {
        users: fixtures.users || {},
        resources: fixtures.resources || {},
        payloads: fixtures.payloads || {},
      };
    default:
      return null;
  }
}

/**
 * Get a specific fixture by category and name
 */
export function getFixtureByName(
  fixtures: TestFixtures,
  category: 'users' | 'resources' | 'payloads',
  name: string
): unknown {
  const categoryData = getFixturesByCategory(fixtures, category) as Record<
    string,
    unknown
  >;
  return categoryData?.[name] || null;
}

/**
 * Get all available fixture names by category
 */
export function getAvailableFixtures(fixtures: TestFixtures): {
  users: string[];
  resources: string[];
  payloads: string[];
} {
  return {
    users: Object.keys(fixtures.users || {}),
    resources: Object.keys(fixtures.resources || {}),
    payloads: Object.keys(fixtures.payloads || {}),
  };
}
