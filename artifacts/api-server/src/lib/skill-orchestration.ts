import { eq, desc, and, inArray } from "drizzle-orm";
import {
  db,
  dossiersTable,
  documentsTable,
  aiAnalysisRunsTable,
  conditionsTable,
  prospectProfilesTable,
} from "@workspace/db";
import {
  CreditProductAdvisorAdapter,
  FinancingNeedAssessorAdapter,
  FinancingProductAdvisorDualViewAdapter,
  GATE_THRESHOLDS,
  GeenbankKredietworkflowAdapter,
  MoneycareKredietmemorandumAdapter,
  REQUIRED_DOCUMENT_TYPES,
  SKILL_MODULES,
  type AnalysisOutput,
  type FinancierReport,
  type Memorandum,
  type SkillContext,
  type SkillInvocation,
  type SkillModule,
} from "./skills";

export {
  GATE_THRESHOLDS,
  REQUIRED_DOCUMENT_TYPES,
  SKILL_MODULES,
  type SkillModule,
  type SkillInvocation,
  type AnalysisOutput,
  type EntrepreneurReport,
  type FinancierReport,
  type Memorandum,
} from "./skills";

export { isAiLive } from "./skills/types";
export { describeAiRuntime, resolveSkillRuntime } from "./skills/runtime";

export type RunAnalysisGateResult =
  | { ok: true }
  | {
      ok: false;
      reasons: string[];
      actions: string[];
      missingDocuments: string[];
      invalidDocuments: string[];
      pendingDocuments: string[];
      blockingConditions: number;
      scores: {
        completeness: number;
        correctness: number;
        confidence: number;
        viability: number;
      };
      thresholds: typeof GATE_THRESHOLDS;
    };

/**
 * Server-side gate that determines whether a prospect may run the full
 * AI analysis. Mirrors what the frontend shows but is the single source
 * of truth — the client cannot bypass this.
 */
export async function checkRunAnalysisGate(
  dossierId: string,
): Promise<RunAnalysisGateResult> {
  const documents = await db
    .select()
    .from(documentsTable)
    .where(eq(documentsTable.dossierId, dossierId));

  const presentTypes = new Set(
    documents
      .filter((d) => d.validationStatus === "valid")
      .map((d) => d.documentType),
  );
  const pendingDocuments = documents
    .filter((d) => d.validationStatus === "pending")
    .map((d) => d.filename);
  const missingDocuments = REQUIRED_DOCUMENT_TYPES.filter(
    (t) => !presentTypes.has(t),
  );
  const invalidDocuments = documents
    .filter((d) => d.validationStatus === "invalid")
    .map((d) => d.filename);

  const blockingConditions = await db
    .select()
    .from(conditionsTable)
    .where(
      and(
        eq(conditionsTable.dossierId, dossierId),
        eq(conditionsTable.type, "blocking"),
        eq(conditionsTable.status, "open"),
      ),
    );

  const [latest] = await db
    .select()
    .from(aiAnalysisRunsTable)
    .where(
      and(
        eq(aiAnalysisRunsTable.dossierId, dossierId),
        inArray(aiAnalysisRunsTable.runType, ["prevalidation", "full_analysis"]),
      ),
    )
    .orderBy(desc(aiAnalysisRunsTable.startedAt))
    .limit(1);

  const completeness = latest?.completenessScore ?? 0;
  const correctness = latest?.correctnessScore ?? 0;
  const confidence = latest?.confidenceScore ?? 0;
  const viability = latest?.viabilityScore ?? 0;

  const reasons: string[] = [];
  const actions: string[] = [];

  if (!latest) {
    reasons.push("Voer eerst de pre-validatie uit op je dossier.");
    actions.push("Klik op 'Start pre-validatie' om je dossier te laten checken.");
  }
  if (missingDocuments.length > 0) {
    reasons.push(
      `Verplichte documenten ontbreken: ${missingDocuments.join(", ")}.`,
    );
    actions.push(
      "Upload de ontbrekende documenten via 'Documenten Aanleveren'.",
    );
  }
  if (invalidDocuments.length > 0) {
    reasons.push(
      `Een of meer documenten zijn ongeldig of onleesbaar: ${invalidDocuments.join(", ")}.`,
    );
    actions.push("Vervang ongeldige documenten door correcte versies.");
  }
  if (pendingDocuments.length > 0) {
    reasons.push(
      `Een of meer documenten staan nog op 'in behandeling': ${pendingDocuments.join(", ")}.`,
    );
    actions.push("Wacht tot validatie klaar is of upload het document opnieuw.");
  }
  if (blockingConditions.length > 0) {
    reasons.push(
      `Er staan ${blockingConditions.length} blokkerende voorwaarde(n) open.`,
    );
    actions.push(
      "Los de openstaande blokkerende voorwaarden op en probeer opnieuw.",
    );
  }
  if (latest && completeness < GATE_THRESHOLDS.completeness) {
    reasons.push(
      `Compleetheidsscore (${completeness}) ligt onder de drempel van ${GATE_THRESHOLDS.completeness}.`,
    );
    actions.push("Vul ontbrekende intakegegevens en documenten aan.");
  }
  if (latest && correctness < GATE_THRESHOLDS.correctness) {
    reasons.push(
      `Correctheidsscore (${correctness}) ligt onder de drempel van ${GATE_THRESHOLDS.correctness}.`,
    );
    actions.push("Verbeter of vervang documenten met onleesbare inhoud.");
  }
  if (latest && confidence < GATE_THRESHOLDS.confidence) {
    reasons.push(
      `Vertrouwensscore (${confidence}) ligt onder de drempel van ${GATE_THRESHOLDS.confidence}.`,
    );
    actions.push(
      "Voer eerst opnieuw de pre-validatie uit nadat je het dossier hebt aangevuld.",
    );
  }
  if (latest && viability < GATE_THRESHOLDS.viability) {
    reasons.push(
      `Levensvatbaarheidsscore (${viability}) ligt onder de drempel van ${GATE_THRESHOLDS.viability}.`,
    );
    actions.push(
      "Verbeter de financiële kerncijfers of vraag een passender bedrag.",
    );
  }

  if (reasons.length === 0) return { ok: true };
  return {
    ok: false,
    reasons,
    actions,
    missingDocuments: [...missingDocuments],
    invalidDocuments,
    pendingDocuments,
    blockingConditions: blockingConditions.length,
    scores: { completeness, correctness, confidence, viability },
    thresholds: GATE_THRESHOLDS,
  };
}

