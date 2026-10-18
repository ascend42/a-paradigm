/**
 * @symbol #mod-host
 *
 * The closed view kit gate for mod renders (spec §12.2, §4.5; G-MOD-10 part).
 * A rendered block must be `display-block:v1` built ONLY from `kit:v1`
 * (`Box Text List Table Markdown Diff Progress Button Image Canvas`), at most
 * 256 KiB and 2 000 nodes (else BAD_REQUEST). Rules held here:
 *   - an unknown node type or an unknown key is refused (no raw HTML, no
 *     script, no style, no URL: nothing executable can ride a block);
 *   - every string passes the card sanitizer (hidden characters flagged, the
 *     same `sanitizeLine` as kernel cards);
 *   - `Button` carries only a command id (`command`) and a label;
 *   - `Image{blob, alt, w, h}` needs `alt` and a `sha256:` blob id — the
 *     bytes are served by the endpoint's /blob route, never inlined;
 *   - `Canvas{ds, readOnly?}` only NAMES a doodle session (a surface the host
 *     owns); a mod never ships canvas content.
 * The result is fenced and labelled `mod:<name>` (a `dev` flag when
 * dev-linked) by the host; a mod block can never be a card body.
 * The full display-block:v1 contract (a JSON Schema in gnomon-contracts) is
 * M1.1's; this gate is the kernel's fail-closed subset until it lands.
 */
import { KIT_V1_BLOCKS, MOD_BLOCK_LIMITS } from '@a-company/gnomon-contracts';
import { sanitizeLine } from '../broker/card.js';
import { ModRefusal } from './refusal.js';

const SHA = /^sha256:[0-9a-f]{64}$/;
const COMMAND_ID = /^[a-z][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)*$/;

/** Allowed keys per kit block (besides `type`). */
const KEYS: Record<string, readonly string[]> = {
  Box: ['children', 'direction', 'title'],
  Text: ['text', 'tone'],
  List: ['items', 'ordered'],
  Table: ['columns', 'rows'],
  Markdown: ['text'],
  Diff: ['text', 'path'],
  Progress: ['value', 'max', 'label'],
  Button: ['label', 'command'],
  Image: ['blob', 'alt', 'w', 'h'],
  Canvas: ['ds', 'readOnly'],
};

export interface SanitizedBlock {
  block: Record<string, unknown>;
  nodes: number;
  flags: string[];
}

