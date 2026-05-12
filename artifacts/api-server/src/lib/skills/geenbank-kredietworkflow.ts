import { logger } from "../logger";
import {
  mapKredietworkflowFinancierOutputToAppAnalysis,
  type MappedKredietworkflowAppAnalysis,
} from "./geenbank-kredietworkflow-financier-mapper";
import {
  KW_FINANCIER_JSON_SCHEMA,
  normalizeKredietworkflowFinancierPayload,
  validateGeenbankKredietworkflowFinancierJson,
  type GeenbankKredietworkflowFinancierOutput,
} from "./geenbank-kredietworkflow-financier-schema";
import {
  DEFAULT_OPENAI_MODEL,
  getOpenAIChatClient,
  OpenAIHttpError,
  type OpenAIChatRequest,
} from "./openai-client";
import { failedInvocation, instrumentSkill } from "./runtime";
import { loadSkillMarkdown } from "./skill-loader";
import {
  GATE_THRESHOLDS,
  pct,
  type EntrepreneurReport,
  type SkillContext,
  type SkillResult,
} from "./types";

export type GeenbankKredietworkflowInput = {
  ctx: SkillContext;
  completenessScore: number;
  correctnessScore: number;
  viabilityScore: number;
  completedDocs: number;
  requiredDocs: number;
  margin: number;
  dscr: number;
  revenue: number;
  profit: number;
  requested: number;
};

export type GeenbankKredietworkflowOutput = {
  confidenceScore: number;
  verdict: string;
  verdictSummary: string;
  entrepreneurReport: EntrepreneurReport;
  strongPoints: string[];
  weakPoints: string[];
};

const MODULE = "GeenbankKredietworkflow" as const;
const SKILL_SLUG = "geenbank-kredietworkflow";
const PROVIDER_ENV = "AI_SKILL_GEENBANKKREDIETWORKFLOW_PROVIDER";

/**
 * Compute the central-gate `canSubmit`. The mapper / live skill output
 * may say `true`, but the central gate (`GATE_THRESHOLDS`) is the
 * binding source of truth — if any score is below threshold,
 * `canSubmit` MUST be `false`. Belt-and-braces: orchestrator-level
 * `checkRunAnalysisGate` enforces the same thing for the actual submit
 * action; this keeps the entrepreneur-facing report internally
 * consistent so the FE never advertises a submit that the gate would
 * reject.
 */
function gateCanSubmit(
  args: Pick<
    GeenbankKredietworkflowInput,
    "completenessScore" | "correctnessScore" | "viabilityScore"
  >,
): boolean {
  return (
    args.completenessScore >= GATE_THRESHOLDS.completeness &&
    args.correctnessScore >= GATE_THRESHOLDS.correctness &&
    args.viabilityScore >= GATE_THRESHOLDS.viability
  );
}

/** Deterministic fallback used by both the mock path and any error
 * path. Pure: depends only on its arguments + the `GATE_THRESHOLDS`
 * constant. */
