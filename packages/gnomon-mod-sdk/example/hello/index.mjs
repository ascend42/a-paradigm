// The example mod (spec §12.4). Runs under #mod-host from its pinned snapshot,
// over mod-abi:v1 on stdio. `gnomon-mod-sdk.mjs` is the SDK runtime vendored
// into this folder (packages/gnomon-mod-sdk/dist/runtime.js): the `mod`
// sandbox profile reads nothing outside the approved snapshot.
import { serveMod } from './gnomon-mod-sdk.mjs';

serveMod({
  views: {
    'hello.panel': async (input, ctx, api) => {
      const count = (await api.state.get('count')) ?? 0;
      const who = typeof input?.name === 'string' ? input.name : 'world';
      return {
        schemaVersion: 'display-block:v1',
        type: 'Box',
        children: [
          { type: 'Text', text: `hello, ${who}` },
          { type: 'Progress', value: Math.min(Number(count), 10), max: 10 },
          { type: 'Button', label: 'Show count', command: 'hello.show' },
        ],
      };
    },
  },
  // A third-party mod's commands are read-only (spec §12.3): the host refuses state.set and log.append inside
  // one. This command only reads; the write is in the `hello.count` tool below.
  commands: {
    'hello.show': async (_args, _ctx, api) => ({ count: Number((await api.state.get('count')) ?? 0) }),
  },
  tools: {
    'hello.greet': async (input) => ({ greeting: `hello, ${typeof input?.name === 'string' ? input.name : 'world'}` }),
    // the tool declares `write` in the manifest, so it may keep state
    'hello.count': async (_input, _ctx, api) => {
      const count = Number((await api.state.get('count')) ?? 0) + 1;
      await api.state.set('count', count);
      return { count };
    },
  },
});
