import { eq, desc, and, inArray, ne } from "drizzle-orm";
import {
  db,
  dossiersTable,
  documentsTable,
  aiAnalysisRunsTable,
  conditionsTable,
  partnerFinanciersTable,
  prospectProfilesTable,
  type ProspectProfile,
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
  type EntrepreneurReport,
  type FinancierReport,
  type Memorandum,
  type SkillContext,
  type SkillInvocation,
  type SkillModule,
} from "./skills";
import { extractDualViewAdvice } from "./skills/dual-view-advice";

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

/**
 * Result of a package-readiness check. A "ready" package may be sent to
 * partners (memorandum + supporting data are complete enough to share);
 * a "draft" package may exist for officer preview but must not be
 * mock-sent. Frontend and backend both consult this — the backend is the
 * authoritative gate enforced on `POST /dossiers/:id/submissions`.
 */
export type PackageReadiness = {
  ready: boolean;
  draft: boolean;
  missingItems: string[];
};

/**
 * Authoritative server-side check for whether a dossier's partner package
 * is complete enough to mock-send. Combines: a completed AI analysis with
 * a verdict and gate-passing scores, a requested amount and purpose, at
 * least one validated document, no open blocking conditions, and a
 * generated memorandum with meaningful (non-"Niet beschikbaar") sections.
 *
 * Returns `ready: true` only when EVERY requirement is met. Otherwise
 * `ready: false` together with a Dutch `missingItems` list the UI can
 * render directly. `draft` mirrors `!ready` so callers can label the
 * memo state ("Conceptmemorandum" vs "Aanbiedpakket gereed").
 */
