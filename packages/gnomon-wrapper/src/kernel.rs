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
//! The local lane config's runner node (`local.signed.json`) is NOT a source
//! (Aegis C2): the wrapper does not verify its root signature yet.
//! Windows (the parity phase) needs its own pipe + job-object spawn: this is the seam.
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use crate::tree::{kernel_tree_hash, sha256_file};

pub const BUILD_NODE: &str = env!("GNOMON_BUILD_NODE");
pub const BUILD_NODE_SHA256: &str = env!("GNOMON_BUILD_NODE_SHA256");
pub const BUILD_NODE_SOURCE: &str = env!("GNOMON_BUILD_NODE_SOURCE");
pub const BUILD_GNOMON_PKG: &str = env!("GNOMON_BUILD_GNOMON_PKG");
pub const BUILD_KERNEL_TREE: &str = env!("GNOMON_BUILD_KERNEL_TREE");

/// The command that rebuilds the app (named in every trust-root refusal).
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
    /// "build-env" | "which"
    pub node_source: &'static str,
    pub gnomon_js: PathBuf,
}

/// The node + kernel pins recorded in this binary, re-checked now.
pub fn check_trust_root() -> Result<TrustRoot, String> {
    check_trust_root_with(BUILD_NODE, BUILD_NODE_SHA256, BUILD_NODE_SOURCE, Path::new(BUILD_GNOMON_PKG), BUILD_KERNEL_TREE)
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
    Ok(TrustRoot { node: real, node_recorded: PathBuf::from(node), node_source: source, gnomon_js: pkg.join("dist/cli/gnomon.js") })
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

    #[test]
    fn this_build_recorded_both_pins() {
        // the dev machine and CI's native job build dist first (gnomon.yml), so both pins exist
        if std::env::var("CI").is_ok() || !BUILD_KERNEL_TREE.is_empty() {
            assert!(BUILD_KERNEL_TREE.starts_with("sha256:"), "the build recorded no kernel tree: build packages/gnomon/dist first");
            assert_eq!(BUILD_NODE_SHA256.len(), 64);
        }
    }
}
