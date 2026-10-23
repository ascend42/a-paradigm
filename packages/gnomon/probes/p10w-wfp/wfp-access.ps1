# p10w-wfp read-only check (W1). Opens the WFP engine as the current user and
# reads the security descriptors of (a) the filter container, (b) the engine,
# (c) the ALE connect/recv-accept layers; then AccessCheck()s this token for
# FWPM_ACTRL_ADD (filters container) and FWPM_ACTRL_ADD_LINK (layers), which
# FwpmFilterAdd0 needs. Then a read-only transaction, a filter enumeration and
# an EMPTY write transaction aborted at once. NOTHING is added, deleted or
# changed: no filter, no provider, no sublayer. Prints one JSON object.
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class P10wWfp {
  [DllImport("fwpuclnt.dll")] static extern uint FwpmEngineOpen0(string server, uint authnService, IntPtr authId, IntPtr session, out IntPtr engine);
  [DllImport("fwpuclnt.dll")] static extern uint FwpmEngineClose0(IntPtr engine);
  [DllImport("fwpuclnt.dll")] static extern uint FwpmEngineGetSecurityInfo0(IntPtr engine, uint si, IntPtr owner, IntPtr group, IntPtr dacl, IntPtr sacl, out IntPtr sd);
  [DllImport("fwpuclnt.dll")] static extern uint FwpmFilterGetSecurityInfoByKey0(IntPtr engine, IntPtr key, uint si, IntPtr owner, IntPtr group, IntPtr dacl, IntPtr sacl, out IntPtr sd);
  [DllImport("fwpuclnt.dll")] static extern uint FwpmLayerGetSecurityInfoByKey0(IntPtr engine, ref Guid key, uint si, IntPtr owner, IntPtr group, IntPtr dacl, IntPtr sacl, out IntPtr sd);
  [DllImport("fwpuclnt.dll")] static extern void FwpmFreeMemory0(ref IntPtr p);
  [DllImport("fwpuclnt.dll")] static extern uint FwpmTransactionBegin0(IntPtr engine, uint flags);
  [DllImport("fwpuclnt.dll")] static extern uint FwpmTransactionAbort0(IntPtr engine);
  [DllImport("fwpuclnt.dll")] static extern uint FwpmFilterCreateEnumHandle0(IntPtr engine, IntPtr template, out IntPtr h);
  [DllImport("fwpuclnt.dll")] static extern uint FwpmFilterEnum0(IntPtr engine, IntPtr h, uint want, out IntPtr entries, out uint n);
  [DllImport("fwpuclnt.dll")] static extern uint FwpmFilterDestroyEnumHandle0(IntPtr engine, IntPtr h);
  [DllImport("advapi32.dll", SetLastError=true, CharSet=CharSet.Unicode)] static extern bool ConvertSecurityDescriptorToStringSecurityDescriptorW(IntPtr sd, uint rev, uint si, out IntPtr str, out uint len);
  [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr p);
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  [DllImport("advapi32.dll", SetLastError=true)] static extern bool OpenProcessToken(IntPtr p, uint access, out IntPtr tok);
  [DllImport("advapi32.dll", SetLastError=true)] static extern bool DuplicateToken(IntPtr tok, int level, out IntPtr dup);
  [DllImport("advapi32.dll", SetLastError=true)] static extern bool AccessCheck(IntPtr sd, IntPtr tok, uint desired, ref GENERIC_MAPPING map, IntPtr privs, ref uint privLen, out uint granted, out bool status);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [StructLayout(LayoutKind.Sequential)] public struct GENERIC_MAPPING { public uint R, W, X, A; }

  const uint OWNER = 1, GROUP = 2, DACL = 4;
  public const uint ADD = 0x1, ADD_LINK = 0x2, BEGIN_READ_TXN = 0x4, BEGIN_WRITE_TXN = 0x8, CLASSIFY = 0x10, ENUM = 0x20, OPEN = 0x40, READ = 0x80, READ_STATS = 0x100, SUBSCRIBE = 0x200, WRITE = 0x400;
  static GENERIC_MAPPING Map() {
    // fwpmu.h FWPM_GENERIC_* mapping
    GENERIC_MAPPING m;
    m.R = 0x00020000 | BEGIN_READ_TXN | CLASSIFY | OPEN | READ | READ_STATS;
    m.X = 0x00020000 | ENUM | SUBSCRIBE;
    m.W = 0x00020000 | ADD | ADD_LINK | BEGIN_WRITE_TXN | WRITE;
    m.A = 0x000F0000 | 0x7FF;
    return m;
  }
  static string Sddl(IntPtr sd) {
    IntPtr s; uint n;
    if (!ConvertSecurityDescriptorToStringSecurityDescriptorW(sd, 1, OWNER | GROUP | DACL, out s, out n)) return "unconvertible:" + Marshal.GetLastWin32Error();
    string r = Marshal.PtrToStringUni(s); LocalFree(s); return r;
  }
  static string Check(IntPtr sd, uint want) {
    IntPtr ptok, itok;
    if (!OpenProcessToken(GetCurrentProcess(), 0x0002 | 0x0008, out ptok)) return "OpenProcessToken:" + Marshal.GetLastWin32Error();
    if (!DuplicateToken(ptok, 2, out itok)) { CloseHandle(ptok); return "DuplicateToken:" + Marshal.GetLastWin32Error(); }
    GENERIC_MAPPING m = Map(); uint granted; bool ok; uint plen = 256; IntPtr privs = Marshal.AllocHGlobal(256);
    bool call = AccessCheck(sd, itok, want, ref m, privs, ref plen, out granted, out ok);
    int err = Marshal.GetLastWin32Error();
    Marshal.FreeHGlobal(privs); CloseHandle(itok); CloseHandle(ptok);
    if (!call) return "AccessCheck-error:" + err;
    return ok ? "granted" : "denied";
  }
  static string Obj(string name, uint rc, IntPtr sd, uint want, string wantName) {
    if (rc != 0) return "\"" + name + "\":{\"read\":false,\"error\":\"0x" + rc.ToString("x8") + "\"}";
    string sddl = Sddl(sd); string chk = Check(sd, want);
    return "\"" + name + "\":{\"read\":true,\"sddl\":\"" + sddl.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\",\"" + wantName + "\":\"" + chk + "\"}";
  }
  public static string Run() {
    IntPtr eng;
    uint rc = FwpmEngineOpen0(null, 0xFFFFFFFF /* RPC_C_AUTHN_DEFAULT */, IntPtr.Zero, IntPtr.Zero, out eng);
    if (rc != 0) return "{\"engineOpen\":\"0x" + rc.ToString("x8") + "\"}";
    var parts = new System.Collections.Generic.List<string>();
    parts.Add("\"engineOpen\":\"ok\"");
    IntPtr sd;
    uint r1 = FwpmFilterGetSecurityInfoByKey0(eng, IntPtr.Zero, OWNER | GROUP | DACL, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, out sd);
    parts.Add(Obj("filterContainer", r1, sd, ADD, "FWPM_ACTRL_ADD")); if (r1 == 0) FwpmFreeMemory0(ref sd);
    uint r2 = FwpmEngineGetSecurityInfo0(eng, OWNER | GROUP | DACL, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, out sd);
    parts.Add(Obj("engine", r2, sd, BEGIN_WRITE_TXN, "FWPM_ACTRL_BEGIN_WRITE_TXN")); if (r2 == 0) FwpmFreeMemory0(ref sd);
    Guid c4 = new Guid("c38d57d1-05a7-4c33-904f-7fbceee60e82"); // FWPM_LAYER_ALE_AUTH_CONNECT_V4
    uint r3 = FwpmLayerGetSecurityInfoByKey0(eng, ref c4, OWNER | GROUP | DACL, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, out sd);
    parts.Add(Obj("layerAleAuthConnectV4", r3, sd, ADD_LINK, "FWPM_ACTRL_ADD_LINK")); if (r3 == 0) FwpmFreeMemory0(ref sd);
    Guid l4 = new Guid("e1cd9fe7-f4b5-4273-96c0-592e487b8650"); // FWPM_LAYER_ALE_AUTH_RECV_ACCEPT_V4
    uint r4 = FwpmLayerGetSecurityInfoByKey0(eng, ref l4, OWNER | GROUP | DACL, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, out sd);
    parts.Add(Obj("layerAleAuthRecvAcceptV4", r4, sd, ADD_LINK, "FWPM_ACTRL_ADD_LINK")); if (r4 == 0) FwpmFreeMemory0(ref sd);
    // Transactions and enumeration. A READ-ONLY transaction, a filter enum handle, and an EMPTY write
    // transaction that is aborted at once: nothing is added, so no state changes either way; the return
    // code is the engine's own access check for BEGIN_WRITE_TXN, the first step of every FwpmFilterAdd0.
    uint t1 = FwpmTransactionBegin0(eng, 0x1 /* FWPM_TXN_READ_ONLY */);
    parts.Add("\"readTxnBegin\":\"0x" + t1.ToString("x8") + "\""); if (t1 == 0) FwpmTransactionAbort0(eng);
    IntPtr eh; uint e1 = FwpmFilterCreateEnumHandle0(eng, IntPtr.Zero, out eh);
    if (e1 == 0) {
      IntPtr entries; uint n; uint e2 = FwpmFilterEnum0(eng, eh, 100000, out entries, out n);
      parts.Add("\"filterEnum\":{\"rc\":\"0x" + e2.ToString("x8") + "\",\"visibleFilters\":" + (e2 == 0 ? n : 0) + "}");
      if (e2 == 0) FwpmFreeMemory0(ref entries);
      FwpmFilterDestroyEnumHandle0(eng, eh);
    } else parts.Add("\"filterEnum\":{\"rc\":\"0x" + e1.ToString("x8") + "\"}");
    uint t2 = FwpmTransactionBegin0(eng, 0);
    parts.Add("\"emptyWriteTxnBegin\":\"0x" + t2.ToString("x8") + "\""); if (t2 == 0) FwpmTransactionAbort0(eng);
    FwpmEngineClose0(eng);
    return "{" + string.Join(",", parts) + "}";
  }
}
'@
[Console]::Out.WriteLine([P10wWfp]::Run())
