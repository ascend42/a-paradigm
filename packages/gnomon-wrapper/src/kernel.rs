//! #gnomon-wrapper kernel child (spec §2.4 rule 7 `gnomon up`, §11.2 rule 2; M1.13).
//! Gnomon.app runs `node --disable-sigusr1 <pkg>/dist/cli/gnomon.js up --wrapper` as a supervised
//! child: the same hardened in-process path as `gnomon up` in a terminal
//! (openHardwareIdentity, the unsafe-env refusal), with
//!   - a CLEAN environment: env_clear, then only HOME USER LOGNAME LANG TMPDIR
//!     SHELL from the app's own (launchd) env, and a fixed PATH — never
//!     NODE_OPTIONS, never any GNOMON_* or DYLD_* (the kernel would refuse
//!     NODE_OPTIONS anyway, Aegis C1 of M1.3);
//!   - argv that never carries a secret (no token exists yet when it starts);
//!   - stdin/stdout as private pipes (the launch channel), stderr to the
//!     app's log file.
//! TRUST ROOT (Aegis C1, round 2, option a): the node binary and the kernel
//! are pinned AT BUILD TIME inside the signed binary — the node path as found
//! plus the sha256 of its realpath target, and the kernel-tree hash of
//! `packages/gnomon/{dist,package.json}` (tree.rs). [`check_trust_root`]
//! re-hashes both before EVERY spawn and refuses a mismatch with the fix named
//! ("rebuild the app"); a `brew upgrade node` is such a mismatch. Residual
//! (stated in spec §11.1 / G-GUI-12): the pin holds only up to the spawn — a
//! same-user process can still swap the files between the check and node's
//! own reads, the §15.1 posture for same-user writers.
//!
//! BUNDLE vs DEV (TD-2026-10-21-758, 8.0 M2; build.rs, src/layout.rs): a RELEASE app (BUILD_MODE "bundle") pins
//! BUNDLE-RELATIVE paths (Contents/Resources/node/bin/node, Contents/Resources/kernel) and the hashes of the node and
//! kernel the release staged; [`check_trust_root`] resolves them from the app's OWN executable
//! (`<X>.app/Contents/MacOS/gnomon-wrapper`) at every spawn, so a copied or moved app still runs and a modified one
//! is refused. A DEV app (BUILD_MODE "dev", founder dogfooding) keeps the absolute checkout pins exactly as before.
//! The local lane config's runner node (`local.signed.json`) is NOT a source
//! (Aegis C2): the wrapper does not verify its root signature yet.
//! Windows (the parity phase) needs its own pipe + job-object spawn: this is the seam.
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use crate::codesign::verify_static_code;
use crate::layout::{bundle_hashes, contents_of, inside, kernel_exe_hash, KERNEL_EXE_REL, KERNEL_REL, NODE_REL};
use crate::tree::{kernel_tree_hash, sha256_file};

/// "bundle" (a release Gnomon.app: bundle-relative pins) | "dev" (a checkout build: absolute pins).
pub const BUILD_MODE: &str = env!("GNOMON_BUILD_MODE");
pub const BUILD_NODE: &str = env!("GNOMON_BUILD_NODE");
/// bundle mode: the designated requirement the bundled node must meet right before the spawn (codesign.rs); dev: empty.
pub const BUILD_NODE_REQUIREMENT: &str = env!("GNOMON_BUILD_NODE_REQUIREMENT");
pub const BUILD_NODE_SHA256: &str = env!("GNOMON_BUILD_NODE_SHA256");
pub const BUILD_NODE_SOURCE: &str = env!("GNOMON_BUILD_NODE_SOURCE");
pub const BUILD_GNOMON_PKG: &str = env!("GNOMON_BUILD_GNOMON_PKG");
pub const BUILD_KERNEL_TREE: &str = env!("GNOMON_BUILD_KERNEL_TREE");
/// #kernel-sea (TD-2026-10-29-746): the signed SEA kernel the app spawns. bundle: layout::KERNEL_EXE_REL; dev: the
/// absolute `<pkg>/gnomon.kernel`, or empty (no dev SEA: node + script, guarded only).
pub const BUILD_KERNEL_EXE: &str = env!("GNOMON_BUILD_KERNEL_EXE");
pub const BUILD_KERNEL_EXE_SHA256: &str = env!("GNOMON_BUILD_KERNEL_EXE_SHA256");
/// bundle: layout::kernel_requirement (identifier gnomon.kernel, + team for developer-id); dev: layout::kernel_dev_requirement.
pub const BUILD_KERNEL_EXE_REQUIREMENT: &str = env!("GNOMON_BUILD_KERNEL_EXE_REQUIREMENT");

/// What a bundle-mode refusal tells the user: the signed app was modified, so it is replaced, never rebuilt.
pub const REINSTALL: &str = "reinstall Gnomon (npm i -g @a-company/paradigm, then run gnomon)";

/// The command that rebuilds the app (named in every dev trust-root refusal).
pub const REBUILD: &str = "node packages/gnomon-wrapper/scripts/build-darwin.mjs (from the a-paradigm checkout, after npm run build:gnomon)";

/// The env names copied from the app's own environment (all others are dropped).
pub const ENV_ALLOWLIST: [&str; 6] = ["HOME", "USER", "LOGNAME", "LANG", "TMPDIR", "SHELL"];

/// What the app spawns, after the trust-root check passed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrustRoot {
    /// the realpath of the recorded node: the file that was hashed is the file that is executed
    pub node: PathBuf,
    /// the node path as recorded at build (may be a symlink)
    pub node_recorded: PathBuf,
    /// "build-env" | "which" | "sea-dev" (dev) | "bundle" (release: `node_recorded` is the bundle-relative path)
    pub node_source: &'static str,
    pub gnomon_js: PathBuf,
    /// #kernel-sea: the signed SEA kernel to spawn (hash- and, in a bundle, signature-checked); None: node + gnomon_js
    pub kernel: Option<PathBuf>,
}

