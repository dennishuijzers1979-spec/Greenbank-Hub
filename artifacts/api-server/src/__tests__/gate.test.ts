/**
 * Backend gate integration tests.
 *
 * These tests guard the central dossier gate (`checkRunAnalysisGate`),
 * the structured 409 payload it produces, and the related authorisation
 * surfaces (officer visibility + document download).
 *
 * They run against the live development PostgreSQL database (DATABASE_URL).
 * Each test seeds rows under random IDs and cleans up in `after`, so they
 * are safe to run repeatedly side-by-side with the dev server.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomBytes, randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import bcrypt from "bcryptjs";

import {
  db,
  pool,
  usersTable,
  sessionsTable,
  prospectProfilesTable,
  dossiersTable,
  documentsTable,
  conditionsTable,
  aiAnalysisRunsTable,
} from "@workspace/db";

import app from "../app";
import {
  checkRunAnalysisGate,
  GATE_THRESHOLDS,
} from "../lib/skill-orchestration";
import {
  OFFICER_VISIBLE_STATUSES,
  isOfficerVisibleStatus,
  officerCanAccessDossier,
} from "../lib/dossier-access";

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

let server: Server;
let baseUrl: string;

const createdUserIds: string[] = [];
const createdDossierIds: string[] = [];

before(async () => {
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}/api`;
});

after(async () => {
  if (createdDossierIds.length > 0) {
    await db
      .delete(aiAnalysisRunsTable)
      .where(inArray(aiAnalysisRunsTable.dossierId, createdDossierIds));
    await db
      .delete(conditionsTable)
      .where(inArray(conditionsTable.dossierId, createdDossierIds));
    await db
      .delete(documentsTable)
      .where(inArray(documentsTable.dossierId, createdDossierIds));
    await db
      .delete(dossiersTable)
      .where(inArray(dossiersTable.id, createdDossierIds));
  }
  if (createdUserIds.length > 0) {
    await db
      .delete(sessionsTable)
      .where(inArray(sessionsTable.userId, createdUserIds));
    // prospect_profiles cascade-deletes with users
    await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
  }
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
  await pool.end();
});

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

type Role = "prospect" | "loan_officer" | "admin";

async function createUser(role: Role): Promise<{
  userId: string;
  email: string;
  sessionToken: string;
}> {
  const email = `test-${randomUUID()}@example.com`;
  const [user] = await db
    .insert(usersTable)
    .values({
      email,
      passwordHash: await bcrypt.hash("test-password", 4),
      role,
      firstLoginCompleted: true,
    })
    .returning();
  createdUserIds.push(user.id);
  const token = randomBytes(32).toString("hex");
  await db.insert(sessionsTable).values({
    userId: user.id,
    token,
    expiresAt: new Date(Date.now() + 86400 * 1000),
  });
  return { userId: user.id, email, sessionToken: token };
}

async function createProspectWithDossier(opts?: {
  status?: string;
}): Promise<{
  userId: string;
  prospectId: string;
  dossierId: string;
  sessionToken: string;
}> {
  const { userId, sessionToken } = await createUser("prospect");
  const [prospect] = await db
    .insert(prospectProfilesTable)
    .values({
      userId,
      companyName: `Test BV ${randomUUID().slice(0, 8)}`,
      contactName: "Test Persoon",
    })
    .returning();
  const [dossier] = await db
    .insert(dossiersTable)
    .values({
      prospectId: prospect.id,
      status: opts?.status ?? "intake_in_progress",
    })
    .returning();
  createdDossierIds.push(dossier.id);
  return {
    userId,
    prospectId: prospect.id,
    dossierId: dossier.id,
    sessionToken,
  };
}

async function insertDoc(
  dossierId: string,
  uploadedBy: string,
  documentType: string,
  validationStatus: "valid" | "pending" | "invalid",
  filename = `${documentType}.pdf`,
) {
  await db.insert(documentsTable).values({
    dossierId,
    uploadedBy,
    documentType,
    filename,
    mimeType: "application/pdf",
    sizeBytes: 1024,
    storagePath: `mock://test/${randomUUID()}`,
    uploadStatus: "uploaded",
    validationStatus,
    extractedDataStatus: "pending",
    usedInAnalysis: false,
  });
}

async function insertAllRequiredValidDocs(
  dossierId: string,
  uploadedBy: string,
) {
  await insertDoc(dossierId, uploadedBy, "annual_accounts", "valid");
  await insertDoc(dossierId, uploadedBy, "bank_statements", "valid");
  await insertDoc(dossierId, uploadedBy, "kvk_extract", "valid");
  await insertDoc(dossierId, uploadedBy, "id_document", "valid");
}

async function insertRun(
  dossierId: string,
  scores: {
    completeness: number;
    correctness: number;
    confidence: number;
    viability: number;
  },
  runType = "prevalidation",
) {
  await db.insert(aiAnalysisRunsTable).values({
    dossierId,
    runType,
    status: "completed",
    completedAt: new Date(),
    completenessScore: scores.completeness,
    correctnessScore: scores.correctness,
    confidenceScore: scores.confidence,
    viabilityScore: scores.viability,
    verdict: "go",
    verdictSummary: "test",
    skillModulesUsed: [],
    usedMockMode: true,
    errors: [],
  });
}

const PASSING_SCORES = {
  completeness: 95,
  correctness: 95,
  confidence: 95,
  viability: 95,
};

async function apiPost(
  path: string,
  sessionToken?: string,
  body?: unknown,
): Promise<{ status: number; json: any }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(sessionToken
        ? { Cookie: `geenbank_session=${sessionToken}` }
        : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    /* no body */
  }
  return { status: res.status, json: json as any };
}

