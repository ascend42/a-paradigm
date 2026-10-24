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
          { type: 'Button', label: 'Bump', command: 'hello.bump' },
        ],
      };
    },
  },
  commands: {
    'hello.bump': async (_args, _ctx, api) => {
      const count = Number((await api.state.get('count')) ?? 0) + 1;
      await api.state.set('count', count);
      return { count };
    },
  },
  tools: {
    'hello.greet': async (input) => ({ greeting: `hello, ${typeof input?.name === 'string' ? input.name : 'world'}` }),
    'hello.count': async (_input, _ctx, api) => {
      const count = Number((await api.state.get('count')) ?? 0) + 1;
      await api.state.set('count', count);
      return { count };
    },
  },
});
