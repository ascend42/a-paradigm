/**
 * @symbol #claude-adapter
 * @symbol #session-runner
 *
 * Platform registry for Claude Code (spec §3.3 Preflight, §3.4 "Law 7 inside
 * the broker", §16 "Claude Code preflight paths"; p01). DATA ONLY: kernel code
 * looks a row up by platform key and never branches on the platform itself
 * (G-WIN-05).
 *
 *   knownBinaries — where the `claude` binary is looked for when the
 *     root-signed config names none. NEVER a `PATH` lookup (p01: the native
 *     installer's ~/.local/bin is not on a non-login PATH, and the daemon's
 *     clean env has no shell profile). `~` = the user's home.
 *   managedSettings — the managed-policy sources the CLI always loads (not
 *     controllable by --setting-sources, p01) and the law-7 scan must read.
 *     A source that is not JSON (a managed-preferences plist, a registry key)
 *     is scanned fail-closed: present but unreadable as JSON ⇒ a hit (B5).
 *   managedUnscannable — sources the kernel cannot read at all on that
 *     platform yet (Windows HKLM/HKCU policy keys need the helper, parity
 *     phase P8-D78): reported in status, never silently skipped.
 *   minVersion — `claudeCli.ts:13` floor (2.1.288).
 */
export type ClaudePlatform = 'darwin' | 'win32' | 'linux';

export interface ClaudeCodePlatformRow {
  knownBinaries: readonly string[];
  /** `~` = the user's home. Globs are not expanded: a `*.json` directory source is listed via managedSettingsDirs. */
  managedSettings: readonly string[];
  /** Directories whose `*.json` files are managed sources. */
  managedSettingsDirs: readonly string[];
  managedUnscannable: readonly string[];
  /** The user's Claude dir relative to home. */
  userClaudeDir: string;
}

export const CLAUDE_MIN_VERSION = '2.1.288';

export const CLAUDE_CODE_PLATFORMS: Readonly<Record<ClaudePlatform, ClaudeCodePlatformRow>> = Object.freeze({
  darwin: {
    knownBinaries: ['~/.local/bin/claude', '/opt/homebrew/bin/claude', '/usr/local/bin/claude'],
    managedSettings: [
      '/Library/Application Support/ClaudeCode/managed-settings.json',
      '/Library/Managed Preferences/com.anthropic.claudecode.plist',
    ],
    managedSettingsDirs: ['/Library/Application Support/ClaudeCode/managed-settings.d'],
    managedUnscannable: [],
    userClaudeDir: '.claude',
  },
  win32: {
    // WinGet (`winget install Anthropic.ClaudeCode`) first, then the native installer; the first that exists is used
    knownBinaries: ['~/AppData/Local/Microsoft/WinGet/Packages/Anthropic.ClaudeCode_Microsoft.Winget.Source_8wekyb3d8bbwe/claude.exe', '~/.local/bin/claude.exe'],
    managedSettings: ['C:\\Program Files\\ClaudeCode\\managed-settings.json'],
    managedSettingsDirs: ['C:\\Program Files\\ClaudeCode\\managed-settings.d'],
    managedUnscannable: ['HKLM\\SOFTWARE\\Policies\\ClaudeCode', 'HKCU\\SOFTWARE\\Policies\\ClaudeCode'],
    userClaudeDir: '.claude',
  },
  linux: {
    knownBinaries: ['~/.local/bin/claude', '/usr/local/bin/claude', '/usr/bin/claude'],
    managedSettings: ['/etc/claude-code/managed-settings.json'],
    managedSettingsDirs: ['/etc/claude-code/managed-settings.d'],
    managedUnscannable: [],
    userClaudeDir: '.claude',
  },
});

/** The row for `platform`; an unlisted platform has no row (the caller refuses). */
export function claudeCodePlatform(platform: string): ClaudeCodePlatformRow | null {
  return (CLAUDE_CODE_PLATFORMS as Record<string, ClaudeCodePlatformRow>)[platform] ?? null;
}
