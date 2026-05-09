import { instrumentSkill, failedInvocation } from "./runtime";
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

export const FinancingProductAdvisorDualViewAdapter = {
  module: MODULE,
  async run(
    ctx: SkillContext,
  ): Promise<SkillResult<FinancingProductAdvisorDualViewOutput>> {
    const startedAt = new Date();
    const { dossier } = ctx;
    const inputSummary = `revenue=${dossier.annualRevenue ?? 0} cost=${dossier.annualCost ?? 0} requested=${dossier.requestedAmount ?? 0}`;
    try {
      const result = await instrumentSkill(MODULE, ctx, inputSummary, async () => {
        const revenue = Number(dossier.annualRevenue ?? 0);
        const cost = Number(dossier.annualCost ?? 0);
        const profit = Number(dossier.annualProfit ?? revenue - cost);
        const requested = Number(dossier.requestedAmount ?? 0);
        const margin = revenue > 0 ? profit / revenue : 0;
        const dscr =
          requested > 0 ? Math.max(0, profit) / (requested * 0.12) : 0;

        let viability = 50;
        if (margin > 0.15) viability += 20;
        else if (margin > 0.05) viability += 10;
        else if (margin < 0) viability -= 15;
        if (dscr > 1.5) viability += 15;
        else if (dscr > 1.0) viability += 8;
        else if (dscr > 0 && dscr < 1.0) viability -= 10;
        if (revenue > 500_000) viability += 5;

        const viabilityScore = pct(viability);
        return {
          data: {
            viabilityScore,
            revenue,
            profit,
            requested,
            margin,
            dscr,
          },
          outputSummary: `viability=${viabilityScore} margin=${margin.toFixed(3)} dscr=${dscr.toFixed(2)}`,
        };
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
