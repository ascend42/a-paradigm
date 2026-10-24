/**
 * M1.12 slice 3 (spec §12.8, G-HON-04 fixed-point rule): docs/specs/gnomon-client-api.md
 * is generated from the published package, never hand-maintained — the committed file is
 * the byte-identical output of renderClientApiDoc(), and generating it does not move clientApiId.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CLIENT_API_DOC_PATH, CLIENT_API_ID, CONFORMANCE_CHECKS, VERBS, computeClientApiId, renderClientApiDoc } from '../src/index.js';

const committed = (): string => readFileSync(fileURLToPath(new URL(`../../../${CLIENT_API_DOC_PATH}`, import.meta.url)), 'utf8');

describe('generated client-API doc (G-HON-04 fixed point)', () => {
  it('the committed doc is the byte-identical fixed point of renderClientApiDoc()', () => {
    expect(committed()).toBe(renderClientApiDoc());
  });
  it('renders from the package: every verb, every conformance check, the pinned ids', () => {
    const doc = renderClientApiDoc();
    for (const v of VERBS) expect(doc).toContain(`\`${v.verb}\``);
    for (const c of CONFORMANCE_CHECKS) expect(doc).toContain(`\`${c.id}\``);
    const pin = JSON.parse(readFileSync(fileURLToPath(new URL('../schemas/client-api.ids.json', import.meta.url)), 'utf8')) as { clientApiId: string };
    expect(doc).toContain(pin.clientApiId);
  });
  it('falsifier: a hand edit of the doc is detected; the doc is no input to clientApiId', () => {
    expect(`${committed()}hand edit\n`).not.toBe(renderClientApiDoc());
    expect(computeClientApiId()).toBe(CLIENT_API_ID);
  });
});
