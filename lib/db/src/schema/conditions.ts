import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { dossiersTable } from "./dossiers";
import { documentsTable } from "./documents";
import { usersTable } from "./users";

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
  // Prospect response fields. When the prospect submits a response to a
  // requested item we record either free-text or a linked document (or
  // both). The condition status moves from "open" to "submitted".
  responseText: text("response_text"),
  responseDocumentId: uuid("response_document_id").references(
    () => documentsTable.id,
    { onDelete: "set null" },
  ),
  respondedAt: timestamp("responded_at", { withTimezone: true }),
  respondedBy: uuid("responded_by").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  // Loan-officer review fields. When the officer accepts a submitted
  // response the condition moves to "resolved". `reviewerNotes` is
  // internal-only and must NOT be exposed to the prospect.
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolvedBy: uuid("resolved_by").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  reviewerNotes: text("reviewer_notes"),
  // Prospect-facing copy, set by the loan officer when this condition is
  // explicitly requested from the entrepreneur. When `requestedAt` is
  // null, the condition is internal-only and MUST NOT be shown to the
  // prospect. The plain `title`/`description`/`requiredAction` columns
  // are internal credit/AI language and stay invisible to the prospect.
  prospectTitle: text("prospect_title"),
  prospectExplanation: text("prospect_explanation"),
  prospectRequiredAction: text("prospect_required_action"),
  documentTypeHint: text("document_type_hint"),
  requestedAt: timestamp("requested_at", { withTimezone: true }),
  requestedBy: uuid("requested_by").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Condition = typeof conditionsTable.$inferSelect;
