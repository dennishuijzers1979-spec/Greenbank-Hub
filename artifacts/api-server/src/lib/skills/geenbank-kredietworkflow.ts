import {
  GATE_THRESHOLDS,
  isAiLive,
  logSkillError,
  logSkillStart,
  logSkillSuccess,
  pct,
  type EntrepreneurReport,
  type SkillContext,
  type SkillResult,
} from "./types";

export type GeenbankKredietworkflowInput = {
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
};

export type GeenbankKredietworkflowOutput = {
  confidenceScore: number;
  verdict: string;
  verdictSummary: string;
  entrepreneurReport: EntrepreneurReport;
  strongPoints: string[];
  weakPoints: string[];
};

const MODULE = "GeenbankKredietworkflow" as const;

function fallback(companyName: string): GeenbankKredietworkflowOutput {
  return {
    confidenceScore: 0,
    verdict: "uitdagend",
    verdictSummary: `Pre-validatie kon niet voltooid worden voor ${companyName}.`,
    entrepreneurReport: {
      headline: "Pre-validatie niet voltooid",
      summary: "Er ging iets mis bij het samenstellen van het rapport.",
      strongPoints: [],
      weakPoints: ["Pre-validatie kon niet worden afgerond."],
      actionPoints: [
        "Probeer de pre-validatie opnieuw of neem contact op met support.",
      ],
      likelyFinancierAsks: [],
      canSubmit: false,
    },
    strongPoints: [],
    weakPoints: ["Pre-validatie kon niet worden afgerond."],
  };
}

export const GeenbankKredietworkflowAdapter = {
  module: MODULE,
  async run(
    args: GeenbankKredietworkflowInput,
  ): Promise<SkillResult<GeenbankKredietworkflowOutput>> {
    const { ctx } = args;
    logSkillStart(MODULE, ctx.dossier.id);
    try {
      const {
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
        actionPoints.push(
          "Upload de ontbrekende kerndocumenten in het dossier.",
        );
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

      const usedMockMode = !isAiLive();
      logSkillSuccess(MODULE, ctx.dossier.id, usedMockMode);
      return {
        module: MODULE,
        ok: true,
        usedMockMode,
        data: {
          confidenceScore,
          verdict,
          verdictSummary,
          entrepreneurReport,
          strongPoints,
          weakPoints,
        },
      };
    } catch (err) {
      logSkillError(MODULE, ctx.dossier.id, err);
      return {
        module: MODULE,
        ok: false,
        usedMockMode: true,
        data: fallback(ctx.companyName),
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};
