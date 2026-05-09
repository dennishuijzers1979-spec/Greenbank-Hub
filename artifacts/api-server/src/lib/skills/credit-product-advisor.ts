import { instrumentSkill, failedInvocation } from "./runtime";
import {
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
    const startedAt = new Date();
    const inputSummary = `documents=${ctx.documents.length} dossier=${ctx.dossier.id}`;
    try {
      const result = await instrumentSkill(MODULE, ctx, inputSummary, async () => {
        const docs = ctx.documents;
        const validCount = docs.filter((d) => d.validationStatus === "valid").length;
        const invalidCount = docs.filter((d) => d.validationStatus === "invalid").length;
        const correctnessScore = pct(
          docs.length === 0 ? 50 : 70 + validCount * 5 - invalidCount * 15,
        );
        return {
          data: { correctnessScore },
          outputSummary: `correctnessScore=${correctnessScore} valid=${validCount} invalid=${invalidCount}`,
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
        data: { correctnessScore: 50 },
        error: errorMessage,
        invocation,
      };
    }
  },
};
