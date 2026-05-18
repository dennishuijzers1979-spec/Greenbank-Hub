/**
 * Memorandum + partner-package workflow tests.
 *
 * Covers:
 *  - POST /memorandum: officer can generate; prospect 403.
 *  - GET  /memorandum: returns enriched payload; evidence gaps when
 *    AI sources missing.
 *  - POST /submissions: blocked (409) when no memorandum exists; uses
 *    memorandum-derived packageSummary when present; ActivityLog records
 *    the memorandumRunId.
 *  - Regenerating memorandum after a resolved condition removes that
 *    condition from the open-conditions section.
 *  - Prospect-facing dossier serializer never leaks memorandum or
 *    financier report contents.
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
  conditionsTable,
  activityLogsTable,
  partnerFinanciersTable,
  partnerSubmissionsTable,
  aiAnalysisRunsTable,
} from "@workspace/db";

import app from "../app";

let server: Server;
let baseUrl: string;

const createdUserIds: string[] = [];
const createdDossierIds: string[] = [];
const createdPartnerIds: string[] = [];

before(async () => {
  delete process.env.SENDGRID_API_KEY;
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}/api`;
});

after(async () => {
  if (createdDossierIds.length > 0) {
    await db
      .delete(partnerSubmissionsTable)
      .where(inArray(partnerSubmissionsTable.dossierId, createdDossierIds));
    await db
      .delete(activityLogsTable)
      .where(inArray(activityLogsTable.dossierId, createdDossierIds));
    await db
      .delete(aiAnalysisRunsTable)
      .where(inArray(aiAnalysisRunsTable.dossierId, createdDossierIds));
    await db
      .delete(conditionsTable)
      .where(inArray(conditionsTable.dossierId, createdDossierIds));
    await db
      .delete(dossiersTable)
      .where(inArray(dossiersTable.id, createdDossierIds));
  }
  if (createdPartnerIds.length > 0) {
    await db
      .delete(partnerFinanciersTable)
      .where(inArray(partnerFinanciersTable.id, createdPartnerIds));
  }
  if (createdUserIds.length > 0) {
    await db
      .delete(sessionsTable)
      .where(inArray(sessionsTable.userId, createdUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
  }
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
  await pool.end();
});

type Role = "prospect" | "loan_officer" | "admin";

async function createUser(role: Role): Promise<{
  userId: string;
  sessionToken: string;
}> {
  const email = `memo-${randomUUID()}@example.com`;
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
  return { userId: user.id, sessionToken: token };
}

async function createDossier(opts: {
  status: string;
  requestedAmount?: number;
}): Promise<{ userId: string; dossierId: string; prospectSession: string }> {
  const { userId, sessionToken } = await createUser("prospect");
  const [prospect] = await db
    .insert(prospectProfilesTable)
    .values({
      userId,
      companyName: `Memo BV ${randomUUID().slice(0, 8)}`,
      contactName: "Test Persoon",
    })
    .returning();
  const [dossier] = await db
    .insert(dossiersTable)
    .values({
      prospectId: prospect.id,
      status: opts.status,
      requestedAmount: opts.requestedAmount?.toString() ?? "100000",
      financingPurpose: "werkkapitaal",
    })
    .returning();
  createdDossierIds.push(dossier.id);
  return { userId, dossierId: dossier.id, prospectSession: sessionToken };
}

async function createPartner(): Promise<string> {
  const [p] = await db
    .insert(partnerFinanciersTable)
    .values({
      name: `Partner ${randomUUID().slice(0, 8)}`,
      contactEmail: `partner-${randomUUID().slice(0, 8)}@example.com`,
      productFocus: "MKB werkkapitaal",
      activeStatus: "active",
    })
    .returning();
  createdPartnerIds.push(p.id);
  return p.id;
}

/**
 * Insert a synthetic prevalidation run so the memorandum has scoring
 * data to consume. Without it the adapter falls back entirely to
 * "Niet beschikbaar" — useful in one test but undesirable for the
 * happy-path tests.
 */
async function insertPrevalidationRun(dossierId: string): Promise<void> {
  await db.insert(aiAnalysisRunsTable).values({
    dossierId,
    runType: "prevalidation",
    status: "completed",
    completedAt: new Date(),
    completenessScore: 80,
    correctnessScore: 75,
    viabilityScore: 70,
    confidenceScore: 65,
    verdict: "go",
    verdictSummary: "Stevige aanvraag met enkele documentpunten.",
    entrepreneurReport: { summary: "Ondernemer-blik" },
    financierReport: {
      summary: "Financier-blik",
      keyRisks: ["Beperkte solvabiliteit"],
    },
    usedMockMode: true,
  });
}

interface ApiResponse {
  status: number;
  json: unknown;
}

