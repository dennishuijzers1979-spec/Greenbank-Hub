/**
 * Forward-only validator for the **imported** `geenbank-kredietworkflow`
 * ChatGPT skill response — i.e. the financier / credit-committee shape
 * documented in `skills/geenbank-kredietworkflow/references/output-specs.md`.
 *
 * This is the canonical credit-analysis output of the skill. It is
 * intentionally added **alongside** (not replacing) the existing
 * entrepreneur-facing validator in `geenbank-kredietworkflow-schema.ts`,
 * which still describes today's adapter contract / mock output.
 *
 * Importing this file does NOT enable live OpenAI invocation. The
 * adapter (`geenbank-kredietworkflow.ts`) still runs the deterministic
 * mock and the central gate / `canSubmit` logic is unchanged. When the
 * live wiring is enabled (per-skill env opt-in), this validator will
 * guard the parsed JSON before the mapper
 * (`geenbank-kredietworkflow-financier-mapper.ts`) derives the
 * entrepreneur-facing fields the FE consumes today.
 *
 * Plain TypeScript on purpose — the repo does not depend on `zod` for
 * skill validators (see `validateSkillJson` in
 * `financing-product-advisor-dual-view.ts` and
 * `validateGeenbankKredietworkflowJson` in
 * `geenbank-kredietworkflow-schema.ts`). Keeping this validator
 * dependency-free means the adapter can adopt it without churn.
 */

export type GeenbankKredietworkflowDecision =
  | "Go"
  | "Conditional Go"
  | "No Go";

export const GEENBANK_KREDIETWORKFLOW_DECISIONS: ReadonlySet<GeenbankKredietworkflowDecision> =
  new Set(["Go", "Conditional Go", "No Go"]);

export type GeenbankKredietworkflowFeasibility =
  | "haalbaar zoals aangevraagd"
  | "haalbaar onder voorwaarden"
  | "niet haalbaar zoals aangevraagd";

export const GEENBANK_KREDIETWORKFLOW_FEASIBILITIES: ReadonlySet<GeenbankKredietworkflowFeasibility> =
  new Set([
    "haalbaar zoals aangevraagd",
    "haalbaar onder voorwaarden",
    "niet haalbaar zoals aangevraagd",
  ]);

export type GeenbankKredietworkflowSeverity = "blocking" | "advisory";

/** Borrower identity echoed back from the dossier; never invented. */
export type GeenbankKredietworkflowBorrower = {
  name: string;
  kvkNumber?: string | null;
  description?: string | null;
};

/** A facility structure — used for both `requested` and `recommended`. */
export type GeenbankKredietworkflowStructure = {
  facilityType: string;
  amount: number | null;
  /**
   * Numeric interest / pricing percentage when an exact rate is known.
   * MUST be a finite number or `null`. Textual or indicative pricing
   * (e.g. ranges, "marktconform", "nader te bepalen") MUST be expressed
   * via `rateComment` instead — the live adapter normalizes common LLM
   * shapes (`"8.5%"`, `"8,5%"` → numeric; `"8-10%"`, `"marktconform"`
   * → `rate=null` + `rateComment`) before validation. See
   * `normalizeKredietworkflowFinancierPayload`.
   */
  rate: number | null;
  /**
   * Free-text caveat / indicative pricing note used when `rate` cannot
   * be expressed as a single finite number (e.g. ranges, "marktconform",
   * "nader te bepalen"). Optional. Never put numeric pricing here that
   * could be expressed as `rate`.
   */
  rateComment?: string | null;
  /** Free-text tenor / repayment profile (e.g. "60 mnd, lineair"). */
  tenor?: string | null;
  repaymentProfile?: string | null;
  purpose?: string | null;
};

/** Risk-analysis summary from the anna-risk stage. */
export type GeenbankKredietworkflowRiskAnalysis = {
  summary: string;
  metrics: {
    dscr: number | null;
    solvency: number | null;
    ltv?: number | null;
    netWorkingCapital?: number | null;
  };
  stressCase?: string | null;
  keyRisks: string[];
  mitigants: string[];
  assumptions: string[];
};

