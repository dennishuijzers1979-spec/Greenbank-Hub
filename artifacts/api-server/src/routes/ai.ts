import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import {
  db,
  dossiersTable,
  prospectProfilesTable,
  documentsTable,
  aiAnalysisRunsTable,
  conditionsTable,
} from "@workspace/db";
import {
  ListDossierRunsParams,
  GetLatestRunParams,
  GetFinancierReportParams,
  GenerateMemorandumParams,
  GetMemorandumParams,
} from "@workspace/api-zod";
import { requireAuth } from "../lib/auth";
import { logActivity } from "../lib/activity";
import { serializeRun } from "../lib/serializers";
import { runFullPipeline, buildMemorandum } from "../lib/ai-skills";

const router: IRouter = Router();

async function loadMyDossier(userId: string) {
  const [prospect] = await db
    .select()
    .from(prospectProfilesTable)
    .where(eq(prospectProfilesTable.userId, userId))
    .limit(1);
  if (!prospect) return null;
  const [dossier] = await db
    .select()
    .from(dossiersTable)
    .where(eq(dossiersTable.prospectId, prospect.id))
    .limit(1);
  if (!dossier) return null;
  return { prospect, dossier };
}

async function executePipeline(dossierId: string, runType: string, companyName: string) {
  const dossierRow = (await db.select().from(dossiersTable).where(eq(dossiersTable.id, dossierId)).limit(1))[0];
  const docs = await db.select().from(documentsTable).where(eq(documentsTable.dossierId, dossierId));
  const result = await runFullPipeline({ dossier: dossierRow, documents: docs, companyName });
  const [run] = await db
    .insert(aiAnalysisRunsTable)
    .values({
      dossierId,
      runType,
      status: "completed",
      completedAt: new Date(),
      skillModulesUsed: result.skillModulesUsed,
      completenessScore: result.completenessScore,
      correctnessScore: result.correctnessScore,
      viabilityScore: result.viabilityScore,
      confidenceScore: result.confidenceScore,
      verdict: result.verdict,
      verdictSummary: result.verdictSummary,
      entrepreneurReport: result.entrepreneurReport,
      financierReport: result.financierReport,
      usedMockMode: result.usedMockMode,
      errors: result.errors,
    })
    .returning();
  await db
    .update(dossiersTable)
    .set({
      status: runType === "prevalidation" ? "ready_for_ai_analysis" : "entrepreneur_report_ready",
      completenessScore: result.completenessScore,
      correctnessScore: result.correctnessScore,
      viabilityScore: result.viabilityScore,
      confidenceScore: result.confidenceScore,
      aiVerdict: result.verdict,
      updatedAt: new Date(),
    })
    .where(eq(dossiersTable.id, dossierId));
  // Sync blocking conditions for missing docs
  await db
    .delete(conditionsTable)
    .where(eq(conditionsTable.dossierId, dossierId));
  for (const wp of result.entrepreneurReport.weakPoints) {
    await db.insert(conditionsTable).values({
      dossierId,
      type: result.entrepreneurReport.canSubmit ? "non_blocking" : "blocking",
      title: wp.split(".")[0] ?? wp,
      description: wp,
      status: "open",
    });
  }
  return run;
}

router.post("/dossiers/me/run-prevalidation", requireAuth(["prospect"]), async (req, res): Promise<void> => {
  const ctx = await loadMyDossier(req.user!.id);
  if (!ctx) {
    res.status(404).json({ error: "Geen dossier" });
    return;
  }
  const run = await executePipeline(ctx.dossier.id, "prevalidation", ctx.prospect.companyName);
  await logActivity({
    dossierId: ctx.dossier.id,
    actor: req.user!,
    action: "prevalidation_run",
    description: "Pre-validatie uitgevoerd.",
  });
  res.json(serializeRun(run));
});

router.post("/dossiers/me/run-analysis", requireAuth(["prospect"]), async (req, res): Promise<void> => {
  const ctx = await loadMyDossier(req.user!.id);
  if (!ctx) {
    res.status(404).json({ error: "Geen dossier" });
    return;
  }
  const run = await executePipeline(ctx.dossier.id, "full_analysis", ctx.prospect.companyName);
  await logActivity({
    dossierId: ctx.dossier.id,
    actor: req.user!,
    action: "ai_analysis_run",
    description: "Volledige AI-analyse uitgevoerd.",
  });
  res.json(serializeRun(run));
});