/// The node + kernel pins recorded in this binary, re-checked now (bundle: from this app's own location).
pub fn check_trust_root() -> Result<TrustRoot, String> {
    if BUILD_MODE == "bundle" {
        let exe = std::env::current_exe().map_err(|e| format!("Gnomon.app cannot locate itself ({e}); {REINSTALL}"))?;
        return check_bundle_sea_with(&exe, BUILD_NODE_SHA256, BUILD_KERNEL_TREE, BUILD_NODE_REQUIREMENT, BUILD_KERNEL_EXE_SHA256, BUILD_KERNEL_EXE_REQUIREMENT);
    }
    let t = check_trust_root_with(BUILD_NODE, BUILD_NODE_SHA256, BUILD_NODE_SOURCE, Path::new(BUILD_GNOMON_PKG), BUILD_KERNEL_TREE)?;
    if BUILD_KERNEL_EXE.is_empty() {
        return Ok(t);
    }
    check_dev_sea_with(t, Path::new(BUILD_KERNEL_EXE), BUILD_KERNEL_EXE_SHA256, BUILD_KERNEL_EXE_REQUIREMENT)
}

/// #kernel-sea BUNDLE mode over explicit pins (tests): [`check_bundle_trust_root_with`] (node + kernel tree + node
/// signature), then the SEA kernel at `Contents/KERNEL_EXE_REL`: a regular file inside the bundle (no symlink, no hard
/// link) hashing to `kernel_sha`, then its code signature against `kernel_requirement` (identifier gnomon.kernel),
/// LAST, right before the spawn. A bundle with no kernel pin is refused (a release always carries the SEA).
pub fn check_bundle_sea_with(exe: &Path, node_sha: &str, tree: &str, node_requirement: &str, kernel_sha: &str, kernel_requirement: &str) -> Result<TrustRoot, String> {
    if kernel_sha.is_empty() || kernel_requirement.is_empty() {
        return Err(format!("this Gnomon.app carries no signed-kernel pin (gnomon.kernel); {REINSTALL}"));
    }
    let mut t = check_bundle_trust_root_with(exe, node_sha, tree, node_requirement)?;
    let contents = contents_of(exe).map_err(|e| format!("Gnomon.app is not a complete app bundle: {e}; {REINSTALL}"))?;
    let sha = kernel_exe_hash(&contents).map_err(|e| format!("Gnomon.app's signed kernel is unreadable or was modified ({e}); {REINSTALL}"))?;
    if sha != kernel_sha {
        return Err(format!("Gnomon.app's signed kernel ({KERNEL_EXE_REL}) does not hash to the release pin: the app was modified; {REINSTALL}"));
    }
    let k = inside(&contents, KERNEL_EXE_REL)?;
    verify_static_code(&k, kernel_requirement).map_err(|e| format!("Gnomon.app's signed kernel failed its code-signature check ({e}); {REINSTALL}"))?;
    t.kernel = Some(k);
    Ok(t)
}

/// #kernel-sea DEV mode: the dev SEA (`<pkg>/gnomon.kernel`, npm run build:sea) must still hash to the build's pin,
/// and then meet `requirement` (Aegis H2: identifier gnomon.kernel.dev, layout::kernel_dev_requirement; a dev app never
/// spawns a production gnomon.kernel).
pub fn check_dev_sea_with(mut t: TrustRoot, kernel: &Path, kernel_sha: &str, requirement: &str) -> Result<TrustRoot, String> {
    if requirement.is_empty() {
        return Err(format!("this Gnomon.app pins a dev SEA kernel without its code requirement. Rebuild the app: {REBUILD}"));
    }
    let real = std::fs::canonicalize(kernel).map_err(|_| format!("Gnomon.app was built against a dev SEA kernel that is gone ({}). Rebuild the app: {REBUILD}", kernel.display()))?;
    let now = sha256_file(&real).map_err(|e| format!("Gnomon.app cannot read its SEA kernel ({e}). Rebuild the app: {REBUILD}"))?;
    if now != kernel_sha {
        return Err(format!("Gnomon.app was built against a different SEA kernel: {} changed since the build (npm run build:sea). Rebuild the app: {REBUILD}", kernel.display()));
    }
    verify_static_code(&real, requirement).map_err(|e| format!("the dev SEA kernel {} failed its code-signature check ({e}). Rebuild the app: {REBUILD}", real.display()))?;
    t.kernel = Some(real);
    Ok(t)
}

/// BUNDLE mode over explicit pins (tests): `exe` is the running app executable; node and kernel are resolved
/// inside ITS bundle (layout.rs) and must hash to the release pins. Nothing absolute from the build machine is used.
/// LAST, right before the caller spawns (Aegis M2 high 1): the node's code signature is verified against
/// `requirement` (SecStaticCode, codesign.rs) on top of the hash, so a swap after the hash must also carry our team's
/// valid signature. The window from here to posix_spawn's own read remains (spec §18.1: App Management protection).
pub fn check_bundle_trust_root_with(exe: &Path, node_sha: &str, tree: &str, requirement: &str) -> Result<TrustRoot, String> {
    if node_sha.is_empty() || tree.is_empty() || requirement.is_empty() {
        return Err(format!("this Gnomon.app carries no node, kernel or code-requirement pin; {REINSTALL}"));
    }
    let contents = contents_of(exe).map_err(|e| format!("Gnomon.app is not a complete app bundle: {e}; {REINSTALL}"))?;
    let (sha, k) = bundle_hashes(&contents).map_err(|e| format!("Gnomon.app's bundled node or kernel is unreadable or was modified ({e}); {REINSTALL}"))?;
    if sha != node_sha {
        return Err(format!("Gnomon.app's bundled node ({NODE_REL}) does not hash to the release pin: the app was modified; {REINSTALL}"));
    }
    if k != tree {
        return Err(format!("Gnomon.app's bundled kernel ({KERNEL_REL}) does not hash to the release pin: the app was modified; {REINSTALL}"));
    }
    let node = inside(&contents, NODE_REL)?;
    let pkg = inside(&contents, KERNEL_REL)?;
    verify_static_code(&node, requirement).map_err(|e| format!("Gnomon.app's bundled node failed its code-signature check ({e}); {REINSTALL}"))?;
    Ok(TrustRoot { node: node.clone(), node_recorded: PathBuf::from(NODE_REL), node_source: "bundle", gnomon_js: pkg.join("dist/cli/gnomon.js"), kernel: None })
}

