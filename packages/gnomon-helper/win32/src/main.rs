//! gnomon-helper (win32) — the Windows platform helper (spec §16, §18; P8-D71; docs/plans/gnomon-windows.md W2).
//!
//!   gnomon-helper --version                 prints `gnomon-helper <version> <protocol> win32`
//!   gnomon-helper serve                     NDJSON ops on stdin/stdout (protocol.rs), until stdin closes
//!   gnomon-helper once                      one request line in, one reply line out
//!   gnomon-helper exec -- <exe> [args…]     the job-object launcher (exec.rs): runs <exe> inside a job with
//!                                           KILL_ON_JOB_CLOSE and exits with its code
//!   gnomon-helper sandbox [--desktop] -- <exe> [args…]
//!                                           the session sandbox (sandbox.rs): restricted token + job UI limits
//!                                           (+ a private desktop), W5
//!
//! The same wire envelope as the darwin helper (`gnomon-helper:v2`): request `{"id", "op", …}`, reply
//! `{"id", "ok": true, …}` or `{"id", "ok": false, "error": "<code>", "message"}`. The win32 ops are the platform
//! ops of the §16 table (pipe DACL, home ACL, durable rename, boot id, ShellExecute); the key ops (Windows Hello,
//! W4) are not in this version, so `key.*` / `sign` refuse `unsupported-op`.

mod protocol;
#[cfg(windows)]
mod approvals;
mod b64;
#[cfg(windows)]
mod presence;
#[cfg(windows)]
mod confine;
#[cfg(windows)]
mod exec;
#[cfg(windows)]
mod sandbox;
#[cfg(windows)]
mod session_acl;
#[cfg(windows)]
mod shield;
#[cfg(windows)]
mod win;

pub const VERSION: &str = env!("CARGO_PKG_VERSION");
pub const PROTOCOL: &str = "gnomon-helper:v2";

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let code = match args.get(1).map(String::as_str) {
        Some("--version") => {
            println!("gnomon-helper {VERSION} {PROTOCOL} win32");
            0
        }
        Some("serve") => protocol::serve(),
        Some("once") => protocol::once(),
        #[cfg(windows)]
        Some("exec") => exec::run(&args[2..]),
        #[cfg(windows)]
        Some("sandbox") => sandbox::run(&args[2..]),
        _ => {
            eprintln!("usage: gnomon-helper --version | serve | once | exec -- <exe> [args…] | sandbox [--desktop] -- <exe> [args…]");
            64
        }
    };
    std::process::exit(code);
}
