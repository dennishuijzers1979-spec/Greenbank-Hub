/**
 * Pure, side-effect-free mapper from the canonical financier /
 * credit-committee output of the `geenbank-kredietworkflow` skill
 * (`GeenbankKredietworkflowFinancierOutput`) onto the entrepreneur-
 * facing app fields the FE consumes today
 * (`GeenbankKredietworkflowOutput` from `geenbank-kredietworkflow.ts`).
 *
 * The canonical financier output is **not** thrown away — callers are
 * expected to persist the full object on `SkillInvocation.extras` (or
 * a future structured-analysis column) so loan officers, the dual-view
 * product advisor, and the moneycare memorandum can keep using it as
 * authoritative enrichment.
 *
 * Mapping rules (in lockstep with
 * `skills/geenbank-kredietworkflow/SKILL.md` repo notes and section 4
 * of `docs/ai-skill-source-mapping.md`):
 *
 *   - decision Go              → verdict "kansrijk"
 *   - decision Conditional Go  → verdict "voorwaardelijk"
 *   - decision No Go           → verdict "uitdagend"
 *   - any blocking validation finding / blocking condition / blocking
 *     risk flag / feasibility "niet haalbaar zoals aangevraagd" /
 *     decision "No Go" → entrepreneurReport.canSubmit = false
 *   - missing-evidence advisory items → actionPoints / likelyFinancierAsks
 *   - all entrepreneur-facing strings stay Dutch (NL-NL); the central
 *     gate (`GATE_THRESHOLDS`) remains the source of truth for
 *     `canSubmit` — callers must overwrite to `false` if any threshold
 *     is unmet, even when this mapper says `true`.
 *
 * No live OpenAI call is made here. No env vars are read. No
 * dependencies on the runtime / orchestrator.
 */

import {
  type GeenbankKredietworkflowDecision,
  type GeenbankKredietworkflowFinancierOutput,
} from "./geenbank-kredietworkflow-financier-schema";
import { pct, type EntrepreneurReport } from "./types";

export type AppKredietworkflowVerdict =
  | "kansrijk"
  | "voorwaardelijk"
  | "uitdagend";

/**
 * Shape returned by `mapKredietworkflowFinancierOutputToAppAnalysis()`
 * — a superset of the existing entrepreneur-facing
 * `GeenbankKredietworkflowOutput` plus structured condition lists the
 * orchestrator can persist on `SkillInvocation.extras`.
 */
export type MappedKredietworkflowAppAnalysis = {
  /** App verdict in the legacy `kansrijk|voorwaardelijk|uitdagend` enum. */
  aiVerdict: AppKredietworkflowVerdict;
  /** Clamped 0-100 confidence (defence-in-depth). */
  confidenceScore: number;
  /** Short Dutch summary of the decision rationale. */
  verdictSummary: string;
  /** Top-level Dutch strong points carried into the financier report. */
  strongPoints: string[];
  /** Top-level Dutch weak points carried into the financier report. */
  weakPoints: string[];
  /** Suggested **blocking** conditions (must be cured before submit). */
  blockingConditions: string[];
  /** Suggested **non-blocking** advisory conditions / asks. */
  nonBlockingConditions: string[];
  /** Entrepreneur-facing Dutch report rendered by the FE. */
  entrepreneurReport: EntrepreneurReport;
  /**
   * The original financier output, untouched. Persist this on
   * `SkillInvocation.extras` so downstream skills and loan officers
   * can read the authoritative credit analysis.
   */
  canonical: GeenbankKredietworkflowFinancierOutput;
};

const DECISION_TO_VERDICT: Record<
  GeenbankKredietworkflowDecision,
  AppKredietworkflowVerdict
> = {
  Go: "kansrijk",
  "Conditional Go": "voorwaardelijk",
  "No Go": "uitdagend",
};

