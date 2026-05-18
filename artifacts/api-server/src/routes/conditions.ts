import { Router, type IRouter } from "express";
import { eq, desc, and, ne, or, isNotNull, inArray, count } from "drizzle-orm";
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
  RequestAdditionalInfoParams,
  RequestAdditionalInfoBody,
} from "@workspace/api-zod";
import { requireAuth } from "../lib/auth";
import { logActivity } from "../lib/activity";
import {
  serializeCondition,
  serializeConditionForOfficer,
  serializeDossier,
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
  // Critical visibility rule: the prospect only sees conditions that
  // the loan officer has explicitly requested from them (requestedAt
  // non-null). Backward compat: if the dossier is in
  // "additional_info_requested" status AND no row carries an explicit
  // requestedAt stamp, treat ALL of its conditions as effectively
  // requested (legacy decision flow without per-row stamping).
  // The moment a single row has been explicitly requested, the rest
  // are considered internal-only — internal credit wording MUST NOT
  // leak alongside an explicit request.
  const allDossierConditions = await db
    .select()
    .from(conditionsTable)
    .where(eq(conditionsTable.dossierId, dossier.id))
    .orderBy(desc(conditionsTable.createdAt));
  const anyExplicitlyRequested = allDossierConditions.some((c) => c.requestedAt);
  const legacyBatch =
    dossier.status === "additional_info_requested" && !anyExplicitlyRequested;
  const items = legacyBatch
    ? allDossierConditions
    : allDossierConditions.filter((c) => c.requestedAt);

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
    // Reject responses to internal-only conditions — the prospect
    // should not even know about them, so 404 (consistent with the
    // visibility filter on the list endpoint). Backward-compat
    // mirror of the visibility rule above: only treat un-stamped rows
    // as requested when the dossier is the all-legacy batch case
    // (status = additional_info_requested AND no sibling row has been
    // explicitly stamped).
    if (!row.condition.requestedAt) {
      if (row.dossier.status !== "additional_info_requested") {
        res.status(404).json({ error: "Voorwaarde niet gevonden" });
        return;
      }
      const siblings = await db
        .select({ requestedAt: conditionsTable.requestedAt })
        .from(conditionsTable)
        .where(eq(conditionsTable.dossierId, row.condition.dossierId));
      if (siblings.some((s) => s.requestedAt)) {
        res.status(404).json({ error: "Voorwaarde niet gevonden" });
        return;
      }
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
    // Force-resolve override: the loan officer / admin MAY accept an
    // open (un-responded) requested item, but only when they record an
    // explicit internal reviewer note explaining why. This matches
    // requirement 6 — "Markeer als opgelost only after there is a
    // response, unless admin/loan officer explicitly resolves without
    // response with reviewer note".
    const reviewerNote = body.data.reviewerNotes?.trim() ?? null;
    if (row.condition.status === "open" && !reviewerNote) {
      res.status(409).json({
        error: "Geen reactie aanwezig",
        message:
          "De ondernemer heeft nog niet gereageerd op dit punt — wacht op een reactie, of forceer afhandeling door een interne reviewer-notitie mee te sturen.",
      });
      return;
    }

    const [updated] = await db
      .update(conditionsTable)
      .set({
        status: "resolved",
        resolvedAt: new Date(),
        resolvedBy: req.user!.id,
        reviewerNotes: reviewerNote ?? row.condition.reviewerNotes,
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

/**
 * Loan officer / admin explicitly turns one or more (optionally
 * existing internal) conditions into prospect-facing additional-info
 * requests. Each item carries the rewritten entrepreneur-friendly
 * copy (title / explanation / required action). When an
 * `internalConditionId` is supplied, the existing condition is
 * updated in-place (so its history and id are preserved); otherwise
 * a new requested condition is created. In both cases `requestedAt`
 * and `requestedBy` are stamped, making the item visible to the
 * prospect via /dossiers/me/conditions. The dossier itself is moved
 * into `additional_info_requested` so the existing partner-submission
 * and return-to-review flows keep working unchanged.
 */
router.post(
  "/dossiers/:dossierId/request-additional-info",
  requireAuth(["loan_officer", "admin"]),
  async (req, res): Promise<void> => {
    const params = RequestAdditionalInfoParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const body = RequestAdditionalInfoBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }
    if (!(await officerCanAccessDossier(params.data.dossierId))) {
      res.status(404).json({ error: "Dossier niet gevonden" });
      return;
    }

    const [dossier] = await db
      .select()
      .from(dossiersTable)
      .where(eq(dossiersTable.id, params.data.dossierId))
      .limit(1);
    if (!dossier) {
      res.status(404).json({ error: "Dossier niet gevonden" });
      return;
    }

    // Pre-validate ALL items before any write so we fail fast with a
    // clean 4xx instead of relying on the transaction to roll back
    // mid-flight (cheaper, and gives the LO a single clear error).
    for (const item of body.data.items) {
      if (
        !item.prospectTitle.trim() ||
        !item.prospectExplanation.trim() ||
        !item.prospectRequiredAction.trim()
      ) {
        res.status(400).json({
          error: "Lege velden",
          message:
            "Titel, toelichting en gevraagde actie zijn verplicht voor elk gevraagd punt.",
        });
        return;
      }
    }

    // All writes (conditions + dossier status + activity log) happen
    // inside a single transaction so the dossier never ends up in a
    // half-applied state if one item fails (e.g. a stale
    // internalConditionId or a row that flipped status between the
    // pre-check and the write).
    type TxError = { status: number; body: { error: string; message: string } };
    const now = new Date();
    const userId = req.user!.id;
    const previousStatus = dossier.status;

    let writtenIds: string[] = [];
    try {
      writtenIds = await db.transaction(async (tx) => {
        const ids: string[] = [];
        for (const item of body.data.items) {
          const pTitle = item.prospectTitle.trim();
          const pExplanation = item.prospectExplanation.trim();
          const pAction = item.prospectRequiredAction.trim();

          if (item.internalConditionId) {
            const [existing] = await tx
              .select()
              .from(conditionsTable)
              .where(eq(conditionsTable.id, item.internalConditionId))
              .limit(1);
            if (!existing || existing.dossierId !== dossier.id) {
              const err: TxError = {
                status: 404,
                body: {
                  error: "Voorwaarde niet gevonden",
                  message:
                    "Een interne voorwaarde uit je verzoek bestaat niet of hoort niet bij dit dossier.",
                },
              };
              throw err;
            }
            if (existing.status !== "open") {
              const err: TxError = {
                status: 409,
                body: {
                  error: "Status verkeerd",
                  message:
                    "Een van de geselecteerde voorwaarden is al in behandeling of opgelost.",
                },
              };
              throw err;
            }
            const [updated] = await tx
              .update(conditionsTable)
              .set({
                prospectTitle: pTitle,
                prospectExplanation: pExplanation,
                prospectRequiredAction: pAction,
                documentTypeHint: item.documentTypeHint ?? existing.documentTypeHint,
                reviewerNotes: item.reviewerNotes ?? existing.reviewerNotes,
                requestedAt: existing.requestedAt ?? now,
                requestedBy: existing.requestedBy ?? userId,
              })
              .where(eq(conditionsTable.id, item.internalConditionId))
              .returning();
            ids.push(updated.id);
          } else {
            const [created] = await tx
              .insert(conditionsTable)
              .values({
                dossierId: dossier.id,
                type: item.type ?? "blocking",
                // Mirror prospect-facing copy into the internal columns
                // for brand-new requests (there is no separate internal
                // credit wording in that case).
                title: pTitle,
                description: pExplanation,
                requiredAction: pAction,
                status: "open",
                prospectTitle: pTitle,
                prospectExplanation: pExplanation,
                prospectRequiredAction: pAction,
                documentTypeHint: item.documentTypeHint ?? null,
                reviewerNotes: item.reviewerNotes ?? null,
                requestedAt: now,
                requestedBy: userId,
              })
              .returning();
            ids.push(created.id);
          }
        }
        // Push the dossier into additional_info_requested. We
        // deliberately do NOT downgrade dossiers that are further
        // along (approved/submitted to partners) — those statuses are
        // outside the LO UI's call sites for this flow.
        await tx
          .update(dossiersTable)
          .set({
            status: "additional_info_requested",
            updatedAt: new Date(),
          })
          .where(eq(dossiersTable.id, dossier.id));
        return ids;
      });
    } catch (err) {
      if (err && typeof err === "object" && "status" in err && "body" in err) {
        const tx = err as TxError;
        res.status(tx.status).json(tx.body);
        return;
      }
      throw err;
    }

    // Activity log is best-effort and intentionally OUTSIDE the
    // transaction: an audit-log failure must not roll back a
    // successful state transition.
    await logActivity({
      dossierId: dossier.id,
      actor: req.user!,
      action: "additional_info_requested",
      description: `Kredietacceptant heeft ${writtenIds.length} aanvullend(e) verzoek(en) klaargezet voor de ondernemer.`,
      metadata: {
        previousStatus,
        nextStatus: "additional_info_requested",
        conditionIds: writtenIds,
      },
    });

    // Reload fresh post-commit state for the response payload, and
    // compute the dossier counts so we can return a full Dossier shape
    // (matching the OpenAPI contract exactly).
    const [updatedDossier] = await db
      .select()
      .from(dossiersTable)
      .where(eq(dossiersTable.id, dossier.id))
      .limit(1);
    const [prospect] = await db
      .select()
      .from(prospectProfilesTable)
      .where(eq(prospectProfilesTable.id, dossier.prospectId))
      .limit(1);
    const [docCount] = await db
      .select({ c: count() })
      .from(documentsTable)
      .where(eq(documentsTable.dossierId, dossier.id));
    const [blockingCount] = await db
      .select({ c: count() })
      .from(conditionsTable)
      .where(
        and(
          eq(conditionsTable.dossierId, dossier.id),
          eq(conditionsTable.type, "blocking"),
          eq(conditionsTable.status, "open"),
        ),
      );
    const written = await db
      .select()
      .from(conditionsTable)
      .where(inArray(conditionsTable.id, writtenIds));

    res.json({
      dossier: serializeDossier(
        updatedDossier,
        prospect,
        Number(docCount?.c ?? 0),
        Number(blockingCount?.c ?? 0),
      ),
      conditions: written.map((c) => serializeConditionForOfficer(c)),
    });
  },
);

export default router;
