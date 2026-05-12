import { Router, type IRouter } from "express";
import { eq, desc, inArray } from "drizzle-orm";
import {
  db,
  partnerSubmissionsTable,
  partnerFinanciersTable,
  dossiersTable,
  prospectProfilesTable,
} from "@workspace/db";
import {
  ListDossierSubmissionsParams,
  SubmitDossierToPartnersParams,
  SubmitDossierToPartnersBody,
} from "@workspace/api-zod";
import { requireAuth } from "../lib/auth";
import { logActivity } from "../lib/activity";
import { serializeSubmission } from "../lib/serializers";
import { sendEmail } from "../lib/integrations";
import { officerCanAccessDossier } from "../lib/dossier-access";

const router: IRouter = Router();

router.get("/dossiers/:dossierId/submissions", requireAuth(["loan_officer", "admin"]), async (req, res): Promise<void> => {
  const params = ListDossierSubmissionsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!(await officerCanAccessDossier(params.data.dossierId))) {
    res.status(404).json({ error: "Dossier niet gevonden" });
    return;
  }
  const rows = await db
    .select()
    .from(partnerSubmissionsTable)
    .innerJoin(partnerFinanciersTable, eq(partnerFinanciersTable.id, partnerSubmissionsTable.partnerId))
    .where(eq(partnerSubmissionsTable.dossierId, params.data.dossierId))
    .orderBy(desc(partnerSubmissionsTable.createdAt));
  res.json(rows.map((r) => serializeSubmission(r.partner_submissions, r.partner_financiers.name)));
});

/**
 * Statuses from which a loan officer/admin may still submit a dossier
 * package to partner financiers. After the package has been sent
 * (`submitted_to_partners` / `partner_response_received` / `closed`),
 * re-submission is intentionally blocked — re-sends would create
 * duplicate records and confuse partners.
 */
const SUBMITTABLE_STATUSES = new Set<string>([
  "approved_for_partner_submission",
  "memorandum_generated",
]);

router.post("/dossiers/:dossierId/submissions", requireAuth(["loan_officer", "admin"]), async (req, res): Promise<void> => {
  const params = SubmitDossierToPartnersParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = SubmitDossierToPartnersBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  if (body.data.partnerIds.length === 0) {
    res.status(400).json({ error: "Selecteer minimaal één partner" });
    return;
  }
  // Reject duplicates in the request — would otherwise create two
  // submission rows for the same (dossier, partner) pair.
  const uniquePartnerIds = Array.from(new Set(body.data.partnerIds));
  if (uniquePartnerIds.length !== body.data.partnerIds.length) {
    res.status(400).json({ error: "Dubbele partner-ID's in de aanvraag" });
    return;
  }
  if (!(await officerCanAccessDossier(params.data.dossierId))) {
    res.status(404).json({ error: "Dossier niet gevonden" });
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
  // Status guard — only dossiers explicitly approved by a loan officer
  // (and not yet sent to partners) may be submitted.
  if (!SUBMITTABLE_STATUSES.has(row.dossiers.status)) {
    res.status(409).json({
      error: "Indienen niet mogelijk",
      message:
        row.dossiers.status === "submitted_to_partners" ||
        row.dossiers.status === "partner_response_received"
          ? "Dit dossier is al aangeboden aan partners."
          : `Dit dossier (status \"${row.dossiers.status}\") is nog niet goedgekeurd voor partneraanbod door de kredietacceptant.`,
    });
    return;
  }

  // Resolve partners and validate every requested ID exists and is active.
  const partners = await db
    .select()
    .from(partnerFinanciersTable)
    .where(inArray(partnerFinanciersTable.id, uniquePartnerIds));
  const foundIds = new Set(partners.map((p) => p.id));
  const missingIds = uniquePartnerIds.filter((pid) => !foundIds.has(pid));
  if (missingIds.length > 0) {
    res.status(400).json({
      error: "Onbekende partner(s)",
      message: `De volgende partner-ID's bestaan niet: ${missingIds.join(", ")}.`,
    });
    return;
  }
  const inactivePartners = partners.filter((p) => p.activeStatus !== "active");
  if (inactivePartners.length > 0) {
    res.status(400).json({
      error: "Inactieve partner(s) geselecteerd",
      message: `De volgende partners zijn inactief en kunnen niet worden aangeschreven: ${inactivePartners
        .map((p) => p.name)
        .join(", ")}.`,
    });
    return;
  }

  const requestedAmount = Number(row.dossiers.requestedAmount ?? 0);
  const packageSummaryBase = `Dossier ${row.prospect_profiles.companyName} — €${requestedAmount.toLocaleString(
    "nl-NL",
  )} (${row.dossiers.financingPurpose ?? "doel onbekend"})`;

  // Insert one PartnerSubmission per selected partner. Mock-send only —
  // SendGrid/Pipedrive failures must NEVER block the persisted record.
  const inserts = [];
  const mockTicketWarnings: string[] = [];
  for (const partner of partners) {
    const min = partner.minimumTicketSize !== null ? Number(partner.minimumTicketSize) : null;
    const max = partner.maximumTicketSize !== null ? Number(partner.maximumTicketSize) : null;
    const outOfRange =
      requestedAmount > 0 &&
      ((min !== null && requestedAmount < min) ||
        (max !== null && requestedAmount > max));
    if (outOfRange) {
      mockTicketWarnings.push(
        `${partner.name} (€${(min ?? 0).toLocaleString("nl-NL")}–€${(max ?? 0).toLocaleString("nl-NL")})`,
      );
    }
    const packageSummary =
      packageSummaryBase + (outOfRange ? " — LET OP: bedrag valt buiten ticket-range partner" : "");
    const [s] = await db
      .insert(partnerSubmissionsTable)
      .values({
        dossierId: params.data.dossierId,
        partnerId: partner.id,
        status: "submitted_mock",
        submittedAt: new Date(),
        packageSummary,
        usedMockMode: true,
      })
      .returning();
    try {
      await sendEmail({
        to: partner.contactEmail,
        subject: `Nieuwe financieringsaanvraag: ${row.prospect_profiles.companyName}`,
        body:
          (body.data.notes ? `${body.data.notes}\n\n` : "") +
          `Bedrijf: ${row.prospect_profiles.companyName}\n` +
          `Aangevraagd: €${requestedAmount.toLocaleString("nl-NL")}\n` +
          `Doel: ${row.dossiers.financingPurpose ?? "n.v.t."}\n` +
          `AI-verdict: ${row.dossiers.aiVerdict ?? "n.v.t."}\n` +
          (outOfRange
            ? `LET OP: bedrag valt buiten uw ticket-range (€${min ?? 0}–€${max ?? 0}).\n`
            : ""),
      });
    } catch (err) {
      // Mock or live email failure must not break submission persistence.
      void err;
    }
    inserts.push(serializeSubmission(s, partner.name));
  }
  await db
    .update(dossiersTable)
    .set({ status: "submitted_to_partners", updatedAt: new Date() })
    .where(eq(dossiersTable.id, params.data.dossierId));
  await logActivity({
    dossierId: params.data.dossierId,
    actor: req.user!,
    action: "submitted_to_partners",
    description: `Dossier verzonden naar ${partners.length} partner(s) (mock).`,
    metadata: {
      previousStatus: row.dossiers.status,
      nextStatus: "submitted_to_partners",
      partnerIds: partners.map((p) => p.id),
      partnerNames: partners.map((p) => p.name),
      ticketRangeWarnings: mockTicketWarnings,
      mockSend: true,
    },
  });
  res.json(inserts);
});

export default router;
