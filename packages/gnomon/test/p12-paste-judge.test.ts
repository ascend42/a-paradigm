/**
 * #gnomon-probes P12 (probes/p12-excalidraw-csp/harness.mjs): a paste check is judged by what its event CARRIED,
 * as the page read it back before dispatching it, and never by the engine's name. Recorded shapes, in Node.
 *  - `text`: the strict expectations (no refusal said; literal when the browser made the paste or the probe build
 *    counts synthetic input; stopped and heard by nobody otherwise).
 *  - `nothing` (an engine that strips script-built clipboard data: the shape Firefox reported on CI): the ONE
 *    contained outcome is stopped, nothing added, engine not entered, no node, no CSP row, refused as `paste`.
 *  - `file`: refused as `image`.
 * And a check counts as exercised only where the event carried what the check is about.
 */
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs probe harness (no types)
import { c8Problems, exercisedChecks, filePasteTrouble, pasteCarried, pasteTrouble } from '../probes/p12-excalidraw-csp/harness.mjs';

/** the exact record a Firefox run reported on CI, before the page read back what the event carried */
const FIREFOX = { via: 'synthetic', stopped: true, added: 0, said: ['paste'], heard: 0, literal: false, engine: 0, nodes: [], violations: 0 };
const FIREFOX_FILE = { added: 0, said: ['paste'], stopped: true, engine: 0 };
const empty = { ...FIREFOX, carried: 'nothing', types: [] };
const emptyFile = { ...FIREFOX_FILE, carried: 'nothing', types: [] };
const devtools = { via: 'devtools', carried: 'text', types: ['text/plain'], stopped: null, added: 0, said: [], heard: 1, literal: true, engine: 0, nodes: [], violations: 0 };
const synthetic = { via: 'synthetic', carried: 'text', types: ['text/plain'], stopped: true, added: 0, said: [], heard: 0, literal: false, engine: 0, nodes: [], violations: 0 };
const file = { carried: 'file', types: ['Files'], added: 0, said: ['image'], stopped: true, engine: 0 };
const copy = { stopped: true, types: ['text/plain'], added: 0, engine: 0 };
const run = (mode: string, paste: unknown, filePaste: unknown) => ({ mode, fix: { paste, hostile: paste, svg: paste, filePaste, copy, pwn: null } });

