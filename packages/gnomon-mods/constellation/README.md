# constellation (first-party Gnomon mod)

Constellation puts the user's local idea map on the Desk. It has no view and no process of its own: it declares the Constellation MCP server, three offers and a playbook skill.

- **map-the-idea** (diverge, `apply`): lay the ideas in play out as stars and beams on the active session's map.
- **summarize-the-session** (synthesize, `summarize`): read the session outline, then save a short written summary.
- **automate-this** (commit, `automation_save`): save a step done by hand as an automation. The playbook starts it with `automation_run` and follows it with `run_get`.

Each offer's restraint text says when not to offer it. `skills/constellation-desk/SKILL.md` is the playbook. Outside Gnomon it falls back to plain one-sentence suggestions.

It requires no capability and lists no egress. The MCP server talks only to the Constellation app on loopback.

A Constellation "sky" world is planned (L3: worlds are for first-party mods only, for now). It is not declared here yet, because manifest:v1 has no world field and its validator refuses unknown keys.

## Install

```
gnomon mod install packages/gnomon-mods/constellation
```

Approve the card in the GUI. The manifest's default command, `constellation-mcp`, is a placeholder. It declares `config: {command, args, env: [CONSTELLATION_NO_AUTOSTART]}`, so set the real launch with the per-user override (`gnomon mod config`, from slice S1). For example, set the command to `node` (Node 24 or later) and the args to `<your a-constellation checkout>/mcp/server.ts`. The override is per user and is never committed.

The packageHash is pinned in the kernel's first-party list, so editing any file here needs a new pin: run `npm run repin:first-party` in packages/gnomon (it also regenerates the offer goldens in `fixtures/`).