function buildMockOutput(
  args: GeenbankKredietworkflowInput,
): GeenbankKredietworkflowOutput {
  const {
    completenessScore,
    correctnessScore,
    viabilityScore,
    completedDocs,
    requiredDocs,
    margin,
    dscr,
    revenue,
    requested,
  } = args;
  const { dossier, companyName } = args.ctx;
  const confidenceScore = pct((completenessScore + correctnessScore) / 2);

  let verdict: string;
  if (viabilityScore >= 75 && completenessScore >= 70) verdict = "kansrijk";
  else if (viabilityScore >= 55) verdict = "voorwaardelijk";
  else verdict = "uitdagend";

  const verdictSummary =
    verdict === "kansrijk"
      ? `${companyName} laat sterke kasstroom en een onderbouwde financieringsvraag zien. Klaar om bij alternatieve financiers neer te leggen.`
      : verdict === "voorwaardelijk"
        ? `${companyName} heeft potentie, maar er zijn nog enkele aandachtspunten in het dossier voordat we partners benaderen.`
        : `${companyName} heeft op dit moment onvoldoende onderbouwing voor een succesvolle aanvraag bij alternatieve financiers.`;

  const strongPoints: string[] = [];
  const weakPoints: string[] = [];
  const actionPoints: string[] = [];

  if (margin > 0.1)
    strongPoints.push(
      `Gezonde marge van ${(margin * 100).toFixed(1)}% op de omzet.`,
    );
  if (dscr > 1.2)
    strongPoints.push(
      `De winst dekt ruimschoots een verwachte rente- en aflossingslast (DSCR ${dscr.toFixed(2)}).`,
    );
  if (completedDocs === requiredDocs)
    strongPoints.push("Alle kerndocumenten zijn aangeleverd en gevalideerd.");
  if (dossier.companyDescription && dossier.companyDescription.length > 80)
    strongPoints.push(
      "Heldere bedrijfsbeschrijving die richting en propositie laat zien.",
    );

  if (completedDocs < requiredDocs)
    weakPoints.push(
      `${requiredDocs - completedDocs} kerndocument(en) ontbreken nog (jaarcijfers, bankafschriften, ID, KVK-uittreksel).`,
    );
  if (margin < 0.05 && revenue > 0)
    weakPoints.push(
      "De marge is laag — financiers willen aflossingsruimte zien.",
    );
  if (requested > 0 && revenue > 0 && requested > revenue * 0.5)
    weakPoints.push(
      "De gevraagde financiering is groot ten opzichte van de jaaromzet.",
    );
  if (!dossier.financingPurpose)
    weakPoints.push("Doel van de financiering is nog niet ingevuld.");

  if (completedDocs < requiredDocs)
    actionPoints.push("Upload de ontbrekende kerndocumenten in het dossier.");
  if (!dossier.companyDescription)
    actionPoints.push(
      "Schrijf een korte bedrijfsbeschrijving (3-5 zinnen) over wat jullie doen en voor wie.",
    );
  if (margin < 0.1)
    actionPoints.push(
      "Onderbouw waarom de marge zal verbeteren of waar extra financiering ruimte creëert.",
    );
  if (actionPoints.length === 0)
    actionPoints.push(
      "Dossier is op orde — verstuur naar Geenbank voor formele beoordeling.",
    );

  const likelyFinancierAsks = [
    "Toelichting op de financieringsbehoefte en terugverdienperiode",
    "Cashflow-prognose voor de komende 12 maanden",
    "Aflossingscapaciteit bij stress-scenario (omzet -15%)",
    "Onderbouwing van het ondernemerschap en track record",
  ];

  const canSubmit = gateCanSubmit(args);

  const headline =
    verdict === "kansrijk"
      ? "Je dossier staat sterk — tijd om door te zetten."
      : verdict === "voorwaardelijk"
        ? "Je bent dichtbij — een paar aanvullingen maken het verschil."
        : "Er is nog werk te doen voordat we naar partners gaan.";

  const entrepreneurReport: EntrepreneurReport = {
    headline,
    summary: verdictSummary,
    strongPoints,
    weakPoints,
    actionPoints,
    likelyFinancierAsks,
    canSubmit,
  };

  return {
    confidenceScore,
    verdict,
    verdictSummary,
    entrepreneurReport,
    strongPoints,
    weakPoints,
  };
}

function fallback(companyName: string): GeenbankKredietworkflowOutput {
  return {
    confidenceScore: 0,
    verdict: "uitdagend",
    verdictSummary: `Pre-validatie kon niet voltooid worden voor ${companyName}.`,
    entrepreneurReport: {
      headline: "Pre-validatie niet voltooid",
      summary: "Er ging iets mis bij het samenstellen van het rapport.",
      strongPoints: [],
      weakPoints: ["Pre-validatie kon niet worden afgerond."],
      actionPoints: [
        "Probeer de pre-validatie opnieuw of neem contact op met support.",
      ],
      likelyFinancierAsks: [],
      canSubmit: false,
    },
    strongPoints: [],
    weakPoints: ["Pre-validatie kon niet worden afgerond."],
  };
}

