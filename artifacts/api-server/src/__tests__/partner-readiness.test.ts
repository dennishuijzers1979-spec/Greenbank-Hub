/**
 * Partner-package readiness gating tests.
 *
 * Covers the rules enforced by `computePackageReadiness` plus the
 * memorandum/submission endpoints that consume it:
 *
 *  - GET /memorandum returns `ready: true` only when every readiness
 *    rule is satisfied; otherwise `draft: true` + Dutch
 *    `missingReadinessItems` checklist.
 *  - POST /submissions rejects (409 "Pakket niet compleet") when the
 *    package is not ready, with structured `missingItems`.
 *  - A ready dossier (memo + passing analysis + valid docs + no open
 *    blocking conditions) flows through mock-send successfully.
 *  - Re-running the memorandum on an incomplete dossier does NOT flip
 *    the dossier status to `memorandum_generated` — that label is
 *    reserved for ready packages.
 *  - Open blocking additional-info conditions break readiness.
 *  - Prospect callers still get 403 on memorandum + submissions.
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
      .delete(documentsTable)
      .where(inArray(documentsTable.dossierId, createdDossierIds));
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

async function createUser(
  role: Role,
): Promise<{ userId: string; sessionToken: string }> {
  const email = `ready-${randomUUID()}@example.com`;
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

async function createPartner(): Promise<string> {
  const [p] = await db
    .insert(partnerFinanciersTable)
    .values({
      name: `Partner ${randomUUID().slice(0, 8)}`,
      contactEmail: `partner-${randomUUID().slice(0, 8)}@example.com`,
      productFocus: "MKB werkkapitaal",
      minimumTicketSize: "10000",
      maximumTicketSize: "500000",
      activeStatus: "active",
    })
    .returning();
  createdPartnerIds.push(p.id);
  return p.id;
}

type ReadyOpts = {
  status?: string;
  withDocs?: boolean;
  withAnalysis?: boolean;
  withMemo?: boolean;
  blockingCondition?: boolean;
};

async function createDossier(opts: ReadyOpts): Promise<{
  userId: string;
  dossierId: string;
  prospectSession: string;
}> {
  const { userId, sessionToken } = await createUser("prospect");
  const [prospect] = await db
    .insert(prospectProfilesTable)
    .values({
      userId,
      companyName: `Aurora Test ${randomUUID().slice(0, 8)}`,
      contactName: "Test Persoon",
      kvkNumber: "11223344",
      phone: "+31 6 0000 0000",
    })
    .returning();
  const [dossier] = await db
    .insert(dossiersTable)
    .values({
      prospectId: prospect.id,
      status: opts.status ?? "approved_for_partner_submission",
      requestedAmount: "140000",
      financingPurpose: "Uitbreiding bakkerij",
      financingTypePreference: "Investeringslening",
      annualRevenue: "820000",
      annualCost: "640000",
      annualProfit: "180000",
      companyDescription: "Ambachtelijke bakkerij.",
      completenessScore: 88,
      correctnessScore: 86,
      viabilityScore: 82,
      confidenceScore: 84,
      aiVerdict: "kansrijk",
    })
    .returning();
  createdDossierIds.push(dossier.id);

  if (opts.withDocs) {
    for (const t of [
      "annual_accounts",
      "bank_statements",
      "kvk_extract",
      "id_document",
    ]) {
      await db.insert(documentsTable).values({
        dossierId: dossier.id,
        uploadedBy: userId,
        documentType: t,
        filename: `${t}.pdf`,
        mimeType: "application/pdf",
        sizeBytes: 100000,
        storagePath: `mock://${dossier.id}/${t}.pdf`,
        uploadStatus: "uploaded",
        validationStatus: "valid",
        extractedDataStatus: "extracted",
        usedInAnalysis: true,
      });
    }
  }

  if (opts.withAnalysis) {
    await db.insert(aiAnalysisRunsTable).values({
      dossierId: dossier.id,
      runType: "full_analysis",
      status: "completed",
      completedAt: new Date(),
      completenessScore: 88,
      correctnessScore: 86,
      viabilityScore: 82,
      confidenceScore: 84,
      verdict: "kansrijk",
      verdictSummary: "Stevig dossier.",
      entrepreneurReport: {
        summary: "Sterk dossier",
        strongPoints: ["Groei", "Marge"],
        weakPoints: [],
        canSubmit: true,
      },
      financierReport: {
        summary: "Akkoord",
        repaymentCapacity: "DSCR > 1.5",
        riskFactors: ["Personeelskosten"],
        strengths: ["Stabiele klantenbasis"],
      },
      usedMockMode: true,
    });
  }

  if (opts.withMemo) {
    const completedAt = new Date(Date.now() + 1000);
    await db.insert(aiAnalysisRunsTable).values({
      dossierId: dossier.id,
      runType: "memorandum",
      status: "completed",
      completedAt,
      usedMockMode: true,
      memorandum: {
        usedMockMode: true,
        verdict: "kansrijk",
        sections: [
          { title: "1. Samenvatting", body: "Sterk dossier voor uitbreiding." },
          { title: "2. Onderneming en activiteit", body: "Ambachtelijke bakkerij." },
          { title: "3. Financieringsvraag", body: "Bedrag: €140.000" },
          { title: "4. Doel", body: "Tweede oven." },
          { title: "5. Kerncijfers", body: "Omzet 820k, winst 180k." },
          { title: "6. Aflossingscapaciteit", body: "DSCR > 1.5" },
        ],
        attachments: [],
        partnerNotes: null,
        partnerPackages: [],
        evidenceGaps: [],
      },
    });
  }

  if (opts.blockingCondition) {
    await db.insert(conditionsTable).values({
      dossierId: dossier.id,
      type: "blocking",
      title: "Aanvullende info",
      description: "Upload bankafschriften.",
      requiredAction: "Upload PDF",
      status: "open",
    });
  }

  return { userId, dossierId: dossier.id, prospectSession: sessionToken };
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

test("ready dossier returns ready=true and empty missingReadinessItems", async () => {
  const officer = await createUser("loan_officer");
  const { dossierId } = await createDossier({
    withDocs: true,
    withAnalysis: true,
    withMemo: true,
  });
  const res = await apiGet(
    `/dossiers/${dossierId}/memorandum`,
    officer.sessionToken,
  );
  assert.equal(res.status, 200);
  const body = asRecord(res.json);
  assert.equal(body.ready, true, JSON.stringify(body.missingReadinessItems));
  assert.equal(body.draft, false);
  assert.deepEqual(body.missingReadinessItems, []);
});

test("incomplete dossier (no analysis, no docs) returns draft + checklist", async () => {
  const officer = await createUser("loan_officer");
  const { dossierId } = await createDossier({
    withDocs: false,
    withAnalysis: false,
    withMemo: true,
  });
  const res = await apiGet(
    `/dossiers/${dossierId}/memorandum`,
    officer.sessionToken,
  );
  assert.equal(res.status, 200);
  const body = asRecord(res.json);
  assert.equal(body.ready, false);
  assert.equal(body.draft, true);
  const items = body.missingReadinessItems as string[];
  assert.ok(Array.isArray(items) && items.length > 0);
  assert.ok(items.some((s) => /AI-analyse/.test(s)));
  assert.ok(items.some((s) => /documenten/i.test(s)));
});

test("open blocking condition breaks readiness", async () => {
  const officer = await createUser("loan_officer");
  const { dossierId } = await createDossier({
    withDocs: true,
    withAnalysis: true,
    withMemo: true,
    blockingCondition: true,
  });
  const res = await apiGet(
    `/dossiers/${dossierId}/memorandum`,
    officer.sessionToken,
  );
  const body = asRecord(res.json);
  assert.equal(body.ready, false);
  const items = body.missingReadinessItems as string[];
  assert.ok(items.some((s) => /blokkerende voorwaarde/i.test(s)));
});

test("POST /submissions rejects non-ready package with 409 + missingItems", async () => {
  const officer = await createUser("loan_officer");
  const partnerId = await createPartner();
  const { dossierId } = await createDossier({
    withDocs: false,
    withAnalysis: false,
    withMemo: true,
  });
  const res = await apiPost(
    `/dossiers/${dossierId}/submissions`,
    officer.sessionToken,
    { partnerIds: [partnerId] },
  );
  assert.equal(res.status, 409);
  const body = asRecord(res.json);
  assert.equal(body.error, "Pakket niet compleet");
  const items = body.missingItems as string[];
  assert.ok(Array.isArray(items) && items.length > 0);
});

test("POST /submissions rejects when memorandum is missing entirely", async () => {
  const officer = await createUser("loan_officer");
  const partnerId = await createPartner();
  const { dossierId } = await createDossier({
    withDocs: true,
    withAnalysis: true,
    withMemo: false,
  });
  const res = await apiPost(
    `/dossiers/${dossierId}/submissions`,
    officer.sessionToken,
    { partnerIds: [partnerId] },
  );
  assert.equal(res.status, 409);
  const body = asRecord(res.json);
  assert.equal(body.error, "Geen kredietmemorandum");
  assert.ok(Array.isArray(body.missingItems));
});

test("ready dossier reaches mock-send (201)", async () => {
  const officer = await createUser("loan_officer");
  const partnerId = await createPartner();
  const { dossierId } = await createDossier({
    withDocs: true,
    withAnalysis: true,
    withMemo: true,
  });
  const res = await apiPost(
    `/dossiers/${dossierId}/submissions`,
    officer.sessionToken,
    { partnerIds: [partnerId] },
  );
  assert.equal(res.status, 200, JSON.stringify(res.json));
  assert.ok(Array.isArray(res.json));
  assert.equal((res.json as unknown[]).length, 1);
});

test("regenerating memorandum on incomplete dossier keeps status at approved_for_partner_submission (not memorandum_generated)", async () => {
  const officer = await createUser("loan_officer");
  const { dossierId } = await createDossier({
    status: "approved_for_partner_submission",
    withDocs: false,
    withAnalysis: false,
    withMemo: false,
  });
  const res = await apiPost(
    `/dossiers/${dossierId}/memorandum`,
    officer.sessionToken,
    {},
  );
  assert.equal(res.status, 200);
  const body = asRecord(res.json);
  assert.equal(body.ready, false, "draft memorandum must not be marked ready");
  assert.equal(body.draft, true);
  const [row] = await db
    .select()
    .from(dossiersTable)
    .where(eq(dossiersTable.id, dossierId));
  assert.equal(
    row.status,
    "approved_for_partner_submission",
    "draft memo must not advance status to memorandum_generated",
  );
});

test("regenerating memorandum on ready dossier advances status to memorandum_generated", async () => {
  const officer = await createUser("loan_officer");
  const { dossierId } = await createDossier({
    status: "approved_for_partner_submission",
    withDocs: true,
    withAnalysis: true,
    withMemo: false,
  });
  const res = await apiPost(
    `/dossiers/${dossierId}/memorandum`,
    officer.sessionToken,
    {},
  );
  assert.equal(res.status, 200);
  const body = asRecord(res.json);
  assert.equal(body.ready, true, JSON.stringify(body.missingReadinessItems));
  const [row] = await db
    .select()
    .from(dossiersTable)
    .where(eq(dossiersTable.id, dossierId));
  assert.equal(row.status, "memorandum_generated");
});

test("prospect cannot access memorandum endpoint", async () => {
  const { prospectSession, dossierId } = await createDossier({
    withDocs: true,
    withAnalysis: true,
    withMemo: true,
  });
  const res = await apiGet(
    `/dossiers/${dossierId}/memorandum`,
    prospectSession,
  );
  assert.ok(
    res.status === 403 || res.status === 401,
    `expected 401/403, got ${res.status}`,
  );
});

test("prospect cannot create partner submissions", async () => {
  const partnerId = await createPartner();
  const { prospectSession, dossierId } = await createDossier({
    withDocs: true,
    withAnalysis: true,
    withMemo: true,
  });
  const res = await apiPost(
    `/dossiers/${dossierId}/submissions`,
    prospectSession,
    { partnerIds: [partnerId] },
  );
  assert.ok(
    res.status === 403 || res.status === 401,
    `expected 401/403, got ${res.status}`,
  );
});
