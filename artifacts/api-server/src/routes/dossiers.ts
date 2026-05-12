import { Router, type IRouter } from "express";
import { and, eq, desc, count } from "drizzle-orm";
import {
  db,
  dossiersTable,
  prospectProfilesTable,
  documentsTable,
  conditionsTable,
  usersTable,
} from "@workspace/db";
import { inArray } from "drizzle-orm";
import { checkRunAnalysisGate } from "../lib/skill-orchestration";
import {
  OFFICER_VISIBLE_STATUSES,
  isOfficerVisibleStatus,
  officerCanAccessDossier,
} from "../lib/dossier-access";
import {
  UpdateMyIntakeBody,
  ListDossiersQueryParams,
  GetDossierParams,
  MakeDossierDecisionParams,
  MakeDossierDecisionBody,
} from "@workspace/api-zod";
import { requireAuth } from "../lib/auth";
import { logActivity } from "../lib/activity";
import {
  serializeDossier,
  serializeDossierListItem,
} from "../lib/serializers";
import { notifyPipedriveDealUpdate, sendEmail } from "../lib/integrations";

const router: IRouter = Router();

async function loadProspectAndDossier(userId: string) {
  const [prospect] = await db
    .select()
    .from(prospectProfilesTable)
    .where(eq(prospectProfilesTable.userId, userId))
    .limit(1);
  if (!prospect) return { prospect: null, dossier: null };
  const [dossier] = await db
    .select()
    .from(dossiersTable)
    .where(eq(dossiersTable.prospectId, prospect.id))
    .limit(1);
  return { prospect, dossier: dossier ?? null };
}

async function counts(dossierId: string) {
  const [docCount] = await db
    .select({ c: count() })
    .from(documentsTable)
    .where(eq(documentsTable.dossierId, dossierId));
  const [blocking] = await db
    .select({ c: count() })
    .from(conditionsTable)
    .where(
      and(
        eq(conditionsTable.dossierId, dossierId),
        eq(conditionsTable.type, "blocking"),
        eq(conditionsTable.status, "open"),
      ),
    );
  return { documentsCount: Number(docCount?.c ?? 0), blockingConditionsCount: Number(blocking?.c ?? 0) };
}

router.get("/dossiers/me", requireAuth(["prospect"]), async (req, res): Promise<void> => {
  const { prospect, dossier } = await loadProspectAndDossier(req.user!.id);
  if (!prospect || !dossier) {
    res.status(404).json({ error: "Geen dossier gevonden" });
    return;
  }
  const c = await counts(dossier.id);
  res.json(serializeDossier(dossier, prospect, c.documentsCount, c.blockingConditionsCount));
});

router.put("/dossiers/me/intake", requireAuth(["prospect"]), async (req, res): Promise<void> => {
  const parsed = UpdateMyIntakeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { prospect, dossier } = await loadProspectAndDossier(req.user!.id);
  if (!prospect || !dossier) {
    res.status(404).json({ error: "Geen dossier gevonden" });
    return;
  }
  const data = parsed.data;
  if (data.companyName || data.contactName || data.kvkNumber || data.phone) {
    await db
      .update(prospectProfilesTable)
      .set({
        companyName: data.companyName ?? prospect.companyName,
        contactName: data.contactName ?? prospect.contactName,
        kvkNumber: data.kvkNumber ?? prospect.kvkNumber,
        phone: data.phone ?? prospect.phone,
      })
      .where(eq(prospectProfilesTable.id, prospect.id));
  }
  const update: Record<string, unknown> = { updatedAt: new Date() };
  if (data.financingPurpose !== undefined) update.financingPurpose = data.financingPurpose;
  if (data.requestedAmount !== undefined) update.requestedAmount = data.requestedAmount?.toString() ?? null;
  if (data.financingTypePreference !== undefined) update.financingTypePreference = data.financingTypePreference;
  if (data.existingFinancing !== undefined) update.existingFinancing = data.existingFinancing;
  if (data.annualRevenue !== undefined) update.annualRevenue = data.annualRevenue?.toString() ?? null;
  if (data.annualCost !== undefined) update.annualCost = data.annualCost?.toString() ?? null;
  if (data.annualProfit !== undefined) update.annualProfit = data.annualProfit?.toString() ?? null;
  if (data.companyDescription !== undefined) update.companyDescription = data.companyDescription;
  if (
    dossier.status === "intake_in_progress" ||
    dossier.status === "lead_created" ||
    dossier.status === "prospect_logged_in"
  ) {
    update.status = "intake_in_progress";
  }
  const [updated] = await db
    .update(dossiersTable)
    .set(update)
    .where(eq(dossiersTable.id, dossier.id))
    .returning();
  await logActivity({
    dossierId: dossier.id,
    actor: req.user!,
    action: "intake_updated",
    description: `${prospect.companyName} heeft de intake bijgewerkt.`,
  });
  const [prospectFresh] = await db
    .select()
    .from(prospectProfilesTable)
    .where(eq(prospectProfilesTable.id, prospect.id))
    .limit(1);
  const c = await counts(dossier.id);
  res.json(serializeDossier(updated, prospectFresh!, c.documentsCount, c.blockingConditionsCount));
});

