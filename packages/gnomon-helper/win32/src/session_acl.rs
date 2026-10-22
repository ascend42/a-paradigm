//! `acl.session` — the session deny list as ACEs for GNOMON_SESSION_SID (W5; see sandbox.rs for why a deny ACE
//! naming that SID binds a session and nothing else).
//!
//! For one path, the op REPLACES every explicit ACE naming GNOMON_SESSION_SID with the requested ones (idempotent:
//! re-applying the same policy is a no-op), keeps the object's DACL protection state, and adds an explicit
//! OWNER RIGHTS (S-1-3-4) READ_CONTROL-only ACE wherever it adds a deny. Why: the owner of an object is IMPLICITLY
//! granted READ_CONTROL | WRITE_DAC, which a deny ACE does not stop, and the user (the owner) is a restricting SID
//! of the session token; with an OWNER RIGHTS ACE present the implicit grant is replaced by that ACE, which
//! is evaluated after the explicit deny. So a session can neither read nor rewrite the DACL of a denied object,
//! while the user (outside a session) keeps full control.
//!
//! Modes: deny-read, deny-write, deny-all (both), allow-read, allow-write (carve-backs below an inherited deny:
//! an explicit ACE on the child is evaluated before the inherited one), clear (remove every session ACE).
//! Inheritance: `subpath` = object + container inherit; `literal` = this object only.

use crate::protocol::HelperError;
use std::ffi::c_void;
use std::ptr::{null, null_mut};
use windows_sys::Win32::Foundation::LocalFree;
use windows_sys::Win32::Security::Authorization::{
    ConvertSecurityDescriptorToStringSecurityDescriptorW, ConvertSidToStringSidW, ConvertStringSecurityDescriptorToSecurityDescriptorW, ConvertStringSidToSidW, GetNamedSecurityInfoW, SetEntriesInAclW, SetNamedSecurityInfoW, DENY_ACCESS,
    EXPLICIT_ACCESS_W, GRANT_ACCESS, NO_MULTIPLE_TRUSTEE, SE_FILE_OBJECT, SE_REGISTRY_KEY, TRUSTEE_IS_SID,
    TRUSTEE_IS_UNKNOWN, TRUSTEE_W,
};
use windows_sys::Win32::Security::{
    AddAce, EqualSid, GetAce, GetAclInformation, GetSecurityDescriptorControl, GetSecurityDescriptorSacl, InitializeAcl,
    LABEL_SECURITY_INFORMATION, AclSizeInformation, ACE_HEADER, ACL,
    ACL_SIZE_INFORMATION, INHERITED_ACE, DACL_SECURITY_INFORMATION, NO_INHERITANCE, PROTECTED_DACL_SECURITY_INFORMATION,
    PSECURITY_DESCRIPTOR, PSID, SE_DACL_PROTECTED, SUB_CONTAINERS_AND_OBJECTS_INHERIT,
    UNPROTECTED_DACL_SECURITY_INFORMATION,
};

// FILE_* access rights (winnt.h)
const FILE_READ_DATA: u32 = 0x0001; // also FILE_LIST_DIRECTORY
const FILE_WRITE_DATA: u32 = 0x0002; // also FILE_ADD_FILE
const FILE_APPEND_DATA: u32 = 0x0004; // also FILE_ADD_SUBDIRECTORY
const FILE_READ_EA: u32 = 0x0008;
const FILE_WRITE_EA: u32 = 0x0010;
const FILE_EXECUTE: u32 = 0x0020; // also FILE_TRAVERSE (bypassed by SeChangeNotify anyway)
const FILE_DELETE_CHILD: u32 = 0x0040;
const FILE_READ_ATTRIBUTES: u32 = 0x0080;
const FILE_WRITE_ATTRIBUTES: u32 = 0x0100;
const DELETE: u32 = 0x0001_0000;
const READ_CONTROL: u32 = 0x0002_0000;
const WRITE_DAC: u32 = 0x0004_0000;
const WRITE_OWNER: u32 = 0x0008_0000;
const SYNCHRONIZE: u32 = 0x0010_0000;

