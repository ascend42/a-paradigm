/**
 * Rate limiting middleware for Sentinel server
 *
 * Per-service and global rate limiting with configurable sampling.
 * Uses in-memory sliding window counters.
 */

import type { Request, Response, NextFunction } from 'express';
import type { RateLimitConfig, RateLimitRule } from '../../types.js';

interface WindowEntry {
  count: number;
  windowStart: number;
}

const serviceWindows = new Map<string, WindowEntry>();
const globalWindow: WindowEntry = { count: 0, windowStart: Date.now() };
const WINDOW_MS = 60_000; // 1 minute

function getOrResetWindow(entry: WindowEntry): WindowEntry {
  const now = Date.now();
  if (now - entry.windowStart > WINDOW_MS) {
    entry.count = 0;
    entry.windowStart = now;
  }
  return entry;
}

/**
 * Create rate limiting middleware
 */
export function createRateLimiter(config: RateLimitConfig) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!config.enabled) {
      next();
      return;
    }

    // Determine service from body or query
    const service = req.body?.service || req.body?.entries?.[0]?.service || req.query.service || '_unknown';

    // Get applicable rule (per-service overrides global)
    const rule: RateLimitRule = config.perService[service as string] || config.global;

    // Sampling: randomly drop requests based on samplingRate
    if (rule.samplingRate < 1.0 && Math.random() > rule.samplingRate) {
      res.status(200).json({ accepted: 0, sampled: true, message: 'Request dropped by sampling' });
      return;
    }

    // Check global rate
    const gw = getOrResetWindow(globalWindow);
    if (gw.count >= config.global.maxRequestsPerMinute) {
      res.status(429).json({
        error: 'Global rate limit exceeded',
        retryAfterMs: WINDOW_MS - (Date.now() - gw.windowStart),
      });
      return;
    }

    // Check per-service rate
    if (!serviceWindows.has(service as string)) {
      serviceWindows.set(service as string, { count: 0, windowStart: Date.now() });
    }
    const sw = getOrResetWindow(serviceWindows.get(service as string)!);
    if (sw.count >= rule.maxRequestsPerMinute) {
      res.status(429).json({
        error: `Rate limit exceeded for service: ${service}`,
        retryAfterMs: WINDOW_MS - (Date.now() - sw.windowStart),
      });
      return;
    }

    // Check batch size
    const batchSize = req.body?.entries?.length || 1;
    if (batchSize > rule.maxEntriesPerBatch) {
      res.status(413).json({
        error: `Batch too large: ${batchSize} entries, max ${rule.maxEntriesPerBatch} for service ${service}`,
      });
      return;
    }

    // Increment counters
    gw.count++;
    sw.count++;

    next();
  };
}

/**
 * Get current rate limit stats (for monitoring)
 */
export function getRateLimitStats(): {
  global: { count: number; windowStart: number };
  services: Record<string, { count: number; windowStart: number }>;
} {
  return {
    global: { ...globalWindow },
    services: Object.fromEntries(
      Array.from(serviceWindows.entries()).map(([k, v]) => [k, { ...v }])
    ),
  };
}
