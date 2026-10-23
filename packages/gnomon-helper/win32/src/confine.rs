//! `process.confine {pid}` — lower a RUNNING child to Low integrity and put it in a locked-down job (W5; the
//! transport child of the GUI web endpoint).
//!
//! Why not the `sandbox` launcher: the kernel hands each accepted browser socket to the transport child over Node's
//! IPC channel, and on Windows Node duplicates the socket for the DIRECT child's pid; a launcher in between would
//! receive it instead. So the kernel spawns node itself, asks for this op, and sends nothing (not even the config)
//! before the reply: the child runs only its own startup code before it is confined (the "lower the token after
//! init" pattern).
//!
//! The op: the process token's integrity → Low (allowed: a token may always be lowered), read back; a new job with
//! ACTIVE_PROCESS = 1 (it cannot start any process), DIE_ON_UNHANDLED_EXCEPTION and every UI limit, the process
//! assigned to it. The job has no KILL_ON_JOB_CLOSE: the helper's handle closes when it exits and the limits stay
//! with the process (the kernel's own kill path is unchanged: the child is a direct child in libuv's job).
//! Lowering only ever removes rights, so the op is safe to expose to the kernel for any of this user's processes.

use crate::protocol::HelperError;
use std::ffi::c_void;
use std::ptr::{null, null_mut};
use windows_sys::Win32::Foundation::{CloseHandle, GetLastError, LocalFree, FILETIME, HANDLE, INVALID_HANDLE_VALUE};
use windows_sys::Win32::System::Diagnostics::ToolHelp::{CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS};
use windows_sys::Win32::System::Threading::{GetCurrentProcessId, GetProcessTimes};
use windows_sys::Win32::Security::Authorization::ConvertStringSidToSidW;
use windows_sys::Win32::Security::{
    GetLengthSid, GetSidSubAuthority, GetSidSubAuthorityCount, GetTokenInformation, SetTokenInformation, TokenIntegrityLevel,
    PSID, SID_AND_ATTRIBUTES, TOKEN_ADJUST_DEFAULT, TOKEN_MANDATORY_LABEL, TOKEN_QUERY,
};
use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectBasicUIRestrictions, JobObjectExtendedLimitInformation,
    SetInformationJobObject, JOBOBJECT_BASIC_UI_RESTRICTIONS, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    JOB_OBJECT_LIMIT_ACTIVE_PROCESS, JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION, JOB_OBJECT_UILIMIT_DESKTOP,
    JOB_OBJECT_UILIMIT_DISPLAYSETTINGS, JOB_OBJECT_UILIMIT_EXITWINDOWS, JOB_OBJECT_UILIMIT_GLOBALATOMS,
    JOB_OBJECT_UILIMIT_HANDLES, JOB_OBJECT_UILIMIT_READCLIPBOARD, JOB_OBJECT_UILIMIT_SYSTEMPARAMETERS,
    JOB_OBJECT_UILIMIT_WRITECLIPBOARD,
};
use windows_sys::Win32::System::SystemServices::SE_GROUP_INTEGRITY;
use windows_sys::Win32::System::Threading::{OpenProcess, OpenProcessToken, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SET_QUOTA, PROCESS_TERMINATE};

struct H(HANDLE);
impl Drop for H {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe { CloseHandle(self.0) };
        }
    }
}

fn os(what: &str) -> HelperError {
    HelperError::os(what, unsafe { GetLastError() })
}

/// The integrity RID of `tok` (0x1000 Low, 0x2000 Medium, …).
unsafe fn integrity_rid(tok: HANDLE) -> Result<u32, HelperError> {
    let mut len = 0u32;
    GetTokenInformation(tok, TokenIntegrityLevel, null_mut(), 0, &mut len);
    let mut buf = vec![0u64; (len as usize).div_ceil(8).max(1)];
    if GetTokenInformation(tok, TokenIntegrityLevel, buf.as_mut_ptr() as *mut c_void, len, &mut len) == 0 {
        return Err(os("GetTokenInformation(TokenIntegrityLevel)"));
    }
    let label = &*(buf.as_ptr() as *const TOKEN_MANDATORY_LABEL);
    let n = *GetSidSubAuthorityCount(label.Label.Sid);
    Ok(*GetSidSubAuthority(label.Label.Sid, (n - 1) as u32))
}

/// The parent pid of `pid` as the process table records it (None: no such process).
unsafe fn parent_of(pid: u32) -> Result<Option<u32>, HelperError> {
    let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
    if snap == INVALID_HANDLE_VALUE {
        return Err(os("CreateToolhelp32Snapshot"));
    }
    let snap = H(snap);
    let mut e: PROCESSENTRY32W = std::mem::zeroed();
    e.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
    let mut more = Process32FirstW(snap.0, &mut e) != 0;
    while more {
        if e.th32ProcessID == pid {
            return Ok(Some(e.th32ParentProcessID));
        }
        more = Process32NextW(snap.0, &mut e) != 0;
    }
    Ok(None)
}

