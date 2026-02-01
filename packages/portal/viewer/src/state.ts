/**
 * Server-side state management for Portal Viewer
 */

import { randomUUID } from 'crypto';
import type {
  PortalNode,
  FlowNode,
  PortalSession,
  ViewerEvent,
  EntityJourney,
  WatcherEvent,
  Gate,
  Flow,
  PortalStatus,
} from './types.js';

export class ViewerState {
  private portals: Map<string, PortalNode> = new Map();
  private flows: Map<string, FlowNode> = new Map();
  private currentSession: PortalSession | null = null;
  private eventCounter = 0;

  /**
   * Initialize state with gates and flows from config
   */
  initializeFromConfig(gates: Gate[], flows: Flow[]): void {
    // Initialize portal nodes
    for (const gate of gates) {
      this.portals.set(gate.id, {
        id: gate.id,
        gate,
        status: 'idle',
        hitCount: 0,
        passCount: 0,
        failCount: 0,
      });
    }

    // Initialize flow nodes
    for (const flow of flows) {
      this.flows.set(flow.id, {
        id: flow.id,
        flow,
        progress: 0,
        currentGateIndex: 0,
        completedGates: [],
        status: 'idle',
      });
    }
  }

  /**
   * Process incoming watcher event
   */
  processEvent(event: WatcherEvent): ViewerEvent {
    const viewerEvent = this.toViewerEvent(event);

    // Update portal state
    this.updatePortalState(viewerEvent);

    // Update flow state
    this.updateFlowState(viewerEvent);

    // Record in session if active
    if (this.currentSession) {
      this.recordSessionEvent(viewerEvent);
    }

    return viewerEvent;
  }

  /**
   * Convert WatcherEvent to ViewerEvent
   */
  private toViewerEvent(event: WatcherEvent): ViewerEvent {
    const data = event.data as Record<string, unknown> | undefined;
    const gate = data?.gate as { id?: string } | undefined;
    const result = data as { passed?: boolean; reason?: string; context?: Record<string, unknown>; duration?: number } | undefined;

    let decision: 'allow' | 'deny' | 'pending' | undefined;
    if (event.type === 'gate:pass') {
      decision = 'allow';
    } else if (event.type === 'gate:fail') {
      decision = 'deny';
    } else if (event.type === 'gate:check') {
      decision = 'pending';
    }

    return {
      id: `evt-${++this.eventCounter}`,
      type: event.type,
      timestamp: new Date(event.timestamp).toISOString(),
      entityId: event.entityId,
      gate: gate?.id,
      decision,
      reason: result?.reason,
      context: result?.context,
      duration: result?.duration,
      raw: event,
    };
  }

  /**
   * Update portal state based on event
   */
  private updatePortalState(event: ViewerEvent): void {
    if (!event.gate) return;

    const portal = this.portals.get(event.gate);
    if (!portal) return;

    // Update status based on event type
    let newStatus: PortalStatus = portal.status;
    switch (event.type) {
      case 'gate:check':
        newStatus = 'checking';
        portal.hitCount++;
        break;
      case 'gate:pass':
        newStatus = 'passed';
        portal.passCount++;
        break;
      case 'gate:fail':
        newStatus = 'failed';
        portal.failCount++;
        break;
    }

    portal.status = newStatus;
    portal.lastEvent = event;
    portal.lastUpdated = event.timestamp;

    // Reset status to idle after a delay (for animation purposes)
    // This is handled client-side
  }

  /**
   * Update flow state based on event
   */
  private updateFlowState(event: ViewerEvent): void {
    if (!event.gate || event.type !== 'gate:pass') return;

    // Check all flows to see if this gate is part of them
    for (const flow of this.flows.values()) {
      const gateIndex = flow.flow.gates.indexOf(event.gate);
      if (gateIndex === -1) continue;

      // Mark this gate as completed if it's the next expected gate
      if (gateIndex === flow.currentGateIndex) {
        flow.completedGates.push(event.gate);
        flow.currentGateIndex++;
        flow.progress = (flow.completedGates.length / flow.flow.gates.length) * 100;
        flow.status = 'in-progress';

        // Check if flow is complete
        if (flow.completedGates.length === flow.flow.gates.length) {
          flow.status = 'completed';
          if (this.currentSession) {
            this.currentSession.flowsCompleted.push(flow.id);
          }
        }
      }
    }
  }

