/**
 * @symbol #contract-content-palette
 *
 * `content-palette:v1`: the colours a person or an agent may draw with inside a dimension (S1.2; Luna's S1.1
 * design, `.atelier/systems/gnomon/design-system.yaml` `content_palette`; Aegis rulings 1 to 4).
 *
 * Two layers live here and they are kept apart on purpose:
 *  - PROTOCOL (in the client API descriptor): the schema version, the swatch NAMES and the custom token pattern.
 *  - PRESENTATION (not in the descriptor): hex values, the reserved colours, the minimum distance and the night
 *    transform. They are checked by `contentPaletteProblems()` and its test, and a changed value never moves
 *    `clientApiId`.
 *
 * One behaviour per layer (Aegis ruling 3):
 *  - the write validator and the picker call `contentColourCheck`: a failing colour is refused, never stored,
 *    never stepped towards a passing one;
 *  - the renderer calls `resolveContentColour`, which is total and never trusts a stored row: a token that fails
 *    the CURRENT check draws as ink (line role) or as no fill (fill role). The row is never rewritten.
 *
 * The metric is the Euclidean distance in OKLab. This file holds the ONLY implementation in the repo (a test
 * asserts no second copy of the matrices exists): sRGB is linearised from a literal 256-entry table, Lab is
 * quantised to integers (`LAB_QUANTUM` steps per unit) and every threshold compare is an integer compare.
 *
 * Pure functions, no DOM, no node:*; this file is bundled into a mod later.
 */
import { deepFreeze } from './internal.js';

export const CONTENT_PALETTE_V1 = 'content-palette:v1' as const;
export const CONTENT_ROLES = ['line', 'fill'] as const;
export type ContentRole = (typeof CONTENT_ROLES)[number];
export const CONTENT_THEMES = ['day', 'night'] as const;
export type ContentTheme = (typeof CONTENT_THEMES)[number];

export const CONTENT_SWATCH_NAME_PATTERN = /^[a-z][a-z0-9-]{0,23}$/;
/** `custom:#rrggbb`: the DAY value, upper or lower case, six digits, no alpha. */
export const CUSTOM_COLOUR_PATTERN = /^custom:#[0-9A-Fa-f]{6}$/;
const HEX_PATTERN = /^#[0-9A-Fa-f]{6}$/;

/* ── presentation data (NOT descriptor inputs) ────────────────────────────── */

/** The theme tokens the palette reads (copied from `foundations.color`; the palette test compares them). */
export const CONTENT_THEME_TOKENS = deepFreeze({
  day: { 'text.primary': '#16150F', 'text.secondary': '#5A5850', 'surface.sheet': '#F8F5EE', 'line.key-edge': '#2A2925' },
  night: { 'text.primary': '#E8F4F0', 'text.secondary': '#86998F', 'surface.sheet': '#171A21', 'line.key-edge': '#C9DCD6' },
} as const);
export type ContentThemeToken = keyof (typeof CONTENT_THEME_TOKENS)['day'];

/** Neutrals are theme tokens, not new values. Each has ONE role. */
export const CONTENT_NEUTRALS: Readonly<Record<string, { readonly role: ContentRole; readonly token: ContentThemeToken }>> = deepFreeze({
  ink: { role: 'line', token: 'text.primary' },
  graphite: { role: 'line', token: 'text.secondary' },
  paper: { role: 'fill', token: 'surface.sheet' },
});

export interface ContentSwatch {
  name: string;
  /** stored truth, per role; a missing role means the swatch cannot be used in it */
  day: { line?: string; fill?: string };
  /** the night transform of `day`, by role; printed so the transform can be tested */
  night: { line?: string; fill?: string };
}

