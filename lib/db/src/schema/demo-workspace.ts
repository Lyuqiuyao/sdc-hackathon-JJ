import { pgTable, text, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

// One transactional aggregate for the competition demo. The ten domain entities
// are typed and related by IDs in the service layer; no financial amounts are floats.
// Optional JSONB aiLeases/adviceSnapshots are coordinated by the existing row
// lock. No new table/DDL migration; snapshots are application-level append-only.
export const demoWorkspaces = pgTable("demo_workspaces", {
  id: text("id").primaryKey(),
  payload: jsonb("payload").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export const insertDemoWorkspaceSchema = createInsertSchema(demoWorkspaces);
export type DemoWorkspaceRow = typeof demoWorkspaces.$inferSelect;