/** Indicative term sheet / commercial proposal. */
export type GeenbankKredietworkflowCommercialProposal = {
  summary: string;
  structure: GeenbankKredietworkflowStructure;
  fees?: string | null;
  collateralPackage: string[];
  covenantPackage: string[];
  monitoringCadence?: string | null;
  conditionsPrecedent: string[];
  eventsOfDefault: string[];
};

/** Independent validation memo (kevin-credit stage). */
export type GeenbankKredietworkflowValidationFindings = {
  summary: string;
  /** Open issues that must be cured before the case can proceed. */
  blockingFindings: string[];
  /** Issues worth flagging but not blocking. */
  advisoryFindings: string[];
  /** Independently-recalculated metrics, if different from risk stage. */
  recalculatedMetrics?: {
    dscr?: number | null;
    ltv?: number | null;
    solvency?: number | null;
  } | null;
  /** Mismatches between source docs / analysis / term sheet / memo. */
  consistencyIssues?: string[];
};

/** Final committee-ready memo (executive-summary stage). */
export type GeenbankKredietworkflowCreditReport = {
  /** Short, committee-style headline of the proposal. */
  headline: string;
  /** Compact narrative summary of the case. */
  summary: string;
  /** Section-keyed body content (Dutch headings as in output-specs.md). */
  sections: Array<{ title: string; body: string }>;
  /** Pointer to the persisted `.docx` artifact, when produced. */
  docxArtifactRef?: string | null;
};

export type GeenbankKredietworkflowCondition = {
  id: string;
  category: string;
  severity: GeenbankKredietworkflowSeverity;
  description: string;
  /** Whether the condition is required pre-funding (vs post-funding). */
  prefunding?: boolean;
};

export type GeenbankKredietworkflowRiskFlag = {
  id: string;
  category: string;
  severity: GeenbankKredietworkflowSeverity;
  description: string;
};

export type GeenbankKredietworkflowSecurityItem = {
  type: string;
  description: string;
  marketValue?: number | null;
  forcedSaleValue?: number | null;
  ranking?: string | null;
  enforceabilityNotes?: string | null;
};

export type GeenbankKredietworkflowSecurities = {
  items: GeenbankKredietworkflowSecurityItem[];
  totalMarketValue?: number | null;
  totalForcedSaleValue?: number | null;
  ltv?: number | null;
};

export type GeenbankKredietworkflowPricingComponent = {
  /** Product name, e.g. "Onroerend Goed Financiering". */
  product: string;
  /** Share of the supported facility this component carries (EUR). */
  contribution: number | null;
  /** Selected monthly rate (decimal, e.g. 0.015 = 1.5% per maand). */
  monthlyRate: number | null;
  /** Pricing-matrix band tag, for traceability. */
  matrixBand?: string | null;
};

export type GeenbankKredietworkflowPricingIndication = {
  components: GeenbankKredietworkflowPricingComponent[];
  /** Weighted grand-total monthly rate across all components. */
  grandTotalMonthlyRate: number | null;
  /** Free-text caveats (e.g. "vanaf-tarief, definitieve quote ...""). */
  notes?: string | null;
};

/**
 * Forwardable hand-off slot that downstream skills
 * (`FinancingProductAdvisorDualView`, `MoneycareKredietmemorandum`)
 * may read as **enrichment**, not as sole authority. The entrepreneur-
 * facing report and central gate remain the binding source of truth.
 */
export type GeenbankKredietworkflowCreditContext = {
  decision: GeenbankKredietworkflowDecision;
  feasibilityAssessment: GeenbankKredietworkflowFeasibility;
  recommendedStructureSummary: string;
  termSheetSummary: string;
  pricingSummary: string;
  blockingConditions: string[];
  advisoryConditions: string[];
  riskFlags: string[];
};

