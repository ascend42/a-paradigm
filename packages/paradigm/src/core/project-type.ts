/**
 * Project Type Detection & Agent Roster Suggestions
 *
 * Detects project type from file signatures and suggests
 * an agent roster appropriate for that type.
 */

import * as fs from 'fs';
import * as path from 'path';
import { Glob } from 'glob';

export type ProjectType =
  | 'saas-web-app'
  | 'web-app'
  | 'backend-api'
  | 'ios-app'
  | 'macos-app'
  | 'flutter-app'
  | 'game'
  | 'rust-project'
  | 'python-project'
  | 'generic';

/**
 * Detect project type from file system signatures.
 */
export function detectProjectType(cwd: string): ProjectType {
  const exists = (p: string) => {
    // Support glob patterns
    if (p.includes('*')) {
      try {
        const matches = new Glob(p, { cwd, nodir: true }).walkSync();
        return matches.length > 0;
      } catch { return false; }
    }
    return fs.existsSync(path.join(cwd, p));
  };

  // Game engines
  if (exists('project.godot') || exists('Assets/ProjectSettings')) return 'game';

  // Apple native
  if (exists('Package.swift') && !exists('package.json')) {
    return exists('Sources/*/App') || exists('**/AppDelegate.swift') ? 'macos-app' : 'ios-app';
  }

  // Flutter / Dart
  if (exists('pubspec.yaml')) return 'flutter-app';

  // Web apps with Supabase = SaaS
  if (exists('supabase') && (exists('next.config.*') || exists('vite.config.*'))) return 'saas-web-app';

  // Web apps
  if (exists('next.config.*') || exists('vite.config.*') || exists('nuxt.config.*')) return 'web-app';

  // Backend / API
  if (exists('Dockerfile') || exists('prisma') || exists('drizzle.config.*')) return 'backend-api';

  // Rust
  if (exists('Cargo.toml')) return 'rust-project';

  // Python
  if (exists('pyproject.toml') || exists('setup.py') || exists('requirements.txt')) return 'python-project';

  return 'generic';
}

/**
 * Suggested agent rosters by project type.
 */
export const ROSTER_SUGGESTIONS: Record<ProjectType, string[]> = {
  'saas-web-app': [
    'advocate', 'architect', 'builder', 'compliance', 'reviewer', 'tester', 'security', 'documentor',
    'designer', 'copywriter', 'performance', 'devops', 'dba', 'e2e',
    'dx', 'seo', 'pm', 'product', 'sales', 'legal', 'a11y', 'qa',
    'debugger', 'release', 'narrator', 'analyst',
  ],
  'web-app': [
    'advocate', 'architect', 'builder', 'compliance', 'reviewer', 'tester', 'security', 'documentor',
    'designer', 'copywriter', 'performance', 'devops', 'e2e', 'seo',
    'a11y', 'qa', 'debugger',
  ],
  'backend-api': [
    'advocate', 'architect', 'builder', 'compliance', 'reviewer', 'tester', 'security', 'documentor',
    'devops', 'dba', 'performance', 'dx', 'qa', 'debugger', 'release', 'analyst',
  ],
  'ios-app': [
    'advocate', 'architect', 'builder', 'compliance', 'reviewer', 'tester', 'security', 'documentor',
    'designer', 'mobile', 'performance', 'a11y', 'qa', 'debugger',
  ],
  'macos-app': [
    'advocate', 'architect', 'builder', 'compliance', 'reviewer', 'tester', 'security', 'documentor',
    'designer', 'performance', 'qa', 'debugger',
  ],
  'flutter-app': [
    'advocate', 'architect', 'builder', 'compliance', 'reviewer', 'tester', 'security', 'documentor',
    'designer', 'mobile', 'performance', 'a11y', 'debugger',
  ],
  'game': [
    'advocate', 'architect', 'builder', 'compliance', 'reviewer', 'tester', 'documentor',
    'gamedev', '3d', 'audio', 'designer', 'performance', 'debugger',
  ],
  'rust-project': [
    'advocate', 'architect', 'builder', 'compliance', 'reviewer', 'tester', 'security', 'documentor',
    'performance', 'debugger', 'qa',
  ],
  'python-project': [
    'advocate', 'architect', 'builder', 'compliance', 'reviewer', 'tester', 'security', 'documentor',
    'performance', 'debugger', 'qa', 'analyst',
  ],
  'generic': [
    'advocate', 'architect', 'builder', 'compliance', 'reviewer', 'tester', 'security', 'documentor',
    'debugger', 'qa',
  ],
};