/** Build the structured payload sent to the OpenAI skill. Mirrors the
 * dual-view adapter's input shape: dossier identity + scores + derived
 * financials + document-validation status + open conditions.
 *
 * Crucially: this never reads `process.env`, never embeds secrets, and
 * never sends the raw OPENAI_API_KEY in the payload. */
/**
 * Resolve the real borrower identity for a live credit-workflow call.
 * Trims the prospect company name. Returns `null` when missing/empty.
 *
 * Intentionally does NOT fall back to the display placeholder
 * (`ctx.companyName === "Onbekend"`): a live credit decision must be
 * rendered against a real company, never against a sentinel string.
 */
function resolveBorrowerName(ctx: SkillContext): string | null {
  const fromBorrower = ctx.borrowerName?.trim();
  if (fromBorrower) return fromBorrower;
  // Belt-and-braces: also try ctx.companyName when it's a real value
  // (i.e. not the "Onbekend" placeholder), in case an older caller
  // populated only the display field.
  const fromCompany = ctx.companyName?.trim();
  if (fromCompany && fromCompany !== "Onbekend") return fromCompany;
  return null;
}

function buildSkillInput(args: GeenbankKredietworkflowInput, borrowerName: string) {
  const { ctx } = args;
  const { dossier, documents } = ctx;
  return {
    borrower: {
      // Field name matches the canonical financier-output schema
      // (`borrower.name`) so the LLM can echo it back verbatim.
      name: borrowerName,
      kvkNumber: null,
      description: dossier.companyDescription ?? null,
    },
    request: {
      requestedAmount: dossier.requestedAmount,
      financingPurpose: dossier.financingPurpose,
      financingTypePreference: dossier.financingTypePreference,
    },
    scores: {
      completeness: args.completenessScore,
      correctness: args.correctnessScore,
      viability: args.viabilityScore,
      gateThresholds: GATE_THRESHOLDS,
    },
    derivedFinancials: {
      annualRevenue: args.revenue,
      annualProfit: args.profit,
      requestedAmount: args.requested,
      margin: args.margin,
      dscr: args.dscr,
    },
    evidence: {
      completedDocs: args.completedDocs,
      requiredDocs: args.requiredDocs,
      documents: (documents ?? []).map((d) => ({
        documentType: d.documentType,
        filename: d.filename,
        validationStatus: d.validationStatus,
      })),
    },
    currentConditions: [] as Array<{ severity: string; description: string }>,
  };
}

/**
 * Returns true when the env opts the live KW call into Structured
 * Outputs (`response_format: { type: "json_schema", strict: true }`).
 *
 * - `KW_USE_STRUCTURED_OUTPUTS=true` (case-insensitive) → on.
 * - Anything else (unset, "false", "0", "") → off; we keep the legacy
 *   `json_object` path plus all defensive normalizers.
 *
 * The flag exists as a one-touch rollback to the pre-migration
 * behaviour without code changes.
 */
function structuredOutputsEnabled(): boolean {
  return (
    (process.env.KW_USE_STRUCTURED_OUTPUTS ?? "").toLowerCase() === "true"
  );
}

