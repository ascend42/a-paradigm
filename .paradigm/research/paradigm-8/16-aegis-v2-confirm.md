# Aegis — confirmation pass on gnomon.md v2 (2026-10-15)

Closed: C2, C4 (gap: shared .git), H1, H3, H4, H6 (profile contradiction), M1–M7 (M6 misses user-scope ~/.claude edits), L1–L3. Accepted-risk: C1 (A.1), C3 (sandbox-exec), L4. Partial: H2 (GNOMON_HOME switch), H5 (until Warpline keyed-only resolve ships, P8-D16), H7 (§0 says layers "limited" but body only hashes them).

New defects in v2, ranked:
1. HIGH — A.1 claims "every zero-UX-cost mitigation" but misses two near-free ones: split keys (root key for rare registry/grant/config writes in Keychain with user presence; approvals stay on a key file), and run kernel-spawned sessions under a sandbox-exec profile denying ~/.gnomon/keys. Key-path deny rules exist only on the Warpline spawn path (457), not generic/git (445, 468).
2. HIGH — kernel runs git (worktree add, merge-tree, ff, git show base:) outside the sandbox in a repo whose shared .git/config and .git/hooks a session can write (core.fsmonitor, core.hooksPath, filter drivers → code exec in the key-holding daemon); not in any diff so the gate-class check misses it. Fix: git -c core.hooksPath=/dev/null -c core.fsmonitor=false; hash .git/config; changed hash = gate-class.
3. HIGH — sandbox profile is a deny-list (694): ~/.claude credentials, ~/.aws, ~/.npmrc, gh tokens, .warpline token files readable; no mach-lookup/process-exec limits (open, osascript, launchctl escape); tests cover two paths only. Fix: default-deny reads, default-deny mach-lookup, escape tests; sandbox-exec can't "mount read-only" — state write rules for the copy.
4. MEDIUM — reviewer profile denies Keychain + throwaway HOME, but the subscription OAuth token lives in Keychain → preflight fails or profile loosened ad hoc. Needs its own named profile.
5. MEDIUM — overclaims at 668 ("attributable … not deniable"), 850 ("leaves a root-key signature"), §16.9 tripwire (823) has no detection. Fix: record CLI pid/ppid/pgid/tty in approval.decide; flag approvals with no TTY or a session pgid in ancestry; show each in the band.
6. MEDIUM — GNOMON_HOME gated on NODE_ENV=test (237, 686) is itself an env switch; CLI keeps caller env. Make it a build-time constant.
7. MEDIUM — gate-class check is diff-based so gitignored files are invisible (.claude/settings.local.json, CLAUDE.local.md, user-scope skills). Any layersHash change at respawn → card; check whether --setting-sources can limit layers.
8. LOW — I3 (153) lists only mint verbs; enumerate all human CLI verbs (init, key mint, trust, install, uninstall, approve, daemon stop).
9. LOW — threat rows 5 and 11 (671, 677) list no residual risk (cite D12 and defect 2); row 12 should say sessions are unsandboxed so the oracle sandbox protects oracle integrity, not keys.
No test or law claims prevention outright (G-BRK-02, G-LAW-01b, G-SPN-06 worded correctly); the prose at 668, 850, §16.9 still overclaims.
