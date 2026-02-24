import { describe, it, expect } from 'vitest';
import { generateMermaidDiagram } from './flow-validator.js';
import type { FlowDefinition, GateStep } from './flow-schema.js';

describe('generateMermaidDiagram', () => {
  it('generates a basic diagram with gate, action, and signal steps', () => {
    const flow: FlowDefinition = {
      id: '$task-creation',
      name: 'Task Creation Flow',
      description: 'Creates a new task',
      trigger: 'POST /api/tasks',
      steps: [
        { type: 'gate', symbol: '^authenticated' },
        { type: 'action', symbol: '#create-task' },
        { type: 'signal', symbol: '!task-created' },
      ],
      successSignal: '!task-creation-completed',
    };

    const diagram = generateMermaidDiagram(flow);

    expect(diagram).toContain('```mermaid');
    expect(diagram).toContain('flowchart TD');
    expect(diagram).toContain('START([POST /api/tasks])');
    expect(diagram).toContain('S0{^authenticated}');
    expect(diagram).toContain('S1[#create-task]');
    expect(diagram).toContain('S2([!task-created])');
    expect(diagram).toContain('SUCCESS([!task-creation-completed])');
    expect(diagram).toContain('classDef gate fill:#f9d71c');
    expect(diagram).toContain('classDef action fill:#4a90d9');
    expect(diagram).toContain('classDef signal fill:#50c878');
    expect(diagram).toContain('class S0 gate');
    expect(diagram).toContain('class S1 action');
    expect(diagram).toContain('class S2 signal');
    expect(diagram).toContain('```');
  });

  it('adds deny path for gate steps with failResponse', () => {
    const flow: FlowDefinition = {
      id: '$auth-flow',
      name: 'Auth Flow',
      description: 'Auth check',
      trigger: 'GET /api/protected',
      steps: [
        {
          type: 'gate',
          symbol: '^authenticated',
          failResponse: '403 Forbidden',
        } as GateStep,
      ],
      successSignal: '!auth-passed',
    };

    const diagram = generateMermaidDiagram(flow);

    expect(diagram).toContain('DENY0[/403 Forbidden/]');
    expect(diagram).toContain('S0 -->|deny| DENY0');
  });

  it('adds deny path for gate steps with errorSignal', () => {
    const flow: FlowDefinition = {
      id: '$auth-flow',
      name: 'Auth Flow',
      description: 'Auth check',
      trigger: 'GET /api/protected',
      steps: [
        {
          type: 'gate',
          symbol: '^authenticated',
          errorSignal: '!auth-failed',
        },
      ],
      successSignal: '!auth-passed',
    };

    const diagram = generateMermaidDiagram(flow);

    expect(diagram).toContain('DENY0[/!auth-failed/]');
    expect(diagram).toContain('S0 -->|deny| DENY0');
  });

  it('labels optional action steps correctly', () => {
    const flow: FlowDefinition = {
      id: '$optional-flow',
      name: 'Optional Flow',
      description: 'Flow with optional step',
      trigger: 'POST /api/action',
      steps: [
        { type: 'action', symbol: '#optional-step', optional: true },
      ],
      successSignal: '!done',
    };

    const diagram = generateMermaidDiagram(flow);

    expect(diagram).toContain('START -->|optional| S0');
  });

  it('labels required action steps with allow', () => {
    const flow: FlowDefinition = {
      id: '$required-flow',
      name: 'Required Flow',
      description: 'Flow with required step',
      trigger: 'POST /api/action',
      steps: [
        { type: 'action', symbol: '#required-step' },
      ],
      successSignal: '!done',
    };

    const diagram = generateMermaidDiagram(flow);

    expect(diagram).toContain('START -->|allow| S0');
  });

  it('chains steps sequentially', () => {
    const flow: FlowDefinition = {
      id: '$chain-flow',
      name: 'Chain Flow',
      description: 'Chained steps',
      trigger: 'POST /api/chain',
      steps: [
        { type: 'gate', symbol: '^gate-a' },
        { type: 'gate', symbol: '^gate-b' },
        { type: 'action', symbol: '#do-thing' },
      ],
      successSignal: '!chain-done',
    };

    const diagram = generateMermaidDiagram(flow);

    expect(diagram).toContain('START --> S0');
    expect(diagram).toContain('S0 --> S1');
    expect(diagram).toContain('S1 -->|allow| S2');
    expect(diagram).toContain('S2 --> SUCCESS');
  });

  it('handles flow without successSignal gracefully', () => {
    const flow: FlowDefinition = {
      id: '$no-success',
      name: 'No Success Signal',
      description: 'Flow without success signal',
      trigger: 'POST /api/test',
      steps: [
        { type: 'action', symbol: '#do-something' },
      ],
      successSignal: '',
    };

    const diagram = generateMermaidDiagram(flow);

    expect(diagram).not.toContain('SUCCESS');
  });

  it('escapes special Mermaid characters in labels', () => {
    const flow: FlowDefinition = {
      id: '$escape-test',
      name: 'Escape Test',
      description: 'Tests escaping',
      trigger: 'POST /api/test[1]',
      steps: [
        { type: 'action', symbol: '#action(test)' },
      ],
      successSignal: '!done',
    };

    const diagram = generateMermaidDiagram(flow);

    // Square brackets and parentheses should be stripped from labels
    expect(diagram).toContain('START([POST /api/test1])');
    expect(diagram).toContain('S0[#actiontest]');
  });
});
