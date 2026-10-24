# ledger (first-party Gnomon mod)

The Ledger is a context and budget meter with two views.

- **ledger.strip** (`composer.footer`): one line for the focused session, for example `182k in · 9k out · 71% cache · $0.42 · ⇣ 2 compactions (190k → 41k)`. It then shows the budget meter as `n of m` and any breaker or denied permit. The cap at the start carries the session's project hue (never as text). The line turns amber at a warning rung or an over-permit row, and vermilion when a breaker opens or a permit is denied. With reduced motion the meter is plain text (no fill element at all).
- **ledger.sheet** (`sidebar`): one row per session (in, out, cache share, cost, compactions), the total, then the same meter and alarms.

`in` counts every input token (fresh plus cache reads and writes), and `cache` is the share served from the cache. The split and the cost come from Claude's `result.usage`. A local session shows its token total only.

Every number comes from the kernel's numbers-only feed (`#mod-host` projection v2, granted by `log.read`). No text, path or tool input reaches the mod. Install it with `gnomon mod install packages/gnomon-mods/ledger`, then approve the card in the GUI. Its packageHash is pinned in the kernel's first-party list, so editing any file here needs a new pin (`npm run repin:first-party` in packages/gnomon).
