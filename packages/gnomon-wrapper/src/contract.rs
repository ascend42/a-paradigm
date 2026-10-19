//! #gnomon-wrapper launch channel, wrapper side (`gnomon-wrapper-channel:v1`; the
//! child side is packages/gnomon/src/cli/launch-tty.ts serveWrapperChannel).
//! The kernel child writes one JSON object per line on its stdout pipe; the
//! wrapper writes `launch` / `quit` lines on its stdin. Every field of a
//! `launch` line is validated before use; a malformed line is refused, never
//! "best effort". [`LaunchGrant`]'s Debug never prints the token or the key.
use serde_json::Value;

pub struct LaunchGrant {
    pub port: u16,
    pub launch_token: String,
    pub kernel_public_key: String,
    pub bundle_hash: String,
}

impl std::fmt::Debug for LaunchGrant {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("LaunchGrant").field("port", &self.port).field("launch_token", &"<redacted>").field("kernel_public_key", &"<redacted>").field("bundle_hash", &self.bundle_hash).finish()
    }
}

impl LaunchGrant {
    /// The page URL (§11.2 rule 2): `http://127.0.0.1:<port>/#launch=<token>&k=<spki>`.
    pub fn url(&self) -> String {
        format!("http://127.0.0.1:{}/#launch={}&k={}", self.port, self.launch_token, self.kernel_public_key)
    }
}

#[derive(Debug)]
pub enum ChannelLine {
    Up,
    Launch(LaunchGrant),
    LaunchFailed { message: String },
    Refused { reason: String, message: String, next: Vec<String> },
    Down { reason: String },
}

