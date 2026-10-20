# Changelog — @a-company/gnomon

Gnomon changes on `feat/gnomon` before they reach a Paradigm release. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- **The Desk's wire shapes, reserved in one `clientApiId` move** (TD-2026-10-20-812, slice S0, `#gnomon-contracts`, `#manifest-loader`). Contracts only, so no later Desk or context-meter slice moves the id again. New kinds `offer.shown`, `offer.decided`, `offer.kept`, `request.offer.decide`, `request.offer.mute`, `request.mod.install`, `request.session.restart` and `session.context.threshold`, each with a closed payload; `offer-spec:v1` with the closed `CONTEXT_SOURCES`; `offerBlockOf`, the one strict parser of a model's ```` ```offer ```` block, shared by the kernel and the GUI. Manifests gain `provides.offers` (at most 6, a widening field), a closed per-user override for a `provides.mcp` server's command, args and env, and the reserved mod names `kernel`, `gnomon` and `system`. Install cards show one line per offer. `clientApiId` `sha256:69e8db86…cc0e` → `sha256:40efb7259e10d288f08c951ea22af72c76d149a6bd38c395ae7df3dfa8942afd`. The embedded GUI bundle is re-embedded because it bundles the contracts (`GUI_BUNDLE_HASH` moved).

### Changed

- **A start without a terminal opens the GUI** (T-2026-10-20-001, `#gui-relaunch`). `gnomon up` and bare `gnomon` with no interactive terminal, and `gnomon daemon start | --detach` / `gnomond` (activator) after a fresh start, open a new GUI window in the default browser. The single-use launch URL goes only to osascript's stdin and is never printed. **Opt out:** `--no-open` or `GNOMON_NO_OPEN=1`. `gnomond --foreground --no-open` is a usage refusal.
- **A stale GUI tab no longer points to a terminal as the only way back.** It says Gnomon stopped, treats an answer at its old address as unverified (it never suggests a reload), and offers "Close this tab" only when a same-origin window signals it attached.

### Security

- No web port is remembered across a restart (Aegis H1). Each plain start binds an OS-chosen port, and any `web-port.json` left over from the withdrawn build is deleted without being read.
