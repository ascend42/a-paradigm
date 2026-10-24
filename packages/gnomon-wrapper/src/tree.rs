//! #gnomon-wrapper trust-root hashes (Aegis C1, M1.13 round 2), shared verbatim by
//! build.rs (`#[path]`) and the app: what the build records is exactly what the
//! app re-checks before every kernel spawn.
//!   - `sha256_file`: the node binary (its realpath target).
//!   - `kernel_tree_hash` (`gnomon-wrapper-kernel-tree:v1`): every regular file
//!     under `<pkg>/dist` plus `<pkg>/package.json` (its `"type": "module"`
//!     decides how node loads dist), relative POSIX path, sorted by UTF-8
//!     bytes, `<path>\0<sha256 hex>\n` per file after the domain line. The
//!     dist bundles its workspace deps (gnomon-contracts is inlined by tsup),
//!     so these files are everything the kernel loads beyond node's builtins.
//!     A symlink, a non-regular entry, more than MAX_FILES files or MAX_BYTES
//!     bytes does not hash (fail closed).
use sha2::{Digest, Sha256};
use std::path::Path;

pub const KERNEL_TREE_DOMAIN: &str = "gnomon-wrapper-kernel-tree:v1";
const MAX_FILES: usize = 4096;
const MAX_BYTES: u64 = 256 << 20;

fn hex_of(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

/// sha256 hex of a file's bytes.
pub fn sha256_file(p: &Path) -> Result<String, String> {
    std::fs::read(p).map(|b| hex_of(&Sha256::digest(&b))).map_err(|e| format!("{}: {e}", p.display()))
}

fn walk(abs: &Path, rel: &str, out: &mut Vec<(String, String)>, total: &mut u64) -> Result<(), String> {
    let mut names: Vec<_> = std::fs::read_dir(abs).map_err(|e| format!("{}: {e}", abs.display()))?.filter_map(Result::ok).map(|e| e.file_name()).collect();
    names.sort();
    for n in names {
        let name = n.to_str().ok_or("a non-UTF-8 file name in the kernel tree")?.to_string();
        let full = abs.join(&name);
        let r = if rel.is_empty() { name.clone() } else { format!("{rel}/{name}") };
        let st = std::fs::symlink_metadata(&full).map_err(|e| format!("{}: {e}", full.display()))?;
        if st.file_type().is_symlink() {
            return Err(format!("symlink in the kernel tree: {r}"));
        } else if st.is_dir() {
            walk(&full, &r, out, total)?;
        } else if st.is_file() {
            *total += st.len();
            if out.len() >= MAX_FILES || *total > MAX_BYTES {
                return Err("the kernel tree is too large".into());
            }
            out.push((r, sha256_file(&full)?));
        } else {
            return Err(format!("not a regular file in the kernel tree: {r}"));
        }
    }
    Ok(())
}

/// The kernel tree hash of the `packages/gnomon` directory `pkg`.
pub fn kernel_tree_hash(pkg: &Path) -> Result<String, String> {
    let mut files = Vec::new();
    let mut total = 0u64;
    walk(&pkg.join("dist"), "dist", &mut files, &mut total)?;
    let pj = pkg.join("package.json");
    let st = std::fs::symlink_metadata(&pj).map_err(|e| format!("{}: {e}", pj.display()))?;
    if !st.is_file() {
        return Err("package.json is not a regular file".into());
    }
    files.push(("package.json".into(), sha256_file(&pj)?));
    files.sort_by(|a, b| a.0.as_bytes().cmp(b.0.as_bytes()));
    let mut h = Sha256::new();
    h.update(format!("{KERNEL_TREE_DOMAIN}\n").as_bytes());
    for (n, s) in &files {
        h.update(format!("{n}\0{s}\n").as_bytes());
    }
    Ok(format!("sha256:{}", hex_of(&h.finalize())))
}
