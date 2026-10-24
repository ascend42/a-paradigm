// #gnomon-wrapper: codesign's entitlements parser (AMFIUnserializeXML) is stricter than plutil. XML forbids
// "--" inside a comment, and an "--unsigned" in NodeEntitlements.plist's comment failed the first signed
// release build at the node codesign step. Every plist/entitlements file the release signs is held to it here.
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const REPO = path.resolve(__dirname, '..', '..', '..');

function signedPlists(): string[] {
  const out = execFileSync('git', ['ls-files', '*.plist', '*.entitlements'], { cwd: REPO, encoding: 'utf8' });
  return out.split('\n').filter((f) => f && !f.includes('node_modules'));
}

describe('entitlements and plists parse under codesign rules', () => {
  it('has no "--" inside an XML comment', () => {
    const bad = signedPlists().filter((f) => {
      const text = readFileSync(path.join(REPO, f), 'utf8');
      return [...text.matchAll(/<!--([\s\S]*?)-->/g)].some((m) => m[1].includes('--'));
    });
    expect(bad).toEqual([]);
  });
});
