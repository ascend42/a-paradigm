// #gnomon-wrapper build script (spec §11.1, §11.2 rule 1a; M1.13).
//
// Records, INSIDE the signed binary (so a signed Gnomon.app seals them):
//   GNOMON_GUI_BUNDLE_HASH   the pinned #gui bundle hash (gnomon-bundle-tree:v1),
//                            read from packages/gnomon/src/kernel/web/gui-bundle.ts
//   GNOMON_GUI_BUNDLE_FILES  that bundle's file names (comma-separated), for the
//                            served-hash check (the wrapper re-hashes what the port serves)
//   GNOMON_BUILD_MODE        "bundle" | "dev" (below)
// BUNDLE mode (TD-2026-10-21-758, 8.0 M2; the release script sets GNOMON_WRAPPER_BUNDLE_STAGE to a Contents-shaped
// stage holding Resources/node/bin/node and Resources/kernel, src/layout.rs): the paths are BUNDLE-RELATIVE
// (layout::NODE_REL, layout::KERNEL_REL, resolved at run time from the app's own executable) and the pins are the
// hashes of what the release built and staged:
//   GNOMON_BUILD_NODE        layout::NODE_REL      GNOMON_BUILD_NODE_SOURCE "bundle"
//   GNOMON_BUILD_NODE_SHA256 sha256 of the staged (already signed) node
//   GNOMON_BUILD_GNOMON_PKG  layout::KERNEL_REL    GNOMON_BUILD_KERNEL_TREE its kernel tree hash
//   GNOMON_BUILD_NODE_REQUIREMENT the designated requirement the node must meet at spawn (layout::node_requirement
//                            of GNOMON_WRAPPER_BUNDLE_SIGNING = developer-id | adhoc; src/codesign.rs)
//   GNOMON_BUILD_KERNEL_EXE  layout::KERNEL_EXE_REL (#kernel-sea, TD-2026-10-29-746: the signed SEA kernel the
//                            app spawns), GNOMON_BUILD_KERNEL_EXE_SHA256 its hash, GNOMON_BUILD_KERNEL_EXE_REQUIREMENT
//                            layout::kernel_requirement (identifier gnomon.kernel); a stage without it FAILS
// A bundle build with a missing or unhashable stage FAILS (never a pinless bundle), and a RELEASE-profile build
// without a stage FAILS unless GNOMON_WRAPPER_DEV=1 opts into a dev app (Aegis M2 high 2).
// DEV mode (no stage; founder dogfooding from a checkout, unchanged):
//   GNOMON_BUILD_NODE        the node the app runs its kernel child with, AS FOUND
//                            (a symlink such as /opt/homebrew/bin/node is kept, so a
//                            `brew upgrade` is detected rather than followed silently):
//                            the build env GNOMON_WRAPPER_NODE if set, else `which node`
//   GNOMON_BUILD_NODE_SHA256 sha256 of that node's realpath target (Aegis C1)
//   GNOMON_BUILD_NODE_SOURCE "build-env" | "which" | "none"
//   GNOMON_BUILD_GNOMON_PKG  the absolute packages/gnomon directory
//                            (GNOMON_WRAPPER_GNOMON_PKG overrides at build time)
//   GNOMON_BUILD_KERNEL_TREE gnomon-wrapper-kernel-tree:v1 of its dist/ + package.json
//                            (src/tree.rs, shared with the app; Aegis C1); empty when
//                            dist is not built — the app then refuses to spawn
//   #kernel-sea: when <pkg>/gnomon.kernel and <pkg>/node/bin/node exist (npm run build:sea), GNOMON_BUILD_KERNEL_EXE
//                            is the absolute SEA, GNOMON_BUILD_KERNEL_EXE_SHA256 its hash, and the node pin is that
//                            gnomon.node (source "sea-dev"); otherwise both are empty and the app runs node + script
// Build-time inputs only: nothing here is read from the environment at RUN time.
use std::path::{Path, PathBuf};
use std::process::Command;

#[path = "src/tree.rs"]
mod tree;
#[path = "src/layout.rs"]
#[allow(dead_code)]
mod layout;

fn gui_pin(manifest: &Path) -> (String, Vec<String>) {
    let src = manifest.join("../gnomon/src/kernel/web/gui-bundle.ts");
    println!("cargo:rerun-if-changed={}", src.display());
    let text = std::fs::read_to_string(&src).unwrap_or_else(|e| panic!("gnomon-wrapper build: cannot read {}: {e} (build the GUI: npm run embed --workspace=@a-company/gnomon-gui)", src.display()));
    let marker = "export const GUI_BUNDLE_HASH = \"";
    let at = text.find(marker).expect("gnomon-wrapper build: gui-bundle.ts has no GUI_BUNDLE_HASH");
    let rest = &text[at + marker.len()..];
    let hash = rest[..rest.find('"').expect("unterminated GUI_BUNDLE_HASH")].to_string();
    assert!(hash.len() == 71 && hash.starts_with("sha256:") && hash[7..].bytes().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase()), "gnomon-wrapper build: malformed GUI_BUNDLE_HASH {hash}");
    let start = text.find("GUI_BUNDLE_FILES_B64").expect("no GUI_BUNDLE_FILES_B64");
    let end = text[start..].find("});").map(|e| start + e).expect("unterminated GUI_BUNDLE_FILES_B64");
    let mut files = Vec::new();
    for line in text[start..end].lines() {
        let l = line.trim();
        // a key line is `"name":` (the value is on the next line)
        if l.starts_with('"') && l.ends_with("\":") {
            let name = &l[1..l.len() - 2];
            assert!(!name.is_empty() && name.bytes().all(|b| b.is_ascii_alphanumeric() || b"._@+-/".contains(&b)), "unsafe bundle file name {name}");
            files.push(name.to_string());
        }
    }
    assert!(files.iter().any(|f| f == "index.html"), "gnomon-wrapper build: the pinned bundle has no index.html");
    (hash, files)
}

