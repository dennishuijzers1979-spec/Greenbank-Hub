import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { dossiersTable } from "./dossiers";

export const conditionsTable = pgTable("conditions", {
  id: uuid("id").primaryKey().defaultRandom(),
  dossierId: uuid("dossier_id")
    .notNull()
    .references(() => dossiersTable.id, { onDelete: "cascade" }),
  type: text("type", { enum: ["blocking", "non_blocking"] }).notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  requiredAction: text("required_action"),
  status: text("status").notNull().default("open"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Condition = typeof conditionsTable.$inferSelect;