class SkillOrchestrationService {
  /** Stage 1: prospect-facing pre-validation. */
  async runPrevalidation(dossierId: string): Promise<{
    runId: string;
    output: AnalysisOutput;
  }> {
    return this.runStaged(dossierId, "prevalidation");
  }

  /** Stage 2: full AI analysis (loan officer view). */
  async runFullAnalysis(dossierId: string): Promise<{
    runId: string;
    output: AnalysisOutput;
  }> {
    return this.runStaged(dossierId, "full_analysis");
  }

  /** Stage 3: build a credit memorandum off the latest analysis. */
  async runMemorandum(dossierId: string): Promise<{
    runId: string;
    memorandum: Memorandum;
  }> {
    const ctx = await this.loadContext(dossierId);
    const [latest] = await db
      .select()
      .from(aiAnalysisRunsTable)
      .where(eq(aiAnalysisRunsTable.dossierId, dossierId))
      .orderBy(desc(aiAnalysisRunsTable.startedAt))
      .limit(1);

    const result = await MoneycareKredietmemorandumAdapter.buildMemorandum({
      ctx,
      financierReport:
        (latest?.financierReport as FinancierReport | null | undefined) ?? null,
      verdict: latest?.verdict ?? null,
    });

    const [run] = await db
      .insert(aiAnalysisRunsTable)
      .values({
        dossierId,
        runType: "memorandum",
        status: "completed",
        completedAt: new Date(),
        skillModulesUsed: [result.module],
        skillInvocations: [result.invocation],
        memorandum: result.data,
        usedMockMode: result.usedMockMode,
        errors: result.error ? [result.error] : [],
      })
      .returning();

    await db
      .update(dossiersTable)
      .set({ status: "memorandum_generated", updatedAt: new Date() })
      .where(eq(dossiersTable.id, dossierId));

    return { runId: run.id, memorandum: result.data };
  }

  // ---- Internals ----------------------------------------------------------

  private async loadContext(dossierId: string): Promise<SkillContext> {
    const [dossier] = await db
      .select()
      .from(dossiersTable)
      .where(eq(dossiersTable.id, dossierId))
      .limit(1);
    if (!dossier) throw new Error(`Dossier ${dossierId} niet gevonden`);
    const [prospect] = await db
      .select()
      .from(prospectProfilesTable)
      .where(eq(prospectProfilesTable.id, dossier.prospectId))
      .limit(1);
    const documents = await db
      .select()
      .from(documentsTable)
      .where(eq(documentsTable.dossierId, dossierId));
    const rawCompany = prospect?.companyName?.trim() ?? "";
    return {
      dossier,
      documents,
      // Display label: keep the historical "Onbekend" placeholder so
      // mock copy / UI strings stay safe when the prospect profile
      // has no company name yet.
      companyName: rawCompany || "Onbekend",
      // Real borrower identity for live skills: null when missing.
      // Live adapters MUST refuse to call the LLM in that case.
      borrowerName: rawCompany || null,
    };
  }

