import { Router, type IRouter } from "express";
import { eq, desc, and, ne } from "drizzle-orm";
import {
  db,
  conditionsTable,
  documentsTable,
  dossiersTable,
  prospectProfilesTable,
} from "@workspace/db";
import {
  ListConditionsParams,
  RespondToConditionParams,
  RespondToConditionBody,
  ResolveConditionParams,
  ResolveConditionBody,
} from "@workspace/api-zod";
import { requireAuth } from "../lib/auth";
import { logActivity } from "../lib/activity";
import {
  serializeCondition,
  serializeConditionForOfficer,
} from "../lib/serializers";
import { officerCanAccessDossier } from "../lib/dossier-access";

const router: IRouter = Router();

router.get("/dossiers/me/conditions", requireAuth(["prospect"]), async (req, res): Promise<void> => {
  const [prospect] = await db
    .select()
    .from(prospectProfilesTable)
    .where(eq(prospectProfilesTable.userId, req.user!.id))
    .limit(1);
  if (!prospect) {
    res.json([]);
    return;
  }
  const [dossier] = await db
    .select()
    .from(dossiersTable)
    .where(eq(dossiersTable.prospectId, prospect.id))
    .limit(1);
  if (!dossier) {
    res.json([]);
    return;
  }
  const items = await db
    .select()
    .from(conditionsTable)
    .where(eq(conditionsTable.dossierId, dossier.id))
    .orderBy(desc(conditionsTable.createdAt));

  // Resolve any linked response document filenames in one batched query
  // so the prospect UI can show "uploaded as X.pdf" without an extra
  // round-trip per condition.
  const docIds = Array.from(
    new Set(items.map((i) => i.responseDocumentId).filter((v): v is string => !!v)),
  );
  const filenameById = new Map<string, string>();
  if (docIds.length > 0) {
    const docs = await db
      .select({ id: documentsTable.id, filename: documentsTable.filename })
      .from(documentsTable)
      .where(eq(documentsTable.dossierId, dossier.id));
    for (const d of docs) filenameById.set(d.id, d.filename);
  }

  res.json(
    items.map((c) =>
      serializeCondition(c, {
        responseDocumentFilename: c.responseDocumentId
          ? (filenameById.get(c.responseDocumentId) ?? null)
          : null,
      }),
    ),
  );
});

router.get("/dossiers/:dossierId/conditions", requireAuth(["loan_officer", "admin"]), async (req, res): Promise<void> => {
  const params = ListConditionsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!(await officerCanAccessDossier(params.data.dossierId))) {
    res.status(404).json({ error: "Dossier niet gevonden" });
    return;
  }
  const items = await db
    .select()
    .from(conditionsTable)
    .where(eq(conditionsTable.dossierId, params.data.dossierId))
    .orderBy(desc(conditionsTable.createdAt));

  const docIds = Array.from(
    new Set(items.map((i) => i.responseDocumentId).filter((v): v is string => !!v)),
  );
  const filenameById = new Map<string, string>();
  if (docIds.length > 0) {
    const docs = await db
      .select({ id: documentsTable.id, filename: documentsTable.filename })
      .from(documentsTable)
      .where(eq(documentsTable.dossierId, params.data.dossierId));
    for (const d of docs) filenameById.set(d.id, d.filename);
  }

  res.json(
    items.map((c) =>
      serializeConditionForOfficer(c, {
        responseDocumentFilename: c.responseDocumentId
          ? (filenameById.get(c.responseDocumentId) ?? null)
          : null,
      }),
    ),
  );
});

/**
 * Prospect submits a response to a single requested item.
 *
 * Ownership is enforced by joining condition → dossier → prospect_profile
 * and verifying the prospect's userId matches the authenticated user.
 *
 * Either responseText or responseDocumentId (or both) must be provided.
 * If a documentId is supplied it must already belong to the same dossier
 * (uploaded via the existing /dossiers/me/documents flow).
 *
 * Side effects on success:
 *   - condition.status flips from 'open' to 'submitted'
 *   - respondedAt / respondedBy are stamped
 *   - ActivityLog records 'condition_responded'
 *
 * The condition is NEVER auto-resolved here — only the loan officer can
 * accept the response (POST /conditions/:id/resolve).
 */
