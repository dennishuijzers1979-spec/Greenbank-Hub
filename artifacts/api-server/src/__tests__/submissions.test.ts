/**
 * Partner submission workflow tests.
 *
 * Covers POST /api/dossiers/:dossierId/submissions:
 * - status guard (only approved_for_partner_submission / memorandum_generated)
 * - active partner enforcement
 * - duplicate / unknown partner rejection
 * - successful mock-send creates PartnerSubmission(s) and updates dossier
 * - SendGrid-missing path does not break submission
 * - RBAC (prospect rejected; admin allowed)
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
} from "@workspace/db";

import app from "../app";

let server: Server;
let baseUrl: string;

const createdUserIds: string[] = [];
const createdDossierIds: string[] = [];
const createdPartnerIds: string[] = [];

const savedSendgridKey = process.env.SENDGRID_API_KEY;

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
  if (savedSendgridKey === undefined) delete process.env.SENDGRID_API_KEY;
  else process.env.SENDGRID_API_KEY = savedSendgridKey;
});

type Role = "prospect" | "loan_officer" | "admin";

async function createUser(role: Role): Promise<{
  userId: string;
  sessionToken: string;
}> {
  const email = `subm-${randomUUID()}@example.com`;
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

async function createProspectWithDossier(opts: {
  status: string;
  requestedAmount?: number;
}): Promise<{
  userId: string;
  dossierId: string;
  prospectSession: string;
}> {
  const { userId, sessionToken } = await createUser("prospect");
  const [prospect] = await db
    .insert(prospectProfilesTable)
    .values({
      userId,
      companyName: `Submit BV ${randomUUID().slice(0, 8)}`,
      contactName: "Test Persoon",
    })
    .returning();
  const [dossier] = await db
    .insert(dossiersTable)
    .values({
      prospectId: prospect.id,
      status: opts.status,
      requestedAmount: opts.requestedAmount?.toString() ?? null,
      financingPurpose: "werkkapitaal",
    })
    .returning();
  createdDossierIds.push(dossier.id);
  return { userId, dossierId: dossier.id, prospectSession: sessionToken };
}

async function createPartner(opts?: {
  active?: boolean;
  min?: number | null;
  max?: number | null;
}): Promise<string> {
  const [p] = await db
    .insert(partnerFinanciersTable)
    .values({
      name: `Partner ${randomUUID().slice(0, 8)}`,
      contactEmail: `partner-${randomUUID().slice(0, 8)}@example.com`,
      productFocus: "MKB werkkapitaal",
      activeStatus: opts?.active === false ? "inactive" : "active",
      minimumTicketSize: opts?.min !== undefined ? opts.min?.toString() ?? null : null,
      maximumTicketSize: opts?.max !== undefined ? opts.max?.toString() ?? null : null,
    })
    .returning();
  createdPartnerIds.push(p.id);
  return p.id;
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
      ...(sessionToken
        ? { Cookie: `geenbank_session=${sessionToken}` }
        : {}),
    },
    body: JSON.stringify(body),
  });
  let json: unknown = null;
  try { json = await res.json(); } catch { /* no body */ }
  return { status: res.status, json };
}