async function callOpenAISkill(
  args: GeenbankKredietworkflowInput,
  borrowerName: string,
): Promise<{
  mapped: MappedKredietworkflowAppAnalysis;
  model: string;
}> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    // Defensive — runtime resolver should already have downgraded to mock.
    throw new Error("OPENAI_API_KEY ontbreekt");
  }
  const model =
    process.env.AI_SKILL_GEENBANKKREDIETWORKFLOW_MODEL ??
    process.env.OPENAI_MODEL ??
    DEFAULT_OPENAI_MODEL;
  const systemPrompt = loadSkillMarkdown(SKILL_SLUG);
  const userPayload = buildSkillInput(args, borrowerName);

  const messages: OpenAIChatRequest["messages"] = [
    { role: "system", content: systemPrompt },
    {
      role: "user",
      content:
        "Voer de geenbank-kredietworkflow uit op onderstaande casus volgens de skill-instructies. " +
        "Geef uitsluitend JSON terug volgens het GeenbankKredietworkflowFinancierOutput-schema.\n\n" +
        JSON.stringify(userPayload),
    },
  ];

  const client = getOpenAIChatClient();
  const useStructured = structuredOutputsEnabled();

  // Primary call — structured outputs if enabled, else legacy json_object.
  let res;
  try {
    res = await client.chat(
      {
        model,
        temperature: 0,
        responseFormat: useStructured
          ? {
              type: "json_schema",
              schema: {
                name: "GeenbankKredietworkflowFinancierOutput",
                schema: KW_FINANCIER_JSON_SCHEMA,
                strict: true,
              },
            }
          : "json_object",
        messages,
      },
      { apiKey },
    );
  } catch (err) {
    // If the model/API rejects `json_schema` with HTTP 400, retry once
    // with the legacy `json_object` path. The defensive normalizer
    // chain still guards that path. We do NOT silently downgrade on
    // any other error — those propagate so the adapter falls back to
    // the deterministic mock with a structured fallbackReason.
    const isUnsupportedSchema =
      useStructured &&
      err instanceof OpenAIHttpError &&
      err.status === 400;
    if (!isUnsupportedSchema) throw err;
    logger.warn(
      { skill: MODULE, status: err.status, error: err.message },
      "[skill] structured outputs rejected (HTTP 400) — retrying with json_object",
    );
    res = await client.chat(
      {
        model,
        temperature: 0,
        responseFormat: "json_object",
        messages,
      },
      { apiKey },
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(res.content);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`OpenAI antwoord was geen geldige JSON: ${msg}`);
  }
  // Normalize common LLM pricing-rate shapes, riskAnalysis.summary,
  // and riskAnalysis.metrics BEFORE validation. Pass the deterministic
  // DSCR proxy so the metrics normalizer can backfill `dscr` when the
  // model omits it (it never overrides a valid model-supplied value
  // and never fabricates solvency / ltv / netWorkingCapital). Never
  // produces NaN. Schema validation still rejects every other
  // malformed field.
  parsed = normalizeKredietworkflowFinancierPayload(parsed, {
    deterministicDscr: args.dscr,
  });
  const problem = validateGeenbankKredietworkflowFinancierJson(parsed);
  if (problem) throw new Error(`Skill-antwoord ongeldig: ${problem}`);

  const validated = parsed as GeenbankKredietworkflowFinancierOutput;
  const mapped = mapKredietworkflowFinancierOutputToAppAnalysis(validated);
  return { mapped, model: res.model };
}

/** Build the app-shaped adapter output from a successfully mapped
 * canonical financier output. The central gate
 * (`GATE_THRESHOLDS`) is re-applied here — the LLM-derived
 * `canSubmit` may say `true`, but if any score is below threshold the
 * gated value MUST win. The orchestrator-level `checkRunAnalysisGate`
 * remains the binding source of truth at submit time. */
function buildLiveAppOutput(
  args: GeenbankKredietworkflowInput,
  mapped: MappedKredietworkflowAppAnalysis,
): GeenbankKredietworkflowOutput {
  const gate = gateCanSubmit(args);
  const canSubmit = mapped.entrepreneurReport.canSubmit && gate;
  return {
    confidenceScore: mapped.confidenceScore,
    verdict: mapped.aiVerdict,
    verdictSummary: mapped.verdictSummary,
    strongPoints: mapped.strongPoints,
    weakPoints: mapped.weakPoints,
    entrepreneurReport: {
      ...mapped.entrepreneurReport,
      canSubmit,
    },
  };
}

