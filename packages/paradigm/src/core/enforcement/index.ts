/**
 * Enforcement Configuration — barrel export
 *
 * Provides the enforcement level system:
 * - Types: EnforcementLevel, CheckSeverity, CheckId, EnforcementConfig
 * - Presets: strict / balanced / minimal severity grids
 * - Loader: read config.yaml enforcement section
 * - Writer: update config.yaml enforcement section
 */

export type {
  EnforcementLevel,
  CheckSeverity,
  CheckId,
  EnforcementConfig,
  OrchestrationConfig,
} from './types.js';

export { CHECK_IDS } from './types.js';

export {
  getPreset,
  getPresetSeverity,
  isValidCheckId,
  isValidSeverity,
  isValidLevel,
} from './presets.js';

export {
  loadEnforcementConfig,
  getCheckSeverity,
  resolveAllChecks,
} from './loader.js';

export {
  setEnforcementLevel,
  setCheckOverride,
  resetCheckOverride,
  resetAllOverrides,
  ensureEnforcementDefaults,
} from './writer.js';
