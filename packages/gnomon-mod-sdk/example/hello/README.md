# hello — the example mod (spec §12.4)

Before linking or installing, vendor the SDK runtime next to `index.mjs`:

    npm run build --workspace=@a-company/gnomon-mod-sdk
    cp packages/gnomon-mod-sdk/dist/runtime.js packages/gnomon-mod-sdk/example/hello/gnomon-mod-sdk.mjs

The `mod` sandbox profile reads only the mod's pinned snapshot, so the runtime
must be part of the approved bytes (a bare `@a-company/gnomon-mod-sdk` import
would not resolve inside the sandbox). `gnomon mod new` (slice 2) writes it for you.

A third-party mod's commands are read-only: the host refuses `state.set` and `log.append` inside a command, so writes belong in a tool that declares `write` (here `hello.show` reads the counter and the `hello.count` tool changes it).

A `log.append` the host refuses for a budget rejects with `err.data.data.modCode === 'APPEND_BUDGET'` and `written: false`: nothing was written, so the mod may keep its state and send the row again. Any other failed append may or may not have landed.
