/**
 * Forward-only JSON validator for the imported
 * `geenbank-kredietworkflow` ChatGPT skill response.
 *
 * The adapter (`geenbank-kredietworkflow.ts`) currently runs
 * deterministic mock code and does NOT import this validator at
 * runtime. It is exported so that:
 *
 *  - the test suite can guarantee the adapter's deterministic mock
 *    output is itself a valid skill response (regression seam for the
 *    upcoming live wiring);
 *  - the future live path can call `validateGeenbankKredietworkflowJson`
 *    inside `instrumentSkill` and fall back to mock with a structured
 *    `fallbackReason` on schema mismatch (mirroring how
 *    `financing-product-advisor-dual-view.ts` validates today);
 *  - the contract stays in lockstep with
 *    `skills/geenbank-kredietworkflow/SKILL.md` and
 *    `docs/ai-skill-source-mapping.md` section 4.
 *
 * No live OpenAI call is enabled by adding this file. No env vars are
 * read here. No new npm dependency is introduced — the validator is
 * deliberately plain TypeScript so the adapter can adopt it without a
 * `zod` import.
 */

export type GeenbankKredietworkflowVerdict =
  | "kansrijk"
  | "voorwaardelijk"
  | "uitdagend";

export const GEENBANK_KREDIETWORKFLOW_VERDICTS: ReadonlySet<GeenbankKredietworkflowVerdict> =
  new Set(["kansrijk", "voorwaardelijk", "uitdagend"]);

export type GeenbankKredietworkflowEntrepreneurReport = {
  headline: string;
  summary: string;
  strongPoints: string[];
  weakPoints: string[];
  actionPoints: string[];
  likelyFinancierAsks: string[];
  canSubmit: boolean;
};

export type GeenbankKredietworkflowSkillResponse = {
  confidenceScore: number;
  verdict: GeenbankKredietworkflowVerdict;
  verdictSummary: string;
  entrepreneurReport: GeenbankKredietworkflowEntrepreneurReport;
  strongPoints: string[];
  weakPoints: string[];
};

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

function validateEntrepreneurReport(value: unknown): string | null {
  if (!value || typeof value !== "object") {
    return "entrepreneurReport ontbreekt of is geen object";
  }
  const r = value as Record<string, unknown>;
  if (typeof r.headline !== "string" || r.headline.trim() === "") {
    return "entrepreneurReport.headline is geen niet-lege string";
  }
  if (typeof r.summary !== "string" || r.summary.trim() === "") {
    return "entrepreneurReport.summary is geen niet-lege string";
  }
  for (const key of [
    "strongPoints",
    "weakPoints",
    "actionPoints",
    "likelyFinancierAsks",
  ] as const) {
    if (!isStringArray(r[key])) {
      return `entrepreneurReport.${key} is geen string-array`;
    }
  }
  if (typeof r.canSubmit !== "boolean") {
    return "entrepreneurReport.canSubmit is geen boolean";
  }
  return null;
}

/**
 * Validate that an arbitrary `parsed` JSON value matches the
 * `geenbank-kredietworkflow` skill output contract. Returns a Dutch
 * problem string on mismatch, or `null` when the payload is valid.
 *
 * The adapter is expected to use this as a guard before mapping the
 * skill response onto its `GeenbankKredietworkflowOutput` type — same
 * pattern as `validateSkillJson` in `financing-product-advisor-dual-view.ts`.
 */
export function validateGeenbankKredietworkflowJson(
  parsed: unknown,
): string | null {
  if (!parsed || typeof parsed !== "object") {
    return "antwoord is geen JSON-object";
  }
  const obj = parsed as Record<string, unknown>;

  const score = obj.confidenceScore;
  if (typeof score !== "number" || !Number.isFinite(score)) {
    return "confidenceScore is geen geldig getal";
  }
  if (score < 0 || score > 100) {
    return `confidenceScore (${score}) buiten 0-100 bereik`;
  }

  if (
    typeof obj.verdict !== "string" ||
    !GEENBANK_KREDIETWORKFLOW_VERDICTS.has(
      obj.verdict as GeenbankKredietworkflowVerdict,
    )
  ) {
    return `verdict "${String(obj.verdict)}" is geen geldige waarde (kansrijk|voorwaardelijk|uitdagend)`;
  }

  if (
    typeof obj.verdictSummary !== "string" ||
    obj.verdictSummary.trim() === ""
  ) {
    return "verdictSummary is geen niet-lege string";
  }

  if (!isStringArray(obj.strongPoints)) {
    return "strongPoints is geen string-array";
  }
  if (!isStringArray(obj.weakPoints)) {
    return "weakPoints is geen string-array";
  }

  const reportProblem = validateEntrepreneurReport(obj.entrepreneurReport);
  if (reportProblem) return reportProblem;

  return null;
}
