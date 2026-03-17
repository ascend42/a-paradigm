import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ToolRegistry, FEATURE_DETECTORS, type ToolModule, type ToolDefinition } from './tool-registry.js';

// ────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────

function makeTool(name: string): ToolDefinition {
  return { name, description: `Tool ${name}`, inputSchema: { type: 'object' } };
}

function makeModule(
  key: string,
  tier: 'core' | 'feature' | 'advanced',
  tools: ToolDefinition[],
  detect?: (rootDir: string) => boolean
): ToolModule {
  return {
    key,
    tier,
    getToolsList: () => tools,
    handleTool: async (name, _args) => {
      const found = tools.find(t => t.name === name);
      if (found) return { text: `handled by ${key}`, handled: true };
      return { text: '', handled: false };
    },
    detect,
  };
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tool-registry-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ────────────────────────────────────────────────────────
// register / registerAll
// ────────────────────────────────────────────────────────

describe('ToolRegistry.register / registerAll', () => {
  it('registers a single module and size reflects count', () => {
    const registry = new ToolRegistry(tmpDir);
    const mod = makeModule('alpha', 'core', [makeTool('tool_a')]);

    registry.register(mod);

    expect(registry.size).toBe(1);
  });

  it('registerAll registers multiple modules', () => {
    const registry = new ToolRegistry(tmpDir);
    const modules = [
      makeModule('alpha', 'core', [makeTool('tool_a')]),
      makeModule('beta', 'feature', [makeTool('tool_b')]),
      makeModule('gamma', 'advanced', [makeTool('tool_c')]),
    ];

    registry.registerAll(modules);

    expect(registry.size).toBe(3);
  });

  it('overwrites a module registered with the same key', () => {
    const registry = new ToolRegistry(tmpDir);
    registry.register(makeModule('alpha', 'core', [makeTool('v1')]));
    registry.register(makeModule('alpha', 'core', [makeTool('v2')]));

    expect(registry.size).toBe(1);
    const tools = registry.getActiveTools();
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('v2');
  });
});

// ────────────────────────────────────────────────────────
// detectActiveFeatures
// ────────────────────────────────────────────────────────

describe('ToolRegistry.detectActiveFeatures', () => {
  it('core modules are always active', () => {
    const registry = new ToolRegistry(tmpDir);
    registry.register(makeModule('core-mod', 'core', [makeTool('t')]));

    const active = registry.detectActiveFeatures();

    expect(active.has('core-mod')).toBe(true);
  });

  it('feature modules with passing detect function are active', () => {
    const registry = new ToolRegistry(tmpDir);
    registry.register(makeModule('feat', 'feature', [makeTool('t')], () => true));

    const active = registry.detectActiveFeatures();

    expect(active.has('feat')).toBe(true);
  });

  it('feature modules with failing detect function are inactive', () => {
    const registry = new ToolRegistry(tmpDir);
    registry.register(makeModule('feat', 'feature', [makeTool('t')], () => false));

    const active = registry.detectActiveFeatures();

    expect(active.has('feat')).toBe(false);
  });

  it('feature modules without detect function or registry detector are active (backward compat)', () => {
    const registry = new ToolRegistry(tmpDir);
    // key does not match any FEATURE_DETECTORS entry, and no detect fn
    registry.register(makeModule('unknown-feature', 'feature', [makeTool('t')]));

    const active = registry.detectActiveFeatures();

    expect(active.has('unknown-feature')).toBe(true);
  });

  it('advanced modules are inactive by default', () => {
    const registry = new ToolRegistry(tmpDir);
    registry.register(makeModule('adv', 'advanced', [makeTool('t')]));

    const active = registry.detectActiveFeatures();

    expect(active.has('adv')).toBe(false);
  });

  it('advanced modules become active after activation', () => {
    const registry = new ToolRegistry(tmpDir);
    registry.register(makeModule('adv', 'advanced', [makeTool('t')]));
    registry.activateAdvanced('adv');

    const active = registry.detectActiveFeatures();

    expect(active.has('adv')).toBe(true);
  });
});

// ────────────────────────────────────────────────────────
// getActiveTools
// ────────────────────────────────────────────────────────

describe('ToolRegistry.getActiveTools', () => {
  it('returns tools from active modules only', () => {
    const registry = new ToolRegistry(tmpDir);
    registry.registerAll([
      makeModule('core-mod', 'core', [makeTool('core_tool')]),
      makeModule('active-feat', 'feature', [makeTool('feat_tool')], () => true),
      makeModule('inactive-feat', 'feature', [makeTool('hidden_tool')], () => false),
      makeModule('adv-mod', 'advanced', [makeTool('adv_tool')]),
    ]);

    const tools = registry.getActiveTools();
    const names = tools.map(t => t.name);

    expect(names).toContain('core_tool');
    expect(names).toContain('feat_tool');
    expect(names).not.toContain('hidden_tool');
    expect(names).not.toContain('adv_tool');
  });

  it('returns empty array when no modules registered', () => {
    const registry = new ToolRegistry(tmpDir);

    expect(registry.getActiveTools()).toEqual([]);
  });
});

// ────────────────────────────────────────────────────────
// activateAdvanced
// ────────────────────────────────────────────────────────

describe('ToolRegistry.activateAdvanced', () => {
  it('activates an advanced module and its tools appear in getActiveTools', () => {
    const registry = new ToolRegistry(tmpDir);
    const advTool = makeTool('adv_tool');
    registry.register(makeModule('adv-mod', 'advanced', [advTool]));

    const result = registry.activateAdvanced('adv-mod');

    expect(result).not.toBeNull();
    expect(result).toHaveLength(1);
    expect(result![0].name).toBe('adv_tool');

    const activeNames = registry.getActiveTools().map(t => t.name);
    expect(activeNames).toContain('adv_tool');
  });

  it('returns null for unknown keys', () => {
    const registry = new ToolRegistry(tmpDir);

    expect(registry.activateAdvanced('nonexistent')).toBeNull();
  });

  it('returns null for non-advanced modules', () => {
    const registry = new ToolRegistry(tmpDir);
    registry.register(makeModule('core-mod', 'core', [makeTool('t')]));
    registry.register(makeModule('feat-mod', 'feature', [makeTool('t2')], () => true));

    expect(registry.activateAdvanced('core-mod')).toBeNull();
    expect(registry.activateAdvanced('feat-mod')).toBeNull();
  });
});

// ────────────────────────────────────────────────────────
// getAvailableAdvanced
// ────────────────────────────────────────────────────────

describe('ToolRegistry.getAvailableAdvanced', () => {
  it('lists unactivated advanced modules', () => {
    const registry = new ToolRegistry(tmpDir);
    registry.registerAll([
      makeModule('core-mod', 'core', [makeTool('t')]),
      makeModule('adv-a', 'advanced', [makeTool('t1'), makeTool('t2')]),
      makeModule('adv-b', 'advanced', [makeTool('t3')]),
    ]);

    const available = registry.getAvailableAdvanced();

    expect(available).toHaveLength(2);
    const keys = available.map(a => a.key);
    expect(keys).toContain('adv-a');
    expect(keys).toContain('adv-b');
    expect(available.find(a => a.key === 'adv-a')!.toolCount).toBe(2);
    expect(available.find(a => a.key === 'adv-b')!.toolCount).toBe(1);
  });

  it('excludes activated advanced modules', () => {
    const registry = new ToolRegistry(tmpDir);
    registry.registerAll([
      makeModule('adv-a', 'advanced', [makeTool('t1')]),
      makeModule('adv-b', 'advanced', [makeTool('t2')]),
    ]);

    registry.activateAdvanced('adv-a');
    const available = registry.getAvailableAdvanced();

    expect(available).toHaveLength(1);
    expect(available[0].key).toBe('adv-b');
  });

  it('returns empty when no advanced modules exist', () => {
    const registry = new ToolRegistry(tmpDir);
    registry.register(makeModule('core-mod', 'core', [makeTool('t')]));

    expect(registry.getAvailableAdvanced()).toEqual([]);
  });
});

// ────────────────────────────────────────────────────────
// dispatch
// ────────────────────────────────────────────────────────

describe('ToolRegistry.dispatch', () => {
  it('dispatches to correct handler', async () => {
    const registry = new ToolRegistry(tmpDir);
    registry.registerAll([
      makeModule('mod-a', 'core', [makeTool('tool_a')]),
      makeModule('mod-b', 'core', [makeTool('tool_b')]),
    ]);

    const result = await registry.dispatch('tool_b', {}, null);

    expect(result).not.toBeNull();
    expect(result!.handled).toBe(true);
    expect(result!.text).toBe('handled by mod-b');
  });

  it('returns null when no handler matches', async () => {
    const registry = new ToolRegistry(tmpDir);
    registry.register(makeModule('mod-a', 'core', [makeTool('tool_a')]));

    const result = await registry.dispatch('nonexistent_tool', {}, null);

    expect(result).toBeNull();
  });

  it('skips inactive modules', async () => {
    const registry = new ToolRegistry(tmpDir);
    registry.register(makeModule('inactive', 'feature', [makeTool('hidden_tool')], () => false));

    const result = await registry.dispatch('hidden_tool', {}, null);

    expect(result).toBeNull();
  });

  it('returns error when handler throws', async () => {
    const registry = new ToolRegistry(tmpDir);
    const throwingModule: ToolModule = {
      key: 'broken',
      tier: 'core',
      getToolsList: () => [makeTool('bomb')],
      handleTool: async () => {
        throw new Error('kaboom');
      },
    };
    registry.register(throwingModule);

    const result = await registry.dispatch('bomb', {}, null);

    expect(result).not.toBeNull();
    expect(result!.handled).toBe(true);
    const parsed = JSON.parse(result!.text);
    expect(parsed.error).toContain('broken');
    expect(parsed.message).toBe('kaboom');
  });
});

// ────────────────────────────────────────────────────────
// FEATURE_DETECTORS
// ────────────────────────────────────────────────────────

describe('FEATURE_DETECTORS', () => {
  describe('lore', () => {
    it('returns true when .paradigm/lore/ exists', () => {
      fs.mkdirSync(path.join(tmpDir, '.paradigm', 'lore'), { recursive: true });

      expect(FEATURE_DETECTORS.lore(tmpDir)).toBe(true);
    });

    it('returns false when .paradigm/lore/ is missing', () => {
      expect(FEATURE_DETECTORS.lore(tmpDir)).toBe(false);
    });
  });

  describe('habits', () => {
    it('returns true when .paradigm/habits.yaml exists', () => {
      fs.mkdirSync(path.join(tmpDir, '.paradigm'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, '.paradigm', 'habits.yaml'), 'habits: []');

      expect(FEATURE_DETECTORS.habits(tmpDir)).toBe(true);
    });

    it('returns false when .paradigm/habits.yaml is missing', () => {
      expect(FEATURE_DETECTORS.habits(tmpDir)).toBe(false);
    });
  });

  describe('agents', () => {
    it('returns true when .paradigm/agents/ exists locally', () => {
      fs.mkdirSync(path.join(tmpDir, '.paradigm', 'agents'), { recursive: true });

      expect(FEATURE_DETECTORS.agents(tmpDir)).toBe(true);
    });

    it('returns true when ~/.paradigm/agents/ exists globally', () => {
      const globalDir = path.join(os.homedir(), '.paradigm', 'agents');
      // This test checks the real global dir, which may or may not exist.
      // We verify the detector function runs without error and returns a boolean.
      const result = FEATURE_DETECTORS.agents(tmpDir);
      if (fs.existsSync(globalDir)) {
        expect(result).toBe(true);
      } else {
        // No local dir and no global dir
        expect(result).toBe(false);
      }
    });
  });

  describe('symphony', () => {
    it('checks ~/.paradigm/score/ directory', () => {
      const scoreDir = path.join(os.homedir(), '.paradigm', 'score');
      const expected = fs.existsSync(scoreDir);

      expect(FEATURE_DETECTORS.symphony(tmpDir)).toBe(expected);
    });
  });

  describe('wisdom', () => {
    it('returns true when .paradigm/wisdom/ exists', () => {
      fs.mkdirSync(path.join(tmpDir, '.paradigm', 'wisdom'), { recursive: true });

      expect(FEATURE_DETECTORS.wisdom(tmpDir)).toBe(true);
    });

    it('returns false when .paradigm/wisdom/ is missing', () => {
      expect(FEATURE_DETECTORS.wisdom(tmpDir)).toBe(false);
    });
  });

  describe('flows', () => {
    it('returns true when .paradigm/flow-index.json exists', () => {
      fs.mkdirSync(path.join(tmpDir, '.paradigm'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, '.paradigm', 'flow-index.json'), '{}');

      expect(FEATURE_DETECTORS.flows(tmpDir)).toBe(true);
    });

    it('returns true when .paradigm/flows.yaml exists', () => {
      fs.mkdirSync(path.join(tmpDir, '.paradigm'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, '.paradigm', 'flows.yaml'), 'flows: {}');

      expect(FEATURE_DETECTORS.flows(tmpDir)).toBe(true);
    });

    it('returns false when neither flow file exists', () => {
      expect(FEATURE_DETECTORS.flows(tmpDir)).toBe(false);
    });
  });

  describe('protocols', () => {
    it('returns true when .paradigm/protocols/ exists', () => {
      fs.mkdirSync(path.join(tmpDir, '.paradigm', 'protocols'), { recursive: true });

      expect(FEATURE_DETECTORS.protocols(tmpDir)).toBe(true);
    });

    it('returns false when .paradigm/protocols/ is missing', () => {
      expect(FEATURE_DETECTORS.protocols(tmpDir)).toBe(false);
    });
  });
});
