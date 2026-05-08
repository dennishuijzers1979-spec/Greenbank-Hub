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
