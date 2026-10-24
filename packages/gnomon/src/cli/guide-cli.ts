/**
 * @symbol #gnomon-guide
 *
 * `gnomon guide [<topic>]` (spec §5 "gnomon guide" paragraph, §9.7;
 * TD-2026-10-19-648 item 10; T-2026-10-19-015). A CLI-only verb: not a socket
 * method and not one of the twelve verbs, so abiId and clientApiId do not
 * move (§3.1 I3). It prints a compiled-in topic (guide-topics.ts) stamped with
 * the abiId and clientApiId this binary was built with, so a reader can tell
 * which frozen surface the text describes. Pull-only: it never connects to a
 * kernel, reads no file, and grants or decides nothing; `status` stays the
 * man page (F4).
 *
 * No topic lists the topics (exit 0). An unknown topic is refused in the
 * readout voice, BAD_REQUEST usage, exit 64, without echoing the argument
 * (like gnomon.ts's unknown-command line).
 */
import { CLIENT_API_ID } from '@a-company/gnomon-contracts';
import { ABI_ID } from '../kernel/socket/dispatch.js';
import { GNOMON_VERSION } from '../version.js';
import { GUIDE_TOPICS, type GuideTopic } from './guide-topics.js';
import { heading, readout, refused, type Out } from './readout.js';

export const GUIDE_EXIT_OK = 0;
export const GUIDE_EXIT_USAGE = 64;

export const GUIDE_USAGE = `usage: gnomon guide [<topic>]

  Prints how-to text compiled into this binary, stamped with the abiId and
  clientApiId it describes. Pull-only: it reads no file and talks to no kernel.
  With no topic it lists the topics.
`;

/** The stamp every rendered topic carries. */
export function guideStamp(): ReadonlyArray<readonly [string, string]> {
  return [
    ['gnomon', GNOMON_VERSION],
    ['abiId', ABI_ID],
    ['clientApiId', CLIENT_API_ID],
  ];
}

/** Render one topic: heading, stamp, blank line, body. */
export function renderGuide(out: Out, t: GuideTopic): void {
  heading(out, 'guide', `${t.id} · ${t.summary}`);
  readout(out, guideStamp());
  out.write(`\n${t.body}`);
}

function listTopics(out: Out): void {
  heading(out, 'guide', `${GUIDE_TOPICS.length} topic(s) compiled into gnomon ${GNOMON_VERSION}`);
  readout(out, GUIDE_TOPICS.map((t) => [t.id, t.summary] as const));
  out.write('  run: gnomon guide <topic>\n');
}

export function runGuideCommand(argv: readonly string[], io: { stdout: Out; stderr: Out }, topics: readonly GuideTopic[] = GUIDE_TOPICS): number {
  const [topic, ...rest] = argv;
  if (topic === '--help' || topic === '-h') {
    io.stdout.write(`gnomon ${GNOMON_VERSION}\n${GUIDE_USAGE}`);
    return GUIDE_EXIT_OK;
  }
  if (topic === undefined) {
    listTopics(io.stdout);
    return GUIDE_EXIT_OK;
  }
  if (rest.length) {
    refused(io.stderr, 'BAD_REQUEST', 'usage', `gnomon guide takes one topic (got ${argv.length} arguments)`, ['gnomon guide']);
    return GUIDE_EXIT_USAGE;
  }
  const t = topics.find((x) => x.id === topic);
  if (!t) {
    refused(io.stderr, 'BAD_REQUEST', 'usage', `unknown topic (${topic.length} chars); topics: ${topics.map((x) => x.id).join(', ')}`, ['gnomon guide']);
    return GUIDE_EXIT_USAGE;
  }
  renderGuide(io.stdout, t);
  return GUIDE_EXIT_OK;
}
