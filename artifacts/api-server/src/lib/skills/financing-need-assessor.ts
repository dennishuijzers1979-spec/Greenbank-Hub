import { instrumentSkill, failedInvocation } from "./runtime";
import {
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
    const startedAt = new Date();
    const inputSummary = `documents=${ctx.documents.length} dossier=${ctx.dossier.id}`;
    try {
      const result = await instrumentSkill(MODULE, ctx, inputSummary, async () => {
        const present = new Set(
          ctx.documents
            .filter((d) => d.validationStatus === "valid")
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
        return {
          data,
          outputSummary: `completeness=${completenessScore} docs=${completedDocs}/${requiredDocs} intake=${filled}/${intake.length}`,
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
