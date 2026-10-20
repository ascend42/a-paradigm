# gnomon-voice-io probes (founder, macOS)

Run from the repo root. First build and sign (no prompt, except perhaps one
codesign keychain prompt: enter your login password, Always Allow):

```sh
node packages/gnomon-voice/scripts/build-voice-io.mjs
# run it from outside ~/Documents (a self-responsible process has no Documents grant)
mkdir -p "$HOME/.gnomon-probe" && ditto packages/gnomon-voice/bin/darwin/GnomonVoiceIO.app "$HOME/.gnomon-probe/GnomonVoiceIO.app"
APP="$HOME/.gnomon-probe/GnomonVoiceIO.app/Contents/MacOS/gnomon-voice-io"
$APP --version                     # gnomon-voice-io 0.1.0
```

If a prompt asks to let GnomonVoiceIO access your Documents folder, click
Don't Allow: the copy step above was skipped. Delete `~/.gnomon-probe` when done.

## Smoke (1 s)

```sh
$APP --selftest
```

Pass: the first line has `"disclaimed":true`; the last line has `"selftest":"pass"`, `frames` > 0, `samples` near 16000,
`"voiceProcessing":true`, and `playback` lists `playback.start` and
`playback.end:drained`. You hear a short quiet tone.

## P1: the mic grant names GnomonVoiceIO, not Terminal

1. If a Microphone entry for GnomonVoiceIO already exists, reset it first:
   `tccutil reset Microphone gnomon.voice-io`
2. Run `$APP --selftest` from Terminal.
3. A prompt appears. Check that it names **GnomonVoiceIO** and shows
   "Gnomon voice listens only while the mic is on." Click Allow.
4. Open System Settings → Privacy & Security → Microphone.
   Pass: the list has **GnomonVoiceIO**, switched on. Terminal did not get a new
   entry (if Terminal was already in the list, it was there before).
5. Run `$APP --selftest` again. Pass: no prompt, `"selftest":"pass"`.
6. Control (optional): `$APP --selftest --no-disclaim` charges the grant to
   Terminal instead. If Terminal has no mic grant, that run fails `mic-denied`
   or shows a prompt that names Terminal. This shows why the binary disclaims.

Report: pass or fail, the name the prompt showed, and a screenshot of the
Microphone list.

## P7: AEC leak through the speakers

Use the built-in speakers (no headphones, no AirPods), volume at about 70 %.
The room must be quiet. Do not speak during the run (about 20 s).

```sh
say -o "$TMPDIR/p7.aiff" "The quick brown fox jumps over the lazy dog. Gnomon is reading this sentence aloud to test the echo canceller."
$APP --probe-aec "$TMPDIR/p7.aiff"
```

It measures 2 s of quiet, then plays the sentence with voice processing on,
then plays it again with voice processing off. The last line holds:

| Field | Meaning |
|---|---|
| `quietDBFS` | the room with nothing playing |
| `vpResidualDBFS` | what the mic hears of the TTS with AEC on (the residual) |
| `rawLeakDBFS` | what the mic hears of the TTS with AEC off (the raw leak) |
| `attenuationDB` | `rawLeakDBFS − vpResidualDBFS` (how much AEC removes) |
| `residualOverQuietDB` | `vpResidualDBFS − quietDBFS` (near 0 = the residual is at the room floor) |

Report the whole last line. Also run it once at full volume. If `warning` says
headphones, switch to the speakers and run it again.

## B0: partial-decode benchmark (voice phase B, T-2026-10-20-005, ruling V5 in TD-2026-10-20-086)

Question: can Parakeet TDT 0.6B v2 int8 (sherpa-onnx-node 1.13.8 `OfflineRecognizer`, built exactly as
`src/engines/sherpa.ts` does) decode the TAIL WINDOW of a growing speech segment again and again, fast enough
for live partials? Gate: p95 decode of a 6 s window at 2 threads ≤ 250 ms.

```sh
cd packages/gnomon-voice && npm run build && cd ../..
node packages/gnomon-voice/scripts/bench-partials.mjs [--runs 60] [--home ~/.gnomon] [--json]
```

The script only reads the model home. Paths come from `verifiedModelPaths`, which re-hashes every member against
the manifest. It writes nothing. Test audio, all in memory: (a) 14.9 s of Kokoro speech, four sentences joined
by 150 ms gaps (shorter than the VAD's 0.5 s split); (b) `test_wavs/0.wav` from the Parakeet archive (7.4 s of
human speech). Each timed decode covers createStream, acceptWaveform, decode and getResult, after 3 warm-up
decodes. The windows slide evenly across audio (a).

### Results (2026-10-20, Apple M4, 10 cores, node 26.0.0)

The machine was **not idle**: other sessions were running vitest, with a load average of 8.6 to 14.5 on
10 cores. So the p95 values carry contention noise. The p50 values were stable from run to run.

Decode time in ms. There were four passes at 2 threads (one with 30 runs per window, three with 60). The p95
column lists each pass:

| threads | window | p50 | p95 per pass | RTF (p50) |
|---|---|---|---|---|
| 2 | 4 s | 136 to 139 | 139, 147, 179, 144 | 0.034 |
| 2 | **6 s** | **202 to 214** | **258, 312, 210, 254** | 0.034 |
| 2 | 8 s | 257 to 273 | 268, 419, 428, 291 | 0.033 |
| 4 | 4 s | 107 to 129 | 266, 158, 306, 434 | 0.027 |
| 4 | 6 s | 144 to 197 | 296, 498, 245, 155 | 0.024 to 0.033 |
| 4 | 8 s | 188 to 264 | 413, 236, 471, 327 | 0.024 to 0.033 |

