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

  // Make sure ports user can log in immediately
  void officer;
  void admin;
  await db
    .update(usersTable)
    .set({ firstLoginCompleted: true })
    .where(eq(usersTable.id, prospect1.id));
}