  /**
   * Record event in current session
   */
  private recordSessionEvent(event: ViewerEvent): void {
    if (!this.currentSession) return;

    this.currentSession.events.push(event);
    this.currentSession.totalEvents++;

    // Update stats
    if (event.gate) {
      this.currentSession.gatesChecked++;
      if (event.decision === 'allow') {
        this.currentSession.gatesPassed++;
      } else if (event.decision === 'deny') {
        this.currentSession.gatesFailed++;
      }
    }

    // Track entity journey
    this.updateEntityJourney(event);
  }

  /**
   * Update entity journey tracking
   */
  private updateEntityJourney(event: ViewerEvent): void {
    if (!this.currentSession) return;

    let journey = this.currentSession.entities[event.entityId];
    if (!journey) {
      journey = {
        entityId: event.entityId,
        firstSeen: event.timestamp,
        lastSeen: event.timestamp,
        events: [],
        gatesVisited: [],
        flowProgress: {},
      };
      this.currentSession.entities[event.entityId] = journey;
    }

    journey.events.push(event);
    journey.lastSeen = event.timestamp;

    if (event.gate && !journey.gatesVisited.includes(event.gate)) {
      journey.gatesVisited.push(event.gate);
    }

    // Update flow progress for this entity
    for (const flow of this.flows.values()) {
      const completedInFlow = journey.gatesVisited.filter((g) =>
        flow.flow.gates.includes(g)
      ).length;
      journey.flowProgress[flow.id] =
        (completedInFlow / flow.flow.gates.length) * 100;
    }
  }

  // ============================================
  // Session Management
  // ============================================

  startSession(name?: string): PortalSession {
    const session: PortalSession = {
      id: randomUUID(),
      name: name || `Session ${new Date().toISOString()}`,
      startedAt: new Date().toISOString(),
      status: 'active',
      totalEvents: 0,
      gatesChecked: 0,
      gatesPassed: 0,
      gatesFailed: 0,
      flowsCompleted: [],
      events: [],
      entities: {},
    };

    this.currentSession = session;
    return session;
  }

  endSession(): PortalSession | null {
    if (!this.currentSession) return null;

    this.currentSession.endedAt = new Date().toISOString();
    this.currentSession.status = 'completed';

    const session = this.currentSession;
    this.currentSession = null;
    return session;
  }

  renameSession(name: string): PortalSession | null {
    if (!this.currentSession) return null;
    this.currentSession.name = name;
    return this.currentSession;
  }

  getSession(): PortalSession | null {
    return this.currentSession;
  }

  // ============================================
  // Stats Management
  // ============================================

  resetStats(): void {
    for (const portal of this.portals.values()) {
      portal.status = 'idle';
      portal.hitCount = 0;
      portal.passCount = 0;
      portal.failCount = 0;
      portal.lastEvent = undefined;
      portal.lastUpdated = undefined;
    }

    for (const flow of this.flows.values()) {
      flow.progress = 0;
      flow.currentGateIndex = 0;
      flow.completedGates = [];
      flow.status = 'idle';
    }
  }

  // ============================================
  // Getters
  // ============================================

  getPortals(): PortalNode[] {
    return Array.from(this.portals.values());
  }

  getFlows(): FlowNode[] {
    return Array.from(this.flows.values());
  }

  getPortal(id: string): PortalNode | undefined {
    return this.portals.get(id);
  }

  getFlow(id: string): FlowNode | undefined {
    return this.flows.get(id);
  }
}
