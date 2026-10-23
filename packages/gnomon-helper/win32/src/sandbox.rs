//! `gnomon-helper sandbox [--desktop] -- <exe> [args…]` — the Windows session sandbox launcher (spec §15.5, §16
//! "Sandbox" / "Session denies"; docs/plans/gnomon-windows.md W5).
//!
//! What a sandboxed process gets:
//!   * a RESTRICTED primary token: the restricting SIDs are every enabled group of this user's token, the user SID,
//!     and GNOMON_SESSION_SID. The second (restricted) access check therefore passes wherever the user's own check
//!     passes, EXCEPT where a DENY ACE names GNOMON_SESSION_SID: those ACEs are the session's deny list (placed on the
//!     denied paths by the kernel through `acl.session` before the spawn). Every privilege but SeChangeNotify is
//!     removed (DISABLE_MAX_PRIVILEGE). Nothing outside a Gnomon session carries GNOMON_SESSION_SID, so the ACEs
//!     change nothing for any other process.
//!   * the job object of `exec` (KILL_ON_JOB_CLOSE, no breakaway, DIE_ON_UNHANDLED_EXCEPTION) PLUS UI limits: no
//!     USER handles outside the job, no clipboard, no desktop switch, no global atoms, no system parameters, no
//!     display settings, no ExitWindows.
//!   * with --desktop, a PRIVATE desktop on the interactive window station: input it synthesizes (SendInput) and
//!     windows it opens land there, never on the user's desktop (the wrapper and every other app stay out of reach).
//!
//! stdio: exactly the three standard handles are inherited (PROC_THREAD_ATTRIBUTE_HANDLE_LIST), nothing else of the
//! helper's. Exit code: the child's, or 70 when the launch failed (reason on stderr).

use std::ffi::c_void;
use std::ptr::{null, null_mut};
use windows_sys::Win32::Foundation::{
    CloseHandle, GetLastError, SetHandleInformation, HANDLE, HANDLE_FLAG_INHERIT, INVALID_HANDLE_VALUE, WAIT_OBJECT_0,
};
use windows_sys::Win32::Security::Authorization::{ConvertStringSecurityDescriptorToSecurityDescriptorW, ConvertStringSidToSidW, SetSecurityInfo, SE_WINDOW_OBJECT};
use windows_sys::Win32::Security::{
    CreateRestrictedToken, GetLengthSid, GetTokenInformation, SetTokenInformation, TokenGroups, TokenIntegrityLevel, TokenUser,
    DISABLE_MAX_PRIVILEGE, GetSecurityDescriptorDacl, GetSecurityDescriptorSacl, TokenDefaultDacl, TOKEN_DEFAULT_DACL, ACL, LABEL_SECURITY_INFORMATION, PSECURITY_DESCRIPTOR, PSID, SID_AND_ATTRIBUTES,
    SECURITY_ATTRIBUTES, TOKEN_MANDATORY_LABEL, TOKEN_ADJUST_DEFAULT, TOKEN_ASSIGN_PRIMARY,
    TOKEN_DUPLICATE, TOKEN_GROUPS, TOKEN_QUERY, TOKEN_USER,
};
use windows_sys::Win32::System::Console::{GetStdHandle, STD_ERROR_HANDLE, STD_INPUT_HANDLE, STD_OUTPUT_HANDLE};
use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectBasicUIRestrictions, JobObjectExtendedLimitInformation,
    SetInformationJobObject, JOBOBJECT_BASIC_UI_RESTRICTIONS, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, JOB_OBJECT_UILIMIT_DESKTOP,
    JOB_OBJECT_UILIMIT_DISPLAYSETTINGS, JOB_OBJECT_UILIMIT_EXITWINDOWS, JOB_OBJECT_UILIMIT_GLOBALATOMS,
    JOB_OBJECT_UILIMIT_HANDLES, JOB_OBJECT_UILIMIT_READCLIPBOARD, JOB_OBJECT_UILIMIT_SYSTEMPARAMETERS,
    JOB_OBJECT_UILIMIT_WRITECLIPBOARD,
};
use windows_sys::Win32::System::SystemServices::{SE_GROUP_ENABLED, SE_GROUP_INTEGRITY, SE_GROUP_USE_FOR_DENY_ONLY};
use windows_sys::Win32::System::StationsAndDesktops::{CreateDesktopW, DESKTOP_CREATEWINDOW, DESKTOP_READOBJECTS, DESKTOP_WRITEOBJECTS};
use windows_sys::Win32::System::Threading::{
    CreateProcessAsUserW, DeleteProcThreadAttributeList, GetCurrentProcess, GetExitCodeProcess,
    InitializeProcThreadAttributeList, OpenProcessToken, UpdateProcThreadAttribute, WaitForSingleObject,
    CREATE_UNICODE_ENVIRONMENT, EXTENDED_STARTUPINFO_PRESENT, INFINITE, LPPROC_THREAD_ATTRIBUTE_LIST,
    PROCESS_INFORMATION, PROC_THREAD_ATTRIBUTE_HANDLE_LIST, STARTF_USESTDHANDLES, STARTUPINFOEXW,
};

