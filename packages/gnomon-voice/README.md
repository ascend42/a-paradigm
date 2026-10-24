# gnomon-voice

Gnomon voice (`docs/specs/gnomon.md` §14). For now this holds one native piece:
**gnomon-voice-io**, the darwin audio I/O binary of the voice child
(TD-2026-10-19-298, slice V2b). Mic only: no keychain group, no network, and it
writes nothing but stdout and stderr. "No network" and "no file writes" are
properties of the code, not of a sandbox: the binary is unsandboxed (hardened
runtime, one entitlement), so nothing but review stops a future change from
opening a socket. Audit any new import or syscall with that in mind. Not an npm workspace yet; macOS only (CI
builds and tests it on the macOS runner of `.github/workflows/gnomon.yml`'s
`native` job, never on Windows or Linux).

| Path | What |
|---|---|
| `io-darwin/` | SwiftPM package (swift-tools 5.9, macOS 14). `VoiceIOCore` (pure: frame codec, command parser, hotkey config, level and route math; `swift test`) and the executable `gnomon-voice-io` (AVAudioEngine, CoreAudio, Carbon). |
| `scripts/build-voice-io.mjs` | Builds `bin/darwin/GnomonVoiceIO.app`, signs it (Developer ID, hardened runtime, timestamp, ONLY `com.apple.security.device.audio-input`, identifier `gnomon.voice-io`, no profile), verifies, writes `checksums.json`. `--unsigned` for CI. |
| `PROBES.md` | Founder steps for P1 (TCC attribution) and P7 (AEC leak). |

```sh
node packages/gnomon-voice/scripts/build-voice-io.mjs              # signed
node packages/gnomon-voice/scripts/build-voice-io.mjs --unsigned   # bundle only
cd packages/gnomon-voice/io-darwin && swift build -c release && swift test
```

Notarization is not scripted here. To notarize (optional), from the repo root:

```sh
cd packages/gnomon-voice/bin/darwin
ditto -c -k --keepParent GnomonVoiceIO.app GnomonVoiceIO.zip
xcrun notarytool submit GnomonVoiceIO.zip --keychain-profile gnomon-notary --wait
xcrun stapler staple GnomonVoiceIO.app && rm GnomonVoiceIO.zip
```

## Protocol `gnomon-voice-io:v1`

Both directions use one framing: `type:u8  length:u32le  payload[length]`, length ≤ 1 MiB.
An unknown type or an oversize length ends the process (exit 2): the stream is out of sync.

| Type | Direction | Payload |
|---|---|---|
| `0x01` json | both | one UTF-8 JSON object: a command (stdin), a reply or an event (stdout) |
| `0x02` capture | stdout | `hostTimeNs:u64le  sampleRate:u32le(16000)  samples:s16le[]`, mono, after voice processing. `hostTimeNs` is mach absolute time in ns of the first sample (approximate after resampling). |
| `0x03` playback | stdin | `sampleRate:u32le(8000…48000)  samples:s16le[]`, mono TTS, played through the capture engine |

Commands: `{"op", "id"?: int | string ≤ 128}`. Each gets exactly one reply
`{"type":"reply","id","op","ok":true,…}` or `{"type":"reply","id","op","ok":false,"error","message"}`.

| op | Effect / reply fields |
|---|---|
| `info` | `version protocol pid bundle permission hotkeys capture playback maxPayload route aec transport voiceProcessing mic playing engine disclaimed disclaimReason` |
| `mic.on` | asks for the mic once (TCC), starts the duplex engine with voice processing: `mic voiceProcessing aec transport`; errors `not-disclaimed` (TCC responsibility not disclaimed and no `--no-disclaim`; refused before any prompt), `superseded` (a `mic.off` or newer `mic.on` arrived while the prompt was open: the later one wins), `mic-denied`, `no-input`, `engine-start` |
| `mic.off` | stops and releases the engine (the orange dot goes away): `mic:false` |
| `play.stop` | barge-in: drops every queued sample now: `wasPlaying` |
| `play.end` | the utterance is complete: flushes the resampler tail |
| `route.get` | `route{device, transport, dataSource, kind}`, `aec`, `voiceProcessing` |
| `hotkeys.set` | `{"bindings": {"talk": "ctrl+alt+space", "mic-toggle": "none", …}}`, a partial update; refuses `bad-request` (syntax, unknown action, one chord twice) and `hotkey-taken` (the system refused a chord; the old set stays) |
| `quit` | reply, then exit 0 (stdin EOF does the same) |

Events: `{"type":"event","event","tUs",…}`, `tUs` = monotonic µs on the capture clock.

| event | Fields |
|---|---|
| `ready` | the `info` fields (plus `hotkeyErrors` if a default chord was taken) |
| `mic` | `on voiceProcessing aec transport`; after `mic {on:false}` no capture or level frame is emitted |
| `route` | `route aec transport voiceProcessing`, on a new default output device or a headphone-jack flip |
| `level` | `rmsDBFS peakDBFS`, about 15 Hz while the mic is on |
| `playback.start` | `engine (duplex|output) audibleAtUs outputLatencyUs` |
| `playback.end` | `reason (drained|stopped|mic-switch|route-change|exit) utteranceEnded queuedMs`; `drained` fires whenever the queue runs empty |
| `hotkey` | `action (talk|mic-toggle|mode-toggle|hold-toggle|stop-speaking) phase (down|up)`; reported only, the controller acts |
| `engine` | `what (restarted|failed|released) mic`, after a device configuration change |
| `capture.dropped` | `frames`: capture frames dropped because the reader stalled (more than 32 queued); control frames are never dropped |
| `error` | `error message` (bad playback frame, wrong direction) |
| `exit` | `code` |

`aec`: `headphones` when the output is headphones (built-in jack or Bluetooth),
else `vpio` when voice processing is active, else `none` (speakers with no
echo cancellation: conversation mode must refuse).

Hotkey spec: `mod+…+key`, mods `ctrl alt shift cmd` (synonyms `control opt option command`),
keys `a-z 0-9 space return tab escape f1-f12`, or `none`. ctrl, alt or cmd is required (F-keys excepted).
Defaults: ⌃⌥Space talk (hold), ⌃⌥M mic toggle, ⌃⌥A ambient/push-to-talk toggle.

TCC: every mode re-spawns once with responsibility disclaimed, so the grant is
charged to GnomonVoiceIO and not to the parent (Terminal or the kernel's app);
stdio passes through unchanged. The path comes from `_NSGetExecutablePath` +
`realpath` only. The child counts as disclaimed only if the env token
`GNOMON_VOICE_IO_DISCLAIMED` equals the per-spawn random `--disclaim-token` the
parent put in argv; a stray inherited env var is ignored (the process just
re-spawns). `--no-disclaim` skips it deliberately (then `disclaimReason` is
`no-disclaim-flag` and `mic.on` is allowed). The child watches the re-spawning
parent and the original parent (`--parent-pid`) with kqueue `EVFILT_PROC
NOTE_EXIT` and exits when either dies; serve also exits on stdin EOF.

Location: a self-responsible process gets no inherited folder grants, so run it
from outside TCC-protected folders (`~/Documents`, `~/Desktop`, `~/Downloads`).
From the repo under `~/Documents` the disclaimed child blocks in dyld opening
its own executable (or asks for Documents access). The kernel spawns it from its
own 0700 directory, which is not protected.
