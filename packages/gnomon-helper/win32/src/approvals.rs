//! The approvals key on Windows (W4 phase A; docs/plans/gnomon-windows.md, TD-2026-10-22-278 "approvals are hybrid").
//!
//! A P-256 key in the Microsoft Software Key Storage Provider, named `gnomon-<gen>-approvals`: per user, protected by
//! DPAPI, NOT exportable (the private key never crosses this pipe in either direction; this process holds only a
//! handle while it signs). It signs the kernel's approval decisions for the CLICK classes (permission allow/deny,
//! ask-user, plan: the `cached` decision class), which on Windows take no presence: `sign {mode:'click'}`.
//!
//! What it is NOT: a presence proof. Any process of this user can use a DPAPI-protected software key, so a click
//! signature proves "this user's session", never "a human was there". The fresh / root classes need Windows Hello
//! (phase B, a Passport KSP key): `mode:'fresh'` refuses `presence-unavailable` here, and there are no unlocks to
//! cache (`mode:'cached'` refuses `no-unlock`; unlock.drop / unlock.drop-all / conn.close are no-ops).
//!
//! Wire (the darwin helper's, protocol v2): key.create / key.public {key:'approvals', gen} → {publicKey: base64 X9.63
//! uncompressed point}; sign {key:'approvals', gen, mode, messages: [base64 …]} → {sigs: [base64 DER ECDSA-Sig-Value
//! over SHA-256 of each message]}.

use crate::protocol::HelperError;
use std::ffi::c_void;
use std::ptr::{null, null_mut};
use windows_sys::Win32::Security::Cryptography::{
    BCryptHash, NCryptCreatePersistedKey, NCryptExportKey, NCryptFinalizeKey, NCryptFreeObject, NCryptOpenKey,
    NCryptOpenStorageProvider, NCryptSignHash, BCRYPT_ECCKEY_BLOB, BCRYPT_ECCPUBLIC_BLOB, BCRYPT_ECDSA_P256_ALGORITHM,
    BCRYPT_SHA256_ALG_HANDLE, MS_KEY_STORAGE_PROVIDER, NCRYPT_KEY_HANDLE, NCRYPT_PROV_HANDLE, NCRYPT_SILENT_FLAG,
};

const NTE_BAD_KEYSET: i32 = 0x8009_0016u32 as i32;
const NTE_EXISTS: i32 = 0x8009_000Fu32 as i32;
pub const MAX_MESSAGES: usize = 4;
pub const MAX_MESSAGE_BYTES: usize = 64 * 1024;

struct Prov(NCRYPT_PROV_HANDLE);
impl Drop for Prov {
    fn drop(&mut self) {
        if self.0 != 0 {
            unsafe { NCryptFreeObject(self.0) };
        }
    }
}
struct Key(NCRYPT_KEY_HANDLE);
impl Drop for Key {
    fn drop(&mut self) {
        if self.0 != 0 {
            unsafe { NCryptFreeObject(self.0) };
        }
    }
}

fn st(what: &str, s: i32) -> HelperError {
    HelperError::os(what, s as u32)
}

/// `gen`: 1-32 of [a-z0-9-] (the key name is `gnomon-<gen>-approvals`).
pub fn check_gen(gen: &str) -> Result<(), HelperError> {
    if gen.is_empty() || gen.len() > 32 || !gen.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-') {
        return Err(HelperError::new("bad-request", "gen must be 1-32 of [a-z0-9-]"));
    }
    Ok(())
}

fn key_name(gen: &str) -> Vec<u16> {
    crate::win::wide(&format!("gnomon-{gen}-approvals"))
}

fn provider() -> Result<Prov, HelperError> {
    let mut p: NCRYPT_PROV_HANDLE = 0;
    let s = unsafe { NCryptOpenStorageProvider(&mut p, MS_KEY_STORAGE_PROVIDER, 0) };
    if s != 0 {
        return Err(st("NCryptOpenStorageProvider", s));
    }
    Ok(Prov(p))
}

