/**
 * @symbol #setup-preflight
 *
 * #setup-preflight (spec §2.4 rule 9; T-2026-10-19-005 MVP-a) — the
 * READ-ONLY checks the first run shows before it asks for anything. No key
 * is created, no file is written, no prompt opens (the helper is asked only
 * `key.list`, which never prompts). Each check is
 *   { id, status: pass | warn | fail, detail, fix? }
 * and the results are INFORMATIVE (Aegis I12): the #provisioner and
 * `gnomon up` enforce every rule again on their own; a surface that skips or
 * misrenders a check weakens nothing.
 *
 * Checks: helper (signed, pinned, answers; not run from a sandboxed shell),
 * touch-id (helper 1.4.0 `presence.available`: LAContext canEvaluatePolicy,
 * never a prompt → pass / fail), macos, sip, claude (resolved +
 * pin none/match/mismatch; law-7 billing env), runtime (NODE_OPTIONS / node
 * flags), node (floor), generations (leftover Secure Enclave keys → purge,
 * never adopt), home (dev marker, symlink, malformed identity.json: shown,
 * never touched).
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { API_BILLING_ENV } from '../budget/billing.js';
import { HelperProcess, pinHelper, type HelperTransport, type HelperVerifier, type PinnedHelper } from '../identity/helper.js';
import { readIdentity, type IdentityRecord } from '../identity/provision.js';
import { leftoverGens, listHelperKeys } from '../identity/provisioner.js';
import { readClaudePin, REPIN_COMMAND, sha256File } from '../runner/binary.js';
import { resolveClaudeBinary } from '../runner/preflight.js';
import { claudeCodePlatform } from '../../platform/claude-code.js';

export type CheckStatus = 'pass' | 'warn' | 'fail';
export interface PreflightCheck {
  id: string;
  status: CheckStatus;
  detail: string;
  fix?: string;
}

export const NODE_MAJOR_FLOOR = 24;
export const MACOS_MAJOR_FLOOR = 13;
const DEV_HOME_MARKER = 'DEV-ONLY-gnomon-home.json';

export interface PreflightInput {
  /** the home as resolved by the first run (strict, never GNOMON_HOME) — it may not exist yet */
  home: string;
  /** the user's home directory (claude lookup) */
  userHome: string;
  helperPath: string;
  verifier?: HelperVerifier;
  start?: (pin: PinnedHelper) => HelperTransport;
  env: Readonly<Record<string, string | undefined>>;
  /** the unsafe-runtime verdict (launch-tty.ts unsafeRuntime), computed by the caller */
  unsafe: string | null;
  platform?: NodeJS.Platform;
  nodeVersion?: string;
  /** tests: command output instead of running sw_vers / csrutil */
  exec?: (file: string, args: string[]) => string;
}

export interface PreflightReport {
  checks: PreflightCheck[];
  /** generations the helper holds that are not this home's live identity (I6: shown, never adopted) */
  leftover: string[];
  existing: IdentityRecord | null;
  ok: boolean;
}

function run(file: string, args: string[]): string {
  return execFileSync(file, args, { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] });
}

