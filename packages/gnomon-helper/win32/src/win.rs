//! The Win32 calls behind each op. Every function returns `Result<_, HelperError>`; nothing here panics on OS
//! input. Strings cross as UTF-16 (`wide`). SDDL is the read-back format: what the kernel compares is the DACL
//! the OS reports AFTER the write, never the one we meant to write (spec §16 "verified by reading back the ACL").

use crate::protocol::HelperError;
use std::ffi::c_void;
use std::ptr::{null, null_mut};
use windows_sys::Win32::Foundation::{
    CloseHandle, GetLastError, LocalFree, ERROR_PIPE_BUSY, HANDLE, INVALID_HANDLE_VALUE,
};
use windows_sys::Win32::Security::Authorization::{
    ConvertSecurityDescriptorToStringSecurityDescriptorW, ConvertSidToStringSidW,
    ConvertStringSecurityDescriptorToSecurityDescriptorW, GetNamedSecurityInfoW, GetSecurityInfo,
    SetNamedSecurityInfoW, SetSecurityInfo, SE_FILE_OBJECT, SE_KERNEL_OBJECT, SE_OBJECT_TYPE,
};
use windows_sys::Win32::Security::{
    GetSecurityDescriptorDacl, GetTokenInformation, TokenUser, ACL, DACL_SECURITY_INFORMATION,
    OWNER_SECURITY_INFORMATION, PROTECTED_DACL_SECURITY_INFORMATION, PSECURITY_DESCRIPTOR, PSID,
    TOKEN_QUERY, TOKEN_USER,
};
use windows_sys::Win32::Storage::FileSystem::{
    CreateFileW, MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH, OPEN_EXISTING,
    READ_CONTROL, WRITE_DAC,
};
use windows_sys::Win32::System::Pipes::{GetNamedPipeServerProcessId, WaitNamedPipeW};
use windows_sys::Win32::System::Registry::{RegGetValueW, HKEY_LOCAL_MACHINE, RRF_RT_REG_DWORD};
use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};
use windows_sys::Win32::UI::Shell::ShellExecuteW;
use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

const SDDL_REVISION_1: u32 = 1;

pub fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

fn os_err(what: &str) -> HelperError {
    let code = unsafe { GetLastError() };
    HelperError::os(what, code)
}

/// A UTF-16 string the OS allocated with LocalAlloc: copied out, then freed.
unsafe fn take_local_wstr(p: *mut u16) -> String {
    if p.is_null() {
        return String::new();
    }
    let mut n = 0usize;
    while *p.add(n) != 0 {
        n += 1;
    }
    let s = String::from_utf16_lossy(std::slice::from_raw_parts(p, n));
    LocalFree(p as *mut c_void);
    s
}

struct Handle(HANDLE);
impl Drop for Handle {
    fn drop(&mut self) {
        if !self.0.is_null() && self.0 != INVALID_HANDLE_VALUE {
            unsafe { CloseHandle(self.0) };
        }
    }
}

/// The current user's SID as a string (`S-1-5-21-…`), from this process's token.
pub fn current_user_sid() -> Result<String, HelperError> {
    unsafe {
        let mut tok: HANDLE = null_mut();
        if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut tok) == 0 {
            return Err(os_err("OpenProcessToken"));
        }
        let tok = Handle(tok);
        let mut len = 0u32;
        GetTokenInformation(tok.0, TokenUser, null_mut(), 0, &mut len);
        if len == 0 {
            return Err(os_err("GetTokenInformation(size)"));
        }
        // u64-backed: TOKEN_USER holds a pointer, so the buffer must be pointer-aligned (Aegis L5)
        let mut buf = vec![0u64; (len as usize).div_ceil(8)];
        if GetTokenInformation(tok.0, TokenUser, buf.as_mut_ptr() as *mut c_void, len, &mut len) == 0 {
            return Err(os_err("GetTokenInformation"));
        }
        let tu = &*(buf.as_ptr() as *const TOKEN_USER);
        let mut s: *mut u16 = null_mut();
        if ConvertSidToStringSidW(tu.User.Sid, &mut s) == 0 {
            return Err(os_err("ConvertSidToStringSidW"));
        }
        Ok(take_local_wstr(s))
    }
}

