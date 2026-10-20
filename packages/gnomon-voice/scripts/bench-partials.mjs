#!/usr/bin/env node
/**
 * @symbol #gnomon-voice
 *
 * B0 benchmark for voice phase B (live words while speaking; T-2026-10-20-005, ruling V5 in TD-2026-10-20-086).
 * Question: can Parakeet TDT 0.6B v2 int8 (sherpa-onnx OfflineRecognizer, built exactly as engines/sherpa.ts does)
 * re-decode a TAIL WINDOW of a growing speech segment fast enough for live partials?
 * Gate: p95 decode of a 6 s window at 2 threads <= 250 ms.
 *
 * Read-only against the model home: paths come from manifest.verifiedModelPaths (re-hashes, never writes).
 * Test audio is synthesised in memory with the manifest's Kokoro model, plus the Parakeet archive's own test_wavs/0.wav
 * (real human speech, a pinned archive member). Nothing is written to disk.
 *
 * Usage (after `npm run build` in packages/gnomon-voice):
 *   node packages/gnomon-voice/scripts/bench-partials.mjs [--home ~/.gnomon] [--runs 30] [--json]
 */
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';

const SR = 16_000;

function out(line = '') {
  process.stdout.write(`${line}\n`);
}

/** The recognizer config of engines/sherpa.ts SherpaStt, with numThreads as the only variable. */
function recognizerConfig(p, numThreads) {
  return {
    featConfig: { sampleRate: SR, featureDim: 80 },
    modelConfig: { transducer: { encoder: p.encoder, decoder: p.decoder, joiner: p.joiner }, tokens: p.tokens, numThreads, provider: 'cpu', debug: 0, modelType: 'nemo_transducer' },
  };
}

function decodeSync(rec, samples) {
  const s = rec.createStream();
  s.acceptWaveform({ sampleRate: SR, samples });
  rec.decode(s);
  return String(rec.getResult(s).text ?? '');
}

async function decodeAsync(rec, samples) {
  const s = rec.createStream();
  s.acceptWaveform({ sampleRate: SR, samples });
  const r = await rec.decodeAsync(s);
  return String(r.text ?? '');
}

// ---------------------------------------------------------------- helpers
function pct(xs, p) {
  const s = [...xs].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1));
  return s[i];
}
function stats(xs) {
  return { n: xs.length, p50: pct(xs, 50), p95: pct(xs, 95), max: Math.max(...xs), mean: xs.reduce((a, b) => a + b, 0) / xs.length };
}
const f1 = (x) => x.toFixed(1);
const f3 = (x) => x.toFixed(3);

