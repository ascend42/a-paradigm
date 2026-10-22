/**
 * @symbol #session-runner
 *
 * Read a Claude Code policy registry key for the law-7 scan (spec §16 "Claude Code preflight paths": HKLM/HKCU
 * `SOFTWARE\Policies\ClaudeCode`). `reg.exe` runs by absolute path (never PATH) with an empty-ish env. A key that does
 * not exist is ABSENT (no layer); a key that exists yields one layer per value: a string value holding JSON is
 * parsed and scanned like a settings file, anything else is `undefined` (unreadable), which the scan treats as a
 * hit (fail closed, law 7). W3 of docs/plans/gnomon-windows.md.
 */
import { spawnSync } from 'node:child_process';
import * as path from 'node:path';

export type RegistryRead = { exists: false } | { exists: true; values: Array<{ name: string; type: string; data: string }> } | { exists: 'unknown'; why: string };

const SYSTEM_ROOT = process.env.SystemRoot ?? process.env.SYSTEMROOT ?? 'C:\\Windows';

/** `reg query <key>` (values only, no subkeys); exit 1 with "unable to find" = the key does not exist. */
export function readRegistryKey(key: string, run: typeof spawnSync = spawnSync): RegistryRead {
  if (!/^(HKLM|HKCU)\\[A-Za-z0-9_\\ .-]+$/.test(key)) return { exists: 'unknown', why: 'not a policy key' };
  const reg = path.join(SYSTEM_ROOT, 'System32', 'reg.exe');
  const r = run(reg, ['query', key], { encoding: 'utf8', timeout: 10_000, windowsHide: true, env: { SystemRoot: SYSTEM_ROOT } });
  if (r.error) return { exists: 'unknown', why: r.error.message };
  const out = String(r.stdout ?? '');
  if (r.status === 1) return /unable to find|not find|ERROR:/i.test(`${out}${String(r.stderr ?? '')}`) ? { exists: false } : { exists: 'unknown', why: `reg exit 1` };
  if (r.status !== 0) return { exists: 'unknown', why: `reg exit ${String(r.status)}` };
  const values: Array<{ name: string; type: string; data: string }> = [];
  for (const line of out.split(/\r?\n/)) {
    const m = /^\s{4}(.+?)\s{4}(REG_[A-Z_]+)\s{4}(.*)$/.exec(line);
    if (m) values.push({ name: m[1]!, type: m[2]!, data: m[3]! });
  }
  return { exists: true, values };
}

/** The law-7 layers for one managed registry source (see the module doc). */
export function registryLayers(key: string, run?: typeof spawnSync): Array<{ where: string; json: unknown }> {
  const r = readRegistryKey(key, run);
  if (r.exists === false) return [];
  if (r.exists === 'unknown') return [{ where: `managed:${key}`, json: undefined }];
  return r.values.map((v) => {
    let json: unknown;
    if (v.type === 'REG_SZ' || v.type === 'REG_EXPAND_SZ') {
      try {
        json = JSON.parse(v.data);
      } catch {
        json = undefined;
      }
    }
    return { where: `managed:${key}\\${v.name}`, json };
  });
}
