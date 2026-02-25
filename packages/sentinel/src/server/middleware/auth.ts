/**
 * Authentication middleware for Sentinel server
 *
 * Bearer token authentication with permission levels.
 * When auth is disabled, all requests pass through.
 */

import type { Request, Response, NextFunction } from 'express';
import type { AuthConfig, AuthPermission } from '../../types.js';

/**
 * Create auth middleware that checks bearer tokens
 */
export function createAuthMiddleware(config: AuthConfig) {
  return function authMiddleware(requiredPermission: AuthPermission) {
    return (req: Request, res: Response, next: NextFunction): void => {
      // Auth disabled — pass through
      if (!config.enabled) {
        next();
        return;
      }

      const authHeader = req.headers.authorization;
      if (!authHeader) {
        res.status(401).json({ error: 'Authentication required. Provide Authorization: Bearer <token>' });
        return;
      }

      const match = authHeader.match(/^Bearer\s+(.+)$/i);
      if (!match) {
        res.status(401).json({ error: 'Invalid authorization format. Use: Bearer <token>' });
        return;
      }

      const tokenValue = match[1];
      const tokenEntry = config.tokens.find((t) => t.token === tokenValue);

      if (!tokenEntry) {
        res.status(401).json({ error: 'Invalid token' });
        return;
      }

      // Check expiry
      if (tokenEntry.expiresAt && new Date(tokenEntry.expiresAt) < new Date()) {
        res.status(401).json({ error: 'Token expired' });
        return;
      }

      // Check permission
      const permissionLevel: Record<AuthPermission, number> = { read: 1, write: 2, admin: 3 };
      const hasPermission = tokenEntry.permissions.some(
        (p) => permissionLevel[p] >= permissionLevel[requiredPermission]
      );

      if (!hasPermission) {
        res.status(403).json({ error: `Insufficient permissions. Required: ${requiredPermission}` });
        return;
      }

      // Attach token info to request for downstream use
      (req as any).authToken = tokenEntry;
      next();
    };
  };
}
