import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import {
  db,
  dossiersTable,
  prospectProfilesTable,
  aiAnalysisRunsTable,
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
import { skillOrchestrationService } from "../lib/skill-orchestration";
import { officerCanAccessDossier } from "../lib/dossier-access";

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

async function loadDossierForOfficer(dossierId: string) {
  const [run] = await db
    .select()
    .from(aiAnalysisRunsTable)
    .where(eq(aiAnalysisRunsTable.dossierId, dossierId))
    .orderBy(desc(aiAnalysisRunsTable.startedAt))
    .limit(1);
  return run ?? null;
}

router.post(
  "/dossiers/me/run-prevalidation",
  requireAuth(["prospect"]),
  async (req, res): Promise<void> => {
    const ctx = await loadMyDossier(req.user!.id);
    if (!ctx) {
      res.status(404).json({ error: "Geen dossier" });
      return;
    }
    const { runId } = await skillOrchestrationService.runPrevalidation(
      ctx.dossier.id,
    );
    const [run] = await db
      .select()
      .from(aiAnalysisRunsTable)
      .where(eq(aiAnalysisRunsTable.id, runId))
      .limit(1);
    await logActivity({
      dossierId: ctx.dossier.id,
      actor: req.user!,
      action: "prevalidation_run",
      description: "Pre-validatie uitgevoerd.",
    });
    res.json(serializeRun(run));
  },
);

router.post(
  "/dossiers/me/run-analysis",
  requireAuth(["prospect"]),
  async (req, res): Promise<void> => {
    const ctx = await loadMyDossier(req.user!.id);
    if (!ctx) {
      res.status(404).json({ error: "Geen dossier" });
      return;
    }
    const { runId } = await skillOrchestrationService.runFullAnalysis(
      ctx.dossier.id,
    );
    const [run] = await db
      .select()
      .from(aiAnalysisRunsTable)
      .where(eq(aiAnalysisRunsTable.id, runId))
      .limit(1);
    await logActivity({
      dossierId: ctx.dossier.id,
      actor: req.user!,
      action: "ai_analysis_run",
      description: "Volledige AI-analyse uitgevoerd.",
    });
    res.json(serializeRun(run));
  },
);

router.get(
  "/dossiers/:dossierId/runs",
  requireAuth(["loan_officer", "admin"]),
  async (req, res): Promise<void> => {
    const params = ListDossierRunsParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    if (!(await officerCanAccessDossier(params.data.dossierId))) {
      res.status(404).json({ error: "Dossier niet gevonden" });
      return;
    }
    const runs = await db
      .select()
      .from(aiAnalysisRunsTable)
      .where(eq(aiAnalysisRunsTable.dossierId, params.data.dossierId))
      .orderBy(desc(aiAnalysisRunsTable.startedAt));
    res.json(runs.map(serializeRun));
  },
);

router.get(
  "/dossiers/:dossierId/latest-run",
  requireAuth(["loan_officer", "admin", "prospect"]),
  async (req, res): Promise<void> => {
    const params = GetLatestRunParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
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
    } else if (!(await officerCanAccessDossier(params.data.dossierId))) {
      res.status(404).json({ error: "Geen analyse gevonden" });
      return;
    }
    const run = await loadDossierForOfficer(params.data.dossierId);
    if (!run) {
      res.status(404).json({ error: "Geen analyse gevonden" });
      return;
    }
    res.json(serializeRun(run));
  },
);

router.get(
  "/dossiers/me/report",
  requireAuth(["prospect"]),
  async (req, res): Promise<void> => {
    const ctx = await loadMyDossier(req.user!.id);
    if (!ctx) {
      res.status(404).json({ error: "Geen dossier" });
      return;
    }
    const run = await loadDossierForOfficer(ctx.dossier.id);
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
        actionPoints: [
          "Vul je intake aan en upload je documenten, en start de pre-validatie.",
        ],
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
  },
);

router.get(
  "/dossiers/:dossierId/financier-report",
  requireAuth(["loan_officer", "admin"]),
  async (req, res): Promise<void> => {
    const params = GetFinancierReportParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    if (!(await officerCanAccessDossier(params.data.dossierId))) {
      res.status(404).json({ error: "Dossier niet gevonden" });
      return;
    }
    const run = await loadDossierForOfficer(params.data.dossierId);
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
  },
);

router.post(
  "/dossiers/:dossierId/memorandum",
  requireAuth(["loan_officer", "admin"]),
  async (req, res): Promise<void> => {
    const params = GenerateMemorandumParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    if (!(await officerCanAccessDossier(params.data.dossierId))) {
      res.status(404).json({ error: "Dossier niet gevonden" });
      return;
    }
    const { memorandum } = await skillOrchestrationService.runMemorandum(
      params.data.dossierId,
    );
    await logActivity({
      dossierId: params.data.dossierId,
      actor: req.user!,
      action: "memorandum_generated",
      description: "Kredietmemorandum gegenereerd.",
    });
    res.json({
      dossierId: params.data.dossierId,
      generatedAt: new Date().toISOString(),
      usedMockMode: memorandum.usedMockMode,
      sections: memorandum.sections,
      attachments: memorandum.attachments,
      partnerNotes: memorandum.partnerNotes,
    });
  },
);

router.get(
  "/dossiers/:dossierId/memorandum",
  requireAuth(["loan_officer", "admin"]),
  async (req, res): Promise<void> => {
    const params = GetMemorandumParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    if (!(await officerCanAccessDossier(params.data.dossierId))) {
      res.status(404).json({ error: "Dossier niet gevonden" });
      return;
    }
    const runs = await db
      .select()
      .from(aiAnalysisRunsTable)
      .where(eq(aiAnalysisRunsTable.dossierId, params.data.dossierId))
      .orderBy(desc(aiAnalysisRunsTable.startedAt));
    const memoRun = runs.find((r) => r.runType === "memorandum" && r.memorandum);
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
  },
);

export default router;
