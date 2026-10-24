/**
 * scripts/refresh-platform-lock.mjs (8.0.2): a versionless lock placeholder for a published platform package makes
 * every npm ci crash with "Invalid Version:". Only those placeholders are found; real entries and other packages stay.
 * (No check on the committed lock: between a version bump and the publish the placeholder is legitimate.)
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error untyped repo script
import { platformPlaceholders } from '../../../scripts/refresh-platform-lock.mjs';

describe('refresh-platform-lock', () => {
  it('finds versionless gnomon-darwin placeholders at any depth, nothing else', () => {
    const lock = {
      packages: {
        '': { name: 'paradigm' },
        'packages/gnomon/node_modules/@a-company/gnomon-darwin-arm64': { optional: true },
        'node_modules/@a-company/gnomon-darwin-x64': { optional: true },
        'node_modules/@a-company/gnomon-darwin-arm64': { version: '8.0.2', optional: true },
        'node_modules/fsevents': { optional: true },
        'node_modules/@a-company/gnomon': { link: true },
      },
    };
    expect(platformPlaceholders(lock).sort()).toEqual([
      'node_modules/@a-company/gnomon-darwin-x64',
      'packages/gnomon/node_modules/@a-company/gnomon-darwin-arm64',
    ]);
  });
});