/// The protected owner-only DACL SDDL: a pipe/file gets full access for `sid` only; a directory adds
/// object+container inheritance so everything created below carries it.
pub fn owner_only_sddl(sid: &str, inherit: bool) -> String {
    if inherit {
        format!("D:P(A;OICI;FA;;;{sid})")
    } else {
        format!("D:P(A;;FA;;;{sid})")
    }
}

/// A self-relative security descriptor parsed from SDDL, with its DACL pointer (both freed on drop).
struct Sd {
    sd: PSECURITY_DESCRIPTOR,
    dacl: *mut ACL,
}
impl Drop for Sd {
    fn drop(&mut self) {
        if !self.sd.is_null() {
            unsafe { LocalFree(self.sd as *mut c_void) };
        }
    }
}

fn sd_from_sddl(sddl: &str) -> Result<Sd, HelperError> {
    unsafe {
        let w = wide(sddl);
        let mut sd: PSECURITY_DESCRIPTOR = null_mut();
        if ConvertStringSecurityDescriptorToSecurityDescriptorW(w.as_ptr(), SDDL_REVISION_1, &mut sd, null_mut()) == 0 {
            return Err(os_err("ConvertStringSecurityDescriptorToSecurityDescriptorW"));
        }
        // one owner of `sd` from here on: dropping `out` frees it exactly once (also on the error path)
        let mut out = Sd { sd, dacl: null_mut() };
        let (mut present, mut defaulted) = (0i32, 0i32);
        if GetSecurityDescriptorDacl(out.sd, &mut present, &mut out.dacl, &mut defaulted) == 0 || present == 0 {
            return Err(os_err("GetSecurityDescriptorDacl"));
        }
        Ok(out)
    }
}

/// SDDL (owner + DACL) of a security descriptor the OS returned (freed here).
unsafe fn sddl_of(sd: PSECURITY_DESCRIPTOR) -> Result<String, HelperError> {
    let mut s: *mut u16 = null_mut();
    let ok = ConvertSecurityDescriptorToStringSecurityDescriptorW(
        sd,
        SDDL_REVISION_1,
        OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION,
        &mut s,
        null_mut(),
    );
    LocalFree(sd as *mut c_void);
    if ok == 0 {
        return Err(os_err("ConvertSecurityDescriptorToStringSecurityDescriptorW"));
    }
    Ok(take_local_wstr(s))
}

fn read_handle_sddl(h: HANDLE, ty: SE_OBJECT_TYPE) -> Result<String, HelperError> {
    unsafe {
        let mut sd: PSECURITY_DESCRIPTOR = null_mut();
        let (mut owner, mut dacl): (PSID, *mut ACL) = (null_mut(), null_mut());
        let r = GetSecurityInfo(
            h,
            ty,
            OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION,
            &mut owner,
            null_mut(),
            &mut dacl,
            null_mut(),
            &mut sd,
        );
        if r != 0 {
            return Err(HelperError::os("GetSecurityInfo", r));
        }
        sddl_of(sd)
    }
}

pub fn read_path_sddl(path: &str) -> Result<String, HelperError> {
    unsafe {
        let w = wide(path);
        let mut sd: PSECURITY_DESCRIPTOR = null_mut();
        let (mut owner, mut dacl): (PSID, *mut ACL) = (null_mut(), null_mut());
        let r = GetNamedSecurityInfoW(
            w.as_ptr(),
            SE_FILE_OBJECT,
            OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION,
            &mut owner,
            null_mut(),
            &mut dacl,
            null_mut(),
            &mut sd,
        );
        if r != 0 {
            return Err(HelperError::os("GetNamedSecurityInfoW", r));
        }
        sddl_of(sd)
    }
}

/// Replace the DACL of a file or directory with the protected owner-only one, then read it back.
pub fn set_path_owner_only(path: &str, sid: &str, dir: bool) -> Result<String, HelperError> {
    let sd = sd_from_sddl(&owner_only_sddl(sid, dir))?;
    unsafe {
        let w = wide(path);
        let r = SetNamedSecurityInfoW(
            w.as_ptr(),
            SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
            null_mut(),
            null_mut(),
            sd.dacl,
            null(),
        );
        if r != 0 {
            return Err(HelperError::os("SetNamedSecurityInfoW", r));
        }
    }
    read_path_sddl(path)
}

pub struct PipeSecured {
    pub sddl: String,
    pub server_pid: u32,
}