export function sanitizeModBlock(raw: unknown, modName: string): SanitizedBlock {
  const bytes = Buffer.byteLength(JSON.stringify(raw ?? null), 'utf8');
  if (bytes > MOD_BLOCK_LIMITS.maxBytes) throw new ModRefusal('BLOCK', `block of ${bytes} bytes exceeds ${MOD_BLOCK_LIMITS.maxBytes}`, { name: modName, bytes });
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ModRefusal('BLOCK', 'a view must return a display-block:v1 object', { name: modName });
  const top = raw as Record<string, unknown>;
  if (top.schemaVersion !== 'display-block:v1') throw new ModRefusal('BLOCK', 'block.schemaVersion must be display-block:v1', { name: modName });
  const flags = new Set<string>();
  let nodes = 0;
  const str = (v: unknown, at: string): string => {
    if (typeof v !== 'string') throw new ModRefusal('BLOCK', `${at} must be a string`, { name: modName, at });
    const s = sanitizeLine(v);
    for (const f of s.flags) flags.add(f);
    return s.text;
  };
  const num = (v: unknown, at: string): number => {
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new ModRefusal('BLOCK', `${at} must be a finite number`, { name: modName, at });
    return v;
  };
  const node = (v: unknown, at: string): Record<string, unknown> => {
    if (++nodes > MOD_BLOCK_LIMITS.maxNodes) throw new ModRefusal('BLOCK', `block exceeds ${MOD_BLOCK_LIMITS.maxNodes} nodes`, { name: modName });
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new ModRefusal('BLOCK', `${at} must be a kit node`, { name: modName, at });
    const n = v as Record<string, unknown>;
    const type = n.type;
    if (typeof type !== 'string' || !(KIT_V1_BLOCKS as readonly string[]).includes(type)) throw new ModRefusal('BLOCK', `${at}.type is not a kit:v1 block`, { name: modName, at });
    const allowed = KEYS[type]!;
    for (const k of Object.keys(n)) if (k !== 'type' && k !== 'schemaVersion' && !allowed.includes(k)) throw new ModRefusal('BLOCK', `${at}.${k} is not a ${type} field`, { name: modName, at });
    const out: Record<string, unknown> = { type };
    switch (type) {
      case 'Box':
        if (n.title !== undefined) out.title = str(n.title, `${at}.title`);
        if (n.direction !== undefined) out.direction = n.direction === 'row' ? 'row' : 'column';
        if (!Array.isArray(n.children)) throw new ModRefusal('BLOCK', `${at}.children must be an array`, { name: modName, at });
        out.children = n.children.map((c, i) => node(c, `${at}.children[${i}]`));
        break;
      case 'Text':
      case 'Markdown':
        out.text = str(n.text, `${at}.text`);
        if (type === 'Text' && n.tone !== undefined) out.tone = str(n.tone, `${at}.tone`);
        break;
      case 'Diff':
        out.text = str(n.text, `${at}.text`);
        if (n.path !== undefined) out.path = str(n.path, `${at}.path`);
        break;
      case 'List':
        if (!Array.isArray(n.items)) throw new ModRefusal('BLOCK', `${at}.items must be an array`, { name: modName, at });
        out.items = n.items.map((c, i) => node(c, `${at}.items[${i}]`));
        if (n.ordered !== undefined) out.ordered = n.ordered === true;
        break;
      case 'Table':
        if (!Array.isArray(n.columns) || !Array.isArray(n.rows)) throw new ModRefusal('BLOCK', `${at} needs columns[] and rows[]`, { name: modName, at });
        out.columns = n.columns.map((c, i) => str(c, `${at}.columns[${i}]`));
        out.rows = n.rows.map((r, i) => {
          if (!Array.isArray(r)) throw new ModRefusal('BLOCK', `${at}.rows[${i}] must be an array`, { name: modName, at });
          return r.map((c, j) => str(c, `${at}.rows[${i}][${j}]`));
        });
        nodes += (out.rows as unknown[][]).reduce((a, r) => a + r.length, 0);
        if (nodes > MOD_BLOCK_LIMITS.maxNodes) throw new ModRefusal('BLOCK', `block exceeds ${MOD_BLOCK_LIMITS.maxNodes} nodes`, { name: modName });
        break;
      case 'Progress':
        out.value = num(n.value, `${at}.value`);
        if (n.max !== undefined) out.max = num(n.max, `${at}.max`);
        if (n.label !== undefined) out.label = str(n.label, `${at}.label`);
        break;
      case 'Button':
        out.label = str(n.label, `${at}.label`);
        if (typeof n.command !== 'string' || !COMMAND_ID.test(n.command)) throw new ModRefusal('BLOCK', `${at}.command must be a command id`, { name: modName, at });
        out.command = n.command;
        break;
      case 'Image':
        if (typeof n.blob !== 'string' || !SHA.test(n.blob)) throw new ModRefusal('BLOCK', `${at}.blob must be a sha256: blob id`, { name: modName, at });
        out.blob = n.blob;
        out.alt = str(n.alt, `${at}.alt`);
        if (!(out.alt as string).trim()) throw new ModRefusal('BLOCK', `${at}.alt is required`, { name: modName, at });
        out.w = num(n.w, `${at}.w`);
        out.h = num(n.h, `${at}.h`);
        break;
      case 'Canvas':
        out.ds = str(n.ds, `${at}.ds`);
        if (n.readOnly !== undefined) out.readOnly = n.readOnly === true;
        break;
    }
    return out;
  };
  const block = { schemaVersion: 'display-block:v1', ...node(top, 'block') };
  return { block, nodes, flags: [...flags] };
}