/// The SID every Gnomon session token carries as a restricting SID; the deny ACEs name it (kernel:
/// platform/win32/sandbox.ts GNOMON_SESSION_SID). An unassigned resource-manager authority SID (S-1-9): no account,
/// group or other product ever has it.
pub const GNOMON_SESSION_SID: &str = "S-1-9-4174-2026-1022";

const EX_SOFTWARE: i32 = 70;

fn fail(msg: &str) -> i32 {
    eprintln!("gnomon-helper sandbox: {msg}");
    EX_SOFTWARE
}

fn last(what: &str) -> String {
    format!("{what} failed ({})", unsafe { GetLastError() })
}

struct Owned(HANDLE);
impl Drop for Owned {
    fn drop(&mut self) {
        if !self.0.is_null() && self.0 != INVALID_HANDLE_VALUE {
            unsafe { CloseHandle(self.0) };
        }
    }
}

/// MSVC / CommandLineToArgvW quoting of one argument.
pub fn quote_arg(a: &str) -> String {
    if !a.is_empty() && !a.chars().any(|c| c == ' ' || c == '\t' || c == '\n' || c == '\u{0b}' || c == '"') {
        return a.to_string();
    }
    let mut out = String::from("\"");
    let mut backslashes = 0usize;
    for c in a.chars() {
        match c {
            '\\' => backslashes += 1,
            '"' => {
                out.extend(std::iter::repeat('\\').take(backslashes * 2 + 1));
                out.push('"');
                backslashes = 0;
            }
            _ => {
                out.extend(std::iter::repeat('\\').take(backslashes));
                out.push(c);
                backslashes = 0;
            }
        }
    }
    out.extend(std::iter::repeat('\\').take(backslashes * 2));
    out.push('"');
    out
}

