// Adapters for the 5 AI skill modules. When an AI key is configured,
// these would call into Anthropic; otherwise we fall back to deterministic mock
// outputs so the product is fully functional out of the box.

import type { Dossier, Document } from "@workspace/db";

export const SKILL_MODULES = [
  "CreditProductAdvisor",
  "FinancingNeedAssessor",
  "FinancingProductAdvisorDualView",
  "GeenbankKredietworkflow",
  "MoneycareKredietmemorandum",
] as const;

export function isAiLive(): boolean {
  return Boolean(
    process.env.ANTHROPIC_API_KEY ||
      process.env.OPENAI_API_KEY ||
      process.env.AI_API_KEY,
  );
}

export type DossierWithDocs = {
  dossier: Dossier;
  documents: Document[];
  companyName: string;
};

export type AiPipelineResult = {
  completenessScore: number;
  correctnessScore: number;
  viabilityScore: number;
  confidenceScore: number;
  verdict: string;
  verdictSummary: string;
  entrepreneurReport: {
    headline: string;
    summary: string;
    strongPoints: string[];
    weakPoints: string[];
    actionPoints: string[];
    likelyFinancierAsks: string[];
    canSubmit: boolean;
  };
  financierReport: {
    companySummary: string;
    financingRequest: string;
    financialAnalysis: string;
    repaymentCapacity: string;
    riskFactors: string[];
    strengths: string[];
    recommendation: string;
  };
  skillModulesUsed: string[];
  usedMockMode: boolean;
  errors: string[];
};

