/**
 * @symbol #setup-endpoint
 *
 * `gnomon-setup:v1` (spec §11.2 rule 11; T-2026-10-19-005 MVP-b) — the CLOSED
 * protocol of the first-run SETUP endpoint. It is NOT gnomon-rpc: it has its
 * own `SETUP_API_ID`, and nothing here is an input of `clientApiId` (the
 * contracts pin test checks that clientApiId did not move).
 *
 *   hello {clientApis:['gnomon-setup:v1'], clientNonce, client:{surface}}
 *         → {clientApi, features:[], nonce, clientNonce, serverKeyId, serverSig, setupApiId}
 *           serverSig = the EPHEMERAL setup key over authServerPreimage(nonce, clientNonce,
 *           endpointPath, {clientApi:'gnomon-setup:v1', features:[]}); the page verifies
 *           it against the fragment key `k` and never stores that key as a kernel pin
 *   auth  {setupToken}                 the one-shot 60 s token (^setup-token)
 *   setup.preflight {}                 → the read-only report
 *   setup.name      {name}             → validated server-side (PRINCIPAL_NAME_PATTERN)
 *   setup.begin     {}                 → provisioning; events setup.presence / setup.state
 *   setup.purge     {gen}              → a leftover generation the SERVER listed
 *   setup.complete  {}                 → finish an interrupted setup (I10: the saved row, 0 prompts)
 *   setup.finish    {}                 → hand-off to the first session
 *
 * The page sends ONLY `name`, a `gen` the server itself listed, and clicks:
 * every params object is checked against an EXACT key set, so a page-supplied
 * row or digest is refused before it reaches the provisioner.
 */
import { canonicalJson, deepFreeze, hex, sha256 } from './internal.js';
import { PRINCIPAL_NAME_PATTERN } from './principal.js';

export const SETUP_API = 'gnomon-setup:v1' as const;
export const SETUP_TOKEN_BYTES = 32;
export const SETUP_TOKEN_TTL_MS = 60_000;
export const SETUP_GEN_PATTERN = /^[a-z0-9]{12}$/;

export const SETUP_METHODS = deepFreeze(['hello', 'auth', 'setup.preflight', 'setup.name', 'setup.begin', 'setup.purge', 'setup.complete', 'setup.finish'] as const);
export type SetupMethod = (typeof SETUP_METHODS)[number];
export const SETUP_EVENTS = deepFreeze(['setup.state', 'setup.presence'] as const);

/** The exact params key set of each post-hello method (no optional keys: anything else is refused). */
export const SETUP_PARAMS: Readonly<Record<Exclude<SetupMethod, 'hello'>, readonly string[]>> = deepFreeze({
  auth: ['setupToken'],
  'setup.preflight': [],
  'setup.name': ['name'],
  'setup.begin': [],
  'setup.purge': ['gen'],
  'setup.complete': [],
  'setup.finish': [],
});

export const SETUP_API_DESCRIPTOR = deepFreeze({
  api: SETUP_API,
  methods: [...SETUP_METHODS],
  params: SETUP_PARAMS,
  events: { 'setup.state': ['phase', 'step'], 'setup.presence': ['n', 'of', 'purpose', 'digest12', 'key?', 'gen?'] },
  tokenBytes: SETUP_TOKEN_BYTES,
  tokenTtlMs: SETUP_TOKEN_TTL_MS,
});

export const SETUP_API_ID: string = `sha256:${hex(sha256(canonicalJson(SETUP_API_DESCRIPTOR)))}`;

/** null when the params are acceptable for the method, else why not. Pure; the kernel's only params gate. */
export function setupParamsProblem(method: string, params: unknown): string | null {
  if (!Object.hasOwn(SETUP_PARAMS, method)) return `not a ${SETUP_API} method`;
  if (typeof params !== 'object' || params === null || Array.isArray(params)) return 'params must be an object';
  const want = SETUP_PARAMS[method as keyof typeof SETUP_PARAMS];
  const keys = Object.keys(params);
  if (keys.length !== want.length || !want.every((k) => keys.includes(k))) return `params must be exactly {${want.join(', ')}}`;
  const p = params as Record<string, unknown>;
  if (method === 'auth' && (typeof p.setupToken !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(p.setupToken))) return 'setupToken must be 32 bytes base64url';
  if (method === 'setup.name' && (typeof p.name !== 'string' || !PRINCIPAL_NAME_PATTERN.test(p.name))) return 'the name must match [a-z0-9][a-z0-9._-]{0,63}';
  if (method === 'setup.purge' && (typeof p.gen !== 'string' || !SETUP_GEN_PATTERN.test(p.gen))) return 'gen must be a generation id';
  return null;
}

/** The setup screens' phases (setup.state carries the kernel's view; the GUI renders it). */
export type SetupPhase = 'welcome' | 'preflight' | 'name' | 'identity' | 'success' | 'handoff' | 'aborted';
