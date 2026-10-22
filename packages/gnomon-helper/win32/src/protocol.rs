//! The NDJSON wire (`gnomon-helper:v2` envelope) and the op table. Every input is bounded and validated here,
//! before any OS call; a bad request is refused `bad-request` and the helper keeps serving.

use serde_json::{json, Map, Value};
use std::io::{BufRead, Write};

pub const MAX_LINE_BYTES: usize = 1 << 20;
const MAX_PATH_CHARS: usize = 32_767;

#[derive(Debug)]
pub struct HelperError {
    pub code: String,
    pub message: String,
    pub status: Option<u32>,
}

impl HelperError {
    pub fn new(code: &str, message: &str) -> Self {
        HelperError { code: code.into(), message: message.into(), status: None }
    }
    pub fn os(what: &str, status: u32) -> Self {
        HelperError { code: "os-error".into(), message: format!("{what} failed ({status})"), status: Some(status) }
    }
}

fn bad(message: &str) -> HelperError {
    HelperError::new("bad-request", message)
}

fn str_arg<'a>(req: &'a Map<String, Value>, key: &str) -> Result<&'a str, HelperError> {
    req.get(key).and_then(Value::as_str).ok_or_else(|| bad(&format!("{key} must be a string")))
}

/// An absolute local path: a drive path (`C:\…`) or a `\\?\C:\…` long path. Never a UNC share, a device path,
/// a relative path or one with a NUL; bounded.
pub fn check_local_path(p: &str) -> Result<(), HelperError> {
    if p.is_empty() || p.len() > MAX_PATH_CHARS || p.contains('\0') {
        return Err(bad("path must be a non-empty absolute local path"));
    }
    let rest = p.strip_prefix(r"\\?\").unwrap_or(p);
    let b = rest.as_bytes();
    let drive = b.len() >= 3 && b[0].is_ascii_alphabetic() && b[1] == b':' && (b[2] == b'\\' || b[2] == b'/');
    if !drive || rest.starts_with(r"\\") {
        return Err(bad("path must be an absolute drive path (no UNC, no device path)"));
    }
    // Aegis L4: no alternate data stream (a ':' past the drive), no '.'/'..' segment, no segment ending in a dot or a
    // space (Win32 strips them, so the name checked is not the name opened), no reserved device name
    if rest[2..].contains(':') {
        return Err(bad("path must not name an alternate data stream"));
    }
    for seg in rest[3..].split(['\\', '/']).filter(|s| !s.is_empty()) {
        if seg == "." || seg == ".." || seg.ends_with('.') || seg.ends_with(' ') {
            return Err(bad("path segments must not be '.', '..' or end in a dot or a space"));
        }
        let stem = seg.split('.').next().unwrap_or(seg).to_ascii_uppercase();
        let reserved = matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$")
            || ((stem.starts_with("COM") || stem.starts_with("LPT")) && stem.len() == 4 && stem.as_bytes()[3].is_ascii_digit());
        if reserved {
            return Err(bad("path must not name a reserved device"));
        }
    }
    Ok(())
}

/// The kernel's pipe names only: `gnomon-<16..64 lowercase hex>` (spec §16 `\\.\pipe\gnomon-<sha>`), plus the
/// probe/test form `gnomon-p03-<hex>` / `gnomon-test-<hex>`.
pub fn check_pipe_name(n: &str) -> Result<(), HelperError> {
    let hex = |s: &str| (12..=64).contains(&s.len()) && s.bytes().all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c));
    let ok = match n.strip_prefix("gnomon-") {
        Some(rest) => hex(rest) || rest.strip_prefix("test-").is_some_and(hex) || rest.strip_prefix("p03-").is_some_and(hex),
        None => false,
    };
    if ok { Ok(()) } else { Err(bad("name must be gnomon-<hex>")) }
}