export async function runPreflight(i: PreflightInput): Promise<PreflightReport> {
  const checks: PreflightCheck[] = [];
  const platform = i.platform ?? process.platform;
  const exec = i.exec ?? run;
  const add = (c: PreflightCheck): void => {
    checks.push(c);
  };

  // home state: shown, never touched
  let existing: IdentityRecord | null = null;
  let st: fs.Stats | null = null;
  try {
    st = fs.lstatSync(i.home);
  } catch {
    st = null;
  }
  if (st?.isSymbolicLink()) add({ id: 'home', status: 'fail', detail: `${i.home} is a symlink; the home must be a plain directory`, fix: 'replace the link with the real directory (setup never follows it)' });
  else if (st && !st.isDirectory()) add({ id: 'home', status: 'fail', detail: `${i.home} exists and is not a directory`, fix: 'move it aside' });
  else if (st && fs.existsSync(path.join(i.home, DEV_HOME_MARKER))) add({ id: 'home', status: 'fail', detail: `${i.home} is a DEV-ONLY home`, fix: 'it runs only under `gnomon dev up`; move it aside to set up the real home' });
  else if (st) {
    try {
      existing = readIdentity(i.home);
      add({ id: 'home', status: 'pass', detail: existing ? `already set up (${existing.rootKeyId}, ${existing.createdAt})` : `${i.home} exists, no identity yet` });
    } catch (e) {
      add({ id: 'home', status: 'fail', detail: `identity.json is unreadable: ${e instanceof Error ? e.message : 'malformed'}`, fix: 'inspect it with `gnomon identity status`; setup never overwrites it' });
    }
  } else add({ id: 'home', status: 'pass', detail: `${i.home} will be created` });

  // helper: pinned (signature), answers key.list (no prompt)
  let leftover: string[] = [];
  // one helper fault is ONE FAIL (the helper row): touch-id then says it was not checked
  let touch: PreflightCheck = { id: 'touch-id', status: 'warn', detail: 'not checked: the helper is unavailable (see the helper row)' };
  if (i.env.GNOMON_HSID || i.env.APP_SANDBOX_CONTAINER_ID) {
    add({ id: 'helper', status: 'fail', detail: 'this shell runs inside a Gnomon session or an app sandbox', fix: 'run setup from your own terminal' });
  } else {
    let helper: HelperTransport | null = null;
    try {
      const pin = pinHelper(i.helperPath, i.verifier ? { verifier: i.verifier } : {});
      helper = i.start ? i.start(pin) : HelperProcess.start(pin);
      const keys = await listHelperKeys(helper);
      leftover = leftoverGens(keys, existing);
      const p = await helper.request({ op: 'presence.available' });
      touch = p.available === true
        ? { id: 'touch-id', status: 'pass', detail: p.biometrics === true ? 'Touch ID is available (asked without a prompt)' : 'presence is available (passcode; no Touch ID enrolled)' }
        : { id: 'touch-id', status: 'fail', detail: `presence is not available${typeof p.error === 'string' ? ` (${p.error})` : ''}`, fix: 'enable Touch ID in System Settings → Touch ID & Password' };
      add({ id: 'helper', status: 'pass', detail: `signed helper pinned: ${pin.exe}` });
    } catch (e) {
      add({ id: 'helper', status: 'fail', detail: e instanceof Error ? e.message : 'the helper could not be pinned', fix: 'reinstall Gnomon (the signed GnomonHelper.app ships with it)' });
    } finally {
      await helper?.close().catch(() => undefined);
    }
  }
  add(touch);
  add({ id: 'generations', status: leftover.length ? 'warn' : 'pass', detail: leftover.length ? `the Secure Enclave holds Gnomon keys of generation(s) ${leftover.join(', ')} that this home does not use` : 'no leftover Gnomon keys', ...(leftover.length ? { fix: 'purge them (one Touch ID per key); setup never adopts them' } : {}) });

  if (platform === 'darwin') {
    try {
      const v = exec('/usr/bin/sw_vers', ['-productVersion']).trim();
      const major = Number(v.split('.')[0]);
      add({ id: 'macos', status: major >= MACOS_MAJOR_FLOOR ? 'pass' : 'fail', detail: `macOS ${v}`, ...(major >= MACOS_MAJOR_FLOOR ? {} : { fix: `update to macOS ${MACOS_MAJOR_FLOOR} or later` }) });
    } catch {
      add({ id: 'macos', status: 'warn', detail: 'the macOS version could not be read' });
    }
    try {
      const s = exec('/usr/bin/csrutil', ['status']);
      if (/enabled/i.test(s) && !/disabled/i.test(s)) add({ id: 'sip', status: 'pass', detail: 'System Integrity Protection is on' });
      else add({ id: 'sip', status: 'warn', detail: 'System Integrity Protection is off or partly off: a same-user process could tamper with the helper or the Touch ID dialog', fix: 're-enable SIP from Recovery (csrutil enable)' });
    } catch {
      add({ id: 'sip', status: 'warn', detail: 'SIP status could not be read' });
    }
  } else add({ id: 'macos', status: 'warn', detail: `${platform}: the Secure Enclave path is macOS-only (Windows Hello is the parity phase)` });

  // claude + law 7
  const row = claudeCodePlatform(platform);
  if (!row) add({ id: 'claude', status: 'warn', detail: `no Claude Code platform row for ${platform}` });
  else {
    try {
      const real = resolveClaudeBinary({ row, home: i.userHome }).real;
      const sha = await sha256File(real);
      let pin = null;
      try {
        pin = st?.isDirectory() ? readClaudePin(i.home) : null;
      } catch {
        pin = null;
      }
      if (!pin) add({ id: 'claude', status: 'pass', detail: `claude at ${real}; pinned at the first session open` });
      else if (pin.sha256 === sha) add({ id: 'claude', status: 'pass', detail: `claude at ${real}; pin matches` });
      else add({ id: 'claude', status: 'warn', detail: `claude at ${real} changed since it was pinned (Claude Code updated itself)`, fix: REPIN_COMMAND });
    } catch (e) {
      add({ id: 'claude', status: 'warn', detail: e instanceof Error ? e.message : 'claude was not found', fix: 'install Claude Code, then sign in with your subscription' });
    }
  }
  const billing = API_BILLING_ENV.filter((k) => i.env[k] !== undefined && i.env[k] !== '');
  if (billing.length) add({ id: 'law-7', status: 'warn', detail: `${billing.join(', ')} set: sessions are refused while API billing is configured (subscription only)`, fix: `unset ${billing.join(' ')}` });

  add(i.unsafe ? { id: 'runtime', status: 'fail', detail: i.unsafe, fix: 'unset NODE_OPTIONS and start gnomon with no node flags' } : { id: 'runtime', status: 'pass', detail: 'no NODE_OPTIONS, no node flags' });
  const nv = i.nodeVersion ?? process.versions.node;
  const nodeOk = Number(nv.split('.')[0]) >= NODE_MAJOR_FLOOR;
  add({ id: 'node', status: nodeOk ? 'pass' : 'fail', detail: `node ${nv}`, ...(nodeOk ? {} : { fix: `install node ${NODE_MAJOR_FLOOR} or later` }) });

  return { checks, leftover, existing, ok: !checks.some((c) => c.status === 'fail') };
}