router.post(
  "/conditions/:conditionId/respond",
  requireAuth(["prospect"]),
  async (req, res): Promise<void> => {
    const params = RespondToConditionParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const body = RespondToConditionBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }
    const text = body.data.responseText?.trim() ?? null;
    const documentId = body.data.responseDocumentId ?? null;
    if (!text && !documentId) {
      res.status(400).json({
        error: "Lege reactie",
        message:
          "Geef een toelichting of koppel een geüpload document om dit punt af te handelen.",
      });
      return;
    }

    const [row] = await db
      .select({
        condition: conditionsTable,
        dossier: dossiersTable,
        prospectUserId: prospectProfilesTable.userId,
      })
      .from(conditionsTable)
      .innerJoin(dossiersTable, eq(dossiersTable.id, conditionsTable.dossierId))
      .innerJoin(
        prospectProfilesTable,
        eq(prospectProfilesTable.id, dossiersTable.prospectId),
      )
      .where(eq(conditionsTable.id, params.data.conditionId))
      .limit(1);
    if (!row || row.prospectUserId !== req.user!.id) {
      // Hide existence: 404 for both "doesn't exist" and "not yours".
      res.status(404).json({ error: "Voorwaarde niet gevonden" });
      return;
    }
    if (row.condition.status === "resolved") {
      res.status(409).json({
        error: "Reeds afgehandeld",
        message: "Dit punt is al door de kredietacceptant geaccepteerd.",
      });
      return;
    }
    // Validate the linked document, if any, belongs to the same dossier.
    if (documentId) {
      const [doc] = await db
        .select()
        .from(documentsTable)
        .where(
          and(
            eq(documentsTable.id, documentId),
            eq(documentsTable.dossierId, row.dossier.id),
          ),
        )
        .limit(1);
      if (!doc) {
        res.status(400).json({
          error: "Document niet gevonden",
          message: "Het gekozen document hoort niet bij je dossier.",
        });
        return;
      }
    }

    // Atomic guard: only transition from non-resolved states. If a loan
    // officer resolved the condition between our pre-check and this
    // update, the WHERE clause matches zero rows and we return 409 —
    // the resolved state is preserved.
    const updatedRows = await db
      .update(conditionsTable)
      .set({
        status: "submitted",
        responseText: text,
        responseDocumentId: documentId,
        respondedAt: new Date(),
        respondedBy: req.user!.id,
      })
      .where(
        and(
          eq(conditionsTable.id, params.data.conditionId),
          ne(conditionsTable.status, "resolved"),
        ),
      )
      .returning();
    if (updatedRows.length === 0) {
      res.status(409).json({
        error: "Reeds afgehandeld",
        message: "Dit punt is al door de kredietacceptant geaccepteerd.",
      });
      return;
    }
    const updated = updatedRows[0];

    let filename: string | null = null;
    if (documentId) {
      const [doc] = await db
        .select({ filename: documentsTable.filename })
        .from(documentsTable)
        .where(eq(documentsTable.id, documentId))
        .limit(1);
      filename = doc?.filename ?? null;
    }

    await logActivity({
      dossierId: row.dossier.id,
      actor: req.user!,
      action: "condition_responded",
      description: `Ondernemer heeft een reactie ingediend op '${row.condition.title}'.`,
      metadata: {
        conditionId: row.condition.id,
        hasText: !!text,
        documentId: documentId ?? undefined,
      },
    });

    res.json(serializeCondition(updated, { responseDocumentFilename: filename }));
  },
);

/**
 * Loan officer / admin marks a submitted condition as resolved.
 * Open (un-responded) conditions cannot be resolved — the officer should
 * use the existing decision flow to remove unwanted requests instead.
 */
router.post(
  "/conditions/:conditionId/resolve",
  requireAuth(["loan_officer", "admin"]),
  async (req, res): Promise<void> => {
    const params = ResolveConditionParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const body = ResolveConditionBody.safeParse(req.body ?? {});
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }

    const [row] = await db
      .select({ condition: conditionsTable, dossier: dossiersTable })
      .from(conditionsTable)
      .innerJoin(dossiersTable, eq(dossiersTable.id, conditionsTable.dossierId))
      .where(eq(conditionsTable.id, params.data.conditionId))
      .limit(1);
    if (!row) {
      res.status(404).json({ error: "Voorwaarde niet gevonden" });
      return;
    }
    if (!(await officerCanAccessDossier(row.dossier.id))) {
      res.status(404).json({ error: "Dossier niet gevonden" });
      return;
    }
    if (row.condition.status === "resolved") {
      res.status(409).json({
        error: "Reeds opgelost",
        message: "Deze voorwaarde is al eerder geaccepteerd.",
      });
      return;
    }
    if (row.condition.status === "open") {
      res.status(409).json({
        error: "Geen reactie aanwezig",
        message:
          "De ondernemer heeft nog niet gereageerd op dit punt — wacht op een reactie of pas het besluit aan.",
      });
      return;
    }

    const [updated] = await db
      .update(conditionsTable)
      .set({
        status: "resolved",
        resolvedAt: new Date(),
        resolvedBy: req.user!.id,
        reviewerNotes: body.data.reviewerNotes ?? row.condition.reviewerNotes,
      })
      .where(eq(conditionsTable.id, params.data.conditionId))
      .returning();

    await logActivity({
      dossierId: row.dossier.id,
      actor: req.user!,
      action: "condition_resolved",
      description: `Kredietacceptant heeft '${row.condition.title}' geaccepteerd.`,
      metadata: { conditionId: row.condition.id },
    });

    let filename: string | null = null;
    if (updated.responseDocumentId) {
      const [doc] = await db
        .select({ filename: documentsTable.filename })
        .from(documentsTable)
        .where(eq(documentsTable.id, updated.responseDocumentId))
        .limit(1);
      filename = doc?.filename ?? null;
    }

    res.json(
      serializeConditionForOfficer(updated, { responseDocumentFilename: filename }),
    );
  },
);

export default router;
