// p10w-wfp — P10w (docs/plans/gnomon-windows.md W1, W5, W11).
// Decision it settles: can sessions get per-session network denies through the
// Windows Filtering Platform WITHOUT a service, i.e. from the non-elevated
// kernel (Medium integrity, the user's filtered token)?
//
// READ-ONLY. It never adds a filter, provider, sublayer or firewall rule:
//   1. the token: integrity level, whether Administrators is deny-only (a UAC
//      filtered admin token), elevation; UAC policy values;
//   2. the services WFP lives in (BFE, MpsSvc);
//   3. wfp-access.ps1: FwpmEngineOpen0, then the security descriptors of the
//      filter container, the engine and the ALE connect / recv-accept layers
//      (and AccessCheck for FWPM_ACTRL_ADD / ADD_LINK when they are readable),
//      a read-only transaction, a filter enumeration and an EMPTY write
//      transaction aborted at once (the engine's own BEGIN_WRITE_TXN check,
//      the first step of every FwpmFilterAdd0; nothing is added);
//   4. `netsh wfp show state` (read-only dump);
//   5. the Windows Firewall rule store: HKLM ...\FirewallPolicy\FirewallRules
//      opened for WRITE (an open, never a write) — the INetFwPolicy2 /
//      New-NetFirewallRule route lands there;
//   6. INetFwPolicy2 read (the firewall's profile state), which any user may do.
// requiresAdmin is derived from the return codes, never assumed.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const specRefs = ['docs/plans/gnomon-windows.md W1 P10w', 'W5 WFP per P10w', 'W11 broker service', 'G-SBX-08', 'G-WIN-06'];

const ACCESS_DENIED = '0x00000005';

function ps(script, timeout = 60_000) {
  try {
    return { ok: true, out: execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { encoding: 'utf8', timeout, windowsHide: true }).trim() };
  } catch (e) {
    return { ok: false, out: String(e.stdout ?? '').trim(), err: String(e.stderr ?? e.message).trim().split(/\r?\n/)[0] };
  }
}
const json = (r) => {
  try { return r.ok ? JSON.parse(r.out) : { error: r.err || r.out }; } catch { return { unparsed: r.out.slice(0, 500) }; }
};

