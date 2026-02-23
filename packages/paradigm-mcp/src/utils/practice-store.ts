/**
 * Practice Store - MCP-side wrapper for practice event storage
 *
 * Uses SentinelStorage for persistence and provides
 * convenience methods for the habits MCP tools.
 */

import * as path from 'path';
import { SentinelStorage } from '@a-company/sentinel';
import type {
  PracticeEvent,
  PracticeEventInput,
  PracticeEventQuery,
  PracticeCategory,
} from '@a-company/sentinel';

let storageInstance: SentinelStorage | null = null;
let storageInitialized = false;

/**
 * Get or create the shared storage instance
 */
async function getStorage(rootDir: string): Promise<SentinelStorage> {
  if (!storageInstance) {
    const dbPath = path.join(rootDir, '.paradigm', 'sentinel', 'sentinel.db');
    storageInstance = new SentinelStorage(dbPath);
    await storageInstance.ensureReady();
    storageInitialized = true;
  } else if (!storageInitialized) {
    await storageInstance.ensureReady();
    storageInitialized = true;
  }
  return storageInstance;
}

/**
 * Record a practice event
 */
export async function recordPracticeEvent(
  rootDir: string,
  input: PracticeEventInput
): Promise<string> {
  const storage = await getStorage(rootDir);
  return storage.recordPracticeEvent(input);
}

/**
 * Query practice events
 */
export async function getPracticeEvents(
  rootDir: string,
  options?: PracticeEventQuery
): Promise<PracticeEvent[]> {
  const storage = await getStorage(rootDir);
  return storage.getPracticeEvents(options);
}

/**
 * Get compliance rate for a given query
 */
export async function getComplianceRate(
  rootDir: string,
  options?: PracticeEventQuery
): Promise<{
  total: number;
  followed: number;
  skipped: number;
  partial: number;
  rate: number;
}> {
  const storage = await getStorage(rootDir);
  return storage.getComplianceRate(options);
}

/**
 * Get compliance rates grouped by category
 */
export async function getComplianceByCategory(
  rootDir: string,
  options?: Omit<PracticeEventQuery, 'habitCategory'>
): Promise<
  Array<{
    category: PracticeCategory;
    total: number;
    followed: number;
    skipped: number;
    partial: number;
    rate: number;
  }>
> {
  const categories: PracticeCategory[] = [
    'discovery',
    'verification',
    'testing',
    'documentation',
    'collaboration',
    'security',
  ];

  const results = [];
  for (const category of categories) {
    const rate = await getComplianceRate(rootDir, {
      ...options,
      habitCategory: category,
    });
    if (rate.total > 0) {
      results.push({ category, ...rate });
    }
  }

  return results;
}

/**
 * Get practice event count
 */
export async function getPracticeEventCount(
  rootDir: string,
  options?: PracticeEventQuery
): Promise<number> {
  const storage = await getStorage(rootDir);
  return storage.getPracticeEventCount(options);
}

/**
 * Record multiple practice events from an evaluation result
 */
export async function recordEvaluationResults(
  rootDir: string,
  evaluations: Array<{
    habitId: string;
    habitCategory: PracticeCategory;
    result: 'followed' | 'skipped' | 'partial';
    notes?: string;
  }>,
  context: {
    engineer: string;
    sessionId: string;
    loreEntryId?: string;
    taskDescription?: string;
    symbolsTouched?: string[];
    filesModified?: string[];
  }
): Promise<string[]> {
  const ids: string[] = [];
  for (const eval_ of evaluations) {
    const id = await recordPracticeEvent(rootDir, {
      habitId: eval_.habitId,
      habitCategory: eval_.habitCategory,
      result: eval_.result,
      engineer: context.engineer,
      sessionId: context.sessionId,
      loreEntryId: context.loreEntryId,
      taskDescription: context.taskDescription,
      symbolsTouched: context.symbolsTouched,
      filesModified: context.filesModified,
      notes: eval_.notes,
    });
    ids.push(id);
  }
  return ids;
}

/**
 * Reset the storage instance (for testing)
 */
export function resetPracticeStore(): void {
  if (storageInstance) {
    storageInstance.close();
    storageInstance = null;
    storageInitialized = false;
  }
}
