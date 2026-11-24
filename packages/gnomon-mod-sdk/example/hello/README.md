# hello — the example mod (spec §12.4)

Before linking or installing, vendor the SDK runtime next to `index.mjs`:

    npm run build --workspace=@a-company/gnomon-mod-sdk
    cp packages/gnomon-mod-sdk/dist/runtime.js packages/gnomon-mod-sdk/example/hello/gnomon-mod-sdk.mjs

The `mod` sandbox profile reads only the mod's pinned snapshot, so the runtime
must be part of the approved bytes (a bare `@a-company/gnomon-mod-sdk` import
would not resolve inside the sandbox). `gnomon mod new` (slice 2) writes it for you.

A third-party mod's commands are read-only: the host refuses `state.set` and `log.append` inside a command, so writes belong in a tool that declares `write` (here `hello.show` reads the counter and the `hello.count` tool changes it).
