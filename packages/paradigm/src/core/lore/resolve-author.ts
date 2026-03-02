/**
 * Resolve Author - Determines the human user for lore entries
 *
 * Resolution order:
 * 1. PARADIGM_AUTHOR environment variable
 * 2. git config user.name
 * 3. OS username
 * 4. 'unknown' fallback
 */

import { execSync } from 'child_process';
import * as os from 'os';

/**
 * Sanitize an author name to be safe for filenames.
 * Lowercase, alphanumeric + hyphens only, max 20 chars.
 */
export function sanitizeAuthor(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 20) || 'unknown';
}

/**
 * Resolve the current human user's author name.
 */
export function resolveAuthor(): string {
  // 1. Environment variable
  const envAuthor = process.env.PARADIGM_AUTHOR;
  if (envAuthor) return sanitizeAuthor(envAuthor);

  // 2. Git config
  try {
    const gitName = execSync('git config user.name', { encoding: 'utf-8', timeout: 3000 }).trim();
    if (gitName) return sanitizeAuthor(gitName);
  } catch {
    // git not available or not in a repo
  }

  // 3. OS username
  try {
    const username = os.userInfo().username;
    if (username) return sanitizeAuthor(username);
  } catch {
    // userInfo can fail in some environments
  }

  // 4. Fallback
  return 'unknown';
}