fn open(gen: &str) -> Result<(Prov, Key), HelperError> {
    let prov = provider()?;
    let name = key_name(gen);
    let mut k: NCRYPT_KEY_HANDLE = 0;
    let s = unsafe { NCryptOpenKey(prov.0, &mut k, name.as_ptr(), 0, NCRYPT_SILENT_FLAG) };
    if s == NTE_BAD_KEYSET {
        return Err(HelperError::new("not-found", "no approvals key of this gen"));
    }
    if s != 0 {
        return Err(st("NCryptOpenKey", s));
    }
    Ok((prov, Key(k)))
}

/// The key's public point as X9.63 uncompressed (0x04 ‖ X ‖ Y), 65 bytes.
fn public_x963(k: &Key) -> Result<Vec<u8>, HelperError> {
    unsafe {
        let mut len = 0u32;
        let s = NCryptExportKey(k.0, 0, BCRYPT_ECCPUBLIC_BLOB, null(), null_mut(), 0, &mut len, 0);
        if s != 0 {
            return Err(st("NCryptExportKey(size)", s));
        }
        let mut buf = vec![0u8; len as usize];
        let s = NCryptExportKey(k.0, 0, BCRYPT_ECCPUBLIC_BLOB, null(), buf.as_mut_ptr(), len, &mut len, 0);
        if s != 0 {
            return Err(st("NCryptExportKey", s));
        }
        let hdr = std::mem::size_of::<BCRYPT_ECCKEY_BLOB>();
        let cb = (*(buf.as_ptr() as *const BCRYPT_ECCKEY_BLOB)).cbKey as usize;
        if cb != 32 || buf.len() < hdr + 64 {
            return Err(HelperError::new("os-error", "the approvals key is not P-256"));
        }
        let mut out = Vec::with_capacity(65);
        out.push(0x04);
        out.extend_from_slice(&buf[hdr..hdr + 64]);
        Ok(out)
    }
}

/// Create the approvals key of `gen` (refused `exists` when it is already there); its public point.
pub fn create(gen: &str) -> Result<Vec<u8>, HelperError> {
    check_gen(gen)?;
    let prov = provider()?;
    let name = key_name(gen);
    let mut k: NCRYPT_KEY_HANDLE = 0;
    let s = unsafe { NCryptCreatePersistedKey(prov.0, &mut k, BCRYPT_ECDSA_P256_ALGORITHM, name.as_ptr(), 0, 0) };
    if s == NTE_EXISTS {
        return Err(HelperError::new("exists", "an approvals key of this gen exists"));
    }
    if s != 0 {
        return Err(st("NCryptCreatePersistedKey", s));
    }
    let k = Key(k);
    // default export policy: not exportable (the private key never leaves the KSP)
    let s = unsafe { NCryptFinalizeKey(k.0, NCRYPT_SILENT_FLAG) };
    if s != 0 {
        return Err(st("NCryptFinalizeKey", s));
    }
    public_x963(&k)
}

pub fn public(gen: &str) -> Result<Vec<u8>, HelperError> {
    check_gen(gen)?;
    let (_p, k) = open(gen)?;
    public_x963(&k)
}

fn sha256(m: &[u8]) -> Result<[u8; 32], HelperError> {
    let mut out = [0u8; 32];
    let s = unsafe { BCryptHash(BCRYPT_SHA256_ALG_HANDLE, null(), 0, m.as_ptr(), m.len() as u32, out.as_mut_ptr(), 32) };
    if s != 0 {
        return Err(st("BCryptHash", s));
    }
    Ok(out)
}

/// IEEE P1363 r ‖ s (64 bytes) → DER ECDSA-Sig-Value (the darwin helper's wire format).
pub fn p1363_to_der(sig: &[u8]) -> Vec<u8> {
    fn int(v: &[u8]) -> Vec<u8> {
        let mut i = 0;
        while i < v.len() - 1 && v[i] == 0 {
            i += 1;
        }
        let mut b = v[i..].to_vec();
        if b[0] & 0x80 != 0 {
            b.insert(0, 0);
        }
        let mut out = vec![0x02, b.len() as u8];
        out.extend(b);
        out
    }
    let (r, s) = sig.split_at(sig.len() / 2);
    let body: Vec<u8> = [int(r), int(s)].concat();
    let mut out = vec![0x30, body.len() as u8];
    out.extend(body);
    out
}