/// The restricted primary token (see the module doc).
fn restricted_token(low: bool, session_sid: Option<&str>) -> Result<Owned, String> {
    unsafe {
        let mut tok: HANDLE = null_mut();
        if OpenProcessToken(GetCurrentProcess(), TOKEN_DUPLICATE | TOKEN_QUERY | TOKEN_ASSIGN_PRIMARY | TOKEN_ADJUST_DEFAULT, &mut tok) == 0 {
            return Err(last("OpenProcessToken"));
        }
        let tok = Owned(tok);
        // aligned storage for both structures
        let mut ubuf_len = 0u32;
        GetTokenInformation(tok.0, TokenUser, null_mut(), 0, &mut ubuf_len);
        let mut ubuf = vec![0u64; (ubuf_len as usize).div_ceil(8) + 1];
        if GetTokenInformation(tok.0, TokenUser, ubuf.as_mut_ptr() as *mut c_void, ubuf_len, &mut ubuf_len) == 0 {
            return Err(last("GetTokenInformation(TokenUser)"));
        }
        let user = &*(ubuf.as_ptr() as *const TOKEN_USER);
        let mut gbuf_len = 0u32;
        GetTokenInformation(tok.0, TokenGroups, null_mut(), 0, &mut gbuf_len);
        let mut gbuf = vec![0u64; (gbuf_len as usize).div_ceil(8) + 1];
        if GetTokenInformation(tok.0, TokenGroups, gbuf.as_mut_ptr() as *mut c_void, gbuf_len, &mut gbuf_len) == 0 {
            return Err(last("GetTokenInformation(TokenGroups)"));
        }
        let groups = &*(gbuf.as_ptr() as *const TOKEN_GROUPS);
        let list = std::slice::from_raw_parts(groups.Groups.as_ptr(), groups.GroupCount as usize);

        let mut gnomon: PSID = null_mut();
        let w = crate::win::wide(GNOMON_SESSION_SID);
        if ConvertStringSidToSidW(w.as_ptr(), &mut gnomon) == 0 {
            return Err(last("ConvertStringSidToSidW"));
        }
        let mut restricting: Vec<SID_AND_ATTRIBUTES> = vec![SID_AND_ATTRIBUTES { Sid: user.User.Sid, Attributes: 0 }];
        for g in list {
            if g.Attributes & SE_GROUP_ENABLED as u32 != 0 && g.Attributes & SE_GROUP_USE_FOR_DENY_ONLY as u32 == 0 {
                restricting.push(SID_AND_ATTRIBUTES { Sid: g.Sid, Attributes: 0 });
            }
        }
        restricting.push(SID_AND_ATTRIBUTES { Sid: gnomon, Attributes: 0 });
        // this session's own SID (Aegis M2): its carve-backs are granted to it, so a concurrent session cannot use them
        let mut own: PSID = null_mut();
        if let Some(s) = session_sid {
            let w = crate::win::wide(s);
            if ConvertStringSidToSidW(w.as_ptr(), &mut own) == 0 {
                return Err(last("ConvertStringSidToSidW(session)"));
            }
            restricting.push(SID_AND_ATTRIBUTES { Sid: own, Attributes: 0 });
        }
        let mut rt: HANDLE = null_mut();
        let ok = CreateRestrictedToken(tok.0, DISABLE_MAX_PRIVILEGE, 0, null(), 0, null(), restricting.len() as u32, restricting.as_ptr(), &mut rt);
        windows_sys::Win32::Foundation::LocalFree(gnomon as *mut c_void);
        if !own.is_null() {
            windows_sys::Win32::Foundation::LocalFree(own as *mut c_void);
        }
        // ubuf / gbuf (the SIDs the restricting list points into) live until here: CreateRestrictedToken copied them
        drop((ubuf, gbuf));
        if ok == 0 {
            return Err(last("CreateRestrictedToken"));
        }
        let rt = Owned(rt);
        // the session's default DACL, explicitly: the launcher was spawned by the shielded kernel, whose default DACL
        // denies GNOMON_SESSION_SID (shield.rs), and the restricted token would inherit that (the session could not
        // open its own threads). Set on the SESSION token only; the launcher keeps the shielded default (Aegis M1).
        set_default_dacl(rt.0, session_sid)?;
        if low {
            // Low integrity (S-1-16-4096): no write up (only Low-labelled roots are writable), and NO_READ_UP |
            // NO_WRITE_UP on every Medium process object, so a session cannot open, read or inject into the kernel,
            // the wrapper or any other app of this user; UIPI blocks its input to their windows
            let mut low_sid: PSID = null_mut();
            let w = crate::win::wide("S-1-16-4096");
            if ConvertStringSidToSidW(w.as_ptr(), &mut low_sid) == 0 {
                return Err(last("ConvertStringSidToSidW(low)"));
            }
            let label = TOKEN_MANDATORY_LABEL { Label: SID_AND_ATTRIBUTES { Sid: low_sid, Attributes: SE_GROUP_INTEGRITY as u32 } };
            let r = SetTokenInformation(rt.0, TokenIntegrityLevel, &label as *const _ as *const c_void, std::mem::size_of::<TOKEN_MANDATORY_LABEL>() as u32 + GetLengthSid(low_sid));
            windows_sys::Win32::Foundation::LocalFree(low_sid as *mut c_void);
            if r == 0 {
                return Err(last("SetTokenInformation(TokenIntegrityLevel)"));
            }
        }
        Ok(rt)
    }
}

/// The DACL of what a session creates (its processes, threads, pipes, sections; its private desktop), as SDDL.
///
/// Aegis H1 (PR #52): every session token carries the user SID in BOTH access checks and every session runs at Low,
/// so a plain user + SYSTEM default let one session open, signal or inject into another's processes. With a session
/// SID the DACL is, IN THIS ORDER (deliberately non-canonical; nothing reorders a default DACL):
///   (A own session SID)    this session: its restricted check grants here, before the deny
///   (D GNOMON_SESSION_SID) every OTHER session: its restricted check stops here
///   (A user)(A SYSTEM)     the kernel and the user's unrestricted processes, and every session's normal check
///   (A;;RC;;;OW)           OWNER RIGHTS: the owner (the user, a restricting SID) gets READ_CONTROL only, never the
///                          implicit WRITE_DAC another session could use to rewrite this DACL (Aegis re-review)
/// The kernel's token holds no session SID, so neither session ACE applies to it.
pub fn session_object_sddl(user: &str, session_sid: Option<&str>) -> String {
    match session_sid {
        Some(own) => format!("D:(A;;GA;;;{own})(D;;GA;;;{GNOMON_SESSION_SID})(A;;GA;;;{user})(A;;GA;;;SY)(A;;RC;;;OW)"),
        None => format!("D:(A;;GA;;;{user})(A;;GA;;;SY)"),
    }
}

