# Changelog

All notable changes to Horizon will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Initial monorepo structure with npm workspaces
- `@horizon/purpose-core` - Purpose file parsing and aggregation (migrated from a-purpose)
- `@horizon/gate-core` - Gate configuration parsing and validation (migrated from a-gate)
- `@horizon/gate-sdk` - Runtime SDK for gate checking (migrated from a-gate)
- `@horizon/dream-core` - Dream aggregation and symbol index
- `@horizon/visualizer` - Dreamscape infinite canvas UI
- `@horizon/cli` - Unified command-line interface
- Symbol system with cross-referencing (@, #, $, %, ~, ^, !, ?)
- `.dream` file format for canvas state persistence

## [0.1.0] - 2026-01-11

### Added
- Project inception
- Architecture planning document
- Monorepo scaffolding
