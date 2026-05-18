import { Router, type IRouter } from "express";
import { eq, desc, inArray } from "drizzle-orm";
import {
  db,
  partnerSubmissionsTable,
  partnerFinanciersTable,
  dossiersTable,
  prospectProfilesTable,
  conditionsTable,
  aiAnalysisRunsTable,
} from "@workspace/db";
import { and, ne } from "drizzle-orm";
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

  // Resolve partners and validate every requested ID exists and is active.
  // (Partner validation runs outside the dossier transaction — partners are
  // independent of the dossier and read-only here.)
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

  // Atomic critical section: lock the dossier row, re-check status, insert
  // submissions, and flip dossier status — all in one transaction. This
  // prevents two concurrent requests from both passing the status guard
  // and creating duplicate PartnerSubmission rows.
  type EmailJob = {
    partnerEmail: string;
    partnerName: string;
    companyName: string;
    requestedAmount: number;
    financingPurpose: string | null;
    aiVerdict: string | null;
    outOfRange: boolean;
    min: number | null;
    max: number | null;
  };
  type TxResult =
    | {
        ok: true;
        inserts: ReturnType<typeof serializeSubmission>[];
        ticketWarnings: string[];
        previousStatus: string;
        emailJobs: EmailJob[];
        memorandumRunId: string;
      }
    | { ok: false; httpStatus: number; payload: { error: string; message?: string } };

  const txResult = await db.transaction<TxResult>(async (tx) => {
    const [row] = await tx
      .select({
        dossier: dossiersTable,
        companyName: prospectProfilesTable.companyName,
      })
      .from(dossiersTable)
      .innerJoin(prospectProfilesTable, eq(prospectProfilesTable.id, dossiersTable.prospectId))
      .where(eq(dossiersTable.id, params.data.dossierId))
      .for("update")
      .limit(1);
    if (!row) {
      return { ok: false, httpStatus: 404, payload: { error: "Dossier niet gevonden" } };
    }

    // Block partner submission until a credit memorandum has been
    // generated — partners must always receive the structured Dutch
    // memorandum context, not a bare amount/purpose line. The memo
    // also drives the package summary below.
    const memoRuns = await tx
      .select()
      .from(aiAnalysisRunsTable)
      .where(eq(aiAnalysisRunsTable.dossierId, params.data.dossierId))
      .orderBy(desc(aiAnalysisRunsTable.startedAt));
    const memoRun = memoRuns.find(
      (r) => r.runType === "memorandum" && r.memorandum,
    );
    if (!memoRun) {
      return {
        ok: false,
        httpStatus: 409,
        payload: {
          error: "Geen kredietmemorandum",
          message:
            "Genereer eerst een kredietmemorandum voordat je het dossier bij partners indient.",
        },
      };
    }
    const memo = memoRun.memorandum as {
      sections?: Array<{ title: string; body: string }>;
      evidenceGaps?: string[];
      verdict?: string | null;
    };
    const execSection = (memo.sections ?? []).find((s) =>
      s.title.toLowerCase().includes("samenvatting"),
    );
    const memoVerdict = memo.verdict ?? row.dossier.aiVerdict ?? null;
    const memoEvidenceGaps = Array.isArray(memo.evidenceGaps)
      ? memo.evidenceGaps
      : [];
    // Defensive gate: never let a dossier with outstanding blocking
    // conditions reach partners — even if it somehow ended up in an
    // approved status. This mirrors checkRunAnalysisGate's rule.
    const outstandingBlocking = await tx
      .select()
      .from(conditionsTable)
      .where(
        and(
          eq(conditionsTable.dossierId, params.data.dossierId),
          eq(conditionsTable.type, "blocking"),
          ne(conditionsTable.status, "resolved"),
        ),
      );
    if (outstandingBlocking.length > 0) {
      return {
        ok: false,
        httpStatus: 409,
        payload: {
          error: "Open blokkerende voorwaarden",
          message: `Er staan nog ${outstandingBlocking.length} blokkerende voorwaarde(n) open — los deze eerst op voordat je het dossier aanbiedt.`,
        },
      };
    }
    if (!SUBMITTABLE_STATUSES.has(row.dossier.status)) {
      return {
        ok: false,
        httpStatus: 409,
        payload: {
          error: "Indienen niet mogelijk",
          message:
            row.dossier.status === "submitted_to_partners" ||
            row.dossier.status === "partner_response_received"
              ? "Dit dossier is al aangeboden aan partners."
              : `Dit dossier (status \"${row.dossier.status}\") is nog niet goedgekeurd voor partneraanbod door de kredietacceptant.`,
        },
      };
    }

    const requestedAmount = Number(row.dossier.requestedAmount ?? 0);
    // Build a richer package summary that references the memorandum
    // (executive section + verdict + open evidence gaps) on top of the
    // bare amount/purpose line — partners receive context, not just
    // numbers.
    const openConds = await tx
      .select()
      .from(conditionsTable)
      .where(
        and(
          eq(conditionsTable.dossierId, params.data.dossierId),
          ne(conditionsTable.status, "resolved"),
        ),
      );
    const summaryParts = [
      `Memorandum: ${row.companyName} — €${requestedAmount.toLocaleString("nl-NL")} (${row.dossier.financingPurpose ?? "doel onbekend"})`,
      memoVerdict ? `Verdict: ${memoVerdict}` : null,
      execSection
        ? `Samenvatting: ${execSection.body.replace(/\s+/g, " ").trim().slice(0, 240)}`
        : null,
      openConds.length > 0
        ? `${openConds.length} openstaande voorwaarde(n)`
        : "Geen openstaande voorwaarden",
      memoEvidenceGaps.length > 0
        ? `Evidence gaps: ${memoEvidenceGaps.length}`
        : null,
    ].filter((line): line is string => Boolean(line));
    const packageSummaryBase = summaryParts.join(" • ");

    const inserts: ReturnType<typeof serializeSubmission>[] = [];
    const ticketWarnings: string[] = [];
    const emailJobs: EmailJob[] = [];
    for (const partner of partners) {
      const min = partner.minimumTicketSize !== null ? Number(partner.minimumTicketSize) : null;
      const max = partner.maximumTicketSize !== null ? Number(partner.maximumTicketSize) : null;
      const outOfRange =
        requestedAmount > 0 &&
        ((min !== null && requestedAmount < min) ||
          (max !== null && requestedAmount > max));
      if (outOfRange) {
        ticketWarnings.push(
          `${partner.name} (€${(min ?? 0).toLocaleString("nl-NL")}–€${(max ?? 0).toLocaleString("nl-NL")})`,
        );
      }
      const packageSummary =
        packageSummaryBase + (outOfRange ? " — LET OP: bedrag valt buiten ticket-range partner" : "");
      const [s] = await tx
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
      inserts.push(serializeSubmission(s, partner.name));
      emailJobs.push({
        partnerEmail: partner.contactEmail,
        partnerName: partner.name,
        companyName: row.companyName,
        requestedAmount,
        financingPurpose: row.dossier.financingPurpose,
        aiVerdict: row.dossier.aiVerdict,
        outOfRange,
        min,
        max,
      });
    }
    await tx
      .update(dossiersTable)
      .set({ status: "submitted_to_partners", updatedAt: new Date() })
      .where(eq(dossiersTable.id, params.data.dossierId));
    return {
      ok: true,
      inserts,
      ticketWarnings,
      previousStatus: row.dossier.status,
      emailJobs,
      memorandumRunId: memoRun.id,
    };
  });

  if (!txResult.ok) {
    res.status(txResult.httpStatus).json(txResult.payload);
    return;
  }

  // Best-effort side effects after the transaction commits. Email failures
  // must never break the persisted submission, so they're isolated here.
  for (const job of txResult.emailJobs) {
    try {
      await sendEmail({
        to: job.partnerEmail,
        subject: `Nieuwe financieringsaanvraag: ${job.companyName}`,
        body:
          (body.data.notes ? `${body.data.notes}\n\n` : "") +
          `Bedrijf: ${job.companyName}\n` +
          `Aangevraagd: €${job.requestedAmount.toLocaleString("nl-NL")}\n` +
          `Doel: ${job.financingPurpose ?? "n.v.t."}\n` +
          `AI-verdict: ${job.aiVerdict ?? "n.v.t."}\n` +
          (job.outOfRange
            ? `LET OP: bedrag valt buiten uw ticket-range (€${job.min ?? 0}–€${job.max ?? 0}).\n`
            : ""),
      });
    } catch (err) {
      void err;
    }
  }

  await logActivity({
    dossierId: params.data.dossierId,
    actor: req.user!,
    action: "submitted_to_partners",
    description: `Dossier verzonden naar ${partners.length} partner(s) (mock).`,
    metadata: {
      previousStatus: txResult.previousStatus,
      nextStatus: "submitted_to_partners",
      partnerIds: partners.map((p) => p.id),
      partnerNames: partners.map((p) => p.name),
      ticketRangeWarnings: txResult.ticketWarnings,
      memorandumRunId: txResult.memorandumRunId,
      mockSend: true,
    },
  });
  res.json(txResult.inserts);
});

export default router;
