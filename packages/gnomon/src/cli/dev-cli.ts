/**
 * @symbol #dev-launch
 *
 * `gnomon dev init|up` (#dev-launch, spec §2.4 rule 6): the UNSIGNED,
 * DEV-ONLY dogfood path until #identity M1.3. See dev-home.ts for the home and
 * its guards. Every command prints a DEV ONLY banner. Writes plain text to the
 * streams it is given (zero deps, G-SEC-01; readout.ts voice). Never prints a
 * key; a launch token is printed only to an interactive terminal.
 */
import * as path from 'node:path';
import { GNOMON_VERSION } from '../version.js';
import { readout, refused } from './readout.js';
import { DevHomeRefusal, defaultDevHome, provisionDevHome, type DevHomeOptions } from './dev-home.js';

type Out = { write(s: string): unknown; isTTY?: boolean };
export interface DevCliIo {
  stdin: NodeJS.ReadableStream & { isTTY?: boolean; setRawMode?: unknown };
  stdout: Out;
  stderr: Out;
}

export const DEV_EXIT_OK = 0;
export const DEV_EXIT_REFUSED = 1;
export const DEV_EXIT_USAGE = 64;

export const DEV_BANNER =
  'DEV ONLY  unsigned dogfood path (#dev-launch): a SOFTWARE dev-test root, never production.\n' +
  '          Approvals are refused UNSUPPORTED until M1.3 (hardware root, signed helper).\n';

export const DEV_USAGE = `gnomon ${GNOMON_VERSION} dev — DEV ONLY, unsigned, until M1.3
usage: gnomon dev init [--home <abs>]   provision a dev home (default ~/${'.gnomon-dev'})
       gnomon dev up   [--home <abs>]   run the kernel on it and print a GUI launch URL
  Never ~/.gnomon. A home holding another root's registry is refused.
`;

export interface DevCliOptions extends DevHomeOptions {
  host?: string;
}

function parseHome(rest: readonly string[], opts: DevCliOptions): { home: string } | string {
  let home: string | undefined;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (a === '--home') {
      const v = rest[++i];
      if (!v || !path.isAbsolute(v)) return '--home needs an absolute path';
      home = path.resolve(v);
    } else return `unknown argument ${a}`;
  }
  return { home: home ?? defaultDevHome(opts.userHome) };
}

export function reportRefusal(io: DevCliIo, e: DevHomeRefusal): number {
  refused(io.stderr, 'dev', e.reason, e.message, e.next);
  return DEV_EXIT_REFUSED;
}

export async function runDevInit(argv: readonly string[], io: DevCliIo, opts: DevCliOptions = {}): Promise<number> {
  const parsed = parseHome(argv, opts);
  if (typeof parsed === 'string') {
    io.stderr.write(`gnomon dev: ${parsed}\n${DEV_USAGE}`);
    return DEV_EXIT_USAGE;
  }
  io.stdout.write(DEV_BANNER);
  try {
    const { created, loaded } = provisionDevHome(parsed.home, { ...opts, ...(opts.host ? { host: opts.host } : {}) });
    io.stdout.write(created ? 'INITIALIZED  dev home\n' : 'ALREADY INITIALIZED  dev home (verified)\n');
    readout(io.stdout, [
      ['home', loaded.home],
      ['root', `dev-test ${loaded.root.rootKeyId}`],
      ['kernel key', loaded.kernel.keyId],
      ['device', loaded.device.deviceId],
      ['principal', `${loaded.device.principalId} (human)`],
      ['next', `gnomon dev up${parsed.home === defaultDevHome(opts.userHome) ? '' : ` --home ${parsed.home}`}`],
    ]);
    return DEV_EXIT_OK;
  } catch (e) {
    if (e instanceof DevHomeRefusal) return reportRefusal(io, e);
    throw e;
  }
}

export async function runDevCommand(argv: readonly string[], io: DevCliIo, opts: DevCliOptions = {}): Promise<number> {
  const [sub, ...rest] = argv;
  if (sub === 'init') return runDevInit(rest, io, opts);
  io.stdout.write(DEV_USAGE);
  return sub === '--help' || sub === '-h' ? DEV_EXIT_OK : DEV_EXIT_USAGE;
}
