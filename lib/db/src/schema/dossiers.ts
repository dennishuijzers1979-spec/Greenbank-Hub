import {
  pgTable,
  text,
  timestamp,
  uuid,
  numeric,
  doublePrecision,
} from "drizzle-orm/pg-core";
import { prospectProfilesTable } from "./prospect-profiles";

export const dossiersTable = pgTable("dossiers", {
  id: uuid("id").primaryKey().defaultRandom(),
  prospectId: uuid("prospect_id")
    .notNull()
    .unique()
    .references(() => prospectProfilesTable.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("intake_in_progress"),
  currentStage: text("current_stage").notNull().default("Intake"),
  financingPurpose: text("financing_purpose"),
  requestedAmount: numeric("requested_amount"),
  financingTypePreference: text("financing_type_preference"),
  existingFinancing: text("existing_financing"),
  annualRevenue: numeric("annual_revenue"),
  annualCost: numeric("annual_cost"),
  annualProfit: numeric("annual_profit"),
  companyDescription: text("company_description"),
  completenessScore: doublePrecision("completeness_score"),
  correctnessScore: doublePrecision("correctness_score"),
  viabilityScore: doublePrecision("viability_score"),
  confidenceScore: doublePrecision("confidence_score"),
  aiVerdict: text("ai_verdict"),
  loanOfficerDecision: text("loan_officer_decision"),
  loanOfficerNotes: text("loan_officer_notes"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Dossier = typeof dossiersTable.$inferSelect;
