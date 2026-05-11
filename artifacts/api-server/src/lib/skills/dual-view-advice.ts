/**
 * Extract a typed, internal `DualViewAdvice` payload from the latest
 * AI analysis run for use in the loan officer dossier review UI.
 *
 * The advice is derived from the `FinancingProductAdvisorDualView`
 * skill invocation that already runs as part of every prevalidation /
 * full analysis. We only surface fields that are safe for internal
 * decision support; raw prompts, request bodies, API keys and
 * authorization headers are never exposed.
 *
 * The runtime layer (`scrubSecrets` in `runtime.ts`) already strips
 * obvious secrets defensively; this extractor adds a second layer by
 * (a) only copying a fixed allow-list of fields out of the persisted
 * extras and (b) rejecting any string that still smells like an API
 * key or bearer token.
 */
import type {
  DualViewAdvice,
  DualViewAdviceExecutionMode,
  DualViewAdvicePartnerView,
  DualViewAdviceEntrepreneurSummary,
  DualViewAdviceIndicativeStructure,
  DualViewAdviceShortlistedProduct,
  DualViewAdvicePartnerViewRecommendationStatus,
} from "@workspace/api-zod";

const SECRET_RE = /sk-[A-Za-z0-9_-]{10,}|bearer\s+[A-Za-z0-9._-]{10,}/i;

const RECOMMENDATION_STATUSES = new Set(["strong", "provisional", "weak"]);

function safeString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (SECRET_RE.test(value)) return null;
  return value;
}

function safeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const s = safeString(item);
    if (s !== null && s !== "") out.push(s);
  }
  return out;
}

function safeNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

function safeRecommendationStatus(
  value: unknown,
): DualViewAdvicePartnerViewRecommendationStatus {
  if (typeof value !== "string") return null;
  return RECOMMENDATION_STATUSES.has(value)
    ? (value as DualViewAdvicePartnerViewRecommendationStatus)
    : null;
}

function extractIndicativeStructure(
  value: unknown,
): DualViewAdviceIndicativeStructure | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  return {
    amount: safeNumber(v.amount),
    tenor_months: safeNumber(v.tenor_months),
    repayment_logic: safeString(v.repayment_logic),
    collateral_logic: safeString(v.collateral_logic),
    conditions: safeStringArray(v.conditions),
  };
}

function extractShortlisted(
  value: unknown,
): DualViewAdviceShortlistedProduct[] {
  if (!Array.isArray(value)) return [];
  const out: DualViewAdviceShortlistedProduct[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const v = item as Record<string, unknown>;
    const name = safeString(v.product_name);
    if (!name) continue;
    out.push({
      product_name: name,
      product_fit_score: safeNumber(v.product_fit_score),
      evidence_strength_score: safeNumber(v.evidence_strength_score),
      structurability_score: safeNumber(v.structurability_score),
      notes: safeStringArray(v.notes),
    });
  }
  return out;
}

function extractPartnerView(value: unknown): {
  view: DualViewAdvicePartnerView;
  hasContent: boolean;
  warnings: string[];
} {
  const warnings: string[] = [];
  if (!value || typeof value !== "object") {
    warnings.push("partner_view ontbreekt in skill-antwoord");
    return {
      view: {
        recommended_product: null,
        alternative_product: null,
        recommended_product_mix: [],
        recommendation_status: null,
        rationale: [],
        key_risks: [],
        evidence_gaps: [],
        indicative_structure: null,
        shortlisted_products: [],
      },
      hasContent: false,
      warnings,
    };
  }
  const v = value as Record<string, unknown>;
  const view: DualViewAdvicePartnerView = {
    recommended_product: safeString(v.recommended_product),
    alternative_product: safeString(v.alternative_product),
    recommended_product_mix: safeStringArray(v.recommended_product_mix),
    recommendation_status: safeRecommendationStatus(v.recommendation_status),
    rationale: safeStringArray(v.rationale),
    key_risks: safeStringArray(v.key_risks),
    evidence_gaps: safeStringArray(v.evidence_gaps),
    indicative_structure: extractIndicativeStructure(v.indicative_structure),
    shortlisted_products: extractShortlisted(v.shortlisted_products),
  };
  if (!view.recommended_product && view.shortlisted_products!.length === 0) {
    warnings.push("Geen aanbevolen product of shortlist beschikbaar");
  }
  if (
    !view.indicative_structure ||
    (view.indicative_structure.amount === null &&
      view.indicative_structure.tenor_months === null &&
      !view.indicative_structure.repayment_logic)
  ) {
    warnings.push("Indicatieve structuur is leeg of onvolledig");
  }
  return { view, hasContent: true, warnings };
}

