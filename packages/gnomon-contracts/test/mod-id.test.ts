import { describe, expect, it } from 'vitest';
import {
  canonicalGitUrl,
  CLIENT_API_DESCRIPTOR,
  formatModId,
  gitOwnerOf,
  gitSourceString,
  isModId,
  MCP_SERVER_NAME_MAX,
  mcpServerName,
  MOD_ID_MAX,
  MOD_ID_PATTERN,
  MOD_NAME_PATTERN,
  MOD_REFUSAL_CODES,
  modEnvPrefix,
  modEventPrefix,
  modIdHash10,
  modPrincipalLabel,
  modSkeleton,
  OFFER_MOD_PATTERN,
  OFFER_SPEC_V1_SCHEMA,
  OFFER_TOOL_PATTERN,
  parseGitSource,
  parseModId,
  PUBLISHER_PATTERN,
  qualifiedToolName,
  QUALIFIED_TOOL_NAME_MAX,
  WINDOWS_DEVICE_NAMES,
} from '../src/index.js';

describe('mod id grammar (S0b §1)', () => {
  it('the segment patterns are ASCII only: no u flag, no Unicode class', () => {
    for (const re of [PUBLISHER_PATTERN, MOD_NAME_PATTERN, MOD_ID_PATTERN]) {
      expect(re.flags).toBe('');
      expect(re.source).not.toMatch(/\\p\{|\\u/);
    }
    expect(OFFER_MOD_PATTERN).toBe(MOD_ID_PATTERN);
    // a Unicode lookalike (Cyrillic а) never matches
    expect(isModId('gnomon.аcme')).toBe(false);
  });

  it('publisher 1..39, name 1..24, no leading/trailing/double hyphen, name starts with a letter', () => {
    expect(PUBLISHER_PATTERN.test('a')).toBe(true);
    expect(PUBLISHER_PATTERN.test('9')).toBe(true);
    expect(PUBLISHER_PATTERN.test('a'.repeat(39))).toBe(true);
    expect(PUBLISHER_PATTERN.test('a'.repeat(40))).toBe(false);
    for (const bad of ['-a', 'a-', 'a--b', 'A', 'a_b', 'a.b', '']) expect(PUBLISHER_PATTERN.test(bad)).toBe(false);
    expect(MOD_NAME_PATTERN.test('a'.repeat(24))).toBe(true);
    expect(MOD_NAME_PATTERN.test('a'.repeat(25))).toBe(false);
    for (const bad of ['1a', '-a', 'a-', 'a--b', 'a.b']) expect(MOD_NAME_PATTERN.test(bad)).toBe(false);
  });

  it('the 60-character total is checked separately from the segment regexes (39+1+24 = 64)', () => {
    const at60 = `${'p'.repeat(35)}.${'n'.repeat(24)}`;
    const at61 = `${'p'.repeat(36)}.${'n'.repeat(24)}`;
    const at64 = `${'p'.repeat(39)}.${'n'.repeat(24)}`;
    expect(at60.length).toBe(MOD_ID_MAX);
    expect(isModId(at60)).toBe(true);
    expect(MOD_ID_PATTERN.test(at61)).toBe(true); // the regex alone admits it
    expect(isModId(at61)).toBe(false);
    expect(isModId(at64)).toBe(false);
    expect(() => formatModId('p'.repeat(36), 'n'.repeat(24))).toThrow(TypeError);
  });

  it('parse/format round-trip', () => {
    expect(parseModId('gnomon.neurons')).toEqual({ publisher: 'gnomon', name: 'neurons' });
    expect(parseModId('neurons')).toBeNull();
    expect(parseModId('a.b.c')).toBeNull();
    expect(formatModId('acme', 'board')).toBe('acme.board');
  });

  it('Windows device names cover con/prn/aux/nul and com0-9/lpt0-9', () => {
    for (const n of ['con', 'prn', 'aux', 'nul', 'com0', 'com9', 'lpt0', 'lpt9']) expect(WINDOWS_DEVICE_NAMES).toContain(n);
    expect(WINDOWS_DEVICE_NAMES.length).toBe(24);
  });

  it('the skeleton is the fixed transform', () => {
    expect(modSkeleton('Gn0mon')).toBe('gnomon');
    expect(modSkeleton('a-company')).toBe('acompany');
    expect(modSkeleton('c1aude')).toBe('daude');
    expect(modSkeleton('claude')).toBe('daude');
    expect(modSkeleton('anthr0pic')).toBe(modSkeleton('anthropic'));
    expect(modSkeleton('rnod')).toBe('mod');
    expect(modSkeleton('vvorkshop')).toBe('workshop');
    expect(modSkeleton('5y5tem')).toBe(modSkeleton('system'));
    expect(modSkeleton('ledger')).toBe('ledger');
  });
});

describe('derived names (S0b §2)', () => {
  it('server name: gm_<publisher>_<name> when ≤ 28, else gx_<name[0..13]>_<hash10>; - never becomes _', () => {
    expect(mcpServerName('gnomon.neurons')).toBe('gm_gnomon_neurons');
    expect(mcpServerName('gnomon.paradigm-context')).toBe('gm_gnomon_paradigm-context');
    const at28 = `${'p'.repeat(10)}.${'n'.repeat(12)}`; // gm_ + 10 + _ + 12 = 26
    expect(mcpServerName(at28).startsWith('gm_')).toBe(true);
    const long = 'some-publisher.a-rather-long-mod-name';
    const s = mcpServerName(long);
    expect(s).toBe(`gx_a-rather-long_${modIdHash10(long)}`);
    expect(s.length).toBeLessThanOrEqual(MCP_SERVER_NAME_MAX);
    expect(modIdHash10(long)).toMatch(/^[a-z2-7]{10}$/);
    // boundary: exactly 28 stays gm_, 29 falls back
    const exactly28 = `${'p'.repeat(12)}.${'n'.repeat(11)}`; // 3 + 12 + 1 + 11 = 27
    expect(mcpServerName(exactly28)).toBe(`gm_${'p'.repeat(12)}_${'n'.repeat(11)}`);
    const id28 = `${'p'.repeat(12)}.${'n'.repeat(12)}`; // 28
    expect(mcpServerName(id28)).toBe(`gm_${'p'.repeat(12)}_${'n'.repeat(12)}`);
    const id29 = `${'p'.repeat(13)}.${'n'.repeat(12)}`; // 29
    expect(mcpServerName(id29).startsWith('gx_')).toBe(true);
    // two ids that would collide if - became _ stay distinct
    expect(mcpServerName('a.b-c')).not.toBe(mcpServerName('a-b.c'));
    expect(() => mcpServerName('nope')).toThrow(TypeError);
  });

  it('the qualified tool name budget is 64 for the whole mcp__<server>__<tool>', () => {
    expect(QUALIFIED_TOOL_NAME_MAX).toBe(64);
    expect(qualifiedToolName('gnomon.neurons', 'neuron_search')).toBe('mcp__gm_gnomon_neurons__neuron_search');
    const t = 'x'.repeat(64 - 'mcp__gm_gnomon_neurons__'.length);
    expect(qualifiedToolName('gnomon.neurons', t).length).toBe(64);
    expect(OFFER_TOOL_PATTERN.test('neuron_search')).toBe(true);
    for (const bad of ['a.b', 'a:b', 'a b', '1a', 'x'.repeat(65)]) expect(OFFER_TOOL_PATTERN.test(bad)).toBe(false);
  });

  it('env own-prefix: <PUB>__<NAME>__ (double underscore), first-party <NAME>__', () => {
    expect(modEnvPrefix('acme-co.my-board')).toBe('ACME_CO__MY_BOARD__');
    expect(modEnvPrefix('gnomon.neurons')).toBe('NEURONS__');
    // a hyphenated publisher cannot forge another publisher's prefix: segments never have -- so never __
    expect(modEnvPrefix('a-b.c')).not.toBe(modEnvPrefix('a.b-c'));
    expect(modEnvPrefix('a-b.c')).toBe('A_B__C__');
    expect(modEnvPrefix('a.b-c')).toBe('A__B_C__');
  });

  it('event prefix and principal label', () => {
    expect(modEventPrefix('gnomon.workshop')).toBe('modns.gnomon.workshop.');
    expect(modPrincipalLabel('acme.board')).toBe('mod-acme.board');
  });
});

describe('git sources (S0b §3)', () => {
  it('canonical form: lowercase host, no userinfo/port/query/fragment/percent/dot segments, .git and / dropped', () => {
    expect(canonicalGitUrl('https://GitHub.com/Acme/Board.git')).toEqual({ url: 'https://github.com/Acme/Board', host: 'github.com', namespace: 'acme', repo: 'Board', owner: 'acme' });
    expect(canonicalGitUrl('https://gitlab.com/Group/Sub/repo/')).toEqual({ url: 'https://gitlab.com/Group/Sub/repo', host: 'gitlab.com', namespace: 'group/sub', repo: 'repo' });
    for (const bad of ['http://github.com/a/b', 'https://u@github.com/a/b', 'https://github.com:443/a/b', 'https://github.com/a/b?x=1', 'https://github.com/a/b#x', 'https://github.com/a%2fb/c', 'https://github.com/a/../b', 'https://github.com/a/./b', 'https://github.com/a', 'https://github.com//a/b', 'git@github.com:a/b']) {
      expect(canonicalGitUrl(bad)).toBeNull();
    }
    // Aegis S0b M5: GitHub look-alike hosts, IP literals and single-label hosts are refused
    for (const bad of ['https://gist.github.com/a/b', 'https://www.github.com/a/b', 'https://raw.githubusercontent.com/a/b', 'https://githubusercontent.com/a/b', 'https://127.0.0.1/a/b', 'https://10.0.0.7/a/b', 'https://localhost/a/b', 'https://gitserver/a/b', 'https://host.123/a/b']) {
      expect(canonicalGitUrl(bad), bad).toBeNull();
    }
    expect(canonicalGitUrl('https://github.com/a/b')?.host).toBe('github.com');
    expect(canonicalGitUrl('https://git.example.org/a/b')?.host).toBe('git.example.org');
    expect(gitOwnerOf('https://github.com/Ascend42/x')).toBe('ascend42');
    expect(gitOwnerOf('https://gitlab.com/ascend42/x')).toBeNull();
  });

  it('git:<canonical url>#<sha40>; a 64-hex commit is refused', () => {
    const s = gitSourceString('https://GITHUB.com/acme/board.git', 'a'.repeat(40));
    expect(s).toBe(`git:https://github.com/acme/board#${'a'.repeat(40)}`);
    expect(parseGitSource(s)?.owner).toBe('acme');
    expect(() => gitSourceString('https://github.com/acme/board', 'a'.repeat(64))).toThrow(TypeError);
    expect(parseGitSource(`git:https://GITHUB.com/acme/board#${'a'.repeat(40)}`)).toBeNull(); // not canonical
  });
});

describe('the clientApiId move (S0b inside 8.0:TD-2026-10-20-812)', () => {
  it('desk.modId, the install commit and the published refusal codes ride the descriptor', () => {
    const d = CLIENT_API_DESCRIPTOR.desk as unknown as { modId: { idPattern: string; refusals: Record<string, unknown> }; install: { commitPattern: string } };
    expect(d.modId.idPattern).toBe(MOD_ID_PATTERN.source);
    expect(Object.keys(d.modId.refusals)).toEqual([...MOD_REFUSAL_CODES]);
    expect([...MOD_REFUSAL_CODES]).toEqual(['FORMAT', 'ENGINE', 'PUBLISHER', 'COLLISION']);
    expect(d.install.commitPattern).toBe('^[0-9a-f]{40}$');
  });

  it('offer-spec.v1.schema.json carries the title rule (no < > " `) and the tool pattern', () => {
    const props = (OFFER_SPEC_V1_SCHEMA as { properties: Record<string, { pattern?: string }> }).properties;
    const title = new RegExp(props.title!.pattern!);
    expect(title.test('Map this on the board')).toBe(true);
    for (const bad of ['a <b>', 'a "b"', 'a `b`']) expect(title.test(bad)).toBe(false);
    expect(props.handoffTool!.pattern).toBe(OFFER_TOOL_PATTERN.source);
  });
});