function asRecord(value: unknown): Record<string, unknown> {
  assert.ok(value && typeof value === "object", "expected object payload");
  return value as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("loan officer can submit an approved dossier to active partners (mock-send)", async () => {
  const officer = await createUser("loan_officer");
  const ctx = await createProspectWithDossier({
    status: "approved_for_partner_submission",
    requestedAmount: 100_000,
  });
  const p1 = await createPartner({ active: true, min: 50_000, max: 250_000 });
  const p2 = await createPartner({ active: true });

  const r = await apiPost(
    `/dossiers/${ctx.dossierId}/submissions`,
    officer.sessionToken,
    { partnerIds: [p1, p2], notes: "Spoedig graag." },
  );
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.json));
  const arr = r.json as Array<Record<string, unknown>>;
  assert.equal(arr.length, 2);
  for (const s of arr) {
    assert.equal(s.status, "submitted_mock");
    assert.equal(s.usedMockMode, true);
  }

  const subs = await db
    .select()
    .from(partnerSubmissionsTable)
    .where(eq(partnerSubmissionsTable.dossierId, ctx.dossierId));
  assert.equal(subs.length, 2);

  const [updated] = await db
    .select()
    .from(dossiersTable)
    .where(eq(dossiersTable.id, ctx.dossierId));
  assert.equal(updated.status, "submitted_to_partners");

  const logs = await db
    .select()
    .from(activityLogsTable)
    .where(eq(activityLogsTable.dossierId, ctx.dossierId));
  assert.ok(logs.some((l) => l.action === "submitted_to_partners"));
});

test("submission on a not-yet-approved dossier returns 409", async () => {
  const officer = await createUser("loan_officer");
  const ctx = await createProspectWithDossier({ status: "loan_officer_review" });
  const p1 = await createPartner({ active: true });
  const r = await apiPost(
    `/dossiers/${ctx.dossierId}/submissions`,
    officer.sessionToken,
    { partnerIds: [p1] },
  );
  assert.equal(r.status, 409);
  const subs = await db
    .select()
    .from(partnerSubmissionsTable)
    .where(eq(partnerSubmissionsTable.dossierId, ctx.dossierId));
  assert.equal(subs.length, 0);
});

test("submission on a rejected dossier returns 409", async () => {
  const officer = await createUser("loan_officer");
  const ctx = await createProspectWithDossier({ status: "rejected_by_loan_officer" });
  const p1 = await createPartner({ active: true });
  const r = await apiPost(
    `/dossiers/${ctx.dossierId}/submissions`,
    officer.sessionToken,
    { partnerIds: [p1] },
  );
  assert.equal(r.status, 409);
});

test("submission on a dossier with additional_info_requested returns 409", async () => {
  const officer = await createUser("loan_officer");
  const ctx = await createProspectWithDossier({ status: "additional_info_requested" });
  const p1 = await createPartner({ active: true });
  const r = await apiPost(
    `/dossiers/${ctx.dossierId}/submissions`,
    officer.sessionToken,
    { partnerIds: [p1] },
  );
  assert.equal(r.status, 409);
});

test("re-submission on already-submitted dossier returns 409", async () => {
  const officer = await createUser("loan_officer");
  const ctx = await createProspectWithDossier({ status: "submitted_to_partners" });
  const p1 = await createPartner({ active: true });
  const r = await apiPost(
    `/dossiers/${ctx.dossierId}/submissions`,
    officer.sessionToken,
    { partnerIds: [p1] },
  );
  assert.equal(r.status, 409);
  const body = asRecord(r.json);
  assert.match(String(body.message ?? ""), /al aangeboden/i);
});

test("inactive partner is rejected with 400 — no submissions created", async () => {
  const officer = await createUser("loan_officer");
  const ctx = await createProspectWithDossier({ status: "approved_for_partner_submission" });
  const inactive = await createPartner({ active: false });
  const active = await createPartner({ active: true });
  const r = await apiPost(
    `/dossiers/${ctx.dossierId}/submissions`,
    officer.sessionToken,
    { partnerIds: [active, inactive] },
  );
  assert.equal(r.status, 400);
  const body = asRecord(r.json);
  assert.match(String(body.error ?? ""), /inactie/i);
  const subs = await db
    .select()
    .from(partnerSubmissionsTable)
    .where(eq(partnerSubmissionsTable.dossierId, ctx.dossierId));
  assert.equal(subs.length, 0);
  const [unchanged] = await db
    .select()
    .from(dossiersTable)
    .where(eq(dossiersTable.id, ctx.dossierId));
  assert.equal(unchanged.status, "approved_for_partner_submission");
});

