/**
 * @symbol #session-runner
 *
 * Read a Claude Code policy registry key for the law-7 scan (spec §16 "Claude Code preflight paths": HKLM/HKCU
 * `SOFTWARE\Policies\ClaudeCode`). Read through the kernel's pinned helper (`registry.read`: RegOpenKeyExW +
 * RegEnumValueW), never reg.exe: reg.exe's messages are localized, so on a non-English Windows a missing key could
 * not be told from an error and every key read as unreadable (PR #52 release blocker). A key that does not exist is
 * ABSENT (no layer, by its error CODE); a key that exists yields one layer per value: a string value holding JSON is
 * parsed and scanned like a settings file, anything else is `undefined` (unreadable), which the scan treats as a hit
 * (fail closed, law 7). W3 of docs/plans/gnomon-windows.md.
 */
import { helperOpSync, kernelWin32Helper } from './helper-client.js';

export type RegistryRead = { exists: false } | { exists: true; values: Array<{ name: string; type: string; data: string }> } | { exists: 'unknown'; why: string };

/** The helper call (a seam for tests): the `registry.read` reply. */
export type RegistryReader = (key: string) => Record<string, unknown>;

const helperReader: RegistryReader = (key) => helperOpSync(kernelWin32Helper(), 'registry.read', { key });

/** One key's values; a missing key is `exists: false`; anything the helper could not read is `unknown` (fail closed). */
export function readRegistryKey(key: string, read: RegistryReader = helperReader): RegistryRead {
  if (!/^(HKLM|HKCU)\\[A-Za-z0-9_\\ .-]+$/.test(key)) return { exists: 'unknown', why: 'not a policy key' };
  let r: Record<string, unknown>;
  try {
    r = read(key);
  } catch (e) {
    return { exists: 'unknown', why: e instanceof Error ? e.message.slice(0, 200) : 'helper error' };
  }
  if (r.exists === false) return { exists: false };
  if (r.exists !== true || !Array.isArray(r.values)) return { exists: 'unknown', why: 'malformed reply' };
  const values: Array<{ name: string; type: string; data: string }> = [];
  for (const v of r.values as Array<Record<string, unknown>>) {
    if (typeof v.name !== 'string' || typeof v.type !== 'string') return { exists: 'unknown', why: 'malformed value' };
    values.push({ name: v.name, type: v.type, data: typeof v.data === 'string' ? v.data : '' });
  }
  return { exists: true, values };
}

/** The law-7 layers for one managed registry source (see the module doc). */
export function registryLayers(key: string, read?: RegistryReader): Array<{ where: string; json: unknown }> {
  const r = readRegistryKey(key, read);
  if (r.exists === false) return [];
  if (r.exists === 'unknown') return [{ where: `managed:${key}`, json: undefined }];
  return r.values.map((v) => {
    let json: unknown;
    // REG_SZ only: a REG_EXPAND_SZ is never expanded with the kernel's env (a %VAR% could redirect policy), so it is
    // unreadable like every other non-string type (Aegis W3 L2, fail closed)
    if (v.type === 'REG_SZ') {
      try {
        json = JSON.parse(v.data);
      } catch {
        json = undefined;
      }
    }
    return { where: `managed:${key}\\${v.name}`, json };
  });
}
