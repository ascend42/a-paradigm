//! #gnomon-wrapper native `serverSig` check (spec §4.9 mutual auth, §11.1 "verifies
//! `serverSig` natively with the key from stdin and refuses to render on a
//! mismatch", S25-M4; G-GUI-12 "the wrapper renders on a forged `serverSig`").
//!
//! The same three checks the page makes (packages/gnomon-gui/src/core/server-sig.ts),
//! in Rust, against the kernel key the wrapper received on its private channel:
//!   1. the echoed `clientNonce` equals the one THIS client sent, and the
//!      signature is checked over the SENT value (a hello recorded on another
//!      connection and replayed from a squatted port fails);
//!   2. `serverKeyId` names the channel key: `gkey:v1:` + sha256 of the key's
//!      normalized SPKI PEM (the kernel's ed25519KeyId);
//!   3. Ed25519 over `gnomon:auth-server:v2\n<nonce>\n<clientNonce>\n<endpointPath>\n<clientApi>\n<canonical features>`
//!      (gnomon-contracts authServerPreimage), strict verification.
//! Any failure is a refusal; there is no "skip".
use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use base64::Engine;
use ed25519_dalek::{Signature, VerifyingKey};
use sha2::{Digest, Sha256};

pub const AUTH_SERVER_DOMAIN: &str = "gnomon:auth-server:v2";
/// DER prefix of an Ed25519 SubjectPublicKeyInfo (RFC 8410): SEQUENCE{SEQUENCE{OID 1.3.101.112}, BIT STRING(32 bytes)}.
const ED25519_SPKI_PREFIX: [u8; 12] = [0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00];

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SigError {
    BadKey,
    KeyIdMismatch,
    ClientNonceMismatch,
    BadServerSig,
}

impl std::fmt::Display for SigError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            SigError::BadKey => "the kernel public key from the launch channel is not an Ed25519 SPKI key",
            SigError::KeyIdMismatch => "the listener on this port signs with another kernel key",
            SigError::ClientNonceMismatch => "the listener answered another connection's hello",
            SigError::BadServerSig => "the listener's serverSig does not verify against the kernel key",
        })
    }
}

/// The negotiated hello fields the signature binds.
#[derive(Debug, Clone)]
pub struct Hello {
    pub nonce: String,
    pub client_nonce: String,
    pub server_key_id: String,
    pub server_sig: String,
    pub client_api: String,
    pub features: Vec<String>,
}

/// Parse a base64url SPKI into the 32-byte Ed25519 key (exact DER shape only).
pub fn spki_key(spki_b64url: &str) -> Result<[u8; 32], SigError> {
    let der = URL_SAFE_NO_PAD.decode(spki_b64url.trim_end_matches('=')).map_err(|_| SigError::BadKey)?;
    if der.len() != 44 || der[..12] != ED25519_SPKI_PREFIX {
        return Err(SigError::BadKey);
    }
    let mut k = [0u8; 32];
    k.copy_from_slice(&der[12..]);
    Ok(k)
}

/// The kernel's keyId for an Ed25519 SPKI: sha256 of the normalized PEM (64-col base64 body, no trailing newline).
pub fn key_id_of_spki(spki_b64url: &str) -> Result<String, SigError> {
    let der = URL_SAFE_NO_PAD.decode(spki_b64url.trim_end_matches('=')).map_err(|_| SigError::BadKey)?;
    let body = STANDARD.encode(&der);
    let lines: Vec<&str> = body.as_bytes().chunks(64).map(|c| std::str::from_utf8(c).unwrap()).collect();
    let pem = format!("-----BEGIN PUBLIC KEY-----\n{}\n-----END PUBLIC KEY-----", lines.join("\n"));
    let d = Sha256::digest(pem.as_bytes());
    Ok(format!("gkey:v1:{}", hex(&d)))
}

pub fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

/// gnomon-contracts canonicalJson for a string array (JSON.stringify per element, no whitespace).
pub fn canonical_string_array(v: &[String]) -> String {
    let parts: Vec<String> = v.iter().map(|s| serde_json::to_string(s).expect("a string serializes")).collect();
    format!("[{}]", parts.join(","))
}

/// gnomon-contracts authServerPreimage.
pub fn server_preimage(nonce: &str, client_nonce: &str, endpoint_path: &str, client_api: &str, features: &[String]) -> String {
    format!("{AUTH_SERVER_DOMAIN}\n{nonce}\n{client_nonce}\n{endpoint_path}\n{client_api}\n{}", canonical_string_array(features))
}

