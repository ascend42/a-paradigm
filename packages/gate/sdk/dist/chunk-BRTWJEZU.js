// src/decorators/index.ts
var globalGateClient = null;
function setGateClient(client) {
  globalGateClient = client;
}
function getGateClient() {
  return globalGateClient;
}
var defaultEntityResolver = (_target, args) => {
  const firstArg = args[0];
  if (firstArg && typeof firstArg === "object") {
    return firstArg;
  }
  return {};
};
function GateGuard(gateId, options = {}) {
  const {
    entityResolver = defaultEntityResolver,
    onFail = "throw",
    errorMessage = `Access denied: failed to pass gate "${gateId}"`
  } = options;
  return function(_target, _propertyKey, descriptor) {
    const originalMethod = descriptor.value;
    descriptor.value = async function(...args) {
      if (!globalGateClient) {
        throw new Error("[GateGuard] No gate client configured. Call setGateClient() first.");
      }
      const entity = entityResolver(this, args);
      const result = await globalGateClient.check(gateId, entity);
      if (!result.passed) {
        switch (onFail) {
          case "return-null":
            return null;
          case "return-false":
            return false;
          case "throw":
          default:
            throw new Error(errorMessage);
        }
      }
      return originalMethod.apply(this, args);
    };
    return descriptor;
  };
}
function GateCheck(gateId, options = {}) {
  const { entityResolver = defaultEntityResolver } = options;
  return function(_target, _propertyKey, descriptor) {
    const originalMethod = descriptor.value;
    descriptor.value = async function(...args) {
      if (!globalGateClient) {
        console.warn("[GateCheck] No gate client configured");
        return originalMethod.apply(this, args);
      }
      const entity = entityResolver(this, args);
      const gateResult = await globalGateClient.check(gateId, entity);
      const context = this;
      context._gateResult = gateResult;
      return originalMethod.apply(this, args);
    };
    return descriptor;
  };
}

export {
  setGateClient,
  getGateClient,
  GateGuard,
  GateCheck
};
