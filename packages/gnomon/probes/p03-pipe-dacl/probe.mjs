// p03-pipe-dacl — P03 (Windows parity W1, docs/plans/gnomon-windows.md; spec §16 "Kernel endpoint" row,
// S22-H7, G-WIN-01): who owns the kernel's named pipe, and can it be made owner-only?
//
// Questions, each answered on this machine:
//   1. adopt     Can Node adopt a pipe another process created? (net.Server.listen({fd}) on win32)
//   2. default   The DACL libuv gives a pipe Node creates (lpSecurityAttributes = NULL).
//   3. tighten   Can a same-user process replace that DACL with a protected owner-only one through a
//                client handle opened READ_CONTROL|WRITE_DAC, and does a NEW instance carry it?
//   4. squat     Node second: a name another process already serves makes Node's listen fail
//                (libuv binds with FILE_FLAG_FIRST_PIPE_INSTANCE), both against a Node and a .NET squatter.
//
// The DACL work runs in Windows PowerShell 5.1 (stock on every Windows 11) with a small inline C# type:
// zero deps, no build. In the product this is a helper op (gnomon-helper.exe, Rust, P8-D71); this probe
// only proves the mechanism. Non-win32: verdict partial ("Windows only").
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import net from 'node:net';

export const specRefs = ['§16 Kernel endpoint', 'S22-H7', 'G-WIN-01', 'P8-D71', 'docs/plans/gnomon-windows.md W1'];

