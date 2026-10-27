/**
 * @symbol #backend-adapter
 *
 * #backend-adapter (spec §2.2) — the shared WIRE CODEC every backend driver
 * implements: argv, a tolerant parse, a usage meter, the turn line and the
 * interrupt line. Types only: this file imports nothing from either adapter.
 *
 * The lanes (kernel/supervisor/supervisor.ts for claude-code,
 * kernel/supervisor/local-session.ts for local) carry out start / send / stop
 * with it; the process halves (spawn, sandbox, permits, trace, broker) stay in
 * each lane.
 *
 * A backend's extra channels are CAPABILITY interfaces (PermissionChannel,
 * ControlChannel, SdkMcpChannel, SteerChannel, ToolBrokerChannel). A concrete
 * adapter type is the core intersected with only the capabilities that backend
 * really has: no optional members and no fake methods, so calling a channel a
 * backend lacks is a compile error. There is no normalized cross-backend event
 * vocabulary: each adapter keeps its own event union (`E`), which only has to
 * carry `kind` / `type` and the tolerant `unknown` / `malformed` kinds.
 */

export type BackendId = 'claude-code' | 'local';

/** The least every driver event carries: a discriminating `kind` and the wire `type` it was read from. */
export interface DriverEvent {
  readonly kind: string;
  readonly type: string;
}

type HasKind<E, K extends string> = [Extract<E, { kind: K }>] extends [never] ? false : true;

/** An event union that can say `unknown` (a type it does not know) and `malformed` (not a JSON object); else never. */
export type Tolerant<E extends DriverEvent> = HasKind<E, 'unknown'> extends true ? (HasKind<E, 'malformed'> extends true ? E : never) : never;

/** Per-session usage: `charge` returns the tokens an event adds that were not charged before (0 for any other event). */
export interface UsageMeter<E extends DriverEvent> {
  charge(ev: E): number;
}

/** One turn to send. `inFlight`: a turn of this session is still running (a backend may queue the text differently). */
export interface TurnInput {
  readonly text: string;
  readonly inFlight: boolean;
}

export interface BackendAdapter<B extends BackendId, A, E extends DriverEvent, T extends TurnInput = TurnInput> {
  readonly backend: B;
  /** The child's argv (after the binary). */
  argv(input: A): string[];
  /** One stdout line → one typed event. Never throws on any input. */
  parse(line: string): Tolerant<E>;
  newMeter(): UsageMeter<E>;
  /** The stdin line that sends one turn. */
  turnLine(turn: T): string;
  /** The stdin line that interrupts the running turn (never a signal, A23-4). */
  interruptLine(): string;
}

/* ── capabilities: each exists only on the backend that has it ───────────── */

/** claude-code (P8-D96): the answers to a tool-permission request. */
export interface PermissionChannel {
  allowLine(requestId: string, updatedInput: unknown): string;
  denyLine(requestId: string, message: string, interrupt?: boolean): string;
}

/** claude-code: the control_request answers and requests besides permissions. */
export interface ControlChannel {
  errorLine(requestId: string, error: string): string;
  setModelLine(requestId: string, model: string): string;
}

/** claude-code (#kernel-mcp): the answer to an SDK MCP server message. */
export interface SdkMcpChannel {
  mcpResponseLine(requestId: string, response: unknown): string;
}

/** local: text for the running turn, read at its next step. */
export interface SteerChannel {
  steerLine(text: string): string;
}

/** local (slice S1 / C1): the kernel's half of the brokered-tool protocol. */
export interface ToolBrokerChannel {
  toolsSetLine(tools: ReadonlyArray<OfferedTool>): string;
  toolResponseLine(r: ToolResponse): string;
  toolProgressLine(id: string): string;
}

/** A brokered tool offered to the child. */
export interface OfferedTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  class: string;
}

/** The kernel's answer to one tool request. */
export interface ToolResponse {
  id: string;
  content: string;
  isError: boolean;
  provenance: string;
}
