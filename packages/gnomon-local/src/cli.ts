#!/usr/bin/env node
/**
 * @symbol #gnomon-local
 *
 * `gnomon-local --mode rpc --config <local.yaml> --session <hsid>` (spec
 * §3.3). Strict argv: any other mode or flag is fatal (exit 2). stdout is the
 * protocol (JSONL only — nothing else is ever written there); a fatal error
 * is one `{type:'fatal'}` line and a non-zero exit. stdin EOF ends the child
 * once the agent is idle.
 */
import { readFileSync } from 'node:fs';
import { ConfigError, parseSessionConfig, rpcSession } from './rpc.js';

const emit = (ev: Record<string, unknown>): void => {
  process.stdout.write(`${JSON.stringify(ev)}\n`);
};

class Fatal extends Error {
  constructor(readonly error: string, readonly code: number) {
    super(error);
  }
}

/** never process.exit after a write: the fatal line must drain, then the exit code stands */
function fatal(error: string, code: number): never {
  throw new Fatal(error, code);
}

function main(argv: string[]): void {
  const args = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i]!;
    const v = argv[i + 1];
    if (!['--mode', '--config', '--session'].includes(k) || v === undefined || args.has(k)) fatal(`bad argv near ${k.slice(0, 32)} (gnomon-local --mode rpc --config <local.yaml> --session <hsid>)`, 2);
    args.set(k, v);
  }
  if (args.get('--mode') !== 'rpc') fatal('only --mode rpc is served', 2);
  const cfgPath = args.get('--config');
  if (!cfgPath) fatal('--config is required', 2);
  let cfg;
  try {
    cfg = parseSessionConfig(readFileSync(cfgPath, 'utf8'));
  } catch (err) {
    fatal(err instanceof ConfigError ? err.message : `cannot read config: ${(err as Error).message.slice(0, 200)}`, 3);
  }
  if (args.has('--session') && args.get('--session') !== cfg.session) fatal('--session does not match the config', 2);
  const { onLine, agent } = rpcSession(cfg, emit);
  let buf = '';
  let ended = false;
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (d: string) => {
    buf += d;
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) onLine(line);
    }
  });
  process.stdin.on('end', () => {
    ended = true;
  });
  const t = setInterval(() => {
    if (ended && !agent.running) {
      clearInterval(t);
      process.exitCode = 0;
      process.stdin.destroy();
    }
  }, 50);
}

try {
  main(process.argv.slice(2));
} catch (err) {
  emit({ type: 'fatal', error: err instanceof Fatal ? err.error : (err as Error).message.slice(0, 200) });
  process.exitCode = err instanceof Fatal ? err.code : 1;
}
