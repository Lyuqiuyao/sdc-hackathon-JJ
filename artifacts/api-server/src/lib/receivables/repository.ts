import { eq, sql } from "drizzle-orm";
import { db, demoWorkspaces } from "@workspace/db";
import { seedState } from "./seed";
import { DEMO_WORKSPACE_ID, BusinessError, type DemoState } from "./model";
import { assertSnapshotsAppendOnly } from "./advice-snapshots";

export function createWorkspaceRepository(database: typeof db, workspaceId = DEMO_WORKSPACE_ID) {
async function readState(): Promise<DemoState> {
  const [row] = await database.select().from(demoWorkspaces).where(eq(demoWorkspaces.id, workspaceId));
  if (row) return row.payload as DemoState;
  await database.insert(demoWorkspaces).values({ id: workspaceId, payload: seedState() }).onConflictDoNothing();
  const [created] = await database.select().from(demoWorkspaces).where(eq(demoWorkspaces.id, workspaceId));
  if (!created) throw new Error("Demo workspace initialization failed");
  return created.payload as DemoState;
}

// Database row locking serializes decisions and idempotent execution across tabs
// and processes. Mutations and their audit entries commit or roll back together.
async function changeState<T>(operation: (state: DemoState, databaseNowMs?: number) => T): Promise<T> {
  await readState();
  return database.transaction(async tx => {
    const [row] = await tx.select().from(demoWorkspaces).where(eq(demoWorkspaces.id, workspaceId)).for("update");
    if (!row) throw new Error("Demo workspace not found");
    const state = row.payload as DemoState;
    if (state.workspaceId && state.workspaceId !== workspaceId) throw new BusinessError("Workspace association mismatch.", 409);
    state.workspaceId = workspaceId;
    const previous = structuredClone(state.adviceSnapshots ?? []);
    // Read the database clock after acquiring the lock, not a possibly skewed
    // worker clock or the transaction-start timestamp before waiting.
    const clock = await tx.execute<{ now_ms: string }>(sql`select floor(extract(epoch from clock_timestamp()) * 1000)::text as now_ms`);
    const time = Number(clock.rows[0]?.now_ms);
    if (!Number.isSafeInteger(time)) throw new Error("Database clock unavailable");
    const result = operation(state, time);
    if (state.workspaceId !== workspaceId) throw new BusinessError("Workspace association mismatch.", 409);
    assertSnapshotsAppendOnly(previous, state.adviceSnapshots ?? []);
    await tx.update(demoWorkspaces).set({ payload: state, updatedAt: new Date(time) }).where(eq(demoWorkspaces.id, workspaceId));
    return result;
  });
}
return { workspaceId, readState, changeState };
}
const repository = createWorkspaceRepository(db);
export const { readState, changeState } = repository;
export const workspaceId = repository.workspaceId;