/// Loopback http(s) URLs only (the token-less GUI URL, spec §16 "Launch-token hand-off"). The authority is parsed
/// strictly as `host[:digits]` (Aegis M1: no userinfo, so `http://127.0.0.1:1@evil.example/` is refused).
pub fn check_loopback_url(u: &str) -> Result<(), HelperError> {
    if u.len() > 2048 || u.chars().any(|c| c.is_control() || c == ' ' || c == '"' || c == '\\') {
        return Err(bad("url has forbidden characters"));
    }
    let lower = u.to_ascii_lowercase();
    let rest = lower.strip_prefix("http://").or_else(|| lower.strip_prefix("https://")).ok_or_else(|| bad("url must be http(s)"))?;
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    let (host, port) = match authority.strip_prefix("[::1]") {
        Some(p) => ("[::1]", p.strip_prefix(':').unwrap_or(p)),
        None => authority.split_once(':').unwrap_or((authority, "")),
    };
    let loopback = host == "127.0.0.1" || host == "[::1]" || host == "localhost";
    if !loopback || port.len() > 5 || !port.bytes().all(|b| b.is_ascii_digit()) {
        return Err(bad("url must be loopback (host[:port], no userinfo)"));
    }
    // a launch token never crosses ShellExecute (spec §16): refused in any case, and no percent-encoding at all
    if lower.contains("launch") || lower.contains('%') {
        return Err(bad("a launch token never crosses ShellExecute (spec §16)"));
    }
    Ok(())
}

/// A per-session SID: `S-1-9-4174-2026-1022-<n>`, n a decimal u32 without leading zeros.
pub fn check_session_sid(s: &str) -> Result<(), HelperError> {
    let n = s.strip_prefix(crate::sandbox::GNOMON_SESSION_SID).and_then(|r| r.strip_prefix('-')).ok_or_else(|| bad("a session sid is S-1-9-4174-2026-1022-<n>"))?;
    let ok = !n.is_empty() && n.len() <= 10 && n.bytes().all(|b| b.is_ascii_digit()) && !(n.len() > 1 && n.starts_with('0')) && n.parse::<u64>().is_ok_and(|v| v <= u32::MAX as u64);
    if !ok {
        return Err(bad("a session sid ends in a decimal u32"));
    }
    Ok(())
}

/// `HKCU\<key>`: bounded, no NUL, no empty segment, no '.'/'..' segment. Only this user's hive.
pub fn check_registry_path(p: &str) -> Result<(), HelperError> {
    let rest = p.strip_prefix("HKCU\\").ok_or_else(|| bad("registry path must start with HKCU\\"))?;
    if rest.is_empty() || p.len() > 1024 || p.contains('\0') || p.contains('/') {
        return Err(bad("registry path must name a key below HKCU"));
    }
    if rest.split('\\').any(|seg| seg.is_empty() || seg == "." || seg == "..") {
        return Err(bad("registry path segments must be non-empty and not '.' or '..'"));
    }
    Ok(())
}

/// Parsed DACL facts from a read-back SDDL (`O:<sid>D:<flags>(ace)(ace)…`).
#[derive(Debug, PartialEq)]
pub struct DaclFacts {
    pub owner: String,
    pub protected: bool,
    pub aces: Vec<(String, String, String, String)>, // (type, flags, rights, sid)
}

pub fn parse_sddl(sddl: &str) -> Option<DaclFacts> {
    let o = sddl.strip_prefix("O:")?;
    let d = o.find("D:")?;
    let owner = o[..d].to_string();
    let dacl = &o[d + 2..];
    let first_ace = dacl.find('(').unwrap_or(dacl.len());
    let flags = &dacl[..first_ace];
    let mut aces = Vec::new();
    for ace in dacl[first_ace..].split(')').filter(|s| !s.is_empty()) {
        let ace = ace.strip_prefix('(')?;
        let f: Vec<&str> = ace.split(';').collect();
        if f.len() < 6 {
            return None;
        }
        aces.push((f[0].to_string(), f[1].to_string(), f[2].to_string(), f[5].to_string()));
    }
    Some(DaclFacts { owner, protected: flags.contains('P'), aces })
}

/// Owner-only = the owner is `sid`, at least one ACE is an ALLOW for `sid` (inherited or explicit), and every other
/// ACE is a DENY naming GNOMON_SESSION_SID (a deny only ever removes access: the kernel pipe's, and the session read
/// denies a running session puts on the home) or the OWNER RIGHTS allow `acl.session` adds beside such a deny (it
/// grants the owner, already `sid`, nothing more than its own ACE). `need_protected`: the object must not inherit from its parent (the
/// home, the pipe); a file below the home inherits from it.
pub fn owner_only(sddl: &str, sid: &str, need_protected: bool) -> bool {
    match parse_sddl(sddl) {
        Some(f) => {
            f.owner == sid
                && (!need_protected || f.protected)
                && f.aces.iter().any(|(t, _, _, s)| t == "A" && s == sid)
                && f.aces.iter().all(|(t, _, _, s)| (t == "A" && (s == sid || s == "OW")) || (t == "D" && s == crate::sandbox::GNOMON_SESSION_SID))
        }
        None => false,
    }
}

