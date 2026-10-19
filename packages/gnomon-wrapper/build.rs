// #gnomon-wrapper build script (spec §11.1, §11.2 rule 1a; M1.13).
//
// Records, INSIDE the signed binary (so a signed Gnomon.app seals them):
//   GNOMON_GUI_BUNDLE_HASH   the pinned #gui bundle hash (gnomon-bundle-tree:v1),
//                            read from packages/gnomon/src/kernel/web/gui-bundle.ts
//   GNOMON_GUI_BUNDLE_FILES  that bundle's file names (comma-separated), for the
//                            served-hash check (the wrapper re-hashes what the port serves)
//   GNOMON_BUILD_NODE        the node the app runs its kernel child with: the
//                            build env GNOMON_WRAPPER_NODE if set, else the
//                            realpath of `which node` on the build machine
//   GNOMON_BUILD_NODE_SOURCE "build-env" | "which" | "none"
//   GNOMON_BUILD_GNOMON_JS   the absolute packages/gnomon/dist/cli/gnomon.js
//                            (GNOMON_WRAPPER_GNOMON_JS overrides at build time)
// Build-time inputs only: nothing here is read from the environment at RUN time.
use std::path::{Path, PathBuf};
use std::process::Command;

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

fn build_node() -> (String, &'static str) {
    println!("cargo:rerun-if-env-changed=GNOMON_WRAPPER_NODE");
    if let Ok(p) = std::env::var("GNOMON_WRAPPER_NODE") {
        let real = std::fs::canonicalize(&p).unwrap_or_else(|e| panic!("GNOMON_WRAPPER_NODE={p}: {e}"));
        return (real.display().to_string(), "build-env");
    }
    match Command::new("/usr/bin/which").arg("node").output() {
        Ok(o) if o.status.success() => {
            let p = String::from_utf8_lossy(&o.stdout).trim().to_string();
            match std::fs::canonicalize(&p) {
                Ok(real) => (real.display().to_string(), "which"),
                Err(_) => (String::new(), "none"),
            }
        }
        _ => (String::new(), "none"),
    }
}

fn main() {
    let manifest = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
    let (hash, files) = gui_pin(&manifest);
    println!("cargo:rustc-env=GNOMON_GUI_BUNDLE_HASH={hash}");
    println!("cargo:rustc-env=GNOMON_GUI_BUNDLE_FILES={}", files.join(","));
    let (node, source) = build_node();
    println!("cargo:rustc-env=GNOMON_BUILD_NODE={node}");
    println!("cargo:rustc-env=GNOMON_BUILD_NODE_SOURCE={source}");
    println!("cargo:rerun-if-env-changed=GNOMON_WRAPPER_GNOMON_JS");
    let js = match std::env::var("GNOMON_WRAPPER_GNOMON_JS") {
        Ok(p) => PathBuf::from(p),
        Err(_) => {
            let p = manifest.join("../gnomon/dist/cli/gnomon.js");
            std::fs::canonicalize(&p).unwrap_or(p)
        }
    };
    println!("cargo:rustc-env=GNOMON_BUILD_GNOMON_JS={}", js.display());
    tauri_build::build();
}