/// [`check_trust_root`] over explicit pins (tests).
pub fn check_trust_root_with(node: &str, node_sha: &str, source: &'static str, pkg: &Path, tree: &str) -> Result<TrustRoot, String> {
    if node.is_empty() || node_sha.is_empty() {
        return Err(format!("this Gnomon.app was built without a node (none on the build machine's PATH). Rebuild the app with GNOMON_WRAPPER_NODE=<abs path to node>: {REBUILD}"));
    }
    if tree.is_empty() {
        return Err(format!("this Gnomon.app was built before the kernel was (no {}/dist at build time). Rebuild the app: {REBUILD}", pkg.display()));
    }
    let real = std::fs::canonicalize(node).map_err(|_| format!("Gnomon.app was built against a different node: {node} is gone (a `brew upgrade node` removes the old version). Rebuild the app: {REBUILD}"))?;
    let now = sha256_file(&real).map_err(|e| format!("Gnomon.app cannot read its node ({e}). Rebuild the app: {REBUILD}"))?;
    if now != node_sha {
        return Err(format!("Gnomon.app was built against a different node: {node} (now {}) does not hash to the build's pin (a `brew upgrade node`, or a changed binary). Rebuild the app: {REBUILD}", real.display()));
    }
    let k = kernel_tree_hash(pkg).map_err(|e| format!("Gnomon.app was built against a different kernel: {e}. Rebuild the app: {REBUILD}"))?;
    if k != tree {
        return Err(format!("Gnomon.app was built against a different kernel: {}/dist changed since the build (npm run build:gnomon, a git pull, or an edit). Rebuild the app: {REBUILD}", pkg.display()));
    }
    Ok(TrustRoot { node: real, node_recorded: PathBuf::from(node), node_source: source, gnomon_js: pkg.join("dist/cli/gnomon.js"), kernel: None })
}