/// A DENY ACE (any rights, not inherit-only) names GNOMON_SESSION_SID (a process DACL: rights read back as hex).
pub fn session_denied_any(sddl: &str) -> bool {
    parse_sddl(sddl).is_some_and(|f| f.aces.iter().any(|(t, fl, _, s)| t == "D" && !fl.contains("IO") && s == crate::sandbox::GNOMON_SESSION_SID))
}

/// The pipe's DACL denies GNOMON_SESSION_SID full access (sessions carry the user SID, so owner-only alone admits them).
pub fn session_denied(sddl: &str) -> bool {
    parse_sddl(sddl).is_some_and(|f| f.aces.iter().any(|(t, fl, r, s)| t == "D" && !fl.contains("IO") && r == "FA" && s == crate::sandbox::GNOMON_SESSION_SID))
}

#[cfg(windows)]
fn dispatch(op: &str, req: &Map<String, Value>) -> Result<Value, HelperError> {
    use crate::win;
    match op {
        "info" => Ok(json!({
            "version": crate::VERSION, "protocol": crate::PROTOCOL, "platform": "win32",
            "ops": ["info", "pipe.secure", "pipe.read", "acl.owner-only", "acl.read", "acl.session", "process.confine", "process.shield", "fs.rename-durable", "boot.id", "shell.open"],
            "sessionSid": crate::sandbox::GNOMON_SESSION_SID,
            "userSid": win::current_user_sid()?,
            // the same SID as read-back SDDL spells it (an alias such as LA for a well-known account): compare SDDL to this
            "userSddlSid": win::current_user_sddl_sid()?,
        })),
        "pipe.secure" => {
            let name = str_arg(req, "name")?;
            check_pipe_name(name)?;
            let sid = win::current_user_sid()?;
            let r = win::secure_pipe(name, &sid)?;
            let spelled = win::sddl_spelling(&sid)?;
            Ok(json!({ "sddl": r.sddl, "ownerOnly": owner_only(&r.sddl, &spelled, true), "sessionDenied": session_denied(&r.sddl), "serverPid": r.server_pid }))
        }
        "pipe.read" => {
            let name = str_arg(req, "name")?;
            check_pipe_name(name)?;
            let sid = win::current_user_sddl_sid()?;
            let sddl = win::read_pipe_sddl(name)?;
            Ok(json!({ "ownerOnly": owner_only(&sddl, &sid, true), "sessionDenied": session_denied(&sddl), "sddl": sddl }))
        }
        "acl.owner-only" => {
            let path = str_arg(req, "path")?;
            check_local_path(path)?;
            let dir = match req.get("kind").and_then(Value::as_str) {
                Some("dir") => true,
                Some("file") => false,
                _ => return Err(bad("kind must be dir or file")),
            };
            let sid = win::current_user_sid()?;
            let sddl = win::set_path_owner_only(path, &sid, dir)?;
            Ok(json!({ "ownerOnly": owner_only(&sddl, &win::sddl_spelling(&sid)?, true), "sddl": sddl }))
        }
        "acl.read" => {
            let path = str_arg(req, "path")?;
            check_local_path(path)?;
            let sid = win::current_user_sddl_sid()?;
            let sddl = win::read_path_sddl(path)?;
            Ok(json!({
                "ownerOnly": owner_only(&sddl, &sid, false),
                "ownerOnlyProtected": owner_only(&sddl, &sid, true),
                "sddl": sddl,
            }))
        }
        "acl.session" => {
            // the session deny list (W5, session_acl.rs): [{path, mode, match: subpath|literal}], at most 512
            let entries = req.get("entries").and_then(Value::as_array).ok_or_else(|| bad("entries must be an array"))?;
            if entries.len() > 512 {
                return Err(bad("at most 512 entries"));
            }
            let mut parsed = Vec::with_capacity(entries.len());
            for e in entries {
                let path = e.get("path").and_then(Value::as_str).ok_or_else(|| bad("entry.path must be a string"))?;
                let mode = e.get("mode").and_then(Value::as_str).and_then(crate::session_acl::Mode::parse).ok_or_else(|| bad("entry.mode is not a session mode"))?;
                if path.starts_with("HKCU\\") {
                    // a key of this user's hive: write denies (persistence: Run keys, Environment) and their removal only
                    check_registry_path(path)?;
                    if !mode.registry_ok() {
                        return Err(bad("a registry entry takes deny-write, deny-all or clear"));
                    }
                } else {
                    check_local_path(path)?;
                }
                let inherit = match e.get("match").and_then(Value::as_str) {
                    Some("subpath") => true,
                    Some("literal") => false,
                    _ => return Err(bad("entry.match must be subpath or literal")),
                };
                let own = match e.get("sid") {
                    None => None,
                    Some(v) => {
                        let s = v.as_str().ok_or_else(|| bad("entry.sid must be a string"))?;
                        check_session_sid(s)?;
                        if !matches!(mode, crate::session_acl::Mode::AllowRead | crate::session_acl::Mode::AllowWrite | crate::session_acl::Mode::AllowWriteKeep) {
                            return Err(bad("entry.sid is for an allow mode only"));
                        }
                        Some(s)
                    }
                };
                parsed.push((path, mode, inherit, own));
            }
            // every entry is attempted; each reports on its own (a missing path is "missing", never a silent pass)
            let results: Vec<Value> = parsed
                .into_iter()
                .map(|(path, mode, inherit, own)| match crate::session_acl::apply(path, mode, inherit, own) {
                    Ok(sddl) => json!({ "path": path, "ok": true, "sddl": sddl }),
                    Err(e) if e.status == Some(2) || e.status == Some(3) => json!({ "path": path, "ok": false, "error": "missing" }),
                    Err(e) => json!({ "path": path, "ok": false, "error": e.code, "message": e.message }),
                })
                .collect();
            Ok(json!({ "results": results }))
        }
        "process.confine" => {
            // W5: lower a running child (the GUI transport) to Low integrity in a locked-down job (confine.rs)
            let pid = req.get("pid").and_then(Value::as_u64).filter(|p| *p > 4 && *p <= u32::MAX as u64).ok_or_else(|| bad("pid must be a process id"))?;
            let rid = crate::confine::confine(pid as u32)?;
            Ok(json!({ "integrity": format!("0x{rid:x}") }))
        }
        "process.shield" => {
            // W5: deny Gnomon sessions every access to one of Gnomon's own processes (shield.rs)
            let pid = req.get("pid").and_then(Value::as_u64).filter(|p| *p > 4 && *p <= u32::MAX as u64).ok_or_else(|| bad("pid must be a process id"))?;
            let r = crate::shield::shield(pid as u32)?;
            Ok(json!({ "sddl": r.sddl, "sessionDenied": true, "threads": r.threads }))
        }
        "fs.rename-durable" => {
            let (from, to) = (str_arg(req, "from")?, str_arg(req, "to")?);
            check_local_path(from)?;
            check_local_path(to)?;
            win::rename_durable(from, to)?;
            Ok(json!({}))
        }
        "boot.id" => Ok(json!({ "bootId": format!("win:{}", win::boot_id()?) })),
        "shell.open" => {
            let url = str_arg(req, "url")?;
            check_loopback_url(url)?;
            win::shell_open(url)?;
            Ok(json!({}))
        }
        // W4 phase A (approvals.rs): the approvals key; the root key and presence (Windows Hello) are phase B
        "key.create" | "key.public" => {
            let gen = str_arg(req, "gen")?;
            let pk = match (str_arg(req, "key")?, op) {
                ("approvals", "key.create") => crate::approvals::create(gen)?,
                ("approvals", _) => crate::approvals::public(gen)?,
                // W4 phase B (presence.rs): the Windows Hello key; creating it is itself a Hello prompt
                ("presence", "key.create") => crate::presence::create(gen, req.get("reason").and_then(Value::as_str).unwrap_or("Gnomon: create your approvals presence key"))?,
                ("presence", _) => crate::presence::public(gen)?,
                _ => return Err(HelperError::new("unsupported-op", "this helper holds the approvals and presence keys only (no root key)")),
            };
            Ok(json!({ "publicKey": crate::b64::encode(&pk) }))
        }
        "sign" => {
            if str_arg(req, "key")? != "approvals" {
                return Err(HelperError::new("unsupported-op", "only the approvals key lives in this helper (the root is phase B)"));
            }
            let gen = str_arg(req, "gen")?;
            let msgs = req.get("messages").and_then(Value::as_array).ok_or_else(|| bad("messages must be an array"))?;
            if msgs.is_empty() || msgs.len() > crate::approvals::MAX_MESSAGES {
                return Err(bad("messages: 1-4"));
            }
            let messages = msgs
                .iter()
                .map(|m| m.as_str().and_then(crate::b64::decode).ok_or_else(|| bad("each message is standard base64")))
                .collect::<Result<Vec<_>, _>>()?;
            match str_arg(req, "mode")? {
                // the click classes take no presence on Windows (approvals.rs): the kernel asks for them by name
                "click" => {
                    let sigs = crate::approvals::sign_click(gen, &messages)?;
                    Ok(json!({ "sigs": sigs.iter().map(|s| crate::b64::encode(s)).collect::<Vec<_>>(), "kept": false }))
                }
                "cached" => Err(HelperError::new("no-unlock", "this helper holds no unlocks (click classes sign as mode click)")),
                // W4 phase B: [approve, presence] — the presence challenge under a Windows Hello prompt FIRST (presence.rs),
                // then the decision by the approvals key; a cancelled prompt signs nothing
                "fresh" => {
                    if messages.len() != 2 {
                        return Err(bad("a fresh sign is exactly [approve, presence]"));
                    }
                    let reason = req.get("reason").and_then(Value::as_str).unwrap_or("Gnomon: approve a decision");
                    // Aegis W4-B L5: the approvals key must be there BEFORE the Hello prompt (never a wasted gesture)
                    crate::approvals::public(gen)?;
                    let p = crate::presence::sign(gen, &messages[1], reason)?;
                    let a = crate::approvals::sign_click(gen, &messages[..1])?;
                    Ok(json!({ "sigs": [crate::b64::encode(&a[0]), crate::b64::encode(&p)], "kept": false }))
                }
                _ => Err(bad("mode must be click, cached or fresh")),
            }
        }
        // no unlocks and no voice arms are held here: dropping them is a no-op (the kernel escalates on a failure)
        "unlock.drop" | "unlock.drop-all" | "conn.close" => Ok(json!({})),
        _ => Err(HelperError::new("unsupported-op", &format!("{op} is not a win32 helper op"))),
    }
}

