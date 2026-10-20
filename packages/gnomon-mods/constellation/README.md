# constellation (first-party Gnomon mod)

Constellation puts the user's local idea map on the Desk. It has no view and no process of its own. It declares the Constellation MCP server (`gnomon-constellation`), two offers and a playbook skill.

- **map-the-idea** (diverge, `apply`): lay the ideas in play out as stars and beams on the active session's map.
- **summarize-the-session** (synthesize, `summarize`): read the session outline, then save a short written summary.

Each offer's restraint text says when not to offer it. The playbook is `skills/constellation-desk/SKILL.md`. Outside Gnomon it falls back to plain one-sentence suggestions. An automation offer is deferred to O2, where it will sit behind a confirmation and a disabled save.

It requires no capability and lists no egress. The MCP server talks only to the Constellation app on loopback.

A Constellation "sky" world is planned (L3: worlds are first-party only, for now). It is not declared here yet, because manifest:v1 has no world field and its validator refuses unknown keys.

## Install

```
gnomon mod install packages/gnomon-mods/constellation
```

Approve the card in the GUI. The manifest's default command, `constellation-mcp`, is a placeholder that is never launched. It is not an absolute path, so the server fails closed until you set a per-user override. The manifest declares `config: {command, args, env: [CONSTELLATION_NO_AUTOSTART]}`. Set the override with `gnomon mod config` (slice S1):

- the command: the absolute path of your node (`which node`), Node 24 or later
- the args: `<your a-constellation checkout>/mcp/server.ts`

An override command must be an absolute path; a bare `node` is refused. The override belongs to you and is never committed.

The packageHash is pinned in the kernel's first-party list, so editing any file here needs a new pin. Run `npm run repin:first-party` in packages/gnomon; it also regenerates the offer goldens in `fixtures/`.
