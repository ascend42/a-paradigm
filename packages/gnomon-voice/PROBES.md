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
