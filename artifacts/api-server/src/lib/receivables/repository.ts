import { eq } from "drizzle-orm";
import { db, demoWorkspaces } from "@workspace/db";
import { seedState } from "./seed";
import type { DemoState } from "./model";

const ID = "synthetic-demo-admin";
async function ensureSeeded() {
  await db.insert(demoWorkspaces).values({ id: ID, payload: seedState() }).onConflictDoNothing();
}

export async function readState(): Promise<DemoState> {
  const [row] = await db.select().from(demoWorkspaces).where(eq(demoWorkspaces.id, ID));
  if (row) return row.payload as DemoState;
  await ensureSeeded();
  const [created] = await db.select().from(demoWorkspaces).where(eq(demoWorkspaces.id, ID));
  if (!created) throw new Error("Demo workspace initialization failed");
  return created.payload as DemoState;
}

// Database row locking serializes decisions and idempotent execution across tabs
// and processes. Mutations and their audit entries commit or roll back together.
export async function changeState<T>(operation: (state: DemoState) => T): Promise<T> {
  await readState();
  return db.transaction(async tx => {
    const [row] = await tx.select().from(demoWorkspaces).where(eq(demoWorkspaces.id, ID)).for("update");
    if (!row) throw new Error("Demo workspace not found");
    const state = row.payload as DemoState;
    const result = operation(state);
    await tx.update(demoWorkspaces).set({ payload: state, updatedAt: new Date() }).where(eq(demoWorkspaces.id, ID));
    return result;
  });
}