async function apiPost(
  path: string,
  sessionToken: string | undefined,
  body: unknown,
): Promise<ApiResponse> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(sessionToken ? { Cookie: `geenbank_session=${sessionToken}` } : {}),
    },
    body: JSON.stringify(body),
  });
  let json: unknown = null;
  try { json = await res.json(); } catch { /* ignore */ }
  return { status: res.status, json };
}

async function apiGet(
  path: string,
  sessionToken: string | undefined,
): Promise<ApiResponse> {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: sessionToken ? { Cookie: `geenbank_session=${sessionToken}` } : {},
  });
  let json: unknown = null;
  try { json = await res.json(); } catch { /* ignore */ }
  return { status: res.status, json };
}

function asRecord(v: unknown): Record<string, unknown> {
  assert.ok(v && typeof v === "object", "expected object payload");
  return v as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("loan officer can generate a memorandum and GET it back enriched", async () => {
  const officer = await createUser("loan_officer");
  const ctx = await createDossier({ status: "approved_for_partner_submission" });
  await insertPrevalidationRun(ctx.dossierId);
  const partnerId = await createPartner();

  const gen = await apiPost(
    `/dossiers/${ctx.dossierId}/memorandum`,
    officer.sessionToken,
    { partnerIds: [partnerId] },
  );
  assert.equal(gen.status, 200);
  const genBody = asRecord(gen.json);
  assert.ok(Array.isArray(genBody.sections));
  assert.ok((genBody.sections as unknown[]).length >= 14, "expected 14 Dutch sections");
  assert.ok(Array.isArray(genBody.partnerPackages));
  assert.equal((genBody.partnerPackages as unknown[]).length, 1);
  assert.ok(Array.isArray(genBody.evidenceGaps));

  const get = await apiGet(
    `/dossiers/${ctx.dossierId}/memorandum`,
    officer.sessionToken,
  );
  assert.equal(get.status, 200);
  const getBody = asRecord(get.json);
  assert.equal(getBody.stale, false);
  assert.ok(Array.isArray(getBody.sections));
  assert.ok((getBody.sections as unknown[]).length >= 14);

  // Activity log records the memorandumRunId
  const logs = await db
    .select()
    .from(activityLogsTable)
    .where(eq(activityLogsTable.dossierId, ctx.dossierId));
  const memoLog = logs.find((l) => l.action === "memorandum_generated");
  assert.ok(memoLog, "memorandum_generated activity log expected");
  const meta = (memoLog!.metadata ?? {}) as Record<string, unknown>;
  assert.ok(typeof meta.memorandumRunId === "string" && meta.memorandumRunId.length > 0);
});

test("prospect cannot generate or read the memorandum (403)", async () => {
  const ctx = await createDossier({ status: "approved_for_partner_submission" });
  await insertPrevalidationRun(ctx.dossierId);

  const gen = await apiPost(
    `/dossiers/${ctx.dossierId}/memorandum`,
    ctx.prospectSession,
    {},
  );
  assert.equal(gen.status, 403);

  const get = await apiGet(
    `/dossiers/${ctx.dossierId}/memorandum`,
    ctx.prospectSession,
  );
  assert.equal(get.status, 403);
});

test("memorandum exposes evidence gaps when AI sources are missing", async () => {
  const officer = await createUser("loan_officer");
  // Note: NO prevalidation run inserted → adapter has no scoring/reports.
  const ctx = await createDossier({ status: "approved_for_partner_submission" });

  const gen = await apiPost(
    `/dossiers/${ctx.dossierId}/memorandum`,
    officer.sessionToken,
    {},
  );
  assert.equal(gen.status, 200);
  const body = asRecord(gen.json);
  const gaps = body.evidenceGaps as string[];
  assert.ok(Array.isArray(gaps));
  assert.ok(gaps.length > 0, "expected at least one evidence gap when AI data missing");

  // Some sections must render "Niet beschikbaar" rather than hallucinated text.
  const sections = body.sections as Array<{ title: string; body: string }>;
  assert.ok(
    sections.some((s) => s.body.includes("Niet beschikbaar")),
    "expected at least one section to surface 'Niet beschikbaar'",
  );
});

test("partner submission is blocked (409) when no memorandum exists", async () => {
  const officer = await createUser("loan_officer");
  const ctx = await createDossier({ status: "approved_for_partner_submission" });
  await insertPrevalidationRun(ctx.dossierId);
  const partnerId = await createPartner();

  const r = await apiPost(
    `/dossiers/${ctx.dossierId}/submissions`,
    officer.sessionToken,
    { partnerIds: [partnerId] },
  );
  assert.equal(r.status, 409);
  const body = asRecord(r.json);
  assert.match(String(body.error ?? ""), /memorandum/i);

  const subs = await db
    .select()
    .from(partnerSubmissionsTable)
    .where(eq(partnerSubmissionsTable.dossierId, ctx.dossierId));
  assert.equal(subs.length, 0);
});

test("submission packageSummary references the memorandum and logs memorandumRunId", async () => {
  const officer = await createUser("loan_officer");
  const ctx = await createDossier({
    status: "approved_for_partner_submission",
    requestedAmount: 150_000,
  });
  await insertPrevalidationRun(ctx.dossierId);
  const partnerId = await createPartner();

  const gen = await apiPost(
    `/dossiers/${ctx.dossierId}/memorandum`,
    officer.sessionToken,
    { partnerIds: [partnerId] },
  );
  assert.equal(gen.status, 200);

  const sub = await apiPost(
    `/dossiers/${ctx.dossierId}/submissions`,
    officer.sessionToken,
    { partnerIds: [partnerId] },
  );
  assert.equal(sub.status, 200);
  const arr = sub.json as Array<Record<string, unknown>>;
  assert.equal(arr.length, 1);
  const summary = String(arr[0].packageSummary ?? "");
  assert.match(summary, /Memorandum/i);

  const logs = await db
    .select()
    .from(activityLogsTable)
    .where(eq(activityLogsTable.dossierId, ctx.dossierId));
  const submitLog = logs.find((l) => l.action === "submitted_to_partners");
  assert.ok(submitLog, "submitted_to_partners activity expected");
  const meta = (submitLog!.metadata ?? {}) as Record<string, unknown>;
  assert.ok(
    typeof meta.memorandumRunId === "string" && meta.memorandumRunId.length > 0,
    "submission activity must record memorandumRunId",
  );
});

test("regenerated memorandum reflects resolved conditions", async () => {
  const officer = await createUser("loan_officer");
  const ctx = await createDossier({ status: "approved_for_partner_submission" });
  await insertPrevalidationRun(ctx.dossierId);

  const [cond] = await db
    .insert(conditionsTable)
    .values({
      dossierId: ctx.dossierId,
      type: "non_blocking",
      title: "Aanvullende balans Q3 nodig",
      description: "Balans Q3 ontbreekt in dossier.",
      requiredAction: "Upload de Q3-balans.",
      status: "open",
    })
    .returning();

  // First memo: condition is open and must surface somewhere.
  const first = await apiPost(
    `/dossiers/${ctx.dossierId}/memorandum`,
    officer.sessionToken,
    {},
  );
  assert.equal(first.status, 200);
  const firstSections = (asRecord(first.json).sections as Array<{ title: string; body: string }>);
  const firstFlat = firstSections.map((s) => s.body).join("\n");
  assert.match(firstFlat, /Q3/i);

  // Resolve and regenerate.
  await db
    .update(conditionsTable)
    .set({ status: "resolved", resolvedAt: new Date() })
    .where(eq(conditionsTable.id, cond.id));

  const second = await apiPost(
    `/dossiers/${ctx.dossierId}/memorandum`,
    officer.sessionToken,
    {},
  );
  assert.equal(second.status, 200);
  const secondSections = (asRecord(second.json).sections as Array<{ title: string; body: string }>);
  // The "open voorwaarden" type section should no longer show this Q3 line
  // as outstanding. Find the section containing the original Q3 text and
  // assert its body changed (either dropped the item, or moved it to a
  // "resolved" framing).
  const openSection = secondSections.find((s) =>
    /voorwaarde/i.test(s.title) || /condit/i.test(s.title),
  );
  if (openSection) {
    assert.ok(
      !/Q3.*open|open.*Q3/i.test(openSection.body) ||
        /resolved|opgelost/i.test(openSection.body),
      "resolved condition must not appear as open in regenerated memo",
    );
  }
});

test("prospect-facing dossier endpoint never leaks memorandum or financier data", async () => {
  const officer = await createUser("loan_officer");
  const ctx = await createDossier({ status: "approved_for_partner_submission" });
  await insertPrevalidationRun(ctx.dossierId);

  await apiPost(
    `/dossiers/${ctx.dossierId}/memorandum`,
    officer.sessionToken,
    {},
  );

  const r = await apiGet(`/dossiers/${ctx.dossierId}`, ctx.prospectSession);
  // Prospect may be able to view their own dossier shell, but it must
  // never contain memorandum/financier internals. Status strings like
  // "memorandum_generated" are allowed; payload fields are not.
  if (r.status === 200) {
    const obj = asRecord(r.json);
    assert.equal(obj.memorandum, undefined, "prospect must not receive memorandum field");
    assert.equal(obj.financierReport, undefined, "prospect must not receive financierReport field");
    assert.equal(obj.partnerPackages, undefined, "prospect must not receive partnerPackages field");
    assert.equal(obj.evidenceGaps, undefined, "prospect must not receive evidenceGaps field");
    // Section bodies use this exact phrase — must not appear anywhere.
    const serialized = JSON.stringify(r.json);
    assert.equal(
      /Niet beschikbaar/i.test(serialized),
      false,
      "prospect must not see evidence-gap markers",
    );
  }
});