#[cfg(not(windows))]
fn dispatch(op: &str, _req: &Map<String, Value>) -> Result<Value, HelperError> {
    Err(HelperError::new("unsupported-op", &format!("{op}: this helper runs on Windows only")))
}

/// One request line → one reply object (never panics; a non-object or a missing op is `bad-request`).
pub fn handle_line(line: &str) -> Value {
    let parsed: Result<Value, _> = serde_json::from_str(line);
    let req = match parsed {
        Ok(Value::Object(m)) => m,
        _ => return json!({ "id": Value::Null, "ok": false, "error": "bad-request", "message": "not a JSON object" }),
    };
    let id = match req.get("id") {
        Some(v @ (Value::String(_) | Value::Number(_))) => v.clone(),
        _ => return json!({ "id": Value::Null, "ok": false, "error": "bad-request", "message": "id must be a string or number" }),
    };
    let op = match req.get("op").and_then(Value::as_str) {
        Some(op) => op.to_string(),
        None => return json!({ "id": id, "ok": false, "error": "bad-request", "message": "op must be a string" }),
    };
    match dispatch(&op, &req) {
        Ok(Value::Object(mut m)) => {
            m.insert("id".into(), id);
            m.insert("ok".into(), Value::Bool(true));
            Value::Object(m)
        }
        Ok(_) => json!({ "id": id, "ok": true }),
        Err(e) => {
            let mut r = json!({ "id": id, "ok": false, "error": e.code, "message": e.message });
            if let Some(s) = e.status {
                r["status"] = json!(s);
            }
            r
        }
    }
}