/// Reads of data, EAs and execution; attributes stay readable (stat / realpath of a denied ancestor).
pub const DENY_READ_MASK: u32 = FILE_READ_DATA | FILE_READ_EA | FILE_EXECUTE;
/// Every way to change the object or its DACL/owner.
pub const DENY_WRITE_MASK: u32 =
    FILE_WRITE_DATA | FILE_APPEND_DATA | FILE_WRITE_EA | FILE_WRITE_ATTRIBUTES | DELETE | FILE_DELETE_CHILD | WRITE_DAC | WRITE_OWNER;
/// remove, rename, re-ACL, re-own, and delete a CHILD through this dir's FILE_DELETE_CHILD (Aegis H1: on the parent
/// of a literal-denied file, so it cannot be deleted and recreated without its deny); never add-file. A child still
/// carries its own DELETE, so other files in the dir stay deletable.
pub const DENY_REPLACE_MASK: u32 = DELETE | WRITE_DAC | WRITE_OWNER | FILE_DELETE_CHILD;
pub const ALLOW_READ_MASK: u32 = FILE_READ_DATA | FILE_READ_EA | FILE_EXECUTE | FILE_READ_ATTRIBUTES | READ_CONTROL | SYNCHRONIZE;
pub const ALLOW_WRITE_MASK: u32 =
    FILE_WRITE_DATA | FILE_APPEND_DATA | FILE_WRITE_EA | FILE_WRITE_ATTRIBUTES | DELETE | FILE_DELETE_CHILD | SYNCHRONIZE;

/// KEY_SET_VALUE | KEY_CREATE_SUB_KEY | KEY_CREATE_LINK | DELETE | WRITE_DAC | WRITE_OWNER: every way to change a
/// key, never a read right (the file write mask's 0x10 is KEY_NOTIFY, part of KEY_READ, on a key)
pub const REG_DENY_WRITE_MASK: u32 = 0x0002 | 0x0004 | 0x0020 | DELETE | WRITE_DAC | WRITE_OWNER;
/// KEY_QUERY_VALUE | KEY_ENUMERATE_SUB_KEYS | KEY_NOTIFY
pub const REG_DENY_READ_MASK: u32 = 0x0001 | 0x0008 | 0x0010;

fn registry_mask(mode: Mode, file_mask: u32) -> u32 {
    match mode {
        Mode::DenyWrite => REG_DENY_WRITE_MASK,
        Mode::DenyAll => REG_DENY_WRITE_MASK | REG_DENY_READ_MASK,
        _ => file_mask,
    }
}

const OWNER_RIGHTS_SID: &str = "S-1-3-4";
/// The OWNER RIGHTS ACE grants READ_CONTROL only. Its job is to REPLACE the owner's implicit READ_CONTROL|WRITE_DAC
/// (module doc), never to grant: a session token carries the user (the owner) as a restricting SID, so a wider grant
/// here would be evaluated before an INHERITED session deny and win (the Aegis W5 cross-session finding). The user
/// keeps full control through their own ACE.
const OWNER_RIGHTS_MASK: u32 = READ_CONTROL;

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Mode {
    DenyRead,
    DenyWrite,
    DenyAll,
    AllowRead,
    AllowWrite,
    /// a carve-back root (Claude's transcripts, this session's session-env dir): writes allowed below it (inherited),
    /// while the root itself cannot be removed, renamed, re-ACLed or re-owned (one entry: a second entry on the same
    /// path would drop the first)
    AllowWriteKeep,
    /// a literal deny on a DIRECTORY: it cannot be removed, renamed, re-ACLed or re-owned, but files can still be
    /// created inside it (a deny-write would also deny FILE_ADD_FILE)
    DenyReplace,
    Clear,
    /// Low mandatory label, no-write-up (the session's writable roots; sandbox.rs runs sessions at Low)
    LabelLow,
    /// remove the explicit mandatory label (the object is Medium again)
    LabelClear,
    /// Medium label, no-read-up and no-write-up: no Low process (a session, the GUI transport) can read it
    /// (the Gnomon home: keys, the kernel log, other sessions)
    LabelNoReadUp,
    /// Medium label, no-write-up only: readable (not writable) by Low processes below a no-read-up home (the GUI
    /// bundle for the transport child; a session's read carve-backs and its claude copy)
    LabelReadable,
    /// an ANCESTOR of a read carve-back inside the no-read-up home (the policy's allowReadMetadata): the dir itself
    /// carries no explicit label (Medium, no-write-up: a Low process may read its attributes and security, which is
    /// what a path vetting walk needs), while everything created or inherited below it stays no-read-up (an
    /// inherit-only label). Listing it stays denied by the session deny ACE.
    LabelMeta,
}