/// Open `\\.\pipe\<name>` as a client with READ_CONTROL|WRITE_DAC, replace the pipe's DACL with the protected
/// owner-only one and read it back through the same handle (P03: the DACL is pipe-wide; new instances carry it).
/// This consumes one pipe instance: the kernel sees it as a connection and drops it (with every connection it
/// accepted before this reply).
pub fn secure_pipe(name: &str, sid: &str) -> Result<PipeSecured, HelperError> {
    let path = wide(&format!(r"\\.\pipe\{name}"));
    let h = unsafe {
        let mut tries = 0;
        loop {
            let h = CreateFileW(path.as_ptr(), READ_CONTROL | WRITE_DAC, 0, null(), OPEN_EXISTING, 0, null_mut());
            if h != INVALID_HANDLE_VALUE {
                break Handle(h);
            }
            let e = GetLastError();
            tries += 1;
            if e != ERROR_PIPE_BUSY || tries > 20 {
                return Err(HelperError::os("CreateFileW(pipe)", e));
            }
            WaitNamedPipeW(path.as_ptr(), 250);
        }
    };
    let sd = sd_from_sddl(&owner_only_sddl(sid, false))?;
    unsafe {
        let r = SetSecurityInfo(
            h.0,
            SE_KERNEL_OBJECT,
            DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
            null_mut(),
            null_mut(),
            sd.dacl,
            null(),
        );
        if r != 0 {
            return Err(HelperError::os("SetSecurityInfo(pipe)", r));
        }
    }
    let sddl = read_handle_sddl(h.0, SE_KERNEL_OBJECT)?;
    let mut pid = 0u32;
    unsafe { GetNamedPipeServerProcessId(h.0, &mut pid) };
    Ok(PipeSecured { sddl, server_pid: pid })
}

/// Read a pipe's DACL without changing it (READ_CONTROL only; also consumes an instance).
pub fn read_pipe_sddl(name: &str) -> Result<String, HelperError> {
    let path = wide(&format!(r"\\.\pipe\{name}"));
    let h = unsafe { CreateFileW(path.as_ptr(), READ_CONTROL, 0, null(), OPEN_EXISTING, 0, null_mut()) };
    if h == INVALID_HANDLE_VALUE {
        return Err(os_err("CreateFileW(pipe)"));
    }
    let h = Handle(h);
    read_handle_sddl(h.0, SE_KERNEL_OBJECT)
}

/// `MoveFileExW(MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)`: the rename is on disk when this returns
/// (spec §16 kernel-log residual "renames are not durable at return"; G-LOG-06).
pub fn rename_durable(from: &str, to: &str) -> Result<(), HelperError> {
    let (f, t) = (wide(from), wide(to));
    if unsafe { MoveFileExW(f.as_ptr(), t.as_ptr(), MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH) } == 0 {
        return Err(os_err("MoveFileExW"));
    }
    Ok(())
}

/// The boot id: `HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Memory Management\PrefetchParameters\BootId`,
/// a counter Windows increments on every boot (readable by a standard user). The kernel stores it as `win:<n>`.
pub fn boot_id() -> Result<u32, HelperError> {
    let key = wide(r"SYSTEM\CurrentControlSet\Control\Session Manager\Memory Management\PrefetchParameters");
    let val = wide("BootId");
    let mut data = 0u32;
    let mut len = std::mem::size_of::<u32>() as u32;
    let r = unsafe {
        RegGetValueW(
            HKEY_LOCAL_MACHINE,
            key.as_ptr(),
            val.as_ptr(),
            RRF_RT_REG_DWORD,
            null_mut(),
            &mut data as *mut u32 as *mut c_void,
            &mut len,
        )
    };
    if r != 0 {
        return Err(HelperError::os("RegGetValueW(BootId)", r));
    }
    Ok(data)
}

/// Hand a URL to the user's default browser (spec §16 "Launch-token hand-off": the token-less URL only).
pub fn shell_open(url: &str) -> Result<(), HelperError> {
    let (verb, u) = (wide("open"), wide(url));
    let r = unsafe { ShellExecuteW(null_mut(), verb.as_ptr(), u.as_ptr(), null(), null(), SW_SHOWNORMAL) };
    // ShellExecuteW returns a value > 32 on success
    if (r as isize) <= 32 {
        return Err(HelperError::new("shell-open-failed", &format!("ShellExecuteW returned {}", r as isize)));
    }
    Ok(())
}
