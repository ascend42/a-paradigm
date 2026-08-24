/**
 * #warpline-mcp token custody boundary (mcp-skin-spec D2, Aegis R1/R5): the
 * skin's ONLY credential sources are `$WARPLINE_MCP_TOKEN` and the dedicated
 * `.warpline/daemon/mcp.token` file, via `mcpAgentToken`. Everything in
 * `src/mcp/` imports custody THROUGH this module, so a daemon-tokens.jsonl
 * read (human tokens — one selection bug there is a privilege escalation)
 * cannot creep in without being visible at this single seam. The skin never
 * mints: issuance is the human's CLI act (`warpline daemon token mint mcp
 * --kind agent --mcp`).
 */
export { mcpAgentToken, mcpTokenPathOf } from '../daemon/tokens.js';
