# Where learning lives (learning scopes)

Paradigm keeps what your agents learn: notebooks, journals, verdicts, nominations, calibration samples and more. Each of these records lives in one of three **homes**. Decision: TD-2026-10-28-820.

## The three homes

| Home | Where | Shared with |
|------|-------|-------------|
| `repo` | `.paradigm/` in the repository, committed | everyone who clones the repo |
| `user` | `~/.paradigm` (per repository under `~/.paradigm/projects/<repoId>/`) | just you, on every project |
| `machine` | your OS state folder (for example `~/Library/Application Support/paradigm/state` on macOS) | this computer only |

Defaults: project notebooks, decisions, wisdom, habits, overrides and classroom certifications are `repo`. Journals, verdicts, nominations, debates and calibration samples are `user`. Hook timings, liveness probes, the team funnel and compliance history are `machine`. You can change a default in `.paradigm/config.yaml` under `learning.default_home.<store>`.

A folder that is not in a git repository, or is your home folder, has no repo home. Everything then goes to the user home.

## Teaching: "This repo or just you?"

When you teach an agent (`/paradigm:teach`), Paradigm picks the home from your words:

- "for this repo", "here", "in this project", or naming a repo symbol (`#checkout`) or path (`src/...`) means **repo**.
- "for me", "always", "everywhere" means **user**.

When your words point both ways or nowhere, it asks one question: "This repo or just you?" The confirmation always says which home was picked.

Each lesson also records `home_source`. It is `explicit` when you chose or confirmed the home, and `inferred` when it came from your wording. In `/paradigm:class`, every candidate shows its home at sign-off and you can flip it.

To confirm or flip lessons already in the repo notebooks:

```
paradigm teach --home repo            # keep them in the repo (confirmed)
paradigm teach --home user nb-kit-x   # move one to just you
```

## Visibility and the commit guard

`paradigm init` asks once whether the repository is public or private and stores it as `learning.visibility` (public when unset). `paradigm hooks install` adds a pre-commit check on learning data. It refuses a commit that adds:

- a record whose home is `user` or `machine`;
- one of this computer's own paths;
- in a public repository, a lesson you taught whose home was only inferred. Confirm it with `paradigm teach --home repo`, or move it with `--home user`.

It looks only at what the commit adds, and only at learning stores. `PARADIGM_OVERRIDE=learning-guard git commit ...` lets one commit through, and the override is logged.

## Moving older records

Records written before homes existed stay readable. `paradigm migrate learning-stores --scopes` shows what it would move; `--apply` copies your own rows to your user home, marks the repo copies as migrated, and updates rows that still carry your plain OS username to your hashed author id. Running it again changes nothing.

## Checking the state

`paradigm doctor` shows:

- **Learning census**: for each store, how many records sit in each home, how many are legacy, the last write, and any hook writes that were skipped.
- **Learning conflicts**: a repo lesson and a user lesson about the same thing that give different advice. These are listed for review. Nothing is resolved for you.
- **Repeat-failure rate**, labelled by population (`repo`, `user`, `machine` or `legacy-prior`).

`paradigm calibrate` and the planner's token estimate label their numbers the same way. Numbers from different populations are never added together.
