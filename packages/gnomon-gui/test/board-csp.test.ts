/**
 * G-DDL-06 (spec §12.7, §11.2 rule 6; boards S1.0): the SHIPPED board chunk raises NO CSP refusal across load,
 * draw and PNG export, in Chrome and in WKWebView (the wrapper's engine). Real engines, the kernel's CSP bytes
 * (test/web-csp-pin.test.ts in packages/gnomon proves the harness serves the same policy), the bytes decoded from
 * the kernel embed. The page also selects a mark and reaches for the stock Library (which must not exist).
 *
 * The harness is the P12 probe's (packages/gnomon/probes/p12-excalidraw-csp/harness.mjs): one definition.
 *
 * On CI the engine runs are the probes job (P12, .github/workflows/gnomon.yml), whose runners decide which
 * engines exist; here they run on a developer machine. The harness's own logic is tested on every OS below.
 */
import { describe, expect, it } from 'vitest';
import { checkLiveReskin, type LiveRun } from './board-golden.js';
import { RESKIN_CLEAN } from './board-reskin-sample.js';
// @ts-expect-error plain .mjs (the zero-dependency probe harness)
import { exercisedChecks, harnessFiles, NO_REPORT, pickEngines, REFUSED_TOOLS, runBoardUnderCsp, runProblems, shippedBoard, TOOLS } from '../../gnomon/probes/p12-excalidraw-csp/harness.mjs';

interface Run { refusedTools?: Record<string, string>; stage?: string; mounted?: boolean; error?: string; violationCount?: number; violations?: Array<{ directive: string; blocked: string; phase: string; count: number }>; afterAdd?: number; afterAddSettled?: number; alive?: boolean; aliveAfterUnmount?: boolean; deadHandle?: string; captureRefused?: number; afterPointerRect?: number; afterPointerStroke?: number; libraryTrigger?: boolean; libraryOpen?: boolean; png?: { ok: boolean; bytes?: number }; errors?: string[]; rejections?: string[]; requests?: Array<{ path: string }>; cursors?: Record<string, string>; refusedTools?: Record<string, string>; visibility?: string; engine?: string }
interface EngineRow { version: string; family: string; runs: Run[]; clean: boolean; problems: string[] }

const CLEAN: Run = { ...(RESKIN_CLEAN as Run),  stage: 'done', mounted: true, violationCount: 0, violations: [], afterAdd: 3, afterAddSettled: 3, alive: true, aliveAfterUnmount: false, deadHandle: 'refused', afterPointerRect: 4, afterPointerStroke: 5, libraryTrigger: false, libraryOpen: false, png: { ok: true, bytes: 9000 }, errors: [], rejections: [], requests: [{ path: '/' }, { path: '/board/board.js' }, { path: '/report' }, { path: '/favicon.ico' }] };
const KNOWN = new Set(['/board/board.js', '/board/board.css', '/fonts/JetBrainsMono-Regular.woff2', '/index.html', '/harness.js', '/harness.css']);
const problems = (r: Run): string[] => runProblems(r, KNOWN) as string[];

describe('G-DDL-06 predicate: what counts as a refusal-free run (every OS)', () => {
  it('a clean run has no problem', () => {
    expect(problems(CLEAN)).toEqual([]);
  });
  it.each([
    ['any CSP violation, whatever the directive', { violationCount: 1, violations: [{ directive: 'img-src', blocked: 'data', phase: 'tools', count: 1 }] }, /1 CSP violation\(s\): img-src data in tools x1/],
    ['a font or CDN request (a path outside the bundle)', { requests: [{ path: '/board/fonts/Excalifont/Excalifont-Regular.woff2' }] }, /requests outside the bundle: \/board\/fonts\//],
    ['no mount', { mounted: false, stage: 'driver-error' }, /did not mount/],
    ['marks added as the mount resolved being wiped (mountBoard resolved before the scene was initialised)', { afterAddSettled: 0 }, /did not stay: 0 of 3 left/],
    ['a handle that says the engine died', { alive: false }, /no longer alive/],
    ['a handle that still answers after its board is gone', { deadHandle: 'answered' }, /still answers/],
    ['a pointer draw that left no mark', { afterPointerRect: 3 }, /pointer rectangle left 3/],
    ['a failed PNG export', { png: { ok: false } }, /PNG export failed/],
    ['a page error', { errors: ['boom @x:1'] }, /page errors: boom/],
    ['the watchdog stage', { stage: 'watchdog' }, /stage watchdog/],
    ['the stock Library trigger on the page', { libraryTrigger: true }, /stock Library trigger/],
    ['the stock Library sidebar open', { libraryOpen: true }, /stock Library sidebar/],
  ] as Array<[string, Partial<Run>, RegExp]>)('not clean: %s', (_name, patch, why) => {
    expect(problems({ ...CLEAN, ...patch }).join(' | ')).toMatch(why);
  });
  it('a browser that never reported is a problem, never a pass', () => {
    expect(problems({ error: NO_REPORT as string })).toEqual([NO_REPORT]);
  });
  it('the harness page has no inline script or style, loads the chunk by import() from a classic script, and walks every tool', () => {
    const files = harnessFiles(shippedBoard()) as Map<string, Buffer | string>;
    const html = String(files.get('/index.html'));
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>|<style|\sstyle=|\son[a-z]+=/i);
    expect(html).not.toMatch(/type="module"/);
    const js = String(files.get('/harness.js'));
    expect(js).toMatch(/import\('\/board\/board\.js'\)/);
    expect(js).toMatch(/securitypolicyviolation/);
    expect(js).toMatch(/R\.phase = 'library'/);
    // since S1.1 the page walks the rail's tools and checks that the engine's other tools are refused
    expect(TOOLS).toEqual(['select', 'sticky', 'text', 'rect', 'ellipse', 'arrow', 'frame', 'stroke', 'hand']);
    expect(REFUSED_TOOLS).toEqual(expect.arrayContaining(['image', 'eraser', 'laser']));
    expect(js).toMatch(/R\.phase = 'command-palette'/);
    expect(js).toMatch(/R\.phase = 'library-drop'/);
    expect(js).toMatch(/R\.phase = 'image-tool'/);
    expect([...files.keys()].filter((k) => k.startsWith('/board/')).length).toBe((shippedBoard() as Map<string, Buffer>).size);
    expect(files.has('/fonts/JetBrainsMono-Regular.woff2')).toBe(true); // the board's one face, from the same embed
  });
});

