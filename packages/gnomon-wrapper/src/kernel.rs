//! #gnomon-wrapper kernel child (spec §2.4 rule 7 `gnomon up`, §11.2 rule 2; M1.13).
//! Gnomon.app runs `node <dist>/cli/gnomon.js up --wrapper` as a supervised
//! child: the same hardened in-process path as `gnomon up` in a terminal
//! (openHardwareIdentity, the unsafe-env refusal), with
//!   - a CLEAN environment: env_clear, then only HOME USER LOGNAME LANG TMPDIR
//!     SHELL from the app's own (launchd) env, and a fixed PATH — never
//!     NODE_OPTIONS, never any GNOMON_* (the kernel would refuse NODE_OPTIONS
//!     anyway, Aegis C1);
//!   - argv that never carries a secret (no token exists yet when it starts);
//!   - stdin/stdout as private pipes (the launch channel), stderr to the
//!     app's log file.
//! Node discovery ([`find_node`]): the pinned node of the local lane config
//! (`<home>/local.signed.json` row.local.runner.node, accepted only when its
//! sha256 matches the row's nodeSha256), else the node recorded at build time
//! (`GNOMON_BUILD_NODE`, inside the signed binary). The source is reported.
//! Windows (the parity phase) needs its own pipe + job-object spawn: this is the seam.
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use sha2::{Digest, Sha256};

use crate::verify::hex;

pub const BUILD_NODE: &str = env!("GNOMON_BUILD_NODE");
pub const BUILD_NODE_SOURCE: &str = env!("GNOMON_BUILD_NODE_SOURCE");
pub const BUILD_GNOMON_JS: &str = env!("GNOMON_BUILD_GNOMON_JS");

/// The env names copied from the app's own environment (all others are dropped).
pub const ENV_ALLOWLIST: [&str; 6] = ["HOME", "USER", "LOGNAME", "LANG", "TMPDIR", "SHELL"];

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NodeSource {
    /// `<home>/local.signed.json` runner.node, sha256 matching runner.nodeSha256
    LocalConfig,
    /// recorded in the app at build time (build env GNOMON_WRAPPER_NODE)
    BuildEnv,
    /// recorded in the app at build time (realpath of `which node` on the build machine)
    BuildWhich,
}

impl std::fmt::Display for NodeSource {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            NodeSource::LocalConfig => "local config (local.signed.json runner.node, sha256 checked)",
            NodeSource::BuildEnv => "recorded at build (GNOMON_WRAPPER_NODE)",
            NodeSource::BuildWhich => "recorded at build (realpath of `which node`)",
        })
    }
}

fn sha256_file(p: &Path) -> Option<String> {
    std::fs::read(p).ok().map(|b| hex(&Sha256::digest(&b)))
}

/// The local config's pinned node, if present AND its bytes match the pin.
pub fn local_config_node(home: &Path) -> Option<PathBuf> {
    let text = std::fs::read_to_string(home.join("local.signed.json")).ok()?;
    let v: serde_json::Value = serde_json::from_str(&text).ok()?;
    let runner = v.get("row")?.get("local")?.get("runner")?;
    let node = PathBuf::from(runner.get("node")?.as_str()?);
    let want = runner.get("nodeSha256")?.as_str()?.trim_start_matches("sha256:").to_ascii_lowercase();
    if !node.is_absolute() {
        return None;
    }
    (sha256_file(&node)? == want).then_some(node)
}

/// Which node runs the kernel, and why.
pub fn find_node(home: &Path) -> Result<(PathBuf, NodeSource), String> {
    if let Some(n) = local_config_node(home) {
        return Ok((n, NodeSource::LocalConfig));
    }
    if BUILD_NODE.is_empty() {
        return Err("this Gnomon.app was built without a node path (no node on the build machine's PATH); rebuild with GNOMON_WRAPPER_NODE=<abs path to node>".into());
    }
    let src = if BUILD_NODE_SOURCE == "build-env" { NodeSource::BuildEnv } else { NodeSource::BuildWhich };
    let p = PathBuf::from(BUILD_NODE);
    if !p.is_file() {
        return Err(format!("the node recorded at build time is gone: {BUILD_NODE}"));
    }
    Ok((p, src))
}

/// The kernel child's environment: the allowlist from `from`, plus a fixed PATH that starts with node's own dir.
pub fn child_env(from: &[(String, String)], node: &Path) -> Vec<(String, String)> {
    let mut env: Vec<(String, String)> = from.iter().filter(|(k, _)| ENV_ALLOWLIST.contains(&k.as_str())).cloned().collect();
    let node_dir = node.parent().map(|d| d.display().to_string()).unwrap_or_default();
    let path = [node_dir.as_str(), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"].iter().filter(|s| !s.is_empty()).cloned().collect::<Vec<_>>().join(":");
    env.push(("PATH".into(), path));
    env
}

/// The argv after node: `<gnomon.js> up --wrapper` (or `dev up --home <h> --wrapper` for the dev rig).
pub fn child_args(gnomon_js: &Path, dev_home: Option<&Path>) -> Vec<String> {
    let mut a = vec![gnomon_js.display().to_string()];
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
        assert_eq!(a, vec!["/r/packages/gnomon/dist/cli/gnomon.js", "up", "--wrapper"]);
        let c = child_command(Path::new("/usr/bin/true"), Path::new("/g.js"), None, &env(), Stdio::null());
        let args: Vec<String> = c.get_args().map(|s| s.to_string_lossy().to_string()).collect();
        assert!(args.iter().all(|x| !x.contains("launch") && !x.contains("token")));
        let envs: Vec<String> = c.get_envs().map(|(k, _)| k.to_string_lossy().to_string()).collect();
        assert!(!envs.iter().any(|k| k == "NODE_OPTIONS" || k.starts_with("GNOMON_") || k.starts_with("DYLD_")), "{envs:?}");
    }

    #[test]
    fn the_local_config_node_needs_a_matching_sha256() {
        let d = std::env::temp_dir().join(format!("gw-node-{}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        let fake = d.join("node");
        std::fs::write(&fake, b"#!/bin/sh\n").unwrap();
        let good = hex(&Sha256::digest(b"#!/bin/sh\n"));
        let cfg = |sha: &str| format!(r#"{{"row":{{"local":{{"runner":{{"node":"{}","nodeSha256":"{sha}"}}}}}}}}"#, fake.display());
        std::fs::write(d.join("local.signed.json"), cfg(&good)).unwrap();
        assert_eq!(local_config_node(&d), Some(fake.clone()));
        std::fs::write(d.join("local.signed.json"), cfg(&"0".repeat(64))).unwrap();
        assert_eq!(local_config_node(&d), None);
        std::fs::remove_dir_all(&d).unwrap();
    }
}
