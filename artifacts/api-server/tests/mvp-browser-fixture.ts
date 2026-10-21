// Test-only in-browser API. Never imported by production sources.
// The test build substitutes Node crypto for a deterministic UI-only checksum;
// real hashing, locking and persistence are covered by Node/PostgreSQL tests.
import { seedState } from "../src/lib/receivables/seed";
import * as service from "../src/lib/receivables/service";
import { saveProfile, submitSedg } from "../src/lib/receivables/company";
import { listAdviceSnapshots } from "../src/lib/receivables/advice-snapshots";
import { BusinessError, type DemoState } from "../src/lib/receivables/model";

const fixtureWindow = window as typeof window & {
  __SDC_OFFLINE_FIXTURE__?: boolean;
  __sdcFixture?: { getState: () => DemoState; calls: string[]; externalAttempts: () => number };
};
if (!fixtureWindow.__SDC_OFFLINE_FIXTURE__) throw Error("Offline test fixture was not explicitly enabled.");
let state: DemoState;
const stored = sessionStorage.getItem("sdc-offline-mvp-test");
if (stored) state = JSON.parse(stored);
else {
  state = seedState();
  // One unknown customer makes this isolated UI journey concise; production
  // seeds retain the full mixed cohort and are tested separately.
  state.customers.forEach(c => { c.esgRating = c.id === "CUS-003" ? "unknown" : "A"; });
  state.plans = []; state.riskEvents = []; state.auditLogs = [];
  service.riskCheck(state);
}
const calls: string[] = [];
let externalAttempts = 0;
fixtureWindow.__sdcFixture = { getState: () => structuredClone(state), calls, externalAttempts: () => externalAttempts };
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.origin);
  if (url.origin !== location.origin || !url.pathname.startsWith("/api/")) {
    externalAttempts++;
    throw Error("All non-fixture fetch calls are disabled in this isolated browser test.");
  }
  const path = url.pathname.slice(4);
  const method = init?.method ?? (input instanceof Request ? input.method : "GET");
  const text = init?.body ?? (input instanceof Request ? await input.clone().text() : "");
  const body = text ? JSON.parse(String(text)) : {};
  calls.push(`${method} ${path}`);
  const backup = structuredClone(state);
  try {
    let result: unknown;
    let match: RegExpMatchArray | null;
    if (method === "GET" && path === "/healthz") result = {status:"ok"};
    else if (method === "GET" && path === "/workspace") result = service.workspace(state);
    else if (method === "POST" && path === "/plans") result = service.generate(state, body);
    else if (method === "POST" && path === "/risk-checks") result = service.riskCheck(state);
    else if (method === "PUT" && (match = path.match(/^\/customers\/([^/]+)\/profile$/))) result = saveProfile(state, match[1]!, body);
    else if (method === "POST" && (match = path.match(/^\/customers\/([^/]+)\/sedg$/))) result = submitSedg(state, match[1]!, body);
    else if (method === "PATCH" && (match = path.match(/^\/plans\/([^/]+)$/))) result = service.edit(state, match[1]!, body);
    else if (method === "POST" && (match = path.match(/^\/plans\/([^/]+)\/decision$/))) result = service.decide(state, match[1]!, body);
    else if (method === "POST" && (match = path.match(/^\/plans\/([^/]+)\/execute$/))) result = service.execute(state, match[1]!);
    else if (method === "GET" && (match = path.match(/^\/plans\/([^/]+)\/advice-snapshots$/))) result = listAdviceSnapshots(state, match[1]!);
    else throw new BusinessError("Offline fixture route not supported.", 404);
    sessionStorage.setItem("sdc-offline-mvp-test", JSON.stringify(state));
    return Response.json(result);
  } catch (error) {
    state = backup;
    return Response.json({ error: error instanceof BusinessError ? error.message : "Offline test operation failed." },
      { status: error instanceof BusinessError ? error.status : 500 });
  }
};