describe('P12 paste judging: by what the event carried', () => {
  it('carried the text: the existing expectations, unchanged, for a real paste, a synthetic one on the pinned chunk and one on the probe build', () => {
    expect(pasteTrouble(devtools, 'pinned')).toBe('');
    expect(pasteTrouble(synthetic, 'pinned')).toBe('');
    expect(pasteTrouble({ ...synthetic, heard: 1, literal: true }, 'probe')).toBe('');
    // a refusal said for a paste that DID carry its text is still a problem, in every mode
    for (const mode of ['pinned', 'probe']) for (const x of [devtools, synthetic]) expect(pasteTrouble({ ...x, said: ['paste'] }, mode)).toBe('a refusal was said: paste');
    expect(pasteTrouble({ ...devtools, heard: 0, literal: false }, 'pinned')).toMatch(/handed on 0/);
    expect(pasteTrouble({ ...synthetic, stopped: false }, 'pinned')).toMatch(/stopped false/);
    expect(pasteTrouble({ ...synthetic, added: 1 }, 'pinned')).toMatch(/added 1/);
    expect(pasteTrouble({ ...synthetic, engine: 1 }, 'pinned')).toMatch(/engine/);
    expect(pasteTrouble({ ...synthetic, nodes: ['iframe'] }, 'pinned')).toMatch(/nodes appeared/);
    expect(pasteTrouble({ ...synthetic, violations: 1 }, 'pinned')).toMatch(/CSP/);
    expect(c8Problems(run('pinned', devtools, file))).toEqual([]);
    expect(c8Problems(run('probe', { ...synthetic, heard: 1, literal: true }, file))).toEqual([]);
  });

  it('a record with no `carried` field is judged as carrying its text: the Firefox record as CI saw it is still four problems', () => {
    const p = c8Problems(run('pinned', FIREFOX, FIREFOX_FILE));
    expect(p).toHaveLength(4);
    expect(p[0]).toContain('a refusal was said: paste');
    expect(p[3]).toContain('a pasted file was not refused');
  });

  it('carried NOTHING: the one contained outcome passes on both pages; anything else is still a problem', () => {
    for (const mode of ['pinned', 'probe']) {
      expect(pasteTrouble(empty, mode)).toBe('');
      expect(c8Problems(run(mode, empty, emptyFile))).toEqual([]);
    }
    expect(filePasteTrouble(emptyFile)).toBe('');
    for (const [bad, why] of [
      [{ said: [] }, /must be refused as "paste"/],
      [{ said: ['image'] }, /must be refused as "paste"/],
      [{ said: ['paste', 'paste'] }, /must be refused as "paste"/],
      [{ stopped: false }, /not stopped/],
      [{ stopped: null }, /not stopped/],
      [{ added: 1 }, /added 1/],
      [{ engine: 1 }, /engine/],
      [{ nodes: ['img'] }, /nodes appeared/],
      [{ violations: 2 }, /CSP/],
      [{ heard: 1 }, /handed on 1/],
    ] as Array<[Record<string, unknown>, RegExp]>) expect(pasteTrouble({ ...empty, ...bad }, 'pinned'), JSON.stringify(bad)).toMatch(why);
    for (const bad of [{ said: ['image'] }, { said: [] }, { stopped: false }, { added: 1 }, { engine: 1 }]) expect(filePasteTrouble({ ...emptyFile, ...bad }), JSON.stringify(bad)).not.toBe('');
  });

  it('carried a file: refused as `image`; the empty-paste refusal is not accepted for it, nor the other way round', () => {
    expect(filePasteTrouble(file)).toBe('');
    expect(filePasteTrouble({ ...file, said: ['paste'] })).not.toBe('');
    expect(filePasteTrouble({ ...emptyFile, said: ['image'] })).not.toBe('');
    expect(filePasteTrouble({ ...file, carried: 'text' })).toBe('a file paste carried text');
    expect(pasteTrouble({ ...synthetic, carried: 'file' }, 'pinned')).toBe('a text paste carried file');
    expect(filePasteTrouble(undefined)).toBe('no result');
    expect(filePasteTrouble({ unsupported: 'no DataTransfer' })).toBe('');
  });

  it('exercised: a paste that carried nothing does not count as the text or the file check having run; the evidence names each mode', () => {
    const nothing = run('pinned', empty, emptyFile);
    const real = run('pinned', devtools, file);
    expect(exercisedChecks(nothing)).toMatchObject({ 'paste: stock marks': false, 'paste: forged author, iframe, embeddable, image': false, 'paste: a file': false, 'copy and cut': true });
    expect(exercisedChecks(real)).toMatchObject({ 'paste: stock marks': true, 'paste: forged author, iframe, embeddable, image': true, 'paste: a file': true, 'copy and cut': true });
    expect(pasteCarried(nothing)).toEqual({ paste: 'nothing', hostile: 'nothing', svg: 'nothing', filePaste: 'nothing' });
    expect(pasteCarried(real)).toEqual({ paste: 'text', hostile: 'text', svg: 'text', filePaste: 'file' });
    expect(pasteCarried(run('pinned', { unsupported: 'x' }, undefined))).toEqual({ paste: null, hostile: null, svg: null, filePaste: null });
    // so a run in which ONLY such an engine ran leaves those checks exercised nowhere: the probe fails as before
    expect(Object.entries(exercisedChecks(nothing)).filter(([k, v]) => k.startsWith('paste') && v)).toEqual([]);
  });
});