/// The kernel child's environment: the allowlist from `from`, plus a fixed PATH that starts with node's own dir.
pub fn child_env(from: &[(String, String)], node: &Path) -> Vec<(String, String)> {
    let mut env: Vec<(String, String)> = from.iter().filter(|(k, _)| ENV_ALLOWLIST.contains(&k.as_str())).cloned().collect();
    let node_dir = node.parent().map(|d| d.display().to_string()).unwrap_or_default();
    let path = [node_dir.as_str(), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"].iter().filter(|s| !s.is_empty()).cloned().collect::<Vec<_>>().join(":");
    env.push(("PATH".into(), path));
    env
}

/// The node flags, FIRST and ONLY (T-2026-10-18-030): the kernel's unsafeRuntime REQUIRES
/// `--disable-sigusr1` (a same-user SIGUSR1 would otherwise open the V8 inspector in the
/// process that holds the keys) and refuses every other flag. Never optional for --wrapper.
pub const NODE_FLAGS: [&str; 1] = ["--disable-sigusr1"];

/// The argv after node: `--disable-sigusr1 <gnomon.js> up --wrapper` (or `… dev up --home <h> --wrapper` for the dev rig).
pub fn child_args(gnomon_js: &Path, dev_home: Option<&Path>) -> Vec<String> {
    let mut a: Vec<String> = NODE_FLAGS.iter().map(|s| s.to_string()).collect();
    a.push(gnomon_js.display().to_string());
    match dev_home {
        Some(h) => a.extend(["dev".into(), "up".into(), "--home".into(), h.display().to_string(), "--wrapper".into()]),
        None => a.extend(["up".into(), "--wrapper".into()]),
    }
    a
}

/// The child Command, stdio wired: stdin/stdout piped (the channel), stderr to `stderr`.
pub fn child_command(node: &Path, gnomon_js: &Path, dev_home: Option<&Path>, from_env: &[(String, String)], stderr: Stdio) -> Command {
    let mut c = Command::new(node);
    c.args(child_args(gnomon_js, dev_home)).env_clear().envs(child_env(from_env, node)).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(stderr);
    if let Some(home) = from_env.iter().find(|(k, _)| k == "HOME") {
        c.current_dir(&home.1);
    }
    c
}

/// #kernel-sea: argv of the SEA kernel child, `up --wrapper` (or `dev up --home <h> --wrapper`). No node flag
/// (--disable-sigusr1 is baked into the SEA and execArgvExtension "none" refuses more) and no script (the code is
/// inside the signed binary).
pub fn sea_child_args(dev_home: Option<&Path>) -> Vec<String> {
    match dev_home {
        Some(h) => vec!["dev".into(), "up".into(), "--home".into(), h.display().to_string(), "--wrapper".into()],
        None => vec!["up".into(), "--wrapper".into()],
    }
}

/// #kernel-sea: the SEA kernel child, stdio wired as [`child_command`]; the same env scrub, PATH headed by the dir of
/// `node` (gnomon.node, what the kernel's children run), never the kernel's own dir.
pub fn sea_child_command(kernel: &Path, node: &Path, dev_home: Option<&Path>, from_env: &[(String, String)], stderr: Stdio) -> Command {
    let mut c = Command::new(kernel);
    c.args(sea_child_args(dev_home)).env_clear().envs(child_env(from_env, node)).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(stderr);
    if let Some(home) = from_env.iter().find(|(k, _)| k == "HOME") {
        c.current_dir(&home.1);
    }
    c
}

/// #kernel-sea: the CLI passthrough through the SEA kernel: `gnomon.kernel <args...>`, the [`cli_command`] env scrub.
pub fn sea_cli_command(kernel: &Path, node: &Path, args: &[String], from_env: &[(String, String)]) -> Command {
    let mut c = Command::new(kernel);
    c.args(args).env_clear().envs(child_env(from_env, node));
    c
}

/// `gnomon-wrapper --cli -- <args>` (8.0 M4, Aegis M4 high 1): the CLI passthrough paradigm's `gnomon <verb>` uses, so
/// the wrapper is the ONE trust root for the terminal too. `argv` is the wrapper's full argv (argv[0] first). Returns
/// the kernel CLI args when argv is exactly `<exe> --cli -- <args...>`; `Some(Err)` for a malformed `--cli` (no `--`);
/// `None` when this is not a CLI invocation (the app starts normally).
pub fn parse_cli(argv: &[String]) -> Option<Result<Vec<String>, String>> {
    if argv.get(1).map(String::as_str) != Some("--cli") {
        return None;
    }
    if argv.get(2).map(String::as_str) != Some("--") {
        return Some(Err("usage: gnomon-wrapper --cli -- <gnomon args...>".into()));
    }
    Some(Ok(argv[3..].to_vec()))
}

/// The CLI child's argv after node: `--disable-sigusr1 <gnomon.js> <args...>` (the only node flag, first).
pub fn cli_args(gnomon_js: &Path, args: &[String]) -> Vec<String> {
    let mut a: Vec<String> = NODE_FLAGS.iter().map(|s| s.to_string()).collect();
    a.push(gnomon_js.display().to_string());
    a.extend(args.iter().cloned());
    a
}

/// The CLI child: the SAME env scrub as the app's kernel child (env_clear, then [`ENV_ALLOWLIST`] and a fixed PATH;
/// never NODE_OPTIONS, GNOMON_* or DYLD_*), stdio inherited, the caller's working directory kept (verbs like bare
/// `gnomon` read the folder they are run in). main.rs execs it after [`check_trust_root`], so the exit code and
/// signals are the kernel's own.
pub fn cli_command(node: &Path, gnomon_js: &Path, args: &[String], from_env: &[(String, String)]) -> Command {
    let mut c = Command::new(node);
    c.args(cli_args(gnomon_js, args)).env_clear().envs(child_env(from_env, node));
    c
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env() -> Vec<(String, String)> {
        [("HOME", "/Users/u"), ("NODE_OPTIONS", "--require /x.js"), ("GNOMON_HOME", "/elsewhere"), ("PATH", "/evil"), ("LANG", "en_US.UTF-8"), ("DYLD_INSERT_LIBRARIES", "/x.dylib"), ("ANTHROPIC_API_KEY", "sk")].iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
    }

    #[test]
    fn falsifier_the_child_env_drops_everything_but_the_allowlist() {
        let e = child_env(&env(), Path::new("/opt/homebrew/Cellar/node/26/bin/node"));
        let keys: Vec<&str> = e.iter().map(|(k, _)| k.as_str()).collect();
        assert_eq!(keys, vec!["HOME", "LANG", "PATH"]);
        let path = &e.iter().find(|(k, _)| k == "PATH").unwrap().1;
        assert!(path.starts_with("/opt/homebrew/Cellar/node/26/bin:"));
        assert!(!path.contains("/evil"));
    }

    #[test]
    fn falsifier_argv_carries_no_secret_and_names_the_wrapper_mode() {
        let a = child_args(Path::new("/r/packages/gnomon/dist/cli/gnomon.js"), None);
        assert_eq!(a, vec!["--disable-sigusr1", "/r/packages/gnomon/dist/cli/gnomon.js", "up", "--wrapper"]);
        let c = child_command(Path::new("/usr/bin/true"), Path::new("/g.js"), None, &env(), Stdio::null());
        let args: Vec<String> = c.get_args().map(|s| s.to_string_lossy().to_string()).collect();
        // the spawn's args START with --disable-sigusr1, and it is the only node flag (everything before the script)
        assert_eq!(args.first().map(String::as_str), Some("--disable-sigusr1"));
        let script = args.iter().position(|x| x == "/g.js").unwrap();
        assert_eq!(&args[..script], &["--disable-sigusr1".to_string()]);
        let dev = child_args(Path::new("/g.js"), Some(Path::new("/h")));
        assert_eq!(dev, vec!["--disable-sigusr1", "/g.js", "dev", "up", "--home", "/h", "--wrapper"]);
        assert!(args.iter().all(|x| !x.contains("launch") && !x.contains("token")));
        let envs: Vec<String> = c.get_envs().map(|(k, _)| k.to_string_lossy().to_string()).collect();
        assert!(!envs.iter().any(|k| k == "NODE_OPTIONS" || k.starts_with("GNOMON_") || k.starts_with("DYLD_")), "{envs:?}");
    }

    fn argv(a: &[&str]) -> Vec<String> {
        a.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn cli_mode_needs_the_separator_and_passes_every_arg_after_it() {
        assert_eq!(parse_cli(&argv(&["w"])), None);
        assert_eq!(parse_cli(&argv(&["w", "--build-mode"])), None);
        assert!(matches!(parse_cli(&argv(&["w", "--cli", "identity"])), Some(Err(_))));
        assert_eq!(parse_cli(&argv(&["w", "--cli", "--"])), Some(Ok(vec![])));
        assert_eq!(parse_cli(&argv(&["w", "--cli", "--", "identity", "status", "--", "--cli"])), Some(Ok(argv(&["identity", "status", "--", "--cli"]))));
        assert_eq!(cli_args(Path::new("/k/gnomon.js"), &argv(&["daemon", "stop"])), argv(&["--disable-sigusr1", "/k/gnomon.js", "daemon", "stop"]));
    }

    #[test]
    fn falsifier_the_cli_child_never_sees_node_options_gnomon_or_dyld_vars() {
        // a fake "node" that prints its environment and argv: what the kernel CLI would actually receive
        let d = std::env::temp_dir().canonicalize().unwrap().join(format!("gw-cli-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        let node = d.join("node");
        std::fs::write(&node, b"#!/bin/sh\n/usr/bin/env\necho \"ARGS $*\"\n").unwrap();
        std::fs::set_permissions(&node, std::os::unix::fs::PermissionsExt::from_mode(0o755)).unwrap();
        let mut from = env();
        from.push(("GNOMON_NO_OPEN".into(), "1".into()));
        let out = cli_command(&node, Path::new("/k/gnomon.js"), &argv(&["identity", "status"]), &from).output().unwrap();
        let text = String::from_utf8_lossy(&out.stdout).to_string();
        let keys: Vec<&str> = text.lines().filter_map(|l| l.split_once('=').map(|(k, _)| k)).filter(|k| !k.starts_with("ARGS")).collect();
        for k in &keys {
            assert!(!(k.starts_with("NODE_") || k.starts_with("GNOMON_") || k.starts_with("DYLD_") || *k == "ANTHROPIC_API_KEY"), "{k} leaked: {text}");
        }
        assert!(keys.contains(&"HOME") && keys.contains(&"PATH"), "{text}");
        assert!(text.contains("ARGS --disable-sigusr1 /k/gnomon.js identity status"), "{text}");
        std::fs::remove_dir_all(&d).unwrap();
    }

    /// A private scratch "checkout": pkg/dist/cli/gnomon.js + package.json, and a fake node.
    fn rig(tag: &str) -> (PathBuf, PathBuf, PathBuf) {
        let d = std::env::temp_dir().canonicalize().unwrap().join(format!("gw-trust-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(d.join("pkg/dist/cli")).unwrap();
        std::fs::write(d.join("pkg/dist/cli/gnomon.js"), b"console.log(1)\n").unwrap();
        std::fs::write(d.join("pkg/package.json"), b"{\"type\":\"module\"}\n").unwrap();
        std::fs::create_dir_all(d.join("bin")).unwrap();
        std::fs::write(d.join("bin/node-26"), b"node v26").unwrap();
        std::os::unix::fs::symlink(d.join("bin/node-26"), d.join("bin/node")).unwrap();
        (d.clone(), d.join("pkg"), d.join("bin/node"))
    }

    #[test]
    fn the_trust_root_passes_when_nothing_changed_and_spawns_the_hashed_realpath() {
        let (d, pkg, node) = rig("ok");
        let sha = sha256_file(&d.join("bin/node-26")).unwrap();
        let tree = kernel_tree_hash(&pkg).unwrap();
        let t = check_trust_root_with(node.to_str().unwrap(), &sha, "which", &pkg, &tree).unwrap();
        assert_eq!(t.node, d.join("bin/node-26"));
        assert_eq!(t.node_recorded, node);
        assert_eq!(t.gnomon_js, pkg.join("dist/cli/gnomon.js"));
        std::fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn falsifier_a_brew_upgrade_or_a_changed_node_is_refused_with_the_rebuild_step() {
        let (d, pkg, node) = rig("node");
        let sha = sha256_file(&d.join("bin/node-26")).unwrap();
        let tree = kernel_tree_hash(&pkg).unwrap();
        // `brew upgrade node`: the symlink now points at a new version
        std::fs::write(d.join("bin/node-27"), b"node v27").unwrap();
        std::fs::remove_file(&node).unwrap();
        std::os::unix::fs::symlink(d.join("bin/node-27"), &node).unwrap();
        let e = check_trust_root_with(node.to_str().unwrap(), &sha, "which", &pkg, &tree).unwrap_err();
        assert!(e.contains("built against a different node") && e.contains("brew upgrade node") && e.contains("Rebuild the app"), "{e}");
        // the old version removed and the link dangling
        std::fs::remove_file(d.join("bin/node-27")).unwrap();
        let e = check_trust_root_with(node.to_str().unwrap(), &sha, "which", &pkg, &tree).unwrap_err();
        assert!(e.contains("is gone") && e.contains("Rebuild the app"), "{e}");
        std::fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn falsifier_a_modified_kernel_is_refused_with_the_rebuild_step() {
        let (d, pkg, node) = rig("tree");
        let sha = sha256_file(&d.join("bin/node-26")).unwrap();
        let tree = kernel_tree_hash(&pkg).unwrap();
        std::fs::write(pkg.join("dist/cli/gnomon.js"), b"console.log('changed')\n").unwrap();
        let e = check_trust_root_with(node.to_str().unwrap(), &sha, "which", &pkg, &tree).unwrap_err();
        assert!(e.contains("built against a different kernel") && e.contains("Rebuild the app"), "{e}");
        // an added file, a symlink and a package.json change all move it
        std::fs::write(pkg.join("dist/cli/gnomon.js"), b"console.log(1)\n").unwrap();
        assert!(check_trust_root_with(node.to_str().unwrap(), &sha, "which", &pkg, &tree).is_ok());
        std::fs::write(pkg.join("dist/extra.js"), b"x").unwrap();
        assert!(check_trust_root_with(node.to_str().unwrap(), &sha, "which", &pkg, &tree).is_err());
        std::fs::remove_file(pkg.join("dist/extra.js")).unwrap();
        std::os::unix::fs::symlink("/etc/hosts", pkg.join("dist/link.js")).unwrap();
        assert!(check_trust_root_with(node.to_str().unwrap(), &sha, "which", &pkg, &tree).unwrap_err().contains("symlink"));
        std::fs::remove_file(pkg.join("dist/link.js")).unwrap();
        std::fs::write(pkg.join("package.json"), b"{\"type\":\"commonjs\"}\n").unwrap();
        assert!(check_trust_root_with(node.to_str().unwrap(), &sha, "which", &pkg, &tree).is_err());
        std::fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn falsifier_an_app_built_without_node_or_dist_refuses() {
        assert!(check_trust_root_with("", "", "none", Path::new("/nope"), "sha256:x").unwrap_err().contains("without a node"));
        assert!(check_trust_root_with("/bin/sh", "x", "which", Path::new("/nope"), "").unwrap_err().contains("before the kernel"));
    }

    fn signed_copy(from: &Path, to: &Path, identifier: &str) {
        std::fs::create_dir_all(to.parent().unwrap()).unwrap();
        std::fs::copy(from, to).unwrap();
        let ok = Command::new("/usr/bin/codesign").args(["--force", "--sign", "-", "--identifier", identifier]).arg(to).output().unwrap();
        assert!(ok.status.success(), "{}", String::from_utf8_lossy(&ok.stderr));
    }

    fn req() -> String {
        crate::layout::node_requirement("adhoc").unwrap()
    }

    /// A private scratch release app: X.app/Contents/{MacOS/gnomon-wrapper, Resources/node/bin/node, Resources/kernel}.
    fn app_rig(tag: &str) -> (PathBuf, PathBuf) {
        let d = std::env::temp_dir().canonicalize().unwrap().join(format!("gw-bundle-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        let c = d.join("first/Gnomon.app/Contents");
        std::fs::create_dir_all(c.join("MacOS")).unwrap();
        std::fs::write(c.join("MacOS/gnomon-wrapper"), b"wrapper").unwrap();
        std::fs::create_dir_all(c.join("Resources/node/bin")).unwrap();
        // a real Mach-O, ad-hoc signed with the bundled node's identifier (what an --unsigned release produces)
        signed_copy(Path::new("/usr/bin/true"), &d.join("pristine-node"), crate::layout::NODE_IDENTIFIER);
        std::fs::copy(d.join("pristine-node"), c.join(NODE_REL)).unwrap();
        std::fs::create_dir_all(c.join("Resources/kernel/dist/cli")).unwrap();
        std::fs::write(c.join("Resources/kernel/dist/cli/gnomon.js"), b"console.log(1)\n").unwrap();
        std::fs::write(c.join("Resources/kernel/package.json"), b"{\"type\":\"module\"}\n").unwrap();
        (d, c)
    }

    #[test]
    fn relocation_a_moved_bundle_resolves_inside_its_new_location() {
        let (d, c) = app_rig("move");
        // the pins build.rs would compile from a stage with the same bytes (layout::bundle_hashes is shared)
        let (sha, tree) = bundle_hashes(&c).unwrap();
        let t = check_bundle_trust_root_with(&c.join("MacOS/gnomon-wrapper"), &sha, &tree, &req()).unwrap();
        assert_eq!(t.node, c.join(NODE_REL));
        assert_eq!(t.gnomon_js, c.join("Resources/kernel/dist/cli/gnomon.js"));
        assert_eq!((t.node_source, t.node_recorded.as_path()), ("bundle", Path::new(NODE_REL)));
        // M4 copies the app to ~/Applications: move it, the old location is gone, the same pins hold at the new one
        std::fs::create_dir_all(d.join("Applications")).unwrap();
        std::fs::rename(d.join("first/Gnomon.app"), d.join("Applications/Gnomon.app")).unwrap();
        std::fs::remove_dir_all(d.join("first")).unwrap();
        let moved = d.join("Applications/Gnomon.app/Contents");
        let t2 = check_bundle_trust_root_with(&moved.join("MacOS/gnomon-wrapper"), &sha, &tree, &req()).unwrap();
        assert_eq!(t2.node, moved.join(NODE_REL));
        assert_eq!(t2.gnomon_js, moved.join("Resources/kernel/dist/cli/gnomon.js"));
        // a symlink to the app's executable resolves to the real bundle (realpath), not the link's directory
        std::os::unix::fs::symlink(moved.join("MacOS/gnomon-wrapper"), d.join("gnomon-link")).unwrap();
        assert_eq!(check_bundle_trust_root_with(&d.join("gnomon-link"), &sha, &tree, &req()).unwrap().node, moved.join(NODE_REL));
        std::fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn build_pins_from_the_stage_equal_the_assembled_bundle() {
        // build.rs hashes a Contents-shaped STAGE (not inside any .app); the release script then copies the same bytes
        // into Gnomon.app/Contents: the app's run-time recomputation must equal the compiled pins
        let (d, c) = app_rig("stage");
        let stage = d.join("stage/Contents");
        std::fs::create_dir_all(stage.join("Resources/node/bin")).unwrap();
        std::fs::copy(c.join(NODE_REL), stage.join(NODE_REL)).unwrap();
        std::fs::create_dir_all(stage.join("Resources/kernel/dist/cli")).unwrap();
        std::fs::copy(c.join("Resources/kernel/dist/cli/gnomon.js"), stage.join("Resources/kernel/dist/cli/gnomon.js")).unwrap();
        std::fs::copy(c.join("Resources/kernel/package.json"), stage.join("Resources/kernel/package.json")).unwrap();
        let pins = bundle_hashes(&stage).unwrap();
        assert_eq!(pins, bundle_hashes(&c).unwrap());
        assert!(check_bundle_trust_root_with(&c.join("MacOS/gnomon-wrapper"), &pins.0, &pins.1, &req()).is_ok());
        // a stage without the node fails (build.rs panics: never a pinless bundle)
        std::fs::remove_file(stage.join(NODE_REL)).unwrap();
        assert!(bundle_hashes(&stage).is_err());
        std::fs::remove_dir_all(&d).unwrap();
    }

    /// The release script's JS twin (packages/gnomon/scripts/release-darwin.mjs kernelTreeHash, asserted to the same
    /// constant in packages/gnomon/test/release-darwin.test.ts) computes the identical gnomon-wrapper-kernel-tree:v1.
    #[test]
    fn the_kernel_tree_hash_equals_the_release_scripts_vector() {
        let (d, pkg, _) = rig("vector");
        assert_eq!(kernel_tree_hash(&pkg).unwrap(), "sha256:1c36bf6b177d07ce096f770c9cd046f3b297cc562b7ad77b495aefc9e01035f9");
        std::fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn falsifier_a_modified_bundle_is_refused_with_reinstall() {
        let (d, c) = app_rig("mod");
        let (sha, tree) = bundle_hashes(&c).unwrap();
        let exe = c.join("MacOS/gnomon-wrapper");
        std::fs::write(c.join(NODE_REL), b"another node").unwrap();
        let e = check_bundle_trust_root_with(&exe, &sha, &tree, &req()).unwrap_err();
        assert!(e.contains("bundled node") && e.contains("reinstall Gnomon"), "{e}");
        std::fs::remove_file(c.join(NODE_REL)).unwrap();
        std::fs::copy(d.join("pristine-node"), c.join(NODE_REL)).unwrap();
        assert!(check_bundle_trust_root_with(&exe, &sha, &tree, &req()).is_ok());
        std::fs::write(c.join("Resources/kernel/dist/extra.js"), b"x").unwrap();
        assert!(check_bundle_trust_root_with(&exe, &sha, &tree, &req()).unwrap_err().contains("bundled kernel"));
        std::fs::remove_file(c.join("Resources/kernel/dist/extra.js")).unwrap();
        // node swapped for a symlink to an identical file OUTSIDE the bundle: refused (never followed out)
        std::fs::copy(d.join("pristine-node"), d.join("outside-node")).unwrap();
        std::fs::remove_file(c.join(NODE_REL)).unwrap();
        std::os::unix::fs::symlink(d.join("outside-node"), c.join(NODE_REL)).unwrap();
        assert!(check_bundle_trust_root_with(&exe, &sha, &tree, &req()).unwrap_err().contains("symlink"));
        // not inside an app bundle at all, or no pins compiled
        assert!(check_bundle_trust_root_with(&d.join("outside-node"), &sha, &tree, &req()).unwrap_err().contains("not a complete app bundle"));
        assert!(check_bundle_trust_root_with(&exe, "", "", &req()).unwrap_err().contains("no node, kernel or code-requirement pin"));
        assert!(check_bundle_trust_root_with(&exe, &sha, &tree, "").unwrap_err().contains("code-requirement pin"));
        std::fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn falsifier_the_node_signature_is_checked_on_top_of_the_hash() {
        let (d, c) = app_rig("sig");
        let exe = c.join("MacOS/gnomon-wrapper");
        // a node signed under ANOTHER identifier, with pins recomputed to match it (an attacker who can also forge
        // the hash pin still needs our signature): refused by the requirement, not the hash
        std::fs::remove_file(c.join(NODE_REL)).unwrap();
        signed_copy(Path::new("/usr/bin/true"), &c.join(NODE_REL), "evil.node");
        let (sha, tree) = bundle_hashes(&c).unwrap();
        let e = check_bundle_trust_root_with(&exe, &sha, &tree, &req()).unwrap_err();
        assert!(e.contains("code-signature check") && e.contains("reinstall Gnomon"), "{e}");
        // the shipped (developer-id) requirement refuses an ad-hoc node even with the right identifier
        std::fs::remove_file(c.join(NODE_REL)).unwrap();
        std::fs::copy(d.join("pristine-node"), c.join(NODE_REL)).unwrap();
        let (sha, tree) = bundle_hashes(&c).unwrap();
        assert!(check_bundle_trust_root_with(&exe, &sha, &tree, &req()).is_ok());
        let team = crate::layout::node_requirement("developer-id").unwrap();
        assert!(team.contains("SW4BMQ8PNL") && team.contains("gnomon.node"));
        assert!(check_bundle_trust_root_with(&exe, &sha, &tree, &team).unwrap_err().contains("code-signature check"));
        std::fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn falsifier_a_hard_linked_pinned_file_is_refused() {
        let (d, c) = app_rig("nlink");
        let exe = c.join("MacOS/gnomon-wrapper");
        let (sha, tree) = bundle_hashes(&c).unwrap();
        // a second name for node OUTSIDE the bundle: it could be rewritten through that name
        std::fs::hard_link(c.join(NODE_REL), d.join("node-alias")).unwrap();
        assert!(check_bundle_trust_root_with(&exe, &sha, &tree, &req()).unwrap_err().contains("hard-linked"));
        std::fs::remove_file(d.join("node-alias")).unwrap();
        assert!(check_bundle_trust_root_with(&exe, &sha, &tree, &req()).is_ok());
        std::fs::hard_link(c.join("Resources/kernel/dist/cli/gnomon.js"), d.join("js-alias")).unwrap();
        assert!(check_bundle_trust_root_with(&exe, &sha, &tree, &req()).unwrap_err().contains("hard-linked"));
        std::fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn the_layout_refuses_paths_that_are_not_an_app_executable() {
        let (d, c) = app_rig("shape");
        assert_eq!(contents_of(&c.join("MacOS/gnomon-wrapper")).unwrap(), c);
        std::fs::write(c.join("Resources/stray"), b"x").unwrap();
        assert!(contents_of(&c.join("Resources/stray")).is_err());
        std::fs::create_dir_all(d.join("plain/Contents/MacOS")).unwrap();
        std::fs::write(d.join("plain/Contents/MacOS/w"), b"x").unwrap();
        assert!(contents_of(&d.join("plain/Contents/MacOS/w")).unwrap_err().contains(".app"));
        std::fs::remove_dir_all(&d).unwrap();
    }

    /// app_rig + a SEA kernel at Contents/KERNEL_EXE_REL, ad-hoc signed as `identifier`.
    fn sea_rig(tag: &str, identifier: &str) -> (PathBuf, PathBuf) {
        let (d, c) = app_rig(tag);
        signed_copy(Path::new("/usr/bin/true"), &c.join(KERNEL_EXE_REL), identifier);
        (d, c)
    }

    fn kreq() -> String {
        crate::layout::kernel_requirement("adhoc").unwrap()
    }

    #[test]
    fn sea_the_bundle_spawns_the_signed_kernel_with_no_node_flag_and_no_script() {
        let (d, c) = sea_rig("sea-ok", crate::layout::KERNEL_IDENTIFIER);
        let exe = c.join("MacOS/gnomon-wrapper");
        let (sha, tree) = bundle_hashes(&c).unwrap();
        let ksha = kernel_exe_hash(&c).unwrap();
        let t = check_bundle_sea_with(&exe, &sha, &tree, &req(), &ksha, &kreq()).unwrap();
        assert_eq!(t.kernel.as_deref(), Some(c.join(KERNEL_EXE_REL).as_path()));
        assert_eq!(sea_child_args(None), vec!["up", "--wrapper"]);
        assert_eq!(sea_child_args(Some(Path::new("/h"))), vec!["dev", "up", "--home", "/h", "--wrapper"]);
        let cmd = sea_child_command(t.kernel.as_ref().unwrap(), &t.node, None, &env(), Stdio::null());
        assert_eq!(cmd.get_program(), c.join(KERNEL_EXE_REL).as_os_str());
        let args: Vec<String> = cmd.get_args().map(|s| s.to_string_lossy().to_string()).collect();
        assert!(!args.iter().any(|a| a.starts_with("--disable") || a.ends_with(".js")), "{args:?}");
        let envs: Vec<(String, String)> = cmd.get_envs().map(|(k, v)| (k.to_string_lossy().to_string(), v.map(|v| v.to_string_lossy().to_string()).unwrap_or_default())).collect();
        assert!(!envs.iter().any(|(k, _)| k == "NODE_OPTIONS" || k.starts_with("GNOMON_") || k.starts_with("DYLD_")), "{envs:?}");
        // PATH is headed by gnomon.node's dir (what the kernel's children run), never the kernel's
        let path = &envs.iter().find(|(k, _)| k == "PATH").unwrap().1;
        assert!(path.starts_with(&c.join("Resources/node/bin").display().to_string()), "{path}");
        std::fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn falsifier_sea_a_modified_unsigned_or_missing_kernel_is_refused() {
        let (d, c) = sea_rig("sea-mod", crate::layout::KERNEL_IDENTIFIER);
        let exe = c.join("MacOS/gnomon-wrapper");
        let (sha, tree) = bundle_hashes(&c).unwrap();
        let ksha = kernel_exe_hash(&c).unwrap();
        // no kernel pin compiled: refused
        assert!(check_bundle_sea_with(&exe, &sha, &tree, &req(), "", &kreq()).unwrap_err().contains("no signed-kernel pin"));
        // another identifier with a recomputed hash: refused by the requirement
        std::fs::remove_file(c.join(KERNEL_EXE_REL)).unwrap();
        signed_copy(Path::new("/usr/bin/true"), &c.join(KERNEL_EXE_REL), "evil.kernel");
        let evil = kernel_exe_hash(&c).unwrap();
        assert!(check_bundle_sea_with(&exe, &sha, &tree, &req(), &evil, &kreq()).unwrap_err().contains("code-signature check"));
        // the right identifier but different bytes than the pin: refused by the hash
        assert!(check_bundle_sea_with(&exe, &sha, &tree, &req(), &ksha, &kreq()).unwrap_err().contains("does not hash"));
        // the shipped requirement refuses an ad-hoc kernel
        std::fs::remove_file(c.join(KERNEL_EXE_REL)).unwrap();
        signed_copy(Path::new("/usr/bin/true"), &c.join(KERNEL_EXE_REL), crate::layout::KERNEL_IDENTIFIER);
        let team = crate::layout::kernel_requirement("developer-id").unwrap();
        assert!(team.contains("SW4BMQ8PNL") && team.contains("identifier \"gnomon.kernel\""));
        assert!(check_bundle_sea_with(&exe, &sha, &tree, &req(), &kernel_exe_hash(&c).unwrap(), &team).unwrap_err().contains("code-signature check"));
        // a hard link to the kernel: refused
        std::fs::hard_link(c.join(KERNEL_EXE_REL), d.join("kernel-alias")).unwrap();
        assert!(check_bundle_sea_with(&exe, &sha, &tree, &req(), &ksha, &kreq()).is_err());
        std::fs::remove_file(d.join("kernel-alias")).unwrap();
        // missing: refused
        std::fs::remove_file(c.join(KERNEL_EXE_REL)).unwrap();
        assert!(check_bundle_sea_with(&exe, &sha, &tree, &req(), &ksha, &kreq()).unwrap_err().contains("signed kernel"));
        std::fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn sea_the_cli_passthrough_passes_args_only_with_the_scrubbed_env() {
        let (d, _pkg, node) = rig("sea-cli");
        // a fake SEA that prints its env and argv
        let k = d.join("gnomon.kernel");
        std::fs::write(&k, b"#!/bin/sh\n/usr/bin/env\necho \"ARGS $*\"\n").unwrap();
        std::fs::set_permissions(&k, std::os::unix::fs::PermissionsExt::from_mode(0o755)).unwrap();
        let out = sea_cli_command(&k, &node, &argv(&["identity", "status"]), &env()).output().unwrap();
        let text = String::from_utf8_lossy(&out.stdout).to_string();
        assert!(text.contains("ARGS identity status\n"), "{text}");
        assert!(!text.contains("NODE_OPTIONS") && !text.contains("GNOMON_HOME") && !text.contains("DYLD_"), "{text}");
        std::fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn falsifier_sea_dev_app_accepts_only_a_hash_pinned_gnomon_kernel_dev() {
        let (d, pkg, node) = rig("sea-dev");
        let sha = sha256_file(&d.join("bin/node-26")).unwrap();
        let tree = kernel_tree_hash(&pkg).unwrap();
        let dev = crate::layout::kernel_dev_requirement();
        assert_eq!(dev, "identifier \"gnomon.kernel.dev\"");
        let k = pkg.join("gnomon.kernel");
        signed_copy(Path::new("/usr/bin/true"), &k, crate::layout::KERNEL_DEV_IDENTIFIER);
        let ksha = sha256_file(&k).unwrap();
        let t = check_trust_root_with(node.to_str().unwrap(), &sha, "sea-dev", &pkg, &tree).unwrap();
        assert_eq!(check_dev_sea_with(t.clone(), &k, &ksha, &dev).unwrap().kernel.as_deref(), Some(k.as_path()));
        // no requirement compiled: refused
        assert!(check_dev_sea_with(t.clone(), &k, &ksha, "").unwrap_err().contains("without its code requirement"));
        // a production-identified kernel in a dev app: refused by the requirement, even with its hash pinned
        signed_copy(Path::new("/usr/bin/true"), &k, crate::layout::KERNEL_IDENTIFIER);
        let prod = sha256_file(&k).unwrap();
        assert!(check_dev_sea_with(t.clone(), &k, &prod, &dev).unwrap_err().contains("code-signature check"));
        // changed bytes, then gone
        assert!(check_dev_sea_with(t.clone(), &k, &ksha, &dev).unwrap_err().contains("different SEA kernel"));
        std::fs::remove_file(&k).unwrap();
        assert!(check_dev_sea_with(t, &k, &ksha, &dev).unwrap_err().contains("is gone"));
        // a release requirement never accepts the dev identifier
        signed_copy(Path::new("/usr/bin/true"), &k, crate::layout::KERNEL_DEV_IDENTIFIER);
        assert!(verify_static_code(&k, &crate::layout::kernel_requirement("adhoc").unwrap()).is_err());
        std::fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn this_build_is_dev_or_a_complete_bundle() {
        assert!(BUILD_MODE == "dev" || BUILD_MODE == "bundle", "{BUILD_MODE}");
        if BUILD_MODE == "bundle" {
            assert_eq!((BUILD_NODE, BUILD_GNOMON_PKG, BUILD_NODE_SOURCE), (NODE_REL, KERNEL_REL, "bundle"));
            assert!(BUILD_KERNEL_TREE.starts_with("sha256:") && BUILD_NODE_SHA256.len() == 64);
            // a bundle build compiles NO absolute path from the build machine
            assert!(!BUILD_NODE.starts_with('/') && !BUILD_GNOMON_PKG.starts_with('/'));
            assert!(BUILD_NODE_REQUIREMENT.contains("identifier \"gnomon.node\""));
            assert_eq!(BUILD_KERNEL_EXE, KERNEL_EXE_REL);
            assert!(BUILD_KERNEL_EXE_SHA256.len() == 64 && BUILD_KERNEL_EXE_REQUIREMENT.contains("identifier \"gnomon.kernel\""));
        } else {
            assert!(BUILD_NODE_REQUIREMENT.is_empty());
            assert_eq!(BUILD_KERNEL_EXE.is_empty(), BUILD_KERNEL_EXE_SHA256.is_empty());
            // Aegis H2: a dev app pins only a gnomon.kernel.dev SEA
            assert_eq!(BUILD_KERNEL_EXE_REQUIREMENT.is_empty(), BUILD_KERNEL_EXE.is_empty());
            if !BUILD_KERNEL_EXE.is_empty() {
                assert_eq!(BUILD_KERNEL_EXE_REQUIREMENT, crate::layout::kernel_dev_requirement());
            }
        }
    }

    #[test]
    fn this_build_recorded_both_pins() {
        // the dev machine and CI's native job build dist first (gnomon.yml), so both pins exist
        if std::env::var("CI").is_ok() || !BUILD_KERNEL_TREE.is_empty() {
            assert!(BUILD_KERNEL_TREE.starts_with("sha256:"), "the build recorded no kernel tree: build packages/gnomon/dist first");
            assert_eq!(BUILD_NODE_SHA256.len(), 64);
        }
    }
}
