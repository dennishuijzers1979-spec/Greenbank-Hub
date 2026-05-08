import { Router, type IRouter } from "express";
import { eq, and, desc } from "drizzle-orm";
import {
  db,
  documentsTable,
  dossiersTable,
  prospectProfilesTable,
} from "@workspace/db";
import {
  UploadMyDocumentBody,
  DeleteMyDocumentParams,
  ListDossierDocumentsParams,
} from "@workspace/api-zod";
import { requireAuth } from "../lib/auth";
import { logActivity } from "../lib/activity";
import { serializeDocument } from "../lib/serializers";

const router: IRouter = Router();

const ALLOWED_MIME = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "image/png",
  "image/jpeg",
]);
const MAX_BYTES = 10 * 1024 * 1024;

router.get("/dossiers/me/documents", requireAuth(["prospect"]), async (req, res): Promise<void> => {
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
  const docs = await db
    .select()
    .from(documentsTable)
    .where(eq(documentsTable.dossierId, dossier.id))
    .orderBy(desc(documentsTable.createdAt));
  res.json(docs.map(serializeDocument));
});

router.post("/dossiers/me/documents", requireAuth(["prospect"]), async (req, res): Promise<void> => {
  const parsed = UploadMyDocumentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (!ALLOWED_MIME.has(parsed.data.mimeType)) {
    res.status(415).json({ error: "Bestandstype niet toegestaan" });
    return;
  }
  if (parsed.data.sizeBytes > MAX_BYTES) {
    res.status(413).json({ error: "Bestand groter dan 10 MB" });
    return;
  }
  const [prospect] = await db
    .select()
    .from(prospectProfilesTable)
    .where(eq(prospectProfilesTable.userId, req.user!.id))
    .limit(1);
  if (!prospect) {
    res.status(404).json({ error: "Geen prospectprofiel" });
    return;
  }
  const [dossier] = await db
    .select()
    .from(dossiersTable)
    .where(eq(dossiersTable.prospectId, prospect.id))
    .limit(1);
  if (!dossier) {
    res.status(404).json({ error: "Geen dossier" });
    return;
  }
  const [doc] = await db
    .insert(documentsTable)
    .values({
      dossierId: dossier.id,
      uploadedBy: req.user!.id,
      documentType: parsed.data.documentType,
      filename: parsed.data.filename,
      mimeType: parsed.data.mimeType,
      sizeBytes: parsed.data.sizeBytes,
      storagePath: `mock://dossiers/${dossier.id}/${parsed.data.filename}`,
      uploadStatus: "uploaded",
      validationStatus: "valid",
      extractedDataStatus: "extracted",
      usedInAnalysis: true,
    })
    .returning();
  if (
    dossier.status === "intake_in_progress" ||
    dossier.status === "prospect_logged_in"
  ) {
    await db
      .update(dossiersTable)
      .set({ status: "documents_uploaded", updatedAt: new Date() })
      .where(eq(dossiersTable.id, dossier.id));
  }
  await logActivity({
    dossierId: dossier.id,
    actor: req.user!,
    action: "document_uploaded",
    description: `Document geüpload: ${parsed.data.filename}`,
  });
  res.status(201).json(serializeDocument(doc));
});

router.delete("/dossiers/me/documents/:documentId", requireAuth(["prospect"]), async (req, res): Promise<void> => {
  const params = DeleteMyDocumentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [doc] = await db
    .select()
    .from(documentsTable)
    .where(eq(documentsTable.id, params.data.documentId))
    .limit(1);
  if (!doc || doc.uploadedBy !== req.user!.id) {
    res.status(404).json({ error: "Document niet gevonden" });
    return;
  }
  await db.delete(documentsTable).where(eq(documentsTable.id, doc.id));
  await logActivity({
    dossierId: doc.dossierId,
    actor: req.user!,
    action: "document_deleted",
    description: `Document verwijderd: ${doc.filename}`,
  });
  res.json({ ok: true });
});

router.get("/dossiers/:dossierId/documents", requireAuth(["loan_officer", "admin"]), async (req, res): Promise<void> => {
  const params = ListDossierDocumentsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const docs = await db
    .select()
    .from(documentsTable)
    .where(eq(documentsTable.dossierId, params.data.dossierId))
    .orderBy(desc(documentsTable.createdAt));
  res.json(docs.map(serializeDocument));
  void and; // silence unused
});

export default router;
