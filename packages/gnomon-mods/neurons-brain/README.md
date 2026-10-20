# neurons (first-party Gnomon mod)

Neurons puts the user's personal knowledge brain on the Desk. It has no view and no process of its own: it declares the Neurons MCP server, three offers and a playbook skill.

- **search-the-brain** (diverge, `neuron_search`): check what is already known before researching a topic from scratch.
- **capture-a-learning** (synthesize, `source_note`): save something verified first-hand in this session as a citable source note.
- **capture-a-decision** (commit, `neuron_write`): write a decision with its reasons as neurons that cite a source.

The mod is named `neurons-brain`, which is the name the model writes in an offer block. The plain name `neurons` is a kernel namespace token (the §9.1 `neurons.event` kind), and the manifest validator refuses it as a mod name. Its MCP server is `gnomon-neurons-brain`. `NEURONS_VAULT` is the upstream server's own variable, so it keeps its name.

Each offer's restraint text says when not to offer it. `skills/neurons-desk/SKILL.md` is the playbook. Outside Gnomon it falls back to plain one-sentence suggestions.

It requires no capability and lists no egress. The MCP server reads and writes the vault on the user's own machine.

## Install

```
gnomon mod install packages/gnomon-mods/neurons-brain
```

Approve the card in the GUI. The manifest's default launch is the generic `neurons mcp`. It declares `config: {command, args, env: [NEURONS_VAULT]}`, so point it at your own checkout and vault with the per-user override (`gnomon mod config`, from slice S1). For example, set the command to `node`, the args to `<your a-neurons checkout>/dist/cli/main.js mcp`, and `NEURONS_VAULT` to your vault folder. The override is per user and is never committed.

The packageHash is pinned in the kernel's first-party list, so editing any file here needs a new pin: run `npm run repin:first-party` in packages/gnomon (it also regenerates the offer goldens in `fixtures/`).
