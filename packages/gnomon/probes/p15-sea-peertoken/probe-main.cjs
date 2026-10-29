// The probe SEA's main (and the negative control, run by plain node): spawn the KernelProbe tool as a stdio child
// over libuv pipes, exactly as the kernel spawns the helper (stdio 'pipe'), and print its one JSON line.
//   <sea|node probe-main.cjs> <kernel-probe> <requirement>
const { spawn } = require('node:child_process');
const argv = process.argv.slice(2);
const at = argv.length >= 2 ? argv.length - 2 : 0;
const [tool, requirement] = argv.slice(at);
const c = spawn(tool, ['peer-check', requirement], { stdio: ['pipe', 'pipe', 'inherit'] });
let out = '';
c.stdout.setEncoding('utf8').on('data', (s) => (out += s));
c.on('exit', (code) => {
  process.stdout.write(out.trim() ? `${out.trim().split('\n').pop()}\n` : `${JSON.stringify({ ok: false, error: `peer-check exited ${code} with no output` })}\n`);
  process.exitCode = code ?? 1;
});
