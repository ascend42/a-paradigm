/**
 * What a finished, clean harness run reports for the S1.1 reskin phases (oracle G-DDL-07's runtime half). Shared by
 * the G-DDL-06 and G-DDL-07 predicate tests so "clean" has one definition.
 */
const shot = { width: 1280, height: 800, png: 'iVBORw0KGgo=' };
const themeOf = (caretColor: string) => ({ marks: shot, selection: shot, marquee: shot, multi: shot, binding: shot, guides: shot, selected: 1, multiSelected: 2, arrowAdded: 1, afterUndo: 0, count: 5, caret: { caretColor, color: caretColor, fontFamily: '"JetBrains Mono", monospace', fontSize: '13.5px', editing: true } });
const rail = ['select', 'sticky', 'text', 'rect', 'ellipse', 'arrow', 'frame', 'stroke', 'hand'];

export const RESKIN_CLEAN: Record<string, unknown> = {
  toolState: Object.fromEntries(rail.map((t) => [t, t])),
  refusedTools: Object.fromEntries(['image', 'eraser', 'laser', 'line', 'diamond', 'embeddable', 'selection', 'freedraw'].map((t) => [t, 'refused'])),
  toolKeys: Object.fromEntries([...'akeqrdo1'].map((k) => [k, 'select'])),
  commandPalette: { stock: [], dialogs: 0 },
  libraryDrop: { stock: [], added: 0 },
  imageTool: { afterKey: 'select', handle: 'refused', node: false, addedByDrop: 0 },
  stockNodes: [],
  canvasFonts: ['<size>px "JetBrains Mono", monospace'],
  fontFaces: ['JetBrains Mono 400 loaded'],
  edge: { profiles: 1, opaque: 52 },
  zoom: { start: 1, afterIn: 1.1, afterOut: 0.9, afterReset: 1 },
  style: { refusedLine: { ok: false, field: 'line', offer: null }, refusedFill: { ok: false, field: 'fill', offer: 'raspberry' }, okLine: { ok: true }, okBack: { ok: true }, after: { line: 'ink', fill: null, weight: 'fine' } },
  skin: { day: themeOf('rgb(22, 21, 15)'), night: themeOf('rgb(232, 244, 240)') },
  narrow: { stock: [], width: 374, height: 304, capture: { width: 374, height: 304, png: 'iVBORw0KGgo=' } },
  stateEvents: 34,
};