fn user_system_sddl(session_sid: Option<&str>) -> Result<String, String> {
    let user = crate::win::current_user_sid().map_err(|e| format!("current_user_sid: {}", e.message))?;
    Ok(session_object_sddl(&user, session_sid))
}

/// `tok`'s default DACL → `session_object_sddl`.
fn set_default_dacl(tok: HANDLE, session_sid: Option<&str>) -> Result<(), String> {
    unsafe {
        let w = crate::win::wide(&user_system_sddl(session_sid)?);
        let mut sd: PSECURITY_DESCRIPTOR = null_mut();
        if ConvertStringSecurityDescriptorToSecurityDescriptorW(w.as_ptr(), 1, &mut sd, null_mut()) == 0 {
            return Err(last("ConvertStringSecurityDescriptorToSecurityDescriptorW(default dacl)"));
        }
        let (mut present, mut defaulted) = (0i32, 0i32);
        let mut dacl: *mut ACL = null_mut();
        let ok = GetSecurityDescriptorDacl(sd, &mut present, &mut dacl, &mut defaulted) != 0 && present != 0 && {
            let d = TOKEN_DEFAULT_DACL { DefaultDacl: dacl };
            SetTokenInformation(tok, TokenDefaultDacl, &d as *const _ as *const c_void, std::mem::size_of::<TOKEN_DEFAULT_DACL>() as u32) != 0
        };
        let err = GetLastError();
        windows_sys::Win32::Foundation::LocalFree(sd as *mut c_void);
        if !ok {
            return Err(format!("SetTokenInformation(TokenDefaultDacl) failed ({err})"));
        }
    }
    Ok(())
}

/// Set a Low mandatory label (S:(ML;;NW;;;LW)) on a window-station object (the private desktop).
fn label_low(h: HANDLE) -> Result<(), String> {
    unsafe {
        let w = crate::win::wide("S:(ML;;NW;;;LW)");
        let mut sd: PSECURITY_DESCRIPTOR = null_mut();
        if ConvertStringSecurityDescriptorToSecurityDescriptorW(w.as_ptr(), 1, &mut sd, null_mut()) == 0 {
            return Err(last("ConvertStringSecurityDescriptorToSecurityDescriptorW(label)"));
        }
        let (mut present, mut defaulted) = (0i32, 0i32);
        let mut sacl: *mut ACL = null_mut();
        let ok = GetSecurityDescriptorSacl(sd, &mut present, &mut sacl, &mut defaulted);
        let r = if ok != 0 && present != 0 { SetSecurityInfo(h, SE_WINDOW_OBJECT, LABEL_SECURITY_INFORMATION, null_mut(), null_mut(), null(), sacl) } else { 1 };
        windows_sys::Win32::Foundation::LocalFree(sd as *mut c_void);
        if r != 0 {
            return Err(format!("SetSecurityInfo(desktop label) failed ({r})"));
        }
    }
    Ok(())
}

fn enter_job(ui: bool) -> Result<(), String> {
    unsafe {
        let job = CreateJobObjectW(null(), null());
        if job.is_null() {
            return Err(last("CreateJobObjectW"));
        }
        let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION;
        if SetInformationJobObject(job, JobObjectExtendedLimitInformation, &info as *const _ as *const c_void, std::mem::size_of_val(&info) as u32) == 0 {
            return Err(last("SetInformationJobObject(limits)"));
        }
        if ui {
            let r = JOBOBJECT_BASIC_UI_RESTRICTIONS {
                UIRestrictionsClass: JOB_OBJECT_UILIMIT_HANDLES
                    | JOB_OBJECT_UILIMIT_READCLIPBOARD
                    | JOB_OBJECT_UILIMIT_WRITECLIPBOARD
                    | JOB_OBJECT_UILIMIT_DESKTOP
                    | JOB_OBJECT_UILIMIT_GLOBALATOMS
                    | JOB_OBJECT_UILIMIT_SYSTEMPARAMETERS
                    | JOB_OBJECT_UILIMIT_DISPLAYSETTINGS
                    | JOB_OBJECT_UILIMIT_EXITWINDOWS,
            };
            if SetInformationJobObject(job, JobObjectBasicUIRestrictions, &r as *const _ as *const c_void, std::mem::size_of_val(&r) as u32) == 0 {
                return Err(last("SetInformationJobObject(ui)"));
            }
        }
        if AssignProcessToJobObject(job, GetCurrentProcess()) == 0 {
            return Err(last("AssignProcessToJobObject(self)"));
        }
    }
    Ok(())
}