// Real engines (G-DDL-06, and the live half of G-DDL-07 on the same run). Skipped on CI (the probes job runs them there); on darwin WKWebView is REQUIRED, and a Chromium
// family browser is required wherever one is installed.
describe.skipIf(!!process.env.CI)('G-DDL-06 the shipped board under the unchanged CSP in real engines', () => {
  const { pick } = pickEngines() as { pick: Array<{ name: string; family: string }> };
  const wanted = pick.filter((e) => e.family === 'chromium' || e.family === 'wkwebview');

  it('this machine has the engines the oracle names', () => {
    if (process.platform === 'darwin') expect(wanted.map((e) => e.family), 'WKWebView is the wrapper engine: the oracle needs it on a Mac').toContain('wkwebview');
    if (wanted.length === 0) console.warn('G-DDL-06: no Chromium-family browser or WKWebView on this machine; the engine runs did not happen here'); // eslint-disable-line no-console
  });

  it.skipIf(wanted.length === 0)('no CSP refusal across load, draw, the tool walk, select-then-Library and PNG export', async () => {
    const out = (await runBoardUnderCsp({ engines: wanted, runs: 1, timeoutMs: 90_000 })) as { csp: string; engines: Record<string, EngineRow> };
    expect(out.csp).not.toMatch(/unsafe|data:/);
    expect(Object.keys(out.engines).sort()).toEqual(wanted.map((e) => e.name).sort());
    // every paste and drop check must have RUN in at least one engine here (an engine that reports one as
    // unsupported did not exercise it); which engine ran which is printed with the run
    const exercised: Record<string, string[]> = {};
    for (const [name, e] of Object.entries(out.engines)) for (const [check, ran] of Object.entries(exercisedChecks(e.runs[0]) as Record<string, boolean>)) if (ran) (exercised[check] ??= []).push(name);
    console.info(`G-DDL-07 paste and drop checks exercised: ${JSON.stringify(exercised)}`); // eslint-disable-line no-console
    for (const check of Object.keys(exercisedChecks({}) as object)) expect(exercised[check] ?? [], `${check} ran in no engine`).not.toEqual([]);
    for (const [name, e] of Object.entries(out.engines)) {
      expect(e.problems, `${name} ${e.version}`).toEqual([]);
      const r = e.runs[0]!;
      expect(r.violationCount, name).toBe(0);
      expect(r.mounted, name).toBe(true);
      expect(r.engine, name).toBe('@excalidraw/excalidraw@0.18.1');
      expect(r.afterAddSettled, name).toBe(3); // added in the tick the mount resolved, still there 400 ms later
      expect(r.alive, name).toBe(true);
      expect(r.png?.ok, name).toBe(true);
      expect(r.visibility, name).toBe('visible'); // a hidden page never runs requestAnimationFrame (T-2026-11-06-003)
      // the eraser and laser (whose cursors were data: URLs) are no longer tools: the handle refuses them
      expect(r.refusedTools?.eraser, name).toBe('refused');
      expect(r.refusedTools?.laser, name).toBe('refused');
      expect(e.clean, name).toBe(true);
      // G-DDL-07, live half (boards S1.1), on the same run: one launch per engine
      checkLiveReskin(name, e.family, r as LiveRun);
    }
  }, 400_000);
});
