// ═══════════════════════════════════════════════════════════════════
// VERSION FINGERPRINTING
// ═══════════════════════════════════════════════════════════════════

/** Impact classification for version mismatches */
export type ChangeImpact = 'none' | 'transparent' | 'schema' | 'logger' | 'binding';

export interface VersionFingerprint {
  runtimeApi: string;
  logger: string;
  sentinelTransport: string;
  graphSchemaVersion: number;
  bindingLayerVersion: string;
  generatedAt: string;
  paradigmCore: string;
  paradigmRuntime: string;
}

export interface CompatibilityCheck {
  compatible: boolean;
  outdated: OutdatedComponent[];
  recommendations: string[];
}

export interface OutdatedComponent {
  component: string;
  current: string;
  expected: string;
  impact: ChangeImpact;
}

export interface CurrentVersions {
  runtimeApi: string;
  logger: string;
  sentinelTransport: string;
  bindingLayerVersion: string;
  paradigmCore: string;
  paradigmRuntime: string;
}

export interface FingerprintOptions {
  runtimeApi?: string;
  logger: string;
  sentinelTransport: string;
  graphSchemaVersion: number;
  bindingLayerVersion: string;
  paradigmCore: string;
  paradigmRuntime: string;
}

// ═══════════════════════════════════════════════════════════════════
// FACTORIES
// ═══════════════════════════════════════════════════════════════════

/** Create a version fingerprint — called by generation pipeline after producing artifacts */
export function createFingerprint(options: FingerprintOptions): VersionFingerprint {
  return {
    runtimeApi: options.runtimeApi ?? 'v1',
    logger: options.logger,
    sentinelTransport: options.sentinelTransport,
    graphSchemaVersion: options.graphSchemaVersion,
    bindingLayerVersion: options.bindingLayerVersion,
    generatedAt: new Date().toISOString(),
    paradigmCore: options.paradigmCore,
    paradigmRuntime: options.paradigmRuntime,
  };
}

// ═══════════════════════════════════════════════════════════════════
// COMPATIBILITY CHECKING
// ═══════════════════════════════════════════════════════════════════

/** Check a fingerprint against current versions and return compatibility info */
export function checkCompatibility(
  fingerprint: VersionFingerprint,
  current: CurrentVersions,
): CompatibilityCheck {
  const outdated: OutdatedComponent[] = [];
  const recommendations: string[] = [];

  if (fingerprint.runtimeApi !== current.runtimeApi) {
    outdated.push({
      component: 'runtimeApi',
      current: current.runtimeApi,
      expected: fingerprint.runtimeApi,
      impact: 'binding',
    });
    recommendations.push('Runtime API version mismatch — regenerate binding layer');
  }

  if (fingerprint.logger !== current.logger) {
    const impact = isMajorBump(fingerprint.logger, current.logger) ? 'logger' : 'transparent';
    outdated.push({
      component: 'logger',
      current: current.logger,
      expected: fingerprint.logger,
      impact,
    });
    if (impact === 'logger') {
      recommendations.push('Logger major version changed — check for breaking API changes');
    }
  }

  if (fingerprint.sentinelTransport !== current.sentinelTransport) {
    const impact = isMajorBump(fingerprint.sentinelTransport, current.sentinelTransport)
      ? 'logger'
      : 'transparent';
    outdated.push({
      component: 'sentinelTransport',
      current: current.sentinelTransport,
      expected: fingerprint.sentinelTransport,
      impact,
    });
  }

  if (fingerprint.paradigmCore !== current.paradigmCore) {
    outdated.push({
      component: 'paradigmCore',
      current: current.paradigmCore,
      expected: fingerprint.paradigmCore,
      impact: 'transparent',
    });
  }

  if (fingerprint.paradigmRuntime !== current.paradigmRuntime) {
    const impact = isMajorBump(fingerprint.paradigmRuntime, current.paradigmRuntime)
      ? 'binding'
      : 'transparent';
    outdated.push({
      component: 'paradigmRuntime',
      current: current.paradigmRuntime,
      expected: fingerprint.paradigmRuntime,
      impact,
    });
    if (impact === 'binding') {
      recommendations.push('Runtime package major version changed — regenerate app');
    }
  }

  if (fingerprint.bindingLayerVersion !== current.bindingLayerVersion) {
    outdated.push({
      component: 'bindingLayerVersion',
      current: current.bindingLayerVersion,
      expected: fingerprint.bindingLayerVersion,
      impact: 'binding',
    });
    recommendations.push('Binding layer version mismatch — regenerate binding layer');
  }

  return {
    compatible: outdated.every((o) => o.impact === 'none' || o.impact === 'transparent'),
    outdated,
    recommendations,
  };
}

/** Check if going from version a to b crosses a major version boundary */
function isMajorBump(a: string, b: string): boolean {
  const majorA = parseInt(a.split('.')[0], 10);
  const majorB = parseInt(b.split('.')[0], 10);
  return !isNaN(majorA) && !isNaN(majorB) && majorA !== majorB;
}