fn read_bounded_line(input: &mut impl BufRead) -> std::io::Result<Option<Result<String, ()>>> {
    let mut buf = Vec::new();
    let n = std::io::Read::take(&mut *input, MAX_LINE_BYTES as u64 + 1).read_until(b'\n', &mut buf)?;
    if n == 0 {
        return Ok(None);
    }
    if buf.len() > MAX_LINE_BYTES && !buf.ends_with(b"\n") {
        // drain the rest of the oversize line, then refuse it
        let mut sink = Vec::new();
        input.read_until(b'\n', &mut sink)?;
        return Ok(Some(Err(())));
    }
    Ok(Some(String::from_utf8(buf).map(|s| s.trim_end_matches(['\r', '\n']).to_string()).map_err(|_| ())))
}

pub fn serve() -> i32 {
    let stdin = std::io::stdin();
    let mut input = stdin.lock();
    let mut out = std::io::stdout().lock();
    loop {
        let reply = match read_bounded_line(&mut input) {
            Ok(None) => return 0,
            Ok(Some(Ok(line))) if line.is_empty() => continue,
            Ok(Some(Ok(line))) => handle_line(&line),
            Ok(Some(Err(()))) => json!({ "id": Value::Null, "ok": false, "error": "bad-request", "message": "line too long or not UTF-8" }),
            Err(_) => return 1,
        };
        if writeln!(out, "{reply}").and_then(|_| out.flush()).is_err() {
            return 1;
        }
    }
}

