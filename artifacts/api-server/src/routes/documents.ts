import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { randomUUID } from "node:crypto";
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
import { officerCanAccessDossier } from "../lib/dossier-access";
import {
  persistDocument,
  readDocument,
  deleteDocument as removeStoredFile,
} from "../lib/document-storage";
import { validateFileSignature } from "../lib/file-signature";
import { SUPPORTED_DOCUMENT_TYPES } from "../lib/skills";

const router: IRouter = Router();

const ALLOWED_MIME = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/csv",
  "application/csv",
  "text/plain",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "application/octet-stream",
  "image/png",
  "image/jpeg",
]);
const MAX_BYTES = 20 * 1024 * 1024;
const SUPPORTED_TYPES = new Set<string>(SUPPORTED_DOCUMENT_TYPES);

router.get(
  "/dossiers/me/documents",
  requireAuth(["prospect"]),
  async (req, res): Promise<void> => {
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
  },
);

router.post(
  "/dossiers/me/documents",
  requireAuth(["prospect"]),
  async (req, res): Promise<void> => {
    const parsed = UploadMyDocumentBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    if (!SUPPORTED_TYPES.has(parsed.data.documentType)) {
      res.status(400).json({
        error: `Documenttype '${parsed.data.documentType}' wordt niet ondersteund.`,
      });
      return;
    }
    if (!ALLOWED_MIME.has(parsed.data.mimeType)) {
      res.status(415).json({ error: "Bestandstype niet toegestaan" });
      return;
    }
    if (parsed.data.sizeBytes > MAX_BYTES) {
      res.status(413).json({ error: "Bestand groter dan 20 MB" });
      return;
    }
    if (!parsed.data.contentBase64) {
      res
        .status(400)
        .json({ error: "Bestand ontbreekt — voeg base64-inhoud toe." });
      return;
    }
    const contentBuffer = Buffer.from(parsed.data.contentBase64, "base64");
    if (contentBuffer.length > MAX_BYTES) {
      res.status(413).json({ error: "Bestand groter dan 20 MB" });
      return;
    }
    const sigCheck = validateFileSignature({
      filename: parsed.data.filename,
      mimeType: parsed.data.mimeType,
      buffer: contentBuffer,
    });
    if (!sigCheck.ok) {
      res.status(415).json({
        error: `Bestand geweigerd: ${sigCheck.reason ?? "inhoud komt niet overeen met type."}`,
      });
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

    const documentId = randomUUID();
    const stored = await persistDocument({
      dossierId: dossier.id,
      documentId,
      filename: parsed.data.filename,
      contentBase64: parsed.data.contentBase64,
    });
    if (stored.sizeBytes > MAX_BYTES) {
      await removeStoredFile(stored.storagePath);
      res.status(413).json({ error: "Bestand groter dan 20 MB" });
      return;
    }

    const [doc] = await db
      .insert(documentsTable)
      .values({
        id: documentId,
        dossierId: dossier.id,
        uploadedBy: req.user!.id,
        documentType: parsed.data.documentType,
        filename: parsed.data.filename,
        mimeType: parsed.data.mimeType,
        sizeBytes: stored.sizeBytes,
        storagePath: stored.storagePath,
        uploadStatus: "uploaded",
        validationStatus: "valid",
        extractedDataStatus: "pending",
        usedInAnalysis: false,
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
  },
);

router.delete(
  "/dossiers/me/documents/:documentId",
  requireAuth(["prospect"]),
  async (req, res): Promise<void> => {
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
    await removeStoredFile(doc.storagePath);
    await logActivity({
      dossierId: doc.dossierId,
      actor: req.user!,
      action: "document_deleted",
      description: `Document verwijderd: ${doc.filename}`,
    });
    res.json({ ok: true });
  },
);

router.get(
  "/dossiers/:dossierId/documents",
  requireAuth(["loan_officer", "admin"]),
  async (req, res): Promise<void> => {
    const params = ListDossierDocumentsParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    if (!(await officerCanAccessDossier(params.data.dossierId))) {
      res.status(404).json({ error: "Dossier niet gevonden" });
      return;
    }
    const docs = await db
      .select()
      .from(documentsTable)
      .where(eq(documentsTable.dossierId, params.data.dossierId))
      .orderBy(desc(documentsTable.createdAt));
    res.json(docs.map(serializeDocument));
  },
);

router.get(
  "/documents/:documentId/content",
  requireAuth(["prospect", "loan_officer", "admin"]),
  async (req, res): Promise<void> => {
    const documentId = String(req.params.documentId ?? "");
    if (!documentId) {
      res.status(400).json({ error: "documentId ontbreekt" });
      return;
    }
    const [doc] = await db
      .select()
      .from(documentsTable)
      .where(eq(documentsTable.id, documentId))
      .limit(1);
    if (!doc) {
      res.status(404).json({ error: "Document niet gevonden" });
      return;
    }
    if (req.user!.role === "prospect" && doc.uploadedBy !== req.user!.id) {
      res.status(404).json({ error: "Document niet gevonden" });
      return;
    }
    if (
      (req.user!.role === "loan_officer" || req.user!.role === "admin") &&
      !(await officerCanAccessDossier(doc.dossierId))
    ) {
      res.status(404).json({ error: "Document niet gevonden" });
      return;
    }
    if (!doc.storagePath || doc.storagePath.startsWith("mock://")) {
      res
        .status(404)
        .json({ error: "Originele inhoud is niet beschikbaar (demo-data)." });
      return;
    }
    try {
      const buf = await readDocument(doc.storagePath);
      res.setHeader("Content-Type", doc.mimeType);
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${doc.filename.replace(/"/g, "")}"`,
      );
      res.send(buf);
    } catch {
      res.status(404).json({ error: "Bestand niet meer aanwezig" });
    }
  },
);

export default router;