/// Verify a hello answer against the channel key, for the clientNonce this client SENT.
pub fn verify_server_sig(spki_b64url: &str, hello: &Hello, endpoint_path: &str, sent_client_nonce: &str) -> Result<(), SigError> {
    if hello.client_nonce != sent_client_nonce {
        return Err(SigError::ClientNonceMismatch);
    }
    let raw = spki_key(spki_b64url)?;
    if key_id_of_spki(spki_b64url)? != hello.server_key_id {
        return Err(SigError::KeyIdMismatch);
    }
    let key = VerifyingKey::from_bytes(&raw).map_err(|_| SigError::BadKey)?;
    let sig_bytes = STANDARD.decode(&hello.server_sig).map_err(|_| SigError::BadServerSig)?;
    let sig = Signature::from_slice(&sig_bytes).map_err(|_| SigError::BadServerSig)?;
    let msg = server_preimage(&hello.nonce, sent_client_nonce, endpoint_path, &hello.client_api, &hello.features);
    key.verify_strict(msg.as_bytes(), &sig).map_err(|_| SigError::BadServerSig)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    fn vectors() -> Value {
        serde_json::from_str(include_str!("../test/fixtures/vectors-v1.json")).unwrap()
    }

    fn hello_of(v: &Value) -> Hello {
        Hello {
            nonce: v["nonce"].as_str().unwrap().into(),
            client_nonce: v["clientNonce"].as_str().unwrap().into(),
            server_key_id: v["serverKeyId"].as_str().unwrap().into(),
            server_sig: v["serverSig"].as_str().unwrap().into(),
            client_api: v["clientApi"].as_str().unwrap().into(),
            features: v["features"].as_array().unwrap().iter().map(|f| f.as_str().unwrap().to_string()).collect(),
        }
    }

    #[test]
    fn key_id_and_preimage_match_the_typescript_definitions() {
        let v = vectors();
        let k = v["kernelPublicKey"].as_str().unwrap();
        assert_eq!(key_id_of_spki(k).unwrap(), v["keyId"].as_str().unwrap());
        for h in v["hello"].as_array().unwrap() {
            let x = hello_of(h);
            assert_eq!(server_preimage(&x.nonce, &x.client_nonce, h["endpointPath"].as_str().unwrap(), &x.client_api, &x.features), h["preimage"].as_str().unwrap());
        }
    }

    #[test]
    fn a_genuine_hello_verifies() {
        let v = vectors();
        let k = v["kernelPublicKey"].as_str().unwrap();
        for h in v["hello"].as_array().unwrap() {
            let x = hello_of(h);
            assert_eq!(verify_server_sig(k, &x, h["endpointPath"].as_str().unwrap(), &x.client_nonce.clone()), Ok(()));
        }
    }

    #[test]
    fn falsifier_a_forged_or_foreign_server_sig_is_refused() {
        let v = vectors();
        let k = v["kernelPublicKey"].as_str().unwrap();
        let h = &v["hello"][0];
        let ep = h["endpointPath"].as_str().unwrap();
        let good = hello_of(h);
        // one flipped signature bit
        let mut sig = STANDARD.decode(&good.server_sig).unwrap();
        sig[10] ^= 1;
        let forged = Hello { server_sig: STANDARD.encode(&sig), ..good.clone() };
        assert_eq!(verify_server_sig(k, &forged, ep, &good.client_nonce), Err(SigError::BadServerSig));
        // a garbage signature
        let junk = Hello { server_sig: "not base64!".into(), ..good.clone() };
        assert_eq!(verify_server_sig(k, &junk, ep, &good.client_nonce), Err(SigError::BadServerSig));
        // the hello of another endpoint (port reuse after restart)
        assert_eq!(verify_server_sig(k, &good, "ws://127.0.0.1:49153/rpc", &good.client_nonce), Err(SigError::BadServerSig));
        // a downgraded feature set
        let down = Hello { features: vec!["log.follow".into()], ..hello_of(&v["hello"][1]) };
        assert_eq!(verify_server_sig(k, &down, ep, &down.client_nonce.clone()), Err(SigError::BadServerSig));
        // the signature of a DIFFERENT key that the listener names honestly
        let other_key = "MCowBQYDK2VwAyEAGb9ECWmEzf6FQbrBZ9w7lshQhqowtrbLDFw4rXAxZuE";
        assert_eq!(verify_server_sig(other_key, &good, ep, &good.client_nonce), Err(SigError::KeyIdMismatch));
    }

    #[test]
    fn falsifier_a_replayed_hello_fails_on_the_client_nonce() {
        let v = vectors();
        let h = &v["hello"][0];
        let x = hello_of(h);
        assert_eq!(verify_server_sig(v["kernelPublicKey"].as_str().unwrap(), &x, h["endpointPath"].as_str().unwrap(), "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"), Err(SigError::ClientNonceMismatch));
    }

    #[test]
    fn only_an_exact_ed25519_spki_is_a_key() {
        assert_eq!(spki_key("MCowBQYDK2VwAyEA"), Err(SigError::BadKey));
        assert_eq!(spki_key("!!"), Err(SigError::BadKey));
        // a P-256 SPKI prefix is not Ed25519
        assert_eq!(spki_key("MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE"), Err(SigError::BadKey));
        assert!(spki_key(vectors()["kernelPublicKey"].as_str().unwrap()).is_ok());
    }

    #[test]
    fn canonical_features_have_no_whitespace() {
        assert_eq!(canonical_string_array(&[]), "[]");
        assert_eq!(canonical_string_array(&["a".into(), "b\"c".into()]), r#"["a","b\"c"]"#);
    }
}
