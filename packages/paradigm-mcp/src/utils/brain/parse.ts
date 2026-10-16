/**
 * #brain-parse — metadata extraction for .md / .txt ONLY.
 *
 * Extracts: title, ATX headings, [[wikilinks]] (#heading, ^block, |alias, ![[embed]]),
 * relative markdown links, frontmatter tags/aliases/relates (lenient parser).
 *
 * Bodies are NEVER matched against symbol regexes: Obsidian `#tag`, `^block`,
 * `$x$`, `~~s~~` in prose yield nothing here. Frontmatter tags → tags, never symbols.
 * Returned strings are data (untrusted) — control chars stripped, lengths capped.
 */
import * as path from 'node:path';
import { parseFrontmatter } from '@a-company/premise-core';
import type { LinkRef, ParsedDoc } from './types.js';

const MAX_STR = 200;
const MAX_HEADINGS = 200;
const MAX_LINKS = 500;
const MAX_TAGS = 50;

// eslint-disable-next-line no-control-regex
const CTRL_RE = /[\u0000-\u0008\u000B-\u001F\u007F​-‏‪-‮⁦-⁩]/g;

export function cleanString(s: unknown): string {
  return String(s).replace(CTRL_RE, '').replace(/\s+/g, ' ').trim().slice(0, MAX_STR);
}

function strList(v: unknown, stripHash: boolean): string[] {
  const arr = Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[,\s]+/) : [];
  const out: string[] = [];
  for (const item of arr) {
    if (typeof item !== 'string' && typeof item !== 'number') continue;
    let s = cleanString(item);
    if (stripHash) s = s.replace(/^#+/, '');
    if (s && !out.includes(s)) out.push(s);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

function relatesList(v: unknown): string[] {
  const arr = Array.isArray(v) ? v : typeof v === 'string' ? [v] : [];
  const out: string[] = [];
  for (const item of arr) {
    if (typeof item !== 'string') continue;
    const s = cleanString(item);
    if (s && !out.includes(s)) out.push(s);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

const WIKILINK_RE = /(!?)\[\[([^\[\]\n]{1,300})\]\]/g;
const MDLINK_RE = /(!?)\[[^\]\n]{0,300}\]\(([^)\s]{1,500})(?:\s+"[^"\n]*")?\)/g;
const HEADING_RE = /^ {0,3}(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/;
const FENCE_RE = /^ {0,3}(```|~~~)/;

function parseWikilink(inner: string, embed: boolean): LinkRef | null {
  let s = inner.split('|')[0];
  let block: string | undefined;
  let heading: string | undefined;
  const caret = s.indexOf('#^');
  if (caret >= 0) {
    block = s.slice(caret + 2);
    s = s.slice(0, caret);
  } else {
    const hash = s.indexOf('#');
    if (hash >= 0) {
      heading = s.slice(hash + 1);
      s = s.slice(0, hash);
    }
    const c2 = s.indexOf('^');
    if (c2 >= 0 && !block) { block = s.slice(c2 + 1); s = s.slice(0, c2); }
  }
  const target = cleanString(s);
  if (!target && !heading && !block) return null;
  const ref: LinkRef = { kind: 'wikilink', target };
  if (heading) ref.heading = cleanString(heading);
  if (block) ref.block = cleanString(block);
  if (embed) ref.embed = true;
  return ref;
}

function parseMdLink(href: string, embed: boolean): LinkRef | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//') || href.startsWith('/')) return null;
  if (href.startsWith('#')) return null;
  let s = href;
  let heading: string | undefined;
  const hash = s.indexOf('#');
  if (hash >= 0) { heading = s.slice(hash + 1); s = s.slice(0, hash); }
  s = s.split('?')[0];
  try { s = decodeURI(s); } catch { /* keep raw */ }
  const target = cleanString(s);
  if (!target) return null;
  const ref: LinkRef = { kind: 'markdown', target };
  if (heading) ref.heading = cleanString(heading);
  if (embed) ref.embed = true;
  return ref;
}

/** Parse a markdown document's metadata. Pure; never throws. */
export function parseMarkdown(text: string, relpath: string): ParsedDoc {
  const fm = parseFrontmatter(text, { mode: 'lenient' });
  const data = fm.data ?? {};
  const headings: string[] = [];
  let firstH1: string | undefined;
  let inFence = false;
  const lines = fm.body.split(/\r?\n/);
  for (const line of lines) {
    if (FENCE_RE.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const m = HEADING_RE.exec(line);
    if (!m) continue;
    const h = cleanString(m[2]);
    if (!h) continue;
    if (!firstH1 && m[1].length === 1) firstH1 = h;
    if (headings.length < MAX_HEADINGS) headings.push(h);
  }

  const links: LinkRef[] = [];
  const body = fm.body;
  let m: RegExpExecArray | null;
  WIKILINK_RE.lastIndex = 0;
  while ((m = WIKILINK_RE.exec(body)) && links.length < MAX_LINKS) {
    const l = parseWikilink(m[2], m[1] === '!');
    if (l) links.push(l);
  }
  MDLINK_RE.lastIndex = 0;
  while ((m = MDLINK_RE.exec(body)) && links.length < MAX_LINKS) {
    const l = parseMdLink(m[2], m[1] === '!');
    if (l) links.push(l);
  }

  const fmTitle = typeof data.title === 'string' ? cleanString(data.title) : undefined;
  const title = fmTitle || firstH1 || cleanString(path.posix.basename(relpath).replace(/\.[^.]+$/, ''));
  return {
    title,
    headings,
    links,
    tags: strList(data.tags ?? data.tag, true),
    aliases: relatesList(data.aliases ?? data.alias),
    relates: relatesList(data.relates),
  };
}

/** .txt: title from filename only; no headings/links. */
export function parseText(relpath: string): ParsedDoc {
  return {
    title: cleanString(path.posix.basename(relpath).replace(/\.[^.]+$/, '')),
    headings: [],
    links: [],
    tags: [],
    aliases: [],
    relates: [],
  };
}

export const PARSED_EXTS = new Set(['.md', '.markdown', '.txt']);
