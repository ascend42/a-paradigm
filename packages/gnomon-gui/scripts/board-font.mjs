// #gui-board font metrics (boards S1.1 pass B, item 0a). PURE: no build, no DOM, no dependency.
// Reads the vertical metrics of a WOFF2 file from its own tables, so the engine's `font-metrics` patch
// (scripts/board-patches.mjs BOARD_FONT_METRICS) is the bundled face's numbers and never a remembered value.
// WOFF2 (W3C): a 48-byte header, a table directory, then ONE brotli stream holding the tables in directory order.
// `head`, `hhea` and `OS/2` are never transformed, so they are read as plain sfnt tables.
import { brotliDecompressSync } from 'node:zlib';

const KNOWN = ['cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF ', 'VORG', 'EBDT', 'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH', 'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar', 'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar', 'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill'];

/** The tables of a WOFF2 file that are stored untransformed: Map<tag, Buffer>. Throws on anything that is not WOFF2. */
export function woff2Tables(bytes) {
  if (bytes.toString('latin1', 0, 4) !== 'wOF2') throw new Error('not a WOFF2 file');
  const numTables = bytes.readUInt16BE(12);
  const compressedSize = bytes.readUInt32BE(20);
  let o = 48;
  const base128 = () => {
    let v = 0;
    for (let i = 0; i < 5; i++) {
      const b = bytes[o++];
      v = v * 128 + (b & 0x7f);
      if (!(b & 0x80)) return v;
    }
    throw new Error('bad UIntBase128 in the WOFF2 directory');
  };
  const dir = [];
  for (let i = 0; i < numTables; i++) {
    const flags = bytes[o++];
    let tag = KNOWN[flags & 0x3f];
    if ((flags & 0x3f) === 63) {
      tag = bytes.toString('latin1', o, o + 4);
      o += 4;
    }
    const version = flags >> 6;
    const origLength = base128();
    // glyf and loca are transformed at version 0; every other table at any non-zero version
    const transformed = tag === 'glyf' || tag === 'loca' ? version === 0 : version !== 0;
    const length = transformed ? base128() : origLength;
    dir.push({ tag, length, transformed });
  }
  const data = brotliDecompressSync(bytes.subarray(o, o + compressedSize));
  const out = new Map();
  let at = 0;
  for (const t of dir) {
    if (!t.transformed) out.set(t.tag, data.subarray(at, at + t.length));
    at += t.length;
  }
  return out;
}

/** unitsPerEm (head) and the hhea ascender, descender and line gap of a WOFF2 file, plus the OS/2 typo and win values. */
export function woff2Metrics(bytes) {
  const t = woff2Tables(bytes);
  const head = t.get('head');
  const hhea = t.get('hhea');
  const os2 = t.get('OS/2');
  if (!head || !hhea) throw new Error('the font has no untransformed head or hhea table');
  return {
    unitsPerEm: head.readUInt16BE(18),
    ascender: hhea.readInt16BE(4),
    descender: hhea.readInt16BE(6),
    lineGap: hhea.readInt16BE(8),
    os2: os2 && os2.length >= 78 ? { typoAscender: os2.readInt16BE(68), typoDescender: os2.readInt16BE(70), typoLineGap: os2.readInt16BE(72), winAscent: os2.readUInt16BE(74), winDescent: os2.readUInt16BE(76), useTypoMetrics: (os2.readUInt16BE(62) & 0x80) !== 0 } : null,
  };
}
