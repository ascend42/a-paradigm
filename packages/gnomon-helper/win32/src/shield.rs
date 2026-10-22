//! `process.shield {pid}` — keep Gnomon sessions out of one of Gnomon's own processes (the kernel, the wrapper)
//! (W5; spec §16 "Sandbox": a session must not open, read, inject into or signal the kernel or the GUI).
//!
//! A session runs under a restricted token whose restricting SIDs include the user SID (Git Bash and Node need it,
//! see sandbox.rs), so the user-only default DACL of this user's processes admits it. This op adds an explicit DENY
//! of every access for GNOMON_SESSION_SID to:
//!   * the process object;
//!   * each of its threads that exists now (a thread handle is enough to inject: SetThreadContext, APC);
//!   * the process token's DEFAULT DACL, so every thread, pipe, section or child the process creates later carries
//!     the same deny.
//! The process DACL is read back and refused unless the deny is there. Adding a deny only ever removes access, so
//! the op is safe to expose to the kernel for any of this user's processes; it is idempotent.

use crate::protocol::HelperError;
use std::ffi::c_void;
use std::ptr::{null, null_mut};
use windows_sys::Win32::Foundation::{CloseHandle, GetLastError, LocalFree, HANDLE, INVALID_HANDLE_VALUE};
use windows_sys::Win32::Security::Authorization::{
    ConvertStringSidToSidW, GetSecurityInfo, SetEntriesInAclW, SetSecurityInfo, DENY_ACCESS, EXPLICIT_ACCESS_W,
    NO_MULTIPLE_TRUSTEE, SE_KERNEL_OBJECT, TRUSTEE_IS_SID, TRUSTEE_IS_UNKNOWN, TRUSTEE_W,
};
use windows_sys::Win32::Security::{
    GetTokenInformation, SetTokenInformation, TokenDefaultDacl, ACL, DACL_SECURITY_INFORMATION, NO_INHERITANCE, PSECURITY_DESCRIPTOR, PSID,
    TOKEN_ADJUST_DEFAULT, TOKEN_DEFAULT_DACL, TOKEN_QUERY,
};
use windows_sys::Win32::System::Diagnostics::ToolHelp::{CreateToolhelp32Snapshot, Thread32First, Thread32Next, TH32CS_SNAPTHREAD, THREADENTRY32};
use windows_sys::Win32::System::Threading::{OpenProcess, OpenProcessToken, OpenThread, PROCESS_QUERY_LIMITED_INFORMATION};

const READ_CONTROL: u32 = 0x0002_0000;
const WRITE_DAC: u32 = 0x0004_0000;
const GENERIC_ALL: u32 = 0x1000_0000;
const PROCESS_ALL_ACCESS: u32 = 0x001F_FFFF;
const THREAD_ALL_ACCESS: u32 = 0x001F_FFFF;

struct H(HANDLE);
impl Drop for H {
    fn drop(&mut self) {
        if !self.0.is_null() && self.0 != INVALID_HANDLE_VALUE {
            unsafe { CloseHandle(self.0) };
        }
    }
}

fn os(what: &str) -> HelperError {
    HelperError::os(what, unsafe { GetLastError() })
}

struct Sid(PSID);
impl Drop for Sid {
    fn drop(&mut self) {
        unsafe { LocalFree(self.0 as *mut c_void) };
    }
}

fn session_sid() -> Result<Sid, HelperError> {
    let mut p: PSID = null_mut();
    let w = crate::win::wide(crate::sandbox::GNOMON_SESSION_SID);
    if unsafe { ConvertStringSidToSidW(w.as_ptr(), &mut p) } == 0 {
        return Err(os("ConvertStringSidToSidW"));
    }
    Ok(Sid(p))
}

/// `acl` plus a DENY `mask` for the session SID, first (SetEntriesInAclW orders denies before allows). A LocalAlloc'd
/// ACL the caller frees.
unsafe fn with_deny(acl: *const ACL, sid: PSID, mask: u32) -> Result<*mut ACL, HelperError> {
    let ea = EXPLICIT_ACCESS_W {
        grfAccessPermissions: mask,
        grfAccessMode: DENY_ACCESS,
        grfInheritance: NO_INHERITANCE,
        Trustee: TRUSTEE_W { pMultipleTrustee: null_mut(), MultipleTrusteeOperation: NO_MULTIPLE_TRUSTEE, TrusteeForm: TRUSTEE_IS_SID, TrusteeType: TRUSTEE_IS_UNKNOWN, ptstrName: sid as *mut u16 },
    };
    let mut out: *mut ACL = null_mut();
    let r = SetEntriesInAclW(1, &ea, acl, &mut out);
    if r != 0 {
        return Err(HelperError::os("SetEntriesInAclW", r));
    }
    Ok(out)
}

