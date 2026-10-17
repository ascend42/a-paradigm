# gnomon-helper — win32

Placeholder. The Windows helper is written in **Rust** (`windows` crate),
per founder ruling P8-D71 (closes OPEN 3; research 29 §5.4). Tauri already
brings a pinned Rust toolchain, and `windows-rs` covers NCrypt,
KeyCredentialManager (WinRT), WFP, job objects and named pipes.

Scope when it lands (spec §16): TPM P-256 keys via KeyCredentialManager or
NCrypt with Windows Hello presence and a prompt-text window, the
`\\.\pipe\gnomon-<sha>` pipe with an owner-only DACL and
`FIRST_PIPE_INSTANCE`, job objects with `KILL_ON_JOB_CLOSE`, the WFP port
filter, home-dir ACLs, chain anchors, the kernel-key item, and the
`ShellExecute` hand-off of the token-less URL.

Not scaffolded yet: the key-type question waits on probe P02 and the WFP
elevation question on probe P10w (research 29 §2). Signing waits on the
Windows code-signing decision (research 29 §5.3), which blocks `G-HLP-01`
on Windows.