router.get("/dossiers/:dossierId/runs", requireAuth(["loan_officer", "admin"]), async (req, res): Promise<void> => {
  const params = ListDossierRunsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const runs = await db
    .select()
    .from(aiAnalysisRunsTable)
    .where(eq(aiAnalysisRunsTable.dossierId, params.data.dossierId))
    .orderBy(desc(aiAnalysisRunsTable.startedAt));
  res.json(runs.map(serializeRun));
});

router.get("/dossiers/:dossierId/latest-run", requireAuth(["loan_officer", "admin", "prospect"]), async (req, res): Promise<void> => {
  const params = GetLatestRunParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  // Enforce ownership for prospects
  if (req.user!.role === "prospect") {
    const [row] = await db
      .select({ userId: prospectProfilesTable.userId })
      .from(dossiersTable)
      .innerJoin(
        prospectProfilesTable,
        eq(prospectProfilesTable.id, dossiersTable.prospectId),
      )
      .where(eq(dossiersTable.id, params.data.dossierId))
      .limit(1);
    if (!row || row.userId !== req.user!.id) {
      res.status(404).json({ error: "Geen analyse gevonden" });
      return;
    }
  }
  const [run] = await db
    .select()
    .from(aiAnalysisRunsTable)
    .where(eq(aiAnalysisRunsTable.dossierId, params.data.dossierId))
    .orderBy(desc(aiAnalysisRunsTable.startedAt))
    .limit(1);
  if (!run) {
    res.status(404).json({ error: "Geen analyse gevonden" });
    return;
  }
  res.json(serializeRun(run));
});

router.get("/dossiers/me/report", requireAuth(["prospect"]), async (req, res): Promise<void> => {
  const ctx = await loadMyDossier(req.user!.id);
  if (!ctx) {
    res.status(404).json({ error: "Geen dossier" });
    return;
  }
  const [run] = await db
    .select()
    .from(aiAnalysisRunsTable)
    .where(eq(aiAnalysisRunsTable.dossierId, ctx.dossier.id))
    .orderBy(desc(aiAnalysisRunsTable.startedAt))
    .limit(1);
  if (!run || !run.entrepreneurReport) {
    res.json({
      dossierId: ctx.dossier.id,
      runId: null,
      generatedAt: null,
      headline: "Nog geen rapport beschikbaar",
      summary: "Voer eerst de pre-validatie uit op je dossier.",
      verdict: null,
      viabilityScore: null,
      confidenceScore: null,
      strongPoints: [],
      weakPoints: [],
      actionPoints: ["Vul je intake aan en upload je documenten, en start de pre-validatie."],
      likelyFinancierAsks: [],
      canSubmit: false,
    });
    return;
  }
  const r = run.entrepreneurReport as Record<string, unknown>;
  res.json({
    dossierId: ctx.dossier.id,
    runId: run.id,
    generatedAt: (run.completedAt ?? run.startedAt).toISOString(),
    headline: r.headline,
    summary: r.summary,
    verdict: run.verdict,
    viabilityScore: run.viabilityScore,
    confidenceScore: run.confidenceScore,
    strongPoints: r.strongPoints ?? [],
    weakPoints: r.weakPoints ?? [],
    actionPoints: r.actionPoints ?? [],
    likelyFinancierAsks: r.likelyFinancierAsks ?? [],
    canSubmit: r.canSubmit ?? false,
  });
});

router.get("/dossiers/:dossierId/financier-report", requireAuth(["loan_officer", "admin"]), async (req, res): Promise<void> => {
  const params = GetFinancierReportParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [run] = await db
    .select()
    .from(aiAnalysisRunsTable)
    .where(eq(aiAnalysisRunsTable.dossierId, params.data.dossierId))
    .orderBy(desc(aiAnalysisRunsTable.startedAt))
    .limit(1);
  if (!run || !run.financierReport) {
    res.status(404).json({ error: "Geen rapport gevonden" });
    return;
  }
  const r = run.financierReport as Record<string, unknown>;
  res.json({
    dossierId: params.data.dossierId,
    runId: run.id,
    generatedAt: (run.completedAt ?? run.startedAt).toISOString(),
    companySummary: r.companySummary,
    financingRequest: r.financingRequest,
    financialAnalysis: r.financialAnalysis,
    repaymentCapacity: r.repaymentCapacity,
    riskFactors: r.riskFactors ?? [],
    strengths: r.strengths ?? [],
    recommendation: r.recommendation,
    verdict: run.verdict,
    viabilityScore: run.viabilityScore,
    confidenceScore: run.confidenceScore,
  });
});