export const CONTENT_SWATCHES: readonly ContentSwatch[] = deepFreeze([
  { name: 'lemon', day: { fill: '#F3F287' }, night: { fill: '#373500' } },
  { name: 'leaf', day: { line: '#007835', fill: '#BAF6C5' }, night: { line: '#63C37B', fill: '#194224' } },
  { name: 'sky', day: { line: '#067092', fill: '#C0EDFF' }, night: { line: '#5EB4D9', fill: '#133E4C' } },
  { name: 'cobalt', day: { line: '#1957BB', fill: '#CDDFFE' }, night: { line: '#83B2FE', fill: '#2F3D56' } },
  { name: 'orchid', day: { line: '#8E389B', fill: '#F4D4FE' }, night: { line: '#D789E2', fill: '#492F51' } },
  { name: 'raspberry', day: { line: '#B62268', fill: '#FFD9E2' }, night: { line: '#EE79A4', fill: '#4B2E36' } },
]);

/** Every storable name, neutrals first. THIS list (names only) is what the client API descriptor carries. */
export const CONTENT_SWATCH_NAMES: readonly string[] = Object.freeze([...Object.keys(CONTENT_NEUTRALS), ...CONTENT_SWATCHES.map((s) => s.name)]);

export const CONTENT_DEFAULTS = deepFreeze({ line: 'ink', stickyFill: 'lemon' } as const);

/** Mineral and semantic colours: never content colours. Copied from `foundations.color`; the test compares. */
export const CONTENT_RESERVED_COLOURS: Readonly<Record<ContentTheme, Readonly<Record<string, string>>>> = deepFreeze({
  day: {
    'terracotta.fill': '#C08A73', 'terracotta.ink': '#8E4E38', 'sage.fill': '#9DAF8C', 'sage.ink': '#56663F',
    'slate.fill': '#8C9DBB', 'slate.ink': '#44577C', 'ochre.fill': '#D2B074', 'ochre.ink': '#7A5A1C',
    'rose-clay.fill': '#C9949A', 'rose-clay.ink': '#874B54', 'sea-grey.fill': '#8FB0AE', 'sea-grey.ink': '#3F6664',
    'state.fail': '#B4382A', 'state.warn-ink': '#6E4700', 'state.warn-edge': '#A8730C', 'state.warn-bg': '#F6E3B8', 'state.knot': '#5B4FD6',
  },
  night: {
    terracotta: '#E6A88F', sage: '#B7CCA3', slate: '#A9B9DB', ochre: '#E8C88C', 'rose-clay': '#E4AEB4', 'sea-grey': '#A8CFCB',
    'state.fail': '#FF7A66', 'state.warn-ink': '#FFC15A', 'state.knot': '#A79CFF',
  },
});
/**
 * The ONE foundations colour left out of the reserved list (Aegis ruling 2): night `state.warn-bg` is a 10%
 * amber wash, so it has no single value; over the ground and the sheet it composites to near-neutral darks.
 * It is told by its amber edge and text, which ARE reserved. The palette test computes the composites.
 */
export const CONTENT_RESERVED_EXCEPTIONS: readonly string[] = Object.freeze(['night:state.warn-bg']);

/** A fill is tested against these of each theme, with NO neutral exemption (Aegis ruling 1). */
export const CONTENT_FILL_GUARD_TOKENS: readonly ContentThemeToken[] = Object.freeze(['text.primary', 'line.key-edge'] as const);

/** Minimum OKLab distance from any reserved colour. */
export const CONTENT_MIN_DISTANCE = 0.06;
/** A colour with OKLCH chroma under this is a neutral. Exempt from the distance rule as a LINE only. */
export const CONTENT_NEUTRAL_CHROMA = 0.02;
/** An agent mark's dashed edge needs at least this WCAG ratio against its own fill (checked where it is drawn). */
export const CONTENT_EDGE_ON_FILL_MIN_RATIO = 3;

/** The fixed night transform, by role: L' = clamp(lFrom − L, lMin, lMax), C' = min(C, cMax), hue kept. */
export const NIGHT_TRANSFORM = deepFreeze({
  line: { lFrom: 1.24, lMin: 0.7, lMax: 0.88, cMax: 0.15 },
  fill: { lFrom: 1.26, lMin: 0.3, lMax: 0.42, cMax: 0.07 },
  gamut: { cStep: 0.002, tolerance: 0.0005 },
} as const);

