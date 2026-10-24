/**
 * @symbol #session-runner
 *
 * The Claude model a Gnomon session runs (founder ask 2026-10-20: "is there no way to change the model of what
 * claude is in the tool?"). ONE validator, shared by the kernel (session.open, request.session.model), the adapter
 * (buildClaudeArgv, defence in depth) and the GUI picker.
 *
 *   - an ALIAS the installed claude accepts (`claude --help` 2.1.304: "an alias for the latest model (e.g. 'fable',
 *     'opus', or 'sonnet') or a model's full name"), or
 *   - a FULL model id: `claude-` then lowercase letters, digits, `.` and `-` (e.g. claude-opus-5-5,
 *     claude-sonnet-4-5-20250929), optionally the `[1m]` context suffix; at most 64 characters.
 *
 * Nothing that can start with `-` passes (no flag injection into argv), no whitespace, no `=`, no path or URL. The
 * routing values `claude` / `local` / `any` of session.open are NOT Claude models: they choose the backend.
 * `default` is the alias that means "Claude Code's own default" (session.open omits --model for it; set_model sends it).
 */
export const CLAUDE_MODEL_ALIASES = Object.freeze(['default', 'opus', 'sonnet', 'haiku', 'fable', 'opusplan', 'opus[1m]', 'sonnet[1m]'] as const);
export type ClaudeModelAlias = (typeof CLAUDE_MODEL_ALIASES)[number];

/** A full Claude model id (strict). */
export const CLAUDE_MODEL_ID = /^claude-[a-z0-9]+(?:[.-][a-z0-9]+)*(?:\[1m\])?$/;
export const CLAUDE_MODEL_MAX = 64;

/** True when `m` is an allow-listed alias or a strict full Claude model id. */
export function isClaudeModel(m: unknown): m is string {
  if (typeof m !== 'string' || m.length === 0 || m.length > CLAUDE_MODEL_MAX) return false;
  if ((CLAUDE_MODEL_ALIASES as readonly string[]).includes(m)) return true;
  return CLAUDE_MODEL_ID.test(m);
}

/** Why `m` is refused (null = valid). Never echoes the value. */
export function claudeModelProblem(m: unknown): string | null {
  if (typeof m !== 'string') return 'model must be a string';
  if (m.length === 0) return 'model is empty';
  if (m.length > CLAUDE_MODEL_MAX) return `model is longer than ${CLAUDE_MODEL_MAX} characters`;
  if (m.startsWith('-')) return 'model may not start with "-" (no flags)';
  if (isClaudeModel(m)) return null;
  return `model is an alias (${CLAUDE_MODEL_ALIASES.join(', ')}) or a full id like claude-opus-5-5`;
}
