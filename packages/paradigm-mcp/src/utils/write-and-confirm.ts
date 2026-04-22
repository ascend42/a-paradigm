/**
 * write-and-confirm — atomic write + read-back verification wrapper.
 *
 * Closes the class of silent-no-op bugs where a handler returned `ok` but
 * the mutation never landed on disk. Applied to the five highest-value
 * mutation handlers in v5.38.0 (portal_add_gate, portal_add_route,
 * purpose_add_component, purpose_link, purpose_remove).
 *
 * Security contract (non-negotiable, per 2026-04-22 security audit §4b):
 *   - `hashHint` is a TRUNCATED HMAC-SHA256 (first 12 hex chars, keyed with
 *     a deterministic per-install secret). Never a raw content hash — small
 *     YAML files are pre-image attackable.
 *   - Thrown `WriteVerificationError` contains no file contents, gate names,
 *     or route paths — only classifier strings safe for logs / telemetry.
 *   - The `verify` callback runs locally with the read-back file content;
 *     its result (boolean) is all that's surfaced to the envelope.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { log } from './mcp-logger.js';
import { isStrictMode } from './strict-mode.js';

/**
 * Envelope returned by writeAndConfirm. Additive fields — existing consumers
 * that only read `written` / `path` continue to work.
 */
export interface WriteEnvelope {
  written: true;
  path: string;
  /**
   * Truncated HMAC of post-write file contents: first 12 hex chars of
   * HMAC-SHA256 keyed with a deterministic per-install secret. Advisory
   * only — useful for detecting tampering by the Paradigm tool chain
   * itself (not an adversary). Not a content hash.
   */
  hashHint: string;
  /** Size of file after write, in bytes. */
  bytes: number;
}

/**
 * Raised when the read-back verify callback returns false. Message is a
 * fixed classifier — does not include the read content or file path detail.
 */
export class WriteVerificationError extends Error {
  readonly code = 'WRITE_VERIFICATION_FAILED';
  constructor(message: string = 'write verification failed') {
    super(message);
    this.name = 'WriteVerificationError';
  }
}

// ---------------------------------------------------------------------------
// Per-install HMAC key
// ---------------------------------------------------------------------------

const HMAC_KEY_FILE = '.paradigm-install-key';
const HMAC_BUILD_FALLBACK = 'paradigm-v5.38.0-hmac-fallback-key';
let cachedKey: Buffer | null = null;

/**
 * Load (or bootstrap) a deterministic per-install HMAC key.
 *
 * Key is stored at `~/.paradigm-install-key` and generated on first use.
 * If the filesystem is read-only or the home directory is unavailable,
 * we fall back to a fixed build-time constant. The fallback is not secure
 * against an adversary who reads our source; the full design assumes
 * hashHint is advisory, not cryptographic.
 */
function getHmacKey(): Buffer {
  if (cachedKey) return cachedKey;
  try {
    const home = os.homedir();
    const keyPath = path.join(home, HMAC_KEY_FILE);
    if (fs.existsSync(keyPath)) {
      const hex = fs.readFileSync(keyPath, 'utf-8').trim();
      if (/^[0-9a-f]{64}$/i.test(hex)) {
        cachedKey = Buffer.from(hex, 'hex');
        return cachedKey;
      }
    }
    const fresh = crypto.randomBytes(32);
    try {
      fs.writeFileSync(keyPath, fresh.toString('hex'), { encoding: 'utf-8', mode: 0o600 });
    } catch {
      // Non-fatal: readonly fs or similar. Still use the fresh key in-memory.
    }
    cachedKey = fresh;
    return cachedKey;
  } catch {
    cachedKey = Buffer.from(HMAC_BUILD_FALLBACK);
    return cachedKey;
  }
}

/**
 * Compute the truncated HMAC hint for a given content buffer/string.
 * Exposed for tests; callers should use `writeAndConfirm` which invokes it.
 */
export function computeHashHint(content: string | Buffer): string {
  const hmac = crypto.createHmac('sha256', getHmacKey());
  hmac.update(content);
  return hmac.digest('hex').slice(0, 12);
}

// ---------------------------------------------------------------------------
// Atomic write
// ---------------------------------------------------------------------------

/**
 * Write content to `path` atomically: writes to a `.tmp` sibling first,
 * then renames into place. Ensures either the old content or the new
 * content is observable — never a partial write.
 */
function atomicWrite(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  // Collision-resistant .tmp name to survive concurrent writers
  const tmpName = `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  const tmpPath = path.join(dir, tmpName);
  try {
    fs.writeFileSync(tmpPath, content, { encoding: 'utf-8' });
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    // Cleanup .tmp if rename failed
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Atomically write `content` to `path`, read it back, run `verify` against
 * the read content, and return an envelope with hashHint + bytes.
 *
 * Throws `WriteVerificationError` if verify() returns false. In strict
 * mode (`PARADIGM_STRICT=1`), verify failures are NEVER downgraded — in
 * non-strict mode, the same error throws but this is the only public
 * behavior today; the strict flag is reserved for future degraded-write
 * fallbacks if we add any.
 */
export async function writeAndConfirm(
  filePath: string,
  content: string,
  verify: (readBack: string) => boolean,
): Promise<WriteEnvelope> {
  atomicWrite(filePath, content);

  let readBack: string;
  try {
    readBack = fs.readFileSync(filePath, 'utf-8');
  } catch {
    // Read-back failure is always fatal.
    log.component('#write-and-confirm').error('read-back failed after atomic write', {
      // Redacted: never log the path or content
      stage: 'read-back',
    });
    throw new WriteVerificationError('write verification failed (read-back error)');
  }

  let ok = false;
  try {
    ok = verify(readBack);
  } catch {
    log.component('#write-and-confirm').error('verify callback threw', {
      stage: 'verify-callback',
      strict: isStrictMode(),
    });
    throw new WriteVerificationError('write verification failed (verify callback error)');
  }

  if (!ok) {
    log.component('#write-and-confirm').error('verify callback returned false', {
      stage: 'verify-callback-false',
      strict: isStrictMode(),
    });
    throw new WriteVerificationError('write verification failed');
  }

  const bytes = Buffer.byteLength(readBack, 'utf-8');
  const hashHint = computeHashHint(readBack);

  return {
    written: true,
    path: filePath,
    hashHint,
    bytes,
  };
}