/// (path as found, sha256 of its realpath target, source)
fn build_node() -> (String, String, &'static str) {
    println!("cargo:rerun-if-env-changed=GNOMON_WRAPPER_NODE");
    let (found, source) = match std::env::var("GNOMON_WRAPPER_NODE") {
        Ok(p) => (p, "build-env"),
        Err(_) => match Command::new("/usr/bin/which").arg("node").output() {
            Ok(o) if o.status.success() => (String::from_utf8_lossy(&o.stdout).trim().to_string(), "which"),
            _ => return (String::new(), String::new(), "none"),
        },
    };
    let Ok(real) = std::fs::canonicalize(&found) else { return (String::new(), String::new(), "none") };
    println!("cargo:rerun-if-changed={}", real.display());
    let sha = tree::sha256_file(&real).unwrap_or_else(|e| panic!("gnomon-wrapper build: cannot hash node: {e}"));
    (found, sha, source)
}

/// BUNDLE mode: bundle-relative paths + the hashes of the staged node and kernel (src/layout.rs).
fn bundle_pins(stage: &Path) {
    let node = stage.join(layout::NODE_REL);
    let kernel = stage.join(layout::KERNEL_REL);
    println!("cargo:rerun-if-changed={}", node.display());
    println!("cargo:rerun-if-changed={}", kernel.join("dist").display());
    println!("cargo:rerun-if-changed={}", kernel.join("package.json").display());
    let (sha, tree) = layout::bundle_hashes(stage).unwrap_or_else(|e| panic!("gnomon-wrapper build: the bundle stage {} does not hash: {e}", stage.display()));
    // how the release signed the staged node (release-darwin.mjs): decides the requirement checked at spawn
    println!("cargo:rerun-if-env-changed=GNOMON_WRAPPER_BUNDLE_SIGNING");
    let signing = std::env::var("GNOMON_WRAPPER_BUNDLE_SIGNING").unwrap_or_default();
    let req = layout::node_requirement(&signing).unwrap_or_else(|e| panic!("gnomon-wrapper build: GNOMON_WRAPPER_BUNDLE_SIGNING: {e}"));
    println!("cargo:rustc-env=GNOMON_BUILD_NODE_REQUIREMENT={req}");
    println!("cargo:rustc-env=GNOMON_BUILD_MODE=bundle");
    println!("cargo:rustc-env=GNOMON_BUILD_NODE={}", layout::NODE_REL);
    println!("cargo:rustc-env=GNOMON_BUILD_NODE_SHA256={sha}");
    println!("cargo:rustc-env=GNOMON_BUILD_NODE_SOURCE=bundle");
    println!("cargo:rustc-env=GNOMON_BUILD_GNOMON_PKG={}", layout::KERNEL_REL);
    println!("cargo:rustc-env=GNOMON_BUILD_KERNEL_TREE={tree}");
    // #kernel-sea (TD-2026-10-29-746): the signed SEA kernel the app spawns; a bundle without it FAILS (never a
    // node + script release)
    let kexe = stage.join(layout::KERNEL_EXE_REL);
    println!("cargo:rerun-if-changed={}", kexe.display());
    let ksha = layout::kernel_exe_hash(stage).unwrap_or_else(|e| panic!("gnomon-wrapper build: the bundle stage {} has no signed SEA kernel ({e}); release-darwin.mjs builds it (scripts/build-sea.mjs)", stage.display()));
    let kreq = layout::kernel_requirement(&signing).unwrap_or_else(|e| panic!("gnomon-wrapper build: GNOMON_WRAPPER_BUNDLE_SIGNING: {e}"));
    println!("cargo:rustc-env=GNOMON_BUILD_KERNEL_EXE={}", layout::KERNEL_EXE_REL);
    println!("cargo:rustc-env=GNOMON_BUILD_KERNEL_EXE_SHA256={ksha}");
    println!("cargo:rustc-env=GNOMON_BUILD_KERNEL_EXE_REQUIREMENT={kreq}");
}

