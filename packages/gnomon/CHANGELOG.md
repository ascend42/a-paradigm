# Changelog — @a-company/gnomon

Gnomon changes on `feat/gnomon` before they reach a Paradigm release. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Changed

- **A start without a terminal opens the GUI** (T-2026-10-20-001, `#gui-relaunch`). `gnomon up` and bare `gnomon` with no interactive terminal, and `gnomon daemon start | --detach` / `gnomond` (activator) after a fresh start, open a new GUI window in the default browser. The single-use launch URL goes only to osascript's stdin and is never printed. **Opt out:** `--no-open` or `GNOMON_NO_OPEN=1`. `gnomond --foreground --no-open` is a usage refusal.
- **A stale GUI tab no longer points to a terminal as the only way back.** It says Gnomon stopped, treats an answer at its old address as unverified (it never suggests a reload), and offers "Close this tab" only when a same-origin window signals it attached.

### Security

- No web port is remembered across a restart (Aegis H1). Each plain start binds an OS-chosen port, and any `web-port.json` left over from the withdrawn build is deleted without being read.
