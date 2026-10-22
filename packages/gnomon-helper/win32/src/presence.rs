//! The Windows Hello presence key (W4 phase B; probe P02, packages/gnomon/probes/results/p02-hello.win32.json).
//!
//! A P-256 key in the Microsoft Passport KSP (MS_NGC_KEY_STORAGE_PROVIDER) named `//gnomon.local/<gen>/presence`
//! (empty SID part = the current user), created with NgcCacheType = AUTH_MANDATORY: Windows Hello (PIN, face or
//! fingerprint) is asked on creation and on EVERY signature — P02 showed a key without it signs silently under an
//! existing unlock, which is not presence. It is a SEPARATE key from the click-class approvals key (Aegis W4-A M2): the
//! approvals key signs a decision, this key signs only the kernel's presence challenge (`gnomon:presence:v1`).
//!
//! `sign {key:'approvals', mode:'fresh', messages:[approve, presence], reason}`: the presence message is signed FIRST,
//! under the Hello prompt (its text: `reason`), then the decision by the approvals key; a cancelled prompt signs
//! nothing (`presence-denied`). The prompt is owned by the window in the foreground when it is asked (the GUI the user
//! just clicked in), so it opens in front of them (P02: an ownerless prompt opened behind other windows).

use crate::approvals::{public_x963, sha256, st, Key, Prov};
use crate::protocol::HelperError;
use std::ptr::null;
use windows_sys::Win32::Foundation::HWND;
use windows_sys::Win32::Security::Cryptography::{
    NCryptCreatePersistedKey, NCryptFinalizeKey, NCryptGetProperty, NCryptOpenKey, NCryptOpenStorageProvider, NCryptSetProperty, NCryptSignHash,
    BCRYPT_ECDSA_P256_ALGORITHM, MS_NGC_KEY_STORAGE_PROVIDER, NCRYPT_KEY_HANDLE, NCRYPT_PROV_HANDLE, NCRYPT_USE_CONTEXT_PROPERTY,
    NCRYPT_WINDOW_HANDLE_PROPERTY,
};
use windows_sys::Win32::UI::WindowsAndMessaging::GetForegroundWindow;

const NTE_BAD_KEYSET: i32 = 0x8009_0016u32 as i32;
/// the NGC KSP reports a missing key as NTE_NO_KEY
const NTE_NO_KEY: i32 = 0x8009_000Du32 as i32;
const NTE_EXISTS: i32 = 0x8009_000Fu32 as i32;
/// NTE_USER_CANCELLED, HRESULT_FROM_WIN32(ERROR_CANCELLED): the user dismissed the Hello prompt
const CANCELLED: [i32; 2] = [0x8009_0036u32 as i32, 0x8007_04C7u32 as i32];
/// NCRYPT_NGC_CACHE_TYPE_PROPERTY_AUTH_MANDATORY_FLAG
const AUTH_MANDATORY: u32 = 1;
/// The one domain the presence key signs (signer.ts SIGNATURE_DOMAINS.presence).
pub const PRESENCE_DOMAIN: &[u8] = b"gnomon:presence:v1\n";
const MAX_REASON_CHARS: usize = 512;

fn name(gen: &str) -> Vec<u16> {
    crate::win::wide(&format!("//gnomon.local/{gen}/presence"))
}

fn provider() -> Result<Prov, HelperError> {
    let mut p: NCRYPT_PROV_HANDLE = 0;
    let s = unsafe { NCryptOpenStorageProvider(&mut p, MS_NGC_KEY_STORAGE_PROVIDER, 0) };
    if s != 0 {
        return Err(HelperError::new("presence-unavailable", &format!("Windows Hello is not available (0x{:08x})", s as u32)));
    }
    Ok(Prov(p))
}

/// Own the prompt by the foreground window and show `reason` in it.
/// The owner window: the foreground one when it is asked (the GUI the user just clicked in). Aegis W4-B L1: the
/// credential UI is drawn by the system, so the owner cannot read the PIN; a hostile foreground window can at worst
/// sit under the prompt or close it (a cancel). The kernel-composed reason text and check digests are always shown.
unsafe fn prompt_props(k: NCRYPT_KEY_HANDLE, reason: &str) -> Result<(), HelperError> {
    let hwnd: HWND = GetForegroundWindow();
    if !hwnd.is_null() {
        let s = NCryptSetProperty(k, NCRYPT_WINDOW_HANDLE_PROPERTY, &hwnd as *const HWND as *const u8, std::mem::size_of::<HWND>() as u32, 0);
        if s != 0 {
            return Err(st("NCryptSetProperty(window)", s));
        }
    }
    let text: String = reason.chars().filter(|c| !c.is_control()).take(MAX_REASON_CHARS).collect();
    let w = crate::win::wide(&text);
    let s = NCryptSetProperty(k, NCRYPT_USE_CONTEXT_PROPERTY, w.as_ptr() as *const u8, (w.len() * 2) as u32, 0);
    if s != 0 {
        return Err(st("NCryptSetProperty(use context)", s));
    }
    Ok(())
}

