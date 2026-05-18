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
  /**
   * Display-friendly company label. May fall back to a placeholder
   * (e.g. "Onbekend") when the prospect profile has no company name —
   * safe for mock copy and UI strings, but MUST NOT be sent as a real
   * borrower identity to a live skill. Use `borrowerName` for that.
   */
  companyName: string;
  /**
   * Real, normalized borrower identity for live credit-workflow calls.
   * Trimmed prospect company name, or `null` when missing/empty.
   * Live adapters MUST refuse to call the LLM when this is `null` —
   * never substitute a fake name like "Onbekend" for a real credit
   * decision.
   */
  borrowerName: string | null;
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

export type MemorandumPartnerPackage = {
  partnerId: string;
  partnerName: string;
  productFocus: string;
  ticketRange: string | null;
  fitsTicketRange: boolean;
  partnerNotes: string | null;
  packageSummary: string;
};

/**
 * Structured Dutch credit memorandum / partner package payload, built
 * by `MoneycareKredietmemorandumAdapter.buildMemorandum`.
 *
 * - `sections` is the readable financier-facing memo (one Dutch
 *   section per spec heading; "Niet beschikbaar" when data missing).
 * - `evidenceGaps` lists every data source that was missing or empty
 *   so the loan officer can address gaps before sending. The adapter
 *   never invents facts — gaps are surfaced explicitly.
 * - `partnerPackages` is the per-partner package preview, populated
 *   when the loan officer passes `selectedPartners`. Empty otherwise.
 * - `verdict` mirrors the GeenbankKredietworkflow verdict the memo
 *   was built from (kansrijk / voorwaardelijk / afwijzen / null).
 * - `usedMockMode` propagates from the adapter runtime so the UI can
 *   mark the memo as mock when the live AI provider was not used.
 */
export type Memorandum = {
  sections: Array<{ title: string; body: string }>;
  attachments: string[];
  partnerNotes: string | null;
  partnerPackages: MemorandumPartnerPackage[];
  evidenceGaps: string[];
  verdict: string | null;
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

/**
 * Enriched hand-off slot produced by the GeenbankKredietworkflow skill
 * (the canonical credit-analysis engine). Downstream skills
 * (`FinancingProductAdvisorDualView`, `MoneycareKredietmemorandum`)
 * consume this as **enrichment**, never as sole authority — the
 * entrepreneur-facing report and the central gate
 * (`GATE_THRESHOLDS`) remain the binding source of truth for
 * `canSubmit`.
 *
 * The concrete shape is described by
 * `GeenbankKredietworkflowCreditContext` in
 * `geenbank-kredietworkflow-financier-schema.ts`. It is kept as
 * `unknown` here on purpose — the type lives next to the validator so
 * the orchestrator can adopt this without forcing every adapter to
 * import every other adapter's types.
 *
 * Slot semantics:
 * - `creditWorkflowContext`     — enums + summaries for chained skills
 * - `riskAnalysisSummary`       — anna-risk stage narrative + metrics
 * - `commercialProposalSummary` — indicative term sheet snapshot
 * - `validationFindings`        — kevin-credit independent review
 * - `conditions`                — blocking + advisory items
 * - `riskFlags`                 — blocking + advisory red flags
 * - `securities`                — collateral inventory
 * - `termSheetPricingHints`     — pricing-matrix selection per product
 */
export type PipelineCreditWorkflowEnrichment = {
  creditWorkflowContext: unknown;
  riskAnalysisSummary: unknown;
  commercialProposalSummary: unknown;
  validationFindings: unknown;
  conditions: unknown;
  riskFlags: unknown;
  securities: unknown;
  termSheetPricingHints: unknown;
};

export type PipelineContext = {
  dossier: PipelineDossierSnapshot;
  documents: PipelineDocumentFinding[];
  derived: PipelineDerivedFinancials;
  conditions: PipelineCondition[];
  /**
   * Output of the GeenbankKredietworkflow skill (step 1) — the
   * **canonical** credit-analysis output. Today's deterministic mock
   * fills this with the entrepreneur-facing
   * `GeenbankKredietworkflowOutput`; the live wiring will replace it
   * with `GeenbankKredietworkflowFinancierOutput` and run the entrepreneur
   * report through `mapKredietworkflowFinancierOutputToAppAnalysis()`.
   */
  workflow: unknown;
  /**
   * Optional enrichment payload extracted from `workflow` so chained
   * skills do not need to re-parse the full credit-analysis output.
   * `null` while the adapter is on mock — intentionally typed so
   * downstream skills can opt in without runtime coupling.
   */
  creditWorkflowEnrichment: PipelineCreditWorkflowEnrichment | null;
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