router.post("/dossiers/me/submit", requireAuth(["prospect"]), async (req, res): Promise<void> => {
  const { prospect, dossier } = await loadProspectAndDossier(req.user!.id);
  if (!prospect || !dossier) {
    res.status(404).json({ error: "Geen dossier gevonden" });
    return;
  }
  // Single source of truth — same gate as full AI analysis.
  const gate = await checkRunAnalysisGate(dossier.id);
  if (!gate.ok) {
    res.status(409).json({
      error: "Dossier kan nog niet ingediend worden",
      message:
        "Je dossier voldoet nog niet aan de eisen voor indienen bij Geenbank.",
      reasons: gate.reasons,
      actions: gate.actions,
      missingDocuments: gate.missingDocuments,
      invalidDocuments: gate.invalidDocuments,
      pendingDocuments: gate.pendingDocuments,
      blockingConditions: gate.blockingConditions,
      scores: gate.scores,
      thresholds: gate.thresholds,
    });
    return;
  }
  const [updated] = await db
    .update(dossiersTable)
    .set({
      status: "submitted_to_geenbank",
      submittedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(dossiersTable.id, dossier.id))
    .returning();
  await logActivity({
    dossierId: dossier.id,
    actor: req.user!,
    action: "submitted_to_geenbank",
    description: `${prospect.companyName} heeft het dossier ingediend bij Geenbank.`,
  });
  await notifyPipedriveDealUpdate({
    dealId: prospect.pipedriveDealId,
    stage: "submitted_to_geenbank",
  });
  const c = await counts(dossier.id);
  res.json(serializeDossier(updated, prospect, c.documentsCount, c.blockingConditionsCount));
});

router.get("/dossiers", requireAuth(["loan_officer", "admin"]), async (req, res): Promise<void> => {
  const params = ListDossiersQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  // Loan officers only see dossiers that have passed the prospect-side gates
  // and entered the Geenbank workflow.
  const rows = await db
    .select()
    .from(dossiersTable)
    .innerJoin(prospectProfilesTable, eq(prospectProfilesTable.id, dossiersTable.prospectId))
    .where(inArray(dossiersTable.status, [...OFFICER_VISIBLE_STATUSES]))
    .orderBy(desc(dossiersTable.updatedAt));
  const items = rows.map((r) => serializeDossierListItem(r.dossiers, r.prospect_profiles));
  const bucket = params.data.bucket;
  const filtered =
    !bucket || bucket === "all" ? items : items.filter((i) => i.bucket === bucket);
  res.json(filtered);
});

router.get("/dossiers/:dossierId", requireAuth(["loan_officer", "admin"]), async (req, res): Promise<void> => {
  const params = GetDossierParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db
    .select()
    .from(dossiersTable)
    .innerJoin(prospectProfilesTable, eq(prospectProfilesTable.id, dossiersTable.prospectId))
    .where(eq(dossiersTable.id, params.data.dossierId))
    .limit(1);
  if (!row || !isOfficerVisibleStatus(row.dossiers.status)) {
    res.status(404).json({ error: "Dossier niet gevonden" });
    return;
  }
  const c = await counts(row.dossiers.id);
  res.json(serializeDossier(row.dossiers, row.prospect_profiles, c.documentsCount, c.blockingConditionsCount));
});

/**
 * Statuses from which a loan officer/admin may still take a decision.
 * Once a dossier has been approved, rejected, sent on to partners, or
 * closed, the decision endpoint is no longer a valid action.
 */
const DECIDABLE_STATUSES = new Set<string>([
  "submitted_to_geenbank",
  "loan_officer_review",
  "additional_info_requested",
]);

router.post("/dossiers/:dossierId/decision", requireAuth(["loan_officer", "admin"]), async (req, res): Promise<void> => {
  const params = MakeDossierDecisionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!(await officerCanAccessDossier(params.data.dossierId))) {
    res.status(404).json({ error: "Dossier niet gevonden" });
    return;
  }
  const body = MakeDossierDecisionBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
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
  const dossier = row.dossiers;
  const prospect = row.prospect_profiles;

  // Status transition guard — block decisions on dossiers that have
  // already left the review stage (approved/rejected/in-partner-flow/closed).
  if (!DECIDABLE_STATUSES.has(dossier.status)) {
    res.status(409).json({
      error: "Besluit niet meer mogelijk",
      message: `Het dossier staat in status \"${dossier.status}\" en kan niet opnieuw worden beoordeeld.`,
    });
    return;
  }

  // request_additional_info must include at least one concrete item;
  // otherwise the prospect has no actionable next step.
  if (
    body.data.decision === "request_additional_info" &&
    !(body.data.requestedItems && body.data.requestedItems.length > 0)
  ) {
    res.status(400).json({
      error: "Geef minimaal één gevraagd item op",
      message:
        "Bij een verzoek om aanvullende informatie moet minimaal één concreet item worden opgegeven.",
    });
    return;
  }

  let nextStatus = dossier.status;
  let actionLabel = "";
  if (body.data.decision === "approve") {
    nextStatus = "approved_for_partner_submission";
    actionLabel = "goedgekeurd voor partneraanbod";
  } else if (body.data.decision === "reject") {
    nextStatus = "rejected_by_loan_officer";
    actionLabel = "afgewezen";
  } else {
    nextStatus = "additional_info_requested";
    actionLabel = "aanvullende informatie gevraagd";
    for (const item of body.data.requestedItems!) {
      await db.insert(conditionsTable).values({
        dossierId: dossier.id,
        type: "blocking",
        title: item,
        description: item,
        requiredAction: item,
        status: "open",
      });
    }
  }
  const [updated] = await db
    .update(dossiersTable)
    .set({
      status: nextStatus,
      loanOfficerDecision: body.data.decision,
      loanOfficerNotes: body.data.notes ?? null,
      updatedAt: new Date(),
    })
    .where(eq(dossiersTable.id, dossier.id))
    .returning();
  await logActivity({
    dossierId: dossier.id,
    actor: req.user!,
    action: `decision_${body.data.decision}`,
    description: `Kredietacceptant heeft het dossier ${actionLabel}.`,
    metadata: {
      previousStatus: dossier.status,
      nextStatus,
      requestedItems:
        body.data.decision === "request_additional_info"
          ? body.data.requestedItems
          : undefined,
    },
  });
  // Notify the prospect — not the loan officer — about the decision.
  // Email delivery (live or mock) must never break the decision flow.
  const [prospectUser] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, prospect.userId))
    .limit(1);
  if (prospectUser) {
    try {
      await sendEmail({
        to: prospectUser.email,
        subject: `Je financieringsdossier is ${actionLabel}`,
        body:
          body.data.notes ??
          `De kredietacceptant heeft je dossier ${actionLabel}. Log in op Geenbank Hub voor de details.`,
      });
    } catch (err) {
      // Swallow — the decision must persist even if SendGrid is unhappy.
      // The mock path already logs; the live path will log via pino-http.
      void err;
    }
  }
  const c = await counts(dossier.id);
  res.json(serializeDossier(updated, prospect, c.documentsCount, c.blockingConditionsCount));
});

export default router;
