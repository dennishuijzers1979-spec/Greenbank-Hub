import { pgTable, text, timestamp, uuid, jsonb } from "drizzle-orm/pg-core";
import { dossiersTable } from "./dossiers";

export const activityLogsTable = pgTable("activity_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  dossierId: uuid("dossier_id").references(() => dossiersTable.id, {
    onDelete: "cascade",
  }),
  actorType: text("actor_type").notNull(),
  actorId: uuid("actor_id"),
  actorLabel: text("actor_label"),
  action: text("action").notNull(),
  description: text("description").notNull(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type ActivityLogEntry = typeof activityLogsTable.$inferSelect;