Decode cost is linear in window length: about 34 ms per second of audio at 2 threads (RTF 0.034).
4 threads cuts p50 by only 15 to 30 %, and its p95 is worse under contention.

**Gate: FAIL as measured (marginal).** p95 at 6 s and 2 threads was ≤ 250 ms in 1 pass out of 4
(210 ms). The other passes gave 254, 258 and 312 ms. p50 (202 to 214 ms) clears the gate by about 40 ms. A
6 s window leaves no p95 headroom on a loaded machine. A 4 s window does (p95 139 to 179 ms in every pass).
The gate has not been measured on an idle machine. Run the script again with nothing else running before
treating the 6 s FAIL as final.

### async and worker_thread

| path | 6 s decode p50 | event-loop block p50 (max) |
|---|---|---|
| `rec.decode()` (sync, what sherpa.ts uses today) | 202 to 232 ms | **the whole decode** (202 to 232 ms, max 412) |
| `rec.decodeAsync(stream)` | 200 to 265 ms | **1.4 to 3.5 ms** (max 18) |
| worker_thread (own recognizer, sync decode inside) | 200 to 210 ms | 1.3 to 1.8 ms (max 7.6) |

- sherpa-onnx-node 1.13.8 has `OfflineRecognizer.decodeAsync(stream)`, which returns the result JSON. It
  gives the same text as the sync decode, takes about the same time, and keeps the event loop free. Partials
  would need it. A sync partial decode every 600 ms would block capture frames and the stop hotkey for
  200 ms or more each time.
- A worker_thread also works: the addon loads in a worker, and a second recognizer loads in about 1.0 s.
  It costs a second copy of the 650 MB encoder, though, and decodeAsync gives the same unblocking for free.

### Prefix stability (decodes 600 ms apart over a growing segment, 2 threads)

"Retracted" means words already on screen that the next decode changes. Words are normalised: lower case, no
punctuation. The raw figures include case and punctuation flips such as `sentence.` → `sentence while`.
`full` decodes from the segment start. `tail6` decodes the last 6 s, and words that slide out of the window
head do not count as retractions.

| audio / mode | pairs | prefix fully kept | ≤ 1 word retracted | mean retracted |
|---|---|---|---|---|
| Kokoro / full | 23 | 61 to 70 % (raw 30 to 35 %) | 70 to 78 % | 1.9 to 4.1 words |
| Kokoro / tail6 | 23 | 61 to 83 % (raw 26 to 30 %) | 65 to 87 % | 1.3 to 2.9 words |
| human / full | 11 | 55 % (raw 36 %) | 73 % | 2.2 words |
| human / tail6 | 11 | 64 % (raw 36 %) | 82 % | 1.1 words |

Kokoro rendering varies a little from run to run, hence the ranges. What causes the flicker, from the
hypothesis logs:

- **The last word, most of the time.** The model guesses a half-spoken word and then fixes it:
  `while you are saying` → `still speaking it`, `default brown` → `branch`, `to man` → `main`.
- **Tokenisation flips deep in the text.** `river bank` ↔ `riverbank` and `Phebe` ↔ `Phoebe` flip
  back and forth between consecutive decodes. One flip breaks the prefix 10 to 25 words back. The max
  retracted (12 to 25) comes from this, not from real changes to many words.
- **Raw punctuation.** The model ends every partial with a period, so raw prefix agreement is only
  26 to 36 %. Display must not show the trailing punctuation of an unfinished hypothesis.
- **Context loss at the head of the tail window.** A tail window that slides freely loses context. In the
  final 6 s window, `Then run the tests` decoded as `Through the tests`. A full-segment decode got it right.

**LocalAgreement-2** (show as committed only the word prefix that two consecutive decodes agree on; grow
it, never shrink it): **0 to 2 committed words were later contradicted**. The uncommitted tail averaged
about 3 words (max 5 to 8), about 1 s behind the speaker. 19/23 (human) and 41/49 (Kokoro) words were
committed before the segment's final decode.

### Recommendation

**B1 (tail re-decode with the offline Parakeet), not B2 (streaming model), with these conditions:**

1. Decode with `decodeAsync`, never the sync `decode` (a 200 ms event-loop block per partial is
   unacceptable). A worker_thread is not needed.
2. Window: re-decode the segment from its start up to about 6 s (the p50 fits), and switch to a 4 s tail
   after that. Or use 4 s throughout, which has p95 headroom even under load. Anchor the window head at
   a committed word boundary instead of sliding it freely, to avoid head-context loss. Run one partial
   decode at a time. If a decode is still running at the next 600 ms tick, skip that tick; never queue.
3. Display: LocalAgreement-2 commits shown solid, the uncommitted tail shown dim. Strip the trailing
   punctuation of hypotheses. The final transcript stays the full-segment decode the turn already makes.
4. Stay at 2 threads (4 threads helps little and its p95 is worse under contention).

B2 is not justified by these numbers. The decode is about 30× faster than real time, and LocalAgreement-2
removes nearly all flicker. Reconsider B2 only if an idle-machine re-run of the 6 s gate still fails AND the
4 s window degrades accuracy in a live trial.
