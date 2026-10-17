# @a-company/gnomon-wrapper

The Tauri 2 shell for the Gnomon GUI (`docs/specs/gnomon.md` §11, §16, §18;
M1.13, P8-D56): WKWebView on macOS, WebView2 on Windows. Token, kernel public
key and bundle hash arrive on stdin; the page loads `http://127.0.0.1:<port>`
as its only origin; IPC is disabled for page content; `serverSig` is verified
natively.

**Status: PR-0 placeholder.** No Rust toolchain was available on the scaffold
machine, so no `Cargo.toml` is committed yet. Probe **P08 `tauri-origin`**
(PR-2, research 29 §2/§4) sets the exact Tauri version pin and adds
`Cargo.toml` + `rust-toolchain.toml` here; Tauri is pinned exact (spec §18).

Once the crate exists, CI builds it in `.github/workflows/gnomon.yml`
(`native` job, windows-latest).