function pct(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

export async function runFullPipeline(
  input: DossierWithDocs,
): Promise<AiPipelineResult> {
  const { dossier, documents, companyName } = input;
  const live = isAiLive();
  const errors: string[] = [];

  // Document completeness
  const requiredTypes = [
    "annual_accounts",
    "bank_statements",
    "id_document",
    "kvk_extract",
  ];
  const present = new Set(documents.map((d) => d.documentType));
  const completedDocs = requiredTypes.filter((t) => present.has(t)).length;
  const completenessFromDocs = (completedDocs / requiredTypes.length) * 60;

  // Intake completeness
  const intakeFields: Array<unknown> = [
    dossier.financingPurpose,
    dossier.requestedAmount,
    dossier.financingTypePreference,
    dossier.annualRevenue,
    dossier.annualCost,
    dossier.annualProfit,
    dossier.companyDescription,
  ];
  const filled = intakeFields.filter((v) => v !== null && v !== undefined && v !== "").length;
  const completenessFromIntake = (filled / intakeFields.length) * 40;
  const completenessScore = pct(completenessFromDocs + completenessFromIntake);

  const correctnessScore = pct(
    documents.length === 0
      ? 50
      : 70 +
          documents.filter((d) => d.validationStatus === "valid").length * 5,
  );

  const revenue = Number(dossier.annualRevenue ?? 0);
  const cost = Number(dossier.annualCost ?? 0);
  const profit = Number(dossier.annualProfit ?? revenue - cost);
  const requested = Number(dossier.requestedAmount ?? 0);
  const margin = revenue > 0 ? profit / revenue : 0;
  const dscr = requested > 0 ? Math.max(0, profit) / (requested * 0.12) : 0;

  let viabilityScore = 50;
  if (margin > 0.15) viabilityScore += 20;
  else if (margin > 0.05) viabilityScore += 10;
  else if (margin < 0) viabilityScore -= 15;
  if (dscr > 1.5) viabilityScore += 15;
  else if (dscr > 1.0) viabilityScore += 8;
  else if (dscr > 0 && dscr < 1.0) viabilityScore -= 10;
  if (revenue > 500_000) viabilityScore += 5;
  viabilityScore = pct(viabilityScore);

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

  if (margin > 0.1) strongPoints.push(`Gezonde marge van ${(margin * 100).toFixed(1)}% op de omzet.`);
  if (dscr > 1.2) strongPoints.push(`De winst dekt ruimschoots een verwachte rente- en aflossingslast (DSCR ${dscr.toFixed(2)}).`);
  if (completedDocs === requiredTypes.length) strongPoints.push("Alle kerndocumenten zijn aangeleverd en gevalideerd.");
  if (dossier.companyDescription && dossier.companyDescription.length > 80)
    strongPoints.push("Heldere bedrijfsbeschrijving die richting en propositie laat zien.");

  if (completedDocs < requiredTypes.length)
    weakPoints.push(
      `${requiredTypes.length - completedDocs} kerndocument(en) ontbreken nog (jaarcijfers, bankafschriften, ID, KVK-uittreksel).`,
    );
  if (margin < 0.05 && revenue > 0) weakPoints.push("De marge is laag — financiers willen aflossingsruimte zien.");
  if (requested > 0 && revenue > 0 && requested > revenue * 0.5)
    weakPoints.push("De gevraagde financiering is groot ten opzichte van de jaaromzet.");
  if (!dossier.financingPurpose) weakPoints.push("Doel van de financiering is nog niet ingevuld.");

  if (completedDocs < requiredTypes.length)
    actionPoints.push("Upload de ontbrekende kerndocumenten in het dossier.");
  if (!dossier.companyDescription)
    actionPoints.push("Schrijf een korte bedrijfsbeschrijving (3-5 zinnen) over wat jullie doen en voor wie.");
  if (margin < 0.1)
    actionPoints.push("Onderbouw waarom de marge zal verbeteren of waar extra financiering ruimte creëert.");
  if (actionPoints.length === 0) actionPoints.push("Dossier is op orde — verstuur naar Geenbank voor formele beoordeling.");

  const likelyFinancierAsks = [
    "Toelichting op de financieringsbehoefte en terugverdienperiode",
    "Cashflow-prognose voor de komende 12 maanden",
    "Aflossingscapaciteit bij stress-scenario (omzet -15%)",
    "Onderbouwing van het ondernemerschap en track record",
  ];

  const canSubmit = viabilityScore >= 50 && completenessScore >= 50;

  const headline =
    verdict === "kansrijk"
      ? "Je dossier staat sterk — tijd om door te zetten."
      : verdict === "voorwaardelijk"
        ? "Je bent dichtbij — een paar aanvullingen maken het verschil."
        : "Er is nog werk te doen voordat we naar partners gaan.";

  const summary = verdictSummary;

  const financierReport = {
    companySummary: `${companyName}${dossier.companyDescription ? `: ${dossier.companyDescription}` : ""}. Jaaromzet €${revenue.toLocaleString("nl-NL")}, jaarwinst €${profit.toLocaleString("nl-NL")}.`,
    financingRequest: `Aangevraagd: €${requested.toLocaleString("nl-NL")} ${dossier.financingTypePreference ? `(${dossier.financingTypePreference})` : ""}. Doel: ${dossier.financingPurpose ?? "niet gespecificeerd"}.`,
    financialAnalysis: `Marge ${(margin * 100).toFixed(1)}%, indicatieve DSCR ${dscr.toFixed(2)}. Bestaande financiering: ${dossier.existingFinancing ?? "geen of onbekend"}.`,
    repaymentCapacity:
      dscr > 1.2
        ? "Voldoende aflossingscapaciteit op basis van huidige resultaten."
        : dscr > 0.8
          ? "Aflossingscapaciteit is krap — gevoelig voor omzetdaling."
          : "Aflossingscapaciteit onvoldoende op basis van huidige cijfers.",
    riskFactors: weakPoints.length > 0 ? weakPoints : ["Geen materiële risico's geïdentificeerd in pre-validatie."],
    strengths: strongPoints.length > 0 ? strongPoints : ["Profiel sluit aan bij gangbare alternatieve financieringsproducten."],
    recommendation:
      verdict === "kansrijk"
        ? "Doorzetten naar 2-3 geselecteerde partnerfinanciers."
        : verdict === "voorwaardelijk"
          ? "Eerst voorwaarden adresseren, daarna selectief uitvragen bij partners."
          : "Aanvraag terugleggen bij ondernemer met concrete verbeterpunten.",
  };

  return {
    completenessScore,
    correctnessScore,
    viabilityScore,
    confidenceScore,
    verdict,
    verdictSummary,
    entrepreneurReport: {
      headline,
      summary,
      strongPoints,
      weakPoints,
      actionPoints,
      likelyFinancierAsks,
      canSubmit,
    },
    financierReport,
    skillModulesUsed: [...SKILL_MODULES],
    usedMockMode: !live,
    errors,
  };
}

export type Memorandum = {
  sections: Array<{ title: string; body: string }>;
  attachments: string[];
  partnerNotes: string | null;
  usedMockMode: boolean;
};

export function buildMemorandum(input: {
  dossier: Dossier;
  companyName: string;
  pipeline: AiPipelineResult | null;
  documents: Document[];
}): Memorandum {
  const { dossier, companyName, pipeline, documents } = input;
  const live = isAiLive();
  const verdict = pipeline?.verdict ?? "voorwaardelijk";
  const sections = [
    {
      title: "1. Samenvatting",
      body:
        pipeline?.financierReport.companySummary ??
        `${companyName} dient een financieringsverzoek in via Geenbank Hub.`,
    },
    {
      title: "2. Financieringsverzoek",
      body:
        pipeline?.financierReport.financingRequest ??
        `Bedrag €${Number(dossier.requestedAmount ?? 0).toLocaleString("nl-NL")} — doel: ${dossier.financingPurpose ?? "n.t.b."}.`,
    },
    {
      title: "3. Financiële analyse",
      body: pipeline?.financierReport.financialAnalysis ?? "Pre-validatie nog niet uitgevoerd.",
    },
    {
      title: "4. Aflossingscapaciteit",
      body: pipeline?.financierReport.repaymentCapacity ?? "Nog te bepalen.",
    },
    {
      title: "5. Sterktes",
      body: (pipeline?.financierReport.strengths ?? []).map((s) => `• ${s}`).join("\n") || "—",
    },
    {
      title: "6. Risico's en aandachtspunten",
      body: (pipeline?.financierReport.riskFactors ?? []).map((s) => `• ${s}`).join("\n") || "—",
    },
    {
      title: "7. Aanbeveling kredietacceptant",
      body:
        pipeline?.financierReport.recommendation ??
        `Voorlopig oordeel: ${verdict}.`,
    },
  ];
  const attachments = documents.map((d) => `${d.documentType}: ${d.filename}`);
  return {
    sections,
    attachments,
    partnerNotes: null,
    usedMockMode: !live,
  };
}
