import type { Dossier, Document } from "@workspace/db";

export const SKILL_MODULES = [
  "CreditProductAdvisor",
  "FinancingNeedAssessor",
  "FinancingProductAdvisorDualView",
  "GeenbankKredietworkflow",
  "MoneycareKredietmemorandum",
] as const;

export type SkillModule = (typeof SKILL_MODULES)[number];

export const GATE_THRESHOLDS = {
  completeness: 60,
  correctness: 60,
  viability: 50,
  confidence: 60,
} as const;

export const REQUIRED_DOCUMENT_TYPES = [
  "annual_accounts",
  "bank_statements",
  "kvk_extract",
  "id_document",
] as const;

export const SUPPORTED_DOCUMENT_TYPES = [
  "annual_accounts",
  "bank_statements",
  "kvk_extract",
  "id_document",
  "forecast",
  "business_plan",
  "other",
] as const;

export type SupportedDocumentType = (typeof SUPPORTED_DOCUMENT_TYPES)[number];

export function isAiLive(): boolean {
  return Boolean(
    process.env.ANTHROPIC_API_KEY ||
      process.env.OPENAI_API_KEY ||
      process.env.AI_API_KEY,
  );
}

export function pct(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

export type SkillContext = {
  dossier: Dossier;
  documents: Document[];
  companyName: string;
};

export type SkillResult<T> = {
  module: SkillModule;
  ok: boolean;
  usedMockMode: boolean;
  data: T;
  error?: string;
  invocation: import("./runtime").SkillInvocation;
};

export type EntrepreneurReport = {
  headline: string;
  summary: string;
  strongPoints: string[];
  weakPoints: string[];
  actionPoints: string[];
  likelyFinancierAsks: string[];
  canSubmit: boolean;
};

export type FinancierReport = {
  companySummary: string;
  financingRequest: string;
  financialAnalysis: string;
  repaymentCapacity: string;
  riskFactors: string[];
  strengths: string[];
  recommendation: string;
};

export type AnalysisOutput = {
  completenessScore: number;
  correctnessScore: number;
  viabilityScore: number;
  confidenceScore: number;
  verdict: string;
  verdictSummary: string;
  entrepreneurReport: EntrepreneurReport;
  financierReport: FinancierReport;
  skillModulesUsed: SkillModule[];
  skillInvocations: import("./runtime").SkillInvocation[];
  usedMockMode: boolean;
  errors: string[];
};

export type Memorandum = {
  sections: Array<{ title: string; body: string }>;
  attachments: string[];
  partnerNotes: string | null;
  usedMockMode: boolean;
};

export function logSkillStart(module: SkillModule, dossierId: string): void {
  console.log(`[skill:${module}] starting for dossier=${dossierId}`);
}

export function logSkillSuccess(
  module: SkillModule,
  dossierId: string,
  mock: boolean,
): void {
  console.log(
    `[skill:${module}] completed for dossier=${dossierId} mock=${mock}`,
  );
}

/**
 * Forward-only typed contract for the AI skill chain. Not yet wired into
 * the orchestrator — kept here so adapters can start consuming a
 * normalized, fully-typed pipeline context (instead of the raw `Dossier`
 * row + ad-hoc derived numbers) without further schema churn.
 *
 * Intended chain order, mirroring `docs/ai-skill-source-mapping.md`:
 *   1. GeenbankKredietworkflow      → produces `workflow`
 *   2. FinancingNeedAssessor        → produces `needAssessment`
 *      (runs alongside the dual-view advisor; both consume `workflow`)
 *   3. FinancingProductAdvisorDualView → produces `dualView`
 *   4. MoneycareKredietmemorandum   → consumes 1-3 to produce the memo
 *
 * The `dualView`, `workflow`, `needAssessment` and `creditAdvice` slots
 * are intentionally `unknown` here — each adapter exports its own
 * concrete output type, and the orchestrator narrows them when it
 * builds the context. Keeping these as `unknown` avoids a runtime
 * coupling that would force every adapter to import every other
 * adapter's types.
 */
export type PipelineDossierSnapshot = {
  id: string;
  companyName: string;
  annualRevenue: number | null;
  annualCost: number | null;
  annualProfit: number | null;
  requestedAmount: number | null;
  financingTypePreference: string | null;
  financingPurpose: string | null;
  companyDescription: string | null;
};

export type PipelineDocumentFinding = {
  documentId: string;
  documentType: SupportedDocumentType;
  filename: string;
  validationStatus: "valid" | "invalid" | "pending";
  /** Short structured findings extracted by document validation. */
  notes: string[];
};

export type PipelineDerivedFinancials = {
  margin: number;
  dscr: number;
  revenue: number;
  profit: number;
  requested: number;
};

export type PipelineCondition = {
  id: string;
  category: string;
  severity: "blocking" | "advisory";
  status: "open" | "resolved";
  description: string;
};

export type PipelineContext = {
  dossier: PipelineDossierSnapshot;
  documents: PipelineDocumentFinding[];
  derived: PipelineDerivedFinancials;
  conditions: PipelineCondition[];
  /** Output of the GeenbankKredietworkflow skill (step 1). */
  workflow: unknown;
  /** Output of the FinancingNeedAssessor skill (step 2a). */
  needAssessment: unknown;
  /** Output of the CreditProductAdvisor skill (step 2b, optional). */
  creditAdvice: unknown;
  /** Output of the FinancingProductAdvisorDualView skill (step 3). */
  dualView: unknown;
};

export function logSkillError(
  module: SkillModule,
  dossierId: string,
  err: unknown,
): void {
  console.error(
    `[skill:${module}] failed for dossier=${dossierId}:`,
    err instanceof Error ? err.message : err,
  );
}
