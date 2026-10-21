// Preloaded before all simulated tests. Never call an external service.
globalThis.fetch = async () => {
  throw new Error("External network is disabled in simulated tests; inject a fake SDK fetch.");
};