function unique(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const trimmed = item.trim();
    if (!trimmed) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function buildHeadline(
  verdict: AppKredietworkflowVerdict,
  hasBlockers: boolean,
): string {
  if (verdict === "kansrijk" && !hasBlockers) {
    return "Je dossier staat sterk — tijd om door te zetten.";
  }
  if (verdict === "voorwaardelijk" || (verdict === "kansrijk" && hasBlockers)) {
    return "Je bent dichtbij — een paar aanvullingen maken het verschil.";
  }
  return "Er is nog werk te doen voordat we naar partners gaan.";
}

function buildSummary(
  output: GeenbankKredietworkflowFinancierOutput,
  verdict: AppKredietworkflowVerdict,
): string {
  const name = output.borrower.name.trim() || "Het dossier";
  const rationale = output.decisionRationale.trim();
  if (verdict === "kansrijk") {
    return `${name} laat een onderbouwde casus zien. ${rationale}`.trim();
  }
  if (verdict === "voorwaardelijk") {
    return `${name} heeft potentie, maar er zijn nog aandachtspunten voordat we partners benaderen. ${rationale}`.trim();
  }
  return `${name} heeft op dit moment onvoldoende onderbouwing voor een succesvolle aanvraag. ${rationale}`.trim();
}

/**
 * Pure mapper. Takes a validated financier output and returns the
 * entrepreneur-facing app analysis. Callers must still:
 *
 *   1. cross-check `entrepreneurReport.canSubmit` against
 *      `GATE_THRESHOLDS` (the central gate stays the source of truth
 *      and must overwrite to `false` if any score is below threshold);
 *   2. persist `canonical` on `SkillInvocation.extras` so the rich
 *      financier output remains available for loan officers, dual-view
 *      product advice, and the moneycare memorandum.
 */
export function mapKredietworkflowFinancierOutputToAppAnalysis(
  output: GeenbankKredietworkflowFinancierOutput,
): MappedKredietworkflowAppAnalysis {
  const aiVerdict = DECISION_TO_VERDICT[output.decision];

  const blockingConditions = unique([
    ...output.conditions
      .filter((c) => c.severity === "blocking")
      .map((c) => c.description),
    ...output.validationFindings.blockingFindings,
    ...output.riskFlags
      .filter((f) => f.severity === "blocking")
      .map((f) => f.description),
  ]);

  const nonBlockingConditions = unique([
    ...output.conditions
      .filter((c) => c.severity === "advisory")
      .map((c) => c.description),
    ...output.validationFindings.advisoryFindings,
    ...output.riskFlags
      .filter((f) => f.severity === "advisory")
      .map((f) => f.description),
  ]);

  const strongPoints = unique(output.riskAnalysis.mitigants);
  const weakPoints = unique([
    ...output.riskAnalysis.keyRisks,
    ...blockingConditions,
  ]);

  const actionPoints = unique([
    ...blockingConditions,
    ...nonBlockingConditions,
  ]);

  const likelyFinancierAsks = unique([
    ...output.riskAnalysis.assumptions,
    ...output.commercialProposal.conditionsPrecedent,
  ]);

  const hasBlockers =
    blockingConditions.length > 0 ||
    output.feasibilityAssessment === "niet haalbaar zoals aangevraagd" ||
    output.decision === "No Go";

  // Entrepreneur-facing canSubmit: false on any blocker / No Go.
  // Callers MUST additionally enforce GATE_THRESHOLDS — see types.ts.
  const canSubmit = !hasBlockers && output.decision === "Go";

  const entrepreneurReport: EntrepreneurReport = {
    headline: buildHeadline(aiVerdict, hasBlockers),
    summary: buildSummary(output, aiVerdict),
    strongPoints,
    weakPoints,
    actionPoints:
      actionPoints.length > 0
        ? actionPoints
        : ["Dossier is op orde — verstuur naar Geenbank voor formele beoordeling."],
    likelyFinancierAsks,
    canSubmit,
  };

  return {
    aiVerdict,
    confidenceScore: pct(output.confidenceScore),
    verdictSummary: output.decisionRationale,
    strongPoints,
    weakPoints,
    blockingConditions,
    nonBlockingConditions,
    entrepreneurReport,
    canonical: output,
  };
}
