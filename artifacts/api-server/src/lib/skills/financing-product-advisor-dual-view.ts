import { logger } from "../logger";
import { getOpenAIChatClient, DEFAULT_OPENAI_MODEL } from "./openai-client";
import { instrumentSkill, failedInvocation } from "./runtime";
import { loadSkillMarkdown } from "./skill-loader";
import {
  pct,
  type SkillContext,
  type SkillResult,
} from "./types";

export type FinancingProductAdvisorDualViewOutput = {
  viabilityScore: number;
  revenue: number;
  profit: number;
  requested: number;
  margin: number;
  dscr: number;
};

const MODULE = "FinancingProductAdvisorDualView" as const;
const SKILL_SLUG = "financing-product-advisor-dual-view";
const PROVIDER_ENV = "AI_SKILL_FINANCINGPRODUCTADVISORDUALVIEW_PROVIDER";

const VALID_CTA_STATUSES = new Set([
  "ready_to_submit",
  "ready_to_submit_with_evidence_boosters",
  "not_ready_missing_evidence",
  "not_ready_restructure_case",
  "not_financeable_with_external_debt_now",
]);

const VALID_RECOMMENDATION_STATUSES = new Set([
  "strong",
  "provisional",
  "weak",
]);

type DerivedMetrics = {
  revenue: number;
  cost: number;
  profit: number;
  requested: number;
  margin: number;
  dscr: number;
};

function deriveMetrics(
  dossier: SkillContext["dossier"],
): DerivedMetrics {
  const revenue = Number(dossier.annualRevenue ?? 0);
  const cost = Number(dossier.annualCost ?? 0);
  const profit = Number(dossier.annualProfit ?? revenue - cost);
  const requested = Number(dossier.requestedAmount ?? 0);
  const margin = revenue > 0 ? profit / revenue : 0;
  const dscr =
    requested > 0 ? Math.max(0, profit) / (requested * 0.12) : 0;
  return { revenue, cost, profit, requested, margin, dscr };
}

function computeMockViability(m: DerivedMetrics): number {
  let viability = 50;
  if (m.margin > 0.15) viability += 20;
  else if (m.margin > 0.05) viability += 10;
  else if (m.margin < 0) viability -= 15;
  if (m.dscr > 1.5) viability += 15;
  else if (m.dscr > 1.0) viability += 8;
  else if (m.dscr > 0 && m.dscr < 1.0) viability -= 10;
  if (m.revenue > 500_000) viability += 5;
  return pct(viability);
}

function buildMockOutput(
  m: DerivedMetrics,
): FinancingProductAdvisorDualViewOutput {
  return {
    viabilityScore: computeMockViability(m),
    revenue: m.revenue,
    profit: m.profit,
    requested: m.requested,
    margin: m.margin,
    dscr: m.dscr,
  };
}

function fallback(): FinancingProductAdvisorDualViewOutput {
  return {
    viabilityScore: 50,
    revenue: 0,
    profit: 0,
    requested: 0,
    margin: 0,
    dscr: 0,
  };
}

/** Build the structured payload sent to the OpenAI skill. */
function buildSkillInput(ctx: SkillContext, m: DerivedMetrics) {
  const { dossier, documents } = ctx;
  return {
    dossier: {
      annualRevenue: dossier.annualRevenue,
      annualCost: dossier.annualCost,
      annualProfit: dossier.annualProfit,
      requestedAmount: dossier.requestedAmount,
      financingTypePreference: dossier.financingTypePreference,
      financingPurpose: dossier.financingPurpose,
      companyDescription: dossier.companyDescription,
    },
    derived: {
      margin: m.margin,
      dscr: m.dscr,
    },
    evidence: {
      documents: documents.map((d) => ({
        documentType: d.documentType,
        filename: d.filename,
        validationStatus: d.validationStatus,
      })),
      geenbankKredietworkflow: null,
    },
  };
}

/**
 * Validate that an OpenAI response matches the dual-view skill JSON
 * contract. Returns a problem string if invalid, or null if OK.
 */
function validateSkillJson(parsed: unknown): string | null {
  if (!parsed || typeof parsed !== "object") {
    return "antwoord is geen JSON-object";
  }
  const obj = parsed as Record<string, unknown>;
  const ev = obj.entrepreneur_view as Record<string, unknown> | undefined;
  const pv = obj.partner_view as Record<string, unknown> | undefined;
  if (!ev || typeof ev !== "object") return "entrepreneur_view ontbreekt";
  if (!pv || typeof pv !== "object") return "partner_view ontbreekt";
  const score = ev.financeability_score;
  if (typeof score !== "number" || !Number.isFinite(score)) {
    return "entrepreneur_view.financeability_score is geen geldig getal";
  }
  if (score < 0 || score > 10) {
    return `entrepreneur_view.financeability_score (${score}) buiten 0-10 bereik`;
  }
  const cta = ev.cta_status;
  if (cta !== undefined && cta !== "" && typeof cta === "string" && !VALID_CTA_STATUSES.has(cta)) {
    return `entrepreneur_view.cta_status "${cta}" is geen geldige waarde`;
  }
  const rec = pv.recommendation_status;
  if (rec !== undefined && rec !== "" && typeof rec === "string" && !VALID_RECOMMENDATION_STATUSES.has(rec)) {
    return `partner_view.recommendation_status "${rec}" is geen geldige waarde`;
  }
  return null;
}