impl Mode {
    /// the modes a registry key takes: write denies and their removal (never a label, never an allow)
    pub fn registry_ok(self) -> bool {
        matches!(self, Mode::DenyWrite | Mode::DenyAll | Mode::Clear)
    }
    pub fn parse(s: &str) -> Option<Mode> {
        Some(match s {
            "deny-read" => Mode::DenyRead,
            "deny-write" => Mode::DenyWrite,
            "deny-all" => Mode::DenyAll,
            "allow-read" => Mode::AllowRead,
            "allow-write" => Mode::AllowWrite,
            "allow-write-keep" => Mode::AllowWriteKeep,
            "deny-replace" => Mode::DenyReplace,
            "clear" => Mode::Clear,
            "label-low" => Mode::LabelLow,
            "label-clear" => Mode::LabelClear,
            "label-no-read-up" => Mode::LabelNoReadUp,
            "label-readable" => Mode::LabelReadable,
            "label-meta" => Mode::LabelMeta,
            _ => return None,
        })
    }
    /// (access mode, mask) of the session ACE, or None for `clear`
    fn ace(self) -> Option<(i32, u32)> {
        match self {
            Mode::DenyRead => Some((DENY_ACCESS, DENY_READ_MASK)),
            Mode::DenyWrite => Some((DENY_ACCESS, DENY_WRITE_MASK)),
            Mode::DenyAll => Some((DENY_ACCESS, DENY_READ_MASK | DENY_WRITE_MASK)),
            Mode::AllowRead => Some((GRANT_ACCESS, ALLOW_READ_MASK)),
            Mode::AllowWrite | Mode::AllowWriteKeep => Some((GRANT_ACCESS, ALLOW_WRITE_MASK)),
            Mode::DenyReplace => Some((DENY_ACCESS, DENY_REPLACE_MASK)),
            Mode::Clear | Mode::LabelLow | Mode::LabelClear | Mode::LabelNoReadUp | Mode::LabelReadable | Mode::LabelMeta => None,
        }
    }
}

