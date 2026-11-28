// #gui-board colour oracle helpers (boards S1.1, oracle G-DDL-07; Aegis S1.1 ruling 8). PURE: no build, no DOM.
// Finds every colour literal in a text (hex and rgb()/rgba() with numeric channels) and decodes a PNG to pixels,
// so test/board-reskin.test.ts can measure both against the content palette's reserved colours with the ONE
// OKLab implementation (gnomon-contracts). Nothing here knows a colour: the distances are the caller's.
import { inflateSync } from 'node:zlib';

const hex2 = (n) => n.toString(16).padStart(2, '0');
const HEX = /#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![0-9a-zA-Z_-])/g;
const RGB = /rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*(?:[,/]\s*[0-9.]+%?\s*)?\)/g;

/** Every colour literal in `text`: [{literal, hex}] with hex as #RRGGBB (alpha dropped), in order, duplicates kept. */
export function colourLiterals(text) {
  const out = [];
  for (const m of text.matchAll(HEX)) {
    const h = m[1];
    const six = h.length <= 4 ? [...h.slice(0, 3)].map((c) => c + c).join('') : h.slice(0, 6);
    out.push({ literal: m[0].toLowerCase(), hex: `#${six.toUpperCase()}`, index: m.index });
  }
  for (const m of text.matchAll(RGB)) {
    const ch = [m[1], m[2], m[3]].map(Number);
    if (ch.some((c) => c > 255)) continue;
    out.push({ literal: m[0].replace(/\s+/g, ''), hex: `#${ch.map(hex2).join('').toUpperCase()}`, index: m.index });
  }
  return out.sort((a, b) => a.index - b.index);
}

/** Decode an 8-bit RGB or RGBA, non-interlaced PNG to {width, height, channels, data}. Throws on anything else. */
export function decodePng(bytes) {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (sig.some((b, i) => bytes[i] !== b)) throw new Error('not a PNG');
  let width = 0, height = 0, channels = 0;
  const idat = [];
  for (let o = 8; o < bytes.length; ) {
    const len = bytes.readUInt32BE(o);
    const type = bytes.toString('latin1', o + 4, o + 8);
    const body = bytes.subarray(o + 8, o + 8 + len);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const colour = body[9];
      if (body[8] !== 8 || (colour !== 2 && colour !== 6) || body[12] !== 0) throw new Error(`unsupported PNG (depth ${body[8]}, colour ${colour}, interlace ${body[12]})`);
      channels = colour === 6 ? 4 : 3;
    } else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    o += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const data = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? data[y * stride + x - channels] : 0;
      const b = y > 0 ? data[(y - 1) * stride + x] : 0;
      const c = x >= channels && y > 0 ? data[(y - 1) * stride + x - channels] : 0;
      let v = line[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (f !== 0) throw new Error(`bad PNG filter ${f}`);
      data[y * stride + x] = v & 255;
    }
  }
  return { width, height, channels, data };
}

/** The distinct opaque colours of a decoded PNG: Map<'#RRGGBB', pixel count>. */
export function pixelColours(png) {
  const counts = new Map();
  const { data, channels } = png;
  for (let i = 0; i < data.length; i += channels) {
    const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return new Map([...counts].map(([k, n]) => [`#${k.toString(16).padStart(6, '0').toUpperCase()}`, n]));
}
