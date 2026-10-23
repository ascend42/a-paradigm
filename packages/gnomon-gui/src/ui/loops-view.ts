/**
 * @symbol #gui-loops
 *
 * #gui-loops DOM (docs/specs/gnomon-loops.md §6; Atelier 2026-10-22-gnomon-loops-ui, the approved direction
 * refs/direction.html; design-system components loops-word, loops-leaf, loop-row, loop-list, loop-detail,
 * budget-field, loop-graph, run-trace, loop-trust-unfolded, loop-diff, alert, trust-slip). Everything shown is
 * computed by core/loops.ts and core/loop-graph.ts; every string reaches the DOM as a text node.
 *
 *   - The Loops leaf slides over the centre column; Esc folds it to the edge tab ("loops · 1 running · 2 waiting").
 *     Esc order: an unfolded trust card first, then the leaf.
 *   - Every key that sends something needs the human's own press (Event.isTrusted) and goes through deps.request
 *     (log.append of a request.loop.*; the kernel stamps the asker and asks presence where it must).
 *   - Stack pieces (alerts and the trust slip) are built here and placed by app.ts under the decision cards.
 */
import { h, type MiniDoc } from '../core/render.js';
import type { ShownRefusal } from '../core/client.js';
import { localStatusOf } from '../core/local-model.js';
import { cantStart, runRefusalOf, startLine, authorPhrase, budgetFields, budgetKey, budgetRequest, detailKeys, edgeTab, hhmm, keepLine, leafMeta, loopGroups, loopRequest, loopsOf, projectOf, runPath, runTrace, trustSections, type LoopAct, type LoopAlert, type LoopItem, type LoopsModel, type SlipLine } from '../core/loops.js';
import { graphScale, layoutGraph, ZOOM_STEP, type GraphLayout } from '../core/loop-graph.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

export interface LoopsViewDeps {
  doc: Document;
  /** the centre column (the leaf and the unfolded card cover it, never the rail, the stack or the header) */
  host: HTMLElement;
  status: () => unknown;
  hue: (repo: string) => number;
  request: (req: { kind: string; payload: Record<string, unknown> }, trusted: boolean, done: string, onRefused?: (r: ShownRefusal) => void) => Promise<boolean>;
  /** #gui-local-model: open Settings at the Local model section (section-focused; closing returns focus here) */
  openLocal: () => void;
  pauseAll: (trusted: boolean) => void;
  /** say something as a toast (a GUI outcome) */
  say: (text: string, kind?: 'info' | 'warn' | 'fail') => void;
  /** the loop-trust card element for an unfolded read (rendered by the stack's renderer), or null */
  trustCard: (cardId: string) => { el: HTMLElement; lines: string[]; loopId: string | null } | null;
  /** the card is still pending (a stack repaint rebuilds the pile; only a decided or swept card folds the read) */
  hasCard: (cardId: string) => boolean;
  /** a press inside the unfolded card (its decision keys) */
  onCardClick: (e: Event) => void;
}

export interface LoopsView {
  open(at?: { key?: string; runId?: string; waiting?: boolean }): void;
  fold(): void;
  isOpen(): boolean;
  /** Esc: fold the unfolded trust card, else fold the leaf; false when neither is showing */
  escape(): boolean;
  repaint(): void;
  unfoldTrust(cardId: string): void;
  model(): LoopsModel | null;
}

/** A key, disabled with its reason in title= (h() allows no `disabled` attribute: it is set on the element). */
function keyEl(doc: Document, attrs: Record<string, string>, label: string, disabled: string | false): HTMLElement {
  const b = el(doc, 'button', { ...attrs, ...(disabled ? { title: disabled } : {}) }, label) as HTMLButtonElement;
  b.disabled = !!disabled;
  return b;
}

const el = (doc: Document, tag: string, attrs: Record<string, string> | null, ...kids: Array<Node | string | null | undefined | false>): HTMLElement => h(doc as unknown as MiniDoc, tag, attrs, ...(kids as never[])) as unknown as HTMLElement;

