# Aegis — review of gnomon.md v3.2 (2026-10-16)

Verdict: §11.2 holds against browser attackers (DNS rebinding, CSRF, cross-site WebSocket hijacking, other tabs) but not against a sandboxed session; the residual assumes such a session already holds the device key, and it does not.

Critical
- C1 Launch-token race (621, 830, 1024(d)): the session profile doesn't limit network or process listing; a prompt-injected session polls ps/WMI for the argv of open/ShellExecute/browser carrying #launch=, connects to 127.0.0.1 first (Origin/Host/Sec-Fetch-Site are forgeable outside a browser), becomes the human principal exactly when the user expects the attach presence prompt. Fix: session profile denies loopback connects to the endpoint port and process info on other processes; token never on argv (helper over stdin, or a pairing code shown in terminal and page); a page presenting an already-used launch token = theft → revoke the GUI session that used it + socket.auth.theft; attach prompt names connId and count of open GUI sessions.
- C2 Cached `always` becomes a permanent grant (234, 1024(a)): approval.rule.learned under the cached unlock turns a 15-minute window into standing policy. Fix: `always` requires fresh presence.
High
- H1 Cached unlock not tied to one GUI session (146, 651): per connection; no session uses another's; make §A.1's revisit fix the 8.0 rule.
- H2 Linked mods TOCTOU + dev-mode self-escalation (697): lazy loading + 500 ms debounce + live-folder read allow; sessions can write linked folders; dev mode lets agents edit into grants. Fix: immutable snapshot pinned/<packageHash>/; refuse symlinks, junctions, hardlinks (nlink>1), .node addons; session profile denies writes to linked folders; dev mode caps effects at read and expires; node_modules needs a lockfile and the card lists package@version.
- H3 Agents can edit the gnome's Tier 0 templates (704, 708) via persona.set ("Nothing needs you."). Fix: kernel-fixed templates or validated required slots; persona.set scoped to the caller's session; Tier 2 lines labelled distinctly from Tier 0.
- H4 knowledge.query trusts providers and callers (517): requester from the authenticated principal; scope clamped to the caller; §9.3 redaction after providers answer; tier capped per provider grant; neurons off by default outside their project; refuse providers with network.
- H5 doodle.view sends data off the machine (721, 724): snapshots, sheet JSON and transcript windows go to Claude as tool results. Include only accepted, redacted blobs, log inject.receipt, state it; reword G-DDL-02 "never" to "a pattern the local pass detects".
- H6 Sanitizer misses Unicode spoofing (322): bidi overrides (U+202A–202E, U+2066–2069) can reverse card text; tag characters (U+E0000 block) and zero-width characters are invisible to people but read by models. Show bidi controls visibly, strip the tag block, flag both in card bodies.
Medium
- M1 Windows: prove in M1.0 that KeyCredentialManager/NCrypt can display kernel-written prompt text, else §12.8's claim is false there (732).
- M2 Every Tauri app shares tauri://localhost and registration has no auth (612, 629): load the wrapper from 127.0.0.1 (same origin) and disable Tauri IPC for page content.
- M3 Excalidraw vs CSP and law 6 (625, 720): CDN fonts by default, inline styles, embeddables/iframes/link fields. Self-host assets, disable embeddables and links, no CSP loosening without a test; re-encode images as raster, never serve SVG from /blob.
- M4 On reconnect the page can't verify the server (357): put the kernel's Ed25519 public key in the fragment and verify serverSig with WebCrypto on every hello (closes port reuse after restart).
- M5 Conformance badge unverifiable → "declared" not "passed" (732); community clients get the human's full log.read → require log.read:sensitive.
- M6 5 exchanges/min per endpoint lets any local OS user lock out the real exchange (627) → per connection.
- M7 Doodle index.db copies transcript windows outside L5 pruning and the redaction matrix (725).
Low: L1 browser extensions with all-sites access read fragment and page memory and send trusted events (row 16 residual; G-GUI-04 checks isTrusted); L2 clear the fragment with history.replaceState; L3 refuse when Sec-Fetch-Site is missing; L4 kernel never runs git in a linked folder (or only hardened), deny mod reads of its own .git/**; L5 spell out the 10-minute reconnect grace so builders don't use sessionStorage.
v3 findings: C1, C2, C3, H1–H4, H6–H8, M1–M5, L1, L2 stay closed; H5 closed for first-party GUI, partly reopened by community clients and H6; C3 weakened for linked mods until H2.
