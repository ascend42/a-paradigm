//! `process.start {pid}` and `process.list` — the Windows process-table witnesses for the kernel's process control
//! (W3; spec §2.4 rule 4, §16 "Process isolation + kill"; kernel: src/kernel/lifecycle/process-control.ts).
//!
//! A start witness is the process creation time (FILETIME, 100 ns ticks) as `ft:<n>`: a recycled pid has a later one,
//! so a row the kernel recorded is never mistaken for a new process with the same pid. `process.list` is the toolhelp
//! snapshot (pid, parent pid) plus each process's witness where it can be opened (PROCESS_QUERY_LIMITED_INFORMATION);
//! a process that cannot be opened (another user's, a protected one) has no witness and is never signalled by it.
//! `process.terminate {pid, start}` is the only op that changes a process, and only one whose witness matches.

use crate::protocol::HelperError;
use windows_sys::Win32::Foundation::{CloseHandle, GetLastError, FILETIME, HANDLE, INVALID_HANDLE_VALUE};
use windows_sys::Win32::System::Diagnostics::ToolHelp::{CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS};
use windows_sys::Win32::System::Threading::{GetProcessTimes, OpenProcess, TerminateProcess, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_TERMINATE};

struct H(HANDLE);
impl Drop for H {
    fn drop(&mut self) {
        if !self.0.is_null() && self.0 != INVALID_HANDLE_VALUE {
            unsafe { CloseHandle(self.0) };
        }
    }
}

/// The creation-time witness of `pid` (`ft:<ticks>`), or None when it cannot be opened (gone, or not ours to query).
pub fn start(pid: u32) -> Option<String> {
    unsafe {
        let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if h.is_null() {
            return None;
        }
        let h = H(h);
        let (mut c, mut x, mut k, mut u): (FILETIME, FILETIME, FILETIME, FILETIME) = std::mem::zeroed();
        if GetProcessTimes(h.0, &mut c, &mut x, &mut k, &mut u) == 0 {
            return None;
        }
        Some(format!("ft:{}", ((c.dwHighDateTime as u64) << 32) | c.dwLowDateTime as u64))
    }
}

/// `process.terminate {pid, start}`: terminate `pid` ONLY if its creation time is still `start` (Aegis W3 review M1),
/// checked and terminated through ONE handle, so a pid recycled after the kernel recorded it is never hit (a pid is not
/// reused while a handle to its process is open). Ok(false): gone, or not the same process.
pub fn terminate(pid: u32, start: &str) -> Result<bool, HelperError> {
    unsafe {
        let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_TERMINATE, 0, pid);
        if h.is_null() {
            return Ok(false);
        }
        let h = H(h);
        let (mut c, mut x, mut k, mut u): (FILETIME, FILETIME, FILETIME, FILETIME) = std::mem::zeroed();
        if GetProcessTimes(h.0, &mut c, &mut x, &mut k, &mut u) == 0 {
            return Ok(false);
        }
        if format!("ft:{}", ((c.dwHighDateTime as u64) << 32) | c.dwLowDateTime as u64) != start {
            return Ok(false);
        }
        if TerminateProcess(h.0, 1) == 0 {
            return Err(HelperError::os("TerminateProcess", GetLastError()));
        }
        Ok(true)
    }
}

pub struct Row {
    pub pid: u32,
    pub ppid: u32,
    pub start: Option<String>,
}

/// Every process in the table: pid, recorded parent pid, and the start witness where readable.
pub fn list() -> Result<Vec<Row>, HelperError> {
    unsafe {
        let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snap == INVALID_HANDLE_VALUE {
            return Err(HelperError::os("CreateToolhelp32Snapshot", GetLastError()));
        }
        let snap = H(snap);
        let mut e: PROCESSENTRY32W = std::mem::zeroed();
        e.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        let mut rows = Vec::new();
        let mut more = Process32FirstW(snap.0, &mut e) != 0;
        while more {
            if e.th32ProcessID > 4 {
                rows.push(Row { pid: e.th32ProcessID, ppid: e.th32ParentProcessID, start: start(e.th32ProcessID) });
            }
            more = Process32NextW(snap.0, &mut e) != 0;
        }
        Ok(rows)
    }
}
