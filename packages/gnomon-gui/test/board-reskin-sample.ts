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
  imageTool: { afterKey: 'select', handle: 'refused', node: false, addedByDrop: 0, refused: ['image:no-image-kind'], attempts: ['drop:1'] },
  hostView: { marks: ['rect:human:40,40,160,80', 'ellipse:human:240,40,120,80', 'text:human:60,160,113,18', 'rect:human:500,300,140,100', 'stroke:human:700,300,120,120'], view: { scrollX: 0, scrollY: 0, zoom: 1, width: 1280, height: 800 }, focus: true },
  stockNodes: [],
  canvasFonts: ['<size>px "JetBrains Mono", monospace'],
  fontFaces: ['JetBrains Mono 400 loaded'],
  edge: { profiles: 1, opaque: 52 },
  zoom: { start: 1, afterIn: 1.1, afterOut: 0.9, afterReset: 1 },
  style: { refusedLine: { ok: false, field: 'line', offer: null }, refusedFill: { ok: false, field: 'fill', offer: 'raspberry' }, okLine: { ok: true }, okBack: { ok: true }, after: { line: 'ink', fill: null, weight: 'fine' } },
  skin: { day: themeOf('rgb(22, 21, 15)'), night: themeOf('rgb(232, 244, 240)') },
  fix: {
    undo: { afterDraw: 2, afterUndo: 1 },
    textAfterShape: { selectedBefore: 1, selectedAfterTool: 0, editing: true },
    sceneDrop: { added: 0, said: ['scene-file'], dragStopped: true },
    undoKey: { keys: ['undo', 'redo'], changed: 0 },
    paste: { added: 2, said: ['mark:line'], found: true, edgeGaps: 0, fillAlpha: 0, edgeRgb: [22, 21, 15], line: 'ink', fillToken: null },
    frame: { title: 'a frame title that is long enough to be cut off', weight: '600', editor: { fontFamily: '"JetBrains Mono", monospace', fontSize: '11.5px', fontWeight: '600', color: 'rgb(22, 21, 15)', radius: '0px', editing: true }, afterEsc: { input: false, editing: false } },
    dataDrop: { added: 0, said: ['library-file'], stopped: true, stock: [] },
    hostile: { added: 1, said: ['image', 'mark:embeddable', 'mark:iframe'], nodes: [], violations: 0, forged: { kind: 'rect', author: 'human', stubKind: null, edgeGaps: 0 } },
    hands: ['rect:agent:Arky:60', 'ellipse:unknown:60', 'stub:agent:Luna:live:session:288', 'sticky:human:80', 'text:agent:Quill:62'],
    agentEdgeGaps: 9,
    label: { lines: ['ink'], marksAdded: 1, countAdded: 1 },
  },
  colours: { day: shot, night: shot },
  handleKeys: [],
  matrix: { hands: { human: 19, agent: 19, unknown: 19 }, kinds: ['arrow', 'diamond', 'ellipse', 'frame', 'rect', 'sticky', 'stroke', 'stub', 'text'], day: shot, night: shot },
  zoom400: { zoom: 4, edits: [{ types: ['add'], cause: 'pointerup' }], strokes: 1, capture: shot },
  narrow: { stock: [], width: 374, height: 304, capture: { width: 374, height: 304, png: 'iVBORw0KGgo=' } },
  stateEvents: 34,
};