const PS = `${process.env.SystemRoot ?? 'C:\\Windows'}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;

const CS = String.raw`
using System;
using System.Runtime.InteropServices;
public static class P03 {
  [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  static extern IntPtr CreateFileW(string n, uint a, uint s, IntPtr sa, uint d, uint f, IntPtr t);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("advapi32.dll")] static extern uint GetSecurityInfo(IntPtr h, int t, uint i, IntPtr o, IntPtr g, out IntPtr d, IntPtr s, out IntPtr sd);
  [DllImport("advapi32.dll", CharSet=CharSet.Unicode)] static extern bool ConvertSecurityDescriptorToStringSecurityDescriptorW(IntPtr sd, uint r, uint i, out IntPtr s, out uint l);
  [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool ConvertStringSecurityDescriptorToSecurityDescriptorW(string s, uint r, out IntPtr sd, out uint l);
  [DllImport("advapi32.dll")] static extern bool GetSecurityDescriptorDacl(IntPtr sd, out bool p, out IntPtr d, out bool df);
  [DllImport("advapi32.dll")] static extern uint SetSecurityInfo(IntPtr h, int t, uint i, IntPtr o, IntPtr g, IntPtr d, IntPtr s);
  static IntPtr Open(string name, uint access) { return CreateFileW(@"\\.\pipe\" + name, access, 0, IntPtr.Zero, 3, 0, IntPtr.Zero); }
  static string Sddl(IntPtr h) {
    IntPtr d, sd; uint r = GetSecurityInfo(h, 6, 5, IntPtr.Zero, IntPtr.Zero, out d, IntPtr.Zero, out sd);
    if (r != 0) return "ERR" + r;
    IntPtr s; uint l; ConvertSecurityDescriptorToStringSecurityDescriptorW(sd, 1, 5, out s, out l);
    return Marshal.PtrToStringUni(s);
  }
  public static string Read(string name) {
    IntPtr h = Open(name, 0x20000); if (h == (IntPtr)(-1)) return "OPENERR" + Marshal.GetLastWin32Error();
    try { return Sddl(h); } finally { CloseHandle(h); }
  }
  public static string Tighten(string name, string sddl) {
    IntPtr h = Open(name, 0x20000 | 0x40000); if (h == (IntPtr)(-1)) return "OPENERR" + Marshal.GetLastWin32Error();
    try {
      IntPtr sd; uint l; if (!ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl, 1, out sd, out l)) return "SDDLERR" + Marshal.GetLastWin32Error();
      bool p, df; IntPtr d; GetSecurityDescriptorDacl(sd, out p, out d, out df);
      uint r = SetSecurityInfo(h, 6, 4 | 0x80000000, IntPtr.Zero, IntPtr.Zero, d, IntPtr.Zero);
      return r == 0 ? "OK" : "SETERR" + r;
    } finally { CloseHandle(h); }
  }
}`;

/** Run one PowerShell script (UTF-16LE base64, so nothing is quoted through a shell); returns its stdout lines. */
function ps(script, timeout = 30_000) {
  const enc = Buffer.from(script, 'utf16le').toString('base64');
  const r = spawnSync(PS, ['-NoProfile', '-NonInteractive', '-EncodedCommand', enc], { encoding: 'utf8', timeout, windowsHide: true });
  return { status: r.status, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
}

const addType = `Add-Type -TypeDefinition @'\n${CS}\n'@\n`;

function listen(path) {
  return new Promise((resolve) => {
    const conns = [];
    const s = net.createServer((c) => { conns.push(c); c.on('error', () => {}); });
    s.once('error', (e) => resolve({ ok: false, code: e.code, server: s }));
    s.listen(path, () => resolve({ ok: true, server: s, conns }));
  });
}

export default async function probe(ctx) {
  if (ctx.platform !== 'win32') return { verdict: 'partial', evidence: { reason: 'Windows only (named-pipe DACL)' } };
  const evidence = {};
  const name = `gnomon-p03-${randomBytes(6).toString('hex')}`;
  const pipe = `\\\\.\\pipe\\${name}`;
  const sid = ps('[Security.Principal.WindowsIdentity]::GetCurrent().User.Value').out;
  evidence.userSid = sid ? 'S-1-5-21-…' : 'unknown';

  // 1. adopt: listen({fd}) is the only way a Node server could take another process's handle
  evidence.adopt = await new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', (e) => resolve({ supported: false, error: e.code ?? String(e.message) }));
    try {
      s.listen({ fd: 0 }, () => { s.close(); resolve({ supported: true }); });
    } catch (e) {
      resolve({ supported: false, error: e.code ?? String(e.message) });
    }
  });

  const first = await listen(pipe);
  if (!first.ok) return { verdict: 'fail', evidence: { ...evidence, listen: first.code } };
  try {
    // 2. default DACL; 3. tighten + read back on a fresh instance
    const owner = `D:P(A;;FA;;;${sid})`;
    const r = ps(`${addType}"default=" + [P03]::Read('${name}')\n"tighten=" + [P03]::Tighten('${name}', '${owner}')\n"after=" + [P03]::Read('${name}')`);
    const kv = Object.fromEntries(r.out.split(/\r?\n/).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
    const scrub = (s) => (s ?? '').split(sid).join('<user>');
    evidence.defaultDacl = scrub(kv.default);
    evidence.defaultGrantsEveryone = /\(A;;[^;]*;;;(WD|AN)\)/.test(kv.default ?? '');
    evidence.tighten = kv.tighten;
    evidence.afterDacl = scrub(kv.after);
    const want = `D:P(A;;FA;;;${sid})`;
    evidence.afterIsOwnerOnly = (kv.after ?? '').endsWith(want) && !/\((A|D);;[^;]*;;;(WD|AN|BA|SY)\)/.test(kv.after ?? '');
    evidence.connectionsSeenByServer = first.conns.length; // the helper's own client opens: the kernel must drop them

    // 4a. squat: a second Node listener on the same name
    const second = await listen(pipe);
    evidence.secondNodeListen = second.ok ? 'bound' : second.code;
    if (second.ok) second.server.close();
  } finally {
    first.server.close();
  }

  // 4b. squat: a .NET server holds the name first; Node must fail, never share
  const squatName = `${name}-sq`;
  const squatter = spawn(PS, ['-NoProfile', '-NonInteractive', '-Command',
    `$s = New-Object System.IO.Pipes.NamedPipeServerStream('${squatName}', 'InOut', 4); 'up'; Start-Sleep -Seconds 8; $s.Dispose()`], { windowsHide: true });
  await new Promise((resolve) => { squatter.stdout.once('data', resolve); setTimeout(resolve, 8000); });
  const vsNet = await listen(`\\\\.\\pipe\\${squatName}`);
  evidence.listenAfterForeignSquat = vsNet.ok ? 'bound' : vsNet.code;
  if (vsNet.ok) vsNet.server.close();
  squatter.kill();

  const pass = evidence.adopt.supported === false && evidence.defaultGrantsEveryone === true && evidence.tighten === 'OK'
    && evidence.afterIsOwnerOnly && evidence.secondNodeListen !== 'bound' && evidence.listenAfterForeignSquat !== 'bound';
  evidence.decision = pass
    ? 'Node cannot adopt a helper-created pipe; the kernel creates it (libuv FIRST_PIPE_INSTANCE, so a squatter fails the listen closed), '
      + 'the helper replaces the default DACL (Everyone/Anonymous read) with a protected owner-only one through a WRITE_DAC client handle, '
      + 'the DACL is pipe-wide (new instances carry it), and the kernel drops every connection accepted before the helper reports the read-back.'
    : 'see evidence';
  return { verdict: pass ? 'pass' : 'fail', evidence, toolVersions: { powershell: ps('$PSVersionTable.PSVersion.ToString()').out } };
}
