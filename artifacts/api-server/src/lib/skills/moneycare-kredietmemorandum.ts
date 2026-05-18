import { instrumentSkill, failedInvocation } from "./runtime";
import {
  type EntrepreneurReport,
  type FinancierReport,
  type Memorandum,
  type MemorandumPartnerPackage,
  type SkillContext,
  type SkillResult,
} from "./types";
import type { DualViewAdvice } from "@workspace/api-zod";

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
const NOT_AVAILABLE = "Niet beschikbaar";

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

function euro(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return NOT_AVAILABLE;
  const num = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(num)) return NOT_AVAILABLE;
  return `€${Number(num).toLocaleString("nl-NL")}`;
}

function bulletList(items: string[]): string {
  return items.length > 0 ? items.map((s) => `• ${s}`).join("\n") : NOT_AVAILABLE;
}

function nonEmpty(value: string | null | undefined): string {
  const s = (value ?? "").trim();
  return s.length > 0 ? s : NOT_AVAILABLE;
}

export type MemorandumProspectInput = {
  companyName: string | null;
  contactName: string | null;
  kvkNumber: string | null;
  phone: string | null;
};

export type MemorandumConditionInput = {
  id: string;
  type: "blocking" | "non_blocking";
  title: string;
  description: string;
  requiredAction: string | null;
  status: string;
  reviewerNotes: string | null;
};

export type MemorandumPartnerInput = {
  id: string;
  name: string;
  productFocus: string;
  minimumTicketSize: string | number | null;
  maximumTicketSize: string | number | null;
  contactEmail: string;
  notes: string | null;
};

export type BuildMemorandumInput = {
  ctx: SkillContext;
  prospect: MemorandumProspectInput | null;
  entrepreneurReport: EntrepreneurReport | null;
  financierReport: FinancierReport | null;
  verdict: string | null;
  verdictSummary: string | null;
  scores: {
    completeness: number | null;
    correctness: number | null;
    viability: number | null;
    confidence: number | null;
  };
  dualView: DualViewAdvice | null;
  conditions: {
    open: MemorandumConditionInput[];
    resolved: MemorandumConditionInput[];
  };
  selectedPartners: MemorandumPartnerInput[];
  loanOfficerNotes: string | null;
  loanOfficerDecision: string | null;
};

function describeIndicativeStructure(dv: DualViewAdvice | null): string {
  const s = dv?.partnerView?.indicative_structure ?? null;
  if (!s) return NOT_AVAILABLE;
  const parts: string[] = [];
  if (s.amount !== null && s.amount !== undefined)
    parts.push(`Bedrag: €${Number(s.amount).toLocaleString("nl-NL")}`);
  if (s.tenor_months !== null && s.tenor_months !== undefined)
    parts.push(`Looptijd: ${s.tenor_months} maanden`);
  if (s.repayment_logic) parts.push(`Aflossing: ${s.repayment_logic}`);
  if (s.collateral_logic) parts.push(`Zekerheden: ${s.collateral_logic}`);
  return parts.length > 0 ? parts.join("\n") : NOT_AVAILABLE;
}

function describeShortlist(dv: DualViewAdvice | null): string {
  const list = dv?.partnerView?.shortlisted_products ?? [];
  if (list.length === 0) return NOT_AVAILABLE;
  return list
    .map((p) => {
      const scores = [
        p.product_fit_score !== null ? `fit ${p.product_fit_score}` : null,
        p.evidence_strength_score !== null
          ? `evidence ${p.evidence_strength_score}`
          : null,
        p.structurability_score !== null
          ? `structuur ${p.structurability_score}`
          : null,
      ].filter(Boolean);
      const tail = scores.length > 0 ? ` (${scores.join(", ")})` : "";
      return `• ${p.product_name}${tail}`;
    })
    .join("\n");
}

function describeVerdict(verdict: string | null): string {
  if (!verdict) return NOT_AVAILABLE;
  if (verdict === "kansrijk")
    return "Doorzetten naar 2-3 geselecteerde partner-financiers.";
  if (verdict === "voorwaardelijk")
    return "Eerst openstaande voorwaarden adresseren, daarna selectief uitvragen bij partners.";
  if (verdict === "afwijzen")
    return "Aanvraag terugleggen bij ondernemer met concrete verbeterpunten — nog niet aanbieden.";
  return `Voorlopig oordeel: ${verdict}.`;
}

