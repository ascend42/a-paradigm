// #gnomon-wrapper build script (spec §11.1, §11.2 rule 1a; M1.13).
//
// Records, INSIDE the signed binary (so a signed Gnomon.app seals them):
//   GNOMON_GUI_BUNDLE_HASH   the pinned #gui bundle hash (gnomon-bundle-tree:v1),
//                            read from packages/gnomon/src/kernel/web/gui-bundle.ts
//   GNOMON_GUI_BUNDLE_FILES  that bundle's file names (comma-separated), for the
//                            served-hash check (the wrapper re-hashes what the port serves)
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
// Build-time inputs only: nothing here is read from the environment at RUN time.
use std::path::{Path, PathBuf};
use std::process::Command;

#[path = "src/tree.rs"]
mod tree;

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

fn main() {
    let manifest = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
    let (hash, files) = gui_pin(&manifest);
    println!("cargo:rustc-env=GNOMON_GUI_BUNDLE_HASH={hash}");
    println!("cargo:rustc-env=GNOMON_GUI_BUNDLE_FILES={}", files.join(","));
    let (node, node_sha, source) = build_node();
    println!("cargo:rustc-env=GNOMON_BUILD_NODE={node}");
    println!("cargo:rustc-env=GNOMON_BUILD_NODE_SHA256={node_sha}");
    println!("cargo:rustc-env=GNOMON_BUILD_NODE_SOURCE={source}");
    println!("cargo:rerun-if-env-changed=GNOMON_WRAPPER_GNOMON_PKG");
    let pkg = match std::env::var("GNOMON_WRAPPER_GNOMON_PKG") {
        Ok(p) => PathBuf::from(p),
        Err(_) => {
            let p = manifest.join("../gnomon");
            std::fs::canonicalize(&p).unwrap_or(p)
        }
    };
    println!("cargo:rustc-env=GNOMON_BUILD_GNOMON_PKG={}", pkg.display());
    println!("cargo:rerun-if-changed={}", pkg.join("dist").display());
    println!("cargo:rerun-if-changed={}", pkg.join("package.json").display());
    let tree = tree::kernel_tree_hash(&pkg).unwrap_or_default();
    println!("cargo:rustc-env=GNOMON_BUILD_KERNEL_TREE={tree}");
    tauri_build::build();
}
