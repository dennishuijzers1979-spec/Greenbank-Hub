import {
  isAiLive,
  logSkillError,
  logSkillStart,
  logSkillSuccess,
  pct,
  REQUIRED_DOCUMENT_TYPES,
  type SkillContext,
  type SkillResult,
} from "./types";

export type FinancingNeedAssessorOutput = {
  completenessScore: number;
  completedDocs: number;
  requiredDocs: number;
};

const MODULE = "FinancingNeedAssessor" as const;

function fallback(): FinancingNeedAssessorOutput {
  return {
    completenessScore: 0,
    completedDocs: 0,
    requiredDocs: REQUIRED_DOCUMENT_TYPES.length,
  };
}

export const FinancingNeedAssessorAdapter = {
  module: MODULE,
  async run(
    ctx: SkillContext,
  ): Promise<SkillResult<FinancingNeedAssessorOutput>> {
    logSkillStart(MODULE, ctx.dossier.id);
    try {
      const present = new Set(
        ctx.documents
          .filter((d) => d.validationStatus !== "invalid")
          .map((d) => d.documentType),
      );
      const completedDocs = REQUIRED_DOCUMENT_TYPES.filter((t) =>
        present.has(t),
      ).length;
      const requiredDocs = REQUIRED_DOCUMENT_TYPES.length;
      const docs = (completedDocs / requiredDocs) * 60;
      const intake = [
        ctx.dossier.financingPurpose,
        ctx.dossier.requestedAmount,
        ctx.dossier.financingTypePreference,
        ctx.dossier.annualRevenue,
        ctx.dossier.annualCost,
        ctx.dossier.annualProfit,
        ctx.dossier.companyDescription,
      ];
      const filled = intake.filter(
        (v) => v !== null && v !== undefined && v !== "",
      ).length;
      const completenessScore = pct(docs + (filled / intake.length) * 40);
      const data: FinancingNeedAssessorOutput = {
        completenessScore,
        completedDocs,
        requiredDocs,
      };
      const usedMockMode = !isAiLive();
      logSkillSuccess(MODULE, ctx.dossier.id, usedMockMode);
      return { module: MODULE, ok: true, usedMockMode, data };
    } catch (err) {
      logSkillError(MODULE, ctx.dossier.id, err);
      return {
        module: MODULE,
        ok: false,
        usedMockMode: true,
        data: fallback(),
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};