test("unknown partner ID returns 400", async () => {
  const officer = await createUser("loan_officer");
  const ctx = await createProspectWithDossier({ status: "approved_for_partner_submission" });
  const unknownId = randomUUID();
  const r = await apiPost(
    `/dossiers/${ctx.dossierId}/submissions`,
    officer.sessionToken,
    { partnerIds: [unknownId] },
  );
  assert.equal(r.status, 400);
});

test("duplicate partner IDs in the request return 400", async () => {
  const officer = await createUser("loan_officer");
  const ctx = await createProspectWithDossier({ status: "approved_for_partner_submission" });
  const p1 = await createPartner({ active: true });
  const r = await apiPost(
    `/dossiers/${ctx.dossierId}/submissions`,
    officer.sessionToken,
    { partnerIds: [p1, p1] },
  );
  assert.equal(r.status, 400);
});

test("empty partnerIds returns 400", async () => {
  const officer = await createUser("loan_officer");
  const ctx = await createProspectWithDossier({ status: "approved_for_partner_submission" });
  const r = await apiPost(
    `/dossiers/${ctx.dossierId}/submissions`,
    officer.sessionToken,
    { partnerIds: [] },
  );
  assert.equal(r.status, 400);
});

test("prospect cannot call the submission endpoint", async () => {
  const ctx = await createProspectWithDossier({ status: "approved_for_partner_submission" });
  const p1 = await createPartner({ active: true });
  const r = await apiPost(
    `/dossiers/${ctx.dossierId}/submissions`,
    ctx.prospectSession,
    { partnerIds: [p1] },
  );
  assert.ok(r.status === 401 || r.status === 403);
});

test("admin can submit like a loan officer", async () => {
  const admin = await createUser("admin");
  const ctx = await createProspectWithDossier({ status: "approved_for_partner_submission" });
  const p1 = await createPartner({ active: true });
  const r = await apiPost(
    `/dossiers/${ctx.dossierId}/submissions`,
    admin.sessionToken,
    { partnerIds: [p1] },
  );
  assert.equal(r.status, 200);
});

test("submission persists when SendGrid key is missing (mock email path)", async () => {
  assert.equal(process.env.SENDGRID_API_KEY, undefined);
  const officer = await createUser("loan_officer");
  const ctx = await createProspectWithDossier({
    status: "approved_for_partner_submission",
    requestedAmount: 75_000,
  });
  const p1 = await createPartner({ active: true });
  const r = await apiPost(
    `/dossiers/${ctx.dossierId}/submissions`,
    officer.sessionToken,
    { partnerIds: [p1] },
  );
  assert.equal(r.status, 200);
  const subs = await db
    .select()
    .from(partnerSubmissionsTable)
    .where(eq(partnerSubmissionsTable.dossierId, ctx.dossierId));
  assert.equal(subs.length, 1);
  assert.equal(subs[0].status, "submitted_mock");
});

test("ticket-range warning is recorded in activity metadata when amount falls outside partner range", async () => {
  const officer = await createUser("loan_officer");
  const ctx = await createProspectWithDossier({
    status: "approved_for_partner_submission",
    requestedAmount: 1_000_000,
  });
  const p1 = await createPartner({ active: true, min: 10_000, max: 100_000 });
  const r = await apiPost(
    `/dossiers/${ctx.dossierId}/submissions`,
    officer.sessionToken,
    { partnerIds: [p1] },
  );
  assert.equal(r.status, 200);

  const logs = await db
    .select()
    .from(activityLogsTable)
    .where(eq(activityLogsTable.dossierId, ctx.dossierId));
  const submitLog = logs.find((l) => l.action === "submitted_to_partners");
  assert.ok(submitLog);
  const meta = submitLog.metadata as { ticketRangeWarnings?: string[] } | null;
  assert.ok(meta && Array.isArray(meta.ticketRangeWarnings) && meta.ticketRangeWarnings.length === 1);
});
