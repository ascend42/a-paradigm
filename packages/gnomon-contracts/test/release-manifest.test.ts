import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  BUILD_SCHEMAS,
  CLIENT_API_DESCRIPTOR,
  RELEASE_ARCHES,
  RELEASE_ARTIFACT_NAMES,
  RELEASE_ARTIFACT_V1_KEYS,
  RELEASE_MANIFEST_V1_KEYS,
  RELEASE_MANIFEST_V1_SCHEMA,
  isReleaseManifestV1,
  releaseArtifactFor,
  serializeSchema,
  validateReleaseManifestV1,
  VOICE_IO_REQUIREMENT,
  type ReleaseManifestV1,
} from '../src/index.js';
import { jsonSchemaErrors } from './helpers.js';

const schemaPath = fileURLToPath(new URL('../schemas/release-manifest.v1.schema.json', import.meta.url));
const onDisk = readFileSync(schemaPath, 'utf8');
const schema = JSON.parse(onDisk);

const sha = (c: string) => c.repeat(64);
const good: ReleaseManifestV1 = {
  schemaVersion: 'gnomon-release-manifest:v1',
  release: '8.0.0',
  artifacts: [
    { name: 'gnomon-helper', version: '1.8.0', sha256: sha('a'), requirement: 'anchor apple generic and identifier "gnomon.helper"', arch: 'arm64' },
    { name: 'gnomon-voice-io', version: '0.1.0', sha256: sha('b'), requirement: 'anchor apple generic and identifier "gnomon.voice-io"', arch: 'universal' },
  ],
};

describe('release-manifest:v1 schema ↔ TS validator lockstep', () => {
  it('the committed schema is the generated one (run `npm run schemas` if this fails), closed, outside the client API', () => {
    expect(onDisk).toBe(serializeSchema(RELEASE_MANIFEST_V1_SCHEMA));
    expect(BUILD_SCHEMAS['release-manifest.v1.schema.json']).toBe(RELEASE_MANIFEST_V1_SCHEMA);
    expect(Object.keys(CLIENT_API_DESCRIPTOR.schemas)).not.toContain('release-manifest.v1.schema.json');
    expect(schema.additionalProperties).toBe(false);
    expect([...schema.required].sort()).toEqual([...RELEASE_MANIFEST_V1_KEYS].sort());
    const item = schema.properties.artifacts.items;
    expect([...item.required].sort()).toEqual([...RELEASE_ARTIFACT_V1_KEYS].sort());
    expect(item.properties.name.enum).toEqual([...RELEASE_ARTIFACT_NAMES]);
    expect(item.properties.arch.enum).toEqual([...RELEASE_ARCHES]);
  });

  it('a good manifest passes both; bad ones fail both', () => {
    expect(validateReleaseManifestV1(good)).toEqual([]);
    expect(jsonSchemaErrors(schema, good)).toEqual([]);
    const bad: unknown[] = [
      { ...good, extra: 1 },
      { ...good, schemaVersion: 'gnomon-release-manifest:v2' },
      { ...good, release: 'latest' },
      { ...good, artifacts: [] },
      { ...good, artifacts: [{ ...good.artifacts[0], sha256: 'A'.repeat(64) }] },
      { ...good, artifacts: [{ ...good.artifacts[0], name: 'gnomon-wrapper' }] },
      { ...good, artifacts: [{ ...good.artifacts[0], arch: 'x86_64' }] },
      { ...good, artifacts: [{ ...good.artifacts[0], version: '1.8' }] },
      { ...good, artifacts: [{ ...good.artifacts[0], requirement: '' }] },
    ];
    for (const b of bad) {
      expect(validateReleaseManifestV1(b).length).toBeGreaterThan(0);
      expect(jsonSchemaErrors(schema, b).length).toBeGreaterThan(0);
    }
  });

  it('one entry per (name, arch); a universal entry stands alone (validator rule beyond the schema)', () => {
    const h = good.artifacts[0]!;
    expect(isReleaseManifestV1({ ...good, artifacts: [h, { ...h, arch: 'x64', sha256: sha('c') }] })).toBe(true);
    expect(validateReleaseManifestV1({ ...good, artifacts: [h, { ...h, sha256: sha('c') }] }).join()).toMatch(/more than one gnomon-helper/);
    expect(validateReleaseManifestV1({ ...good, artifacts: [h, { ...h, arch: 'universal' }] }).join()).toMatch(/more than one/);
  });
});

describe('VOICE_IO_REQUIREMENT (one constant for the build and the kernel)', () => {
  it('names the Developer ID CA and leaf, the team and the identifier', () => {
    expect(VOICE_IO_REQUIREMENT).toBe(
      'anchor apple generic and certificate 1[field.1.2.840.113635.100.6.2.6] exists and certificate leaf[field.1.2.840.113635.100.6.1.13] exists and certificate leaf[subject.OU] = "SW4BMQ8PNL" and identifier "gnomon.voice-io"',
    );
  });
});

describe('releaseArtifactFor', () => {
  it('prefers the exact arch, falls back to universal, else null', () => {
    expect(releaseArtifactFor(good, 'gnomon-helper', 'arm64')?.sha256).toBe(sha('a'));
    expect(releaseArtifactFor(good, 'gnomon-helper', 'x64')).toBeNull();
    expect(releaseArtifactFor(good, 'gnomon-voice-io', 'x64')?.sha256).toBe(sha('b'));
  });
});
