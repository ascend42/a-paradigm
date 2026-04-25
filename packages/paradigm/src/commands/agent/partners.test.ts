import { describe, it, expect } from 'vitest';
import {
  validateReciprocity,
  findMissingPartners,
  pairLabel,
  pairNotebookPath,
  getPartnerStatus,
  type AgentWithPartners,
} from './partners.js';

describe('partners helpers', () => {
  describe('validateReciprocity', () => {
    it('returns empty when all pairings are reciprocal', () => {
      const agents: AgentWithPartners[] = [
        { name: 'scholar', partners: [{ id: 'sheila' }] },
        { name: 'sheila', partners: [{ id: 'scholar' }] },
      ];
      expect(validateReciprocity(agents)).toEqual([]);
    });

    it('detects one-way pending pair', () => {
      const agents: AgentWithPartners[] = [
        { name: 'scholar', partners: [{ id: 'sheila' }] },
        { name: 'sheila' },
      ];
      expect(validateReciprocity(agents)).toEqual([
        { id: 'scholar', pendingPartners: ['sheila'] },
      ]);
    });

    it('ignores partners that point to non-existent agents', () => {
      const agents: AgentWithPartners[] = [
        { name: 'scholar', partners: [{ id: 'ghost' }] },
      ];
      expect(validateReciprocity(agents)).toEqual([]);
    });

    it('handles agents with no partners array', () => {
      const agents: AgentWithPartners[] = [
        { name: 'scholar' },
        { name: 'sheila' },
      ];
      expect(validateReciprocity(agents)).toEqual([]);
    });

    it('reports both sides when each declares non-reciprocal', () => {
      const agents: AgentWithPartners[] = [
        { name: 'a', partners: [{ id: 'b' }] },
        { name: 'b', partners: [{ id: 'c' }] },
        { name: 'c', partners: [{ id: 'a' }] },
      ];
      const result = validateReciprocity(agents);
      expect(result).toHaveLength(3);
    });
  });

  describe('findMissingPartners', () => {
    it('returns ids not in installed set', () => {
      const agent: AgentWithPartners = {
        name: 'scholar',
        partners: [{ id: 'sheila' }, { id: 'ghost' }],
      };
      expect(findMissingPartners(agent, new Set(['sheila']))).toEqual(['ghost']);
    });

    it('returns empty when all partners installed', () => {
      const agent: AgentWithPartners = {
        name: 'scholar',
        partners: [{ id: 'sheila' }],
      };
      expect(findMissingPartners(agent, new Set(['sheila']))).toEqual([]);
    });

    it('returns empty when agent has no partners', () => {
      const agent: AgentWithPartners = { name: 'scholar' };
      expect(findMissingPartners(agent, new Set())).toEqual([]);
    });
  });

  describe('pairLabel', () => {
    it('produces alphabetically canonical label regardless of order', () => {
      expect(pairLabel('scholar', 'sheila')).toBe('scholar-sheila');
      expect(pairLabel('sheila', 'scholar')).toBe('scholar-sheila');
    });
  });

  describe('pairNotebookPath', () => {
    it('returns alphabetically canonical pair path', () => {
      expect(pairNotebookPath('scholar', 'sheila')).toBe('_pairs/scholar-sheila/');
      expect(pairNotebookPath('sheila', 'scholar')).toBe('_pairs/scholar-sheila/');
    });
  });

  describe('getPartnerStatus', () => {
    const agents: AgentWithPartners[] = [
      { name: 'scholar', partners: [{ id: 'sheila' }] },
      { name: 'sheila', partners: [{ id: 'scholar' }] },
      { name: 'cid' },
    ];

    it('returns reciprocal when both list each other and both installed', () => {
      const status = getPartnerStatus(agents[0], 'sheila', agents, new Set(['scholar', 'sheila']));
      expect(status).toBe('reciprocal');
    });

    it('returns not-installed when partner missing locally', () => {
      const status = getPartnerStatus(agents[0], 'sheila', agents, new Set(['scholar']));
      expect(status).toBe('not-installed');
    });

    it('returns pending when partner installed but does not list back', () => {
      const oneWay: AgentWithPartners[] = [
        { name: 'scholar', partners: [{ id: 'cid' }] },
        { name: 'cid' },
      ];
      const status = getPartnerStatus(oneWay[0], 'cid', oneWay, new Set(['scholar', 'cid']));
      expect(status).toBe('pending');
    });
  });
});
