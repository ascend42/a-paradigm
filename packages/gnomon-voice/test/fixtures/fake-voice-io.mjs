// A fake gnomon-voice-io:v1 binary (node script): replies ok to every command (info → disclaimed: true), exits on
// `quit` and — like the Swift binary (Command.swift: "stdin EOF does the same") — exits 0 when stdin ends.
// argv[2] (optional): 'ignore-quit' to prove the stdin EOF path alone ends it.
const ignoreQuit = process.argv[2] === 'ignore-quit';
// 'report-fd3 <file>': write what this process holds on fd 3 (Aegis M1: never the kernel link)
if (process.argv[2] === 'report-fd3') {
  const fs = await import('node:fs');
  let r;
  try {
    const st = fs.fstatSync(3);
    const dn = fs.statSync('/dev/null');
    r = { open: true, socket: st.isSocket(), devNull: st.isCharacterDevice() && st.ino === dn.ino && st.rdev === dn.rdev, ino: st.ino };
  } catch {
    r = { open: false };
  }
  fs.writeFileSync(process.argv[3], JSON.stringify(r));
}
let buf = Buffer.alloc(0);
const send = (o) => {
  const p = Buffer.from(JSON.stringify(o));
  const h = Buffer.alloc(5);
  h.writeUInt8(1, 0);
  h.writeUInt32LE(p.length, 1);
  process.stdout.write(Buffer.concat([h, p]));
};
process.stdin.on('data', (c) => {
  buf = Buffer.concat([buf, c]);
  while (buf.length >= 5) {
    const len = buf.readUInt32LE(1);
    if (buf.length < 5 + len) return;
    const type = buf.readUInt8(0);
    const payload = buf.subarray(5, 5 + len);
    buf = buf.subarray(5 + len);
    if (type !== 1) continue;
    const m = JSON.parse(payload.toString());
    if (m.op === 'quit' && !ignoreQuit) {
      send({ type: 'reply', id: m.id, op: m.op, ok: true });
      process.exit(0);
    }
    send({ type: 'reply', id: m.id, op: m.op, ok: true, ...(m.op === 'info' && process.argv[2] !== 'no-disclaim' ? { disclaimed: true } : {}) });
  }
});
process.stdin.on('end', () => process.exit(0));