fn b64url(s: &str, max: usize) -> bool {
    !s.is_empty() && s.len() <= max && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

fn bundle_hash(s: &str) -> bool {
    s.len() == 71 && s.starts_with("sha256:") && s[7..].bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn text(v: &Value, k: &str) -> String {
    v.get(k).and_then(Value::as_str).unwrap_or("").chars().take(4000).collect()
}

/// Parse one channel line. `Err` carries a reason that never includes the line itself.
pub fn parse_line(line: &str) -> Result<ChannelLine, &'static str> {
    if line.len() > 64 * 1024 {
        return Err("channel line too long");
    }
    let v: Value = serde_json::from_str(line).map_err(|_| "channel line is not JSON")?;
    if v.get("v").and_then(Value::as_u64) != Some(1) {
        return Err("not a gnomon-wrapper-channel:v1 line");
    }
    match v.get("t").and_then(Value::as_str) {
        Some("up") => Ok(ChannelLine::Up),
        Some("launch") => {
            let port = v.get("port").and_then(Value::as_u64).filter(|p| (1..=65535).contains(p)).ok_or("launch line: bad port")? as u16;
            let launch_token = v.get("launchToken").and_then(Value::as_str).filter(|s| b64url(s, 128)).ok_or("launch line: bad launchToken")?.to_string();
            let kernel_public_key = v.get("kernelPublicKey").and_then(Value::as_str).filter(|s| b64url(s, 256)).ok_or("launch line: bad kernelPublicKey")?.to_string();
            let bundle_hash = v.get("bundleHash").and_then(Value::as_str).filter(|s| bundle_hash(s)).ok_or("launch line: bad bundleHash")?.to_string();
            Ok(ChannelLine::Launch(LaunchGrant { port, launch_token, kernel_public_key, bundle_hash }))
        }
        Some("launch-failed") => Ok(ChannelLine::LaunchFailed { message: text(&v, "message") }),
        Some("refused") => Ok(ChannelLine::Refused {
            reason: text(&v, "reason"),
            message: text(&v, "message"),
            next: v.get("next").and_then(Value::as_array).map(|a| a.iter().filter_map(Value::as_str).take(8).map(|s| s.chars().take(400).collect()).collect()).unwrap_or_default(),
        }),
        Some("down") => Ok(ChannelLine::Down { reason: text(&v, "reason") }),
        _ => Err("unknown channel line"),
    }
}

/// The channel's line cap, enforced at READ time (never buffer more than this per line).
pub const MAX_LINE: usize = 64 * 1024;

#[derive(Debug, PartialEq, Eq)]
pub enum LineRead {
    /// one line (without its newline) in the buffer
    Line,
    /// a line longer than MAX_LINE: it was read and discarded up to its newline, never buffered whole
    TooLong,
    Eof,
}

/// Read one channel line into `buf`, holding at most MAX_LINE + 1 bytes of it.
pub fn read_line_capped<R: std::io::BufRead>(r: &mut R, buf: &mut Vec<u8>) -> std::io::Result<LineRead> {
    use std::io::{BufRead, Read};
    buf.clear();
    let n = r.by_ref().take(MAX_LINE as u64 + 1).read_until(b'\n', buf)?;
    if n == 0 {
        return Ok(LineRead::Eof);
    }
    if buf.last() == Some(&b'\n') {
        buf.pop();
        return Ok(LineRead::Line);
    }
    if buf.len() <= MAX_LINE {
        return Ok(LineRead::Line); // the last line, without a newline, before EOF
    }
    // over the cap: drain the rest of this line in bounded chunks
    loop {
        buf.clear();
        let n = r.by_ref().take(MAX_LINE as u64).read_until(b'\n', buf)?;
        if n == 0 || buf.last() == Some(&b'\n') {
            buf.clear();
            return Ok(LineRead::TooLong);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn falsifier_the_line_cap_holds_at_read_time() {
        let long = "x".repeat(MAX_LINE * 3);
        let input = format!("{{\"v\":1,\"t\":\"up\"}}\n{long}\n{{\"v\":1,\"t\":\"down\",\"reason\":\"signal\"}}\nlast");
        let mut r = std::io::BufReader::with_capacity(4096, input.as_bytes());
        let mut buf = Vec::new();
        assert_eq!(read_line_capped(&mut r, &mut buf).unwrap(), LineRead::Line);
        assert!(matches!(parse_line(std::str::from_utf8(&buf).unwrap()), Ok(ChannelLine::Up)));
        assert_eq!(read_line_capped(&mut r, &mut buf).unwrap(), LineRead::TooLong);
        assert!(buf.capacity() <= 2 * (MAX_LINE + 1), "never buffered the whole long line ({})", buf.capacity());
        assert_eq!(read_line_capped(&mut r, &mut buf).unwrap(), LineRead::Line);
        assert!(matches!(parse_line(std::str::from_utf8(&buf).unwrap()), Ok(ChannelLine::Down { .. })));
        assert_eq!(read_line_capped(&mut r, &mut buf).unwrap(), LineRead::Line);
        assert_eq!(buf, b"last");
        assert_eq!(read_line_capped(&mut r, &mut buf).unwrap(), LineRead::Eof);
    }

    const TOKEN: &str = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCdE";
    const KEY: &str = "MCowBQYDK2VwAyEA2iiIlCdozFI1zJMqG5gn-VReZQ3719iZCHBH73JgxYU";

    fn launch(extra: &str) -> String {
        format!(r#"{{"v":1,"t":"launch","port":4321,"launchToken":"{TOKEN}","kernelPublicKey":"{KEY}","bundleHash":"sha256:{}","expiresAt":1{extra}}}"#, "a".repeat(64))
    }

    #[test]
    fn a_launch_line_parses_and_debug_redacts_the_secrets() {
        let ChannelLine::Launch(g) = parse_line(&launch("")).unwrap() else { panic!("not a launch") };
        assert_eq!(g.port, 4321);
        assert_eq!(g.url(), format!("http://127.0.0.1:4321/#launch={TOKEN}&k={KEY}"));
        let dbg = format!("{g:?}");
        assert!(!dbg.contains(TOKEN) && !dbg.contains(KEY), "{dbg}");
        assert!(!format!("{:?}", ChannelLine::Launch(g)).contains(TOKEN));
    }

    #[test]
    fn falsifier_malformed_launch_lines_are_refused() {
        for bad in [
            launch("").replace("4321", "0"),
            launch("").replace("4321", "70000"),
            launch("").replace(TOKEN, "a b"),
            launch("").replace(TOKEN, &"a".repeat(129)),
            launch("").replace(KEY, "k/+="),
            launch("").replace("sha256:", "md5:aaaaaaa"),
            launch("").replace(&"a".repeat(64), &"A".repeat(64)),
            launch("").replace(r#""v":1"#, r#""v":2"#),
            "not json".to_string(),
            r#"{"v":1,"t":"surprise"}"#.to_string(),
        ] {
            let r = parse_line(&bad);
            assert!(r.is_err(), "{bad}");
            assert!(!r.unwrap_err().contains(TOKEN));
        }
    }

    #[test]
    fn a_refusal_carries_its_next_steps() {
        let l = r#"{"v":1,"t":"refused","code":"up","reason":"unprovisioned","message":"no Gnomon home","next":["gnomon identity init"]}"#;
        let ChannelLine::Refused { reason, next, .. } = parse_line(l).unwrap() else { panic!() };
        assert_eq!(reason, "unprovisioned");
        assert_eq!(next, vec!["gnomon identity init".to_string()]);
    }
}
