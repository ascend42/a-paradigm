//! `gnomon-helper exec -- <exe> [args…]` — the job-object launcher (spec §16 "Process isolation + kill",
//! G-RUN-03; docs/plans/gnomon-windows.md W2).
//!
//! The launcher creates a job with KILL_ON_JOB_CLOSE (and DIE_ON_UNHANDLED_EXCEPTION, so a crash never hangs on a
//! Windows Error Reporting dialog), assigns ITSELF to it, then spawns `<exe>`: every descendant is created inside
//! the job with no race between spawn and assignment, and breakaway is not allowed. The only handle to the job is
//! the launcher's: when the launcher exits for ANY reason (child done, TerminateProcess by the kernel, the kernel's
//! own death through libuv's global job), the handle closes and the OS kills every process in the job.
//! The kernel's staged stop is therefore: control message → stdin close → kill the launcher.
//!
//! What the job does NOT contain (Aegis M4): a process another service starts on the child's behalf — WMI
//! Win32_Process.Create, COM out-of-process servers, Task Scheduler, a ShellExecute that explorer performs — is not
//! a descendant and survives. An unsandboxed child could also DuplicateHandle the job handle out of the launcher and
//! keep the job alive. `exec` is therefore containment for well-behaved trees (reported `partial`); the session
//! sandbox (sandbox.rs: restricted token, the launcher's own process DACL, UI limits) is the security boundary.
//!
//! stdio is inherited: the child reads and writes the very pipes the kernel gave the launcher. Exit code: the
//! child's, or 70 when the launch itself failed (the reason on stderr, prefixed `gnomon-helper exec:`).

use std::ffi::c_void;
use std::process::Command;
use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation, SetInformationJobObject,
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};
use windows_sys::Win32::System::Threading::GetCurrentProcess;

const EX_SOFTWARE: i32 = 70;

fn fail(msg: &str) -> i32 {
    eprintln!("gnomon-helper exec: {msg}");
    EX_SOFTWARE
}

/// Put this process (and so every process it creates from now on) in a fresh kill-on-close job. The returned
/// handle is deliberately leaked: it must live exactly as long as this process.
fn enter_job() -> Result<(), String> {
    unsafe {
        let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
        if job.is_null() {
            return Err(format!("CreateJobObjectW failed ({})", std::io::Error::last_os_error()));
        }
        let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION;
        if SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            &info as *const _ as *const c_void,
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        ) == 0
        {
            return Err(format!("SetInformationJobObject failed ({})", std::io::Error::last_os_error()));
        }
        if AssignProcessToJobObject(job, GetCurrentProcess()) == 0 {
            return Err(format!("AssignProcessToJobObject(self) failed ({})", std::io::Error::last_os_error()));
        }
    }
    Ok(())
}

pub fn run(args: &[String]) -> i32 {
    let rest = match args.first().map(String::as_str) {
        Some("--") => &args[1..],
        _ => return fail("usage: exec -- <absolute exe> [args…]"),
    };
    let Some(exe) = rest.first() else { return fail("missing <exe>") };
    if crate::protocol::check_local_path(exe).is_err() || !exe.to_ascii_lowercase().ends_with(".exe") {
        // never a .cmd/.bat (a shell would interpret the arguments) and never a PATH lookup
        return fail("<exe> must be an absolute path to an .exe");
    }
    if let Err(e) = enter_job() {
        return fail(&e);
    }
    let status = match Command::new(exe).args(&rest[1..]).status() {
        Ok(s) => s,
        Err(e) => return fail(&format!("spawn {exe}: {e}")),
    };
    status.code().unwrap_or(EX_SOFTWARE)
}