/// DEV mode #kernel-sea: `<pkg>/gnomon.kernel` and its children's `<pkg>/node/bin/node` (npm run build:sea), when
/// both exist: (kernel path, kernel sha256, node path, node sha256). None ⇒ the legacy node + script dev app.
fn dev_sea(pkg: &Path) -> Option<(String, String, String, String)> {
    let kexe = pkg.join("gnomon.kernel");
    let knode = pkg.join("node/bin/node");
    println!("cargo:rerun-if-changed={}", kexe.display());
    println!("cargo:rerun-if-changed={}", knode.display());
    if !kexe.is_file() || !knode.is_file() {
        println!("cargo:warning=gnomon-wrapper dev build: no {} (npm run build:sea -w @a-company/gnomon): this app runs node + dist/cli/gnomon.js, which the helper cannot certify (guarded only)", kexe.display());
        return None;
    }
    let ksha = tree::sha256_file(&kexe).unwrap_or_else(|e| panic!("gnomon-wrapper build: cannot hash {}: {e}", kexe.display()));
    let nsha = tree::sha256_file(&knode).unwrap_or_else(|e| panic!("gnomon-wrapper build: cannot hash {}: {e}", knode.display()));
    Some((kexe.display().to_string(), ksha, knode.display().to_string(), nsha))
}

/// DEV mode: the builder's node as found and this checkout's packages/gnomon, absolute (founder dogfooding).
fn dev_pins(manifest: &Path) {
    println!("cargo:rustc-env=GNOMON_BUILD_MODE=dev");
    println!("cargo:rustc-env=GNOMON_BUILD_NODE_REQUIREMENT=");
    println!("cargo:rerun-if-env-changed=GNOMON_WRAPPER_GNOMON_PKG");
    let pkg = match std::env::var("GNOMON_WRAPPER_GNOMON_PKG") {
        Ok(p) => PathBuf::from(p),
        Err(_) => {
            let p = manifest.join("../gnomon");
            std::fs::canonicalize(&p).unwrap_or(p)
        }
    };
    // #kernel-sea: a dev SEA wins; its children's node (gnomon.node) is the node pin, never the builder's PATH node
    let (node, node_sha, source) = match dev_sea(&pkg) {
        Some((kexe, ksha, knode, nsha)) => {
            println!("cargo:rustc-env=GNOMON_BUILD_KERNEL_EXE={kexe}");
            println!("cargo:rustc-env=GNOMON_BUILD_KERNEL_EXE_SHA256={ksha}");
            (knode, nsha, "sea-dev")
        }
        None => {
            println!("cargo:rustc-env=GNOMON_BUILD_KERNEL_EXE=");
            println!("cargo:rustc-env=GNOMON_BUILD_KERNEL_EXE_SHA256=");
            build_node()
        }
    };
    println!("cargo:rustc-env=GNOMON_BUILD_KERNEL_EXE_REQUIREMENT=");
    println!("cargo:rustc-env=GNOMON_BUILD_NODE={node}");
    println!("cargo:rustc-env=GNOMON_BUILD_NODE_SHA256={node_sha}");
    println!("cargo:rustc-env=GNOMON_BUILD_NODE_SOURCE={source}");
    println!("cargo:rustc-env=GNOMON_BUILD_GNOMON_PKG={}", pkg.display());
    println!("cargo:rerun-if-changed={}", pkg.join("dist").display());
    println!("cargo:rerun-if-changed={}", pkg.join("package.json").display());
    let tree = tree::kernel_tree_hash(&pkg).unwrap_or_default();
    println!("cargo:rustc-env=GNOMON_BUILD_KERNEL_TREE={tree}");
}

fn main() {
    let manifest = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
    let (hash, files) = gui_pin(&manifest);
    println!("cargo:rustc-env=GNOMON_GUI_BUNDLE_HASH={hash}");
    println!("cargo:rustc-env=GNOMON_GUI_BUNDLE_FILES={}", files.join(","));
    println!("cargo:rerun-if-env-changed=GNOMON_WRAPPER_BUNDLE_STAGE");
    println!("cargo:rerun-if-env-changed=GNOMON_WRAPPER_DEV");
    // Aegis M2 high 2: a RELEASE profile never silently becomes a dev build. Without a stage it fails unless the dev
    // opt-in is explicit (scripts/build-darwin.mjs sets GNOMON_WRAPPER_DEV=1); a set-but-empty stage always fails.
    let release_profile = std::env::var("PROFILE").as_deref() == Ok("release");
    let dev_opt_in = std::env::var("GNOMON_WRAPPER_DEV").as_deref() == Ok("1");
    match std::env::var("GNOMON_WRAPPER_BUNDLE_STAGE") {
        Ok(stage) if !stage.is_empty() => bundle_pins(Path::new(&stage)),
        Ok(_) => panic!("gnomon-wrapper build: GNOMON_WRAPPER_BUNDLE_STAGE is set but empty; a bundle build needs the release stage"),
        Err(_) if release_profile && !dev_opt_in => panic!("gnomon-wrapper build: a release build without GNOMON_WRAPPER_BUNDLE_STAGE; build releases with packages/gnomon/scripts/release-darwin.mjs, or set GNOMON_WRAPPER_DEV=1 for a dev app pinned to this checkout"),
        Err(_) => dev_pins(&manifest),
    }
    tauri_build::build();
}
