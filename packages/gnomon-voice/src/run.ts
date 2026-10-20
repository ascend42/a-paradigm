/**
 * @symbol #gnomon-voice
 *
 * `gnomon-voice run --fd N` (V2e): the kernel-spawned client lifetime. The kernel hands over an already
 * authenticated socketpair fd (GnomonKernelLink.fromFd) and keeps the child's stdin open; the client runs until the
 * FIRST of: stdin ends (the kernel or its pipe went away), the link closes (fd EOF / error), or an abort (signal).
 * Then it closes the voice loop (mic.off, quit to gnomon-voice-io) and the link, and returns why.
 */
import type { Readable } from 'node:stream';
import { nsOf, principalFromStatus } from './kernel-link.js';
import type { AudioIO, KernelLink, VoiceEngines, VoiceLogger } from './types.js';
import { silentLogger } from './types.js';
import type { VoicePrint } from './speaker.js';
import { VoiceClient, type ClientMode, type Notice } from './voice-client.js';

export interface RunLink extends KernelLink {
  status(): Promise<unknown>;
  onClose(cb: (reason: string) => void): void;
}

export interface RunOptions {
  link: RunLink;
  audio: AudioIO;
  engines: VoiceEngines;
  prints: () => readonly VoicePrint[];
  /** the kernel's stdin pipe: its end means the kernel is gone */
  stdin: Readable;
  /** `p:<ns>/voice` when status does not report it (`--principal`) */
  principal?: string;
  mode?: ClientMode;
  signal?: AbortSignal;
  log?: VoiceLogger;
  notice?: (n: Notice) => void;
  /** called once the loop is listening */
  started?: (client: VoiceClient) => void;
}

export type RunEnd = 'stdin-end' | 'link-closed' | 'aborted';

export async function runVoice(o: RunOptions): Promise<{ reason: RunEnd; detail?: string }> {
  const log = (o.log ?? silentLogger).component('#gnomon-voice');
  let finish!: (r: { reason: RunEnd; detail?: string }) => void;
  const ended = new Promise<{ reason: RunEnd; detail?: string }>((res) => (finish = res));
  // the exit triggers are armed BEFORE anything is awaited, so an early EOF is never missed
  o.stdin.once('end', () => finish({ reason: 'stdin-end' }));
  o.stdin.once('close', () => finish({ reason: 'stdin-end' }));
  o.stdin.resume(); // flowing, so 'end' fires; the kernel sends nothing on stdin
  o.link.onClose((detail) => finish({ reason: 'link-closed', detail }));
  if (o.signal) {
    if (o.signal.aborted) finish({ reason: 'aborted' });
    else o.signal.addEventListener('abort', () => finish({ reason: 'aborted' }), { once: true });
  }
  let client: VoiceClient | undefined;
  const boot = (async () => {
    const principal = principalFromStatus(await o.link.status()) ?? o.principal;
    if (!principal) throw new Error('the kernel did not say which voice principal this is (status.principal) and no --principal was given');
    client = new VoiceClient({ audio: o.audio, engines: o.engines, link: o.link, ns: nsOf(principal), prints: o.prints, mode: o.mode ?? 'ptt', ...(o.log ? { log: o.log } : {}), ...(o.notice ? { notice: o.notice } : {}) });
    await client.start();
    o.started?.(client);
  })();
  const cleanup = async (): Promise<void> => {
    if (client) await client.close().catch(() => undefined);
    else await o.audio.close().catch(() => undefined);
    await o.link.close().catch(() => undefined);
  };
  let first: { reason: RunEnd; detail?: string };
  try {
    first = await Promise.race([ended, boot.then(() => ended)]);
  } catch (err) {
    await cleanup();
    throw err;
  }
  log.info('voice run ending', { reason: first.reason, ...(first.detail ? { detail: first.detail } : {}) });
  await boot.catch(() => undefined);
  await cleanup();
  return first;
}