function extractEntrepreneurSummary(
  value: unknown,
): DualViewAdviceEntrepreneurSummary | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const summary = safeString(v.summary);
  const fin = safeNumber(v.financeability_score);
  const sub = safeNumber(v.submission_readiness_score);
  const cta = safeString(v.cta_status);
  if (summary === null && fin === null && sub === null && cta === null) {
    return null;
  }
  return {
    summary,
    financeability_score: fin,
    submission_readiness_score: sub,
    cta_status: cta,
  };
}

/**
 * Minimal shape of the persisted AIAnalysisRun row needed here.
 * Kept structural so this module does not depend on Drizzle schema
 * internals.
 */
export type DualViewAdviceRunInput = {
  id: string;
  startedAt: Date | string | null;
  completedAt: Date | string | null;
  skillInvocations: unknown;
};

type SkillInvocationRecord = {
  skillName?: unknown;
  provider?: unknown;
  usedMockMode?: unknown;
  model?: unknown;
  durationMs?: unknown;
  fallbackReason?: unknown;
  startedAt?: unknown;
  completedAt?: unknown;
  extras?: unknown;
};

function findDualViewInvocation(
  invocations: unknown,
): SkillInvocationRecord | null {
  if (!Array.isArray(invocations)) return null;
  for (const raw of invocations) {
    if (!raw || typeof raw !== "object") continue;
    const inv = raw as SkillInvocationRecord;
    if (inv.skillName === "FinancingProductAdvisorDualView") return inv;
  }
  return null;
}

function classifyExecutionMode(
  inv: SkillInvocationRecord,
): DualViewAdviceExecutionMode {
  const usedMock = inv.usedMockMode === true;
  const fallback = typeof inv.fallbackReason === "string" && inv.fallbackReason.length > 0;
  if (!usedMock) return "live_openai";
  if (fallback) return "fallback_mock";
  return "deterministic_mock";
}

function isoOrNull(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && value.length > 0) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return null;
}

/**
 * Build a typed DualViewAdvice payload from a persisted analysis run,
 * or return `null` if the run does not contain a dual-view invocation.
 */
export function extractDualViewAdvice(
  dossierId: string,
  run: DualViewAdviceRunInput | null | undefined,
): DualViewAdvice | null {
  if (!run) return null;
  const inv = findDualViewInvocation(run.skillInvocations);
  if (!inv) return null;

  const provider = typeof inv.provider === "string" ? inv.provider : "mock";
  const executionMode = classifyExecutionMode(inv);
  const generatedAt =
    isoOrNull(inv.completedAt) ??
    isoOrNull(inv.startedAt) ??
    isoOrNull(run.completedAt) ??
    isoOrNull(run.startedAt);
  const durationMs =
    typeof inv.durationMs === "number" && Number.isFinite(inv.durationMs)
      ? inv.durationMs
      : null;
  const fallbackReason = safeString(inv.fallbackReason);
  const model = safeString(inv.model);

  const extras = inv.extras as Record<string, unknown> | null | undefined;
  const response =
    extras && typeof extras === "object"
      ? (extras.response as Record<string, unknown> | undefined)
      : undefined;

  const partner = extractPartnerView(response?.partner_view);
  const entrepreneurSummary = extractEntrepreneurSummary(
    response?.entrepreneur_view,
  );

  const warnings: string[] = [...partner.warnings];
  let partial = false;

  if (executionMode === "deterministic_mock" || executionMode === "fallback_mock") {
    warnings.push(
      "Productadvies is niet door OpenAI gegenereerd; behandel als indicatief / mock.",
    );
  }
  if (!response) {
    warnings.push(
      "Geen gestructureerd skill-antwoord beschikbaar — toont lege placeholder.",
    );
    partial = true;
  }
  if (!partner.hasContent) {
    partial = true;
  }

  return {
    dossierId,
    runId: run.id,
    provider,
    executionMode,
    model: executionMode === "deterministic_mock" ? null : model,
    generatedAt,
    durationMs,
    fallbackReason,
    partnerView: partner.view,
    entrepreneurSummary,
    partial,
    warnings,
  };
}
