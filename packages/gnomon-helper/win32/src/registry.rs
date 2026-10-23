//! `registry.read {key}` — read one HKLM/HKCU key's values (W3; PR #52 release blocker: reg.exe output is localized,
//! so "the key does not exist" could not be told from an error on a non-English Windows, and every key read as
//! unreadable). Read-only (KEY_QUERY_VALUE, the 64-bit view); a missing key is `exists: false` by its error CODE
//! (ERROR_FILE_NOT_FOUND), never by message text. String values (REG_SZ, REG_EXPAND_SZ, unexpanded) carry their data;
//! every other type carries its type name only (the kernel treats a non-string value as unreadable, fail closed).

use crate::protocol::HelperError;
use std::ptr::null_mut;
use windows_sys::Win32::Foundation::{ERROR_FILE_NOT_FOUND, ERROR_NO_MORE_ITEMS, ERROR_SUCCESS};
use windows_sys::Win32::System::Registry::{
    RegCloseKey, RegEnumValueW, RegOpenKeyExW, HKEY, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_QUERY_VALUE, KEY_WOW64_64KEY,
    REG_BINARY, REG_DWORD, REG_EXPAND_SZ, REG_MULTI_SZ, REG_QWORD, REG_SZ,
};

pub struct Value {
    pub name: String,
    pub kind: &'static str,
    pub data: Option<String>,
}

/// `HKLM\…` / `HKCU\…` (the kernel's policy keys): None when the key does not exist.
pub fn read(key: &str) -> Result<Option<Vec<Value>>, HelperError> {
    let (root, sub) = match key.split_once('\\') {
        Some(("HKLM", s)) => (HKEY_LOCAL_MACHINE, s),
        Some(("HKCU", s)) => (HKEY_CURRENT_USER, s),
        _ => return Err(HelperError::new("bad-request", "key must start HKLM\\ or HKCU\\")),
    };
    if sub.is_empty() || !sub.chars().all(|c| c.is_ascii_alphanumeric() || " _.-\\".contains(c)) || sub.contains("\\\\") {
        return Err(HelperError::new("bad-request", "not a policy key"));
    }
    unsafe {
        let w = crate::win::wide(sub);
        let mut h: HKEY = null_mut();
        let r = RegOpenKeyExW(root, w.as_ptr(), 0, KEY_QUERY_VALUE | KEY_WOW64_64KEY, &mut h);
        if r == ERROR_FILE_NOT_FOUND {
            return Ok(None);
        }
        if r != ERROR_SUCCESS {
            return Err(HelperError::os("RegOpenKeyExW", r));
        }
        let mut out = Vec::new();
        let mut i = 0u32;
        let res = loop {
            let mut name = vec![0u16; 16_384];
            let mut name_len = name.len() as u32;
            let mut ty = 0u32;
            let mut data = vec![0u8; 64 * 1024];
            let mut data_len = data.len() as u32;
            let r = RegEnumValueW(h, i, name.as_mut_ptr(), &mut name_len, null_mut(), &mut ty, data.as_mut_ptr(), &mut data_len);
            if r == ERROR_NO_MORE_ITEMS {
                break Ok(());
            }
            if r != ERROR_SUCCESS {
                break Err(HelperError::os("RegEnumValueW", r)); // incl. a value over 64 KiB: unreadable, fail closed
            }
            let name = String::from_utf16_lossy(&name[..name_len as usize]);
            let kind = match ty {
                REG_SZ => "REG_SZ",
                REG_EXPAND_SZ => "REG_EXPAND_SZ",
                REG_MULTI_SZ => "REG_MULTI_SZ",
                REG_DWORD => "REG_DWORD",
                REG_QWORD => "REG_QWORD",
                REG_BINARY => "REG_BINARY",
                _ => "REG_OTHER",
            };
            let text = if ty == REG_SZ || ty == REG_EXPAND_SZ {
                let units: Vec<u16> = data[..data_len as usize].chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
                let end = units.iter().position(|&u| u == 0).unwrap_or(units.len());
                Some(String::from_utf16_lossy(&units[..end]))
            } else {
                None
            };
            out.push(Value { name, kind, data: text });
            i += 1;
        };
        RegCloseKey(h);
        res.map(|()| Some(out))
    }
}
