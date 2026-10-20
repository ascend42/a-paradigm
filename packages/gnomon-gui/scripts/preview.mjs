#!/usr/bin/env node
// #gui-preview (DEV ONLY): the GUI fixture preview. Serves the REAL static/index.html, boot.js and styles.css with an
// app.js bundled from src/preview/main.ts (the real ui/app.ts + core over a fake kernel transport). Never part of the
// kernel-served bundle: build.mjs bundles src/main.ts only, and test/preview.test.ts proves src/preview stays out.
//
//   node packages/gnomon-gui/scripts/preview.mjs [--port 8790]   serve on 127.0.0.1 (the list of fixtures at /)
//   node packages/gnomon-gui/scripts/preview.mjs --fixture-list  print every fixture × theme URL and exit
//
// Fixture URL: /?fixture=<name>&theme=day|night&motion=on|off[&surface=browser]. app.js is rebuilt on every request,
// so an edit to the GUI shows on reload.
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const THEMES = ['day', 'night'];
const HOST = '127.0.0.1';

const opts = (entry, platform) => ({ entryPoints: [path.join(ROOT, 'src', 'preview', entry)], bundle: true, format: platform === 'browser' ? 'iife' : 'esm', platform, target: 'es2022', charset: 'utf8', write: false, logLevel: 'silent', legalComments: 'none' });

/** The preview app.js (never written to dist/bundle). */
export async function bundlePreview() {
  const r = await build(opts('main.ts', 'browser'));
  return `'use strict';\n${r.outputFiles[0].text}`;
}

/** [{name, title}] of every fixture, read from src/preview/fixtures.ts. */
export async function fixtureList() {
  const r = await build(opts('fixtures.ts', 'neutral'));
  const m = await import(`data:text/javascript;base64,${Buffer.from(r.outputFiles[0].text).toString('base64')}`);
  return m.FIXTURE_NAMES.map((name) => ({ name, title: m.FIXTURES[name].title }));
}

export const fixtureUrl = (base, name, theme, motion = 'on') => `${base}/?fixture=${encodeURIComponent(name)}&theme=${theme}&motion=${motion}`;

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function listPage(list) {
  const rows = list.map((f) => `<tr><th>${esc(f.name)}</th><td>${esc(f.title)}</td>${THEMES.map((t) => `<td><a href="${esc(fixtureUrl('', f.name, t))}">${t}</a> · <a href="${esc(fixtureUrl('', f.name, t, 'off'))}">${t}, still</a></td>`).join('')}</tr>`).join('\n');
  return `<!doctype html><meta charset="utf-8"><title>Gnomon GUI fixtures</title>
<style>body{font:13px ui-monospace,monospace;margin:32px;background:#EDE8DC;color:#16150F}td,th{padding:4px 12px;text-align:left}a{color:#44577C}</style>
<h1>Gnomon GUI fixture preview</h1><p>Dev only: the real GUI over a fake kernel (no kernel, sessions or Touch ID).</p>
<table>${rows}</table>`;
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8' };
// S1 materials: the bundled fonts and grain, served raw (the same bytes build.mjs pins); plain names only, no `..`
const STATIC_ASSET = /^\/(grain\.svg|fonts\/[A-Za-z0-9._-]+\.(woff2|txt))$/;

/** Start the server; resolves {url, close}. port 0 picks a free port. */
export async function startPreview({ port = 8790 } = {}) {
  const list = await fixtureList();
  const server = http.createServer(async (req, res) => {
    const send = (code, type, body) => {
      res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
      res.end(body);
    };
    const host = String(req.headers.host ?? '');
    if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host)) return send(421, 'text/plain', 'loopback only'); // DNS-rebinding guard
    const u = new URL(req.url ?? '/', `http://${host}`);
    try {
      if (req.method === 'POST' && u.pathname === '/diag') return send(204, 'text/plain', '');
      if (req.method !== 'GET') return send(405, 'text/plain', 'GET only');
      if (u.pathname === '/' || u.pathname === '/index.html') {
        if (!u.searchParams.has('fixture')) return send(200, TYPES['.html'], listPage(list));
        return send(200, TYPES['.html'], readFileSync(path.join(ROOT, 'static', 'index.html')));
      }
      if (u.pathname === '/boot.js' || u.pathname === '/styles.css') return send(200, TYPES[path.extname(u.pathname)], readFileSync(path.join(ROOT, 'static', u.pathname.slice(1))));
      if (STATIC_ASSET.test(u.pathname) && !u.pathname.includes('..')) return send(200, TYPES[path.extname(u.pathname)], readFileSync(path.join(ROOT, 'static', ...u.pathname.slice(1).split('/'))));
      if (u.pathname === '/app.js') {
        try {
          return send(200, TYPES['.js'], await bundlePreview());
        } catch (err) {
          return send(200, TYPES['.js'], `document.body.textContent=${JSON.stringify(`preview build failed: ${err instanceof Error ? err.message : String(err)}`)};`);
        }
      }
      return send(404, 'text/plain', 'not found');
    } catch (err) {
      return send(500, 'text/plain', String(err));
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, HOST, resolve);
  });
  const url = `http://${HOST}:${server.address().port}`;
  return { url, list, close: () => new Promise((r) => server.close(r)) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const i = args.indexOf('--port');
  const port = i >= 0 ? Number(args[i + 1]) : 8790;
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    process.stderr.write('✕ --port takes a number from 0 to 65535\n');
    process.exit(2);
  }
  if (args.includes('--fixture-list')) {
    const base = `http://${HOST}:${port}`;
    for (const f of await fixtureList()) for (const t of THEMES) process.stdout.write(`${fixtureUrl(base, f.name, t)}\n`);
    process.exit(0);
  }
  const p = await startPreview({ port });
  process.stdout.write(`✓ Gnomon GUI preview (dev only) · ${p.url}/\n`);
  for (const f of p.list) process.stdout.write(`  ${f.name.padEnd(14)} ${f.title}\n`);
  process.stdout.write('  Ctrl-C stops it.\n');
}
