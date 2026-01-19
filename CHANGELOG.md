# Changelog

All notable changes to Horizon will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Dreamscape Visualizer Enhancements**
  - Click-and-drag panning on canvas background (left-click drag)
  - Help panel with hotkeys and navigation tips (toggle with `?` key)
  - Theme system with three modes: Morning 🌅, Daytime ☀️, and Nighttime 🌙
  - Softer, dreamlike color palette with cloud-like aesthetics
  - All on/off toggle button with eye icons (👁️ open, half-open, closed)
  - Auto-reorganization of visible nodes when type visibility toggles (fills screen without gaps)
  - Editable node properties panel (symbol, type, description)
  - Enhanced visual distinction for toolbar stat icons (filled vs outline for on/off states)
  - Keyboard shortcuts for editing (Enter to save, Escape to cancel)
  - Smooth transitions and visual feedback throughout

- **Tutorial System Improvements**
  - Auto-generation of tutorial curriculum files (`curriculum.yaml` and step Markdown files)
  - Enhanced `horizon tutorial checkpoint` command to display next step preview
  - Updated tutorial content explaining concatenated symbols (`?@`, `?#`, etc.)

- **Schema Updates**
  - Updated `.dream` file format to latest JSON schema
  - Updated `.purpose` file format to latest schema (context array, rules object, features/components objects)

### Changed
- **Visualizer**
  - Fixed `horizon visualize` command to actually start Vite dev server (was previously a stub)
  - Improved z-index layering: properties panel (400) > command input (300) > canvas (100)
  - Enhanced node styling with backdrop blur and softer shadows
  - Improved toolbar stat icon visibility with background containers
  - Theme transitions are now smooth and animated

- **Build System**
  - Fixed build order to ensure core packages build before dependent packages
  - Fixed TypeScript module resolution for workspace dependencies
  - Removed invalid `--noExternal` flag from tsup builds
  - Corrected npm workspace dependency syntax (`workspace:*` → `*`)

### Fixed
- ESBuild parsing error in component-tagger.ts (JSDoc comment issue)
- TypeScript type export mismatch in gate-manager
- Unused variable warnings in test-generator and flow-tester
- Schema validation errors in example project files
- Command input overlap with properties panel (fixed via z-index)

## [0.2.1] - 2026-01-19

### Added
- Comprehensive `.cursorrules` file with Horizon framework documentation
- Changelog and version management instructions in `.cursorrules`
- Semantic versioning workflow for automated changelog updates

### Changed
- Updated `.gitignore` with comprehensive Node.js, TypeScript, and monorepo patterns
- Improved gitignore coverage for build artifacts, cache directories, and IDE files

## [0.2.0] - 2026-01-14

### Added
- **IDE-Agnostic Architecture** - `.horizon/` directory as source of truth
  - `config.yaml` - Main configuration with symbol system and logging settings
  - `specs/` - Philosophy and specifications (logger, scan, symbols)
  - `docs/` - Reference documentation (commands, patterns, troubleshooting)
  - `prompts/` - Pre-written task prompts for common operations
  - `project.md` - Auto-generated project summary

- **Multi-IDE Support** - Generate instruction files for different IDEs
  - Cursor (`.cursorrules`)
  - GitHub Copilot (`.github/copilot-instructions.md`)
  - Windsurf (`.windsurfrules`)

- **Horizon Logger Specification** - Structured logging with symbol types
  - Symbol-typed methods: `log.feature()`, `log.component()`, `log.gate()`, etc.
  - Duration tracking with `.start()` / `.success()` / `.error()`
  - Directory-to-symbol mapping in config
  - Log level and symbol filtering

- **New CLI Commands**
  - `horizon sync [ide]` - Generate IDE instruction files (auto-detects IDE)
  - `horizon sync --all` - Sync all supported IDEs at once
  - `horizon doctor` - Health check and setup validation
  - `horizon watch` - Auto-sync on `.horizon/` file changes
  - `horizon summary` - Generate `.horizon/project.md` with project stats

- **Template System** - Templates for new project initialization
  - Full `.horizon/` directory structure
  - Pre-configured specs and docs
  - Ready-to-use prompts

### Changed
- `horizon init` now creates `.horizon/` directory structure (not a single file)
- `horizon upgrade` supports migration from legacy `.horizon` file to directory format
- `horizon upgrade` now supports `--features logger` and `--features migrate`

### Deprecated
- `horizon cursorrules` command - Use `horizon sync cursor` instead (alias kept with warning)

## [0.1.0] - 2026-01-11

### Added
- Project inception
- Architecture planning document
- Monorepo scaffolding