function words(text, normalise) {
  const t = normalise ? text.toLowerCase().replace(/[^a-z0-9' ]+/g, ' ') : text;
  return t.split(/\s+/).filter(Boolean);
}
function lcp(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

/**
 * Words of `prev` (already on screen) that the next hypothesis retracts. When the tail window's start moved by
 * `slidS` seconds, the head of `prev` may have slid out (at most ceil(slidS * 4 words/s) + 1 words, generous for
 * English) and the first word of `next` may be cut at the window edge; the slid-out words are NOT retractions (B1
 * would have committed them), so take the allowed alignment that retracts least. With no slide this is plain LCP.
 */
function retracted(prev, next, slidS) {
  if (slidS <= 0) return prev.length - lcp(prev, next);
  const kMax = Math.min(prev.length - 1, Math.ceil(slidS * 4) + 1);
  let best = prev.length;
  for (let k = 0; k <= kMax; k++) {
    for (const j of [0, 1]) best = Math.min(best, prev.length - k - lcp(prev.slice(k), next.slice(j)));
  }
  return best;
}

/** Event-loop block while `fn` runs: the largest gap between 1 ms interval ticks. */
async function loopBlock(fn) {
  let last = performance.now();
  let maxGap = 0;
  const iv = setInterval(() => {
    const now = performance.now();
    maxGap = Math.max(maxGap, now - last);
    last = now;
  }, 1);
  await new Promise((r) => setTimeout(r, 5));
  last = performance.now();
  const t = performance.now();
  await fn();
  const ms = performance.now() - t;
  await new Promise((r) => setTimeout(r, 3));
  clearInterval(iv);
  return { ms, maxGap };
}

// ---------------------------------------------------------------- main
async function main() {
  const args = process.argv.slice(2);
  const arg = (k, d) => {
    const i = args.indexOf(k);
    return i >= 0 ? args[i + 1] : d;
  };
  const home = arg('--home', process.env.GNOMON_HOME && path.isAbsolute(process.env.GNOMON_HOME) ? process.env.GNOMON_HOME : path.join(os.homedir(), '.gnomon'));
  const RUNS = Number(arg('--runs', '30'));
  const asJson = args.includes('--json');

  const here = path.dirname(fileURLToPath(import.meta.url));
  const voice = await import(path.join(here, '..', 'dist', 'index.js'));
  const m = voice.loadManifest();
  const t0 = performance.now();
  const stt = voice.verifiedModelPaths(home, voice.modelFor(m, 'stt'));
  const tts = voice.verifiedModelPaths(home, voice.modelFor(m, 'tts'));
  out(`models verified against the manifest in ${f1(performance.now() - t0)} ms (home ${home})`);
  const sherpa = await voice.loadSherpa();
  out(`sherpa-onnx-node ${sherpa.version ?? '(version n/a)'}; ${os.cpus()[0]?.model} x${os.cpus().length}; node ${process.version}; load average ${os.loadavg().map((x) => x.toFixed(2)).join(' ')}`);

  // ---- test audio 1: ~14 s of Kokoro speech, sentences joined by 150 ms gaps (below the VAD's 0.5 s split)
  const kokoro = new voice.SherpaTts(sherpa, tts, { sid: 0 });
  const sentences = [
    'Gnomon is listening to this sentence while you are still speaking it.',
    'The quick brown fox jumps over the lazy dog near the river bank.',
    'Please open the project settings and change the default branch to main.',
    'Then run the tests again and tell me which ones are still failing.',
  ];
  const resampler = new sherpa.LinearResampler(24_000, SR);
  const chunks = [];
  for (const s of sentences) {
    const a = await kokoro.synthesize(s);
    if (a.sampleRate !== 24_000) throw new Error(`unexpected Kokoro rate ${a.sampleRate}`);
    chunks.push(resampler.resample(a.samples), new Float32Array(Math.round(0.15 * SR)));
  }
  const synth = concat(chunks);
  out(`Kokoro test audio: ${f1(synth.length / SR)} s at 16 kHz`);

  // ---- test audio 2: the Parakeet archive's own human-speech sample
  const wav = sherpa.readWave(path.join(path.dirname(stt.tokens), 'test_wavs', '0.wav'));
  const human = wav.sampleRate === SR ? wav.samples : new sherpa.LinearResampler(wav.sampleRate, SR).resample(wav.samples);
  out(`human test audio (test_wavs/0.wav): ${f1(human.length / SR)} s`);

  const result = { gateMs: 250, windows: {}, async: {}, worker: {}, stability: {} };

  for (const threads of [2, 4]) {
    const tl = performance.now();
    const rec = new sherpa.OfflineRecognizer(recognizerConfig(stt, threads));
    out(`\n== ${threads} threads (recognizer load ${f1(performance.now() - tl)} ms)`);
    for (let i = 0; i < 3; i++) decodeSync(rec, synth.subarray(0, 6 * SR)); // warm-up
    if (threads === 2) {
      out(`  full Kokoro transcript: ${decodeSync(rec, synth)}`);
      out(`  full human transcript:  ${decodeSync(rec, human)}`);
    }
    for (const w of [4, 6, 8]) {
      const len = w * SR;
      const ms = [];
      for (let i = 0; i < RUNS; i++) {
        const end = len + Math.round((i / Math.max(1, RUNS - 1)) * (synth.length - len)); // the window slides across the audio
        const win = synth.subarray(end - len, end);
        const t = performance.now();
        decodeSync(rec, win);
        ms.push(performance.now() - t);
      }
      const st = stats(ms);
      const rtf = st.p50 / (w * 1000);
      result.windows[`${threads}t-${w}s`] = { ...st, rtfP50: rtf, rtfP95: st.p95 / (w * 1000) };
      out(`  ${w} s window x${RUNS}: p50 ${f1(st.p50)} ms  p95 ${f1(st.p95)} ms  max ${f1(st.max)} ms  RTF(p50) ${f3(rtf)}  RTF(p95) ${f3(st.p95 / (w * 1000))}`);
    }

    if (threads === 2) {
      // ---- sync vs decodeAsync: latency and event-loop block, 6 s window
      const win = synth.subarray(synth.length - 6 * SR);
      const sync = [];
      const asy = [];
      for (let i = 0; i < 10; i++) sync.push(await loopBlock(async () => decodeSync(rec, win)));
      for (let i = 0; i < 10; i++) asy.push(await loopBlock(() => decodeAsync(rec, win)));
      const textSync = decodeSync(rec, win);
      const textAsync = await decodeAsync(rec, win);
      result.async = {
        decodeAsyncPresent: typeof rec.decodeAsync === 'function',
        sync: { p50Ms: pct(sync.map((x) => x.ms), 50), p50LoopBlockMs: pct(sync.map((x) => x.maxGap), 50), maxLoopBlockMs: Math.max(...sync.map((x) => x.maxGap)) },
        async: { p50Ms: pct(asy.map((x) => x.ms), 50), p50LoopBlockMs: pct(asy.map((x) => x.maxGap), 50), maxLoopBlockMs: Math.max(...asy.map((x) => x.maxGap)) },
        sameText: textSync === textAsync,
      };
      out(`  decodeAsync present: ${result.async.decodeAsyncPresent}; same text as sync: ${result.async.sameText}`);
      out(`  sync  decode: p50 ${f1(result.async.sync.p50Ms)} ms, event-loop block p50 ${f1(result.async.sync.p50LoopBlockMs)} ms (max ${f1(result.async.sync.maxLoopBlockMs)})`);
      out(`  async decode: p50 ${f1(result.async.async.p50Ms)} ms, event-loop block p50 ${f1(result.async.async.p50LoopBlockMs)} ms (max ${f1(result.async.async.maxLoopBlockMs)})`);

      // ---- agreed-prefix stability: decodes 600 ms apart over a growing segment
      for (const [name, audio] of [['kokoro', synth], ['human', human]]) {
        for (const mode of ['full', 'tail6']) {
          const hyps = [];
          const starts = [];
          for (let t = 0.6; t <= audio.length / SR + 1e-9; t += 0.6) {
            const end = Math.min(audio.length, Math.round(t * SR));
            const start = mode === 'full' ? 0 : Math.max(0, end - 6 * SR);
            starts.push(start);
            hyps.push(decodeSync(rec, audio.subarray(start, end)));
          }
          const res = {};
          for (const norm of [true, false]) {
            const r = [];
            for (let i = 1; i < hyps.length; i++) {
              const a = words(hyps[i - 1], norm);
              const b = words(hyps[i], norm);
              if (a.length === 0) continue;
              r.push(retracted(a, b, (starts[i] - starts[i - 1]) / SR));
            }
            const key = norm ? 'normalised' : 'raw';
            res[key] = {
              pairs: r.length,
              fullPrefixKeptPct: (100 * r.filter((x) => x === 0).length) / r.length,
              atMostLastWordPct: (100 * r.filter((x) => x <= 1).length) / r.length,
              meanRetracted: r.reduce((x, y) => x + y, 0) / r.length,
              maxRetracted: Math.max(...r),
            };
          }
          if (mode === 'full') {
            // LocalAgreement-2 (commit the common word prefix of the last two decodes, never shrink it): how many
            // committed words a later commit contradicts, and how many hypothesis words wait uncommitted (the lag).
            const hw = hyps.map((h) => words(h, true));
            let committed = [];
            let commitRetracted = 0;
            const lag = [];
            for (let i = 1; i < hw.length; i++) {
              const agree = hw[i - 1].slice(0, lcp(hw[i - 1], hw[i]));
              const keep = lcp(committed, agree);
              if (agree.length > committed.length || keep < committed.length) {
                if (keep < committed.length && agree.length >= keep) {
                  // a contradiction only when the new agreement is at least as long as the old commit
                  if (agree.length >= committed.length) {
                    commitRetracted += committed.length - keep;
                    committed = agree;
                  }
                } else committed = agree;
              }
              lag.push(hw[i].length - committed.length);
            }
            res.localAgreement2 = { committedWordsContradicted: commitRetracted, meanLagWords: lag.reduce((x, y) => x + y, 0) / lag.length, maxLagWords: Math.max(...lag), finalCommitted: committed.length, finalWords: hw.at(-1).length };
          }
          result.stability[`${name}-${mode}`] = { ...res, hypotheses: hyps };
          const n = res.normalised;
          const w = res.raw;
          out(`  stability ${name}/${mode}: ${n.pairs} pairs; prefix fully kept ${f1(n.fullPrefixKeptPct)}% (raw ${f1(w.fullPrefixKeptPct)}%), <=1 word retracted ${f1(n.atMostLastWordPct)}% (raw ${f1(w.atMostLastWordPct)}%), mean retracted ${f3(n.meanRetracted)} words, max ${n.maxRetracted}`);
          if (res.localAgreement2) {
            const la = res.localAgreement2;
            out(`    LocalAgreement-2: committed words later contradicted ${la.committedWordsContradicted}; uncommitted lag mean ${f1(la.meanLagWords)} words (max ${la.maxLagWords}); final ${la.finalCommitted}/${la.finalWords} committed before the segment's final decode`);
          }
        }
      }
    }
  }

  // ---- worker_thread: load + decode in a worker, and the main loop's block meanwhile
  out('\n== worker_thread (2 threads)');
  const tw = performance.now();
  const worker = new Worker(fileURLToPath(import.meta.url), { workerData: { paths: stt, numThreads: 2 } });
  const workerErr = new Promise((_, rej) => worker.once('error', rej));
  await Promise.race([new Promise((r) => worker.once('message', (msg) => msg.op === 'ready' && r())), workerErr]);
  const loadMs = performance.now() - tw;
  const win = synth.subarray(synth.length - 6 * SR);
  const ask = () => new Promise((r) => { worker.once('message', r); worker.postMessage({ op: 'decode', samples: win }); });
  for (let i = 0; i < 3; i++) await ask();
  const wr = [];
  for (let i = 0; i < 10; i++) {
    let reply;
    const b = await loopBlock(async () => { reply = await ask(); });
    wr.push({ roundTrip: b.ms, decode: reply.ms, maxGap: b.maxGap, text: reply.text });
  }
  worker.postMessage({ op: 'exit' });
  result.worker = {
    works: true,
    loadMs,
    p50DecodeMs: pct(wr.map((x) => x.decode), 50),
    p50RoundTripMs: pct(wr.map((x) => x.roundTrip), 50),
    p50LoopBlockMs: pct(wr.map((x) => x.maxGap), 50),
    maxLoopBlockMs: Math.max(...wr.map((x) => x.maxGap)),
  };
  out(`  worker loads + decodes: yes (load ${f1(loadMs)} ms); 6 s window p50 decode ${f1(result.worker.p50DecodeMs)} ms, round trip ${f1(result.worker.p50RoundTripMs)} ms, main event-loop block p50 ${f1(result.worker.p50LoopBlockMs)} ms (max ${f1(result.worker.maxLoopBlockMs)})`);

  const g = result.windows['2t-6s'];
  out(`\nload average at end: ${os.loadavg().map((x) => x.toFixed(2)).join(' ')}`);
  out(`GATE (p95 of a 6 s window at 2 threads <= 250 ms): ${f1(g.p95)} ms -> ${g.p95 <= 250 ? 'PASS' : 'FAIL'}`);
  if (asJson) out(JSON.stringify(result, null, 2));
  process.exit(0);
}

function concat(parts) {
  const outBuf = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    outBuf.set(p, o);
    o += p.length;
  }
  return outBuf;
}

// ---------------------------------------------------------------- entry (worker side, else the benchmark)
if (!isMainThread) {
  const sherpa = (await import('sherpa-onnx-node')).default;
  const rec = new sherpa.OfflineRecognizer(recognizerConfig(workerData.paths, workerData.numThreads));
  parentPort.on('message', (m) => {
    if (m.op === 'decode') {
      const t = performance.now();
      const text = decodeSync(rec, m.samples);
      parentPort.postMessage({ op: 'result', text, ms: performance.now() - t });
    } else if (m.op === 'exit') {
      process.exit(0);
    }
  });
  parentPort.postMessage({ op: 'ready' });
} else {
  await main();
}
