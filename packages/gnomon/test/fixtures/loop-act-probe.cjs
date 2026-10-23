// The loop-act escape probe (test/loop-act-sandbox.test.ts): runs INSIDE the generated profile and prints one
// `name=result` line per attempt. result is `ok`, `denied:<code>` or `data:<text>`.
'use strict';
const fs = require('node:fs');
const net = require('node:net');
const dns = require('node:dns');
const cp = require('node:child_process');
const path = require('node:path');
const cfg = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const out = [];
const rec = (name, r) => out.push(`${name}=${r}`);
const tryIt = (name, f) => {
  try {
    const v = f();
    rec(name, v === undefined ? 'ok' : `ok:${String(v).slice(0, 80)}`);
  } catch (e) {
    rec(name, `denied:${e.code || e.message.slice(0, 80)}`);
  }
};
const connect = (name, opts) => new Promise((res) => {
  const s = net.connect(opts);
  const t = setTimeout(() => { s.destroy(); rec(name, 'denied:TIMEOUT'); res(); }, 1500);
  s.once('connect', () => { clearTimeout(t); s.destroy(); rec(name, 'ok'); res(); });
  s.once('error', (e) => { clearTimeout(t); rec(name, `denied:${e.code}`); res(); });
});
(async () => {
  const T = cfg.tree;
  // 1 writes through scratch symlinks
  tryIt('w-link-zshrc', () => fs.writeFileSync(path.join(T, 'l-zshrc'), 'x'));
  tryIt('w-link-repofile', () => fs.writeFileSync(path.join(T, 'l-repofile'), 'x'));
  tryIt('w-link-park', () => fs.writeFileSync(path.join(T, 'l-park', 'planted'), 'x'));
  // 2 hard links of outside files into the scratch and tmp
  tryIt('hl-zshrc-tree', () => fs.linkSync(cfg.zshrc, path.join(T, 'hl1')));
  tryIt('hl-repo-tmp', () => fs.linkSync(cfg.repoFile, path.join(cfg.tmp, 'hl2')));
  tryIt('hl-keys-tree', () => fs.linkSync(cfg.keyFile, path.join(T, 'hl3')));
  // 3 renames into or out of the scratch, the tree itself, runDir siblings
  tryIt('mv-out', () => fs.renameSync(path.join(T, 'src', 'a.ts'), path.join(cfg.runDir, 'out.ts')));
  tryIt('mv-in', () => fs.renameSync(cfg.zshrc, path.join(T, 'z')));
  tryIt('mv-tree', () => fs.renameSync(T, path.join(cfg.runDir, 'tree2')));
  tryIt('mk-sibling', () => fs.mkdirSync(path.join(cfg.runDir, 'sib')));
  // 4 node_modules writes
  tryIt('w-tree-nm', () => fs.writeFileSync(path.join(T, 'node_modules', 'dep', 'x.js'), 'x'));
  tryIt('w-repo-nm', () => fs.writeFileSync(path.join(cfg.repo, 'node_modules', 'dep', 'y.js'), 'x'));
  // 5 reads
  for (const [n, p] of Object.entries(cfg.reads)) tryIt(`r-${n}`, () => fs.readFileSync(p, 'utf8').length);
  tryIt('w-scratch', () => fs.writeFileSync(path.join(T, 'src', 'new.ts'), 'export {};\n'));
  tryIt('w-tmp', () => fs.writeFileSync(path.join(cfg.tmp, 'scratchpad'), 'x'));
  // 6 network
  await connect('net-endpoint', { host: '127.0.0.1', port: cfg.endpointPort });
  await connect('net-other-loopback', { host: '127.0.0.1', port: cfg.otherPort });
  await connect('net-kernel-port', { host: '127.0.0.1', port: cfg.kernelPort });
  await connect('net-endpoint-port-nonloopback', { host: cfg.lanIp, port: cfg.endpointPort });
  await connect('net-external', { host: '1.1.1.1', port: 443 });
  await connect('net-endpoint-port-external', { host: '1.1.1.1', port: cfg.endpointPort });
  await connect('net-kernel-socket', { path: cfg.kernelSock });
  await connect('net-mdns-socket', { path: '/var/run/mDNSResponder' });
  await new Promise((res) => dns.lookup('example.com', (e, a) => { rec('net-dns', e ? `denied:${e.code}` : `ok:${a}`); res(); }));
  // 7 exec
  tryIt('x-sh', () => cp.execFileSync('/bin/sh', ['-c', 'echo hi'], { encoding: 'utf8' }));
  tryIt('x-env', () => cp.execFileSync('/usr/bin/env', [], { encoding: 'utf8' }).length);
  tryIt('x-shebang', () => { fs.writeFileSync(path.join(cfg.tmp, 's.sh'), '#!/bin/sh\necho hi\n', { mode: 0o755 }); return cp.execFileSync(path.join(cfg.tmp, 's.sh'), { encoding: 'utf8' }); });
  tryIt('x-node-copy', () => { fs.copyFileSync(process.execPath, path.join(cfg.tmp, 'n')); fs.chmodSync(path.join(cfg.tmp, 'n'), 0o755); return cp.execFileSync(path.join(cfg.tmp, 'n'), ['-e', '1'], { encoding: 'utf8' }); });
  tryIt('x-node', () => cp.execFileSync(process.execPath, ['-e', `require('fs').writeFileSync(${JSON.stringify(cfg.zshrc)}, 'child')`], { encoding: 'utf8' }));
  tryIt('x-detached', () => { const c = cp.spawn(process.execPath, ['-e', 'setTimeout(()=>{},60000)'], { detached: true, stdio: 'ignore' }); c.unref(); return c.pid ?? 'no-pid'; });
  // 9 signals
  tryIt('sig-stop-daemon', () => process.kill(cfg.daemonPid, 'SIGSTOP'));
  tryIt('sig-stop-other', () => process.kill(cfg.otherPid, 'SIGSTOP'));
  // 10 dlopen of a dylib written to tmp and the scratch
  if (cfg.dylib) {
    for (const [n, dir] of [['tmp', cfg.tmp], ['scratch', T]]) {
      try {
        const dst = path.join(dir, `x-${n}.dylib`);
        fs.copyFileSync(cfg.dylib, dst);
        process.dlopen({ exports: {} }, dst);
        rec(`dl-${n}`, 'ok');
      } catch (e) {
        rec(`dl-${n}`, /self-register|did not/i.test(e.message) ? 'ok:loaded' : `denied:${e.message.replace(/\s+/g, ' ').slice(0, 60)}`);
      }
    }
  }
  // last (it empties the scratch): deleting the tree itself
  tryIt('rm-tree', () => fs.rmSync(T, { recursive: true }));
  rec('tree-still-there', fs.existsSync(T) ? 'denied:still-there' : 'ok:gone');
  process.stdout.write(`${out.join('\n')}\n`);
})();
