//! #gnomon-wrapper bundle pin (spec §11.2 rule 1a, `G-WEB-08`; M1.13 "bundle hash on
//! stdin"). Two checks, both fail closed:
//!   1. the `bundleHash` the kernel reports on the launch channel must equal the
//!      pin compiled into THIS (signed) wrapper — the GUI bundle the wrapper was
//!      built to host ([`PIN`], from packages/gnomon/src/kernel/web/gui-bundle.ts);
//!   2. the bytes the port actually SERVES for every pinned file re-hash
//!      (gnomon-bundle-tree:v1) to that pin, and `/` serves `index.html` — the
//!      page the WebView will load is the pinned page.
use sha2::{Digest, Sha256};

use crate::verify::hex;

pub const TREE_DOMAIN: &str = "gnomon-bundle-tree:v1";
/// The pinned #gui bundle hash (build.rs).
pub const PIN: &str = env!("GNOMON_GUI_BUNDLE_HASH");
/// The pinned bundle's file names, comma-separated (build.rs).
pub const PIN_FILES: &str = env!("GNOMON_GUI_BUNDLE_FILES");

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BundleError {
    /// the kernel serves another GUI than the one this wrapper was built for
    PinMismatch,
    /// the served bytes do not hash to the pin
    ServedMismatch,
    /// `/` is not the pinned index.html
    IndexMismatch,
    UnsafeName(String),
}

impl std::fmt::Display for BundleError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            BundleError::PinMismatch => f.write_str("the kernel serves a GUI bundle this app was not built for (bundle hash differs from the app's pin); rebuild Gnomon.app from the same checkout"),
            BundleError::ServedMismatch => f.write_str("the page served on the port does not hash to the pinned GUI bundle"),
            BundleError::IndexMismatch => f.write_str("the port serves a different page at / than the pinned index.html"),
            BundleError::UnsafeName(n) => write!(f, "unsafe bundle file name {n:?}"),
        }
    }
}

pub fn pin_files() -> Vec<String> {
    PIN_FILES.split(',').filter(|s| !s.is_empty()).map(str::to_string).collect()
}

fn safe_name(n: &str) -> bool {
    !n.is_empty() && n.bytes().all(|b| b.is_ascii_alphanumeric() || b"._@+-/".contains(&b)) && n.split('/').all(|s| !s.is_empty() && s != "." && s != "..")
}

/// gnomon-bundle-tree:v1 over (name, bytes): names sorted by UTF-8 bytes, `<name>\0<sha256 hex>\n` per file.
pub fn tree_hash(files: &[(String, Vec<u8>)]) -> Result<String, BundleError> {
    let mut v: Vec<&(String, Vec<u8>)> = files.iter().collect();
    v.sort_by(|a, b| a.0.as_bytes().cmp(b.0.as_bytes()));
    let mut h = Sha256::new();
    h.update(format!("{TREE_DOMAIN}\n").as_bytes());
    for (n, b) in v {
        if !safe_name(n) {
            return Err(BundleError::UnsafeName(n.clone()));
        }
        h.update(format!("{n}\0{}\n", hex(&Sha256::digest(b))).as_bytes());
    }
    Ok(format!("sha256:{}", hex(&h.finalize())))
}

/// Check 1: the channel's bundleHash against the compiled pin.
pub fn check_reported(bundle_hash: &str, pin: &str) -> Result<(), BundleError> {
    if bundle_hash == pin {
        Ok(())
    } else {
        Err(BundleError::PinMismatch)
    }
}

/// Check 2: what the port served (every pinned file, plus `/`) against the pin.
pub fn check_served(served: &[(String, Vec<u8>)], root: &[u8], pin: &str) -> Result<(), BundleError> {
    if tree_hash(served)? != pin {
        return Err(BundleError::ServedMismatch);
    }
    match served.iter().find(|(n, _)| n == "index.html") {
        Some((_, b)) if b.as_slice() == root => Ok(()),
        _ => Err(BundleError::IndexMismatch),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::engine::general_purpose::STANDARD;
    use base64::Engine;
    use serde_json::Value;

    fn vector() -> (Vec<(String, Vec<u8>)>, String) {
        let v: Value = serde_json::from_str(include_str!("../test/fixtures/vectors-v1.json")).unwrap();
        let files = v["bundle"]["files"].as_array().unwrap().iter().map(|f| (f["name"].as_str().unwrap().to_string(), STANDARD.decode(f["b64"].as_str().unwrap()).unwrap())).collect();
        (files, v["bundle"]["hash"].as_str().unwrap().to_string())
    }

    #[test]
    fn the_tree_hash_matches_the_kernel_definition() {
        let (files, hash) = vector();
        assert_eq!(tree_hash(&files).unwrap(), hash);
    }

    #[test]
    fn the_compiled_pin_is_the_kernel_gui_bundle_hash() {
        assert!(PIN.starts_with("sha256:") && PIN.len() == 71);
        let names = pin_files();
        assert!(names.iter().any(|n| n == "index.html"));
        let src = include_str!("../../gnomon/src/kernel/web/gui-bundle.ts");
        assert!(src.contains(&format!("export const GUI_BUNDLE_HASH = \"{PIN}\";")));
    }

    #[test]
    fn falsifier_a_reported_hash_other_than_the_pin_is_refused() {
        assert_eq!(check_reported(PIN, PIN), Ok(()));
        let other = format!("sha256:{}", "0".repeat(64));
        assert_eq!(check_reported(&other, PIN), Err(BundleError::PinMismatch));
        assert_eq!(check_reported("", PIN), Err(BundleError::PinMismatch));
    }

    #[test]
    fn falsifier_served_bytes_that_differ_from_the_pin_are_refused() {
        let (files, hash) = vector();
        let index = files.iter().find(|(n, _)| n == "index.html").unwrap().1.clone();
        assert_eq!(check_served(&files, &index, &hash), Ok(()));
        let mut tampered = files.clone();
        tampered[1].1.push(b'x');
        assert_eq!(check_served(&tampered, &index, &hash), Err(BundleError::ServedMismatch));
        assert_eq!(check_served(&files, b"<p>other page</p>", &hash), Err(BundleError::IndexMismatch));
        let missing: Vec<_> = files.iter().skip(1).cloned().collect();
        assert_eq!(check_served(&missing, &index, &hash), Err(BundleError::ServedMismatch));
    }

    #[test]
    fn unsafe_names_do_not_hash() {
        for n in ["../x", "a//b", "", "a\\b", "./a"] {
            assert!(tree_hash(&[(n.to_string(), vec![])]).is_err(), "{n}");
        }
    }
}