/// A copy of `acl` without its explicit (non-inherited) allow/deny ACEs naming any of `sids` (u64-backed so the ACL
/// is aligned). Inherited ACEs and every other ACE keep their order.
unsafe fn without_explicit(acl: *const ACL, sids: &[PSID]) -> Result<Vec<u64>, HelperError> {
    let mut info: ACL_SIZE_INFORMATION = std::mem::zeroed();
    if acl.is_null() {
        // a NULL DACL grants everyone everything: refuse to edit it (never widen it into a deny-only list)
        return Err(HelperError::new("null-dacl", "the object has a NULL DACL"));
    }
    if GetAclInformation(acl, &mut info as *mut _ as *mut c_void, std::mem::size_of_val(&info) as u32, AclSizeInformation) == 0 {
        return Err(HelperError::os("GetAclInformation", windows_sys::Win32::Foundation::GetLastError()));
    }
    let size = info.AclBytesInUse.max(8);
    let mut buf = vec![0u64; (size as usize).div_ceil(8)];
    let out = buf.as_mut_ptr() as *mut ACL;
    if InitializeAcl(out, size, (*acl).AclRevision as u32) == 0 {
        return Err(HelperError::os("InitializeAcl", windows_sys::Win32::Foundation::GetLastError()));
    }
    for i in 0..info.AceCount {
        let mut ace: *mut c_void = null_mut();
        if GetAce(acl, i, &mut ace) == 0 {
            return Err(HelperError::os("GetAce", windows_sys::Win32::Foundation::GetLastError()));
        }
        let h = &*(ace as *const ACE_HEADER);
        // ACCESS_ALLOWED_ACE_TYPE 0 / ACCESS_DENIED_ACE_TYPE 1: header (4) + mask (4) + SID
        let ace_sid = (ace as *mut u8).add(8) as PSID;
        let drop = (h.AceType == 0 || h.AceType == 1)
            && (h.AceFlags as u32 & INHERITED_ACE) == 0
            && (sids.iter().any(|s| EqualSid(ace_sid, *s) != 0) || is_session_sid(ace_sid));
        if !drop && AddAce(out, (*acl).AclRevision as u32, u32::MAX, ace, h.AceSize as u32) == 0 {
            return Err(HelperError::os("AddAce", windows_sys::Win32::Foundation::GetLastError()));
        }
    }
    Ok(buf)
}

/// GNOMON_SESSION_SID itself or a per-session SID below it (`S-1-9-4174-2026-1022-<n>`).
unsafe fn is_session_sid(p: PSID) -> bool {
    let mut w: *mut u16 = null_mut();
    if ConvertSidToStringSidW(p, &mut w) == 0 {
        return false;
    }
    let mut n = 0usize;
    while *w.add(n) != 0 {
        n += 1;
    }
    let s = String::from_utf16_lossy(std::slice::from_raw_parts(w, n));
    LocalFree(w as *mut c_void);
    let base = crate::sandbox::GNOMON_SESSION_SID;
    s == base || s.strip_prefix(base).is_some_and(|r| r.starts_with('-'))
}

struct LocalBox(*mut c_void);
impl Drop for LocalBox {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe { LocalFree(self.0) };
        }
    }
}

fn sid(s: &str) -> Result<LocalBox, HelperError> {
    let w = crate::win::wide(s);
    let mut p: PSID = null_mut();
    if unsafe { ConvertStringSidToSidW(w.as_ptr(), &mut p) } == 0 {
        return Err(HelperError::os("ConvertStringSidToSidW", unsafe { windows_sys::Win32::Foundation::GetLastError() }));
    }
    Ok(LocalBox(p))
}

fn trustee(p: PSID) -> TRUSTEE_W {
    TRUSTEE_W {
        pMultipleTrustee: null_mut(),
        MultipleTrusteeOperation: NO_MULTIPLE_TRUSTEE,
        TrusteeForm: TRUSTEE_IS_SID,
        TrusteeType: TRUSTEE_IS_UNKNOWN,
        ptstrName: p as *mut u16,
    }
}