function partnerFitsTicket(
  partner: MemorandumPartnerInput,
  requested: number,
): boolean {
  const min =
    partner.minimumTicketSize === null || partner.minimumTicketSize === undefined
      ? null
      : Number(partner.minimumTicketSize);
  const max =
    partner.maximumTicketSize === null || partner.maximumTicketSize === undefined
      ? null
      : Number(partner.maximumTicketSize);
  if (min !== null && Number.isFinite(min) && requested < min) return false;
  if (max !== null && Number.isFinite(max) && requested > max) return false;
  return true;
}

function describeTicketRange(partner: MemorandumPartnerInput): string | null {
  const min =
    partner.minimumTicketSize === null || partner.minimumTicketSize === undefined
      ? null
      : Number(partner.minimumTicketSize);
  const max =
    partner.maximumTicketSize === null || partner.maximumTicketSize === undefined
      ? null
      : Number(partner.maximumTicketSize);
  if (min === null && max === null) return null;
  return `€${Number(min ?? 0).toLocaleString("nl-NL")}–€${Number(max ?? 0).toLocaleString("nl-NL")}`;
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

  /**
   * Build the full Dutch 14-section credit memorandum + partner package
   * preview from stored dossier data. Missing source data surfaces as
   * "Niet beschikbaar" together with a concrete `evidenceGaps` entry —
   * the adapter never invents facts.
   */
  async buildMemorandum(
    args: BuildMemorandumInput,
  ): Promise<SkillResult<Memorandum>> {
    const {
      ctx,
      prospect,
      entrepreneurReport,
      financierReport,
      verdict,
      verdictSummary,
      scores,
      dualView,
      conditions,
      selectedPartners,
      loanOfficerNotes,
      loanOfficerDecision,
    } = args;
    const startedAt = new Date();
    const inputSummary = `verdict=${verdict ?? "n/a"} hasFin=${Boolean(financierReport)} hasDV=${Boolean(dualView)} partners=${selectedPartners.length} open=${conditions.open.length}`;
    try {
      const result = await instrumentSkill(MODULE, ctx, inputSummary, async (cfg) => {
        const { dossier, companyName, documents } = ctx;
        const evidenceGaps: string[] = [];

        // -- Core financials (from dossier) -----------------------------
        const revenueNum = dossier.annualRevenue !== null ? Number(dossier.annualRevenue) : null;
        const costNum = dossier.annualCost !== null ? Number(dossier.annualCost) : null;
        const profitNum = dossier.annualProfit !== null ? Number(dossier.annualProfit) : null;
        const requestedNum = dossier.requestedAmount !== null ? Number(dossier.requestedAmount) : null;
        const marginPct =
          revenueNum && revenueNum > 0 && profitNum !== null
            ? `${((profitNum / revenueNum) * 100).toFixed(1)}%`
            : NOT_AVAILABLE;

        if (revenueNum === null) evidenceGaps.push("Jaaromzet ontbreekt in intake.");
        if (costNum === null) evidenceGaps.push("Jaarkosten ontbreken in intake.");
        if (profitNum === null) evidenceGaps.push("Jaarwinst ontbreekt in intake.");
        if (requestedNum === null) evidenceGaps.push("Gevraagd financieringsbedrag ontbreekt.");

        if (!entrepreneurReport)
          evidenceGaps.push("Ondernemersrapport (Geenbank Kredietworkflow) nog niet beschikbaar.");
        if (!financierReport)
          evidenceGaps.push("Financierrapport (Moneycare) nog niet beschikbaar.");
        if (!dualView)
          evidenceGaps.push("Productadvies (Dual-View) nog niet beschikbaar.");
        if (!dualView?.partnerView?.recommended_product)
          evidenceGaps.push("Geen aanbevolen product in partner-advies.");
        if (!dualView?.partnerView?.indicative_structure)
          evidenceGaps.push("Indicatieve structuur (bedrag/looptijd/aflossing) ontbreekt.");
        if (!verdict) evidenceGaps.push("AI-verdict ontbreekt — voer eerst de full analysis uit.");

        if (!prospect?.companyName?.trim())
          evidenceGaps.push("Bedrijfsnaam prospect ontbreekt.");
        if (!prospect?.kvkNumber?.trim())
          evidenceGaps.push("KVK-nummer ontbreekt.");
        if (!prospect?.contactName?.trim())
          evidenceGaps.push("Contactpersoon ontbreekt.");

        const requiredDocTypes = ["annual_accounts", "bank_statements", "kvk_extract", "id_document"];
        const presentTypes = new Set(documents.map((d) => d.documentType));
        const missingDocs = requiredDocTypes.filter((t) => !presentTypes.has(t));
        if (missingDocs.length > 0)
          evidenceGaps.push(`Verplichte documenten ontbreken: ${missingDocs.join(", ")}.`);

        const partnerView = dualView?.partnerView;
        const recommendedProduct = partnerView?.recommended_product ?? null;
        const alternativeProduct = partnerView?.alternative_product ?? null;
        const productMix = partnerView?.recommended_product_mix ?? [];

        // -- 14 sections ----------------------------------------------
        const execSummary = [
          `${nonEmpty(prospect?.companyName ?? companyName)} vraagt een financiering van ${euro(requestedNum)} aan${dossier.financingPurpose ? ` voor: ${dossier.financingPurpose}` : ""}.`,
          verdictSummary
            ? `AI-oordeel: ${verdictSummary}`
            : verdict
              ? `AI-oordeel: ${verdict}.`
              : `AI-oordeel: ${NOT_AVAILABLE}.`,
          recommendedProduct
            ? `Geadviseerd product: ${recommendedProduct}.`
            : `Geadviseerd product: ${NOT_AVAILABLE}.`,
        ].join("\n");

        const sections: Array<{ title: string; body: string }> = [
          {
            title: "1. Samenvatting",
            body: execSummary,
          },
          {
            title: "2. Onderneming en activiteit",
            body: [
              `Bedrijfsnaam: ${nonEmpty(prospect?.companyName ?? companyName)}`,
              `KVK-nummer: ${nonEmpty(prospect?.kvkNumber)}`,
              `Contactpersoon: ${nonEmpty(prospect?.contactName)}`,
              `Telefoon: ${nonEmpty(prospect?.phone)}`,
              `Omschrijving: ${nonEmpty(dossier.companyDescription)}`,
            ].join("\n"),
          },
          {
            title: "3. Financieringsvraag",
            body: [
              `Bedrag: ${euro(requestedNum)}`,
              `Type voorkeur: ${nonEmpty(dossier.financingTypePreference)}`,
              `Bestaande financiering: ${nonEmpty(dossier.existingFinancing)}`,
            ].join("\n"),
          },
          {
            title: "4. Doel van de financiering",
            body: nonEmpty(dossier.financingPurpose),
          },
          {
            title: "5. Historische cijfers en kerncijfers",
            body: [
              `Jaaromzet: ${euro(revenueNum)}`,
              `Jaarkosten: ${euro(costNum)}`,
              `Jaarwinst: ${euro(profitNum)}`,
              `Marge: ${marginPct}`,
              `Compleetheid intake: ${scores.completeness ?? NOT_AVAILABLE}`,
              `Levensvatbaarheid: ${scores.viability ?? NOT_AVAILABLE}`,
            ].join("\n"),
          },
          {
            title: "6. Aflossingscapaciteit",
            body: nonEmpty(financierReport?.repaymentCapacity),
          },
          {
            title: "7. Risicoanalyse",
            body: bulletList(financierReport?.riskFactors ?? []),
          },
          {
            title: "8. Mitigerende factoren en sterktes",
            body: bulletList(financierReport?.strengths ?? entrepreneurReport?.strongPoints ?? []),
          },
          {
            title: "9. Zekerheden en structuur",
            body: describeIndicativeStructure(dualView),
          },
          {
            title: "10. Productadvies",
            body: [
              `Aanbevolen: ${nonEmpty(recommendedProduct)}`,
              `Alternatief: ${nonEmpty(alternativeProduct)}`,
              `Mix: ${productMix.length > 0 ? productMix.join(", ") : NOT_AVAILABLE}`,
              "",
              "Shortlist:",
              describeShortlist(dualView),
              "",
              "Onderbouwing:",
              bulletList(partnerView?.rationale ?? []),
            ].join("\n"),
          },
          {
            title: "11. Openstaande voorwaarden",
            body:
              conditions.open.length === 0
                ? "Geen openstaande voorwaarden."
                : conditions.open
                    .map(
                      (c) =>
                        `• [${c.type === "blocking" ? "BLOKKEREND" : "advies"}] ${c.title} — ${c.description}${c.requiredAction ? ` (actie: ${c.requiredAction})` : ""}`,
                    )
                    .join("\n"),
          },
          {
            title: "12. Afgehandelde voorwaarden",
            body:
              conditions.resolved.length === 0
                ? "Nog geen voorwaarden afgehandeld."
                : conditions.resolved
                    .map((c) => `• ${c.title} — afgerond`)
                    .join("\n"),
          },
          {
            title: "13. Bijlagen en documenten",
            body:
              documents.length === 0
                ? NOT_AVAILABLE
                : documents
                    .map((d) => `• ${d.documentType}: ${d.filename} (${d.validationStatus})`)
                    .join("\n"),
          },
          {
            title: "14. Aanbeveling kredietacceptant",
            body: [
              describeVerdict(verdict),
              financierReport?.recommendation ? `Onderbouwing: ${financierReport.recommendation}` : null,
              loanOfficerDecision ? `Beslissing loan officer: ${loanOfficerDecision}` : null,
              loanOfficerNotes ? `Notities loan officer: ${loanOfficerNotes}` : null,
            ]
              .filter((line): line is string => Boolean(line))
              .join("\n"),
          },
        ];

        // -- Partner packages -----------------------------------------
        const requestedForFit = requestedNum ?? 0;
        const partnerPackages: MemorandumPartnerPackage[] = selectedPartners.map(
          (p) => {
            const fits = requestedNum !== null && partnerFitsTicket(p, requestedForFit);
            const ticketRange = describeTicketRange(p);
            const summaryParts = [
              `${nonEmpty(prospect?.companyName ?? companyName)} — ${euro(requestedNum)}`,
              dossier.financingPurpose ? `Doel: ${dossier.financingPurpose}` : null,
              recommendedProduct ? `Advies: ${recommendedProduct}` : null,
              verdict ? `Verdict: ${verdict}` : null,
              conditions.open.length > 0
                ? `${conditions.open.length} openstaande voorwaarde(n)`
                : "Geen openstaande voorwaarden",
              !fits && requestedNum !== null && ticketRange
                ? `LET OP: buiten ticket-range (${ticketRange})`
                : null,
            ].filter((line): line is string => Boolean(line));
            return {
              partnerId: p.id,
              partnerName: p.name,
              productFocus: p.productFocus,
              ticketRange,
              fitsTicketRange: fits,
              partnerNotes: p.notes,
              packageSummary: summaryParts.join(" • "),
            };
          },
        );

        const partnerNotes =
          selectedPartners.length === 0
            ? null
            : `Aanbieden bij: ${selectedPartners.map((p) => p.name).join(", ")}.`;

        return {
          data: {
            sections,
            attachments: documents.map((d) => `${d.documentType}: ${d.filename}`),
            partnerNotes,
            partnerPackages,
            evidenceGaps,
            verdict: verdict ?? null,
            usedMockMode: cfg.usedMockMode,
          } as Memorandum,
          outputSummary: `sections=${sections.length} gaps=${evidenceGaps.length} partners=${partnerPackages.length}`,
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
          partnerPackages: [],
          evidenceGaps: ["Memorandum kon niet worden gegenereerd."],
          verdict: null,
          usedMockMode: true,
        },
        error: errorMessage,
        invocation,
      };
    }
  },
};