/** Strip any string that looks like an API key from the persisted extras. */
function scrubExtras(value: unknown): unknown {
  if (typeof value === "string") {
    return value.replace(/sk-[A-Za-z0-9_-]{10,}/g, "sk-***");
  }
  if (Array.isArray(value)) return value.map(scrubExtras);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (/api[_-]?key|authorization|bearer/i.test(k)) continue;
      out[k] = scrubExtras(v);
    }
    return out;
  }
  return value;
}

async function callOpenAISkill(
  ctx: SkillContext,
  m: DerivedMetrics,
): Promise<{
  viabilityScore: number;
  outputSummary: string;
  extras: Record<string, unknown>;
  model: string;
}> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    // Defensive — runtime resolver should already have downgraded to mock.
    throw new Error("OPENAI_API_KEY ontbreekt");
  }
  const model =
    process.env.AI_SKILL_FINANCINGPRODUCTADVISORDUALVIEW_MODEL ??
    process.env.OPENAI_MODEL ??
    DEFAULT_OPENAI_MODEL;
  const systemPrompt = loadSkillMarkdown(SKILL_SLUG);
  const userPayload = buildSkillInput(ctx, m);

  const client = getOpenAIChatClient();
  const res = await client.chat(
    {
      model,
      temperature: 0,
      responseFormat: "json_object",
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content:
            "Beoordeel onderstaande financieringscasus volgens de skill-instructies. " +
            "Geef uitsluitend JSON terug volgens het opgegeven schema.\n\n" +
            JSON.stringify(userPayload),
        },
      ],
    },
    { apiKey },
  );

  let parsed: unknown;
  try {
    parsed = JSON.parse(res.content);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`OpenAI antwoord was geen geldige JSON: ${msg}`);
  }
  const problem = validateSkillJson(parsed);
  if (problem) throw new Error(`Skill-antwoord ongeldig: ${problem}`);

  const obj = parsed as {
    entrepreneur_view: { financeability_score: number };
  };
  const viabilityScore = pct(obj.entrepreneur_view.financeability_score * 10);
  const extras = scrubExtras({
    skill: SKILL_SLUG,
    response: parsed,
  }) as Record<string, unknown>;

  return {
    viabilityScore,
    outputSummary: `openai viability=${viabilityScore} (financeability=${obj.entrepreneur_view.financeability_score}/10)`,
    extras,
    model: res.model,
  };
}

export const FinancingProductAdvisorDualViewAdapter = {
  module: MODULE,
  async run(
    ctx: SkillContext,
  ): Promise<SkillResult<FinancingProductAdvisorDualViewOutput>> {
    const startedAt = new Date();
    const { dossier } = ctx;
    const inputSummary = `revenue=${dossier.annualRevenue ?? 0} cost=${dossier.annualCost ?? 0} requested=${dossier.requestedAmount ?? 0}`;
    const wantLive =
      (process.env[PROVIDER_ENV] ?? "").toLowerCase() === "openai";

    try {
      const result = await instrumentSkill(MODULE, ctx, inputSummary, async (cfg) => {
        const metrics = deriveMetrics(dossier);
        const mockOutput = buildMockOutput(metrics);
        const mockSummary = `viability=${mockOutput.viabilityScore} margin=${metrics.margin.toFixed(3)} dscr=${metrics.dscr.toFixed(2)}`;

        if (!wantLive || cfg.provider !== "openai") {
          // Mock path — ensure invocation reflects mock honestly even
          // when global OPENAI_API_KEY is set for other reasons.
          return {
            data: mockOutput,
            outputSummary: mockSummary,
            usedMockMode: true,
            model: null,
          };
        }

        try {
          const live = await callOpenAISkill(ctx, metrics);
          // Keep the deterministic margin/dscr/revenue/profit/requested
          // fields so the central gate stays stable; only override the
          // viabilityScore with the live signal.
          return {
            data: { ...mockOutput, viabilityScore: live.viabilityScore },
            outputSummary: live.outputSummary,
            extras: live.extras,
            model: live.model,
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.warn(
            { skill: MODULE, dossierId: dossier.id, error: msg },
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
      });
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
        (err as { __invocation?: ReturnType<typeof failedInvocation> }).__invocation ??
        failedInvocation(MODULE, startedAt, inputSummary, errorMessage);
      return {
        module: MODULE,
        ok: false,
        usedMockMode: true,
        data: fallback(),
        error: errorMessage,
        invocation,
      };
    }
  },
};