export type GeenbankKredietworkflowFinancierOutput = {
  decision: GeenbankKredietworkflowDecision;
  decisionRationale: string;
  feasibilityAssessment: GeenbankKredietworkflowFeasibility;
  borrower: GeenbankKredietworkflowBorrower;
  requestedStructure: GeenbankKredietworkflowStructure;
  recommendedStructure: GeenbankKredietworkflowStructure;
  riskAnalysis: GeenbankKredietworkflowRiskAnalysis;
  commercialProposal: GeenbankKredietworkflowCommercialProposal;
  validationFindings: GeenbankKredietworkflowValidationFindings;
  creditReport: GeenbankKredietworkflowCreditReport;
  /** Convenience alias for `commercialProposal` — kept on the canonical
   *  shape because the imported skill emits it as a separate artifact. */
  termSheet: GeenbankKredietworkflowCommercialProposal;
  conditions: GeenbankKredietworkflowCondition[];
  riskFlags: GeenbankKredietworkflowRiskFlag[];
  securities: GeenbankKredietworkflowSecurities;
  pricingIndication: GeenbankKredietworkflowPricingIndication;
  /** Internal credit-committee confidence (0-100). */
  confidenceScore: number;
  /** Downstream hand-off slot for chained skills. */
  creditWorkflowContext: GeenbankKredietworkflowCreditContext;
};