pub fn once() -> i32 {
    let stdin = std::io::stdin();
    let mut input = stdin.lock();
    let reply = match read_bounded_line(&mut input) {
        Ok(Some(Ok(line))) => handle_line(&line),
        _ => json!({ "id": Value::Null, "ok": false, "error": "bad-request", "message": "no request" }),
    };
    println!("{reply}");
    if reply["ok"] == json!(true) { 0 } else { 1 }
}

#[cfg(test)]
mod tests {
    use super::*;
    const SID: &str = "S-1-5-21-1-2-3-1001";

    #[test]
    fn owner_only_accepts_protected_user_only() {
        assert!(owner_only(&format!("O:{SID}D:P(A;;FA;;;{SID})"), SID, true));
        assert!(owner_only(&format!("O:{SID}D:PAI(A;OICI;FA;;;{SID})"), SID, true));
        // a file below the home: inherited, not protected
        assert!(owner_only(&format!("O:{SID}D:AI(A;ID;FA;;;{SID})"), SID, false));
        assert!(!owner_only(&format!("O:{SID}D:AI(A;ID;FA;;;{SID})"), SID, true));
    }

    #[test]
    fn session_sids_are_below_the_gnomon_sid_with_a_u32() {
        for ok in ["S-1-9-4174-2026-1022-0", "S-1-9-4174-2026-1022-7", "S-1-9-4174-2026-1022-4294967295"] {
            assert!(check_session_sid(ok).is_ok(), "{ok}");
        }
        for bad in ["S-1-9-4174-2026-1022", "S-1-9-4174-2026-1022-", "S-1-9-4174-2026-1022-01", "S-1-9-4174-2026-1022-4294967296", "S-1-9-4174-2026-1022-1-2", "S-1-9-4174-2026-10221", "S-1-5-32-544", "S-1-9-4174-2026-1022--1"] {
            assert!(check_session_sid(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn registry_paths_are_this_users_hive_only() {
        assert!(check_registry_path(r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run").is_ok());
        assert!(check_registry_path(r"HKCU\Environment").is_ok());
        for p in [r"HKCU\", r"HKLM\Software", r"HKCU\a\\b", r"HKCU\..\x", "HKCU\\a\0b", r"HKCU/Software", r"HKEY_CURRENT_USER\Software"] {
            assert!(check_registry_path(p).is_err(), "{p}");
        }
    }

    #[test]
    fn owner_only_accepts_session_denies_and_owner_rights() {
        let g = crate::sandbox::GNOMON_SESSION_SID;
        let pipe = format!("O:{SID}D:P(D;;FA;;;{g})(A;;FA;;;{SID})");
        assert!(owner_only(&pipe, SID, true));
        assert!(session_denied(&pipe));
        assert!(!session_denied(&format!("O:{SID}D:P(A;;FA;;;{SID})")));
        assert!(!session_denied(&format!("O:{SID}D:P(D;OICIIO;FA;;;{g})(A;;FA;;;{SID})")));
        // a key file below the home while a session's read deny is on it
        assert!(owner_only(&format!("O:{SID}D:AI(D;ID;CCDCLC;;;{g})(A;ID;FA;;;OW)(A;ID;FA;;;{SID})"), SID, false));
        // a session SID ALLOW, or an owner-rights ACE alone, is not owner-only
        assert!(!owner_only(&format!("O:{SID}D:P(A;;FA;;;{g})(A;;FA;;;{SID})"), SID, true));
        assert!(!owner_only(&format!("O:{SID}D:P(A;;FA;;;OW)"), SID, true));
    }

    #[test]
    fn owner_only_refuses_everyone_admins_system_other_owner_and_empty() {
        // P03's default pipe DACL
        let default = format!("O:{SID}D:(A;;FA;;;SY)(A;;FA;;;BA)(A;;FA;;;{SID})(A;;FR;;;WD)(A;;FR;;;AN)");
        assert!(!owner_only(&default, SID, false));
        assert!(!owner_only(&format!("O:BAD:P(A;;FA;;;{SID})"), SID, true));
        assert!(!owner_only(&format!("O:{SID}D:P(A;;FA;;;{SID})(A;;FA;;;SY)"), SID, true));
        assert!(!owner_only(&format!("O:{SID}D:P(D;;FA;;;WD)(A;;FA;;;{SID})"), SID, true));
        assert!(!owner_only(&format!("O:{SID}D:P"), SID, true));
        assert!(!owner_only("garbage", SID, false));
    }

    #[test]
    fn owner_only_compares_in_the_sddl_spelling() {
        // CI's runner is the built-in Administrator (RID 500): its read-back says LA, so verdicts take the SDDL spelling
        let la = "O:LAD:PAI(A;OICI;FA;;;LA)";
        assert!(owner_only(la, "LA", true));
        assert!(!owner_only(la, "S-1-5-21-1-2-3-500", true));
        assert!(!owner_only(la, "BA", true));
    }

    #[cfg(windows)]
    #[test]
    fn sddl_spelling_aliases_well_known_and_keeps_others() {
        assert_eq!(crate::win::sddl_spelling("S-1-5-18").unwrap(), "SY");
        assert_eq!(crate::win::sddl_spelling(SID).unwrap(), SID);
        let me = crate::win::current_user_sid().unwrap();
        let spelled = crate::win::current_user_sddl_sid().unwrap();
        assert!(spelled == me || (spelled.len() == 2 && me.ends_with("-500")), "{me} -> {spelled}");
    }

    #[test]
    fn paths_are_local_absolute_only() {
        for ok in [r"C:\Users\a\.gnomon", r"\\?\C:\Users\a\.gnomon", "D:/x/y"] {
            assert!(check_local_path(ok).is_ok(), "{ok}");
        }
        for bad in ["", r"relative\x", r"\\server\share\x", r"\\.\pipe\x", r"\\?\UNC\server\x", r"C:\a\..\b", "C:x", "C:\\a\0b", r"C:\a\f:stream", r"C:\a\NUL", r"C:\a\com1.txt", r"C:\a\x.", r"C:\a\x ", r"\\?\C:\a\.\b", r"\\?\GLOBALROOT\Device\x"] {
            assert!(check_local_path(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn pipe_names_are_bounded() {
        assert!(check_pipe_name("gnomon-0123456789abcdef").is_ok());
        assert!(check_pipe_name("gnomon-p03-0123456789ab").is_ok());
        for bad in ["gnomon", "gnomon-XYZ", "other-0123456789abcdef", r"gnomon-0123456789abcdef\..\x", "gnomon-0123"] {
            assert!(check_pipe_name(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn shell_open_is_loopback_and_token_less() {
        assert!(check_loopback_url("http://127.0.0.1:4310/").is_ok());
        assert!(check_loopback_url("http://127.0.0.1:4310/#reconnect").is_ok());
        for bad in ["https://evil.example/", "file:///C:/x", "http://127.0.0.1:1/#launch=abc&k=x", "http://127.0.0.1.evil.example/", "http://127.0.0.1:1/ x", "http://127.0.0.1:1@evil.example/", "http://127.0.0.1@evil.example/", "HTTP://127.0.0.1:1/#LAUNCH=x", "http://127.0.0.1:1/#%6caunch=x", "http://127.0.0.1:1x/", r"http://127.0.0.1\@evil/"] {
            assert!(check_loopback_url(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn envelope_refuses_bad_requests_and_echoes_id() {
        assert_eq!(handle_line("[]")["error"], "bad-request");
        assert_eq!(handle_line(r#"{"op":"info"}"#)["error"], "bad-request");
        assert_eq!(handle_line(r#"{"id":1}"#)["error"], "bad-request");
        let r = handle_line(r#"{"id":"x","op":"arm.open"}"#);
        assert_eq!(r["id"], "x");
        assert_eq!(r["ok"], false);
        assert_eq!(r["error"], "unsupported-op");
    }
}
