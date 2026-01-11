import {
  GateCheck,
  GateGuard,
  getGateClient,
  setGateClient
} from "./chunk-BRTWJEZU.js";

// src/client.ts
import { parseGateConfig } from "@horizon/gate-core";

// src/evaluator.ts
import { Parser } from "expr-eval";
var parser = new Parser({
  operators: {
    // Enable comparison operators
    comparison: true,
    // Enable logical operators
    logical: true,
    // Enable 'in' operator
    in: true,
    // Disable assignment for safety
    assignment: false
  }
});
parser.functions.includes = (arr, value) => {
  if (Array.isArray(arr)) {
    return arr.includes(value);
  }
  if (typeof arr === "string") {
    return arr.includes(String(value));
  }
  return false;
};
parser.functions.length = (arr) => {
  if (Array.isArray(arr) || typeof arr === "string") {
    return arr.length;
  }
  return 0;
};
parser.functions.exists = (value) => {
  return value !== null && value !== void 0;
};
parser.functions.isEmpty = (value) => {
  if (value === null || value === void 0) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "string") return value.length === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  return false;
};
parser.functions.startsWith = (str, prefix) => {
  if (typeof str === "string" && typeof prefix === "string") {
    return str.startsWith(prefix);
  }
  return false;
};
parser.functions.endsWith = (str, suffix) => {
  if (typeof str === "string" && typeof suffix === "string") {
    return str.endsWith(suffix);
  }
  return false;
};
parser.functions.matches = (str, pattern) => {
  if (typeof str === "string" && typeof pattern === "string") {
    try {
      return new RegExp(pattern).test(str);
    } catch {
      return false;
    }
  }
  return false;
};
function evaluateExpression(expression, context) {
  try {
    let normalizedExpr = expression.replace(/===/g, "==").replace(/!==/g, "!=").replace(/(\w+)\.includes\(([^)]+)\)/g, "includes($1, $2)").replace(/(\w+)\.startsWith\(([^)]+)\)/g, "startsWith($1, $2)").replace(/(\w+)\.endsWith\(([^)]+)\)/g, "endsWith($1, $2)");
    normalizedExpr = normalizedExpr.replace(/(\w+(?:\.\w+)*)\.length/g, "length($1)");
    const flatContext = flattenContext(context);
    const expr = parser.parse(normalizedExpr);
    const result = expr.evaluate(flatContext);
    return {
      passed: Boolean(result)
    };
  } catch (error) {
    return {
      passed: false,
      error: error.message
    };
  }
}
function flattenContext(obj, prefix = "") {
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}_${key}` : key;
    result[key] = value;
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      const nested = flattenContext(value, fullKey);
      Object.assign(result, nested);
    }
  }
  return result;
}
function createExpressionContext(entity) {
  return flattenContext(entity);
}

// src/client.ts
var GateClient = class {
  config;
  prizeHandlers = /* @__PURE__ */ new Map();
  firedPrizes = [];
  ws = null;
  options;
  entityIdResolver;
  constructor(config, options = {}) {
    this.config = config;
    this.options = options;
    this.entityIdResolver = options.entityIdResolver || this.defaultEntityIdResolver;
    if (options.devMode) {
      this.connectWatcher();
    }
  }
  /**
   * Default entity ID resolver - looks for id, _id, userId, entityId
   */
  defaultEntityIdResolver(entity) {
    return entity.id || entity._id || entity.userId || entity.entityId || "anonymous";
  }
  /**
   * Connect to the Gate watcher server
   */
  connectWatcher() {
    const url = this.options.watcherUrl || `ws://localhost:${this.config.settings.dev.watcherPort}`;
    try {
      if (typeof WebSocket !== "undefined") {
        this.ws = new WebSocket(url);
        this.ws.onopen = () => {
          console.log("[Gate SDK] Connected to watcher");
        };
        this.ws.onerror = () => {
          console.warn("[Gate SDK] Failed to connect to watcher");
        };
        this.ws.onclose = () => {
          setTimeout(() => this.connectWatcher(), 5e3);
        };
      }
    } catch {
      console.warn("[Gate SDK] WebSocket not available for watcher connection");
    }
  }
  /**
   * Send event to watcher
   */
  sendWatcherEvent(event) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(event));
    }
  }
  /**
   * Register a handler for a prize
   */
  onPrize(prizeId, handler) {
    if (!this.prizeHandlers.has(prizeId)) {
      this.prizeHandlers.set(prizeId, []);
    }
    this.prizeHandlers.get(prizeId).push(handler);
    return () => {
      const handlers = this.prizeHandlers.get(prizeId);
      if (handlers) {
        const index = handlers.indexOf(handler);
        if (index >= 0) {
          handlers.splice(index, 1);
        }
      }
    };
  }
  /**
   * Check if an entity can pass through a gate
   */
  async check(gateId, entity) {
    const gate = this.config.gates.find((g) => g.id === gateId);
    if (!gate) {
      throw new Error(`Gate not found: ${gateId}`);
    }
    const entityId = this.entityIdResolver(entity);
    const timestamp = Date.now();
    this.sendWatcherEvent({
      type: "gate:check",
      timestamp,
      entityId,
      data: { gate, entitySnapshot: entity }
    });
    const lockResults = [];
    let allLocksPassed = true;
    for (const lock of gate.locks) {
      const keyResults = [];
      let lockPassed;
      if (lock.mode === "any") {
        lockPassed = false;
        for (const key of lock.keys) {
          const { passed, error } = evaluateExpression(key.expression, entity);
          keyResults.push({ key, passed, error });
          if (passed) {
            lockPassed = true;
          }
        }
      } else {
        lockPassed = true;
        for (const key of lock.keys) {
          const { passed, error } = evaluateExpression(key.expression, entity);
          keyResults.push({ key, passed, error });
          if (!passed) {
            lockPassed = false;
          }
        }
      }
      lockResults.push({
        lock,
        passed: lockPassed,
        keyResults
      });
      if (!lockPassed) {
        allLocksPassed = false;
      }
    }
    const triggeredPrizes = [];
    if (allLocksPassed) {
      for (const prize of gate.prizes) {
        if (prize.oneTime) {
          const alreadyFired = this.firedPrizes.some(
            (fp) => fp.entityId === entityId && fp.prizeId === prize.id
          );
          if (alreadyFired) {
            continue;
          }
        }
        triggeredPrizes.push(prize);
        if (prize.oneTime) {
          this.firedPrizes.push({
            entityId,
            prizeId: prize.id,
            timestamp
          });
        }
        const handlers = this.prizeHandlers.get(prize.id) || [];
        for (const handler of handlers) {
          try {
            await handler(entity, {
              gate,
              prize,
              timestamp
            });
          } catch (error) {
            console.error(`[Gate SDK] Prize handler error for ${prize.id}:`, error);
          }
        }
        this.sendWatcherEvent({
          type: "prize:fire",
          timestamp: Date.now(),
          entityId,
          data: { prizeId: prize.id, metadata: prize.metadata }
        });
      }
    }
    const result = {
      gate,
      passed: allLocksPassed,
      lockResults,
      triggeredPrizes,
      timestamp,
      entitySnapshot: entity
    };
    this.sendWatcherEvent({
      type: allLocksPassed ? "gate:pass" : "gate:fail",
      timestamp: Date.now(),
      entityId,
      data: result
    });
    return result;
  }
  /**
   * Get a gate by ID
   */
  getGate(gateId) {
    return this.config.gates.find((g) => g.id === gateId);
  }
  /**
   * Get all gates
   */
  getGates() {
    return this.config.gates;
  }
  /**
   * Get all flows
   */
  getFlows() {
    return this.config.flows;
  }
  /**
   * Reset fired prizes for an entity (useful for testing)
   */
  resetPrizes(entityId) {
    if (entityId) {
      this.firedPrizes = this.firedPrizes.filter((fp) => fp.entityId !== entityId);
    } else {
      this.firedPrizes = [];
    }
  }
  /**
   * Disconnect from watcher
   */
  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
};
async function createGate(configPath, options = {}) {
  const config = await parseGateConfig(configPath);
  const devMode = options.devMode ?? process.env.NODE_ENV !== "production";
  return new GateClient(config, {
    ...options,
    devMode
  });
}
export {
  GateCheck,
  GateClient,
  GateGuard,
  createExpressionContext,
  createGate,
  evaluateExpression,
  getGateClient,
  setGateClient
};