/// Add the deny to a kernel object's DACL through `h` (opened READ_CONTROL | WRITE_DAC).
unsafe fn deny_on(h: HANDLE, sid: PSID, mask: u32, what: &str) -> Result<(), HelperError> {
    let mut dacl: *mut ACL = null_mut();
    let mut sd: PSECURITY_DESCRIPTOR = null_mut();
    let r = GetSecurityInfo(h, SE_KERNEL_OBJECT, DACL_SECURITY_INFORMATION, null_mut(), null_mut(), &mut dacl, null_mut(), &mut sd);
    if r != 0 {
        return Err(HelperError::os(&format!("GetSecurityInfo({what})"), r));
    }
    let out = with_deny(dacl, sid, mask);
    LocalFree(sd as *mut c_void);
    let out = out?;
    let r = SetSecurityInfo(h, SE_KERNEL_OBJECT, DACL_SECURITY_INFORMATION, null_mut(), null_mut(), out, null());
    LocalFree(out as *mut c_void);
    if r != 0 {
        return Err(HelperError::os(&format!("SetSecurityInfo({what})"), r));
    }
    Ok(())
}

pub struct Shielded {
    pub sddl: String,
    pub threads: u32,
}

pub fn shield(pid: u32) -> Result<Shielded, HelperError> {
    let sid = session_sid()?;
    unsafe {
        let p = OpenProcess(READ_CONTROL | WRITE_DAC | PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if p.is_null() {
            return Err(os("OpenProcess"));
        }
        let p = H(p);

        // 1. the default DACL first, so a thread created while the rest runs is covered
        let mut tok: HANDLE = null_mut();
        if OpenProcessToken(p.0, TOKEN_QUERY | TOKEN_ADJUST_DEFAULT, &mut tok) == 0 {
            return Err(os("OpenProcessToken"));
        }
        let tok = H(tok);
        let mut len = 0u32;
        GetTokenInformation(tok.0, TokenDefaultDacl, null_mut(), 0, &mut len);
        let mut buf = vec![0u64; (len as usize).div_ceil(8).max(1)];
        if GetTokenInformation(tok.0, TokenDefaultDacl, buf.as_mut_ptr() as *mut c_void, len, &mut len) == 0 {
            return Err(os("GetTokenInformation(TokenDefaultDacl)"));
        }
        let cur = &*(buf.as_ptr() as *const TOKEN_DEFAULT_DACL);
        let out = with_deny(cur.DefaultDacl, sid.0, GENERIC_ALL)?;
        let d = TOKEN_DEFAULT_DACL { DefaultDacl: out };
        let ok = SetTokenInformation(tok.0, TokenDefaultDacl, &d as *const _ as *const c_void, std::mem::size_of::<TOKEN_DEFAULT_DACL>() as u32);
        let err = GetLastError();
        LocalFree(out as *mut c_void);
        if ok == 0 {
            return Err(HelperError::os("SetTokenInformation(TokenDefaultDacl)", err));
        }

        // 2. the process object
        deny_on(p.0, sid.0, PROCESS_ALL_ACCESS, "process")?;

        // 3. its threads (a thread that exits between the snapshot and the open is skipped)
        let snap = CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0);
        if snap == INVALID_HANDLE_VALUE {
            return Err(os("CreateToolhelp32Snapshot"));
        }
        let snap = H(snap);
        let mut te: THREADENTRY32 = std::mem::zeroed();
        te.dwSize = std::mem::size_of::<THREADENTRY32>() as u32;
        let mut threads = 0u32;
        let mut more = Thread32First(snap.0, &mut te) != 0;
        while more {
            if te.th32OwnerProcessID == pid {
                let t = OpenThread(READ_CONTROL | WRITE_DAC, 0, te.th32ThreadID);
                if !t.is_null() {
                    let t = H(t);
                    deny_on(t.0, sid.0, THREAD_ALL_ACCESS, "thread")?;
                    threads += 1;
                }
            }
            more = Thread32Next(snap.0, &mut te) != 0;
        }

        // 4. read back
        let sddl = crate::win::read_handle_sddl(p.0, SE_KERNEL_OBJECT)?;
        if !crate::protocol::session_denied_any(&sddl) {
            return Err(HelperError::new("shield-failed", &format!("the process DACL read back without the session deny ({sddl})")));
        }
        Ok(Shielded { sddl, threads })
    }
}