function svgEl(doc: Document, tag: string, attrs: Record<string, string | number>, text?: string): SVGElement {
  const e = doc.createElementNS(SVG_NS, tag) as SVGElement;
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (text !== undefined) e.textContent = text;
  return e;
}

/** The graph as SVG (design-system loop-graph markup: .g-box, .g-e, .g-l, .g-term). */
export function graphSvg(doc: Document, l: GraphLayout, scale: number, name: string): SVGElement {
  const svg = svgEl(doc, 'svg', { class: 'g-svg', width: Math.round(l.w * scale), height: Math.round(l.h * scale), viewBox: `0 0 ${l.w} ${l.h}`, role: 'img', 'aria-label': `${name} graph, ${l.orient === 'ltr' ? 'left to right' : 'top to bottom'}` });
  const defs = svgEl(doc, 'defs', {});
  for (const [id, cls] of [['g-arh', 'g-ar'], ['g-arth', 'g-ar taken']] as const) {
    const m = svgEl(doc, 'marker', { id, viewBox: '0 0 8 8', refX: 7, refY: 4, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' });
    m.appendChild(svgEl(doc, 'path', { class: cls, d: 'M0,0 L8,4 L0,8 z' }));
    defs.appendChild(m);
  }
  svg.appendChild(defs);
  for (const e of l.edges) {
    const p = svgEl(doc, 'path', { class: `g-e${e.taken ? ' taken' : ''}`, d: e.d, ...(e.arrow ? { 'marker-end': `url(#${e.taken ? 'g-arth' : 'g-arh'})` } : {}) });
    if (e.full) p.appendChild(svgEl(doc, 'title', {}, e.full));
    svg.appendChild(p);
  }
  for (const e of l.edges)
    if (e.label) {
      const t = svgEl(doc, 'text', { class: `g-l${e.taken ? ' taken' : ''}`, x: e.lx, y: e.ly, 'text-anchor': e.anchor }, e.label);
      t.appendChild(svgEl(doc, 'title', {}, e.full));
      svg.appendChild(t);
    }
  for (const b of l.boxes) {
    const g = svgEl(doc, 'g', { 'data-node': b.id });
    g.appendChild(svgEl(doc, 'title', {}, b.label));
    g.appendChild(svgEl(doc, 'rect', { class: `g-box${b.cls ? ` ${b.cls}` : ''}`, x: b.x, y: b.y, width: b.w, height: b.h, rx: 3 }));
    g.appendChild(svgEl(doc, 'text', { class: 'g-mk', x: b.x + 8, y: b.y + 18 }, b.mark));
    g.appendChild(svgEl(doc, 'text', { class: 'g-id', x: b.x + 24, y: b.y + 18 }, b.id));
    if (b.visits > 1) g.appendChild(svgEl(doc, 'text', { class: 'g-vis', x: b.x + b.w - 8, y: b.y + 18, 'text-anchor': 'end' }, `×${b.visits}`));
    g.appendChild(svgEl(doc, 'text', { class: 'g-ty', x: b.x + 8, y: b.y + 36 }, b.ty));
    svg.appendChild(g);
  }
  for (const t of l.terms) {
    svg.appendChild(svgEl(doc, 'rect', { class: 'g-term', x: t.x, y: t.y, width: t.w, height: t.h, rx: 14 }));
    svg.appendChild(svgEl(doc, 'text', { class: 'g-t', x: t.x + t.w / 2, y: t.y + 18, 'text-anchor': 'middle' }, t.id));
  }
  return svg;
}

/** Loop alerts for the stack: flat sheets, a ↻ loop family head, the run path, quiet keys only (Open run, Dismiss). */
export function alertEl(doc: Document, a: LoopAlert, hue: number): HTMLElement {
  const path = el(doc, 'p', { class: 'path' });
  for (const part of a.path.split(/(✕|\?)/)) path.appendChild(part === '✕' ? el(doc, 'span', { class: 'x' }, '✕') : part === '?' ? el(doc, 'span', { class: 'u' }, '?') : doc.createTextNode(part));
  return el(
    doc,
    'section',
    { class: `card alert${a.kind === 'fail' ? ' fail' : a.kind === 'kernel-pause' ? ' kpause' : ''}`, role: 'group', 'aria-label': 'loop alert', 'data-alert': a.id },
    el(doc, 'header', { class: 'card-head k' }, el(doc, 'span', { class: 'fam' }, '↻ loop'), ' · ', el(doc, 'span', { class: `card-project pink h${hue}` }, `■ ${a.project}`), ' · ', el(doc, 'span', { class: 'card-kind' }, `alert${a.at ? ` · ${a.at}` : ''}`)),
    el(doc, 'p', { class: 'card-title', title: a.title }, a.title),
    a.path ? path : null,
    el(doc, 'div', { class: 'card-keys' }, a.fix ? el(doc, 'button', { class: 'key quiet', type: 'button', 'data-local-open': a.key }, a.fix) : el(doc, 'button', { class: 'key quiet', type: 'button', 'data-loop-open': a.key, ...(a.runId ? { 'data-run-id': a.runId } : {}) }, 'Open run'), el(doc, 'button', { class: 'key quiet', type: 'button', 'data-loop-dismiss': a.id, 'aria-label': `Dismiss the ${a.loopId} alert` }, 'Dismiss')),
  );
}

/** The waiting-for-trust slip at the stack's foot (not a card: dashed, unfilled, Review only). */
export function slipEl(doc: Document, slip: { tab: string; lines: SlipLine[]; more?: number }): HTMLElement {
  return el(
    doc,
    'div',
    { class: 'wt-slip', role: 'group', 'aria-label': 'loops waiting for trust' },
    el(doc, 'div', { class: 'tab' }, slip.tab),
    ...slip.lines.map((l) => el(doc, 'div', { class: 'row' }, el(doc, 'span', { title: l.text }, l.text), el(doc, 'button', { class: 'key quiet', type: 'button', 'data-loop-review': l.key, 'aria-label': `Review ${l.loopId}` }, 'Review'))),
    slip.more ? el(doc, 'div', { class: 'row' }, el(doc, 'span', null, `+${slip.more} more`), el(doc, 'button', { class: 'key quiet', type: 'button', 'data-loop-review-all': '1', title: 'Open Loops on the loops waiting for trust' }, 'Review all')) : null,
  );
}

export function mountLoopsView(d: LoopsViewDeps): LoopsView {
  const { doc } = d;
  const wideQ = matchMedia('(min-width: 1200px)');
  let open = false;
  let arrive = false;
  let selected: string | null = null;
  let detailOnly = false;
  let zoom: number | null = null;
  let unfolded: string | null = null;
  let returnTo: HTMLElement | null = null;
  const budgetTyped = new Map<string, string>();
  let waitingOnly = false;
  let model: LoopsModel | null = null;
  /** #gui-local-model: a Run now the kernel refused no-local-model, per loop, until the local config version moves */
  const runRefused = new Map<string, { sr: NonNullable<LoopItem['startRefused']>; version: number | null }>();
  const withRunRefusals = (m: LoopsModel | null): LoopsModel | null => {
    if (!m || !runRefused.size) return m;
    const version = localStatusOf(d.status()).version;
    for (const [k, v] of [...runRefused]) if (v.version !== version) runRefused.delete(k);
    return { ...m, loops: m.loops.map((x) => (x.startRefused || !runRefused.has(x.key) ? x : { ...x, startRefused: runRefused.get(x.key)!.sr })) };
  };

  const leaf = el(doc, 'div', { class: 'lp-leaf', role: 'region', 'aria-label': 'Loops' });
  leaf.hidden = true;
  const tab = el(doc, 'button', { class: 'lp-edgetab', type: 'button', title: 'Open Loops' });
  tab.hidden = true;
  const lt = el(doc, 'div', { class: 'lt-wrap', role: 'dialog', 'aria-label': 'loop-trust card, unfolded' });
  lt.hidden = true;
  d.host.append(leaf, tab);
  (d.host.parentElement ?? d.host).appendChild(lt);

  const item = (key: string | null): LoopItem | undefined => model?.loops.find((x) => x.key === key);

  function paintHead(m: LoopsModel): HTMLElement {
    // Pause all only when there is a loop to pause; after it, resuming is per loop (Resume · presence in each detail)
    const kill = m.pausedAll
      ? el(doc, 'span', { class: 'meta' }, 'resume each loop from its detail · presence')
      : m.loops.length
        ? el(doc, 'button', { class: 'key quiet', type: 'button', 'data-lp': 'pause-all', title: 'Pause every loop now (loops.pause-all). No presence; resuming needs it.' }, 'Pause all')
        : null;
    return el(
      doc,
      'div',
      null,
      el(doc, 'div', { class: 'lp-head' }, el(doc, 'span', { class: 'title' }, 'Loops'), el(doc, 'span', { class: 'meta', title: leafMeta(m) }, leafMeta(m)), el(doc, 'span', { class: 'spacer' }), kill, el(doc, 'button', { class: 'key quiet', type: 'button', 'data-lp': 'fold', title: 'Fold to the edge tab (Esc)' }, 'esc')),
      el(doc, 'div', { class: 'lp-keep kernel-owned', title: m.uptime?.line ?? '' }, keepLine(m)),
    );
  }

  function paintList(m: LoopsModel): HTMLElement {
    const body = el(doc, 'div', { class: 'lp-body' });
    if (!m.loops.length) body.appendChild(el(doc, 'p', { class: 'meta lp-empty' }, 'No loops yet. An agent can write one in a session, or add .paradigm/loops/<id>.loop.json; nothing runs until you trust it.'));
    if (waitingOnly) body.appendChild(el(doc, 'div', { class: 'lp-gh' }, 'waiting for trust only · ', el(doc, 'button', { class: 'key quiet', type: 'button', 'data-lp': 'show-all' }, 'show all')));
    for (const g of loopGroups(m, Date.now()).map((x) => (waitingOnly ? { ...x, rows: x.rows.filter((r) => item(r.key)?.state === 'waiting-trust') } : x)).filter((x) => x.rows.length && (!waitingOnly || x.repo === null))) {
      body.appendChild(el(doc, 'div', { class: 'lp-gh' }, g.repo ? el(doc, 'span', { class: `swatch sw h${d.hue(g.repo)}`, 'aria-hidden': 'true' }) : null, g.head));
      for (const r of g.rows) {
        const x = item(r.key)!;
        body.appendChild(
          el(
            doc,
            'button',
            { class: `lp-row${r.key === selected ? ' active' : ''}`, type: 'button', 'data-loop': r.key, title: r.title, ...(r.key === selected ? { 'aria-current': 'true' } : {}) },
            el(doc, 'span', { class: 'mk', 'aria-hidden': 'true' }, r.mark),
            el(doc, 'strong', { class: 'nm' }, r.name),
            el(doc, 'span', { class: 'l1' }, ` · ${r.l1}`),
            el(doc, 'span', { class: 'nx' }, r.nx),
            el(doc, 'span', { class: 'l2' }, r.swatch ? el(doc, 'span', { class: `swatch sw h${d.hue(x.repo)}`, 'aria-hidden': 'true' }) : null, r.l2),
          ),
        );
      }
    }
    return el(doc, 'div', { class: 'lp' }, paintHead(m), body);
  }

  function paintGraph(x: LoopItem, frame: HTMLElement): void {
    const view = frame.querySelector('.g-view') as HTMLElement;
    const ori = frame.querySelector('.g-ori') as HTMLElement;
    const shape = x.shape;
    view.textContent = '';
    if (!shape || !shape.nodes.length) {
      ori.textContent = 'no graph: the kernel did not send this loop\'s shape';
      return;
    }
    const room = Math.max(160, (view.clientWidth || 380) - 12);
    const run = x.runs[0];
    const l = layoutGraph({ nodes: shape.nodes, start: shape.start, ...(run ? { run } : {}), live: !!run && !run.endedAt }, room);
    const s = graphScale(zoom, l.w, room);
    ori.textContent = `${l.orient === 'ltr' ? 'left to right' : `top to bottom${zoom === null ? ', to fit' : ''}`} · ${Math.round(s * 100)}%`;
    view.appendChild(graphSvg(doc, l, s, x.loopId));
  }

  function paintDetail(x: LoopItem): HTMLElement {
    const { chip, keys, why } = detailKeys(x);
    const head = el(doc, 'div', { class: 'lp-dhead' }, el(doc, 'button', { class: 'key quiet lp-back', type: 'button', 'data-lp': 'back' }, '← Loops'), el(doc, 'span', { class: 'title', title: x.loopId }, x.loopId), el(doc, 'span', { class: 'chip ink' }, chip), x.shape ? el(doc, 'span', { class: 'chip' }, authorPhrase(x)) : null, el(doc, 'span', { class: 'spacer' }));
    for (const k of keys.filter((y) => !y.more)) head.appendChild(keyEl(doc, { class: `key${k.pri ? ' pri' : ''}${k.quiet ? ' quiet' : ''}`, type: 'button', 'data-loop-act': k.act }, k.label, k.disabled ?? false));
    const more = keys.filter((y) => y.more);
    if (more.length) head.appendChild(el(doc, 'details', { class: 'lp-more' }, el(doc, 'summary', { class: 'key quiet', 'aria-label': 'More loop keys' }, '⋯'), el(doc, 'div', { class: 'mode-menu lp-more-menu', role: 'menu' }, ...more.map((k) => el(doc, 'button', { class: 'mode-item', type: 'button', role: 'menuitem', 'data-loop-act': k.act }, k.label)))));
    const auto = x.effective?.autonomy && x.effective.autonomy !== (x.effective.declared ?? x.shape?.autonomy) ? `${x.effective.declared ?? x.shape?.autonomy} → ${x.effective.autonomy}${x.effective.capReason ? ` (${x.effective.capReason})` : ''}` : (x.shape?.autonomy ?? '');
    const meta = [`■ ${projectOf(x)}`, x.shape?.triggers.join(' + ') || 'manual', auto, 'local only', x.trustedHash ? `trusted ${x.trustedHash.replace(/^sha256:/, '').slice(0, 8)}` : '', x.changed && x.contentHash ? `change ${x.contentHash.replace(/^sha256:/, '').slice(0, 8)} waits for trust` : '', x.reason && x.state !== 'running' ? `paused: ${x.reason}` : ''].filter(Boolean).join(' · ');
    const run = x.runs[0];
    // TD-2026-10-22-769 (design-system loop-detail.cant_start): the kernel's why in words, one key to the fix
    const sl = cantStart(x) ? startLine(x.startRefused!, localStatusOf(d.status()).endpoints[0]?.model ?? null) : null;
    const refusal = sl ? el(doc, 'div', { class: 'lp-refusal', role: 'status' }, el(doc, 'span', { class: 'rf-h' }, sl.head), el(doc, 'span', { class: 'rf-t' }, sl.text), el(doc, 'button', { class: 'key', type: 'button', 'data-lp-local': '1' }, sl.key)) : null;
    const frame = el(doc, 'div', { class: 'g-frame' }, el(doc, 'div', { class: 'g-tools' }, el(doc, 'span', { class: 'g-ori meta' }), el(doc, 'span', { class: 'spacer' }), el(doc, 'button', { class: 'key quiet', type: 'button', 'data-zoom': '-1', 'aria-label': 'Zoom out' }, '−'), el(doc, 'button', { class: 'key quiet', type: 'button', 'data-zoom': '0' }, 'fit'), el(doc, 'button', { class: 'key quiet', type: 'button', 'data-zoom': '1', 'aria-label': 'Zoom in' }, '+')), el(doc, 'div', { class: 'g-view' }), el(doc, 'p', { class: 'g-key' }, '✓ pass · ✕ fail (heavy edge) · ? unsure · … waiting · · not reached (dashed) · solid edges: the last loop run\'s path · ×n visits'));
    // budgets on one line (label, field, its key); the one note names the cost of the field being edited
    const buds = el(doc, 'div', { class: 'bud' });
    let note = 'lower a cap and Apply · tighter applies now; a higher cap is a change to the loop file and waits for trust';
    for (const b of budgetFields(x)) {
      const typed = budgetTyped.get(`${x.key}\u0000${b.path}`) ?? String(b.value);
      const k = budgetKey(b.value, typed);
      if (k.dir !== 'same') note = k.note;
      const keyShown = k.dir === 'same' ? null : keyEl(doc, { class: 'key', type: 'button', 'data-budget-key': b.path, 'data-dir': k.dir }, k.label, k.enabled ? false : k.note);
      buds.appendChild(el(doc, 'span', { class: 'bud-f' }, el(doc, 'span', { class: 'bud-l' }, b.label), el(doc, 'input', { class: 'field', type: 'number', value: typed, 'aria-label': b.label, 'data-budget': b.path, 'data-old': String(b.value) }), keyShown));
    }
    buds.appendChild(el(doc, 'span', { class: 'why-off bud-note' }, note));
    const trace = el(doc, 'ol', { class: 'tr' });
    for (const t of runTrace(run)) trace.appendChild(el(doc, 'li', null, el(doc, 'span', { class: 'tm' }, t.tm), el(doc, 'span', { class: `m${t.cls ? ` ${t.cls}` : ''}` }, t.mark), el(doc, 'span', null, el(doc, 'strong', null, t.node), ` · ${t.what}`), el(doc, 'span', { class: 'dur' }, t.dur)));
    const runs = el(doc, 'ol', { class: 'tr' });
    for (const r of x.runs.slice(0, 8)) runs.appendChild(el(doc, 'li', null, el(doc, 'span', { class: 'tm' }, hhmm(r.startedAt)), el(doc, 'span', { class: `m${r.reason === 'goal' ? '' : r.endedAt ? ' fail' : ''}` }, r.reason === 'goal' ? '✓' : r.endedAt ? '✕' : '●'), el(doc, 'span', { title: runPath(r) }, runPath(r) || r.runId), el(doc, 'span', { class: 'dur' }, r.reason ?? 'running')));
    const out = el(
      doc,
      'div',
      { class: 'lp-detail', 'data-detail': x.key },
      head,
      el(doc, 'div', { class: 'lp-dmeta' }, meta, why ? ' · ' : null, why ? el(doc, 'span', { class: 'dis-why' }, why) : null),
      refusal,
      el(doc, 'div', { class: 'lp-sec' }, el(doc, 'h3', null, run ? `graph · loop run ${run.runId.slice(-4)} · ${hhmm(run.startedAt)} · ${run.endedAt ? run.reason ?? 'ended' : 'in flight'}` : 'graph · no loop run yet'), frame),
      budgetFields(x).length ? el(doc, 'div', { class: 'lp-sec' }, el(doc, 'h3', null, 'budgets'), buds) : null,
      el(doc, 'div', { class: 'lp-sec' }, el(doc, 'h3', null, 'last loop run'), run ? trace : el(doc, 'p', { class: 'meta' }, 'no loop run yet')),
      x.runs.length > 1 ? el(doc, 'div', { class: 'lp-sec' }, el(doc, 'h3', null, 'loop runs'), runs) : null,
    );
    queueMicrotask(() => paintGraph(x, frame));
    return out;
  }

  function repaint(): void {
    model = withRunRefusals(loopsOf(d.status()));
    tab.hidden = open || !model || !model.loops.length;
    if (model) tab.textContent = edgeTab(model);
    d.host.classList.toggle('lp-tab-on', !tab.hidden);
    if (!open || !model) {
      leaf.hidden = true;
      return;
    }
    leaf.hidden = false;
    if (selected && !item(selected)) selected = null;
    const sel = item(selected);
    const wide = wideQ.matches;
    const focusKey = (doc.activeElement as HTMLElement | null)?.closest?.('[data-loop]')?.getAttribute('data-loop') ?? null;
    leaf.textContent = '';
    leaf.className = `lp-leaf${arrive ? ' arrive' : ''}`;
    arrive = false;
    leaf.appendChild(el(doc, 'div', { class: 'gut', 'aria-hidden': 'true' }));
    if (wide) {
      const split = el(doc, 'div', { class: 'leaf-split' }, paintList(model), sel ? paintDetail(sel) : el(doc, 'div', { class: 'lp-detail' }, el(doc, 'p', { class: 'meta lp-pick' }, 'Pick a loop to see its graph, last loop run and keys.')));
      leaf.appendChild(split);
    } else leaf.appendChild(sel && detailOnly ? paintDetail(sel) : paintList(model));
    if (focusKey) (leaf.querySelector(`[data-loop="${CSS.escape(focusKey)}"]`) as HTMLElement | null)?.focus();
  }

  function openLeaf(at?: { key?: string; runId?: string; waiting?: boolean }): void {
    waitingOnly = !!at?.waiting;
    if (waitingOnly) detailOnly = false;
    if (!open) {
      returnTo = doc.activeElement as HTMLElement | null;
      arrive = true;
    }
    open = true;
    if (at?.key) {
      selected = at.key;
      detailOnly = true;
    }
    repaint();
    ((leaf.querySelector('.lp-row.active') ?? leaf.querySelector('[data-lp="fold"]')) as HTMLElement | null)?.focus();
  }
  function fold(): void {
    if (!open) return;
    open = false;
    repaint();
    (returnTo && returnTo.isConnected ? returnTo : tab).focus();
  }
  function foldTrust(): void {
    unfolded = null;
    lt.hidden = true;
    lt.textContent = '';
  }

  function unfoldTrust(cardId: string): void {
    const c = d.trustCard(cardId);
    if (!c) return d.say('that loop-trust card is not in the stack any more', 'warn');
    unfolded = cardId;
    const card = c.el;
    card.classList.add('long');
    // the same card, unfolded: the kernel line, the sections in reading order, then Trust and Don't trust at the foot
    const keys = card.querySelector('.card-keys');
    for (const b of [...card.querySelectorAll<HTMLElement>('[data-decision]')]) b.textContent = b.dataset.decision === 'allow' ? 'Trust' : b.dataset.decision === 'deny' ? "Don't trust" : b.textContent;
    const after = card.querySelector('.card-title');
    const frag = doc.createDocumentFragment();
    for (const s of trustSections(c.lines)) {
      const sec = el(doc, 'div', { class: 'lt-sec' }, el(doc, 'h3', null, s.head));
      for (const l of s.lines) sec.appendChild(l.cls === 'gate' ? el(doc, 'p', { class: 'gate-note' }, l.text) : el(doc, 'div', { class: `df ${l.cls}` }, l.text));
      frag.appendChild(sec);
    }
    after?.after(frag);
    const foot = el(doc, 'div', { class: 'lt-foot' });
    if (keys) foot.appendChild(keys);
    foot.appendChild(el(doc, 'div', { class: 'lt-presence' }, 'Trust takes the root key and Touch ID · never standing, never by voice'));
    const hash = card.querySelector('.content-hash');
    if (hash) foot.appendChild(hash);
    card.appendChild(foot);
    lt.textContent = '';
    lt.append(el(doc, 'button', { class: 'key quiet lt-fold', type: 'button', 'data-lp': 'fold-trust', title: 'Fold back into the stack (Esc)' }, '← back to the stack'), card);
    // over the centre and the sessions rail (the listing reads near 80ch at 1024); the stack and the header stay
    const stack = doc.getElementById('pane-stack');
    lt.style.right = `${stack && stack.offsetParent ? stack.offsetWidth : 0}px`;
    lt.hidden = false;
    (lt.querySelector('.lt-fold') as HTMLElement | null)?.focus();
  }

  async function act(a: LoopAct, x: LoopItem, trusted: boolean): Promise<void> {
    if (a === 'trust') return void (await d.request(loopRequest(x, 'trust'), trusted, `a loop-trust card for ${x.loopId} is in the stack: Read, then Trust`));
    const done: Record<LoopAct, string> = { trust: '', run: `loop run of ${x.loopId} started`, pause: `${x.loopId} paused`, resume: `${x.loopId} resumed`, untrust: `${x.loopId} is untrusted: it will not run until you trust it again`, delete: `${x.loopId} deleted` };
    await d.request(loopRequest(x, a), trusted, done[a], (r) => {
      // a Run now refused for want of a local model shows the can't-start line (the kernel's why)
      const sr = a === 'run' ? runRefusalOf(r, x, new Date().toISOString()) : null;
      if (sr) runRefused.set(x.key, { sr, version: localStatusOf(d.status()).version });
    });
  }

  leaf.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const lp = t.closest('[data-lp]')?.getAttribute('data-lp');
    if (lp === 'fold') return fold();
    if (lp === 'back') {
      detailOnly = false;
      return repaint();
    }
    if (lp === 'pause-all') return d.pauseAll(e.isTrusted);
    if (t.closest('[data-lp-local]')) return d.openLocal();
    if (lp === 'show-all') {
      waitingOnly = false;
      return repaint();
    }
    const row = t.closest('[data-loop]')?.getAttribute('data-loop');
    if (row) {
      selected = row;
      detailOnly = true;
      zoom = null;
      return repaint();
    }
    const z = t.closest('[data-zoom]')?.getAttribute('data-zoom');
    if (z !== undefined && z !== null) {
      const sel = item(selected);
      const view = leaf.querySelector('.g-view') as HTMLElement | null;
      const cur = view?.querySelector('svg') ? Number(view.querySelector('svg')!.getAttribute('width')) / Number(view.querySelector('svg')!.getAttribute('viewBox')!.split(' ')[2]) : 1;
      zoom = z === '0' ? null : Math.max(0.25, Math.min(2, z === '1' ? cur * ZOOM_STEP : cur / ZOOM_STEP));
      const frame = leaf.querySelector('.g-frame') as HTMLElement | null;
      if (sel && frame) paintGraph(sel, frame);
      return;
    }
    const a = t.closest('[data-loop-act]')?.getAttribute('data-loop-act') as LoopAct | null;
    const x = item(selected);
    if (a && x) return void act(a, x, e.isTrusted);
    const bk = t.closest('[data-budget-key]') as HTMLElement | null;
    if (bk && x && bk.dataset.dir === 'tighter') {
      // request.loop.budget: narrowing only, no presence (a looser cap's key is disabled: it waits for trust)
      const path = bk.dataset.budgetKey!;
      const v = Number((leaf.querySelector(`[data-budget="${CSS.escape(path)}"]`) as HTMLInputElement | null)?.value);
      void d.request(budgetRequest(x, path, v), e.isTrusted, `${x.loopId}: ${path.replace('.', ' · ')} is ${v} now`).then((ok) => {
        if (ok) budgetTyped.delete(`${x.key}\u0000${path}`);
      });
    }
  });
  leaf.addEventListener('input', (e) => {
    const f = e.target as HTMLInputElement;
    const path = f.dataset.budget;
    if (!path || !selected) return;
    budgetTyped.set(`${selected}\u0000${path}`, f.value);
    const k = budgetKey(Number(f.dataset.old), f.value);
    let key = f.parentElement?.querySelector('[data-budget-key]') as HTMLButtonElement | null;
    if (!key && k.dir !== 'same') {
      key = keyEl(doc, { class: 'key', type: 'button', 'data-budget-key': path, 'data-dir': k.dir }, k.label, false) as HTMLButtonElement;
      f.after(key);
    }
    if (key) {
      if (k.dir === 'same') key.remove();
      key.textContent = k.label;
      key.disabled = !k.enabled;
      key.title = k.enabled ? '' : k.note;
      key.dataset.dir = k.dir;
    }
    const note = leaf.querySelector('.bud-note');
    if (note) note.textContent = k.note;
  });
  tab.addEventListener('click', () => openLeaf());
  lt.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('[data-lp="fold-trust"]')) return foldTrust();
    d.onCardClick(e);
  });
  wideQ.addEventListener?.('change', () => repaint());

  return {
    open: openLeaf,
    fold,
    isOpen: () => open,
    escape: () => {
      if (unfolded) {
        foldTrust();
        return true;
      }
      if (open) {
        fold();
        return true;
      }
      return false;
    },
    repaint: () => {
      repaint();
      if (unfolded && !d.hasCard(unfolded)) foldTrust();
    },
    unfoldTrust,
    model: () => model ?? withRunRefusals(loopsOf(d.status())),
  };
}