/// A process's creation time (100 ns ticks).
unsafe fn created(h: HANDLE) -> Result<u64, HelperError> {
    let (mut c, mut x, mut k, mut u): (FILETIME, FILETIME, FILETIME, FILETIME) = std::mem::zeroed();
    if GetProcessTimes(h, &mut c, &mut x, &mut k, &mut u) == 0 {
        return Err(os("GetProcessTimes"));
    }
    Ok(((c.dwHighDateTime as u64) << 32) | c.dwLowDateTime as u64)
}

/// Aegis M3 (PR #52 release blocker, confinement ordering): the kernel confines its transport by pid AFTER the spawn,
/// so a child that died first could have its pid reused and the helper would lower someone else while the kernel went
/// on as if its transport were confined. Refuse unless the target is a DIRECT child of this helper's caller (the
/// process that spawned the helper: the kernel) and was created after the caller; checked on the handle the op then
/// uses, so the pid cannot change underneath it (a pid is not reused while a handle to the process is open).
unsafe fn check_caller_child(pid: u32, target: HANDLE) -> Result<(), HelperError> {
    // the helper is a child of the kernel too: a dead transport's pid reused by THIS process must not pass
    if pid == GetCurrentProcessId() {
        return Err(HelperError::new("not-a-child", "the target is this helper"));
    }
    let caller = parent_of(GetCurrentProcessId())?.ok_or_else(|| HelperError::new("confine-failed", "this helper has no parent"))?;
    if parent_of(pid)? != Some(caller) {
        return Err(HelperError::new("not-a-child", "the target is not a child of the process that asked"));
    }
    let c = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, caller);
    if c.is_null() {
        return Err(os("OpenProcess(caller)"));
    }
    let c = H(c);
    if created(target)? < created(c.0)? {
        return Err(HelperError::new("not-a-child", "the target predates the process that asked (a reused pid)"));
    }
    Ok(())
}

pub fn confine(pid: u32) -> Result<u32, HelperError> {
    unsafe {
        let p = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SET_QUOTA | PROCESS_TERMINATE, 0, pid);
        if p.is_null() {
            return Err(os("OpenProcess"));
        }
        let p = H(p);
        check_caller_child(pid, p.0)?;
        // the job FIRST (Aegis M3 review): ACTIVE_PROCESS = 1 and the UI limits hold before the integrity drop
        let job = CreateJobObjectW(null(), null());
        if job.is_null() {
            return Err(os("CreateJobObjectW"));
        }
        let job = H(job);
        let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_ACTIVE_PROCESS | JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION;
        info.BasicLimitInformation.ActiveProcessLimit = 1;
        if SetInformationJobObject(job.0, JobObjectExtendedLimitInformation, &info as *const _ as *const c_void, std::mem::size_of_val(&info) as u32) == 0 {
            return Err(os("SetInformationJobObject(limits)"));
        }
        let ui = JOBOBJECT_BASIC_UI_RESTRICTIONS {
            UIRestrictionsClass: JOB_OBJECT_UILIMIT_HANDLES
                | JOB_OBJECT_UILIMIT_READCLIPBOARD
                | JOB_OBJECT_UILIMIT_WRITECLIPBOARD
                | JOB_OBJECT_UILIMIT_DESKTOP
                | JOB_OBJECT_UILIMIT_GLOBALATOMS
                | JOB_OBJECT_UILIMIT_SYSTEMPARAMETERS
                | JOB_OBJECT_UILIMIT_DISPLAYSETTINGS
                | JOB_OBJECT_UILIMIT_EXITWINDOWS,
        };
        if SetInformationJobObject(job.0, JobObjectBasicUIRestrictions, &ui as *const _ as *const c_void, std::mem::size_of_val(&ui) as u32) == 0 {
            return Err(os("SetInformationJobObject(ui)"));
        }
        if AssignProcessToJobObject(job.0, p.0) == 0 {
            return Err(os("AssignProcessToJobObject"));
        }
        let mut tok: HANDLE = null_mut();
        if OpenProcessToken(p.0, TOKEN_ADJUST_DEFAULT | TOKEN_QUERY, &mut tok) == 0 {
            return Err(os("OpenProcessToken"));
        }
        let tok = H(tok);
        let mut low: PSID = null_mut();
        let w = crate::win::wide("S-1-16-4096");
        if ConvertStringSidToSidW(w.as_ptr(), &mut low) == 0 {
            return Err(os("ConvertStringSidToSidW(low)"));
        }
        let label = TOKEN_MANDATORY_LABEL { Label: SID_AND_ATTRIBUTES { Sid: low, Attributes: SE_GROUP_INTEGRITY as u32 } };
        let ok = SetTokenInformation(tok.0, TokenIntegrityLevel, &label as *const _ as *const c_void, std::mem::size_of::<TOKEN_MANDATORY_LABEL>() as u32 + GetLengthSid(low));
        LocalFree(low as *mut c_void);
        if ok == 0 {
            return Err(os("SetTokenInformation(TokenIntegrityLevel)"));
        }
        let rid = integrity_rid(tok.0)?;
        if rid > 0x1000 {
            return Err(HelperError::new("confine-failed", &format!("integrity read back as 0x{rid:x}, not Low")));
        }
        Ok(rid)
    }
}
