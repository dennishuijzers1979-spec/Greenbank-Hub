import {
  isAiLive,
  logSkillError,
  logSkillStart,
  logSkillSuccess,
  pct,
  type SkillContext,
  type SkillResult,
} from "./types";

export type CreditProductAdvisorOutput = {
  correctnessScore: number;
};

const MODULE = "CreditProductAdvisor" as const;

export const CreditProductAdvisorAdapter = {
  module: MODULE,
  async run(
    ctx: SkillContext,
  ): Promise<SkillResult<CreditProductAdvisorOutput>> {
    logSkillStart(MODULE, ctx.dossier.id);
    try {
      const docs = ctx.documents;
      const validCount = docs.filter(
        (d) => d.validationStatus === "valid",
      ).length;
      const invalidCount = docs.filter(
        (d) => d.validationStatus === "invalid",
      ).length;
      const correctnessScore = pct(
        docs.length === 0 ? 50 : 70 + validCount * 5 - invalidCount * 15,
      );
      const usedMockMode = !isAiLive();
      logSkillSuccess(MODULE, ctx.dossier.id, usedMockMode);
      return {
        module: MODULE,
        ok: true,
        usedMockMode,
        data: { correctnessScore },
      };
    } catch (err) {
      logSkillError(MODULE, ctx.dossier.id, err);
      return {
        module: MODULE,
        ok: false,
        usedMockMode: true,
        data: { correctnessScore: 50 },
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};
