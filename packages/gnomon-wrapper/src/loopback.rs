//! #gnomon-wrapper native preflight (spec §11.1; G-GUI-12): before the WebView is
//! allowed to navigate to the kernel origin, the wrapper itself
//!   1. checks the channel's bundleHash against its compiled pin,
//!   2. opens its own WebSocket to `ws://127.0.0.1:<port>/rpc` (with the exact
//!      §11.2 rule 3–5 headers), sends `hello` with `client.surface: 'wrapper'`
//!      and a fresh clientNonce, and verifies `serverSig` against the kernel
//!      key from the channel (verify.rs) — the listener on the port is THIS
//!      kernel, closing the port-reuse-after-restart hole (S25-M4);
//!   3. GETs every pinned bundle file and `/` and re-hashes them (bundle.rs).
//! It never sends `auth` and never holds the launch token on this socket: the
//! page exchanges the token itself. Any failure leaves the window on the
//! status page with the error (fail closed).
//! Minimal HTTP/1.1 + RFC 6455 client over std TcpStream: loopback only, one
//! text frame out (masked), frames in until the hello answer, 4 MiB cap.
use std::io::{Read, Write};
use std::net::{Ipv4Addr, SocketAddrV4, TcpStream};
use std::time::Duration;

use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use base64::Engine;
use serde_json::{json, Value};

use crate::bundle::{self, BundleError};
use crate::verify::{self, Hello, SigError};

const IO_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_BYTES: usize = 4 << 20;

#[derive(Debug, PartialEq, Eq)]
pub enum PreflightError {
    Io(String),
    Protocol(&'static str),
    Sig(SigError),
    Bundle(BundleError),
}

impl std::fmt::Display for PreflightError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PreflightError::Io(m) => write!(f, "the kernel's port did not answer: {m}"),
            PreflightError::Protocol(m) => write!(f, "the kernel's port answered out of protocol: {m}"),
            PreflightError::Sig(e) => write!(f, "{e}; the page was not opened"),
            PreflightError::Bundle(e) => write!(f, "{e}; the page was not opened"),
        }
    }
}

fn connect(port: u16) -> Result<TcpStream, PreflightError> {
    let s = TcpStream::connect_timeout(&SocketAddrV4::new(Ipv4Addr::LOCALHOST, port).into(), IO_TIMEOUT).map_err(|e| PreflightError::Io(e.kind().to_string()))?;
    s.set_read_timeout(Some(IO_TIMEOUT)).ok();
    s.set_write_timeout(Some(IO_TIMEOUT)).ok();
    Ok(s)
}

fn read_head(s: &mut TcpStream, buf: &mut Vec<u8>) -> Result<usize, PreflightError> {
    let mut chunk = [0u8; 4096];
    loop {
        if let Some(i) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            return Ok(i + 4);
        }
        if buf.len() > 64 * 1024 {
            return Err(PreflightError::Protocol("response head too large"));
        }
        let n = s.read(&mut chunk).map_err(|e| PreflightError::Io(e.kind().to_string()))?;
        if n == 0 {
            return Err(PreflightError::Protocol("connection closed before the response head"));
        }
        buf.extend_from_slice(&chunk[..n]);
    }
}

fn header<'a>(head: &'a str, name: &str) -> Option<&'a str> {
    head.lines().skip(1).find_map(|l| {
        let (k, v) = l.split_once(':')?;
        k.trim().eq_ignore_ascii_case(name).then(|| v.trim())
    })
}

/// GET a static path; returns the body of a 200.
pub fn http_get(port: u16, path: &str) -> Result<Vec<u8>, PreflightError> {
    http_get_with_head(port, path).map(|(_, b)| b)
}

