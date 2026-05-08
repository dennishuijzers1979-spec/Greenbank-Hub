import { eq, desc } from "drizzle-orm";
import {
  db,
  dossiersTable,
  documentsTable,
  aiAnalysisRunsTable,
  conditionsTable,
  prospectProfilesTable,
  type Dossier,
  type Document,
} from "@workspace/db";

export const SKILL_MODULES = [
  "CreditProductAdvisor",
  "FinancingNeedAssessor",
  "FinancingProductAdvisorDualView",
  "GeenbankKredietworkflow",
  "MoneycareKredietmemorandum",
] as const;

export type SkillModule = (typeof SKILL_MODULES)[number];

export const GATE_THRESHOLDS = {
  completeness: 60,
  correctness: 60,
  viability: 50,
} as const;

export function isAiLive(): boolean {
  return Boolean(
    process.env.ANTHROPIC_API_KEY ||
      process.env.OPENAI_API_KEY ||
      process.env.AI_API_KEY,
  );
}

function pct(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

export type EntrepreneurReport = {
  headline: string;
  summary: string;
  strongPoints: string[];
  weakPoints: string[];
  actionPoints: string[];
  likelyFinancierAsks: string[];
  canSubmit: boolean;
};

export type FinancierReport = {
  companySummary: string;
  financingRequest: string;
  financialAnalysis: string;
  repaymentCapacity: string;
  riskFactors: string[];
  strengths: string[];
  recommendation: string;
};

export type AnalysisOutput = {
  completenessScore: number;
  correctnessScore: number;
  viabilityScore: number;
  confidenceScore: number;
  verdict: string;
  verdictSummary: string;
  entrepreneurReport: EntrepreneurReport;
  financierReport: FinancierReport;
  skillModulesUsed: SkillModule[];
  usedMockMode: boolean;
  errors: string[];
};

type SkillContext = {
  dossier: Dossier;
  documents: Document[];
  companyName: string;
};

// --- Per-skill adapters ----------------------------------------------------
// Each adapter is responsible for one of the five named modules. Adapters
// return strongly-typed partial outputs that the orchestrator combines into
// a complete analysis result.

const FinancingNeedAssessor = {
  module: "FinancingNeedAssessor" as const,
  run(ctx: SkillContext) {
    const { dossier } = ctx;
    const required = [
      "annual_accounts",
      "bank_statements",
      "id_document",
      "kvk_extract",
    ];
    const present = new Set(ctx.documents.map((d) => d.documentType));
    const completedDocs = required.filter((t) => present.has(t)).length;
    const docs = (completedDocs / required.length) * 60;
    const intake = [
      dossier.financingPurpose,
      dossier.requestedAmount,
      dossier.financingTypePreference,
      dossier.annualRevenue,
      dossier.annualCost,
      dossier.annualProfit,
      dossier.companyDescription,
    ];
    const filled = intake.filter(
      (v) => v !== null && v !== undefined && v !== "",
    ).length;
    const completenessScore = pct(docs + (filled / intake.length) * 40);
    return { completenessScore, completedDocs, requiredDocs: required.length };
  },
};

const CreditProductAdvisor = {
  module: "CreditProductAdvisor" as const,
  run(ctx: SkillContext) {
    const docs = ctx.documents;
    const correctnessScore = pct(
      docs.length === 0
        ? 50
        : 70 + docs.filter((d) => d.validationStatus === "valid").length * 5,
    );
    return { correctnessScore };
  },
};

const FinancingProductAdvisorDualView = {
  module: "FinancingProductAdvisorDualView" as const,
  run(ctx: SkillContext) {
    const { dossier } = ctx;
    const revenue = Number(dossier.annualRevenue ?? 0);
    const cost = Number(dossier.annualCost ?? 0);
    const profit = Number(dossier.annualProfit ?? revenue - cost);
    const requested = Number(dossier.requestedAmount ?? 0);
    const margin = revenue > 0 ? profit / revenue : 0;
    const dscr = requested > 0 ? Math.max(0, profit) / (requested * 0.12) : 0;

    let viability = 50;
    if (margin > 0.15) viability += 20;
    else if (margin > 0.05) viability += 10;
    else if (margin < 0) viability -= 15;
    if (dscr > 1.5) viability += 15;
    else if (dscr > 1.0) viability += 8;
    else if (dscr > 0 && dscr < 1.0) viability -= 10;
    if (revenue > 500_000) viability += 5;

    return {
      viabilityScore: pct(viability),
      revenue,
      profit,
      requested,
      margin,
      dscr,
    };
  },
};

const GeenbankKredietworkflow = {
  module: "GeenbankKredietworkflow" as const,
  run(args: {
    ctx: SkillContext;
    completenessScore: number;
    correctnessScore: number;
    viabilityScore: number;
    completedDocs: number;
    requiredDocs: number;
    margin: number;
    dscr: number;
    revenue: number;
    profit: number;
    requested: number;
  }) {
    const {
      ctx,
      completenessScore,
      correctnessScore,
      viabilityScore,
      completedDocs,
      requiredDocs,
      margin,
      dscr,
      revenue,
      requested,
    } = args;
    const { dossier, companyName } = ctx;
    const confidenceScore = pct((completenessScore + correctnessScore) / 2);

    let verdict: string;
    if (viabilityScore >= 75 && completenessScore >= 70) verdict = "kansrijk";
    else if (viabilityScore >= 55) verdict = "voorwaardelijk";
    else verdict = "uitdagend";

    const verdictSummary =
      verdict === "kansrijk"
        ? `${companyName} laat sterke kasstroom en een onderbouwde financieringsvraag zien. Klaar om bij alternatieve financiers neer te leggen.`
        : verdict === "voorwaardelijk"
          ? `${companyName} heeft potentie, maar er zijn nog enkele aandachtspunten in het dossier voordat we partners benaderen.`
          : `${companyName} heeft op dit moment onvoldoende onderbouwing voor een succesvolle aanvraag bij alternatieve financiers.`;

    const strongPoints: string[] = [];
    const weakPoints: string[] = [];
    const actionPoints: string[] = [];

    if (margin > 0.1)
      strongPoints.push(
        `Gezonde marge van ${(margin * 100).toFixed(1)}% op de omzet.`,
      );
    if (dscr > 1.2)
      strongPoints.push(
        `De winst dekt ruimschoots een verwachte rente- en aflossingslast (DSCR ${dscr.toFixed(2)}).`,
      );
    if (completedDocs === requiredDocs)
      strongPoints.push("Alle kerndocumenten zijn aangeleverd en gevalideerd.");
    if (dossier.companyDescription && dossier.companyDescription.length > 80)
      strongPoints.push(
        "Heldere bedrijfsbeschrijving die richting en propositie laat zien.",
      );

    if (completedDocs < requiredDocs)
      weakPoints.push(
        `${requiredDocs - completedDocs} kerndocument(en) ontbreken nog (jaarcijfers, bankafschriften, ID, KVK-uittreksel).`,
      );
    if (margin < 0.05 && revenue > 0)
      weakPoints.push(
        "De marge is laag — financiers willen aflossingsruimte zien.",
      );
    if (requested > 0 && revenue > 0 && requested > revenue * 0.5)
      weakPoints.push(
        "De gevraagde financiering is groot ten opzichte van de jaaromzet.",
      );
    if (!dossier.financingPurpose)
      weakPoints.push("Doel van de financiering is nog niet ingevuld.");

    if (completedDocs < requiredDocs)
      actionPoints.push("Upload de ontbrekende kerndocumenten in het dossier.");
    if (!dossier.companyDescription)
      actionPoints.push(
        "Schrijf een korte bedrijfsbeschrijving (3-5 zinnen) over wat jullie doen en voor wie.",
      );
    if (margin < 0.1)
      actionPoints.push(
        "Onderbouw waarom de marge zal verbeteren of waar extra financiering ruimte creëert.",
      );
    if (actionPoints.length === 0)
      actionPoints.push(
        "Dossier is op orde — verstuur naar Geenbank voor formele beoordeling.",
      );

    const likelyFinancierAsks = [
      "Toelichting op de financieringsbehoefte en terugverdienperiode",
      "Cashflow-prognose voor de komende 12 maanden",
      "Aflossingscapaciteit bij stress-scenario (omzet -15%)",
      "Onderbouwing van het ondernemerschap en track record",
    ];

    const canSubmit =
      completenessScore >= GATE_THRESHOLDS.completeness &&
      correctnessScore >= GATE_THRESHOLDS.correctness &&
      viabilityScore >= GATE_THRESHOLDS.viability;

    const headline =
      verdict === "kansrijk"
        ? "Je dossier staat sterk — tijd om door te zetten."
        : verdict === "voorwaardelijk"
          ? "Je bent dichtbij — een paar aanvullingen maken het verschil."
          : "Er is nog werk te doen voordat we naar partners gaan.";

    const entrepreneurReport: EntrepreneurReport = {
      headline,
      summary: verdictSummary,
      strongPoints,
      weakPoints,
      actionPoints,
      likelyFinancierAsks,
      canSubmit,
    };

    return {
      confidenceScore,
      verdict,
      verdictSummary,
      entrepreneurReport,
      strongPoints,
      weakPoints,
    };
  },
};

const MoneycareKredietmemorandum = {
  module: "MoneycareKredietmemorandum" as const,
  buildFinancierReport(args: {
    ctx: SkillContext;
    margin: number;
    dscr: number;
    revenue: number;
    profit: number;
    requested: number;
    verdict: string;
    strongPoints: string[];
    weakPoints: string[];
  }): FinancierReport {
    const { ctx, margin, dscr, revenue, profit, requested, verdict } = args;
    const { dossier, companyName } = ctx;
    return {
      companySummary: `${companyName}${dossier.companyDescription ? `: ${dossier.companyDescription}` : ""}. Jaaromzet €${revenue.toLocaleString("nl-NL")}, jaarwinst €${profit.toLocaleString("nl-NL")}.`,
      financingRequest: `Aangevraagd: €${requested.toLocaleString("nl-NL")} ${dossier.financingTypePreference ? `(${dossier.financingTypePreference})` : ""}. Doel: ${dossier.financingPurpose ?? "niet gespecificeerd"}.`,
      financialAnalysis: `Marge ${(margin * 100).toFixed(1)}%, indicatieve DSCR ${dscr.toFixed(2)}. Bestaande financiering: ${dossier.existingFinancing ?? "geen of onbekend"}.`,
      repaymentCapacity:
        dscr > 1.2
          ? "Voldoende aflossingscapaciteit op basis van huidige resultaten."
          : dscr > 0.8
            ? "Aflossingscapaciteit is krap — gevoelig voor omzetdaling."
            : "Aflossingscapaciteit onvoldoende op basis van huidige cijfers.",
      riskFactors:
        args.weakPoints.length > 0
          ? args.weakPoints
          : ["Geen materiële risico's geïdentificeerd in pre-validatie."],
      strengths:
        args.strongPoints.length > 0
          ? args.strongPoints
          : [
              "Profiel sluit aan bij gangbare alternatieve financieringsproducten.",
            ],
      recommendation:
        verdict === "kansrijk"
          ? "Doorzetten naar 2-3 geselecteerde partnerfinanciers."
          : verdict === "voorwaardelijk"
            ? "Eerst voorwaarden adresseren, daarna selectief uitvragen bij partners."
            : "Aanvraag terugleggen bij ondernemer met concrete verbeterpunten.",
    };
  },
};

export type Memorandum = {
  sections: Array<{ title: string; body: string }>;
  attachments: string[];
  partnerNotes: string | null;
  usedMockMode: boolean;
};

// --- Orchestrator ----------------------------------------------------------

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

    const memo = this.buildMemorandum(
      ctx,
      (latest?.financierReport as FinancierReport | null | undefined) ?? null,
      latest?.verdict ?? null,
    );

    const [run] = await db
      .insert(aiAnalysisRunsTable)
      .values({
        dossierId,
        runType: "memorandum",
        status: "completed",
        completedAt: new Date(),
        skillModulesUsed: [MoneycareKredietmemorandum.module],
        memorandum: memo,
        usedMockMode: memo.usedMockMode,
      })
      .returning();

    await db
      .update(dossiersTable)
      .set({ status: "memorandum_generated", updatedAt: new Date() })
      .where(eq(dossiersTable.id, dossierId));

    return { runId: run.id, memorandum: memo };
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
    return { dossier, documents, companyName: prospect?.companyName ?? "Onbekend" };
  }

  private analyze(ctx: SkillContext): AnalysisOutput {
    const need = FinancingNeedAssessor.run(ctx);
    const credit = CreditProductAdvisor.run(ctx);
    const dual = FinancingProductAdvisorDualView.run(ctx);
    const workflow = GeenbankKredietworkflow.run({
      ctx,
      completenessScore: need.completenessScore,
      correctnessScore: credit.correctnessScore,
      viabilityScore: dual.viabilityScore,
      completedDocs: need.completedDocs,
      requiredDocs: need.requiredDocs,
      margin: dual.margin,
      dscr: dual.dscr,
      revenue: dual.revenue,
      profit: dual.profit,
      requested: dual.requested,
    });
    const financierReport = MoneycareKredietmemorandum.buildFinancierReport({
      ctx,
      margin: dual.margin,
      dscr: dual.dscr,
      revenue: dual.revenue,
      profit: dual.profit,
      requested: dual.requested,
      verdict: workflow.verdict,
      strongPoints: workflow.strongPoints,
      weakPoints: workflow.weakPoints,
    });

    return {
      completenessScore: need.completenessScore,
      correctnessScore: credit.correctnessScore,
      viabilityScore: dual.viabilityScore,
      confidenceScore: workflow.confidenceScore,
      verdict: workflow.verdict,
      verdictSummary: workflow.verdictSummary,
      entrepreneurReport: workflow.entrepreneurReport,
      financierReport,
      skillModulesUsed: [
        FinancingNeedAssessor.module,
        CreditProductAdvisor.module,
        FinancingProductAdvisorDualView.module,
        GeenbankKredietworkflow.module,
        MoneycareKredietmemorandum.module,
      ],
      usedMockMode: !isAiLive(),
      errors: [],
    };
  }

  private async runStaged(dossierId: string, runType: string) {
    const ctx = await this.loadContext(dossierId);
    const output = this.analyze(ctx);

    const [run] = await db
      .insert(aiAnalysisRunsTable)
      .values({
        dossierId,
        runType,
        status: "completed",
        completedAt: new Date(),
        skillModulesUsed: output.skillModulesUsed,
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

  private buildMemorandum(
    ctx: SkillContext,
    financierReport: FinancierReport | null,
    verdict: string | null,
  ): Memorandum {
    const { dossier, companyName, documents } = ctx;
    const v = verdict ?? "voorwaardelijk";
    const sections = [
      {
        title: "1. Samenvatting",
        body:
          financierReport?.companySummary ??
          `${companyName} dient een financieringsverzoek in via Geenbank Hub.`,
      },
      {
        title: "2. Financieringsverzoek",
        body:
          financierReport?.financingRequest ??
          `Bedrag €${Number(dossier.requestedAmount ?? 0).toLocaleString("nl-NL")} — doel: ${dossier.financingPurpose ?? "n.t.b."}.`,
      },
      {
        title: "3. Financiële analyse",
        body:
          financierReport?.financialAnalysis ??
          "Pre-validatie nog niet uitgevoerd.",
      },
      {
        title: "4. Aflossingscapaciteit",
        body: financierReport?.repaymentCapacity ?? "Nog te bepalen.",
      },
      {
        title: "5. Sterktes",
        body:
          (financierReport?.strengths ?? []).map((s) => `• ${s}`).join("\n") ||
          "—",
      },
      {
        title: "6. Risico's en aandachtspunten",
        body:
          (financierReport?.riskFactors ?? [])
            .map((s) => `• ${s}`)
            .join("\n") || "—",
      },
      {
        title: "7. Aanbeveling kredietacceptant",
        body:
          financierReport?.recommendation ?? `Voorlopig oordeel: ${v}.`,
      },
    ];
    return {
      sections,
      attachments: documents.map((d) => `${d.documentType}: ${d.filename}`),
      partnerNotes: null,
      usedMockMode: !isAiLive(),
    };
  }
}

export const skillOrchestrationService = new SkillOrchestrationService();