// --- helpers ---------------------------------------------------------------

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isNullableFiniteNumber(v: unknown): v is number | null {
  return v === null || isFiniteNumber(v);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim() !== "";
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

function isObject(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

function validateStructure(label: string, value: unknown): string | null {
  if (!isObject(value)) return `${label} ontbreekt of is geen object`;
  if (typeof value.facilityType !== "string" || value.facilityType.trim() === "") {
    return `${label}.facilityType is geen niet-lege string`;
  }
  if (!isNullableFiniteNumber(value.amount)) {
    return `${label}.amount is geen geldig getal of null`;
  }
  if (!isNullableFiniteNumber(value.rate)) {
    return `${label}.rate is geen geldig getal of null`;
  }
  if (
    value.rateComment !== undefined &&
    value.rateComment !== null &&
    typeof value.rateComment !== "string"
  ) {
    return `${label}.rateComment is geen string of null`;
  }
  return null;
}

/**
 * Normalize a single facility-structure node's `rate` field in place.
 * - Finite number → kept as-is.
 * - `null` / `undefined` / empty string → `rate = null`.
 * - Numeric-looking string ("8.5%", "8,5%", "8.5", "0.069", with optional
 *   leading sign and trailing percent) → parsed to a finite number.
 *   `rateComment` is preserved if already set.
 * - Anything else (range like "8-10%", text like "marktconform",
 *   `NaN`, arrays, objects) → `rate = null` and the original textual
 *   value is preserved on `rateComment` (without overwriting an
 *   existing non-empty `rateComment`).
 *
 * Never produces `NaN` and never throws. Only mutates `rate` /
 * `rateComment`; all other fields are left untouched so the validator
 * can still reject genuinely malformed structures.
 */
function normalizeStructureRate(structure: unknown): void {
  if (!isObject(structure)) return;
  const rawRate = structure.rate;
  const existingComment =
    typeof structure.rateComment === "string" && structure.rateComment.trim() !== ""
      ? structure.rateComment
      : null;

  if (typeof rawRate === "number" && Number.isFinite(rawRate)) return;

  if (rawRate === null || rawRate === undefined) {
    structure.rate = null;
    return;
  }

  if (typeof rawRate === "string") {
    const trimmed = rawRate.trim();
    if (trimmed === "") {
      structure.rate = null;
      return;
    }
    // Single percentage / decimal: optional sign, digits, optional
    // decimal separator (`.` or `,`), optional `%`. Whitespace allowed
    // around the `%`. Range strings like "8-10%" intentionally do NOT
    // match (the inner hyphen breaks the pattern).
    const singleMatch = /^[+-]?\d+(?:[.,]\d+)?\s*%?$/.test(trimmed);
    if (singleMatch) {
      const num = Number(trimmed.replace(/[%\s]/g, "").replace(",", "."));
      if (Number.isFinite(num)) {
        structure.rate = num;
        return;
      }
    }
    structure.rate = null;
    if (!existingComment) structure.rateComment = trimmed;
    return;
  }

  // Any other shape (NaN, boolean, array, nested object) — keep null
  // and surface the textual form so loan officers see what came back.
  structure.rate = null;
  if (!existingComment) structure.rateComment = String(rawRate);
}

/**
 * Normalize `riskAnalysis.summary` on a raw kredietworkflow payload.
 *
 * Behaviour (deliberately conservative — we never invent risk content):
 * - If `summary` is already a non-empty trimmed string → keep it
 *   untouched. An existing valid summary is NEVER overwritten.
 * - If `summary` is missing / null / empty / whitespace-only **and**
 *   the model populated at least one of the supporting evidence
 *   fields (`keyRisks`, `mitigants`, `assumptions`, `stressCase`)
 *   with non-empty content → derive a concise Dutch (NL-NL) paragraph
 *   from those fields and write it to `summary`.
 * - If `summary` is missing / empty **and** there is no supporting
 *   risk evidence → leave `summary` as-is so the validator still
 *   rejects the payload and the adapter falls back to the
 *   deterministic mock with a structured `fallbackReason`. We never
 *   produce a hollow placeholder like "Geen risico's gevonden".
 *
 * Only mutates `riskAnalysis.summary`; every other field
 * (`metrics`, `keyRisks`, `mitigants`, `assumptions`, `stressCase`)
 * is left untouched so the validator still enforces shape.
 */
function normalizeRiskAnalysisSummary(parsed: { riskAnalysis?: unknown }): void {
  const ra = parsed.riskAnalysis;
  if (!isObject(ra)) return;

  const existing = ra.summary;
  if (typeof existing === "string" && existing.trim() !== "") return;

  const keyRisks = isStringArray(ra.keyRisks)
    ? ra.keyRisks.map((s) => s.trim()).filter((s) => s !== "")
    : [];
  const mitigants = isStringArray(ra.mitigants)
    ? ra.mitigants.map((s) => s.trim()).filter((s) => s !== "")
    : [];
  const assumptions = isStringArray(ra.assumptions)
    ? ra.assumptions.map((s) => s.trim()).filter((s) => s !== "")
    : [];
  const stressCase =
    typeof ra.stressCase === "string" && ra.stressCase.trim() !== ""
      ? ra.stressCase.trim()
      : null;

  const parts: string[] = [];
  if (keyRisks.length > 0) {
    parts.push(`Belangrijkste risico's: ${keyRisks.join("; ")}.`);
  }
  if (mitigants.length > 0) {
    parts.push(`Mitigerende maatregelen: ${mitigants.join("; ")}.`);
  }
  if (stressCase) {
    parts.push(
      `Stresstest: ${stressCase.endsWith(".") ? stressCase : stressCase + "."}`,
    );
  }
  if (assumptions.length > 0) {
    parts.push(`Aannames: ${assumptions.join("; ")}.`);
  }

  // No supporting evidence → leave summary as-is. Validation will
  // still fail and the live adapter will fall back to mock with a
  // structured fallbackReason. We refuse to invent content.
  if (parts.length === 0) return;

  ra.summary = parts.join(" ");
}

/**
 * Normalize the `rate` field on every facility-structure node inside a
 * raw `geenbank-kredietworkflow` financier-shape JSON payload, before
 * validation. Also normalizes `riskAnalysis.summary` when supporting
 * evidence is present (see `normalizeRiskAnalysisSummary`). Operates
 * in place on the parsed object and is safe to call on any unknown
 * value (no-op for non-objects). Touches:
 *   - `requestedStructure`
 *   - `recommendedStructure`
 *   - `commercialProposal.structure`
 *   - `termSheet.structure`
 *   - `riskAnalysis.summary` (only when missing/empty AND evidence exists)
 *
 * Does NOT touch any other field — the validator still rejects
 * genuinely malformed payloads (bad enum, missing arrays, etc.) and
 * the live adapter still falls back to the deterministic mock with a
 * structured `fallbackReason`.
 */
export function normalizeKredietworkflowFinancierPayload(parsed: unknown): unknown {
  if (!isObject(parsed)) return parsed;
  normalizeStructureRate(parsed.requestedStructure);
  normalizeStructureRate(parsed.recommendedStructure);
  if (isObject(parsed.commercialProposal)) {
    normalizeStructureRate(parsed.commercialProposal.structure);
  }
  if (isObject(parsed.termSheet)) {
    normalizeStructureRate(parsed.termSheet.structure);
  }
  normalizeRiskAnalysisSummary(parsed);
  return parsed;
}

function validateRiskAnalysis(value: unknown): string | null {
  if (!isObject(value)) return "riskAnalysis ontbreekt of is geen object";
  if (!isNonEmptyString(value.summary)) {
    return "riskAnalysis.summary is geen niet-lege string";
  }
  if (!isObject(value.metrics)) return "riskAnalysis.metrics ontbreekt";
  const m = value.metrics;
  if (!isNullableFiniteNumber(m.dscr)) return "riskAnalysis.metrics.dscr ongeldig";
  if (!isNullableFiniteNumber(m.solvency)) {
    return "riskAnalysis.metrics.solvency ongeldig";
  }
  if (!isStringArray(value.keyRisks)) return "riskAnalysis.keyRisks geen string-array";
  if (!isStringArray(value.mitigants)) return "riskAnalysis.mitigants geen string-array";
  if (!isStringArray(value.assumptions)) {
    return "riskAnalysis.assumptions geen string-array";
  }
  return null;
}

function validateCommercialProposal(label: string, value: unknown): string | null {
  if (!isObject(value)) return `${label} ontbreekt of is geen object`;
  if (!isNonEmptyString(value.summary)) {
    return `${label}.summary is geen niet-lege string`;
  }
  const s = validateStructure(`${label}.structure`, value.structure);
  if (s) return s;
  if (!isStringArray(value.collateralPackage)) {
    return `${label}.collateralPackage geen string-array`;
  }
  if (!isStringArray(value.covenantPackage)) {
    return `${label}.covenantPackage geen string-array`;
  }
  if (!isStringArray(value.conditionsPrecedent)) {
    return `${label}.conditionsPrecedent geen string-array`;
  }
  if (!isStringArray(value.eventsOfDefault)) {
    return `${label}.eventsOfDefault geen string-array`;
  }
  return null;
}

function validateValidationFindings(value: unknown): string | null {
  if (!isObject(value)) return "validationFindings ontbreekt of is geen object";
  if (!isNonEmptyString(value.summary)) {
    return "validationFindings.summary is geen niet-lege string";
  }
  if (!isStringArray(value.blockingFindings)) {
    return "validationFindings.blockingFindings geen string-array";
  }
  if (!isStringArray(value.advisoryFindings)) {
    return "validationFindings.advisoryFindings geen string-array";
  }
  return null;
}

function validateCreditReport(value: unknown): string | null {
  if (!isObject(value)) return "creditReport ontbreekt of is geen object";
  if (!isNonEmptyString(value.headline)) {
    return "creditReport.headline is geen niet-lege string";
  }
  if (!isNonEmptyString(value.summary)) {
    return "creditReport.summary is geen niet-lege string";
  }
  if (!Array.isArray(value.sections)) {
    return "creditReport.sections is geen array";
  }
  for (const sec of value.sections as unknown[]) {
    if (!isObject(sec)) return "creditReport.sections[*] is geen object";
    if (!isNonEmptyString(sec.title)) {
      return "creditReport.sections[*].title is geen niet-lege string";
    }
    if (typeof sec.body !== "string") {
      return "creditReport.sections[*].body is geen string";
    }
  }
  return null;
}

function validateConditions(value: unknown): string | null {
  if (!Array.isArray(value)) return "conditions is geen array";
  for (const c of value as unknown[]) {
    if (!isObject(c)) return "conditions[*] is geen object";
    if (!isNonEmptyString(c.id)) return "conditions[*].id is geen niet-lege string";
    if (!isNonEmptyString(c.category)) {
      return "conditions[*].category is geen niet-lege string";
    }
    if (c.severity !== "blocking" && c.severity !== "advisory") {
      return `conditions[*].severity "${String(c.severity)}" is geen blocking|advisory`;
    }
    if (!isNonEmptyString(c.description)) {
      return "conditions[*].description is geen niet-lege string";
    }
  }
  return null;
}

function validateRiskFlags(value: unknown): string | null {
  if (!Array.isArray(value)) return "riskFlags is geen array";
  for (const f of value as unknown[]) {
    if (!isObject(f)) return "riskFlags[*] is geen object";
    if (!isNonEmptyString(f.id)) return "riskFlags[*].id is geen niet-lege string";
    if (!isNonEmptyString(f.category)) {
      return "riskFlags[*].category is geen niet-lege string";
    }
    if (f.severity !== "blocking" && f.severity !== "advisory") {
      return `riskFlags[*].severity "${String(f.severity)}" is geen blocking|advisory`;
    }
    if (!isNonEmptyString(f.description)) {
      return "riskFlags[*].description is geen niet-lege string";
    }
  }
  return null;
}

function validateSecurities(value: unknown): string | null {
  if (!isObject(value)) return "securities ontbreekt of is geen object";
  if (!Array.isArray(value.items)) return "securities.items is geen array";
  for (const it of value.items as unknown[]) {
    if (!isObject(it)) return "securities.items[*] is geen object";
    if (!isNonEmptyString(it.type)) {
      return "securities.items[*].type is geen niet-lege string";
    }
    if (!isNonEmptyString(it.description)) {
      return "securities.items[*].description is geen niet-lege string";
    }
    if (!isNullableFiniteNumber(it.marketValue)) {
      return "securities.items[*].marketValue ongeldig";
    }
    if (!isNullableFiniteNumber(it.forcedSaleValue)) {
      return "securities.items[*].forcedSaleValue ongeldig";
    }
  }
  return null;
}

function validatePricing(value: unknown): string | null {
  if (!isObject(value)) return "pricingIndication ontbreekt of is geen object";
  if (!Array.isArray(value.components)) {
    return "pricingIndication.components is geen array";
  }
  for (const c of value.components as unknown[]) {
    if (!isObject(c)) return "pricingIndication.components[*] is geen object";
    if (!isNonEmptyString(c.product)) {
      return "pricingIndication.components[*].product is geen niet-lege string";
    }
    if (!isNullableFiniteNumber(c.contribution)) {
      return "pricingIndication.components[*].contribution ongeldig";
    }
    if (!isNullableFiniteNumber(c.monthlyRate)) {
      return "pricingIndication.components[*].monthlyRate ongeldig";
    }
  }
  if (!isNullableFiniteNumber(value.grandTotalMonthlyRate)) {
    return "pricingIndication.grandTotalMonthlyRate ongeldig";
  }
  return null;
}

function validateCreditWorkflowContext(value: unknown): string | null {
  if (!isObject(value)) return "creditWorkflowContext ontbreekt of is geen object";
  if (
    typeof value.decision !== "string" ||
    !GEENBANK_KREDIETWORKFLOW_DECISIONS.has(
      value.decision as GeenbankKredietworkflowDecision,
    )
  ) {
    return `creditWorkflowContext.decision "${String(value.decision)}" is geen geldige waarde`;
  }
  if (
    typeof value.feasibilityAssessment !== "string" ||
    !GEENBANK_KREDIETWORKFLOW_FEASIBILITIES.has(
      value.feasibilityAssessment as GeenbankKredietworkflowFeasibility,
    )
  ) {
    return `creditWorkflowContext.feasibilityAssessment "${String(value.feasibilityAssessment)}" is geen geldige waarde`;
  }
  for (const k of [
    "recommendedStructureSummary",
    "termSheetSummary",
    "pricingSummary",
  ] as const) {
    if (typeof (value as Record<string, unknown>)[k] !== "string") {
      return `creditWorkflowContext.${k} is geen string`;
    }
  }
  if (!isStringArray(value.blockingConditions)) {
    return "creditWorkflowContext.blockingConditions geen string-array";
  }
  if (!isStringArray(value.advisoryConditions)) {
    return "creditWorkflowContext.advisoryConditions geen string-array";
  }
  if (!isStringArray(value.riskFlags)) {
    return "creditWorkflowContext.riskFlags geen string-array";
  }
  return null;
}

/**
 * Validate that an arbitrary `parsed` JSON value matches the
 * **financier / credit-committee** shape of the imported
 * `geenbank-kredietworkflow` skill response.
 *
 * Returns a Dutch problem string on mismatch, or `null` when valid.
 *
 * The future live wiring is expected to call this validator inside
 * `instrumentSkill` and fall back to the deterministic mock with a
 * structured `fallbackReason` on schema mismatch — same pattern as
 * `validateSkillJson` in `financing-product-advisor-dual-view.ts`.
 */
export function validateGeenbankKredietworkflowFinancierJson(
  parsed: unknown,
): string | null {
  if (!isObject(parsed)) return "antwoord is geen JSON-object";

  if (
    typeof parsed.decision !== "string" ||
    !GEENBANK_KREDIETWORKFLOW_DECISIONS.has(
      parsed.decision as GeenbankKredietworkflowDecision,
    )
  ) {
    return `decision "${String(parsed.decision)}" is geen geldige waarde (Go|Conditional Go|No Go)`;
  }

  if (!isNonEmptyString(parsed.decisionRationale)) {
    return "decisionRationale is geen niet-lege string";
  }

  if (
    typeof parsed.feasibilityAssessment !== "string" ||
    !GEENBANK_KREDIETWORKFLOW_FEASIBILITIES.has(
      parsed.feasibilityAssessment as GeenbankKredietworkflowFeasibility,
    )
  ) {
    return `feasibilityAssessment "${String(parsed.feasibilityAssessment)}" is geen geldige waarde`;
  }

  if (!isObject(parsed.borrower) || !isNonEmptyString(parsed.borrower.name)) {
    return "borrower.name is geen niet-lege string";
  }

  const reqStruct = validateStructure(
    "requestedStructure",
    parsed.requestedStructure,
  );
  if (reqStruct) return reqStruct;

  const recStruct = validateStructure(
    "recommendedStructure",
    parsed.recommendedStructure,
  );
  if (recStruct) return recStruct;

  const risk = validateRiskAnalysis(parsed.riskAnalysis);
  if (risk) return risk;

  const proposal = validateCommercialProposal(
    "commercialProposal",
    parsed.commercialProposal,
  );
  if (proposal) return proposal;

  const findings = validateValidationFindings(parsed.validationFindings);
  if (findings) return findings;

  const report = validateCreditReport(parsed.creditReport);
  if (report) return report;

  const term = validateCommercialProposal("termSheet", parsed.termSheet);
  if (term) return term;

  const conds = validateConditions(parsed.conditions);
  if (conds) return conds;

  const flags = validateRiskFlags(parsed.riskFlags);
  if (flags) return flags;

  const sec = validateSecurities(parsed.securities);
  if (sec) return sec;

  const pricing = validatePricing(parsed.pricingIndication);
  if (pricing) return pricing;

  if (!isFiniteNumber(parsed.confidenceScore)) {
    return "confidenceScore is geen geldig getal";
  }
  if (parsed.confidenceScore < 0 || parsed.confidenceScore > 100) {
    return `confidenceScore (${parsed.confidenceScore}) buiten 0-100 bereik`;
  }

  const ctx = validateCreditWorkflowContext(parsed.creditWorkflowContext);
  if (ctx) return ctx;

  return null;
}
