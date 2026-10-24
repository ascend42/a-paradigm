# gnomon.neurons (first-party Gnomon mod)

Neurons puts the user's personal knowledge brain on the Desk. It has no view and no process of its own: it declares the Neurons MCP server, three offers and a playbook skill.

- **search-the-brain** (diverge, `neuron_search`): check what is already known before researching a topic from scratch.
- **capture-a-learning** (synthesize, `source_note`): save something verified first-hand in this session as a citable source note.
- **capture-a-decision** (commit, `neuron_write`): write a decision with its reasons as neurons that cite a source.

The mod id is `gnomon.neurons` (manifest: 2, publisher `gnomon`, slice S0b), which is what the model writes in an offer block. Before S0b it was `neurons-brain`, because the bare name `neurons` is a kernel namespace token (the §9.1 `neurons.event` kind); under a publisher its events live in `modns.gnomon.neurons.*`, so the first-party name is allowed for publisher `gnomon` only. The kernel names its MCP server `gm_gnomon_neurons` (manifest: 2 entries carry no name). `NEURONS_VAULT` is the upstream server's own variable, so it keeps its name (first-party env names are exempt from the `<PUB>__<NAME>__` own-prefix).

Each offer's restraint text says when not to offer it. `skills/neurons-desk/SKILL.md` is the playbook. Outside Gnomon it falls back to plain one-sentence suggestions.

It requires no capability and lists no egress. The MCP server reads and writes the vault on the user's own machine.

## Install

```
gnomon mod install packages/gnomon-mods/neurons
```

Approve the card in the GUI. The manifest's default launch, `neurons mcp`, is generic and is not an absolute path, so the server fails closed (it is never launched) until you set a per-user override. The manifest declares `config: {command, args, env: [NEURONS_VAULT]}`. Set the override with `gnomon mod config` (slice S1):

- the command: the absolute path of your node (`which node`)
- the args: `<your a-neurons checkout>/dist/cli/main.js mcp`
- `NEURONS_VAULT`: your vault folder

An override command must be an absolute path; a bare `node` is refused. The override belongs to you and is never committed.

Before the model saves anything with `source_note` or `neuron_write`, the playbook has it show you the exact text and wait for you to confirm or edit it. It also flags any part that came from fetched pages, tool output or unverified files.

The packageHash is pinned in the kernel's first-party list, so editing any file here needs a new pin: run `npm run repin:first-party` in packages/gnomon (it also regenerates the offer goldens in `fixtures/`).
