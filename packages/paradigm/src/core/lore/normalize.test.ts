import { describe, it, expect } from 'vitest';
import { normalizeLoreEntry, inferProvider } from './normalize.js';

describe('inferProvider', () => {
  it('detects anthropic from claude models', () => {
    expect(inferProvider('claude-opus-4-6')).toBe('anthropic');
    expect(inferProvider('claude-sonnet-4-6')).toBe('anthropic');
    expect(inferProvider('claude-haiku-4-5')).toBe('anthropic');
  });

  it('detects openai from gpt models', () => {
    expect(inferProvider('gpt-4o')).toBe('openai');
    expect(inferProvider('gpt-4-turbo')).toBe('openai');
    expect(inferProvider('o1-preview')).toBe('openai');
    expect(inferProvider('o3-mini')).toBe('openai');
  });

  it('detects google from gemini models', () => {
    expect(inferProvider('gemini-pro')).toBe('google');
    expect(inferProvider('gemini-2.0-flash')).toBe('google');
  });

  it('detects meta from llama models', () => {
    expect(inferProvider('llama-3.3-70b')).toBe('meta');
  });

  it('detects mistral', () => {
    expect(inferProvider('mistral-large')).toBe('mistral');
    expect(inferProvider('mixtral-8x7b')).toBe('mistral');
  });

  it('detects deepseek', () => {
    expect(inferProvider('deepseek-r1')).toBe('deepseek');
  });

  it('returns unknown for unrecognized models', () => {
    expect(inferProvider('custom-model-v2')).toBe('unknown');
  });
});

describe('normalizeLoreEntry', () => {
  it('passes through already-normalized entries', () => {
    const entry = {
      id: 'L-2026-03-02-ascend-143025-001',
      type: 'agent-session',
      timestamp: '2026-03-02T14:30:25Z',
      author: 'ascend',
      agent: { provider: 'anthropic', model: 'claude-opus-4-6' },
      title: 'Test',
      summary: 'Test summary',
      symbols_touched: ['#test'],
    };

    const result = normalizeLoreEntry({ ...entry });
    expect(result.author).toBe('ascend');
    expect(result.agent).toEqual({ provider: 'anthropic', model: 'claude-opus-4-6' });
  });

  it('normalizes old agent author to new format', () => {
    const raw = {
      id: 'L-2026-02-21-001',
      type: 'agent-session',
      timestamp: '2026-02-21T10:00:00Z',
      author: { type: 'agent', id: 'claude', model: 'claude-opus-4-6' },
      title: 'Old agent entry',
      summary: 'Test',
      symbols_touched: ['#test'],
    };

    const result = normalizeLoreEntry(raw as Record<string, unknown>);
    expect(result.author).toBe('unknown');
    expect(result.agent).toEqual({ provider: 'anthropic', model: 'claude-opus-4-6' });
  });

  it('normalizes old human author to new format', () => {
    const raw = {
      id: 'L-2026-02-21-002',
      type: 'human-note',
      timestamp: '2026-02-21T10:00:00Z',
      author: { type: 'human', id: 'ascend' },
      title: 'Old human entry',
      summary: 'Test',
      symbols_touched: ['#test'],
    };

    const result = normalizeLoreEntry(raw as Record<string, unknown>);
    expect(result.author).toBe('ascend');
    expect(result.agent).toBeUndefined();
  });

  it('removes assistedBy field', () => {
    const raw = {
      id: 'L-2026-02-21-003',
      type: 'agent-session',
      timestamp: '2026-02-21T10:00:00Z',
      author: { type: 'agent', id: 'claude', model: 'claude-opus-4-6' },
      assistedBy: { type: 'human', id: 'ascend', role: 'reviewer' },
      title: 'With assistedBy',
      summary: 'Test',
      symbols_touched: [],
    };

    const result = normalizeLoreEntry(raw as Record<string, unknown>);
    expect((result as any).assistedBy).toBeUndefined();
  });

  it('infers provider from model when no model field', () => {
    const raw = {
      id: 'L-2026-02-21-004',
      type: 'agent-session',
      timestamp: '2026-02-21T10:00:00Z',
      author: { type: 'agent', id: 'gpt-4o' },
      title: 'GPT entry',
      summary: 'Test',
      symbols_touched: [],
    };

    const result = normalizeLoreEntry(raw as Record<string, unknown>);
    expect(result.author).toBe('unknown');
    expect(result.agent).toEqual({ provider: 'openai', model: 'gpt-4o' });
  });

  it('handles missing id in old format gracefully', () => {
    const raw = {
      id: 'L-2026-02-21-005',
      type: 'agent-session',
      timestamp: '2026-02-21T10:00:00Z',
      author: { type: 'human' },
      title: 'Missing id',
      summary: 'Test',
      symbols_touched: [],
    };

    const result = normalizeLoreEntry(raw as Record<string, unknown>);
    expect(result.author).toBe('unknown');
  });

  it('is safe to call multiple times', () => {
    const raw = {
      id: 'L-2026-02-21-001',
      type: 'agent-session',
      timestamp: '2026-02-21T10:00:00Z',
      author: { type: 'agent', id: 'claude', model: 'claude-opus-4-6' },
      title: 'Test',
      summary: 'Test',
      symbols_touched: [],
    };

    const first = normalizeLoreEntry(raw as Record<string, unknown>);
    const second = normalizeLoreEntry(first as unknown as Record<string, unknown>);
    expect(second.author).toBe('unknown');
    expect(second.agent).toEqual({ provider: 'anthropic', model: 'claude-opus-4-6' });
  });
});
