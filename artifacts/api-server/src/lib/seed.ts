import { eq } from "drizzle-orm";
import {
  db,
  usersTable,
  prospectProfilesTable,
  dossiersTable,
  documentsTable,
  partnerFinanciersTable,
  activityLogsTable,
  conditionsTable,
  aiAnalysisRunsTable,
} from "@workspace/db";
import { hashPassword } from "./auth";
import { logger } from "./logger";

const TEMP_PASSWORD = "Welkom2025!";

export async function seedIfEmpty(): Promise<void> {
  const existing = await db.select().from(usersTable).limit(1);
  if (existing.length > 0) {
    logger.info("Seed skipped — users already exist");
    return;
  }
  logger.info("Seeding demo data");
  const hash = await hashPassword(TEMP_PASSWORD);

  // Users
  const [admin] = await db
    .insert(usersTable)
    .values({
      email: "admin@geenbank.nl",
      passwordHash: hash,
      role: "admin",
      displayName: "Eva van Dijk",
      firstLoginCompleted: true,
    })
    .returning();
  const [officer] = await db
    .insert(usersTable)
    .values({
      email: "maarten@geenbank.nl",
      passwordHash: hash,
      role: "loan_officer",
      displayName: "Maarten de Vries",
      firstLoginCompleted: true,
    })
    .returning();
  const [prospect1] = await db
    .insert(usersTable)
    .values({
      email: "anne@brouwerij-noord.nl",
      passwordHash: hash,
      role: "prospect",
      displayName: "Anne Jansen",
      firstLoginCompleted: true,
    })
    .returning();
  const [prospect2] = await db
    .insert(usersTable)
    .values({
      email: "joris@nordhaven-cycles.nl",
      passwordHash: hash,
      role: "prospect",
      displayName: "Joris Bakker",
      firstLoginCompleted: false,
    })
    .returning();
  const [prospect3] = await db
    .insert(usersTable)
    .values({
      email: "fatima@studio-meridian.nl",
      passwordHash: hash,
      role: "prospect",
      displayName: "Fatima El Amrani",
      firstLoginCompleted: true,
    })
    .returning();
  // Happy-path demo prospect — backs the ready demo dossier (Aurora
  // Bakkerij B.V.) that exercises the full loan-officer flow
  // (review → memorandum → partner selection → mock-send) without any
  // missing scores, documents or conditions.
  const [prospect4] = await db
    .insert(usersTable)
    .values({
      email: "demo@aurora-bakkerij.nl",
      passwordHash: hash,
      role: "prospect",
      displayName: "Sanne de Boer",
      firstLoginCompleted: true,
    })
    .returning();

  // Prospect profiles
  const [pp1] = await db
    .insert(prospectProfilesTable)
    .values({
      userId: prospect1.id,
      companyName: "Brouwerij Noord B.V.",
      contactName: "Anne Jansen",
      kvkNumber: "78213456",
      phone: "+31 6 1234 5678",
      source: "Geenbank afwijzing",
      pipedriveDealId: "deal-1001",
    })
    .returning();
  const [pp2] = await db
    .insert(prospectProfilesTable)
    .values({
      userId: prospect2.id,
      companyName: "Nordhaven Cycles",
      contactName: "Joris Bakker",
      kvkNumber: "65498712",
      phone: "+31 6 9876 5432",
      source: "Geenbank afwijzing",
      pipedriveDealId: "deal-1002",
    })
    .returning();
  const [pp3] = await db
    .insert(prospectProfilesTable)
    .values({
      userId: prospect3.id,
      companyName: "Studio Meridian",
      contactName: "Fatima El Amrani",
      kvkNumber: "33445566",
      phone: "+31 6 5555 4444",
      source: "Geenbank afwijzing",
      pipedriveDealId: "deal-1003",
    })
    .returning();
  const [pp4] = await db
    .insert(prospectProfilesTable)
    .values({
      userId: prospect4.id,
      companyName: "Aurora Bakkerij B.V. (demo ready)",
      contactName: "Sanne de Boer",
      kvkNumber: "88991122",
      phone: "+31 6 2233 4455",
      source: "Geenbank afwijzing",
      pipedriveDealId: "deal-1004",
    })
    .returning();

  // Dossiers
  const [d1] = await db
    .insert(dossiersTable)
    .values({
      prospectId: pp1.id,
      status: "submitted_to_geenbank",
      currentStage: "Ingediend bij Geenbank",
      financingPurpose: "Uitbreiding brouwcapaciteit en aanschaf nieuwe vergistingstanks",
      requestedAmount: "180000",
      financingTypePreference: "Zakelijke lening",
      existingFinancing: "Lopende rekening-courant €25.000",
      annualRevenue: "640000",
      annualCost: "510000",
      annualProfit: "130000",
      companyDescription:
        "Ambachtelijke brouwerij in Groningen. Levert speciaalbier aan horeca in Noord-Nederland en draait sinds 2018 met groeiende marges.",
      completenessScore: 85,
      correctnessScore: 80,
      viabilityScore: 78,
      confidenceScore: 82,
      aiVerdict: "kansrijk",
      submittedAt: new Date(Date.now() - 2 * 86400000),
    })
    .returning();
  const [d2] = await db
    .insert(dossiersTable)
    .values({
      prospectId: pp2.id,
      status: "intake_in_progress",
      currentStage: "Intake bezig",
      financingPurpose: "Voorraadfinanciering nieuw seizoen 2026",
      requestedAmount: "75000",
      financingTypePreference: "Voorraadkrediet",
      annualRevenue: "320000",
      annualCost: "270000",
      annualProfit: "50000",
      companyDescription: "Webshop voor stadsfietsen en accessoires.",
    })
    .returning();
  const [d3] = await db
    .insert(dossiersTable)
    .values({
      prospectId: pp3.id,
      status: "loan_officer_review",
      currentStage: "In behandeling kredietacceptant",
      financingPurpose: "Investering in eigen studioruimte en apparatuur",
      requestedAmount: "120000",
      financingTypePreference: "Investeringslening",
      existingFinancing: "Geen",
      annualRevenue: "210000",
      annualCost: "175000",
      annualProfit: "35000",
      companyDescription:
        "Designstudio voor merkidentiteit en verpakking. Werkt voor opkomende food- en lifestyle-merken.",
      completenessScore: 70,
      correctnessScore: 75,
      viabilityScore: 62,
      confidenceScore: 70,
      aiVerdict: "voorwaardelijk",
      submittedAt: new Date(Date.now() - 6 * 86400000),
    })
    .returning();

  // Ready-to-send happy-path demo dossier. Pre-populated with passing
  // scores, a valid AI verdict, all required validated documents, no
  // open conditions and a pre-generated credit memorandum so the loan
  // officer can immediately mock-send to a partner.
  const [d4] = await db
    .insert(dossiersTable)
    .values({
      prospectId: pp4.id,
      status: "approved_for_partner_submission",
      currentStage: "Goedgekeurd voor partneraanbod",
      financingPurpose:
        "Uitbreiding bakkerij met tweede oven en aanschaf koeltoonbank voor nieuwe vestiging Zwolle",
      requestedAmount: "140000",
      financingTypePreference: "Investeringslening",
      existingFinancing: "Rekening-courant €15.000 (volledig benut)",
      annualRevenue: "820000",
      annualCost: "640000",
      annualProfit: "180000",
      companyDescription:
        "Ambachtelijke biologische bakkerij met twee bestaande vestigingen in Zwolle en Kampen. Sinds 2017 stabiele groei, sterke lokale merkbekendheid en B2B-leveringen aan hotels en lunchrooms.",
      completenessScore: 88,
      correctnessScore: 86,
      viabilityScore: 82,
      confidenceScore: 84,
      aiVerdict: "kansrijk",
      submittedAt: new Date(Date.now() - 5 * 86400000),
    })
    .returning();

  // Documents (one per active dossier)
  const docTypes = ["annual_accounts", "bank_statements", "kvk_extract", "id_document"];
  for (const t of docTypes) {
    await db.insert(documentsTable).values({
      dossierId: d1.id,
      uploadedBy: prospect1.id,
      documentType: t,
      filename: `${t}.pdf`,
      mimeType: "application/pdf",
      sizeBytes: 240000,
      storagePath: `mock://dossiers/${d1.id}/${t}.pdf`,
      uploadStatus: "uploaded",
      validationStatus: "valid",
      extractedDataStatus: "extracted",
      usedInAnalysis: true,
    });
  }
  for (const t of ["annual_accounts", "kvk_extract"]) {
    await db.insert(documentsTable).values({
      dossierId: d3.id,
      uploadedBy: prospect3.id,
      documentType: t,
      filename: `${t}.pdf`,
      mimeType: "application/pdf",
      sizeBytes: 180000,
      storagePath: `mock://dossiers/${d3.id}/${t}.pdf`,
      uploadStatus: "uploaded",
      validationStatus: "valid",
      extractedDataStatus: "extracted",
      usedInAnalysis: true,
    });
  }
  // Full document set for the happy-path demo dossier.
  for (const t of docTypes) {
    await db.insert(documentsTable).values({
      dossierId: d4.id,
      uploadedBy: prospect4.id,
      documentType: t,
      filename: `${t}.pdf`,
      mimeType: "application/pdf",
      sizeBytes: 260000,
      storagePath: `mock://dossiers/${d4.id}/${t}.pdf`,
      uploadStatus: "uploaded",
      validationStatus: "valid",
      extractedDataStatus: "extracted",
      usedInAnalysis: true,
    });
  }

  // Pre-seed a completed full_analysis run for the happy-path demo so
  // computePackageReadiness() finds a passing analysis, verdict and
  // scores. The entrepreneur/financier reports + a Dual-View skill
  // invocation give the memorandum adapter enough source material to
  // produce sections with real content (not "Niet beschikbaar"),
  // which is the last readiness requirement.
  const auroraAnalysisStarted = new Date(Date.now() - 4 * 86400000);
  const auroraAnalysisCompleted = new Date(
    auroraAnalysisStarted.getTime() + 60_000,
  );
  await db.insert(aiAnalysisRunsTable).values({
    dossierId: d4.id,
    runType: "full_analysis",
    status: "completed",
    startedAt: auroraAnalysisStarted,
    completedAt: auroraAnalysisCompleted,
    skillModulesUsed: [
      "GeenbankKredietworkflow",
      "MoneycareFinancier",
      "FinancingProductAdvisorDualView",
    ],
    skillInvocations: [
      {
        skillName: "FinancingProductAdvisorDualView",
        provider: "mock",
        usedMockMode: true,
        model: "mock-dualview-v1",
        durationMs: 1200,
        startedAt: auroraAnalysisStarted.toISOString(),
        completedAt: auroraAnalysisCompleted.toISOString(),
        extras: {
          partnerView: {
            recommended_product: "Investeringslening 7 jaar lineair",
            alternative_product: "Investeringslening 5 jaar annuïtair",
            recommended_product_mix: ["Investeringslening", "Werkkapitaal"],
            recommendation_status: "strong",
            rationale: [
              "Stabiele EBITDA-marge boven 20% in laatste drie boekjaren.",
              "Sterke lokale merkbekendheid en bestaande B2B-contracten.",
              "Tweede oven verhoogt productiecapaciteit met 40%.",
            ],
            key_risks: [
              "Personeelskosten stijgen door extra vestiging.",
              "Concurrentie van industriële bakkerijen in regio.",
            ],
            evidence_gaps: [],
            indicative_structure: {
              amount: 140000,
              tenor_months: 84,
              repayment_logic: "Lineaire aflossing in 84 maanden",
              collateral_logic: "Pandrecht op bedrijfsmiddelen + UBO-garantie",
              conditions: [
                "Maandelijkse rapportage cashflow eerste 12 maanden",
                "Verzekering nieuwe oven verplicht",
              ],
            },
            shortlisted_products: [
              {
                name: "Investeringslening 7 jaar lineair",
                fit_score: 92,
                rationale: "Past bij investeringshorizon en cashflow-patroon.",
              },
              {
                name: "Investeringslening 5 jaar annuïtair",
                fit_score: 78,
                rationale: "Snellere afbouw maar hogere maandlasten.",
              },
            ],
          },
        },
      },
    ],
    completenessScore: 88,
    correctnessScore: 86,
    viabilityScore: 82,
    confidenceScore: 84,
    verdict: "kansrijk",
    verdictSummary:
      "Bakkerij met stabiele groei en sterke marges. Investering versterkt capaciteit en marktpositie.",
    entrepreneurReport: {
      summary:
        "Aurora Bakkerij is een gezonde, groeiende ambachtelijke bakkerij met goede vooruitzichten.",
      strongPoints: [
        "Drie jaar op rij winstgevend met stijgende marge",
        "Sterke lokale merkbekendheid",
        "Bestaande B2B-contracten met hotels en lunchrooms",
      ],
      weakPoints: [
        "Beperkte buffer voor onverwachte tegenvallers",
        "Personeelskosten stijgen bij uitbreiding",
      ],
      canSubmit: true,
      nextSteps: [
        "Documenten bevestigd",
        "Klaar voor kredietacceptant",
      ],
    },
    financierReport: {
      recommendation: "Akkoord met standaard zekerheden en cashflow-rapportage.",
      repaymentCapacity:
        "DSCR > 1.6 bij conservatieve aannames; 84-maands lineair past binnen verwachte vrije kasstroom (€2.100/mnd).",
      riskFactors: [
        "Loonkostenstijging tweede vestiging",
        "Energieprijs-volatiliteit",
      ],
      strengths: [
        "Aantoonbaar stabiele klantenbasis",
        "Eigen vermogen 35% van balanstotaal",
        "Lage debiteurentermijn (gemiddeld 14 dagen)",
      ],
      conditions: [
        "Maandelijkse cashflow-rapportage eerste 12 maanden",
        "Verzekering nieuwe oven verplicht",
      ],
    },
    usedMockMode: true,
    errors: [],
  });

  // Pre-seed the credit memorandum so the happy-path is one-click:
  // the officer opens the dossier and sees a ready package they can
  // immediately mock-send. Sections mirror the structure produced by
  // the MoneycareKredietmemorandumAdapter so readiness check finds
  // ≥5 meaningfully populated sections.
  const auroraMemoCompleted = new Date(
    auroraAnalysisCompleted.getTime() + 90_000,
  );
  await db.insert(aiAnalysisRunsTable).values({
    dossierId: d4.id,
    runType: "memorandum",
    status: "completed",
    startedAt: new Date(auroraAnalysisCompleted.getTime() + 30_000),
    completedAt: auroraMemoCompleted,
    skillModulesUsed: ["MoneycareKredietmemorandum"],
    skillInvocations: [],
    verdict: "kansrijk",
    verdictSummary:
      "Bakkerij met stabiele groei en sterke marges. Investering versterkt capaciteit en marktpositie.",
    usedMockMode: true,
    memorandum: {
      usedMockMode: true,
      verdict: "kansrijk",
      attachments: [
        "annual_accounts.pdf",
        "bank_statements.pdf",
        "kvk_extract.pdf",
        "id_document.pdf",
      ],
      partnerNotes: null,
      evidenceGaps: [],
      partnerPackages: [],
      sections: [
        {
          title: "1. Samenvatting",
          body:
            "Aurora Bakkerij B.V. (demo ready) vraagt €140.000 aan voor uitbreiding met een tweede oven en koeltoonbank.\nAI-oordeel: kansrijk — stabiele groei, sterke marges, lage debiteurentermijn.\nGeadviseerd product: Investeringslening 7 jaar lineair.",
        },
        {
          title: "2. Onderneming en activiteit",
          body:
            "Bedrijfsnaam: Aurora Bakkerij B.V.\nKVK-nummer: 88991122\nContactpersoon: Sanne de Boer\nTelefoon: +31 6 2233 4455\nOmschrijving: Ambachtelijke biologische bakkerij met twee bestaande vestigingen in Zwolle en Kampen.",
        },
        {
          title: "3. Financieringsvraag",
          body:
            "Bedrag: €140.000\nType voorkeur: Investeringslening\nBestaande financiering: Rekening-courant €15.000 (volledig benut)",
        },
        {
          title: "4. Doel van de financiering",
          body:
            "Uitbreiding bakkerij met tweede oven en aanschaf koeltoonbank voor nieuwe vestiging Zwolle.",
        },
        {
          title: "5. Historische cijfers en kerncijfers",
          body:
            "Jaaromzet: €820.000\nJaarkosten: €640.000\nJaarwinst: €180.000\nMarge: 22.0%\nCompleetheid intake: 88\nLevensvatbaarheid: 82",
        },
        {
          title: "6. Aflossingscapaciteit",
          body:
            "DSCR > 1.6 bij conservatieve aannames; 84-maands lineair past binnen verwachte vrije kasstroom (€2.100/mnd).",
        },
        {
          title: "7. Risicoanalyse",
          body:
            "• Loonkostenstijging tweede vestiging\n• Energieprijs-volatiliteit",
        },
        {
          title: "8. Mitigerende factoren en sterktes",
          body:
            "• Aantoonbaar stabiele klantenbasis\n• Eigen vermogen 35% van balanstotaal\n• Lage debiteurentermijn (gemiddeld 14 dagen)",
        },
        {
          title: "9. Zekerheden en structuur",
          body:
            "Bedrag: €140.000 | Looptijd: 84 maanden\nAflossing: Lineaire aflossing in 84 maanden\nZekerheden: Pandrecht op bedrijfsmiddelen + UBO-garantie",
        },
        {
          title: "10. Productadvies",
          body:
            "Aanbevolen: Investeringslening 7 jaar lineair\nAlternatief: Investeringslening 5 jaar annuïtair\nMix: Investeringslening, Werkkapitaal",
        },
        {
          title: "11. Openstaande voorwaarden",
          body: "Geen openstaande voorwaarden.",
        },
      ],
    },
    errors: [],
  });


  // Conditions for d3
  await db.insert(conditionsTable).values([
    {
      dossierId: d3.id,
      type: "blocking",
      title: "Bankafschriften ontbreken",
      description: "Upload bankafschriften van de afgelopen 6 maanden voor cashflow-validatie.",
      requiredAction: "Upload PDF van bankafschriften",
      status: "open",
    },
    {
      dossierId: d3.id,
      type: "non_blocking",
      title: "Onderbouwing investeringscalculatie",
      description: "Een korte uitleg van de berekening achter het gevraagde bedrag versterkt het dossier.",
      status: "open",
    },
  ]);

  // Partners
  await db.insert(partnerFinanciersTable).values([
    {
      name: "Moneycare",
      contactEmail: "credit@moneycare.nl",
      productFocus: "MKB-leningen €25k - €250k",
      minimumTicketSize: "25000",
      maximumTicketSize: "250000",
      activeStatus: "active",
      notes: "Snelle besluitvorming, vraagt om duidelijke kasstroomanalyse.",
    },
    {
      name: "NoordKapitaal",
      contactEmail: "deals@noordkapitaal.nl",
      productFocus: "Investeringsleningen Noord-Nederland",
      minimumTicketSize: "50000",
      maximumTicketSize: "500000",
      activeStatus: "active",
      notes: "Voorkeur voor regio Groningen, Friesland, Drenthe.",
    },
    {
      name: "FlowFinance",
      contactEmail: "intake@flowfinance.nl",
      productFocus: "Werkkapitaal & voorraadkrediet",
      minimumTicketSize: "10000",
      maximumTicketSize: "150000",
      activeStatus: "active",
    },
    {
      name: "Triple Bridge",
      contactEmail: "ondernemers@triplebridge.nl",
      productFocus: "Achtergestelde leningen & mezzanine",
      minimumTicketSize: "100000",
      maximumTicketSize: "1000000",
      activeStatus: "paused",
      notes: "Tijdelijk geen nieuwe dossiers in behandeling.",
    },
  ]);

  // Activity logs
  const actions: Array<{
    dossierId: string | null;
    actorId: string | null;
    actorType: string;
    actorLabel: string;
    action: string;
    description: string;
  }> = [
    {
      dossierId: d1.id,
      actorId: prospect1.id,
      actorType: "prospect",
      actorLabel: "Anne Jansen",
      action: "submitted_to_geenbank",
      description: "Brouwerij Noord heeft het dossier ingediend bij Geenbank.",
    },
    {
      dossierId: d3.id,
      actorId: officer.id,
      actorType: "loan_officer",
      actorLabel: "Maarten de Vries",
      action: "decision_request_additional_info",
      description: "Aanvullende informatie gevraagd aan Studio Meridian.",
    },
    {
      dossierId: d2.id,
      actorId: prospect2.id,
      actorType: "prospect",
      actorLabel: "Joris Bakker",
      action: "intake_started",
      description: "Nordhaven Cycles is begonnen met de intake.",
    },
    {
      dossierId: null,
      actorId: admin.id,
      actorType: "admin",
      actorLabel: "Eva van Dijk",
      action: "partner_added",
      description: "FlowFinance toegevoegd als partnerfinancier.",
    },
  ];
  for (const a of actions) {
    await db.insert(activityLogsTable).values(a);
  }

  logger.info(
    { admin: admin.email, officer: officer.email },
    "Demo seed completed",
  );
}