pub fn run(args: &[String]) -> i32 {
    let mut desktop = false;
    let mut low = false;
    let mut session_sid: Option<String> = None;
    let mut i = 0;
    while i < args.len() && args[i] != "--" {
        match args[i].as_str() {
            "--desktop" => desktop = true,
            "--low" => low = true,
            "--session-sid" => {
                i += 1;
                match args.get(i) {
                    Some(s) if crate::protocol::check_session_sid(s).is_ok() => session_sid = Some(s.clone()),
                    _ => return fail("--session-sid takes S-1-9-4174-2026-1022-<n>"),
                }
            }
            other => return fail(&format!("unknown option {other}")),
        }
        i += 1;
    }
    if i >= args.len() {
        return fail("usage: sandbox [--desktop] [--low] [--session-sid <sid>] -- <absolute exe> [args…]");
    }
    if low && session_sid.is_none() {
        // every Low session has its own SID: its objects admit it alone (H1); never the shared user + SYSTEM default
        return fail("--low requires --session-sid");
    }
    let rest = &args[i + 1..];
    let Some(exe) = rest.first() else { return fail("missing <exe>") };
    if crate::protocol::check_local_path(exe).is_err() || !exe.to_ascii_lowercase().ends_with(".exe") {
        return fail("<exe> must be an absolute path to an .exe");
    }
    let token = match restricted_token(low, session_sid.as_deref()) {
        Ok(t) => t,
        Err(e) => return fail(&e),
    };
    // the desktop is created BEFORE the job's UI limits apply to this process
    let desktop_name = if desktop {
        let name = format!("gnomon-session-{}", std::process::id());
        let w = crate::win::wide(&name);
        // READ_CONTROL | WRITE_OWNER (0x20000 | 0x80000): needed to set the desktop's mandatory label below
        // an explicit DACL: the launcher's own default denies the session SID (Aegis M1); this session only (H1)
        let sddl = match user_system_sddl(session_sid.as_deref()) {
            Ok(x) => crate::win::wide(&x),
            Err(e) => return fail(&e),
        };
        let mut dsd: PSECURITY_DESCRIPTOR = null_mut();
        if unsafe { ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl.as_ptr(), 1, &mut dsd, null_mut()) } == 0 {
            return fail(&last("ConvertStringSecurityDescriptorToSecurityDescriptorW(desktop)"));
        }
        let sa = SECURITY_ATTRIBUTES { nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32, lpSecurityDescriptor: dsd, bInheritHandle: 0 };
        let h = unsafe { CreateDesktopW(w.as_ptr(), null(), null(), 0, DESKTOP_CREATEWINDOW | DESKTOP_READOBJECTS | DESKTOP_WRITEOBJECTS | 0x0002_0000 | 0x0008_0000, &sa) };
        unsafe { windows_sys::Win32::Foundation::LocalFree(dsd as *mut c_void) };
        if h.is_null() {
            return fail(&last("CreateDesktopW"));
        }
        if low {
            // a Low process cannot attach to a Medium desktop (user32 init fails 0xC0000142): label it Low, no-write-up
            if let Err(e) = label_low(h as HANDLE) {
                return fail(&e);
            }
        }
        // deliberately leaked: the desktop lives as long as this launcher (and so the session)
        Some(crate::win::wide(&format!("WinSta0\\{name}")))
    } else {
        None
    };
    if let Err(e) = enter_job(true) {
        return fail(&e);
    }
    let cmdline: String = rest.iter().map(|a| quote_arg(a)).collect::<Vec<_>>().join(" ");
    let mut cmd_w = crate::win::wide(&cmdline);
    let exe_w = crate::win::wide(exe);
    unsafe {
        let mut std: Vec<HANDLE> = Vec::new();
        for id in [STD_INPUT_HANDLE, STD_OUTPUT_HANDLE, STD_ERROR_HANDLE] {
            let h = GetStdHandle(id);
            if !h.is_null() && h != INVALID_HANDLE_VALUE {
                SetHandleInformation(h, HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT);
                if !std.contains(&h) {
                    std.push(h);
                }
            }
        }
        let mut size = 0usize;
        InitializeProcThreadAttributeList(null_mut(), 1, 0, &mut size);
        let mut attr_buf = vec![0u64; size.div_ceil(8)];
        let attrs = attr_buf.as_mut_ptr() as LPPROC_THREAD_ATTRIBUTE_LIST;
        if InitializeProcThreadAttributeList(attrs, 1, 0, &mut size) == 0 {
            return fail(&last("InitializeProcThreadAttributeList"));
        }
        if !std.is_empty()
            && UpdateProcThreadAttribute(attrs, 0, PROC_THREAD_ATTRIBUTE_HANDLE_LIST as usize, std.as_ptr() as *const c_void, std.len() * std::mem::size_of::<HANDLE>(), null_mut(), null()) == 0
        {
            return fail(&last("UpdateProcThreadAttribute(handle list)"));
        }
        let mut si: STARTUPINFOEXW = std::mem::zeroed();
        si.StartupInfo.cb = std::mem::size_of::<STARTUPINFOEXW>() as u32;
        si.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
        si.StartupInfo.hStdInput = GetStdHandle(STD_INPUT_HANDLE);
        si.StartupInfo.hStdOutput = GetStdHandle(STD_OUTPUT_HANDLE);
        si.StartupInfo.hStdError = GetStdHandle(STD_ERROR_HANDLE);
        let mut desk_w = desktop_name.unwrap_or_default();
        if !desk_w.is_empty() {
            si.StartupInfo.lpDesktop = desk_w.as_mut_ptr();
        }
        si.lpAttributeList = attrs;
        let mut pi: PROCESS_INFORMATION = std::mem::zeroed();
        let ok = CreateProcessAsUserW(
            token.0,
            exe_w.as_ptr(),
            cmd_w.as_mut_ptr(),
            null(),
            null(),
            if std.is_empty() { 0 } else { 1 },
            EXTENDED_STARTUPINFO_PRESENT | CREATE_UNICODE_ENVIRONMENT,
            null(),
            null(),
            &si.StartupInfo,
            &mut pi,
        );
        let err = GetLastError();
        DeleteProcThreadAttributeList(attrs);
        if ok == 0 {
            return fail(&format!("CreateProcessAsUserW({exe}) failed ({err})"));
        }
        CloseHandle(pi.hThread);
        let proc_ = Owned(pi.hProcess);
        if WaitForSingleObject(proc_.0, INFINITE) != WAIT_OBJECT_0 {
            return fail(&last("WaitForSingleObject"));
        }
        let mut code = 0u32;
        if GetExitCodeProcess(proc_.0, &mut code) == 0 {
            return fail(&last("GetExitCodeProcess"));
        }
        code as i32
    }
}