export async function computePackageReadiness(
  dossierId: string,
): Promise<PackageReadiness> {
  const [dossier] = await db
    .select()
    .from(dossiersTable)
    .where(eq(dossiersTable.id, dossierId))
    .limit(1);
  if (!dossier) {
    return {
      ready: false,
      draft: true,
      missingItems: ["Dossier niet gevonden."],
    };
  }
  const missingItems: string[] = [];

  const runs = await db
    .select()
    .from(aiAnalysisRunsTable)
    .where(eq(aiAnalysisRunsTable.dossierId, dossierId))
    .orderBy(desc(aiAnalysisRunsTable.startedAt));
  const analysis = runs.find(
    (r) =>
      (r.runType === "prevalidation" || r.runType === "full_analysis") &&
      r.status === "completed",
  );
  if (!analysis) {
    missingItems.push("Geen afgeronde AI-analyse beschikbaar.");
  }

  const verdict = dossier.aiVerdict ?? analysis?.verdict ?? null;
  if (!verdict) missingItems.push("AI-verdict ontbreekt.");

  const completeness = dossier.completenessScore ?? analysis?.completenessScore ?? null;
  const correctness = dossier.correctnessScore ?? analysis?.correctnessScore ?? null;
  const viability = dossier.viabilityScore ?? analysis?.viabilityScore ?? null;
  const confidence = dossier.confidenceScore ?? analysis?.confidenceScore ?? null;
  if (completeness === null) {
    missingItems.push("Compleetheidsscore ontbreekt.");
  } else if (completeness < GATE_THRESHOLDS.completeness) {
    missingItems.push(
      `Compleetheidsscore (${completeness}) onder drempel ${GATE_THRESHOLDS.completeness}.`,
    );
  }
  if (correctness === null) {
    missingItems.push("Correctheidsscore ontbreekt.");
  } else if (correctness < GATE_THRESHOLDS.correctness) {
    missingItems.push(
      `Correctheidsscore (${correctness}) onder drempel ${GATE_THRESHOLDS.correctness}.`,
    );
  }
  if (viability === null) {
    missingItems.push("Levensvatbaarheidsscore ontbreekt.");
  } else if (viability < GATE_THRESHOLDS.viability) {
    missingItems.push(
      `Levensvatbaarheidsscore (${viability}) onder drempel ${GATE_THRESHOLDS.viability}.`,
    );
  }
  if (confidence === null) {
    missingItems.push("Vertrouwensscore ontbreekt.");
  } else if (confidence < GATE_THRESHOLDS.confidence) {
    missingItems.push(
      `Vertrouwensscore (${confidence}) onder drempel ${GATE_THRESHOLDS.confidence}.`,
    );
  }

  const docs = await db
    .select()
    .from(documentsTable)
    .where(eq(documentsTable.dossierId, dossierId));
  const validDocs = docs.filter((d) => d.validationStatus === "valid");
  if (validDocs.length === 0) {
    missingItems.push("Geen gevalideerde documenten gekoppeld.");
  }

  const requested =
    dossier.requestedAmount !== null ? Number(dossier.requestedAmount) : null;
  if (requested === null || !Number.isFinite(requested) || requested <= 0) {
    missingItems.push("Gevraagd financieringsbedrag ontbreekt.");
  }

  if (!dossier.financingPurpose || dossier.financingPurpose.trim().length === 0) {
    missingItems.push("Financieringsdoel ontbreekt.");
  }

  const blockingOpen = await db
    .select()
    .from(conditionsTable)
    .where(
      and(
        eq(conditionsTable.dossierId, dossierId),
        eq(conditionsTable.type, "blocking"),
        ne(conditionsTable.status, "resolved"),
      ),
    );
  if (blockingOpen.length > 0) {
    missingItems.push(
      `${blockingOpen.length} openstaande blokkerende voorwaarde(n).`,
    );
  }

  const memoRun = runs.find(
    (r) => r.runType === "memorandum" && r.memorandum,
  );
  if (!memoRun) {
    missingItems.push("Kredietmemorandum nog niet gegenereerd.");
  } else {
    const memo = memoRun.memorandum as
      | { sections?: Array<{ title: string; body: string }> }
      | null;
    const meaningful = (memo?.sections ?? []).filter((s) => {
      const body = (s.body ?? "").trim();
      if (body.length === 0) return false;
      if (/^Niet beschikbaar\.?$/i.test(body)) return false;
      return true;
    });
    if (meaningful.length < 5) {
      missingItems.push(
        "Memorandum bevat te weinig gevulde secties (te veel 'Niet beschikbaar').",
      );
    }
  }

  const ready = missingItems.length === 0;
  return { ready, draft: !ready, missingItems };
}

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

  // A blocking condition counts as "outstanding" until the loan officer
  // actually marks it resolved. Both 'open' (no response yet) and
  // 'submitted' (waiting on officer review) must continue to block the
  // analysis / partner-submission gate.
  const blockingConditions = await db
    .select()
    .from(conditionsTable)
    .where(
      and(
        eq(conditionsTable.dossierId, dossierId),
        eq(conditionsTable.type, "blocking"),
        ne(conditionsTable.status, "resolved"),
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

  /**
   * Stage 3: build a credit memorandum off the latest AI analysis. Pulls
   * in dual-view advice, open + resolved conditions, prospect profile
   * and (optionally) the partner selection so the adapter can render a
   * full Dutch 14-section memorandum + per-partner package preview.
   *
   * When `partnerIds` is omitted, the memo is generated without partner
   * packages — useful as an initial preview before the loan officer has
   * picked partners.
   */
  async runMemorandum(
    dossierId: string,
    partnerIds: string[] = [],
  ): Promise<{
    runId: string;
    memorandum: Memorandum;
  }> {
    const ctx = await this.loadContext(dossierId);

    // Newest analysis run with real scoring (skip the memorandum-only
    // runs themselves so we always source from the latest prevalidation
    // / full_analysis snapshot).
    const runs = await db
      .select()
      .from(aiAnalysisRunsTable)
      .where(eq(aiAnalysisRunsTable.dossierId, dossierId))
      .orderBy(desc(aiAnalysisRunsTable.startedAt));
    const latest =
      runs.find((r) =>
        ["prevalidation", "full_analysis"].includes(r.runType),
      ) ?? null;

    const dualView = latest ? extractDualViewAdvice(dossierId, latest) : null;

    const [prospect] = ctx.dossier.prospectId
      ? await db
          .select()
          .from(prospectProfilesTable)
          .where(eq(prospectProfilesTable.id, ctx.dossier.prospectId))
          .limit(1)
      : [undefined as ProspectProfile | undefined];

    const conditionsRows = await db
      .select()
      .from(conditionsTable)
      .where(eq(conditionsTable.dossierId, dossierId));
    const openConds = conditionsRows
      .filter((c) => c.status !== "resolved")
      .map((c) => ({
        id: c.id,
        type: c.type as "blocking" | "non_blocking",
        title: c.title,
        description: c.description,
        requiredAction: c.requiredAction,
        status: c.status,
        reviewerNotes: c.reviewerNotes,
      }));
    const resolvedConds = conditionsRows
      .filter((c) => c.status === "resolved")
      .map((c) => ({
        id: c.id,
        type: c.type as "blocking" | "non_blocking",
        title: c.title,
        description: c.description,
        requiredAction: c.requiredAction,
        status: c.status,
        reviewerNotes: c.reviewerNotes,
      }));

    const uniquePartnerIds = Array.from(new Set(partnerIds));
    const partnerRows =
      uniquePartnerIds.length > 0
        ? await db
            .select()
            .from(partnerFinanciersTable)
            .where(inArray(partnerFinanciersTable.id, uniquePartnerIds))
        : [];

    const result = await MoneycareKredietmemorandumAdapter.buildMemorandum({
      ctx,
      prospect: prospect
        ? {
            companyName: prospect.companyName,
            contactName: prospect.contactName,
            kvkNumber: prospect.kvkNumber,
            phone: prospect.phone,
          }
        : null,
      entrepreneurReport:
        (latest?.entrepreneurReport as EntrepreneurReport | null | undefined) ??
        null,
      financierReport:
        (latest?.financierReport as FinancierReport | null | undefined) ?? null,
      verdict: latest?.verdict ?? null,
      verdictSummary: latest?.verdictSummary ?? null,
      scores: {
        completeness: latest?.completenessScore ?? null,
        correctness: latest?.correctnessScore ?? null,
        viability: latest?.viabilityScore ?? null,
        confidence: latest?.confidenceScore ?? null,
      },
      dualView,
      conditions: { open: openConds, resolved: resolvedConds },
      selectedPartners: partnerRows.map((p) => ({
        id: p.id,
        name: p.name,
        productFocus: p.productFocus,
        minimumTicketSize: p.minimumTicketSize,
        maximumTicketSize: p.maximumTicketSize,
        contactEmail: p.contactEmail,
        notes: p.notes,
      })),
      loanOfficerNotes: ctx.dossier.loanOfficerNotes,
      loanOfficerDecision: ctx.dossier.loanOfficerDecision,
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

    // Only advance to memorandum_generated when (a) the dossier isn't
    // already further along (e.g. partner-submitted) — re-generating the
    // memo mid-flow must never downgrade the dossier status — AND (b)
    // the package is actually READY for partners. A draft memo on an
    // incomplete dossier must NOT flip the status to "Memorandum
    // gegenereerd"; that label is reserved for ready packages so loan
    // officers don't mistake a draft for a green light.
    const advanceableStatuses = new Set([
      "approved_for_partner_submission",
      "memorandum_generated",
    ]);
    if (advanceableStatuses.has(ctx.dossier.status)) {
      const readiness = await computePackageReadiness(dossierId);
      if (readiness.ready) {
        await db
          .update(dossiersTable)
          .set({ status: "memorandum_generated", updatedAt: new Date() })
          .where(eq(dossiersTable.id, dossierId));
      } else if (ctx.dossier.status === "memorandum_generated") {
        // The dossier was previously ready but a subsequent change
        // (e.g. an analysis re-run with lower scores, a new blocking
        // condition) made it no longer ready. Roll the status back to
        // "approved_for_partner_submission" so the UI no longer claims
        // the memo is ready to send.
        await db
          .update(dossiersTable)
          .set({
            status: "approved_for_partner_submission",
            updatedAt: new Date(),
          })
          .where(eq(dossiersTable.id, dossierId));
      }
    }

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