/**
 * Idempotently insert the Aurora Bakkerij happy-path demo dossier into
 * an existing database. Safe to call on every boot: it short-circuits
 * when the demo prospect user already exists, so it never duplicates
 * data. This exists separately from `seedIfEmpty()` because that helper
 * only runs on a fully empty database — installations that were seeded
 * before Aurora existed would otherwise never get the ready-to-send
 * demo dossier.
 */
export async function ensureAuroraDemo(): Promise<void> {
  const existing = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, "demo@aurora-bakkerij.nl"))
    .limit(1);
  if (existing.length > 0) {
    return;
  }
  logger.info("Backfilling Aurora demo dossier");
  const hash = await hashPassword(TEMP_PASSWORD);

  const [prospect4] = await db
    .insert(usersTable)
    .values({
      email: "demo@aurora-bakkerij.nl",
      passwordHash: hash,
      role: "prospect",
      displayName: "Sanne de Boer",
      firstLoginCompleted: true,
    })
    .returning();
  const [pp4] = await db
    .insert(prospectProfilesTable)
    .values({
      userId: prospect4.id,
      companyName: "Aurora Bakkerij B.V. (demo ready)",
      contactName: "Sanne de Boer",
      kvkNumber: "88991122",
      phone: "+31 6 2233 4455",
      source: "Geenbank afwijzing",
      pipedriveDealId: "deal-1004",
    })
    .returning();
  const [d4] = await db
    .insert(dossiersTable)
    .values({
      prospectId: pp4.id,
      status: "approved_for_partner_submission",
      currentStage: "Goedgekeurd voor partneraanbod",
      financingPurpose:
        "Uitbreiding bakkerij met tweede oven en aanschaf koeltoonbank voor nieuwe vestiging Zwolle",
      requestedAmount: "140000",
      financingTypePreference: "Investeringslening",
      existingFinancing: "Rekening-courant €15.000 (volledig benut)",
      annualRevenue: "820000",
      annualCost: "640000",
      annualProfit: "180000",
      companyDescription:
        "Ambachtelijke biologische bakkerij met twee bestaande vestigingen in Zwolle en Kampen. Sinds 2017 stabiele groei, sterke lokale merkbekendheid en B2B-leveringen aan hotels en lunchrooms.",
      completenessScore: 88,
      correctnessScore: 86,
      viabilityScore: 82,
      confidenceScore: 84,
      aiVerdict: "kansrijk",
      submittedAt: new Date(Date.now() - 5 * 86400000),
    })
    .returning();

  const docTypes = ["annual_accounts", "bank_statements", "kvk_extract", "id_document"];
  for (const t of docTypes) {
    await db.insert(documentsTable).values({
      dossierId: d4.id,
      uploadedBy: prospect4.id,
      documentType: t,
      filename: `${t}.pdf`,
      mimeType: "application/pdf",
      sizeBytes: 260000,
      storagePath: `mock://dossiers/${d4.id}/${t}.pdf`,
      uploadStatus: "uploaded",
      validationStatus: "valid",
      extractedDataStatus: "extracted",
      usedInAnalysis: true,
    });
  }

  const auroraAnalysisStarted = new Date(Date.now() - 4 * 86400000);
  const auroraAnalysisCompleted = new Date(
    auroraAnalysisStarted.getTime() + 60_000,
  );
  await db.insert(aiAnalysisRunsTable).values({
    dossierId: d4.id,
    runType: "full_analysis",
    status: "completed",
    startedAt: auroraAnalysisStarted,
    completedAt: auroraAnalysisCompleted,
    skillModulesUsed: [
      "GeenbankKredietworkflow",
      "MoneycareFinancier",
      "FinancingProductAdvisorDualView",
    ],
    skillInvocations: [
      {
        skillName: "FinancingProductAdvisorDualView",
        provider: "mock",
        usedMockMode: true,
        model: "mock-dualview-v1",
        durationMs: 1200,
        startedAt: auroraAnalysisStarted.toISOString(),
        completedAt: auroraAnalysisCompleted.toISOString(),
        extras: {
          partnerView: {
            recommended_product: "Investeringslening 7 jaar lineair",
            alternative_product: "Investeringslening 5 jaar annuïtair",
            recommended_product_mix: ["Investeringslening", "Werkkapitaal"],
            recommendation_status: "strong",
            rationale: [
              "Stabiele EBITDA-marge boven 20% in laatste drie boekjaren.",
              "Sterke lokale merkbekendheid en bestaande B2B-contracten.",
              "Tweede oven verhoogt productiecapaciteit met 40%.",
            ],
            key_risks: [
              "Personeelskosten stijgen door extra vestiging.",
              "Concurrentie van industriële bakkerijen in regio.",
            ],
            evidence_gaps: [],
            indicative_structure: {
              amount: 140000,
              tenor_months: 84,
              repayment_logic: "Lineaire aflossing in 84 maanden",
              collateral_logic: "Pandrecht op bedrijfsmiddelen + UBO-garantie",
              conditions: [
                "Maandelijkse rapportage cashflow eerste 12 maanden",
                "Verzekering nieuwe oven verplicht",
              ],
            },
            shortlisted_products: [
              {
                name: "Investeringslening 7 jaar lineair",
                fit_score: 92,
                rationale: "Past bij investeringshorizon en cashflow-patroon.",
              },
              {
                name: "Investeringslening 5 jaar annuïtair",
                fit_score: 78,
                rationale: "Snellere afbouw maar hogere maandlasten.",
              },
            ],
          },
        },
      },
    ],
    completenessScore: 88,
    correctnessScore: 86,
    viabilityScore: 82,
    confidenceScore: 84,
    verdict: "kansrijk",
    verdictSummary:
      "Bakkerij met stabiele groei en sterke marges. Investering versterkt capaciteit en marktpositie.",
    entrepreneurReport: {
      summary:
        "Aurora Bakkerij is een gezonde, groeiende ambachtelijke bakkerij met goede vooruitzichten.",
      strongPoints: [
        "Drie jaar op rij winstgevend met stijgende marge",
        "Sterke lokale merkbekendheid",
        "Bestaande B2B-contracten met hotels en lunchrooms",
      ],
      weakPoints: [
        "Beperkte buffer voor onverwachte tegenvallers",
        "Personeelskosten stijgen bij uitbreiding",
      ],
      canSubmit: true,
      nextSteps: ["Documenten bevestigd", "Klaar voor kredietacceptant"],
    },
    financierReport: {
      recommendation: "Akkoord met standaard zekerheden en cashflow-rapportage.",
      repaymentCapacity:
        "DSCR > 1.6 bij conservatieve aannames; 84-maands lineair past binnen verwachte vrije kasstroom (€2.100/mnd).",
      riskFactors: [
        "Loonkostenstijging tweede vestiging",
        "Energieprijs-volatiliteit",
      ],
      strengths: [
        "Aantoonbaar stabiele klantenbasis",
        "Eigen vermogen 35% van balanstotaal",
        "Lage debiteurentermijn (gemiddeld 14 dagen)",
      ],
      conditions: [
        "Maandelijkse cashflow-rapportage eerste 12 maanden",
        "Verzekering nieuwe oven verplicht",
      ],
    },
    usedMockMode: true,
    errors: [],
  });

  const auroraMemoCompleted = new Date(
    auroraAnalysisCompleted.getTime() + 90_000,
  );
  await db.insert(aiAnalysisRunsTable).values({
    dossierId: d4.id,
    runType: "memorandum",
    status: "completed",
    startedAt: new Date(auroraAnalysisCompleted.getTime() + 30_000),
    completedAt: auroraMemoCompleted,
    skillModulesUsed: ["MoneycareKredietmemorandum"],
    skillInvocations: [],
    verdict: "kansrijk",
    verdictSummary:
      "Bakkerij met stabiele groei en sterke marges. Investering versterkt capaciteit en marktpositie.",
    usedMockMode: true,
    memorandum: {
      usedMockMode: true,
      verdict: "kansrijk",
      attachments: [
        "annual_accounts.pdf",
        "bank_statements.pdf",
        "kvk_extract.pdf",
        "id_document.pdf",
      ],
      partnerNotes: null,
      evidenceGaps: [],
      partnerPackages: [],
      sections: [
        {
          title: "1. Samenvatting",
          body:
            "Aurora Bakkerij B.V. (demo ready) vraagt €140.000 aan voor uitbreiding met een tweede oven en koeltoonbank.\nAI-oordeel: kansrijk — stabiele groei, sterke marges, lage debiteurentermijn.\nGeadviseerd product: Investeringslening 7 jaar lineair.",
        },
        {
          title: "2. Onderneming en activiteit",
          body:
            "Bedrijfsnaam: Aurora Bakkerij B.V.\nKVK-nummer: 88991122\nContactpersoon: Sanne de Boer\nTelefoon: +31 6 2233 4455\nOmschrijving: Ambachtelijke biologische bakkerij met twee bestaande vestigingen in Zwolle en Kampen.",
        },
        {
          title: "3. Financieringsvraag",
          body:
            "Bedrag: €140.000\nType voorkeur: Investeringslening\nBestaande financiering: Rekening-courant €15.000 (volledig benut)",
        },
        {
          title: "4. Doel van de financiering",
          body:
            "Uitbreiding bakkerij met tweede oven en aanschaf koeltoonbank voor nieuwe vestiging Zwolle.",
        },
        {
          title: "5. Historische cijfers en kerncijfers",
          body:
            "Jaaromzet: €820.000\nJaarkosten: €640.000\nJaarwinst: €180.000\nMarge: 22.0%\nCompleetheid intake: 88\nLevensvatbaarheid: 82",
        },
        {
          title: "6. Aflossingscapaciteit",
          body:
            "DSCR > 1.6 bij conservatieve aannames; 84-maands lineair past binnen verwachte vrije kasstroom (€2.100/mnd).",
        },
        {
          title: "7. Risicoanalyse",
          body:
            "• Loonkostenstijging tweede vestiging\n• Energieprijs-volatiliteit",
        },
        {
          title: "8. Mitigerende factoren en sterktes",
          body:
            "• Aantoonbaar stabiele klantenbasis\n• Eigen vermogen 35% van balanstotaal\n• Lage debiteurentermijn (gemiddeld 14 dagen)",
        },
        {
          title: "9. Zekerheden en structuur",
          body:
            "Bedrag: €140.000 | Looptijd: 84 maanden\nAflossing: Lineaire aflossing in 84 maanden\nZekerheden: Pandrecht op bedrijfsmiddelen + UBO-garantie",
        },
        {
          title: "10. Productadvies",
          body:
            "Aanbevolen: Investeringslening 7 jaar lineair\nAlternatief: Investeringslening 5 jaar annuïtair\nMix: Investeringslening, Werkkapitaal",
        },
        {
          title: "11. Openstaande voorwaarden",
          body: "Geen openstaande voorwaarden.",
        },
      ],
    },
    errors: [],
  });

  logger.info({ dossierId: d4.id }, "Aurora demo dossier backfilled");
}
