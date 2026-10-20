/**
 * @symbol #gnomon-voice
 *
 * `gnomon-voice run --fd N` (V2e): the kernel-spawned client lifetime. The kernel hands over an already
 * authenticated socketpair fd (GnomonKernelLink.fromFd) and keeps the child's stdin open; the client runs until the
 * FIRST of: stdin ends (the kernel or its pipe went away), the link closes (fd EOF / error), or an abort (signal).
 * While running it polls status for a kernel-decided enrolment (enrol-watch.ts). Then it closes the voice loop (mic.off, quit to gnomon-voice-io) and the link, and returns why.
 */
import type { Readable } from 'node:stream';
import { EnrolWatch } from './enrol-watch.js';
import { nsOf, principalFromStatus } from './kernel-link.js';
import type { AudioIO, KernelLink, VoiceEngines, VoiceLogger } from './types.js';
import { silentLogger } from './types.js';
import type { VoicePrint } from './speaker.js';
import { SPEAKING_POLL_MS, VoiceClient, type ClientMode, type Notice, type Delivery } from './voice-client.js';

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
  /** kernel-decided enrolment (status.voice.enrolment 'requested' → record → request.voice.report); omitted ⇒ off */
  enrol?: { home: string; model: string; pollMs?: number; timeoutMs?: number };
  mode?: ClientMode;
  /** TD-2026-10-20-262: 'composer' (default; the GUI sends) or 'direct' (headless) */
  delivery?: Delivery;
  signal?: AbortSignal;
  log?: VoiceLogger;
  notice?: (n: Notice) => void;
  /** called once the loop is listening */
  started?: (client: VoiceClient) => void;
  /** how often the attachment is re-read from status (default ATTACH_POLL_MS) */
  attachPollMs?: number;
}

/** Attachment re-read cadence: a new attachment is picked up within this (a status call, cheap). */
export const ATTACH_POLL_MS = 1500;

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
  let watch: EnrolWatch | undefined;
  let refresher: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const boot = (async () => {
    const principal = principalFromStatus(await o.link.status());
    if (!principal) throw new Error('the kernel did not say which voice principal this is (status.voice.principal)');
    client = new VoiceClient({ audio: o.audio, engines: o.engines, link: o.link, ns: nsOf(principal), prints: o.prints, mode: o.mode ?? 'ptt', delivery: o.delivery ?? 'composer', ...(o.log ? { log: o.log } : {}), ...(o.notice ? { notice: o.notice } : {}) });
    await client.start();
    const c = client;
    if (o.enrol && o.engines.vad && o.engines.speaker) {
      watch = new EnrolWatch({ link: o.link, audio: o.audio, vad: o.engines.vad, speaker: o.engines.speaker, home: o.enrol.home, model: o.enrol.model, pause: (on) => c.pause(on), ...(o.enrol.pollMs !== undefined ? { pollMs: o.enrol.pollMs } : {}), ...(o.enrol.timeoutMs !== undefined ? { timeoutMs: o.enrol.timeoutMs } : {}), ...(o.log ? { log: o.log } : {}) });
      watch.start();
    }
    // The attachment usually lands AFTER the client starts (Gnomon starts the voice app, then the human's Touch ID
    // attaches it), and nothing tells the client: re-read it on a short cadence so a new or changed attachment is
    // picked up (founder dogfood 2026-10-19: the client saw "not attached" forever and dropped every utterance).
    // T-2026-10-19-026: while a reply is spoken the re-read runs every SPEAKING_POLL_MS, so the GUI's ⏹ (a changed
    // status.voice.stopSpeakingSeq) stops the audio within ~300 ms
    const every = o.attachPollMs ?? ATTACH_POLL_MS;
    const step = Math.min(every, SPEAKING_POLL_MS);
    let last = Date.now();
    const tick = (): void => {
      if (stopped) return;
      refresher = setTimeout(() => {
        // a cheap timer: status is read every `every` ms, or every `step` ms while a reply is spoken
        if (!c.speaking && Date.now() - last < every - step / 2) return tick();
        last = Date.now();
        void c.refresh().catch(() => undefined).finally(tick);
      }, step);
      refresher.unref?.();
    };
    tick();
    o.started?.(client);
  })();
  const cleanup = async (): Promise<void> => {
    stopped = true;
    if (refresher) clearTimeout(refresher);
    await watch?.stop();
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
