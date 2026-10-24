/**
 * @symbol #manifest-loader
 *
 * #manifest-loader public surface (spec §3.6). The install-card DECISION and
 * the rollback are deliberately NOT exported: they live behind the internal
 * seam channel until the M1.6 approval broker (install.ts header).
 */
export * from './refusal.js';
export * from './egress.js';
export * from './manifest.js';
export * from './snapshot.js';
export * from './grants.js';
export * from './layers.js';
export * from './policy.js';
export * from './generate.js';
export * from './user-mcp.js';
export { stageInstall, loadMod, linkedFolders, readStaged, STAGED_RECORD_SCHEMA } from './install.js';
export type { InstallCardDetail, StagedRecord, StageOptions, StageResult, LoadResult, LoadOptions, InstallSource, DecideOptions } from './install.js';
