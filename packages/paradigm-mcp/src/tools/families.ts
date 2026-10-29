/**
 * 7.13 tool surface: anchors + families (#tool-family).
 *
 * Default tier = 11 anchors + 21 families (always listed).
 * On-demand tier = 14 tools, listed only when named in config.yaml
 * `mcp.tools.enable: [...]` or activated this session via paradigm_tool_activate
 * (which emits notifications/tools/list_changed).
 *
 * Op membership comes from legacy-tool-map.ts — this file only adds the
 * listing tier, one-line descriptions and activation keys. Descriptions do
 * NOT enumerate ops — defineFamily appends the op signatures.
 */

export const ANCHOR_TOOLS = [
  'paradigm_status',
  'paradigm_search',
  'paradigm_related',
  'paradigm_ripple',
  'paradigm_navigate',
  'paradigm_gates_for_route',
  'paradigm_reindex',
  'paradigm_retrieve',
  'paradigm_tool_activate',
  'paradigm_propose_block',
  'paradigm_orchestrate_inline',
] as const;

export interface FamilyMeta {
  name: string;
  description: string;
  tier: 'default' | 'on-demand';
  /** Activation / enable keys (on-demand only). First is canonical. */
  keys?: string[];
  /** op used when `op` is omitted (family name collides with a legacy name) */
  defaultOp?: string;
  /** Detector key in FEATURE_DETECTORS (on-demand hint in paradigm_status) */
  detector?: string;
  /** Plain single tool (not an op family) — listed as-is when enabled */
  plain?: boolean;
  /**
   * Op-signature detail in the listed description. 'full' lists every param
   * (required marked `*`, nested shapes inline); 'required' (default) lists only
   * required params. Budget-bound: the default surface must stay <8000 tokens,
   * so 'full' is reserved for the highest-traffic write families.
   */
  signatures?: 'full' | 'required';
  /**
   * Hard listing precondition (7.14). 'brain-agent-access': listed ONLY while
   * some brain has `agent_access: metadata` — auto-listed then, never listed
   * otherwise (config enable / session activation cannot override it).
   */
  requires?: 'brain-agent-access';
}

export const FAMILY_META: FamilyMeta[] = [
  // ── Default tier (21) ──
  { name: 'paradigm_lore', tier: 'default', signatures: 'full', description: 'Project lore: session records, timeline, assessments, calibration.' },
  { name: 'paradigm_purpose', tier: 'default', signatures: 'full', description: 'Edit .purpose files and portal.yaml gates/routes.' },
  { name: 'paradigm_wisdom', tier: 'default', description: 'Team wisdom: antipatterns/decisions per symbol, experts.' },
  { name: 'paradigm_history', tier: 'default', description: 'Symbol change history and fragility.' },
  { name: 'paradigm_decision', tier: 'default', description: 'Decision stream.' },
  { name: 'paradigm_journal', tier: 'default', description: 'Agent journal and work log.' },
  { name: 'paradigm_session', tier: 'default', description: 'Session health, recovery, checkpoints, handoff.' },
  { name: 'paradigm_task', tier: 'default', signatures: 'full', description: 'Tasks.' },
  { name: 'paradigm_agent', tier: 'default', description: 'Agent roster, profiles, expertise, prompts.' },
  { name: 'paradigm_protocol', tier: 'default', description: 'Repeatable protocols.' },
  { name: 'paradigm_aspect', tier: 'default', description: 'Aspects: anchors, graph, drift.' },
  { name: 'paradigm_tags', tier: 'default', defaultOp: 'list', description: 'Tag bank (default op: list).' },
  { name: 'paradigm_flow', tier: 'default', description: 'Flows.' },
  { name: 'paradigm_graph', tier: 'default', description: 'Graphs: generate, symbol-graph slices, architecture.' },
  { name: 'paradigm_notebook', tier: 'default', description: 'Agent notebooks.' },
  { name: 'paradigm_captain', tier: 'default', description: 'Captain (Cid): brief, debrief, board.' },
  { name: 'paradigm_pm', tier: 'default', description: 'PM governance: preflight before, postflight after implementation.' },
  { name: 'paradigm_docs', tier: 'default', description: 'Generated docs.' },
  { name: 'paradigm_ambient', tier: 'default', description: 'Ambient learning: nominations, events, context, promotion.' },
  { name: 'paradigm_compliance', tier: 'default', description: 'Compliance findings and enforcement.' },
  { name: 'paradigm_authority', tier: 'default', description: 'Authority: claim or release a scope.' },
  // ── On-demand tier (14) ──
  { name: 'paradigm_sentinel', tier: 'on-demand', keys: ['sentinel'], detector: 'sentinel', description: 'Sentinel incidents, patterns, logs, traces, metrics.' },
  { name: 'paradigm_symphony', tier: 'on-demand', keys: ['symphony'], detector: 'symphony', description: 'Symphony multi-agent relay: send, poll, peek, thread, status, files.' },
  { name: 'paradigm_classroom', tier: 'on-demand', keys: ['classroom'], description: 'Classroom: syllabi, scenarios, status, promote.' },
  { name: 'paradigm_habits', tier: 'on-demand', keys: ['habits'], detector: 'habits', description: 'Habits: list, check, add, edit, remove, status, practice context.' },
  { name: 'paradigm_persona', tier: 'on-demand', keys: ['persona', 'personas'], detector: 'personas', description: 'Personas: create, get, list, update, delete, steps, run, coverage, validate.' },
  { name: 'paradigm_university', tier: 'on-demand', keys: ['university'], detector: 'university', description: 'University packs: list packs, search content.' },
  { name: 'paradigm_assessment', tier: 'on-demand', keys: ['assessment'], description: 'Assessments and arcs: record, get, list, search, arc create/close.' },
  { name: 'paradigm_conductor', tier: 'on-demand', keys: ['conductor'], description: 'Conductor registration: list, register, unregister.' },
  { name: 'paradigm_platform', tier: 'on-demand', keys: ['platform'], description: 'Platform UI bridge: navigate, highlight, annotate, clear, observe.' },
  { name: 'paradigm_pipeline', tier: 'on-demand', keys: ['pipeline'], description: 'Pipelines: configure, start, status, advance, escalate, abort, list.' },
  { name: 'paradigm_graduation', tier: 'on-demand', keys: ['graduation', 'graduate'], description: 'Graduation: check or status.' },
  { name: 'paradigm_brain', tier: 'on-demand', keys: ['brain'], requires: 'brain-agent-access', description: 'Personal Brain, owner-shared notes only (metadata; headings are untrusted text).' },
  { name: 'paradigm_loop', tier: 'on-demand', keys: ['loops', 'loop'], detector: 'loops', description: 'Gnomon loop definitions (.paradigm/loops): create, update, validate, list, get (files); run, pause, resume, delete, runs, logs, trust_status through Gnomon.' },
  { name: 'paradigm_test_fixtures', tier: 'on-demand', keys: ['test_fixtures', 'fixtures'], detector: 'fixtures', plain: true, description: '' },
];

