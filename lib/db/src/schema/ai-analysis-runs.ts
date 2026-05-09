import {
  pgTable,
  text,
  timestamp,
  uuid,
  doublePrecision,
  boolean,
  jsonb,
} from "drizzle-orm/pg-core";
import { dossiersTable } from "./dossiers";

export const aiAnalysisRunsTable = pgTable("ai_analysis_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  dossierId: uuid("dossier_id")
    .notNull()
    .references(() => dossiersTable.id, { onDelete: "cascade" }),
  runType: text("run_type").notNull(),
  status: text("status").notNull().default("running"),
  startedAt: timestamp("started_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  skillModulesUsed: jsonb("skill_modules_used").notNull().default([]),
  skillInvocations: jsonb("skill_invocations").notNull().default([]),
  completenessScore: doublePrecision("completeness_score"),
  correctnessScore: doublePrecision("correctness_score"),
  viabilityScore: doublePrecision("viability_score"),
  confidenceScore: doublePrecision("confidence_score"),
  verdict: text("verdict"),
  verdictSummary: text("verdict_summary"),
  entrepreneurReport: jsonb("entrepreneur_report"),
  financierReport: jsonb("financier_report"),
  memorandum: jsonb("memorandum"),
  usedMockMode: boolean("used_mock_mode").notNull().default(true),
  errors: jsonb("errors").notNull().default([]),
});

export type AIAnalysisRun = typeof aiAnalysisRunsTable.$inferSelect;
