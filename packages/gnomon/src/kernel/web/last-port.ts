/**
 * @symbol #gui-relaunch
 *
 * #gui-relaunch (T-2026-10-20-001): the web endpoint's REMEMBERED port, so a
 * kernel that restarts outside the self-update path (stop, then start) serves
 * the GUI at the SAME origin the open tab already has. The reopened window
 * and the stale tab are then one origin: the stale tab sees its address
 * answer again and hears the new window attach (gnomon-gui core/stale.ts).
 *
 * THREAT NOTES. The file holds a port number and nothing else: no token, no
 * key, no secret. It is same-user writable, so it is read as a PREFERENCE
 * only: a strict shape (an integer 1024..65535), tried with an exclusive bind
 * on 127.0.0.1, and a port that is taken (or a malformed file) silently falls
 * back to an OS-chosen port. A planted value can only choose which loopback
 * port the kernel TRIES first; it never decides an auth, never carries a
 * resume record (#gui-resume's hand-off stays stdin-only, Aegis M), and is
 * never used by the upgrade successor (which has `preferPort` / its inherited
 * fd and the fallback rule of TD-2026-10-19-063).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

export const LAST_PORT_FILE = 'web-port.json';
const SCHEMA = 'gnomon-web-port:v1';
/** Below this a port is privileged or well-known: never preferred. */
export const LAST_PORT_MIN = 1024;

/** The remembered port in `dir`, or null (missing, unreadable, malformed, out of range). Never throws. */
export function readLastPort(dir: string): number | null {
  let raw: string;
  try {
    const p = path.join(dir, LAST_PORT_FILE);
    const st = fs.lstatSync(p);
    if (!st.isFile() || st.size > 256) return null; // a link, a dir or a large file is not ours
    raw = fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
  let o: unknown;
  try {
    o = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  const r = o as Record<string, unknown>;
  if (r.schemaVersion !== SCHEMA || Object.keys(r).length !== 2) return null;
  const port = r.port;
  return typeof port === 'number' && Number.isInteger(port) && port >= LAST_PORT_MIN && port <= 65535 ? port : null;
}

/** Remember `port` in `dir` (temp file + rename; LF; best effort, never throws). */
export function writeLastPort(dir: string, port: number): boolean {
  if (!Number.isInteger(port) || port < LAST_PORT_MIN || port > 65535) return false;
  const target = path.join(dir, LAST_PORT_FILE);
  const tmp = path.join(dir, `.${LAST_PORT_FILE}.${process.pid}.tmp`);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(tmp, `${JSON.stringify({ schemaVersion: SCHEMA, port })}\n`, { mode: 0o600 });
    fs.renameSync(tmp, target);
    return true;
  } catch {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      /* nothing to clean */
    }
    return false;
  }
}