/* ── OKLab: the one implementation ────────────────────────────────────────── */

/** Lab is quantised to this many integer steps per unit before any compare. */
export const LAB_QUANTUM = 10000;
const MIN_DISTANCE_Q = Math.round(CONTENT_MIN_DISTANCE * LAB_QUANTUM);
const MIN_DISTANCE_Q_SQ = MIN_DISTANCE_Q * MIN_DISTANCE_Q;
const NEUTRAL_CHROMA_Q = Math.round(CONTENT_NEUTRAL_CHROMA * LAB_QUANTUM);
const NEUTRAL_CHROMA_Q_SQ = NEUTRAL_CHROMA_Q * NEUTRAL_CHROMA_Q;

/** sRGB 8-bit channel → linear light, as a literal table so every engine reads the same doubles. */
// prettier-ignore
export const SRGB_LINEAR: readonly number[] = Object.freeze([
  0, 0.0003035269835488375, 0.000607053967097675, 0.0009105809506465125,
  0.00121410793419535, 0.0015176349177441874, 0.001821161901293025, 0.0021246888848418626,
  0.0024282158683907, 0.0027317428519395373, 0.003035269835488375, 0.003346535763899161,
  0.003676507324047436, 0.004024717018496307, 0.004391442037410293, 0.004776953480693729,
  0.005181516702338386, 0.005605391624202723, 0.006048833022857054, 0.006512090792594475,
  0.006995410187265387, 0.007499032043226175, 0.008023192985384994, 0.008568125618069307,
  0.009134058702220787, 0.00972121732023785, 0.010329823029626936, 0.010960094006488246,
  0.011612245179743885, 0.012286488356915872, 0.012983032342173012, 0.013702083047289686,
  0.014443843596092545, 0.01520851442291271, 0.01599629336550963, 0.016807375752887384,
  0.017641954488384078, 0.018500220128379697, 0.019382360956935723, 0.0202885630566524,
  0.021219010376003555, 0.02217388479338738, 0.02315336617811041, 0.024157632448504756,
  0.02518685962736163, 0.026241221894849898, 0.027320891639074894, 0.028426039504420793,
  0.0295568344378088, 0.030713443732993635, 0.03189603307301153, 0.033104766570885055,
  0.03433980680868217, 0.03560131487502034, 0.03688945040110004, 0.0382043715953465,
  0.03954623527673284, 0.04091519690685319, 0.042311410620809675, 0.043735029256973465,
  0.04518620438567554, 0.046665086336880095, 0.04817182422688942, 0.04970656598412723,
  0.05126945837404324, 0.052860647023180246, 0.05448027644244237, 0.05612849004960009,
  0.05780543019106723, 0.0595112381629812, 0.06124605423161761, 0.06301001765316767,
  0.06480326669290577, 0.06662593864377289, 0.06847816984440017, 0.07036009569659588,
  0.07227185068231748, 0.07421356838014963, 0.07618538148130785, 0.07818742180518633,
  0.08021982031446832, 0.0822827071298148, 0.08437621154414882, 0.08650046203654976,
  0.08865558628577294, 0.09084171118340768, 0.09305896284668745, 0.0953074666309647,
  0.09758734714186246, 0.09989872824711389, 0.10224173308810132, 0.10461648409110419,
  0.10702310297826761, 0.10946171077829933, 0.1119324278369056, 0.11443537382697373,
  0.11697066775851084, 0.11953842798834562, 0.12213877222960187, 0.12477181756095049,
  0.12743768043564743, 0.1301364766903643, 0.13286832155381798, 0.13563332965520566,
  0.13843161503245183, 0.14126329114027164, 0.14412847085805777, 0.14702726649759498,
  0.14995978981060856, 0.15292615199615017, 0.1559264637078274, 0.1589608350608804,
  0.162029375639111, 0.1651321945016676, 0.16826940018969075, 0.1714411007328226,
  0.17464740365558504, 0.17788841598362912, 0.18116424424986022, 0.184474994500441,
  0.18782077230067787, 0.19120168274079138, 0.1946178304415758, 0.19806931955994886,
  0.20155625379439707, 0.20507873639031693, 0.20863687014525575, 0.21223075741405523,
  0.21586050011389926, 0.2195261997292692, 0.2232279573168085, 0.22696587351009836,
  0.23074004852434915, 0.23455058216100522, 0.238397573812271, 0.24228112246555486,
  0.24620132670783548, 0.25015828472995344, 0.25415209433082675, 0.2581828529215958,
  0.26225065752969623, 0.26635560480286247, 0.2704977910130658, 0.27467731206038465,
  0.2788942634768104, 0.2831487404299921, 0.2874408377269175, 0.29177064981753587,
  0.2961382707983211, 0.3005437944157765, 0.3049873140698863, 0.30946892281750854,
  0.31398871337571754, 0.31854677812509186, 0.32314320911295075, 0.3277780980565422,
  0.33245153634617935, 0.33716361504833037, 0.3419144249086609, 0.3467040563550296,
  0.35153259950043936, 0.3564001441459435, 0.3613067797835095, 0.3662525955988395,
  0.3712376804741491, 0.3762621229909065, 0.38132601143253014, 0.386429433787049,
  0.39157247774972326, 0.39675523072562685, 0.4019777798321958, 0.4072402119017367,
  0.41254261348390375, 0.4178850708481375, 0.4232676699860717, 0.4286904966139066,
  0.43415363617474895, 0.4396571738409188, 0.44520119451622786, 0.45078578283822346,
  0.45641102318040466, 0.4620769996544071, 0.467783796112159, 0.47353149614800955,
  0.4793201831008268, 0.4851499400560704, 0.4910208498478356, 0.4969329950608704,
  0.5028864580325687, 0.5088813208549338, 0.5149176653765214, 0.5209955732043543,
  0.5271151257058131, 0.5332764040105052, 0.5394794890121072, 0.5457244613701866,
  0.5520114015120001, 0.5583403896342679, 0.5647115057049292, 0.5711248294648731,
  0.5775804404296506, 0.5840784178911641, 0.5906188409193369, 0.5972017883637634,
  0.6038273388553378, 0.6104955708078648, 0.6172065624196511, 0.6239603916750761,
  0.6307571363461468, 0.6375968739940326, 0.6444796819705821, 0.6514056374198242,
  0.6583748172794485, 0.665387298282272, 0.6724431569576875, 0.6795424696330938,
  0.6866853124353135, 0.6938717612919899, 0.7011018919329731, 0.7083757798916868,
  0.7156935005064807, 0.7230551289219693, 0.7304607400903537, 0.7379104087727308,
  0.7454042095403874, 0.7529422167760779, 0.7605245046752924, 0.768151147247507,
  0.7758222183174236, 0.7835377915261935, 0.7912979403326302, 0.799102738014409,
  0.8069522576692516, 0.8148465722161012, 0.8227857543962835, 0.8307698767746546,
  0.83879901174074, 0.846873231509858, 0.8549926081242338, 0.8631572134541023,
  0.8713671191987972, 0.8796223968878317, 0.8879231178819663, 0.8962693533742664,
  0.9046611743911496, 0.9130986517934192, 0.9215818562772946, 0.9301108583754237,
  0.938685728457888, 0.9473065367331999, 0.9559733532492861, 0.9646862478944651,
  0.9734452903984125, 0.9822505503331171, 0.9911020971138298, 1,
]);