async function apiGet(
  path: string,
  sessionToken?: string,
): Promise<{ status: number; json: any }> {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: {
      ...(sessionToken
        ? { Cookie: `geenbank_session=${sessionToken}` }
        : {}),
    },
  });
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    /* no body */
  }
  return { status: res.status, json: json as any };
}

function assertGateBlockedShape(payload: unknown): void {
  assert.ok(payload && typeof payload === "object", "payload is object");
  const p = payload as Record<string, unknown>;
  assert.equal(typeof p.error, "string");
  assert.equal(typeof p.message, "string");
  assert.ok(Array.isArray(p.reasons));
  assert.ok(Array.isArray(p.actions));
  assert.ok(Array.isArray(p.missingDocuments));
  assert.ok(Array.isArray(p.invalidDocuments));
  assert.ok(Array.isArray(p.pendingDocuments));
  assert.equal(typeof p.blockingConditions, "number");
  assert.ok(p.scores && typeof p.scores === "object");
  assert.ok(p.thresholds && typeof p.thresholds === "object");
}

// ---------------------------------------------------------------------------
// Gate behaviour: direct unit tests against checkRunAnalysisGate
// ---------------------------------------------------------------------------

test("gate blocks when no required documents are uploaded", async () => {
  const ctx = await createProspectWithDossier();
  const gate = await checkRunAnalysisGate(ctx.dossierId);
  assert.equal(gate.ok, false);
  if (gate.ok) return;
  assert.deepEqual(
    [...gate.missingDocuments].sort(),
    ["annual_accounts", "bank_statements", "id_document", "kvk_extract"],
  );
  assert.ok(gate.reasons.some((r) => /documenten ontbreken/i.test(r)));
});

test("gate blocks when a required document is still pending validation", async () => {
  const ctx = await createProspectWithDossier();
  await insertDoc(ctx.dossierId, ctx.userId, "annual_accounts", "valid");
  await insertDoc(ctx.dossierId, ctx.userId, "bank_statements", "pending");
  await insertDoc(ctx.dossierId, ctx.userId, "kvk_extract", "valid");
  await insertDoc(ctx.dossierId, ctx.userId, "id_document", "valid");
  await insertRun(ctx.dossierId, PASSING_SCORES);
  const gate = await checkRunAnalysisGate(ctx.dossierId);
  assert.equal(gate.ok, false);
  if (gate.ok) return;
  assert.ok(gate.pendingDocuments.length > 0);
  // Pending must also count as "missing" for the required type — gate is
  // strict about validationStatus === "valid".
  assert.ok(gate.missingDocuments.includes("bank_statements"));
});

test("gate blocks when a required document is marked invalid", async () => {
  const ctx = await createProspectWithDossier();
  await insertDoc(ctx.dossierId, ctx.userId, "annual_accounts", "invalid");
  await insertDoc(ctx.dossierId, ctx.userId, "bank_statements", "valid");
  await insertDoc(ctx.dossierId, ctx.userId, "kvk_extract", "valid");
  await insertDoc(ctx.dossierId, ctx.userId, "id_document", "valid");
  await insertRun(ctx.dossierId, PASSING_SCORES);
  const gate = await checkRunAnalysisGate(ctx.dossierId);
  assert.equal(gate.ok, false);
  if (gate.ok) return;
  assert.ok(gate.invalidDocuments.length > 0);
  assert.ok(gate.missingDocuments.includes("annual_accounts"));
});