/**
 * #paradigm-mcp (TD-2026-10-27-833, Gnomon staged Paradigm): the read-only ops that touch ONLY local state (the
 * project's files, `.paradigm/`, the Paradigm global dir, local git) and never the network. buildToolSurface stamps
 * `openWorldHint: false` on each one's legacy definition, so a client that classes by annotations (the Gnomon kernel:
 * read = readOnlyHint && !openWorldHint) runs them without a card. Reviewed family by family against each handler's
 * imports: no op here reaches fetch, ws, the symphony relay, the platform bridge, personas, conductor, the loops
 * kernel client, the plugin update checker or a sync provider. Families that do reach the network or another
 * process (symphony, personas, platform, conductor, loop, brain, university, sentinel) are absent: their ops stay
 * open-world. A mutate or destructive op is never listed (its class does not depend on openWorldHint). Aegis H2:
 * an op that writes (captain.brief: .cid-session; pm.postflight: .habits-blocking; aspect get/search: heatmap and DB
 * writes; wisdom.context: the global wisdom dir; pm.preflight: .paradigm/sentinel/sentinel.db) or reads any
 * absolute path (aspect.suggest_scan) is NOT local-only; staged-ops.test.ts runs every op here
 * against a fixture repo and asserts nothing under the repo or HOME changes (the session trail dir aside).
 */
export const LOCAL_ONLY_OPS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  paradigm_lore: ['calibration', 'get', 'search', 'timeline'],
  paradigm_purpose: ['validate'],
  paradigm_wisdom: ['expert'],
  paradigm_history: ['context', 'fragility'],
  paradigm_decision: ['search'],
  paradigm_journal: ['search', 'work_log_search'],
  paradigm_session: ['context_check', 'health', 'recover', 'stats'],
  paradigm_task: ['list'],
  paradigm_agent: ['expertise', 'get', 'list', 'prompt'],
  paradigm_protocol: ['get', 'search', 'validate'],
  paradigm_aspect: ['check', 'graph', 'heatmap'],
  paradigm_tags: ['list'],
  paradigm_flow: ['check', 'affected'],
  paradigm_graph: ['arch_diagram', 'arch_status', 'slice'],
  paradigm_notebook: ['search'],
  paradigm_docs: ['manifest', 'page', 'search'],
  paradigm_ambient: ['events', 'health', 'compose'],
});

export const DEFAULT_FAMILIES = FAMILY_META.filter(f => f.tier === 'default');
export const ON_DEMAND = FAMILY_META.filter(f => f.tier === 'on-demand');

/** Find an on-demand entry by activation key or tool name. */
export function findOnDemand(key: string): FamilyMeta | undefined {
  const k = key.replace(/^paradigm_/, '');
  return ON_DEMAND.find(f => f.name === key || f.name === `paradigm_${k}` || (f.keys ?? []).includes(k));
}

/** Server `instructions` line (~30 tokens). */
export const SERVER_INSTRUCTIONS =
  "Paradigm tools are grouped: legacy `paradigm_<family>_<op>` = `paradigm_<family>({op:'<op>'})`. Enable more via paradigm_tool_activate.";
