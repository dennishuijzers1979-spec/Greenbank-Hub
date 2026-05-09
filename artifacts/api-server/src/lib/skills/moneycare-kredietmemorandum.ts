import { instrumentSkill, failedInvocation } from "./runtime";
import {
  type FinancierReport,
  type Memorandum,
  type SkillContext,
  type SkillResult,
} from "./types";

export type MoneycareFinancierReportInput = {
  ctx: SkillContext;
  margin: number;
  dscr: number;
  revenue: number;
  profit: number;
  requested: number;
  verdict: string;
  strongPoints: string[];
  weakPoints: string[];
};

const MODULE = "MoneycareKredietmemorandum" as const;

function fallback(companyName: string): FinancierReport {
  return {
    companySummary: `${companyName}: rapport kon niet worden samengesteld.`,
    financingRequest: "Onbekend.",
    financialAnalysis: "Onbekend.",
    repaymentCapacity: "Onbekend.",
    riskFactors: ["Geen rapport beschikbaar."],
    strengths: [],
    recommendation: "Handmatige beoordeling vereist.",
  };
}

export const MoneycareKredietmemorandumAdapter = {
  module: MODULE,
  async buildFinancierReport(
    args: MoneycareFinancierReportInput,
  ): Promise<SkillResult<FinancierReport>> {
    const { ctx } = args;
    const startedAt = new Date();
    const inputSummary = `verdict=${args.verdict} margin=${args.margin.toFixed(3)} dscr=${args.dscr.toFixed(2)} requested=${args.requested}`;
    try {
      const result = await instrumentSkill(MODULE, ctx, inputSummary, async () => {
        const { margin, dscr, revenue, profit, requested, verdict } = args;
        const { dossier, companyName } = ctx;
        const data: FinancierReport = {
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
        return {
          data,
          outputSummary: `verdict=${verdict} repayment=${data.repaymentCapacity.slice(0, 60)}`,
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
        data: fallback(ctx.companyName),
        error: errorMessage,
        invocation,
      };
    }
  },

  async buildMemorandum(args: {
    ctx: SkillContext;
    financierReport: FinancierReport | null;
    verdict: string | null;
  }): Promise<SkillResult<Memorandum>> {
    const { ctx, financierReport, verdict } = args;
    const startedAt = new Date();
    const inputSummary = `verdict=${verdict ?? "n/a"} hasReport=${Boolean(financierReport)}`;
    try {
      const result = await instrumentSkill(MODULE, ctx, inputSummary, async (cfg) => {
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
              (financierReport?.strengths ?? [])
                .map((s) => `• ${s}`)
                .join("\n") || "—",
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
            body: financierReport?.recommendation ?? `Voorlopig oordeel: ${v}.`,
          },
        ];
        return {
          data: {
            sections,
            attachments: documents.map((d) => `${d.documentType}: ${d.filename}`),
            partnerNotes: null,
            usedMockMode: cfg.usedMockMode,
          } as Memorandum,
          outputSummary: `sections=${sections.length} attachments=${documents.length}`,
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
        data: {
          sections: [
            {
              title: "Memorandum kon niet worden samengesteld",
              body: "Er ging iets mis tijdens het bouwen van het memorandum.",
            },
          ],
          attachments: [],
          partnerNotes: null,
          usedMockMode: true,
        },
        error: errorMessage,
        invocation,
      };
    }
  },
};