test("gate blocks when an open blocking condition exists", async () => {
  const ctx = await createProspectWithDossier();
  await insertAllRequiredValidDocs(ctx.dossierId, ctx.userId);
  await insertRun(ctx.dossierId, PASSING_SCORES);
  await db.insert(conditionsTable).values({
    dossierId: ctx.dossierId,
    type: "blocking",
    title: "Ontbrekende info",
    description: "Aanvullende info nodig",
    status: "open",
  });
  const gate = await checkRunAnalysisGate(ctx.dossierId);
  assert.equal(gate.ok, false);
  if (gate.ok) return;
  assert.equal(gate.blockingConditions, 1);
});

test("gate blocks when confidence score is below threshold", async () => {
  const ctx = await createProspectWithDossier();
  await insertAllRequiredValidDocs(ctx.dossierId, ctx.userId);
  await insertRun(ctx.dossierId, {
    ...PASSING_SCORES,
    confidence: GATE_THRESHOLDS.confidence - 10,
  });
  const gate = await checkRunAnalysisGate(ctx.dossierId);
  assert.equal(gate.ok, false);
  if (gate.ok) return;
  assert.ok(gate.reasons.some((r) => /Vertrouwens/i.test(r)));
});

test("gate blocks when completeness score is below threshold", async () => {
  const ctx = await createProspectWithDossier();
  await insertAllRequiredValidDocs(ctx.dossierId, ctx.userId);
  await insertRun(ctx.dossierId, {
    ...PASSING_SCORES,
    completeness: GATE_THRESHOLDS.completeness - 10,
  });
  const gate = await checkRunAnalysisGate(ctx.dossierId);
  assert.equal(gate.ok, false);
  if (gate.ok) return;
  assert.ok(gate.reasons.some((r) => /Compleetheidsscore/i.test(r)));
});

test("gate blocks when correctness score is below threshold", async () => {
  const ctx = await createProspectWithDossier();
  await insertAllRequiredValidDocs(ctx.dossierId, ctx.userId);
  await insertRun(ctx.dossierId, {
    ...PASSING_SCORES,
    correctness: GATE_THRESHOLDS.correctness - 10,
  });
  const gate = await checkRunAnalysisGate(ctx.dossierId);
  assert.equal(gate.ok, false);
  if (gate.ok) return;
  assert.ok(gate.reasons.some((r) => /Correctheidsscore/i.test(r)));
});

test("gate blocks when viability score is below threshold", async () => {
  const ctx = await createProspectWithDossier();
  await insertAllRequiredValidDocs(ctx.dossierId, ctx.userId);
  await insertRun(ctx.dossierId, {
    ...PASSING_SCORES,
    viability: GATE_THRESHOLDS.viability - 10,
  });
  const gate = await checkRunAnalysisGate(ctx.dossierId);
  assert.equal(gate.ok, false);
  if (gate.ok) return;
  assert.ok(gate.reasons.some((r) => /Levensvatbaarheids/i.test(r)));
});

test("gate passes for a fully-prepared dossier", async () => {
  const ctx = await createProspectWithDossier();
  await insertAllRequiredValidDocs(ctx.dossierId, ctx.userId);
  await insertRun(ctx.dossierId, PASSING_SCORES);
  const gate = await checkRunAnalysisGate(ctx.dossierId);
  assert.equal(gate.ok, true);
});

// ---------------------------------------------------------------------------
// Gate behaviour: HTTP endpoints (run-analysis + submit) share the same gate
// ---------------------------------------------------------------------------

test("/dossiers/me/run-analysis returns 409 with structured GateBlockedError shape", async () => {
  const ctx = await createProspectWithDossier();
  // Missing all required docs.
  const res = await apiPost("/dossiers/me/run-analysis", ctx.sessionToken);
  assert.equal(res.status, 409);
  assertGateBlockedShape(res.json);
  assert.equal(res.json.error, "AI-analyse geblokkeerd");
});

test("/dossiers/me/submit returns 409 with structured GateBlockedError shape", async () => {
  const ctx = await createProspectWithDossier();
  const res = await apiPost("/dossiers/me/submit", ctx.sessionToken);
  assert.equal(res.status, 409);
  assertGateBlockedShape(res.json);
  assert.equal(res.json.error, "Dossier kan nog niet ingediend worden");
});

