//! `gnomon-wrapper --cli -- <args>` end to end on the BUILT binary (8.0 M4, Aegis M4 high 1): the kernel CLI runs
//! through the wrapper's trust root, and NODE_OPTIONS / GNOMON_* set by the caller never reach it. Uses this build's
//! pinned node and kernel (dev: the checkout's); when the build pinned none, or the checkout moved on since the build
//! (the trust root refuses with exit 69), the live half is skipped with a note.
use std::process::Command;

fn wrapper() -> Command {
    Command::new(env!("CARGO_BIN_EXE_gnomon-wrapper"))
}

#[test]
fn cli_without_the_separator_is_a_usage_refusal() {
    let o = wrapper().args(["--cli", "help"]).output().unwrap();
    assert_eq!(o.status.code(), Some(64));
    assert!(String::from_utf8_lossy(&o.stderr).contains("--cli -- <gnomon args"));
}

#[test]
fn falsifier_node_options_and_gnomon_vars_never_reach_the_kernel_cli() {
    // (DYLD_* is not set here: it acts on the wrapper process itself, which the hardened runtime of a signed release
    // ignores and the paradigm shim never passes; this debug build has no hardened runtime)
    // were NODE_OPTIONS passed, node would fail to --require a missing file before the kernel even started
    let o = wrapper()
        .args(["--cli", "--", "help"])
        .env("NODE_OPTIONS", "--require /nonexistent/gnomon-evil.js")
        .env("GNOMON_HOME", "/nonexistent/elsewhere")
        .output()
        .unwrap();
    let err = String::from_utf8_lossy(&o.stderr);
    if o.status.code() == Some(69) {
        eprintln!("cli_mode: skipped, this build's trust root does not hold here: {err}");
        return;
    }
    assert_eq!(o.status.code(), Some(0), "stderr: {err}");
    assert!(!err.contains("gnomon-evil"), "{err}");
    assert!(String::from_utf8_lossy(&o.stdout).contains("usage: gnomon"), "{}", String::from_utf8_lossy(&o.stdout));
}
