import {
  GateCheck,
  GateGuard,
  getGateClient,
  setGateClient
} from "./chunk-BRTWJEZU.js";

// src/client.ts
import { parseGateConfig } from "@horizon/gate-core";

// src/evaluator.ts
function tokenize(expr) {
  const tokens = [];
  let i = 0;
  while (i < expr.length) {
    const char = expr[i];
    if (/\s/.test(char)) {
      i++;
      continue;
    }
    if (char === '"' || char === "'") {
      const quote = char;
      let str = "";
      i++;
      while (i < expr.length && expr[i] !== quote) {
        if (expr[i] === "\\" && i + 1 < expr.length) {
          i++;
          str += expr[i];
        } else {
          str += expr[i];
        }
        i++;
      }
      i++;
      tokens.push({ type: "STRING", value: str });
      continue;
    }
    if (/\d/.test(char)) {
      let num = "";
      while (i < expr.length && /[\d.]/.test(expr[i])) {
        num += expr[i];
        i++;
      }
      tokens.push({ type: "NUMBER", value: num });
      continue;
    }
    if (/[a-zA-Z_]/.test(char)) {
      let ident = "";
      while (i < expr.length && /[a-zA-Z0-9_]/.test(expr[i])) {
        ident += expr[i];
        i++;
      }
      if (ident === "true" || ident === "false") {
        tokens.push({ type: "BOOLEAN", value: ident });
      } else if (ident === "null" || ident === "undefined") {
        tokens.push({ type: "NULL", value: ident });
      } else if (["and", "or", "not", "includes", "in"].includes(ident)) {
        tokens.push({ type: "OPERATOR", value: ident });
      } else {
        tokens.push({ type: "IDENTIFIER", value: ident });
      }
      continue;
    }
    if (expr.slice(i, i + 3) === "===" || expr.slice(i, i + 3) === "!==") {
      tokens.push({ type: "OPERATOR", value: expr.slice(i, i + 3) });
      i += 3;
      continue;
    }
    if (expr.slice(i, i + 2) === "==" || expr.slice(i, i + 2) === "!=" || expr.slice(i, i + 2) === "<=" || expr.slice(i, i + 2) === ">=" || expr.slice(i, i + 2) === "&&" || expr.slice(i, i + 2) === "||") {
      tokens.push({ type: "OPERATOR", value: expr.slice(i, i + 2) });
      i += 2;
      continue;
    }
    if ("<>=!".includes(char)) {
      tokens.push({ type: "OPERATOR", value: char });
      i++;
      continue;
    }
    if (char === "(") {
      tokens.push({ type: "LPAREN", value: char });
      i++;
      continue;
    }
    if (char === ")") {
      tokens.push({ type: "RPAREN", value: char });
      i++;
      continue;
    }
    if (char === ".") {
      tokens.push({ type: "DOT", value: char });
      i++;
      continue;
    }
    if (char === ",") {
      tokens.push({ type: "COMMA", value: char });
      i++;
      continue;
    }
    i++;
  }
  tokens.push({ type: "EOF", value: "" });
  return tokens;
}
var ExpressionEvaluator = class {
  tokens;
  pos;
  context;
  constructor(tokens, context) {
    this.tokens = tokens;
    this.pos = 0;
    this.context = context;
  }
  current() {
    return this.tokens[this.pos] || { type: "EOF", value: "" };
  }
  advance() {
    const token = this.current();
    this.pos++;
    return token;
  }
  evaluate() {
    return this.parseOr();
  }
  parseOr() {
    let left = this.parseAnd();
    while (this.current().value === "||" || this.current().value === "or") {
      this.advance();
      const right = this.parseAnd();
      left = Boolean(left) || Boolean(right);
    }
    return left;
  }
  parseAnd() {
    let left = this.parseNot();
    while (this.current().value === "&&" || this.current().value === "and") {
      this.advance();
      const right = this.parseNot();
      left = Boolean(left) && Boolean(right);
    }
    return left;
  }
  parseNot() {
    if (this.current().value === "!" || this.current().value === "not") {
      this.advance();
      return !Boolean(this.parseNot());
    }
    return this.parseComparison();
  }
  parseComparison() {
    let left = this.parsePrimary();
    const op = this.current();
    if (op.type === "OPERATOR") {
      switch (op.value) {
        case "==":
        case "===":
          this.advance();
          return left === this.parsePrimary();
        case "!=":
        case "!==":
          this.advance();
          return left !== this.parsePrimary();
        case "<":
          this.advance();
          return left < this.parsePrimary();
        case ">":
          this.advance();
          return left > this.parsePrimary();
        case "<=":
          this.advance();
          return left <= this.parsePrimary();
        case ">=":
          this.advance();
          return left >= this.parsePrimary();
        case "includes":
          this.advance();
          const includesValue = this.parsePrimary();
          if (Array.isArray(left)) {
            return left.includes(includesValue);
          }
          if (typeof left === "string") {
            return left.includes(String(includesValue));
          }
          return false;
        case "in":
          this.advance();
          const inArray = this.parsePrimary();
          if (Array.isArray(inArray)) {
            return inArray.includes(left);
          }
          return false;
      }
    }
    return left;
  }
  parsePrimary() {
    const token = this.current();
    if (token.type === "LPAREN") {
      this.advance();
      const value = this.parseOr();
      if (this.current().type === "RPAREN") {
        this.advance();
      }
      return value;
    }
    if (token.type === "STRING") {
      this.advance();
      return token.value;
    }
    if (token.type === "NUMBER") {
      this.advance();
      return parseFloat(token.value);
    }
    if (token.type === "BOOLEAN") {
      this.advance();
      return token.value === "true";
    }
    if (token.type === "NULL") {
      this.advance();
      return null;
    }
    if (token.type === "IDENTIFIER") {
      return this.parseIdentifier();
    }
    return null;
  }
  parseIdentifier() {
    let value = this.context;
    while (this.current().type === "IDENTIFIER" || this.current().type === "DOT") {
      if (this.current().type === "DOT") {
        this.advance();
        continue;
      }
      const key = this.advance().value;
      if (value !== null && typeof value === "object" && !Array.isArray(value)) {
        value = value[key];
      } else {
        value = void 0;
      }
      if (this.current().type === "LPAREN") {
        this.advance();
        const args = [];
        while (this.current().type !== "RPAREN" && this.current().type !== "EOF") {
          args.push(this.parseOr());
          if (this.current().type === "COMMA") {
            this.advance();
          }
        }
        if (this.current().type === "RPAREN") {
          this.advance();
        }
        return this.callMethod(key, value, args);
      }
      if (this.current().type !== "DOT") {
        break;
      }
    }
    return value;
  }
  callMethod(method, target, args) {
    switch (method) {
      case "includes":
        if (Array.isArray(target)) {
          return target.includes(args[0]);
        }
        if (typeof target === "string") {
          return target.includes(String(args[0]));
        }
        return false;
      case "startsWith":
        if (typeof target === "string") {
          return target.startsWith(String(args[0]));
        }
        return false;
      case "endsWith":
        if (typeof target === "string") {
          return target.endsWith(String(args[0]));
        }
        return false;
      case "length":
        if (Array.isArray(target) || typeof target === "string") {
          return target.length;
        }
        return 0;
      default:
        return null;
    }
  }
};
function evaluateExpression(expression, context) {
  try {
    const tokens = tokenize(expression);
    const evaluator = new ExpressionEvaluator(tokens, context);
    const result = evaluator.evaluate();
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
function createExpressionContext(entity) {
  return entity;
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