type Triple = [number, number, number];

function rgbOf(hex: string): Triple | null {
  if (typeof hex !== 'string' || !HEX_PATTERN.test(hex)) return null;
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Ottosson 2020, linear sRGB → OKLab. */
function linearToLab(r: number, g: number, b: number): Triple {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** Ottosson 2020, OKLab → linear sRGB. */
function labToLinear(L: number, a: number, b: number): Triple {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

function labOf(rgb: Triple): Triple {
  return linearToLab(SRGB_LINEAR[rgb[0]]!, SRGB_LINEAR[rgb[1]]!, SRGB_LINEAR[rgb[2]]!);
}

/** OKLab of `#rrggbb` as integers (`LAB_QUANTUM` steps per unit); `null` when the hex is malformed. */
export function oklabQ(hex: string): [number, number, number] | null {
  const rgb = rgbOf(hex);
  if (!rgb) return null;
  const lab = labOf(rgb);
  return [Math.round(lab[0] * LAB_QUANTUM), Math.round(lab[1] * LAB_QUANTUM), Math.round(lab[2] * LAB_QUANTUM)];
}

/** Squared OKLab distance in integer quanta; symmetric; `Infinity` when either hex is malformed. */
export function colourDistanceQSq(a: string, b: string): number {
  const p = oklabQ(a);
  const q = oklabQ(b);
  if (!p || !q) return Infinity;
  const dl = p[0] - q[0];
  const da = p[1] - q[1];
  const db = p[2] - q[2];
  return dl * dl + da * da + db * db;
}

/** True when the two colours are at least the palette minimum apart (integer compare). */
export function coloursClear(a: string, b: string): boolean {
  return colourDistanceQSq(a, b) >= MIN_DISTANCE_Q_SQ;
}

/** True when the colour's chroma is under the neutral threshold (integer compare). */
export function isNeutralColour(hex: string): boolean {
  const p = oklabQ(hex);
  return !!p && p[1] * p[1] + p[2] * p[2] < NEUTRAL_CHROMA_Q_SQ;
}

function encodeChannel(v: number): number {
  const c = v <= 0 ? 0 : v >= 1 ? 1 : v;
  const e = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.min(255, Math.max(0, Math.round(e * 255)));
}

function hexOf(rgb: Triple): string {
  return `#${rgb.map((c) => c.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

/**
 * The night value of a day colour, by the role it is used in. Fixed transform: lightness is mirrored and
 * clamped, chroma capped, hue kept; chroma is then lowered a step at a time until the colour is in gamut.
 * A malformed hex returns the night ink (line) or the night sheet (fill): the function is total.
 */
export function nightOf(hex: string, role: ContentRole): string {
  const rgb = rgbOf(hex);
  if (!rgb) return CONTENT_THEME_TOKENS.night[role === 'line' ? 'text.primary' : 'surface.sheet'];
  const t = NIGHT_TRANSFORM[role];
  const [L, a, b] = labOf(rgb);
  const c = Math.sqrt(a * a + b * b);
  const l2 = Math.min(t.lMax, Math.max(t.lMin, t.lFrom - L));
  let c2 = Math.min(c, t.cMax);
  const tol = NIGHT_TRANSFORM.gamut.tolerance;
  for (;;) {
    const k = c > 0 ? c2 / c : 0;
    const lin = labToLinear(l2, a * k, b * k);
    if (c2 <= 0 || lin.every((v) => v >= -tol && v <= 1 + tol)) return hexOf([encodeChannel(lin[0]), encodeChannel(lin[1]), encodeChannel(lin[2])]);
    c2 = Math.max(0, c2 - NIGHT_TRANSFORM.gamut.cStep);
  }
}

/** WCAG 2 contrast ratio of two `#rrggbb` colours (1 to 21); 1 when either is malformed. */
export function contrastRatio(a: string, b: string): number {
  const lum = (hex: string): number | null => {
    const rgb = rgbOf(hex);
    return rgb ? 0.2126 * SRGB_LINEAR[rgb[0]]! + 0.7152 * SRGB_LINEAR[rgb[1]]! + 0.0722 * SRGB_LINEAR[rgb[2]]! : null;
  };
  const x = lum(a);
  const y = lum(b);
  if (x === null || y === null) return 1;
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/* ── the check (validator and picker) ─────────────────────────────────────── */

function clearOfReserved(hex: string, theme: ContentTheme): boolean {
  for (const r of Object.values(CONTENT_RESERVED_COLOURS[theme])) if (!coloursClear(hex, r)) return false;
  return true;
}

function clearOfFillGuards(hex: string, theme: ContentTheme): boolean {
  for (const k of CONTENT_FILL_GUARD_TOKENS) if (!coloursClear(hex, CONTENT_THEME_TOKENS[theme][k])) return false;
  return true;
}

/**
 * Does a custom DAY value pass, in the role it is used in?
 *  - distance rule: the day value is clear of every day reserved colour, and BOTH night transforms of it are
 *    clear of every night reserved colour;
 *  - line role: a neutral passes without the distance rule;
 *  - fill role: no exemption, and the day value and its night fill are also clear of `text.primary` and
 *    `line.key-edge` of their theme.
 */
export function customColourPasses(hex: string, role: ContentRole): boolean {
  if (typeof hex !== 'string' || !HEX_PATTERN.test(hex)) return false;
  if (role === 'line' && isNeutralColour(hex)) return true;
  const nightFill = nightOf(hex, 'fill');
  if (!clearOfReserved(hex, 'day') || !clearOfReserved(nightOf(hex, 'line'), 'night') || !clearOfReserved(nightFill, 'night')) return false;
  if (role === 'fill' && (!clearOfFillGuards(hex, 'day') || !clearOfFillGuards(nightFill, 'night'))) return false;
  return true;
}

/**
 * The named swatch nearest to a day value for a role (by distance on day values). `null` when the value is
 * malformed, or when it is a fill sitting on ink or the key edge (nothing nearby is a fair substitute).
 */
export function nearestSwatch(hex: string, role: ContentRole): string | null {
  if (typeof hex !== 'string' || !HEX_PATTERN.test(hex)) return null;
  if (role === 'fill' && !clearOfFillGuards(hex, 'day')) return null;
  let best: string | null = null;
  let bestD = Infinity;
  for (const s of CONTENT_SWATCHES) {
    const v = s.day[role];
    if (!v) continue;
    const d = colourDistanceQSq(hex, v);
    if (d < bestD) {
      bestD = d;
      best = s.name;
    }
  }
  return best;
}

export type ContentColourCheck = { ok: true } | { ok: false; offer: string | null };

/**
 * THE shared check (write validator and picker). A token is a storable name with that role, or
 * `custom:#rrggbb` whose value passes `customColourPasses`. A failure may offer a named swatch; it never
 * substitutes one.
 */
export function contentColourCheck(token: unknown, role: ContentRole): ContentColourCheck {
  if (typeof token !== 'string') return { ok: false, offer: null };
  const neutral = Object.prototype.hasOwnProperty.call(CONTENT_NEUTRALS, token) ? CONTENT_NEUTRALS[token] : undefined;
  if (neutral) return neutral.role === role ? { ok: true } : { ok: false, offer: null };
  const swatch = CONTENT_SWATCHES.find((s) => s.name === token);
  if (swatch) return swatch.day[role] ? { ok: true } : { ok: false, offer: null };
  if (!CUSTOM_COLOUR_PATTERN.test(token)) return { ok: false, offer: null };
  const hex = token.slice('custom:'.length);
  return customColourPasses(hex, role) ? { ok: true } : { ok: false, offer: nearestSwatch(hex, role) };
}

export function isContentColour(v: unknown, role: ContentRole): v is string {
  return contentColourCheck(v, role).ok;
}

/* ── the resolver (renderer) ──────────────────────────────────────────────── */

/**
 * The colour to paint for a stored token. Total, and it re-runs the CURRENT check: a token that fails it (a
 * reserved value that moved after the row was written, an unknown name, a non-string) resolves to the theme's
 * ink for a line and to `null` (no fill) for a fill. It never steps towards a passing colour.
 */
export function resolveContentColour(token: unknown, role: ContentRole, theme: ContentTheme): string | null {
  const fallback = role === 'line' ? CONTENT_THEME_TOKENS[theme]['text.primary'] : null;
  if (typeof token !== 'string' || !contentColourCheck(token, role).ok) return fallback;
  const neutral = Object.prototype.hasOwnProperty.call(CONTENT_NEUTRALS, token) ? CONTENT_NEUTRALS[token] : undefined;
  if (neutral) return CONTENT_THEME_TOKENS[theme][neutral.token];
  const swatch = CONTENT_SWATCHES.find((s) => s.name === token);
  if (swatch) return swatch[theme][role] ?? fallback;
  const hex = token.slice('custom:'.length).toUpperCase();
  return theme === 'day' ? hex : nightOf(hex, role);
}

/* ── table validation ─────────────────────────────────────────────────────── */

/** `[]` means the presentation tables are valid. Run by the palette test; names only, never throws. */
export function contentPaletteProblems(): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const reservedNames = new Set(CONTENT_THEMES.flatMap((t) => Object.keys(CONTENT_RESERVED_COLOURS[t])));
  for (const name of CONTENT_SWATCH_NAMES) {
    if (!CONTENT_SWATCH_NAME_PATTERN.test(name)) out.push(`name ${name}: pattern`);
    if (seen.has(name)) out.push(`name ${name}: duplicate`);
    if (reservedNames.has(name)) out.push(`name ${name}: equals a reserved colour name`);
    seen.add(name);
  }
  for (const theme of CONTENT_THEMES) {
    for (const [k, v] of Object.entries(CONTENT_RESERVED_COLOURS[theme])) if (!HEX_PATTERN.test(v)) out.push(`reserved ${theme} ${k}: not #rrggbb`);
    for (const [k, v] of Object.entries(CONTENT_THEME_TOKENS[theme])) if (!HEX_PATTERN.test(v)) out.push(`token ${theme} ${k}: not #rrggbb`);
  }
  for (const [name, n] of Object.entries(CONTENT_NEUTRALS)) {
    for (const theme of CONTENT_THEMES) {
      const v = CONTENT_THEME_TOKENS[theme][n.token];
      // day values are the stored truth; a night token is exempt by NAME (night graphite measures over the threshold)
      if (theme === 'day' && !isNeutralColour(v)) out.push(`neutral ${name} ${theme}: chroma at or over the neutral threshold`);
      if (n.role === 'fill' && !clearOfFillGuards(v, theme)) out.push(`neutral ${name} ${theme}: fill too close to ink or the key edge`);
    }
  }
  for (const s of CONTENT_SWATCHES) {
    if (!s.day.line && !s.day.fill) out.push(`swatch ${s.name}: no role`);
    for (const role of CONTENT_ROLES) {
      const day = s.day[role];
      const night = s.night[role];
      if ((day === undefined) !== (night === undefined)) out.push(`swatch ${s.name} ${role}: day and night roles differ`);
      if (day === undefined || night === undefined) continue;
      if (!HEX_PATTERN.test(day) || !HEX_PATTERN.test(night)) {
        out.push(`swatch ${s.name} ${role}: not #rrggbb`);
        continue;
      }
      if (nightOf(day, role) !== night.toUpperCase()) out.push(`swatch ${s.name} ${role}: night value is not the transform of the day value`);
      if (!clearOfReserved(day, 'day')) out.push(`swatch ${s.name} ${role} day: too close to a reserved colour`);
      if (!clearOfReserved(night, 'night')) out.push(`swatch ${s.name} ${role} night: too close to a reserved colour`);
      if (role === 'fill' && (!clearOfFillGuards(day, 'day') || !clearOfFillGuards(night, 'night'))) out.push(`swatch ${s.name} fill: too close to ink or the key edge`);
    }
  }
  return out;
}
