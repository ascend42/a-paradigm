//! #gnomon-wrapper relocatable bundle layout (TD-2026-10-21-758, T-2026-10-21-029; 8.0 M2), shared verbatim by
//! build.rs (`#[path]`) and the app, like tree.rs: the paths build.rs hashes in the release STAGE are exactly the
//! paths the app re-hashes inside its own bundle at run time.
//!
//! A release Gnomon.app (packages/gnomon/scripts/release-darwin.mjs) is:
//!   Contents/MacOS/gnomon-wrapper            this binary
//!   Contents/Resources/node/bin/node         the pinned official Node 24 (packages/gnomon-wrapper/bundled-node.lock.json)
//!   Contents/Resources/kernel/{dist,package.json}   the build:release kernel, GUI embedded, zero runtime deps
//!   Contents/Resources/kernel/gnomon.kernel  the signed SEA kernel (#kernel-sea): what the app spawns; its node
//!                                            children run Resources/node/bin/node (gnomon.node)
//!   Contents/Resources/gnomon-voice/         the voice client package (+ node_modules/sherpa-onnx-*)
//!   Contents/Resources/gnomon-mods/          the first-party mods (8.0 M4; the kernel's, not checked here)
//!   Contents/Helpers/GnomonHelper.app, Contents/Helpers/GnomonVoiceIO.app
//! The stage the release script hands build.rs (env GNOMON_WRAPPER_BUNDLE_STAGE) is a `Contents`-shaped directory,
//! so every relative path below is relative to `Contents` in both places.
//! Every path is resolved from the app's own executable at run time, never from the build machine, so the app
//! runs wherever it is copied (~/Applications, /Applications, a Downloads folder).
use std::path::{Path, PathBuf};

/// The bundled node, relative to `Contents`.
pub const NODE_REL: &str = "Resources/node/bin/node";
/// The kernel package (dist + package.json), relative to `Contents`.
pub const KERNEL_REL: &str = "Resources/kernel";
/// The code-signing identifier the release script gives the bundled node (`codesign --identifier`).
pub const NODE_IDENTIFIER: &str = "gnomon.node";
/// Our Developer ID team (the same as packages/gnomon-helper/scripts/signing.mjs TEAM).
pub const TEAM: &str = "SW4BMQ8PNL";

/// The designated requirement the bundled node must meet at spawn (codesign.rs), by how the release was signed:
/// `developer-id` (a shipped release: Apple anchor, Developer ID CA + leaf, our team, our identifier) or `adhoc`
/// (an --unsigned CI/test release: the identifier only; the sha256 pin is what binds its bytes).
pub fn node_requirement(signing: &str) -> Result<String, String> {
    match signing {
        "developer-id" => Ok(format!("anchor apple generic and certificate 1[field.1.2.840.113635.100.6.2.6] exists and certificate leaf[field.1.2.840.113635.100.6.1.13] exists and certificate leaf[subject.OU] = \"{TEAM}\" and identifier \"{NODE_IDENTIFIER}\"")),
        "adhoc" => Ok(format!("identifier \"{NODE_IDENTIFIER}\"")),
        other => Err(format!("unknown bundle signing {other:?} (developer-id | adhoc)")),
    }
}

/// #kernel-sea (TD-2026-10-29-746, spec P8-D68): the signed SEA kernel the app spawns, relative to `Contents`. It
/// sits at the kernel package root, beside dist/ (packages/gnomon/scripts/build-sea.mjs, sea-prelude.mjs).
pub const KERNEL_EXE_REL: &str = "Resources/kernel/gnomon.kernel";
/// The code-signing identifier of the SEA kernel (build-sea.mjs KERNEL_IDENTIFIER; what the helper certifies).
pub const KERNEL_IDENTIFIER: &str = "gnomon.kernel";
/// A DEV SEA's identifier (npm run build:sea; Aegis S0 H2). A dev app accepts only this; a release only
/// KERNEL_IDENTIFIER, so a dev build never passes as the production kernel.
pub const KERNEL_DEV_IDENTIFIER: &str = "gnomon.kernel.dev";

/// The requirement a DEV app checks on its pinned dev SEA right before the spawn (on top of the sha256 pin).
pub fn kernel_dev_requirement() -> String {
    format!("identifier \"{KERNEL_DEV_IDENTIFIER}\"")
}

/// The designated requirement the SEA kernel must meet at spawn, by how the release was signed (as node_requirement):
/// `developer-id` (Apple anchor, Developer ID CA + leaf, our team, identifier gnomon.kernel) or `adhoc` (identifier only).
pub fn kernel_requirement(signing: &str) -> Result<String, String> {
    match signing {
        "developer-id" => Ok(format!("anchor apple generic and certificate 1[field.1.2.840.113635.100.6.2.6] exists and certificate leaf[field.1.2.840.113635.100.6.1.13] exists and certificate leaf[subject.OU] = \"{TEAM}\" and identifier \"{KERNEL_IDENTIFIER}\"")),
        "adhoc" => Ok(format!("identifier \"{KERNEL_IDENTIFIER}\"")),
        other => Err(format!("unknown bundle signing {other:?} (developer-id | adhoc)")),
    }
}