/// Aegis W4-B M1: the key's NgcCacheType must READ BACK as AUTH_MANDATORY (else it signs silently under an unlock,
/// probe P02): checked after creation and before every signature.
unsafe fn assert_mandatory(k: NCRYPT_KEY_HANDLE) -> Result<(), HelperError> {
    let prop = crate::win::wide("NgcCacheType");
    let mut v: u32 = 0;
    let mut got = 0u32;
    let s = NCryptGetProperty(k, prop.as_ptr(), &mut v as *mut u32 as *mut u8, 4, &mut got, 0);
    if s != 0 || got != 4 || v != AUTH_MANDATORY {
        return Err(HelperError::new("presence-unavailable", &format!("the presence key does not require Windows Hello on every use (NgcCacheType {v}, 0x{:08x})", s as u32)));
    }
    Ok(())
}

fn cancelled(s: i32) -> bool {
    CANCELLED.contains(&s)
}

/// Create the presence key of `gen` (a Hello prompt); its public point (X9.63).
pub fn create(gen: &str, reason: &str) -> Result<Vec<u8>, HelperError> {
    crate::approvals::check_gen(gen)?;
    let prov = provider()?;
    let n = name(gen);
    let mut k: NCRYPT_KEY_HANDLE = 0;
    let s = unsafe { NCryptCreatePersistedKey(prov.0, &mut k, BCRYPT_ECDSA_P256_ALGORITHM, n.as_ptr(), 0, 0) };
    if s == NTE_EXISTS {
        return Err(HelperError::new("exists", "a presence key of this gen exists"));
    }
    if s != 0 {
        return Err(st("NCryptCreatePersistedKey(presence)", s));
    }
    let k = Key(k);
    unsafe {
        let prop = crate::win::wide("NgcCacheType");
        let s = NCryptSetProperty(k.0, prop.as_ptr(), &AUTH_MANDATORY as *const u32 as *const u8, 4, 0);
        if s != 0 {
            return Err(st("NCryptSetProperty(NgcCacheType)", s));
        }
        prompt_props(k.0, reason)?;
        let s = NCryptFinalizeKey(k.0, 0);
        if cancelled(s) {
            return Err(HelperError::new("presence-denied", "the Windows Hello prompt was cancelled"));
        }
        if s != 0 {
            return Err(st("NCryptFinalizeKey(presence)", s));
        }
        assert_mandatory(k.0)?;
    }
    public_x963(&k)
}

fn open(gen: &str) -> Result<(Prov, Key), HelperError> {
    crate::approvals::check_gen(gen)?;
    let prov = provider()?;
    let n = name(gen);
    let mut k: NCRYPT_KEY_HANDLE = 0;
    let s = unsafe { NCryptOpenKey(prov.0, &mut k, n.as_ptr(), 0, 0) };
    if s == NTE_BAD_KEYSET || s == NTE_NO_KEY {
        return Err(HelperError::new("not-found", "no presence key of this gen"));
    }
    if s != 0 {
        return Err(st("NCryptOpenKey(presence)", s));
    }
    let k = Key(k);
    unsafe { assert_mandatory(k.0)? };
    Ok((prov, k))
}

pub fn public(gen: &str) -> Result<Vec<u8>, HelperError> {
    let (_p, k) = open(gen)?;
    public_x963(&k)
}

/// Sign ONE presence-domain message under a Windows Hello prompt; DER.
pub fn sign(gen: &str, message: &[u8], reason: &str) -> Result<Vec<u8>, HelperError> {
    if !message.starts_with(PRESENCE_DOMAIN) || message.len() > crate::approvals::MAX_MESSAGE_BYTES {
        return Err(HelperError::new("domain-refused", "the presence key signs presence challenges only"));
    }
    let (_p, k) = open(gen)?;
    let h = sha256(message)?;
    unsafe {
        prompt_props(k.0, reason)?;
        let mut sig = vec![0u8; 128];
        let mut len = 0u32;
        let s = NCryptSignHash(k.0, null(), h.as_ptr(), 32, sig.as_mut_ptr(), sig.len() as u32, &mut len, 0);
        if cancelled(s) {
            return Err(HelperError::new("presence-denied", "the Windows Hello prompt was cancelled"));
        }
        if s != 0 || len != 64 {
            return Err(st("NCryptSignHash(presence)", s));
        }
        Ok(crate::approvals::p1363_to_der(&sig[..64]))
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn the_presence_key_signs_presence_challenges_only() {
        // refused before the key is opened (no prompt): any other domain
        for m in [&b"gnomon:approve:v1\nx"[..], b"gnomon:approve-voice:v1\nx", b"gnomon:event-sig:v1\nx", b"x"] {
            assert_eq!(super::sign("no-such-gen", m, "r").unwrap_err().code, "domain-refused");
        }
    }
}
