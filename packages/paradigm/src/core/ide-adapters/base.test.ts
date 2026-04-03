import { describe, it, expect } from 'vitest';
import {
  generateHeader,
  generateOverview,
  generateSymbolSystem,
  generateConventions,
  generateLoggingRules,
  generateMcpToolReference,
  generateWorkflowProtocol,
  generateHandoffProtocol,
  generateNavigationSection,
  generateCommitConvention,
  generateUpdateRules,
  generateCommandsReference,
  generateCheckpointProtocol,
  generateHabitsSection,
  generateLoreSection,
  generateLlmsTxtSection,
} from './base.js';
import { getDefaultParadigmConfig, type ParadigmConfig } from '../paradigm-config.js';

const defaultConfig = getDefaultParadigmConfig('test-project');

describe('generateHeader', () => {
  it('includes project name and IDE name', () => {
    const result = generateHeader('my-app', 'Cursor');
    expect(result).toContain('my-app');
    expect(result).toContain('Cursor');
  });
});

describe('generateOverview', () => {
  it('renders guidelines from config', () => {
    const result = generateOverview(defaultConfig);
    expect(result).toContain('## Overview');
    expect(result).toContain(defaultConfig['agent-guidelines'].overview);
    expect(result).toContain('## How to Use Paradigm');
  });

  it('handles missing guidelines', () => {
    const emptyConfig = {
      ...defaultConfig,
      'agent-guidelines': { overview: '', 'how-to-use': [], 'update-rules': [] },
    };
    const result = generateOverview(emptyConfig);
    expect(result).not.toContain('## Overview');
    expect(result).not.toContain('## How to Use Paradigm');
  });
});

describe('generateSymbolSystem', () => {
  it('lists all 5 symbols', () => {
    const result = generateSymbolSystem(defaultConfig);
    expect(result).toContain('`#`');
    expect(result).toContain('`$`');
    expect(result).toContain('`^`');
    expect(result).toContain('`!`');
    expect(result).toContain('`~`');
    expect(result).toContain('Component');
    expect(result).toContain('Flow');
    expect(result).toContain('Gate');
    expect(result).toContain('Signal');
    expect(result).toContain('Aspect');
  });
});

describe('generateConventions', () => {
  it('renders as bullet list', () => {
    const result = generateConventions(defaultConfig);
    expect(result).toContain('## Conventions');
    for (const convention of defaultConfig.conventions) {
      expect(result).toContain(`- ${convention}`);
    }
  });

  it('returns empty for no conventions', () => {
    const noConventions = { ...defaultConfig, conventions: [] };
    const result = generateConventions(noConventions);
    expect(result).toBe('');
  });
});

describe('generateLoggingRules', () => {
  it('renders when logging enabled', () => {
    const withLogging: ParadigmConfig = {
      ...defaultConfig,
      logging: { enforce: true },
    };
    const result = generateLoggingRules(withLogging);
    expect(result).toContain('## Paradigm Logging');
    expect(result).toContain('log.component');
  });

  it('returns empty when logging disabled', () => {
    const noLogging: ParadigmConfig = {
      ...defaultConfig,
      logging: { enforce: false },
    };
    const result = generateLoggingRules(noLogging);
    expect(result).toBe('');
  });

  it('returns empty when logging missing', () => {
    const result = generateLoggingRules(defaultConfig);
    expect(result).toBe('');
  });
});

describe('generateMcpToolReference', () => {
  it('includes key tool names', () => {
    const result = generateMcpToolReference();
    expect(result).toContain('paradigm_status');
    expect(result).toContain('paradigm_search');
    expect(result).toContain('paradigm_navigate');
    expect(result).toContain('paradigm_ripple');
    expect(result).toContain('paradigm_gates_for_route');
  });
});

describe('generateWorkflowProtocol', () => {
  it('includes before and after sections', () => {
    const result = generateWorkflowProtocol();
    expect(result).toContain('### Before Each Task');
    expect(result).toContain('### After Each Task');
    expect(result).toContain('paradigm_pm_preflight');
    expect(result).toContain('paradigm_pm_postflight');
  });
});

describe('generateHandoffProtocol', () => {
  it('mentions session recovery', () => {
    const result = generateHandoffProtocol();
    expect(result).toContain('paradigm_session_recover');
    expect(result).toContain('paradigm_session_health');
    expect(result).toContain('paradigm_handoff_prepare');
  });
});

describe('generateNavigationSection', () => {
  it('renders navigation content', () => {
    const result = generateNavigationSection(defaultConfig);
    expect(result).toContain('## Paradigm Navigation');
    expect(result).toContain('navigator.yaml');
    expect(result).toContain('paradigm_navigate');
  });
});

describe('generateCommitConvention', () => {
  it('includes Symbols trailer example', () => {
    const result = generateCommitConvention();
    expect(result).toContain('Symbols:');
    expect(result).toContain('type(#');
    expect(result).toContain('## Commit Messages');
  });
});

describe('generateUpdateRules', () => {
  it('renders update rules from config', () => {
    const result = generateUpdateRules(defaultConfig);
    expect(result).toContain('## When to Update Paradigm Files');
    for (const rule of defaultConfig['agent-guidelines']['update-rules']) {
      expect(result).toContain(rule);
    }
  });

  it('returns empty when no update rules', () => {
    const noRules = {
      ...defaultConfig,
      'agent-guidelines': { ...defaultConfig['agent-guidelines'], 'update-rules': [] },
    };
    const result = generateUpdateRules(noRules);
    expect(result).toBe('');
  });
});

describe('generateCommandsReference', () => {
  it('lists CLI commands', () => {
    const result = generateCommandsReference();
    expect(result).toContain('paradigm init');
    expect(result).toContain('paradigm sync');
    expect(result).toContain('paradigm doctor');
    expect(result).toContain('paradigm status');
  });
});

describe('generateCheckpointProtocol', () => {
  it('includes checkpoint phases and usage example', () => {
    const result = generateCheckpointProtocol();
    expect(result).toContain('## Session Checkpoints');
    expect(result).toContain('planning');
    expect(result).toContain('implementing');
    expect(result).toContain('validating');
    expect(result).toContain('complete');
    expect(result).toContain('paradigm_session_checkpoint');
  });
});

describe('generateHabitsSection', () => {
  it('includes habit triggers and categories', () => {
    const result = generateHabitsSection();
    expect(result).toContain('## Habits Compliance');
    expect(result).toContain('preflight');
    expect(result).toContain('postflight');
    expect(result).toContain('on-stop');
    expect(result).toContain('paradigm_habits_check');
    expect(result).toContain('Discovery');
    expect(result).toContain('Security');
    expect(result).toContain('Documentation');
    expect(result).toContain('Quality');
    expect(result).toContain('paradigm_practice_context');
  });
});

describe('generateLoreSection', () => {
  it('includes lore types and recording example', () => {
    const result = generateLoreSection();
    expect(result).toContain('## Lore Recording');
    expect(result).toContain('agent-session');
    expect(result).toContain('decision');
    expect(result).toContain('milestone');
    expect(result).toContain('incident');
    expect(result).toContain('paradigm_lore_record');
    expect(result).toContain('paradigm_lore_timeline');
  });
});

describe('generateLlmsTxtSection', () => {
  it('references llms.txt and sync command', () => {
    const result = generateLlmsTxtSection();
    expect(result).toContain('## llms.txt');
    expect(result).toContain('llms.txt');
    expect(result).toContain('paradigm sync-llms');
  });
});
