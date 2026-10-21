/**
 * @a-company/gnomon — the Paradigm 8.0 kernel (docs/specs/gnomon.md).
 * PR-0 scaffold (research 29 §4): layout, bins, fences; no behaviour yet.
 */
export { GNOMON_VERSION } from './version.js';
export { KERNEL_MODULES, KERNEL_ALLOWED_PACKAGE, type KernelModule } from './kernel/index.js';
export * as kernelLog from './kernel/log/index.js';
export * as manifestLoader from './kernel/manifest/index.js';
// M1.7 slice 1: the session profile + adapter, for the p10m-claude-compat re-run against the GENERATED profile
export * as sessionSandbox from './kernel/sandbox/session.js';
export * as claudeAdapter from './adapters/claude-code/adapter.js';
export { binaryDenies } from './kernel/supervisor/supervisor.js';
export { CLAUDE_CODE_PLATFORMS } from './platform/claude-code.js';
// P8-D97: the kernel's repo-context staging and hook extract, for the p10m-repo-context re-run under the production policy
export * as repoContext from './kernel/supervisor/repo-context.js';
export * as repoHooks from './kernel/supervisor/repo-hooks.js';
// T-2026-10-21-028 (#release-pins): the requirements and floors scripts/write-release-manifest.mjs records and checks
export { HELPER_REQUIREMENT, MIN_HELPER_VERSION } from './kernel/identity/helper.js';
export { VOICE_IO_REQUIREMENT, MIN_VOICE_IO_VERSION } from './kernel/voice/voice-install.js';
export * as releasePins from './kernel/lifecycle/release-pins.js';
export { releaseHelperSha256 } from './kernel/identity/helper.js';
export { releaseVoiceIoSha256 } from './kernel/voice/voice-install.js';
export { pinHelper } from './kernel/identity/helper.js';