router.post("/dossiers/:dossierId/memorandum", requireAuth(["loan_officer", "admin"]), async (req, res): Promise<void> => {
  const params = GenerateMemorandumParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db
    .select()
    .from(dossiersTable)
    .innerJoin(prospectProfilesTable, eq(prospectProfilesTable.id, dossiersTable.prospectId))
    .where(eq(dossiersTable.id, params.data.dossierId))
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "Dossier niet gevonden" });
    return;
  }
  const [latestRun] = await db
    .select()
    .from(aiAnalysisRunsTable)
    .where(eq(aiAnalysisRunsTable.dossierId, params.data.dossierId))
    .orderBy(desc(aiAnalysisRunsTable.startedAt))
    .limit(1);
  const docs = await db
    .select()
    .from(documentsTable)
    .where(eq(documentsTable.dossierId, params.data.dossierId));
  const memo = buildMemorandum({
    dossier: row.dossiers,
    companyName: row.prospect_profiles.companyName,
    pipeline: latestRun
      ? {
          completenessScore: latestRun.completenessScore ?? 0,
          correctnessScore: latestRun.correctnessScore ?? 0,
          viabilityScore: latestRun.viabilityScore ?? 0,
          confidenceScore: latestRun.confidenceScore ?? 0,
          verdict: latestRun.verdict ?? "voorwaardelijk",
          verdictSummary: latestRun.verdictSummary ?? "",
          entrepreneurReport: latestRun.entrepreneurReport as never,
          financierReport: latestRun.financierReport as never,
          skillModulesUsed: (latestRun.skillModulesUsed as string[]) ?? [],
          usedMockMode: latestRun.usedMockMode,
          errors: (latestRun.errors as string[]) ?? [],
        }
      : null,
    documents: docs,
  });
  await db
    .insert(aiAnalysisRunsTable)
    .values({
      dossierId: params.data.dossierId,
      runType: "memorandum",
      status: "completed",
      completedAt: new Date(),
      skillModulesUsed: ["MoneycareKredietmemorandum"],
      memorandum: memo,
      usedMockMode: memo.usedMockMode,
    });
  await db
    .update(dossiersTable)
    .set({ status: "memorandum_generated", updatedAt: new Date() })
    .where(eq(dossiersTable.id, params.data.dossierId));
  await logActivity({
    dossierId: params.data.dossierId,
    actor: req.user!,
    action: "memorandum_generated",
    description: "Kredietmemorandum gegenereerd.",
  });
  res.json({
    dossierId: params.data.dossierId,
    generatedAt: new Date().toISOString(),
    usedMockMode: memo.usedMockMode,
    sections: memo.sections,
    attachments: memo.attachments,
    partnerNotes: memo.partnerNotes,
  });
});

router.get("/dossiers/:dossierId/memorandum", requireAuth(["loan_officer", "admin"]), async (req, res): Promise<void> => {
  const params = GetMemorandumParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [run] = await db
    .select()
    .from(aiAnalysisRunsTable)
    .where(eq(aiAnalysisRunsTable.dossierId, params.data.dossierId))
    .orderBy(desc(aiAnalysisRunsTable.startedAt))
    .limit(50);
  const memoRun = (
    await db
      .select()
      .from(aiAnalysisRunsTable)
      .where(eq(aiAnalysisRunsTable.dossierId, params.data.dossierId))
      .orderBy(desc(aiAnalysisRunsTable.startedAt))
  ).find((r) => r.runType === "memorandum" && r.memorandum);
  if (!memoRun) {
    res.status(404).json({ error: "Geen memorandum gegenereerd" });
    return;
  }
  const m = memoRun.memorandum as Record<string, unknown>;
  res.json({
    dossierId: params.data.dossierId,
    generatedAt: (memoRun.completedAt ?? memoRun.startedAt).toISOString(),
    usedMockMode: memoRun.usedMockMode,
    sections: m.sections ?? [],
    attachments: m.attachments ?? [],
    partnerNotes: m.partnerNotes ?? null,
  });
  void run;
});

export default router;
