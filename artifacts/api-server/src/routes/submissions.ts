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
  // Gate: only dossiers explicitly approved by a loan officer may be sent
  // to partner financiers.
  const approvedStatuses = [
    "approved_for_partner_submission",
    "memorandum_generated",
    "submitted_to_partners",
  ];
  if (!approvedStatuses.includes(row.dossiers.status)) {
    res.status(409).json({
      error:
        "Dit dossier is nog niet goedgekeurd voor partneraanbod door de kredietacceptant.",
    });
    return;
  }
  const partners = await db
    .select()
    .from(partnerFinanciersTable)
    .where(inArray(partnerFinanciersTable.id, body.data.partnerIds));
  const inserts = [];
  for (const partner of partners) {
    const [s] = await db
      .insert(partnerSubmissionsTable)
      .values({
        dossierId: params.data.dossierId,
        partnerId: partner.id,
        status: "submitted",
        submittedAt: new Date(),
        packageSummary: `Dossier ${row.prospect_profiles.companyName} — €${Number(row.dossiers.requestedAmount ?? 0).toLocaleString("nl-NL")}`,
        usedMockMode: true,
      })
      .returning();
    await sendEmail({
      to: partner.contactEmail,
      subject: `Nieuwe financieringsaanvraag: ${row.prospect_profiles.companyName}`,
      body: body.data.notes ?? "Bekijk bijgevoegd memorandum.",
    });
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
    description: `Dossier verzonden naar ${partners.length} partner(s).`,
  });
  res.json(inserts);
});

export default router;
