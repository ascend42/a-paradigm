// #workshop-mod model (spec §11.6, G-WSP-01): a pure reducer over the host's
// kernel-event feed and a pure render to display-block:v1 (kit:v1 only).
// Every attribute is derived from kernel event fields the host projects
// (session.open{hsid, backend, project}, session.exited, turn.partial,
// turn.result, approval.request{cardId, kind, hsid}, approval.decide,
// approval.expire, warpline.knot{hsid}); nothing here reads model text.

/** Bounds (the feed is kernel-written, but a mod never trusts a count). */
export const MAX_SESSIONS = 256;
export const MAX_CARDS = 256;
export const HUES = 8;
export const WORK_TYPES = Object.freeze(['builder', 'reviewer', 'teacher', 'tender']);
const ID = /^[A-Za-z0-9:._-]{1,128}$/;
const KIND = /^[a-z][a-z0-9-]{0,31}$/;

export function emptyState() {
  return { sessions: new Map(), cards: new Map() };
}

const firstKey = (m) => m.keys().next().value;

/** Apply one projected kernel event; unknown kinds and malformed fields are ignored (fail closed: no cap appears). */
export function apply(state, event) {
  if (!event || typeof event !== 'object' || typeof event.kind !== 'string') return state;
  const p = event.payload && typeof event.payload === 'object' ? event.payload : {};
  const hsid = typeof p.hsid === 'string' && ID.test(p.hsid) ? p.hsid : null;
  switch (event.kind) {
    case 'session.open': {
      if (!hsid) break;
      if (!state.sessions.has(hsid) && state.sessions.size >= MAX_SESSIONS) state.sessions.delete(firstKey(state.sessions));
      state.sessions.set(hsid, {
        backend: p.backend === 'local' ? 'local' : 'claude',
        project: Number.isInteger(p.project) && p.project >= 0 && p.project < HUES ? p.project : 0,
        work: WORK_TYPES.includes(p.work) ? p.work : 'builder',
        streaming: false,
        knot: false,
      });
      break;
    }
    case 'session.exited':
      if (hsid) state.sessions.delete(hsid);
      for (const [id, c] of state.cards) if (hsid && c.hsid === hsid) state.cards.delete(id);
      break;
    case 'turn.partial': {
      const s = hsid && state.sessions.get(hsid);
      if (s) s.streaming = true;
      break;
    }
    case 'turn.result': {
      const s = hsid && state.sessions.get(hsid);
      if (s) s.streaming = false;
      break;
    }
    case 'warpline.knot': {
      const s = hsid && state.sessions.get(hsid);
      if (s) s.knot = true;
      break;
    }
    case 'approval.request': {
      const id = typeof p.cardId === 'string' && ID.test(p.cardId) ? p.cardId : null;
      if (!id) break;
      if (!state.cards.has(id) && state.cards.size >= MAX_CARDS) state.cards.delete(firstKey(state.cards));
      state.cards.set(id, { kind: typeof p.kind === 'string' && KIND.test(p.kind) ? p.kind : 'card', hsid });
      break;
    }
    case 'approval.decide':
    case 'approval.expire':
      if (typeof p.cardId === 'string') state.cards.delete(p.cardId);
      break;
    default:
      break;
  }
  return state;
}

const HAT = { builder: '▲', reviewer: '◆', teacher: '■', tender: '●' };

/** render(state, prefs) → display-block:v1. Hat shape = work type; filled = Claude, outlined = local; hue = project; violet only for KNOT. */
export function render(state, prefs = {}) {
  const reduced = prefs.motion === 'reduced';
  const needs = [...state.cards.values()];
  const working = [...state.sessions.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const cap = (s) => {
    const hat = HAT[s.work] ?? HAT.builder;
    const fill = s.backend === 'local' ? 'outlined' : 'filled';
    const tone = s.knot ? 'violet' : `hue-${s.project}`;
    const pose = s.streaming ? (reduced ? 'working' : 'bob') : 'still';
    return { type: 'Text', text: `${hat} ${s.work} ${fill} ${pose}`, tone };
  };
  return {
    schemaVersion: 'display-block:v1',
    type: 'Box',
    title: 'Workshop',
    direction: 'column',
    children: [
      {
        type: 'Box',
        title: `needs you ${needs.length} of ${needs.length}`,
        children: needs.length ? needs.map((c) => ({ type: 'Text', text: `▲ ${c.kind}`, tone: 'cap' })) : [{ type: 'Text', text: 'nothing waiting', tone: 'quiet' }],
      },
      {
        type: 'Box',
        title: `working ${working.filter(([, s]) => s.streaming).length} of ${working.length}`,
        children: working.length ? working.map(([, s]) => cap(s)) : [{ type: 'Text', text: 'no sessions', tone: 'quiet' }],
      },
    ],
  };
}