/// GET a static path; returns the response head and the body of a 200.
pub fn http_get_with_head(port: u16, path: &str) -> Result<(String, Vec<u8>), PreflightError> {
    let mut s = connect(port)?;
    let req = format!("GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\nAccept-Encoding: identity\r\n\r\n");
    s.write_all(req.as_bytes()).map_err(|e| PreflightError::Io(e.kind().to_string()))?;
    let mut buf = Vec::new();
    let end = read_head(&mut s, &mut buf)?;
    let head = String::from_utf8_lossy(&buf[..end]).to_string();
    if !head.starts_with("HTTP/1.1 200") {
        return Err(PreflightError::Protocol("a pinned bundle file was not served (non-200)"));
    }
    let mut body = buf[end..].to_vec();
    let mut chunk = [0u8; 16384];
    loop {
        let n = s.read(&mut chunk).map_err(|e| PreflightError::Io(e.kind().to_string()))?;
        if n == 0 {
            break;
        }
        body.extend_from_slice(&chunk[..n]);
        if body.len() > MAX_BYTES * 16 {
            return Err(PreflightError::Protocol("bundle file too large"));
        }
    }
    if header(&head, "transfer-encoding").is_some_and(|v| v.eq_ignore_ascii_case("chunked")) {
        body = dechunk(&body)?;
    } else if let Some(len) = header(&head, "content-length").and_then(|v| v.parse::<usize>().ok()) {
        if body.len() != len {
            return Err(PreflightError::Protocol("short body"));
        }
    }
    Ok((head, body))
}

fn dechunk(mut b: &[u8]) -> Result<Vec<u8>, PreflightError> {
    let mut out = Vec::new();
    loop {
        let i = b.windows(2).position(|w| w == b"\r\n").ok_or(PreflightError::Protocol("bad chunk"))?;
        let size_line = std::str::from_utf8(&b[..i]).map_err(|_| PreflightError::Protocol("bad chunk"))?;
        let size = usize::from_str_radix(size_line.split(';').next().unwrap_or("").trim(), 16).map_err(|_| PreflightError::Protocol("bad chunk"))?;
        b = &b[i + 2..];
        if size == 0 {
            return Ok(out);
        }
        if b.len() < size + 2 {
            return Err(PreflightError::Protocol("bad chunk"));
        }
        out.extend_from_slice(&b[..size]);
        b = &b[size + 2..];
    }
}

fn random<const N: usize>() -> [u8; N] {
    let mut b = [0u8; N];
    getrandom::fill(&mut b).expect("the OS random source");
    b
}

fn ws_send_text(s: &mut TcpStream, payload: &[u8]) -> Result<(), PreflightError> {
    let mut f = vec![0x81u8];
    let len = payload.len();
    if len < 126 {
        f.push(0x80 | len as u8);
    } else if len <= 0xffff {
        f.push(0x80 | 126);
        f.extend_from_slice(&(len as u16).to_be_bytes());
    } else {
        f.push(0x80 | 127);
        f.extend_from_slice(&(len as u64).to_be_bytes());
    }
    let mask: [u8; 4] = random();
    f.extend_from_slice(&mask);
    f.extend(payload.iter().enumerate().map(|(i, b)| b ^ mask[i % 4]));
    s.write_all(&f).map_err(|e| PreflightError::Io(e.kind().to_string()))
}

