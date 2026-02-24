# Publishing Guide

Pre-publish validation and version bump rules for the Paradigm monorepo.

---

## Pre-Publish Checks

The `scripts/pre-publish-check.mjs` script runs automatically via `prepublishOnly` and verifies:

| Check | What It Validates | Severity |
|-------|-------------------|----------|
| Build | All packages compile and bundle without errors | Error |
| Version consistency | `paradigm` and `paradigm-mcp` share same major.minor | Error |
| CHANGELOG | Entry exists for the current paradigm version | Warning |
| Plugin hooks.json | `plugins/paradigm/hooks.json` is valid JSON with a `hooks` object | Error |
| Doctor | `paradigm doctor --quiet` passes without errors | Warning |

### Running Manually

```bash
node scripts/pre-publish-check.mjs
```

### In CI

The script exits with code 1 on any error-level failures. Warnings don't fail the check but are reported.

---

## Version Bump Rules

| Package | When to Bump |
|---------|-------------|
| `@a-company/paradigm` | Every release (always bumps) |
| `@a-company/paradigm-mcp` | When CLI or MCP tools change |
| `@a-company/sentinel` | Only on sentinel changes |
| `@a-company/university` | Only on university content changes |
| Lore packages | Only on lore changes |

### Convention

- `paradigm` and `paradigm-mcp` must always share the same major.minor version
- Patch versions may differ (paradigm-mcp may skip patches that don't affect it)

---

## Release Workflow

1. Make changes on a feature branch
2. Run `paradigm doctor` to check health
3. Update CHANGELOG.md with a versioned heading `[X.Y.Z] - YYYY-MM-DD`
4. Bump versions in the affected package.json files
5. Run `npm run build` to verify all packages build
6. Run `node scripts/pre-publish-check.mjs` to validate
7. Commit, push, merge to main
8. Run `npm run publish:all` to publish affected packages

---

## CHANGELOG Convention

- **Main branch**: No `[Unreleased]` section — every push to main is a release
- **Feature branches**: Use `[Unreleased]` to accumulate changes
- Format: [Keep a Changelog](https://keepachangelog.com/) with sections: Added, Changed, Fixed, Security
