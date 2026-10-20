/**
 * @symbol #gnomon-voice
 *
 * @a-company/gnomon-voice public entry (voice slice V2c): the client loop, its injected seams, the AudioIO
 * adapters (V2b binary + FakeAudioIO), the model manifest, enrolment and the sherpa-onnx engines.
 */
export * from './types.js';
export * from './voice-client.js';
export * from './speakable.js';
export * from './speaker.js';
export * from './enrol.js';
export * from './manifest.js';
export * from './audio-io.js';
export * from './fake-audio-io.js';
export * from './kernel-link.js';
export * from './run.js';
export { createSherpaEngines, loadSherpa, SherpaSpeaker, SherpaStt, SherpaTts, SherpaVad } from './engines/sherpa.js';