/// Set (LabelLow) or remove (LabelClear) the mandatory label on `path`; read back the label SDDL.
fn label(path: &str, mode: Mode, inherit: bool) -> Result<String, HelperError> {
    let sddl = match (mode, inherit) {
        (Mode::LabelLow, true) => "S:(ML;OICI;NW;;;LW)",
        (Mode::LabelLow, false) => "S:(ML;;NW;;;LW)",
        (Mode::LabelNoReadUp, true) => "S:(ML;OICI;NRNW;;;ME)",
        (Mode::LabelNoReadUp, false) => "S:(ML;;NRNW;;;ME)",
        (Mode::LabelReadable, true) => "S:(ML;OICI;NW;;;ME)",
        (Mode::LabelReadable, false) => "S:(ML;;NW;;;ME)",
        (Mode::LabelMeta, _) => "S:(ML;OICIIO;NRNW;;;ME)",
        _ => "S:",
    };
    let wpath = crate::win::wide(path);
    unsafe {
        let w = crate::win::wide(sddl);
        let mut sd: PSECURITY_DESCRIPTOR = null_mut();
        if ConvertStringSecurityDescriptorToSecurityDescriptorW(w.as_ptr(), 1, &mut sd, null_mut()) == 0 {
            return Err(HelperError::os("ConvertStringSecurityDescriptorToSecurityDescriptorW(label)", windows_sys::Win32::Foundation::GetLastError()));
        }
        let _sd = LocalBox(sd);
        let (mut present, mut defaulted) = (0i32, 0i32);
        let mut sacl: *mut ACL = null_mut();
        GetSecurityDescriptorSacl(sd, &mut present, &mut sacl, &mut defaulted);
        // an empty SACL under LABEL_SECURITY_INFORMATION removes the explicit label
        let mut empty = [0u64; 2];
        if sacl.is_null() {
            InitializeAcl(empty.as_mut_ptr() as *mut ACL, 16, 2);
            sacl = empty.as_mut_ptr() as *mut ACL;
        }
        let r = SetNamedSecurityInfoW(wpath.as_ptr(), SE_FILE_OBJECT, LABEL_SECURITY_INFORMATION, null_mut(), null_mut(), null(), sacl);
        if r != 0 {
            return Err(HelperError::os("SetNamedSecurityInfoW(label)", r));
        }
        let mut out: PSECURITY_DESCRIPTOR = null_mut();
        let r = GetNamedSecurityInfoW(wpath.as_ptr(), SE_FILE_OBJECT, LABEL_SECURITY_INFORMATION, null_mut(), null_mut(), null_mut(), null_mut(), &mut out);
        if r != 0 {
            return Err(HelperError::os("GetNamedSecurityInfoW(label)", r));
        }
        let _out = LocalBox(out);
        let mut s: *mut u16 = null_mut();
        if ConvertSecurityDescriptorToStringSecurityDescriptorW(out, 1, LABEL_SECURITY_INFORMATION, &mut s, null_mut()) == 0 {
            return Err(HelperError::os("ConvertSecurityDescriptorToStringSecurityDescriptorW(label)", windows_sys::Win32::Foundation::GetLastError()));
        }
        let mut n = 0usize;
        while *s.add(n) != 0 {
            n += 1;
        }
        let text = String::from_utf16_lossy(std::slice::from_raw_parts(s, n));
        LocalFree(s as *mut c_void);
        Ok(text)
    }
}