/// Read frames until one complete text message.
fn ws_read_text(s: &mut TcpStream, pending: &mut Vec<u8>) -> Result<String, PreflightError> {
    let mut msg = Vec::new();
    let mut chunk = [0u8; 16384];
    loop {
        // parse one frame from pending, reading more as needed
        let need = |p: &Vec<u8>, n: usize| p.len() < n;
        let fill = |s: &mut TcpStream, p: &mut Vec<u8>, chunk: &mut [u8]| -> Result<(), PreflightError> {
            let n = s.read(chunk).map_err(|e| PreflightError::Io(e.kind().to_string()))?;
            if n == 0 {
                return Err(PreflightError::Protocol("the socket closed before hello answered"));
            }
            p.extend_from_slice(&chunk[..n]);
            Ok(())
        };
        while need(pending, 2) {
            fill(s, pending, &mut chunk)?;
        }
        let (b0, b1) = (pending[0], pending[1]);
        if b1 & 0x80 != 0 {
            return Err(PreflightError::Protocol("a server frame was masked"));
        }
        let mut off = 2usize;
        let mut len = (b1 & 0x7f) as usize;
        if len == 126 {
            while need(pending, 4) {
                fill(s, pending, &mut chunk)?;
            }
            len = u16::from_be_bytes([pending[2], pending[3]]) as usize;
            off = 4;
        } else if len == 127 {
            while need(pending, 10) {
                fill(s, pending, &mut chunk)?;
            }
            let mut l = [0u8; 8];
            l.copy_from_slice(&pending[2..10]);
            len = u64::from_be_bytes(l) as usize;
            off = 10;
        }
        if len > MAX_BYTES || msg.len() + len > MAX_BYTES {
            return Err(PreflightError::Protocol("frame over the 4 MiB cap"));
        }
        while need(pending, off + len) {
            fill(s, pending, &mut chunk)?;
        }
        let payload: Vec<u8> = pending[off..off + len].to_vec();
        pending.drain(..off + len);
        match b0 & 0x0f {
            0x8 => return Err(PreflightError::Protocol("the kernel closed the socket")),
            0x9 | 0xA => continue, // ping / pong: the socket is about to close anyway
            0x1 | 0x0 => {
                msg.extend_from_slice(&payload);
                if b0 & 0x80 != 0 {
                    return String::from_utf8(msg).map_err(|_| PreflightError::Protocol("a text frame was not UTF-8"));
                }
            }
            _ => return Err(PreflightError::Protocol("unexpected frame opcode")),
        }
    }
}

/// The wrapper's own hello on the kernel's endpoint; returns the hello result and the clientNonce sent.
pub fn ws_hello(port: u16) -> Result<(Hello, String), PreflightError> {
    ws_hello_api(port, "gnomon-rpc:v1")
}

/// The wrapper's hello speaking `api` (`gnomon-rpc:v1` on the kernel, `gnomon-setup:v1` on the #setup-endpoint).
pub fn ws_hello_api(port: u16, api: &str) -> Result<(Hello, String), PreflightError> {
    let mut s = connect(port)?;
    let key = STANDARD.encode(random::<16>());
    let req = format!(
        "GET /rpc HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\nOrigin: http://127.0.0.1:{port}\r\nSec-Fetch-Site: same-origin\r\n\r\n"
    );
    s.write_all(req.as_bytes()).map_err(|e| PreflightError::Io(e.kind().to_string()))?;
    let mut buf = Vec::new();
    let end = read_head(&mut s, &mut buf)?;
    if !buf.starts_with(b"HTTP/1.1 101") {
        return Err(PreflightError::Protocol("the endpoint refused the WebSocket upgrade"));
    }
    let mut pending = buf[end..].to_vec();
    let client_nonce = URL_SAFE_NO_PAD.encode(random::<32>());
    let hello = json!({
        "jsonrpc": "2.0", "rpc": "gnomon-rpc:v1", "id": 1, "method": "hello",
        "params": { "clientApis": [api], "features": [], "clientNonce": client_nonce,
                    "client": { "name": "gnomon-wrapper", "version": env!("CARGO_PKG_VERSION"), "surface": "wrapper" } }
    });
    ws_send_text(&mut s, hello.to_string().as_bytes())?;
    let v: Value = loop {
        let t = ws_read_text(&mut s, &mut pending)?;
        let v: Value = serde_json::from_str(&t).map_err(|_| PreflightError::Protocol("a frame was not JSON"))?;
        if v.get("id").and_then(Value::as_u64) == Some(1) {
            break v;
        }
    };
    // close politely (status 1000); errors here do not matter
    let _ = s.write_all(&[0x88, 0x82, 0, 0, 0, 0, 0x03, 0xe8]);
    let r = v.get("result").ok_or(PreflightError::Protocol("hello was refused"))?;
    let st = |k: &str| r.get(k).and_then(Value::as_str).map(str::to_string).ok_or(PreflightError::Protocol("hello result is missing a field"));
    let features = r.get("features").and_then(Value::as_array).ok_or(PreflightError::Protocol("hello result has no features"))?.iter().map(|f| f.as_str().map(str::to_string).ok_or(PreflightError::Protocol("a feature is not a string"))).collect::<Result<Vec<_>, _>>()?;
    Ok((Hello { nonce: st("nonce")?, client_nonce: st("clientNonce")?, server_key_id: st("serverKeyId")?, server_sig: st("serverSig")?, client_api: st("clientApi")?, features }, client_nonce))
}