/// sha256 of `<contents>/KERNEL_EXE_REL`: a regular file inside `contents`, never a symlink or a hard link (what
/// build.rs pins from the stage and the app recomputes before every spawn).
pub fn kernel_exe_hash(contents: &Path) -> Result<String, String> {
    let k = inside(contents, KERNEL_EXE_REL)?;
    let st = std::fs::symlink_metadata(&k).map_err(|e| format!("{}: {e}", k.display()))?;
    if !st.is_file() {
        return Err(format!("{} is not a regular file", k.display()));
    }
    refuse_hard_link(&k, &st)?;
    super_tree::sha256_file(&k)
}

/// The `Contents` directory of the app whose executable is `exe` (`<X>.app/Contents/MacOS/<exe>`), realpath'd.
/// Anything else (a bare `cargo run` binary, a copied-out executable) is refused: a bundle build only runs from
/// inside its bundle.
pub fn contents_of(exe: &Path) -> Result<PathBuf, String> {
    let real = std::fs::canonicalize(exe).map_err(|e| format!("cannot resolve the app executable {}: {e}", exe.display()))?;
    let macos = real.parent().ok_or("the app executable has no parent directory")?;
    let contents = macos.parent().ok_or("the app executable is not inside an app bundle")?;
    let app = contents.parent().ok_or("the app executable is not inside an app bundle")?;
    let named = |p: &Path, n: &str| p.file_name().and_then(|s| s.to_str()) == Some(n);
    if !named(macos, "MacOS") || !named(contents, "Contents") || app.extension().is_none_or(|e| e != "app") {
        return Err(format!("{} is not inside <name>.app/Contents/MacOS (a bundle build runs only from its own Gnomon.app)", real.display()));
    }
    Ok(contents.to_path_buf())
}

/// (sha256 of `<contents>/NODE_REL`, kernel tree hash of `<contents>/KERNEL_REL`): what build.rs pins from the stage
/// and what the app recomputes from its own bundle. Neither path may be a symlink (or reach through one) out of
/// `contents`.
pub fn bundle_hashes(contents: &Path) -> Result<(String, String), String> {
    let node = inside(contents, NODE_REL)?;
    let st = std::fs::symlink_metadata(&node).map_err(|e| format!("{}: {e}", node.display()))?;
    if !st.is_file() {
        return Err(format!("{} is not a regular file", node.display()));
    }
    refuse_hard_link(&node, &st)?;
    let sha = super_tree::sha256_file(&node)?;
    let kernel = inside(contents, KERNEL_REL)?;
    refuse_hard_links_under(&kernel)?;
    let tree = super_tree::kernel_tree_hash(&kernel)?;
    Ok((sha, tree))
}

/// Aegis M2 low 6: a pinned file with another name (a hard link) could be rewritten through that other path, even
/// from outside the bundle, so a link count above one is refused.
fn refuse_hard_link(p: &Path, st: &std::fs::Metadata) -> Result<(), String> {
    use std::os::unix::fs::MetadataExt;
    if st.is_file() && st.nlink() > 1 {
        return Err(format!("{} is hard-linked ({} names); refused", p.display(), st.nlink()));
    }
    Ok(())
}

fn refuse_hard_links_under(dir: &Path) -> Result<(), String> {
    for e in std::fs::read_dir(dir).map_err(|e| format!("{}: {e}", dir.display()))? {
        let p = e.map_err(|e| e.to_string())?.path();
        let st = std::fs::symlink_metadata(&p).map_err(|e| format!("{}: {e}", p.display()))?;
        if st.is_dir() {
            refuse_hard_links_under(&p)?;
        } else {
            refuse_hard_link(&p, &st)?;
        }
    }
    Ok(())
}

/// `<contents>/<rel>`, refused when its realpath leaves `contents` or differs from the literal path (a symlink).
pub fn inside(contents: &Path, rel: &str) -> Result<PathBuf, String> {
    let base = std::fs::canonicalize(contents).map_err(|e| format!("{}: {e}", contents.display()))?;
    let p = base.join(rel);
    let real = std::fs::canonicalize(&p).map_err(|e| format!("{} is missing from the bundle ({e})", rel))?;
    if real != p || !real.starts_with(&base) {
        return Err(format!("{rel} in the bundle is a symlink ({}); refused", real.display()));
    }
    Ok(real)
}

// tree.rs is a sibling module in the crate and an explicit #[path] module in build.rs; this alias lets the same
// source compile in both.
use crate::tree as super_tree;