/// The one signature domain a click may sign: an approval decision (signer.ts `approve`). Never approve-voice,
/// presence or event (the darwin helper's no-prompt rule, G-BRK-06): a future voice or presence verifier can never be
/// handed a click signature.
pub const CLICK_DOMAIN: &[u8] = b"gnomon:approve:v1\n";

/// Sign each message (SHA-256, ECDSA P-256) with the approvals key of `gen`; DER signatures.
pub fn sign_click(gen: &str, messages: &[Vec<u8>]) -> Result<Vec<Vec<u8>>, HelperError> {
    check_gen(gen)?;
    if messages.is_empty() || messages.len() > MAX_MESSAGES || messages.iter().any(|m| m.is_empty() || m.len() > MAX_MESSAGE_BYTES) {
        return Err(HelperError::new("bad-request", "messages: 1-4 non-empty, each at most 64 KiB"));
    }
    if messages.iter().any(|m| !m.starts_with(CLICK_DOMAIN)) {
        return Err(HelperError::new("domain-refused", "a click signs approval decisions only"));
    }
    let (_p, k) = open(gen)?;
    let mut out = Vec::with_capacity(messages.len());
    for m in messages {
        let h = sha256(m)?;
        unsafe {
            let mut len = 0u32;
            let s = NCryptSignHash(k.0, null::<c_void>(), h.as_ptr(), 32, null_mut(), 0, &mut len, NCRYPT_SILENT_FLAG);
            if s != 0 {
                return Err(st("NCryptSignHash(size)", s));
            }
            let mut sig = vec![0u8; len as usize];
            let s = NCryptSignHash(k.0, null::<c_void>(), h.as_ptr(), 32, sig.as_mut_ptr(), len, &mut len, NCRYPT_SILENT_FLAG);
            if s != 0 || len != 64 {
                return Err(st("NCryptSignHash", s));
            }
            out.push(p1363_to_der(&sig[..64]));
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::{check_gen, p1363_to_der};
    #[test]
    fn der_of_p1363_strips_zeros_and_pads_high_bits() {
        let mut sig = vec![0u8; 64];
        sig[31] = 1; // r = 1
        sig[32] = 0x80; // s = 0x80 00…00 (high bit: a 0x00 pad)
        let der = p1363_to_der(&sig);
        assert_eq!(&der[..5], &[0x30, 0x26, 0x02, 0x01, 0x01]);
        assert_eq!(&der[5..8], &[0x02, 0x21, 0x00]);
        assert_eq!(der.len(), 2 + 3 + 2 + 33);
    }
    #[test]
    fn a_click_signs_the_approve_domain_only() {
        // refused before any key is opened (the gen has no key: a domain check that ran later would say not-found)
        for m in [&b"gnomon:approve-voice:v1\nx"[..], b"gnomon:presence:v1\nx", b"gnomon:event:v1\nx", b"anything"] {
            let e = super::sign_click("no-such-gen", &[m.to_vec()]).unwrap_err();
            assert_eq!(e.code, "domain-refused", "{}", String::from_utf8_lossy(m));
        }
        let e = super::sign_click("no-such-gen", &[b"gnomon:approve:v1\nx".to_vec(), b"gnomon:presence:v1\nx".to_vec()]).unwrap_err();
        assert_eq!(e.code, "domain-refused");
    }
    #[test]
    fn gens_are_bounded_lowercase() {
        assert!(check_gen("g1").is_ok());
        assert!(check_gen("dev-2026").is_ok());
        for bad in ["", "G1", "a b", "a/b", "../x", &"a".repeat(33)] {
            assert!(check_gen(bad).is_err(), "{bad}");
        }
    }
}