/// Apply `mode` on `path` (`inherit`: subpath), then return the read-back SDDL. The ACEs name GNOMON_SESSION_SID,
/// except an ALLOW when `own` names this session's own SID (a carve-back no other session shares, Aegis M2). Every
/// explicit ACE of every Gnomon session SID on the path is replaced.
pub fn apply(path: &str, mode: Mode, inherit: bool, own: Option<&str>) -> Result<String, HelperError> {
    if matches!(mode, Mode::LabelLow | Mode::LabelClear | Mode::LabelNoReadUp | Mode::LabelReadable | Mode::LabelMeta) {
        return label(path, mode, inherit);
    }
    // a registry key of this user (`HKCU\…`, validated by the caller): the same ACEs on SE_REGISTRY_KEY
    let (name, ty) = match path.strip_prefix("HKCU\\") {
        Some(rest) => (format!("CURRENT_USER\\{rest}"), SE_REGISTRY_KEY),
        None => (path.to_string(), SE_FILE_OBJECT),
    };
    let session = sid(crate::sandbox::GNOMON_SESSION_SID)?;
    let owner_rights = sid(OWNER_RIGHTS_SID)?;
    let own_sid = match own {
        Some(s) => Some(sid(s)?),
        None => None,
    };
    let wpath = crate::win::wide(&name);
    unsafe {
        let mut sd: PSECURITY_DESCRIPTOR = null_mut();
        let mut dacl: *mut ACL = null_mut();
        let r = GetNamedSecurityInfoW(wpath.as_ptr(), ty, DACL_SECURITY_INFORMATION, null_mut(), null_mut(), &mut dacl, null_mut(), &mut sd);
        if r != 0 {
            return Err(HelperError::os("GetNamedSecurityInfoW", r));
        }
        let _sd = LocalBox(sd);
        let mut control = 0u16;
        let mut rev = 0u32;
        GetSecurityDescriptorControl(sd, &mut control, &mut rev);
        let protection = if control & SE_DACL_PROTECTED != 0 { PROTECTED_DACL_SECURITY_INFORMATION } else { UNPROTECTED_DACL_SECURITY_INFORMATION };

        // 1. drop every explicit ACE naming the session SID, allow AND deny (REVOKE_ACCESS removes only allows), and
        //    the explicit OWNER RIGHTS ACE this op adds next to a deny (idempotence; `clear` stops here)
        let mut cleared_buf = without_explicit(dacl, &[session.0, owner_rights.0])?;
        let cleared = cleared_buf.as_mut_ptr() as *mut ACL;
        let mut next = cleared;
        let mut _added = LocalBox(null_mut());
        let registry = ty == SE_REGISTRY_KEY;
        if let Some((access_mode, mask)) = mode.ace().map(|(a, m)| if registry { (a, registry_mask(mode, m)) } else { (a, m) }) {
            let inheritance = if inherit { SUB_CONTAINERS_AND_OBJECTS_INHERIT } else { NO_INHERITANCE };
            let who = match (&own_sid, access_mode) {
                (Some(o), GRANT_ACCESS) => o.0,
                _ => session.0,
            };
            let mut entries = vec![EXPLICIT_ACCESS_W { grfAccessPermissions: mask, grfAccessMode: access_mode, grfInheritance: inheritance, Trustee: trustee(who) }];
            if access_mode == DENY_ACCESS {
                // replaces the owner's implicit READ_CONTROL|WRITE_DAC (module doc)
                entries.push(EXPLICIT_ACCESS_W { grfAccessPermissions: OWNER_RIGHTS_MASK, grfAccessMode: GRANT_ACCESS, grfInheritance: inheritance, Trustee: trustee(owner_rights.0) });
            }
            if mode == Mode::AllowWriteKeep {
                // the root only: no replace (SetEntriesInAclW orders this deny before the allow)
                entries.push(EXPLICIT_ACCESS_W { grfAccessPermissions: DENY_REPLACE_MASK, grfAccessMode: DENY_ACCESS, grfInheritance: NO_INHERITANCE, Trustee: trustee(session.0) });
                entries.push(EXPLICIT_ACCESS_W { grfAccessPermissions: OWNER_RIGHTS_MASK, grfAccessMode: GRANT_ACCESS, grfInheritance: NO_INHERITANCE, Trustee: trustee(owner_rights.0) });
            }
            let mut out: *mut ACL = null_mut();
            let r = SetEntriesInAclW(entries.len() as u32, entries.as_ptr(), cleared, &mut out);
            if r != 0 {
                return Err(HelperError::os("SetEntriesInAclW", r));
            }
            _added = LocalBox(out as *mut c_void);
            next = out;
        }
        let r = SetNamedSecurityInfoW(wpath.as_ptr(), ty, DACL_SECURITY_INFORMATION | protection, null_mut(), null_mut(), next, null());
        if r != 0 {
            return Err(HelperError::os("SetNamedSecurityInfoW", r));
        }
    }
    crate::win::read_named_sddl(&name, ty)
}
