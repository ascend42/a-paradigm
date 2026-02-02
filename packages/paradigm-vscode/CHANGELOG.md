# Change Log

All notable changes to the "Paradigm" extension will be documented in this file.

## [1.0.0] - 2026-02-02

### Added

- Symbol highlighting for all Paradigm symbol types
  - `@` Feature
  - `#` Component
  - `^` Gate
  - `!` Signal
  - `$` Flow
  - `%` State
  - `?` Idea
  - `~` Deprecated
  - `&` Integration

- Hover information showing symbol details
- Go-to-definition (F12 / Cmd+Click)
- Find all references (Shift+F12)
- Diagnostics for .purpose files
  - YAML syntax errors
  - Schema validation
  - Undefined symbol warnings
  - Deprecated symbol notices

- Document outline for .purpose files
- Workspace symbol search (Cmd+T)
- CodeLens showing reference counts
- Symbol autocomplete
- Quick fixes for undefined symbols
- Commands:
  - Paradigm: Rebuild Symbol Index
  - Paradigm: Show Symbol Info
  - Paradigm: Find Symbol References
