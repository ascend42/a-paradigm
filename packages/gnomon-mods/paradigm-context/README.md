# paradigm-context (first-party Gnomon mod)

Paradigm Context shows the focused session's project knowledge in the sidebar. It is read-only and has no buttons.

- **paradigm-context.sheet** (`sidebar`): the project swatch and name, then three zones. Each zone shows an `n of m` count. **Tasks** lists up to 5 open tasks (high priority first, marked ▲) with the open and high counts. **Decisions** lists the last 5 decisions with their dates. **Lore** lists the last 5 entries with their types. The symbols touched in those lore entries follow as mono chips. When the newest decision or lore entry is more than 14 days old, the sheet says it is stale. Files the kernel skipped (malformed, refused, secret) are counted at the foot.

The only input is the kernel's `paradigm-slice:v1`. The kernel reads it from the repo of the focused LIVE session: the GUI sends `{focus:{hsid}}`, and the host joins that hsid to the session's repo on the server side. The mod reads no file and never sees a path. Titles arrive sanitised and capped at 120 characters by the kernel, and the mod cuts them to 80. It requires `paradigm.read:summary` and lists no egress (a manifest holding that capability may not).

Install it with `gnomon mod install packages/gnomon-mods/paradigm-context`, then approve the card in the GUI. Its packageHash is pinned in the kernel's first-party list, so editing any file here needs a new pin (`npm run repin:first-party` in packages/gnomon).
