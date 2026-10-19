//! #gnomon-wrapper against a LIVE kernel (G-GUI-12 native half, macOS).
//! Spawns `node gnomon.js dev up --home <tmp> --wrapper` exactly as the app
//! spawns its kernel child (kernel::child_command: clean env, piped channel),
//! reads the launch grant off the channel, and runs the native preflight:
//!   - the genuine kernel key + the compiled pin ⇒ Ok (serverSig verified in
//!     Rust over the kernel's real hello; the served bundle re-hashes to the pin);
//!   - another kernel key ⇒ refused (the listener is not "our" kernel);
//!   - another bundle hash ⇒ refused before any connection.
//! SKIPS (prints why, passes) when the build machine had no node or
//! packages/gnomon/dist is not built: CI's native job does not build the TS
//! side; the founder's machine and the gnomon test job do.
#![cfg(target_os = "macos")]

use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use gnomon_wrapper::bundle::PIN;
use gnomon_wrapper::contract::{parse_line, ChannelLine};
use gnomon_wrapper::kernel::{child_command, BUILD_GNOMON_JS, BUILD_NODE};
use gnomon_wrapper::loopback::{preflight, PreflightError};
use gnomon_wrapper::verify::SigError;

fn tmp() -> PathBuf {
    // $TMPDIR on macOS is per-user (/var/folders/…), never the world-writable /tmp
    let d = std::env::temp_dir().canonicalize().unwrap().join(format!("gwl-{}", std::process::id()));
    std::fs::create_dir_all(&d).unwrap();
    d
}

#[test]
fn native_preflight_against_a_live_dev_kernel() {
    let js = Path::new(BUILD_GNOMON_JS);
    if BUILD_NODE.is_empty() || !js.is_file() {
        eprintln!("SKIP live_kernel: no build-time node ({BUILD_NODE:?}) or no {} (npm run build:gnomon)", js.display());
        return;
    }
    let node = Path::new(BUILD_NODE);
    let d = tmp();
    let dev_home = d.join("devhome");
    let env: Vec<(String, String)> = vec![("HOME".into(), d.display().to_string()), ("LANG".into(), "en_US.UTF-8".into())];
    let init = Command::new(node).arg(js).args(["dev", "init", "--home"]).arg(&dev_home).env_clear().env("HOME", &d).env("PATH", "/usr/bin:/bin").output().unwrap();
    assert!(init.status.success(), "dev init: {}", String::from_utf8_lossy(&init.stderr));

    let mut child = child_command(node, js, Some(&dev_home), &env, Stdio::piped()).spawn().unwrap();
    let mut stdin = child.stdin.take().unwrap();
    let (tx, rx) = std::sync::mpsc::channel::<String>();
    let out = child.stdout.take().unwrap();
    std::thread::spawn(move || {
        for l in BufReader::new(out).lines().map_while(Result::ok) {
            let _ = tx.send(l);
        }
    });
    let next = |want: &str| -> ChannelLine {
        let end = Instant::now() + Duration::from_secs(30);
        loop {
            let l = rx.recv_timeout(end.saturating_duration_since(Instant::now())).expect("a channel line");
            let p = parse_line(&l).expect("a well-formed channel line");
            let t = match &p {
                ChannelLine::Up => "up",
                ChannelLine::Launch(_) => "launch",
                ChannelLine::LaunchFailed { .. } => "launch-failed",
                ChannelLine::Refused { .. } => "refused",
                ChannelLine::Down { .. } => "down",
            };
            if t == want {
                return p;
            }
            assert!(t != "refused" && t != "launch-failed", "kernel refused: {p:?}");
        }
    };
    next("up");
    stdin.write_all(b"launch\n").unwrap();
    let ChannelLine::Launch(g) = next("launch") else { unreachable!() };

    let genuine = preflight(g.port, &g.kernel_public_key, &g.bundle_hash, PIN);
    let foreign = preflight(g.port, "MCowBQYDK2VwAyEAGb9ECWmEzf6FQbrBZ9w7lshQhqowtrbLDFw4rXAxZuE", &g.bundle_hash, PIN);
    let other_pin = preflight(g.port, &g.kernel_public_key, &g.bundle_hash, &format!("sha256:{}", "2".repeat(64)));

    stdin.write_all(b"quit\n").unwrap();
    let _ = child.wait();
    let _ = std::fs::remove_dir_all(&d);

    assert_eq!(genuine, Ok(()), "the genuine kernel must pass the native preflight");
    assert_eq!(foreign, Err(PreflightError::Sig(SigError::KeyIdMismatch)), "FALSIFIER: a foreign kernel key must be refused");
    assert!(matches!(other_pin, Err(PreflightError::Bundle(_))), "FALSIFIER: a GUI bundle other than the pin must be refused");
}
