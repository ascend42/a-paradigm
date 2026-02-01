/**
 * Gate Resources - Expose Paradigm gates/portals via MCP
 */

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { getSymbolsByType } from '@a-company/premise-core';
import type { ProjectContext } from '../utils/index-loader.js';

/**
 * Format gate data for MCP response
 */
function formatGate(gate: any) {
  return {
    id: gate.id,
    symbol: `^${gate.id}`,
    description: gate.description,
    locks: gate.locks?.map((lock: any) => ({
      id: lock.id,
      description: lock.description,
      keys: lock.keys?.map((k: any) => k.expression || k),
      mode: lock.mode || 'all',
    })),
    prizes: gate.prizes?.map((prize: any) => ({
      id: prize.id,
      oneTime: prize.oneTime,
    })),
  };
}

/**
 * Register gate resources with the MCP server
 */
export function registerGateResources(server: Server, getContext: () => ProjectContext) {
  // This is handled in the main resource handler
  // Here we export helper functions for gate-specific queries
}

/**
 * Get all gates from context
 */
export function getGatesData(ctx: ProjectContext) {
  // Get gates from portal.yaml
  const portalGates = ctx.gateConfig?.gates || [];
  
  // Get gates from symbol index (from .purpose files)
  const purposeGates = getSymbolsByType(ctx.index, 'gate');
  
  // Merge, preferring portal.yaml definitions
  const gateMap = new Map<string, any>();
  
  // Add purpose gates first
  for (const g of purposeGates) {
    const id = g.symbol.replace(/^\^/, '');
    gateMap.set(id, {
      id,
      symbol: g.symbol,
      description: g.description,
      source: 'purpose',
      filePath: g.filePath,
      data: g.data,
    });
  }
  
  // Override/add portal.yaml gates
  for (const gate of portalGates) {
    gateMap.set(gate.id, {
      ...formatGate(gate),
      source: 'portal.yaml',
    });
  }
  
  return Array.from(gateMap.values());
}

/**
 * Get flows from context
 */
export function getFlowsData(ctx: ProjectContext) {
  // Get flows from portal.yaml
  const portalFlows = ctx.gateConfig?.flows || [];
  
  // Get flows from symbol index
  const purposeFlows = getSymbolsByType(ctx.index, 'flow');
  
  // Merge
  const flowMap = new Map<string, any>();
  
  for (const f of purposeFlows) {
    const id = f.symbol.replace(/^\$/, '');
    flowMap.set(id, {
      id,
      symbol: f.symbol,
      description: f.description,
      source: 'purpose',
      filePath: f.filePath,
      data: f.data,
    });
  }
  
  for (const flow of portalFlows) {
    flowMap.set(flow.id, {
      id: flow.id,
      symbol: `$${flow.id}`,
      description: flow.description,
      gates: flow.gates,
      source: 'portal.yaml',
    });
  }
  
  return Array.from(flowMap.values());
}
