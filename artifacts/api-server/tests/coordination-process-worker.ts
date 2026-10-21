// Only launched by the isolated PostgreSQL harness; no Web server is imported.
import { pool, db } from "@workspace/db";
import { createWorkspaceRepository } from "../src/lib/receivables/repository";
import { createPlanEnricher } from "../src/lib/receivables/ai-enrichment";
import { syntheticAdvice } from "./synthetic-advice";

if (!process.env.SDC_ISOLATED_SOCKET_DIR || !process.env.SDC_ISOLATED_DB ||
  !process.env.DATABASE_URL?.includes(encodeURIComponent(process.env.SDC_ISOLATED_SOCKET_DIR)))
  throw Error("Isolated database guard required");
let release!: () => void;
const hold = new Promise<void>(resolve => { release = resolve; });
process.on("message", async (message: {type:string;planId?:string;workspaceId?:string}) => {
  if (message.type === "release") { release(); return; }
  if (message.type !== "run") return;
  try {
    const repo = createWorkspaceRepository(db, message.workspaceId!);
    const enrich = createPlanEnricher(repo, (s,p) => syntheticAdvice(s,p,async()=>{
      process.send?.({type:"transport"});await hold;
    }));
    const result = await enrich(message.planId!);
    process.send?.({type:"done",providerMode:result.providerMode});
  } catch {
    process.send?.({type:"failed",reason:"isolated_worker_failed"});
  } finally {
    await pool.end();process.disconnect();
  }
});
process.send?.({type:"ready"});
