/**
 * Additional-information recovery loop tests.
 *
 * Covers:
 *   - POST /api/conditions/:id/respond  (prospect)
 *   - POST /api/conditions/:id/resolve  (loan officer / admin)
 *   - POST /api/dossiers/:id/return-to-review (loan officer / admin)
 *   - Prospect serializer never leaks reviewerNotes
 *   - Submission gate refuses dossiers with outstanding blocking conditions
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
  documentsTable,
} from "@workspace/db";

import app from "../app";

let server: Server;
let baseUrl: string;

const createdUserIds: string[] = [];
const createdDossierIds: string[] = [];

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
      .delete(activityLogsTable)
      .where(inArray(activityLogsTable.dossierId, createdDossierIds));
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
  const email = `addinfo-${randomUUID()}@example.com`;
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

async function createScenario(opts?: {
  status?: string;
  conditionTitles?: string[];
  reviewerNotes?: string | null;
}): Promise<{
  prospectUserId: string;
  prospectSession: string;
  prospectId: string;
  dossierId: string;
  conditionIds: string[];
}> {
  const prospect = await createUser("prospect");
  const [profile] = await db
    .insert(prospectProfilesTable)
    .values({
      userId: prospect.userId,
      companyName: `AddInfo BV ${randomUUID().slice(0, 8)}`,
      contactName: "Test Persoon",
    })
    .returning();
  const [dossier] = await db
    .insert(dossiersTable)
    .values({
      prospectId: profile.id,
      status: opts?.status ?? "additional_info_requested",
    })
    .returning();
  createdDossierIds.push(dossier.id);
  const titles = opts?.conditionTitles ?? ["Bankafschriften Q4 2025"];
  // Scenario assumes the loan officer has already explicitly turned
  // each item into a prospect-facing request (requestedAt stamped +
  // prospect-facing copy populated). The recovery-loop tests then
  // exercise the response/resolve flow on top of that. Internal-only
  // (unstamped) conditions are NOT visible to the prospect and have
  // their own dedicated coverage in additional-info-request.test.ts.
  const now = new Date();
  const conds = await db
    .insert(conditionsTable)
    .values(
      titles.map((t) => ({
        dossierId: dossier.id,
        type: "blocking" as const,
        status: "open" as const,
        title: t,
        description: t,
        requiredAction: t,
        prospectTitle: t,
        prospectExplanation: t,
        prospectRequiredAction: t,
        requestedAt: now,
        requestedBy: prospect.userId,
        reviewerNotes: opts?.reviewerNotes ?? "INTERNE NOTITIE — niet voor prospect",
      })),
    )
    .returning();
  return {
    prospectUserId: prospect.userId,
    prospectSession: prospect.sessionToken,
    prospectId: profile.id,
    dossierId: dossier.id,
    conditionIds: conds.map((c) => c.id),
  };
}

interface ApiResponse {
  status: number;
  json: unknown;
}

async function apiRequest(
  method: "GET" | "POST",
  path: string,
  sessionToken: string | undefined,
  body?: unknown,
): Promise<ApiResponse> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
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
  return { status: res.status, json };
}

function asRecord(value: unknown): Record<string, unknown> {
  assert.ok(value && typeof value === "object", "expected object payload");
  return value as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Prospect respond endpoint
// ---------------------------------------------------------------------------

test("prospect can respond to a condition with text — status moves to submitted", async () => {
  const ctx = await createScenario();
  const conditionId = ctx.conditionIds[0];
  const r = await apiRequest("POST", `/conditions/${conditionId}/respond`, ctx.prospectSession, {
    responseText: "Bijgevoegd zijn de afschriften via de bank.",
  });
  assert.equal(r.status, 200);
  const body = asRecord(r.json);
  assert.equal(body.status, "submitted");
  assert.equal(body.responseText, "Bijgevoegd zijn de afschriften via de bank.");
  // CRITICAL: prospect serializer must never leak reviewer notes.
  assert.equal(body.reviewerNotes, null);

  const [row] = await db
    .select()
    .from(conditionsTable)
    .where(eq(conditionsTable.id, conditionId));
  assert.equal(row.status, "submitted");
  assert.ok(row.respondedAt instanceof Date);
  assert.equal(row.respondedBy, ctx.prospectUserId);
});

test("prospect respond requires text or document", async () => {
  const ctx = await createScenario();
  const r = await apiRequest("POST", `/conditions/${ctx.conditionIds[0]}/respond`, ctx.prospectSession, {
    responseText: "",
    responseDocumentId: null,
  });
  assert.equal(r.status, 400);
});

test("prospect cannot respond to another prospect's condition", async () => {
  const owner = await createScenario();
  const intruder = await createUser("prospect");
  const r = await apiRequest("POST", `/conditions/${owner.conditionIds[0]}/respond`, intruder.sessionToken, {
    responseText: "ik probeer hier in te breken",
  });
  // Either 403 (forbidden) or 404 (hidden ownership) is acceptable.
  assert.ok(r.status === 403 || r.status === 404, `expected 403/404 got ${r.status}`);
});

test("loan officer cannot use the prospect respond endpoint", async () => {
  const ctx = await createScenario();
  const officer = await createUser("loan_officer");
  const r = await apiRequest("POST", `/conditions/${ctx.conditionIds[0]}/respond`, officer.sessionToken, {
    responseText: "officer probeert prospect-rol",
  });
  assert.equal(r.status, 403);
});

// ---------------------------------------------------------------------------
// Loan officer resolve endpoint
// ---------------------------------------------------------------------------

test("loan officer can mark a submitted condition as resolved", async () => {
  const ctx = await createScenario();
  await apiRequest("POST", `/conditions/${ctx.conditionIds[0]}/respond`, ctx.prospectSession, {
    responseText: "akkoord",
  });
  const officer = await createUser("loan_officer");
  const r = await apiRequest("POST", `/conditions/${ctx.conditionIds[0]}/resolve`, officer.sessionToken, {});
  assert.equal(r.status, 200);
  const body = asRecord(r.json);
  assert.equal(body.status, "resolved");

  const [row] = await db
    .select()
    .from(conditionsTable)
    .where(eq(conditionsTable.id, ctx.conditionIds[0]));
  assert.equal(row.status, "resolved");
  assert.ok(row.resolvedAt instanceof Date);
  assert.equal(row.resolvedBy, officer.userId);
});

test("prospect cannot call the resolve endpoint", async () => {
  const ctx = await createScenario();
  await apiRequest("POST", `/conditions/${ctx.conditionIds[0]}/respond`, ctx.prospectSession, {
    responseText: "akkoord",
  });
  const r = await apiRequest("POST", `/conditions/${ctx.conditionIds[0]}/resolve`, ctx.prospectSession, {});
  assert.equal(r.status, 403);
});

// ---------------------------------------------------------------------------
// Return-to-review endpoint
// ---------------------------------------------------------------------------

test("officer can return dossier to review only when ALL blocking conditions resolved", async () => {
  const ctx = await createScenario({
    conditionTitles: ["item A", "item B"],
  });
  const officer = await createUser("loan_officer");

  // Try too early — none resolved.
  let r = await apiRequest("POST", `/dossiers/${ctx.dossierId}/return-to-review`, officer.sessionToken);
  assert.equal(r.status, 409);

  // Resolve only first → still blocked.
  await apiRequest("POST", `/conditions/${ctx.conditionIds[0]}/respond`, ctx.prospectSession, {
    responseText: "ok",
  });
  await apiRequest("POST", `/conditions/${ctx.conditionIds[0]}/resolve`, officer.sessionToken, {});
  r = await apiRequest("POST", `/dossiers/${ctx.dossierId}/return-to-review`, officer.sessionToken);
  assert.equal(r.status, 409);

  // Resolve second → now allowed.
  await apiRequest("POST", `/conditions/${ctx.conditionIds[1]}/respond`, ctx.prospectSession, {
    responseText: "ok",
  });
  await apiRequest("POST", `/conditions/${ctx.conditionIds[1]}/resolve`, officer.sessionToken, {});
  r = await apiRequest("POST", `/dossiers/${ctx.dossierId}/return-to-review`, officer.sessionToken);
  assert.equal(r.status, 200);
  const body = asRecord(r.json);
  assert.equal(body.status, "loan_officer_review");

  const [updated] = await db
    .select()
    .from(dossiersTable)
    .where(eq(dossiersTable.id, ctx.dossierId));
  assert.equal(updated.status, "loan_officer_review");

  const logs = await db
    .select()
    .from(activityLogsTable)
    .where(eq(activityLogsTable.dossierId, ctx.dossierId));
  assert.ok(logs.some((l) => l.action === "returned_to_review"));
});

test("return-to-review refuses dossiers not in additional_info_requested", async () => {
  const ctx = await createScenario({ status: "loan_officer_review" });
  const officer = await createUser("loan_officer");
  const r = await apiRequest("POST", `/dossiers/${ctx.dossierId}/return-to-review`, officer.sessionToken);
  assert.equal(r.status, 409);
});

test("prospect cannot call return-to-review", async () => {
  const ctx = await createScenario();
  const r = await apiRequest("POST", `/dossiers/${ctx.dossierId}/return-to-review`, ctx.prospectSession);
  assert.equal(r.status, 403);
});

// ---------------------------------------------------------------------------
// Information leakage guards
// ---------------------------------------------------------------------------

test("GET /my/conditions never exposes reviewerNotes to the prospect", async () => {
  const ctx = await createScenario({
    reviewerNotes: "GEHEIM — INTERNE LO BESLISSING",
  });
  const r = await apiRequest("GET", `/dossiers/me/conditions`, ctx.prospectSession);
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.json));
  for (const c of r.json as Array<Record<string, unknown>>) {
    assert.equal(c.reviewerNotes, null, "prospect must never see reviewerNotes");
  }
});

test("late prospect respond cannot revert a resolved condition (race guard)", async () => {
  const ctx = await createScenario();
  const officer = await createUser("loan_officer");

  // Prospect responds, officer resolves.
  let r = await apiRequest("POST", `/conditions/${ctx.conditionIds[0]}/respond`, ctx.prospectSession, {
    responseText: "eerste reactie",
  });
  assert.equal(r.status, 200);
  r = await apiRequest("POST", `/conditions/${ctx.conditionIds[0]}/resolve`, officer.sessionToken, {});
  assert.equal(r.status, 200);

  // Late prospect respond attempt — must NOT regress status.
  r = await apiRequest("POST", `/conditions/${ctx.conditionIds[0]}/respond`, ctx.prospectSession, {
    responseText: "late reactie",
  });
  assert.equal(r.status, 409);

  const [row] = await db
    .select()
    .from(conditionsTable)
    .where(eq(conditionsTable.id, ctx.conditionIds[0]));
  assert.equal(row.status, "resolved", "resolved status must be preserved");
  assert.notEqual(row.responseText, "late reactie", "response must not be overwritten after resolve");
});

test("GET /conditions (officer view) DOES expose reviewerNotes", async () => {
  const ctx = await createScenario({
    reviewerNotes: "INTERN: dubbelchecken bij compliance",
  });
  const officer = await createUser("loan_officer");
  const r = await apiRequest("GET", `/dossiers/${ctx.dossierId}/conditions`, officer.sessionToken);
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.json));
  const list = r.json as Array<Record<string, unknown>>;
  assert.ok(list.length > 0);
  assert.equal(list[0].reviewerNotes, "INTERN: dubbelchecken bij compliance");
});