export const GeenbankKredietworkflowAdapter = {
  module: MODULE,
  async run(
    args: GeenbankKredietworkflowInput,
  ): Promise<SkillResult<GeenbankKredietworkflowOutput>> {
    const { ctx } = args;
    const startedAt = new Date();
    const inputSummary = `completeness=${args.completenessScore} correctness=${args.correctnessScore} viability=${args.viabilityScore} margin=${args.margin.toFixed(3)} dscr=${args.dscr.toFixed(2)}`;
    const wantLive =
      (process.env[PROVIDER_ENV] ?? "").toLowerCase() === "openai";
    try {
      const result = await instrumentSkill(
        MODULE,
        ctx,
        inputSummary,
        async (cfg) => {
          const mockOutput = buildMockOutput(args);
          const mockSummary = `verdict=${mockOutput.verdict} confidence=${mockOutput.confidenceScore} canSubmit=${mockOutput.entrepreneurReport.canSubmit}`;

          if (!wantLive || cfg.provider !== "openai") {
            return {
              data: mockOutput,
              outputSummary: mockSummary,
              usedMockMode: true,
              model: null,
            };
          }

          // Refuse to ask the LLM for a credit decision when the
          // borrower identity is missing. Never substitute a fake
          // name like "Onbekend" for a live credit workflow call.
          const borrowerName = resolveBorrowerName(ctx);
          if (!borrowerName) {
            const reason =
              "Bedrijfsidentiteit ontbreekt; live kredietworkflow niet uitgevoerd.";
            logger.warn(
              { skill: MODULE, dossierId: ctx.dossier.id },
              "[skill] missing borrower identity — falling back to mock",
            );
            return {
              data: mockOutput,
              outputSummary: `openai-skipped → ${mockSummary}`,
              ok: false,
              error: reason,
              usedMockMode: true,
              fallbackReason: reason,
              model: null,
            };
          }

          try {
            const { mapped, model } = await callOpenAISkill(args, borrowerName);
            const liveOutput = buildLiveAppOutput(args, mapped);
            const liveSummary = `openai verdict=${liveOutput.verdict} confidence=${liveOutput.confidenceScore} canSubmit=${liveOutput.entrepreneurReport.canSubmit} canonical=preserved`;
            return {
              data: liveOutput,
              outputSummary: liveSummary,
              extras: {
                skill: SKILL_SLUG,
                canonical: mapped.canonical,
                blockingConditions: mapped.blockingConditions,
                nonBlockingConditions: mapped.nonBlockingConditions,
                gateApplied: {
                  thresholds: GATE_THRESHOLDS,
                  scores: {
                    completeness: args.completenessScore,
                    correctness: args.correctnessScore,
                    viability: args.viabilityScore,
                  },
                  canSubmitFromMapper: mapped.entrepreneurReport.canSubmit,
                  canSubmitAfterGate: liveOutput.entrepreneurReport.canSubmit,
                },
              },
              model,
            };
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            logger.warn(
              { skill: MODULE, dossierId: ctx.dossier.id, error: msg },
              "[skill] openai live call failed — falling back to mock",
            );
            return {
              data: mockOutput,
              outputSummary: `openai-fallback → ${mockSummary}`,
              ok: false,
              error: `OpenAI-aanroep mislukt: ${msg}`,
              usedMockMode: true,
              fallbackReason: `OpenAI-aanroep mislukt: ${msg}`,
              model: null,
            };
          }
        },
      );
      return {
        module: MODULE,
        ok: result.ok,
        usedMockMode: result.usedMockMode,
        data: result.data,
        invocation: result.invocation,
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const invocation =
        (err as { __invocation?: ReturnType<typeof failedInvocation> })
          .__invocation ??
        failedInvocation(MODULE, startedAt, inputSummary, errorMessage);
      return {
        module: MODULE,
        ok: false,
        usedMockMode: true,
        data: fallback(ctx.companyName),
        error: errorMessage,
        invocation,
      };
    }
  },
};