  private async analyze(ctx: SkillContext): Promise<AnalysisOutput> {
    const skillModulesUsed: SkillModule[] = [];
    const skillInvocations: SkillInvocation[] = [];
    const errors: string[] = [];
    let usedMockMode = false;

    const need = await FinancingNeedAssessorAdapter.run(ctx);
    skillModulesUsed.push(need.module);
    skillInvocations.push(need.invocation);
    usedMockMode = usedMockMode || need.usedMockMode;
    if (!need.ok && need.error) errors.push(`${need.module}: ${need.error}`);

    const credit = await CreditProductAdvisorAdapter.run(ctx);
    skillModulesUsed.push(credit.module);
    skillInvocations.push(credit.invocation);
    usedMockMode = usedMockMode || credit.usedMockMode;
    if (!credit.ok && credit.error)
      errors.push(`${credit.module}: ${credit.error}`);

    const dual = await FinancingProductAdvisorDualViewAdapter.run(ctx);
    skillModulesUsed.push(dual.module);
    skillInvocations.push(dual.invocation);
    usedMockMode = usedMockMode || dual.usedMockMode;
    if (!dual.ok && dual.error) errors.push(`${dual.module}: ${dual.error}`);

    const workflow = await GeenbankKredietworkflowAdapter.run({
      ctx,
      completenessScore: need.data.completenessScore,
      correctnessScore: credit.data.correctnessScore,
      viabilityScore: dual.data.viabilityScore,
      completedDocs: need.data.completedDocs,
      requiredDocs: need.data.requiredDocs,
      margin: dual.data.margin,
      dscr: dual.data.dscr,
      revenue: dual.data.revenue,
      profit: dual.data.profit,
      requested: dual.data.requested,
    });
    skillModulesUsed.push(workflow.module);
    skillInvocations.push(workflow.invocation);
    usedMockMode = usedMockMode || workflow.usedMockMode;
    if (!workflow.ok && workflow.error)
      errors.push(`${workflow.module}: ${workflow.error}`);

    const financier = await MoneycareKredietmemorandumAdapter.buildFinancierReport({
      ctx,
      margin: dual.data.margin,
      dscr: dual.data.dscr,
      revenue: dual.data.revenue,
      profit: dual.data.profit,
      requested: dual.data.requested,
      verdict: workflow.data.verdict,
      strongPoints: workflow.data.strongPoints,
      weakPoints: workflow.data.weakPoints,
    });
    skillModulesUsed.push(financier.module);
    skillInvocations.push(financier.invocation);
    usedMockMode = usedMockMode || financier.usedMockMode;
    if (!financier.ok && financier.error)
      errors.push(`${financier.module}: ${financier.error}`);

    return {
      completenessScore: need.data.completenessScore,
      correctnessScore: credit.data.correctnessScore,
      viabilityScore: dual.data.viabilityScore,
      confidenceScore: workflow.data.confidenceScore,
      verdict: workflow.data.verdict,
      verdictSummary: workflow.data.verdictSummary,
      entrepreneurReport: workflow.data.entrepreneurReport,
      financierReport: financier.data,
      skillModulesUsed,
      skillInvocations,
      usedMockMode,
      errors,
    };
  }

  private async runStaged(dossierId: string, runType: string) {
    const ctx = await this.loadContext(dossierId);
    const output = await this.analyze(ctx);

    const [run] = await db
      .insert(aiAnalysisRunsTable)
      .values({
        dossierId,
        runType,
        status: "completed",
        completedAt: new Date(),
        skillModulesUsed: output.skillModulesUsed,
        skillInvocations: output.skillInvocations,
        completenessScore: output.completenessScore,
        correctnessScore: output.correctnessScore,
        viabilityScore: output.viabilityScore,
        confidenceScore: output.confidenceScore,
        verdict: output.verdict,
        verdictSummary: output.verdictSummary,
        entrepreneurReport: output.entrepreneurReport,
        financierReport: output.financierReport,
        usedMockMode: output.usedMockMode,
        errors: output.errors,
      })
      .returning();

    // Only advance status while still in pre-submission stages — never
    // downgrade a dossier that has already moved into Geenbank's workflow.
    const preSubmissionStatuses = new Set([
      "lead_created",
      "prospect_logged_in",
      "intake_in_progress",
      "documents_uploaded",
      "ready_for_ai_analysis",
      "entrepreneur_report_ready",
    ]);
    const currentStatus = ctx.dossier.status;
    const nextStatus = preSubmissionStatuses.has(currentStatus)
      ? runType === "prevalidation"
        ? "ready_for_ai_analysis"
        : "entrepreneur_report_ready"
      : currentStatus;
    await db
      .update(dossiersTable)
      .set({
        status: nextStatus,
        completenessScore: output.completenessScore,
        correctnessScore: output.correctnessScore,
        viabilityScore: output.viabilityScore,
        confidenceScore: output.confidenceScore,
        aiVerdict: output.verdict,
        updatedAt: new Date(),
      })
      .where(eq(dossiersTable.id, dossierId));

    // Replace open conditions with the latest weak points
    await db
      .delete(conditionsTable)
      .where(eq(conditionsTable.dossierId, dossierId));
    for (const wp of output.entrepreneurReport.weakPoints) {
      await db.insert(conditionsTable).values({
        dossierId,
        type: output.entrepreneurReport.canSubmit ? "non_blocking" : "blocking",
        title: wp.split(".")[0] ?? wp,
        description: wp,
        status: "open",
      });
    }

    return { runId: run.id, output };
  }
}

export const skillOrchestrationService = new SkillOrchestrationService();