test("submit and run-analysis 409 payloads share the same key set (no drift)", async () => {
  const ctx = await createProspectWithDossier();
  const submit = await apiPost("/dossiers/me/submit", ctx.sessionToken);
  const analyse = await apiPost(
    "/dossiers/me/run-analysis",
    ctx.sessionToken,
  );
  assert.equal(submit.status, 409);
  assert.equal(analyse.status, 409);
  assert.deepEqual(
    Object.keys(submit.json).sort(),
    Object.keys(analyse.json).sort(),
  );
});

test("/dossiers/me/submit requires authentication", async () => {
  const res = await apiPost("/dossiers/me/submit");
  assert.equal(res.status, 401);
});

// ---------------------------------------------------------------------------
// Officer visibility list and dossier access
// ---------------------------------------------------------------------------

test("officer dossier list only shows OFFICER_VISIBLE_STATUSES", async () => {
  // Hidden (pre-submission) dossier
  const hidden = await createProspectWithDossier({
    status: "intake_in_progress",
  });
  // Visible (in-workflow) dossier
  const visible = await createProspectWithDossier({
    status: "loan_officer_review",
  });
  const officer = await createUser("loan_officer");
  const res = await apiGet("/dossiers", officer.sessionToken);
  assert.equal(res.status, 200);
  const ids: string[] = (res.json as Array<{ id: string }>).map((d) => d.id);
  assert.ok(ids.includes(visible.dossierId), "visible dossier present");
  assert.ok(!ids.includes(hidden.dossierId), "hidden dossier absent");
});

test("officerCanAccessDossier mirrors OFFICER_VISIBLE_STATUSES", async () => {
  const hidden = await createProspectWithDossier({
    status: "intake_in_progress",
  });
  const visible = await createProspectWithDossier({
    status: "submitted_to_geenbank",
  });
  assert.equal(await officerCanAccessDossier(hidden.dossierId), false);
  assert.equal(await officerCanAccessDossier(visible.dossierId), true);
  for (const s of OFFICER_VISIBLE_STATUSES) {
    assert.equal(isOfficerVisibleStatus(s), true);
  }
  assert.equal(isOfficerVisibleStatus("intake_in_progress"), false);
});

// ---------------------------------------------------------------------------
// Document content download authorisation
// ---------------------------------------------------------------------------

test("document download is denied for an unrelated prospect", async () => {
  const owner = await createProspectWithDossier();
  await insertDoc(owner.dossierId, owner.userId, "annual_accounts", "valid");
  const [doc] = await db
    .select()
    .from(documentsTable)
    .where(eq(documentsTable.dossierId, owner.dossierId))
    .limit(1);
  const intruder = await createProspectWithDossier();
  const res = await apiGet(
    `/documents/${doc.id}/content`,
    intruder.sessionToken,
  );
  // Intruder is a prospect who does not own the document → 404 (no leak).
  assert.equal(res.status, 404);
});

test("document download is denied for an officer when dossier is pre-submission", async () => {
  const owner = await createProspectWithDossier({
    status: "intake_in_progress",
  });
  await insertDoc(owner.dossierId, owner.userId, "annual_accounts", "valid");
  const [doc] = await db
    .select()
    .from(documentsTable)
    .where(eq(documentsTable.dossierId, owner.dossierId))
    .limit(1);
  const officer = await createUser("loan_officer");
  const res = await apiGet(
    `/documents/${doc.id}/content`,
    officer.sessionToken,
  );
  assert.equal(res.status, 404);
});

test("document download for an officer reaches storage layer once dossier is submitted", async () => {
  const owner = await createProspectWithDossier({
    status: "submitted_to_geenbank",
  });
  await insertDoc(owner.dossierId, owner.userId, "annual_accounts", "valid");
  const [doc] = await db
    .select()
    .from(documentsTable)
    .where(eq(documentsTable.dossierId, owner.dossierId))
    .limit(1);
  const officer = await createUser("loan_officer");
  const res = await apiGet(
    `/documents/${doc.id}/content`,
    officer.sessionToken,
  );
  // Authz passes — but seeded storagePath is `mock://...` so the route
  // returns 404 with the demo-data message. That's still proof that the
  // request was authorised (status 401/403 would mean the gate blocked).
  assert.equal(res.status, 404);
  assert.match(
    String((res.json && (res.json as { error?: string }).error) ?? ""),
    /demo-data/,
  );
});
