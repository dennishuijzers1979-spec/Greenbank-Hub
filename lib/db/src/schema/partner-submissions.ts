import {
  pgTable,
  text,
  timestamp,
  uuid,
  boolean,
} from "drizzle-orm/pg-core";
import { dossiersTable } from "./dossiers";
import { partnerFinanciersTable } from "./partner-financiers";

export const partnerSubmissionsTable = pgTable("partner_submissions", {
  id: uuid("id").primaryKey().defaultRandom(),
  dossierId: uuid("dossier_id")
    .notNull()
    .references(() => dossiersTable.id, { onDelete: "cascade" }),
  partnerId: uuid("partner_id")
    .notNull()
    .references(() => partnerFinanciersTable.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("queued"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  packageSummary: text("package_summary"),
  responseStatus: text("response_status"),
  responseNotes: text("response_notes"),
  usedMockMode: boolean("used_mock_mode").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type PartnerSubmission = typeof partnerSubmissionsTable.$inferSelect;