#[cfg(test)]
mod tests {
    use super::{quote_arg, session_object_sddl, GNOMON_SESSION_SID};
    #[test]
    fn session_objects_admit_their_own_session_before_denying_the_rest() {
        let own = "S-1-9-4174-2026-1022-7";
        let s = session_object_sddl("S-1-5-21-1-2-3-1001", Some(own));
        let aces = [format!("(A;;GA;;;{own})"), format!("(D;;GA;;;{GNOMON_SESSION_SID})"), "(A;;GA;;;S-1-5-21-1-2-3-1001)".to_string(), "(A;;GA;;;SY)".to_string(), "(A;;RC;;;OW)".to_string()];
        let at: Vec<usize> = aces.iter().map(|a| s.find(a.as_str()).expect(a)).collect();
        assert!(at.windows(2).all(|w| w[0] < w[1]), "{s}");
        assert_eq!(session_object_sddl("U", None), "D:(A;;GA;;;U)(A;;GA;;;SY)");
    }
    #[test]
    fn quoting_matches_commandlinetoargvw() {
        assert_eq!(quote_arg("plain"), "plain");
        assert_eq!(quote_arg(""), "\"\"");
        assert_eq!(quote_arg("a b"), "\"a b\"");
        assert_eq!(quote_arg(r#"a"b"#), r#""a\"b""#);
        assert_eq!(quote_arg(r"C:\dir with space\"), r#""C:\dir with space\\""#);
        assert_eq!(quote_arg(r#"x\"y"#), r#""x\\\"y""#);
        assert_eq!(quote_arg(r"no\space"), r"no\space");
    }
}