export default async function probe(ctx) {
  if (ctx.platform !== 'win32') return { verdict: 'partial', evidence: { skipped: `${ctx.platform}: P10w is the Windows WFP probe; macOS session network denies are SBPL (p10m-sbx-deny-mac)` } };

  const token = json(ps(`
$id = [Security.Principal.WindowsIdentity]::GetCurrent()
$p = [Security.Principal.WindowsPrincipal]::new($id)
$g = & (Join-Path ([Environment]::SystemDirectory) "whoami.exe") /groups /fo csv | ConvertFrom-Csv
$label = ($g | Where-Object { $_.'Group Name' -like 'Mandatory Label\\*' }).'Group Name'
$adm = $g | Where-Object { $_.SID -eq 'S-1-5-32-544' }
$uac = Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System'
[pscustomobject]@{
  integrity = $label
  isInAdministratorsRole = $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  administratorsGroup = if ($adm) { $adm.Attributes } else { 'not a member' }
  enableLUA = $uac.EnableLUA
  consentPromptBehaviorAdmin = $uac.ConsentPromptBehaviorAdmin
} | ConvertTo-Json -Compress`));

  const services = json(ps(`Get-Service BFE, MpsSvc | ForEach-Object { [pscustomobject]@{ name = $_.Name; status = $_.Status.ToString(); startType = $_.StartType.ToString() } } | ConvertTo-Json -Compress`));

  const wfp = json(ps(`& '${path.join(ctx.probeDir, 'wfp-access.ps1').replace(/'/g, "''")}'`));

  const tmp = mkdtempSync(path.join(os.tmpdir(), 'p10w-'));
  let netshState;
  try {
    let out;
    let status = 0;
    try {
      out = execFileSync('netsh.exe', ['wfp', 'show', 'state', `file=${path.join(tmp, 'state.xml')}`], { encoding: 'utf8', timeout: 60_000, windowsHide: true });
    } catch (e) {
      out = String(e.stdout ?? '') + String(e.stderr ?? '');
      status = e.status ?? -1;
    }
    netshState = { exitCode: status, output: out.trim().split(/\r?\n/).filter(Boolean).slice(0, 3) };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  const firewallStore = json(ps(`
$path = 'SYSTEM\\CurrentControlSet\\Services\\SharedAccess\\Parameters\\FirewallPolicy\\FirewallRules'
$r = [ordered]@{ key = "HKLM\\$path" }
try { $k = [Microsoft.Win32.Registry]::LocalMachine.OpenSubKey($path, $false); $r.openRead = if ($k) { 'ok' } else { 'missing' }; if ($k) { $r.ruleCount = $k.ValueCount; $k.Close() } } catch { $r.openRead = $_.Exception.GetType().Name }
try { $k = [Microsoft.Win32.Registry]::LocalMachine.OpenSubKey($path, $true); $r.openWrite = if ($k) { 'ok' } else { 'missing' }; if ($k) { $k.Close() } } catch { $x = $_.Exception; while ($x.InnerException) { $x = $x.InnerException }; $r.openWrite = $x.GetType().Name; $r.openWriteMessage = $x.Message }
try { $fw = New-Object -ComObject HNetCfg.FwPolicy2; $r.fwPolicy2Read = 'ok'; $r.currentProfileTypes = $fw.CurrentProfileTypes } catch { $r.fwPolicy2Read = $_.Exception.Message }
[pscustomobject]$r | ConvertTo-Json -Compress`));

  const denied = (v) => v === ACCESS_DENIED || v?.error === ACCESS_DENIED || v?.rc === ACCESS_DENIED;
  const wfpAddBlocked = wfp.engineOpen === 'ok' && denied(wfp.emptyWriteTxnBegin) && denied(wfp.filterContainer);
  const wfpAddGranted = wfp.filterContainer?.FWPM_ACTRL_ADD === 'granted' && wfp.emptyWriteTxnBegin === '0x00000000';
  const firewallRuleWriteBlocked = firewallStore.openWrite === 'SecurityException' || firewallStore.openWrite === 'UnauthorizedAccessException';
  const requiresAdmin = wfpAddBlocked && !wfpAddGranted;
  const filteredAdmin = typeof token.administratorsGroup === 'string' && /deny only/i.test(token.administratorsGroup);

  return {
    verdict: requiresAdmin ? 'fail' : wfpAddGranted ? 'pass' : 'partial',
    evidence: {
      question: 'can the non-elevated kernel add a per-session WFP filter (no service)?',
      token,
      services,
      wfpEngine: wfp,
      netshShowState: netshState,
      firewallRuleStore: firewallStore,
      summary: {
        requiresAdmin,
        wfpEngineOpensUnelevated: wfp.engineOpen === 'ok',
        wfpWriteTransactionDenied: denied(wfp.emptyWriteTxnBegin),
        wfpReadTransactionDenied: denied(wfp.readTxnBegin),
        wfpFilterEnumDenied: denied(wfp.filterEnum),
        wfpSecurityDescriptorsUnreadable: ['filterContainer', 'engine', 'layerAleAuthConnectV4', 'layerAleAuthRecvAcceptV4'].every((k) => denied(wfp[k])),
        firewallRuleStoreWriteDenied: firewallRuleWriteBlocked,
        userIsFilteredAdmin: filteredAdmin,
        decision: requiresAdmin
          ? 'WFP per-session denies need an elevated principal: a service (W11 broker, one UAC prompt at install) or LocalSystem helper must own the filters. The non-elevated kernel cannot add them, nor even read WFP state.'
          : 'the non-elevated kernel can add WFP filters',
      },
      notMeasured: [
        'no filter was added (not even a dynamic-session one): a filter add would change system state, so the empty aborted write transaction stands in as the access check',
        'per-app filtering by AppContainer SID or by the session SID (W5) is a question for the service-side follow-up once a principal can add filters',
      ],
    },
    toolVersions: {},
  };
}