/// The whole preflight for a launch grant (port, kernel key, bundle hash); Ok means the page may load.
pub fn preflight(port: u16, kernel_public_key: &str, bundle_hash: &str, pin: &str) -> Result<(), PreflightError> {
    preflight_api(port, kernel_public_key, bundle_hash, pin, "gnomon-rpc:v1")
}

/// #setup-endpoint: the SAME pin and serverSig checks against the ephemeral setup key, speaking gnomon-setup:v1.
/// Ok means the setup page may load (its digests are then trustworthy in this window: bundle and key verified natively).
pub fn setup_preflight(port: u16, setup_public_key: &str, bundle_hash: &str, pin: &str) -> Result<(), PreflightError> {
    preflight_api(port, setup_public_key, bundle_hash, pin, "gnomon-setup:v1")
}

fn preflight_api(port: u16, kernel_public_key: &str, bundle_hash: &str, pin: &str, api: &str) -> Result<(), PreflightError> {
    bundle::check_reported(bundle_hash, pin).map_err(PreflightError::Bundle)?;
    let (hello, sent) = ws_hello_api(port, api)?;
    if hello.client_api != api {
        return Err(PreflightError::Protocol("the endpoint answered another protocol"));
    }
    verify::verify_server_sig(kernel_public_key, &hello, &format!("ws://127.0.0.1:{port}/rpc"), &sent).map_err(PreflightError::Sig)?;
    let mut served = Vec::new();
    for name in bundle::pin_files() {
        served.push((name.clone(), http_get(port, &format!("/{name}"))?));
    }
    let root = http_get(port, "/")?;
    bundle::check_served(&served, &root, pin).map_err(PreflightError::Bundle)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dechunk_reassembles_and_refuses_garbage() {
        assert_eq!(dechunk(b"3\r\nabc\r\n2\r\nde\r\n0\r\n\r\n").unwrap(), b"abcde");
        assert!(dechunk(b"zz\r\nabc").is_err());
        assert!(dechunk(b"5\r\nab").is_err());
    }

    #[test]
    fn a_closed_port_fails_closed() {
        // bind then drop: the port is (almost certainly) closed now
        let p = std::net::TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
        assert!(matches!(preflight(p, "k", bundle::PIN, bundle::PIN), Err(PreflightError::Io(_))));
    }

    #[test]
    fn setup_preflight_fails_closed_like_the_launch_path() {
        let p = std::net::TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
        assert!(matches!(setup_preflight(p, "k", bundle::PIN, bundle::PIN), Err(PreflightError::Io(_))));
        let other = format!("sha256:{}", "1".repeat(64));
        assert_eq!(setup_preflight(1, "k", &other, bundle::PIN), Err(PreflightError::Bundle(BundleError::PinMismatch)));
    }

    #[test]
    fn falsifier_a_pin_mismatch_refuses_before_any_connection() {
        let other = format!("sha256:{}", "1".repeat(64));
        assert_eq!(preflight(1, "k", &other, bundle::PIN), Err(PreflightError::Bundle(BundleError::PinMismatch)));
    }
}
