/**
 * Tests for AI skill invocation observability:
 *  - Central runtime resolves provider, mock fallback, missing env.
 *  - Each skill adapter emits a structured invocation record.
 *  - Orchestrator persists invocations to the AIAnalysisRun row.
 *  - GET /dossiers/:id/latest-run returns invocations to officers
 *    without leaking secrets.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomBytes, randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
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
  resolveSkillRuntime,
  describeAiRuntime,
} from "../lib/skills/runtime";
import {
  CreditProductAdvisorAdapter,
  FinancingNeedAssessorAdapter,
  FinancingProductAdvisorDualViewAdapter,
  GeenbankKredietworkflowAdapter,
  MoneycareKredietmemorandumAdapter,
} from "../lib/skills";
import { SKILL_MODULES } from "../lib/skills/types";
import { skillOrchestrationService } from "../lib/skill-orchestration";
import {
  setOpenAIChatClientForTesting,
  type OpenAIChatClient,
  type OpenAIChatResponse,
} from "../lib/skills/openai-client";
import {
  validateGeenbankKredietworkflowJson,
  GEENBANK_KREDIETWORKFLOW_VERDICTS,
  type GeenbankKredietworkflowSkillResponse,
} from "../lib/skills/geenbank-kredietworkflow-schema";
import {
  KW_FINANCIER_JSON_SCHEMA,
  normalizeKredietworkflowFinancierPayload,
  validateGeenbankKredietworkflowFinancierJson,
  GEENBANK_KREDIETWORKFLOW_DECISIONS,
  GEENBANK_KREDIETWORKFLOW_FEASIBILITIES,
  type GeenbankKredietworkflowFinancierOutput,
} from "../lib/skills/geenbank-kredietworkflow-financier-schema";
import {
  buildOpenAIRequestBody,
  OpenAIHttpError,
} from "../lib/skills/openai-client";
import Ajv from "ajv";
import { mapKredietworkflowFinancierOutputToAppAnalysis } from "../lib/skills/geenbank-kredietworkflow-financier-mapper";

const DUAL_PROVIDER_ENV = "AI_SKILL_FINANCINGPRODUCTADVISORDUALVIEW_PROVIDER";
const KW_PROVIDER_ENV = "AI_SKILL_GEENBANKKREDIETWORKFLOW_PROVIDER";

function withKwEnv<T>(
  env: Record<string, string | undefined>,
  fn: () => Promise<T> | T,
): Promise<T> {
  const keys = [
    KW_PROVIDER_ENV,
    "OPENAI_API_KEY",
    "OPENAI_MODEL",
    "AI_SKILL_PROVIDER",
    "AI_SKILL_GEENBANKKREDIETWORKFLOW_MODEL",
    "KW_USE_STRUCTURED_OUTPUTS",
  ];
  const saved: Record<string, string | undefined> = {};
  for (const k of keys) saved[k] = process.env[k];
  for (const k of keys) {
    const v = env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    });
}

function withDualEnv<T>(
  env: Record<string, string | undefined>,
  fn: () => Promise<T> | T,
): Promise<T> {
  const keys = [
    DUAL_PROVIDER_ENV,
    "OPENAI_API_KEY",
    "OPENAI_MODEL",
    "AI_SKILL_PROVIDER",
    "AI_SKILL_FINANCINGPRODUCTADVISORDUALVIEW_MODEL",
  ];
  const saved: Record<string, string | undefined> = {};
  for (const k of keys) saved[k] = process.env[k];
  for (const k of keys) {
    const v = env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    });
}

function makeFakeOpenAI(
  responder: (req: unknown) => OpenAIChatResponse | Promise<OpenAIChatResponse>,
): OpenAIChatClient {
  return {
    async chat(req) {
      return responder(req);
    },
  };
}

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
    await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
  }
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
  await pool.end();
});

async function createUser(role: "prospect" | "loan_officer" | "admin") {
  const [user] = await db
    .insert(usersTable)
    .values({
      email: `test-${randomUUID()}@example.com`,
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

async function createDossier(status = "submitted_to_geenbank") {
  const { userId } = await createUser("prospect");
  const [prospect] = await db
    .insert(prospectProfilesTable)
    .values({
      userId,
      companyName: `Test BV ${randomUUID().slice(0, 8)}`,
      contactName: "Test",
    })
    .returning();
  const [dossier] = await db
    .insert(dossiersTable)
    .values({
      prospectId: prospect.id,
      status,
      annualRevenue: "500000",
      annualCost: "400000",
      annualProfit: "100000",
      requestedAmount: "200000",
      financingPurpose: "uitbreiding",
      financingTypePreference: "lening",
      companyDescription: "Test bedrijf voor regressie van AI observability.",
    })
    .returning();
  createdDossierIds.push(dossier.id);
  return { dossierId: dossier.id, prospectId: prospect.id, userId };
}

function ctxFor(
  dossier: typeof dossiersTable.$inferSelect,
  overrides: { companyName?: string; borrowerName?: string | null } = {},
) {
  const companyName = overrides.companyName ?? "Test BV";
  const borrowerName =
    overrides.borrowerName === undefined
      ? companyName === "Onbekend"
        ? null
        : companyName
      : overrides.borrowerName;
  return { dossier, documents: [], companyName, borrowerName };
}

// --- Runtime resolver -------------------------------------------------------

test("runtime resolver defaults to mock when no provider env is set", () => {
  const original = {
    AI_SKILL_PROVIDER: process.env.AI_SKILL_PROVIDER,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    AI_API_KEY: process.env.AI_API_KEY,
    AI_SKILL_ENDPOINT: process.env.AI_SKILL_ENDPOINT,
  };
  delete process.env.AI_SKILL_PROVIDER;
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.AI_API_KEY;
  delete process.env.AI_SKILL_ENDPOINT;
  try {
    const cfg = resolveSkillRuntime("CreditProductAdvisor");
    assert.equal(cfg.provider, "mock");
    assert.equal(cfg.usedMockMode, true);
    assert.equal(cfg.fallbackReason, null);
  } finally {
    for (const [k, v] of Object.entries(original)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test("runtime resolver falls back to mock when openai is requested without key", () => {
  const originals = {
    AI_SKILL_PROVIDER: process.env.AI_SKILL_PROVIDER,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  };
  process.env.AI_SKILL_PROVIDER = "openai";
  delete process.env.OPENAI_API_KEY;
  try {
    const cfg = resolveSkillRuntime("FinancingNeedAssessor");
    assert.equal(cfg.provider, "mock");
    assert.equal(cfg.usedMockMode, true);
    assert.ok(cfg.fallbackReason && /OPENAI_API_KEY/.test(cfg.fallbackReason));
    assert.deepEqual(cfg.missingEnv, ["OPENAI_API_KEY"]);
  } finally {
    for (const [k, v] of Object.entries(originals)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test("OPENAI_API_KEY alone does NOT auto-promote skills to live (honesty rule)", () => {
  const originals = {
    AI_SKILL_PROVIDER: process.env.AI_SKILL_PROVIDER,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    AI_API_KEY: process.env.AI_API_KEY,
    AI_SKILL_ENDPOINT: process.env.AI_SKILL_ENDPOINT,
    [DUAL_PROVIDER_ENV]: process.env[DUAL_PROVIDER_ENV],
    [KW_PROVIDER_ENV]: process.env[KW_PROVIDER_ENV],
  };
  delete process.env.AI_SKILL_PROVIDER;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.AI_API_KEY;
  delete process.env.AI_SKILL_ENDPOINT;
  delete process.env[DUAL_PROVIDER_ENV];
  delete process.env[KW_PROVIDER_ENV];
  process.env.OPENAI_API_KEY = "sk-test-fake-1234567890";
  try {
    // Every skill — including the dual-view one without its per-skill
    // PROVIDER opt-in — must report mock honestly.
    for (const m of SKILL_MODULES) {
      const cfg = resolveSkillRuntime(m);
      assert.equal(cfg.provider, "mock", `${m} should default to mock`);
      assert.equal(cfg.usedMockMode, true, `${m} should be mock`);
      assert.equal(cfg.fallbackReason, null);
    }
    const status = describeAiRuntime(SKILL_MODULES);
    assert.equal(status.defaultProvider, "mock");
    assert.equal(status.liveSkills, 0);
    assert.equal(status.mockSkills, SKILL_MODULES.length);
  } finally {
    for (const [k, v] of Object.entries(originals)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test("only the per-skill PROVIDER override promotes a single skill to live (configured-provider parity)", () => {
  const originals = {
    AI_SKILL_PROVIDER: process.env.AI_SKILL_PROVIDER,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    [DUAL_PROVIDER_ENV]: process.env[DUAL_PROVIDER_ENV],
    [KW_PROVIDER_ENV]: process.env[KW_PROVIDER_ENV],
  };
  delete process.env.AI_SKILL_PROVIDER;
  delete process.env[KW_PROVIDER_ENV];
  process.env.OPENAI_API_KEY = "sk-test-fake-1234567890";
  process.env[DUAL_PROVIDER_ENV] = "openai";
  try {
    const dual = resolveSkillRuntime("FinancingProductAdvisorDualView");
    assert.equal(dual.provider, "openai");
    assert.equal(dual.usedMockMode, false);
    for (const m of SKILL_MODULES.filter(
      (x) => x !== "FinancingProductAdvisorDualView",
    )) {
      const cfg = resolveSkillRuntime(m);
      assert.equal(cfg.provider, "mock", `${m} must stay mock`);
      assert.equal(cfg.usedMockMode, true);
    }
  } finally {
    for (const [k, v] of Object.entries(originals)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test("describeAiRuntime returns one entry per known skill module", () => {
  const status = describeAiRuntime(SKILL_MODULES);
  assert.equal(status.totalSkills, SKILL_MODULES.length);
  assert.equal(status.perSkill.length, SKILL_MODULES.length);
  for (const s of status.perSkill) {
    assert.ok(SKILL_MODULES.includes(s.module));
    assert.ok(["mock", "openai", "http", "replit"].includes(s.provider));
  }
});

// --- Per-adapter invocation -------------------------------------------------

test("every skill adapter emits a structured invocation record", async () => {
  const { dossierId } = await createDossier();
  const [dossier] = await db
    .select()
    .from(dossiersTable)
    .where(inArray(dossiersTable.id, [dossierId]));
  const ctx = ctxFor(dossier);

  const need = await FinancingNeedAssessorAdapter.run(ctx);
  const credit = await CreditProductAdvisorAdapter.run(ctx);
  const dual = await FinancingProductAdvisorDualViewAdapter.run(ctx);
  const flow = await GeenbankKredietworkflowAdapter.run({
    ctx,
    completenessScore: need.data.completenessScore,
    correctnessScore: credit.data.correctnessScore,
    viabilityScore: dual.data.viabilityScore,
    completedDocs: need.data.completedDocs,
    requiredDocs: need.data.requiredDocs,
    margin: dual.data.margin,
    dscr: dual.data.dscr,
    revenue: dual.data.revenue,
    profit: dual.data.profit,
    requested: dual.data.requested,
  });
  const fin = await MoneycareKredietmemorandumAdapter.buildFinancierReport({
    ctx,
    margin: dual.data.margin,
    dscr: dual.data.dscr,
    revenue: dual.data.revenue,
    profit: dual.data.profit,
    requested: dual.data.requested,
    verdict: flow.data.verdict,
    strongPoints: flow.data.strongPoints,
    weakPoints: flow.data.weakPoints,
  });

  for (const r of [need, credit, dual, flow, fin]) {
    assert.ok(r.invocation, `${r.module} missing invocation`);
    assert.equal(r.invocation.skillName, r.module);
    assert.ok(typeof r.invocation.durationMs === "number");
    assert.ok(r.invocation.startedAt);
    assert.ok(r.invocation.completedAt);
    assert.ok(["mock", "openai", "http", "replit"].includes(r.invocation.provider));
    assert.equal(r.invocation.usedMockMode, r.usedMockMode);
    assert.ok(r.invocation.outputSummary.length > 0);
  }
});

// --- Dual-view OpenAI pilot -------------------------------------------------

test("dual-view adapter stays on mock when no env vars are set", async () => {
  const { dossierId } = await createDossier();
  const [dossier] = await db
    .select()
    .from(dossiersTable)
    .where(inArray(dossiersTable.id, [dossierId]));
  await withDualEnv(
    { [DUAL_PROVIDER_ENV]: undefined, OPENAI_API_KEY: undefined },
    async () => {
      const r = await FinancingProductAdvisorDualViewAdapter.run(ctxFor(dossier));
      assert.equal(r.usedMockMode, true);
      assert.equal(r.invocation.usedMockMode, true);
      assert.equal(r.invocation.model, null);
      assert.equal(r.invocation.fallbackReason, null);
    },
  );
});

test("dual-view adapter falls back to mock when provider=openai but key is missing", async () => {
  const { dossierId } = await createDossier();
  const [dossier] = await db
    .select()
    .from(dossiersTable)
    .where(inArray(dossiersTable.id, [dossierId]));
  await withDualEnv(
    { [DUAL_PROVIDER_ENV]: "openai", OPENAI_API_KEY: undefined },
    async () => {
      const r = await FinancingProductAdvisorDualViewAdapter.run(ctxFor(dossier));
      assert.equal(r.usedMockMode, true);
      assert.equal(r.invocation.usedMockMode, true);
      assert.ok(
        r.invocation.fallbackReason &&
          /OPENAI_API_KEY/i.test(r.invocation.fallbackReason),
        `expected fallbackReason to mention OPENAI_API_KEY, got ${r.invocation.fallbackReason}`,
      );
    },
  );
});

test("dual-view adapter falls back to mock when OpenAI returns invalid JSON", async () => {
  const { dossierId } = await createDossier();
  const [dossier] = await db
    .select()
    .from(dossiersTable)
    .where(inArray(dossiersTable.id, [dossierId]));
  setOpenAIChatClientForTesting(
    makeFakeOpenAI(() => ({ content: "definitely not json", model: "fake-model" })),
  );
  try {
    await withDualEnv(
      { [DUAL_PROVIDER_ENV]: "openai", OPENAI_API_KEY: "sk-test-fake-1234567890" },
      async () => {
        const r = await FinancingProductAdvisorDualViewAdapter.run(ctxFor(dossier));
        assert.equal(r.usedMockMode, true);
        assert.equal(r.invocation.usedMockMode, true);
        assert.equal(r.invocation.provider, "openai");
        assert.ok(
          r.invocation.fallbackReason &&
            /JSON|ongeldig|mislukt/i.test(r.invocation.fallbackReason),
          `unexpected fallbackReason: ${r.invocation.fallbackReason}`,
        );
        // Mock viabilityScore for this dossier (margin=0.20 →+20, dscr=4.17 →+15) → 85.
        assert.equal(r.data.viabilityScore, 85);
      },
    );
  } finally {
    setOpenAIChatClientForTesting(null);
  }
});

test("dual-view adapter maps a valid OpenAI response onto viabilityScore", async () => {
  const { dossierId } = await createDossier();
  const [dossier] = await db
    .select()
    .from(dossiersTable)
    .where(inArray(dossiersTable.id, [dossierId]));
  const skillResponse = {
    entrepreneur_view: {
      summary: "Sterke casus.",
      strengths: ["Goede marge"],
      weaknesses: [],
      financeability_score: 8,
      submission_readiness_score: 7,
      cta_status: "ready_to_submit",
      todo_minimum: [],
      todo_optimal: [],
    },
    partner_view: {
      recommended_product: "business term loan",
      alternative_product: "revolving credit",
      recommended_product_mix: [],
      recommendation_status: "strong",
      rationale: ["Goede dekking"],
      key_risks: [],
      evidence_gaps: [],
      indicative_structure: {
        amount: 200000,
        tenor_months: 60,
        repayment_logic: "annuiteit",
        collateral_logic: "borgstelling",
        conditions: [],
      },
      shortlisted_products: [],
    },
  };
  setOpenAIChatClientForTesting(
    makeFakeOpenAI(() => ({
      content: JSON.stringify(skillResponse),
      model: "gpt-4o-mini",
    })),
  );
  try {
    await withDualEnv(
      { [DUAL_PROVIDER_ENV]: "openai", OPENAI_API_KEY: "sk-test-fake-1234567890" },
      async () => {
        const r = await FinancingProductAdvisorDualViewAdapter.run(ctxFor(dossier));
        assert.equal(r.ok, true);
        assert.equal(r.usedMockMode, false);
        assert.equal(r.invocation.usedMockMode, false);
        assert.equal(r.invocation.provider, "openai");
        assert.equal(r.invocation.model, "gpt-4o-mini");
        assert.equal(r.invocation.fallbackReason, null);
        // financeability_score=8 → viabilityScore=80.
        assert.equal(r.data.viabilityScore, 80);
        // Pass-through fields stay derived from dossier, not from the skill.
        assert.equal(r.data.revenue, 500000);
        assert.equal(r.data.profit, 100000);
        assert.equal(r.data.requested, 200000);
        // Rich payload preserved on extras for the AI uitvoeringsdetails panel.
        const extras = r.invocation.extras as { response?: typeof skillResponse } | null;
        assert.ok(extras && extras.response, "extras.response missing");
        assert.equal(extras!.response!.entrepreneur_view.cta_status, "ready_to_submit");
      },
    );
  } finally {
    setOpenAIChatClientForTesting(null);
  }
});

test("dual-view adapter never leaks OPENAI_API_KEY into the SkillInvocation", async () => {
  const { dossierId } = await createDossier();
  const [dossier] = await db
    .select()
    .from(dossiersTable)
    .where(inArray(dossiersTable.id, [dossierId]));
  const secretKey = "sk-test-secretvalue-shouldnotleak-7777777777";
  // Fake client that intentionally tries to smuggle the key through the
  // response body — we assert the adapter scrubs it out of `extras`.
  setOpenAIChatClientForTesting(
    makeFakeOpenAI(() => ({
      content: JSON.stringify({
        entrepreneur_view: {
          summary: `key=${secretKey}`,
          strengths: [],
          weaknesses: [],
          financeability_score: 5,
          submission_readiness_score: 5,
          cta_status: "ready_to_submit_with_evidence_boosters",
          todo_minimum: [],
          todo_optimal: [],
        },
        partner_view: {
          recommended_product: "",
          alternative_product: "",
          recommended_product_mix: [],
          recommendation_status: "provisional",
          rationale: [],
          key_risks: [],
          evidence_gaps: [],
          indicative_structure: {
            amount: null,
            tenor_months: null,
            repayment_logic: "",
            collateral_logic: "",
            conditions: [],
          },
          shortlisted_products: [],
        },
        api_key: secretKey,
        authorization: `Bearer ${secretKey}`,
      }),
      model: "gpt-4o-mini",
    })),
  );
  try {
    await withDualEnv(
      { [DUAL_PROVIDER_ENV]: "openai", OPENAI_API_KEY: secretKey },
      async () => {
        const r = await FinancingProductAdvisorDualViewAdapter.run(ctxFor(dossier));
        const serialized = JSON.stringify(r.invocation);
        assert.ok(!serialized.includes(secretKey), "raw secret key leaked");
        assert.ok(
          !/sk-test-secretvalue-shouldnotleak/.test(serialized),
          "raw secret prefix leaked",
        );
      },
    );
  } finally {
    setOpenAIChatClientForTesting(null);
  }
});

test("other adapters remain on mock when only the dual-view provider env is set", async () => {
  const { dossierId } = await createDossier();
  const [dossier] = await db
    .select()
    .from(dossiersTable)
    .where(inArray(dossiersTable.id, [dossierId]));
  // Even with OPENAI_API_KEY set, the other four adapters must never
  // hit the OpenAI client — only the dual-view adapter has a live path
  // wired, and it requires its per-skill PROVIDER env to be set.
  let openAiCalls = 0;
  setOpenAIChatClientForTesting(
    makeFakeOpenAI(() => {
      openAiCalls += 1;
      throw new Error("other adapters must not call OpenAI");
    }),
  );
  try {
    await withDualEnv(
      { [DUAL_PROVIDER_ENV]: undefined, OPENAI_API_KEY: "sk-test-fake-1234567890" },
      async () => {
        const ctx = ctxFor(dossier);
        const need = await FinancingNeedAssessorAdapter.run(ctx);
        const credit = await CreditProductAdvisorAdapter.run(ctx);
        const dual = await FinancingProductAdvisorDualViewAdapter.run(ctx);
        // Adapters returned without throwing → none of them invoked the
        // (throwing) fake OpenAI client.
        assert.equal(openAiCalls, 0, "no adapter should call OpenAI");
        assert.ok(need.ok && credit.ok && dual.ok);
        // The dual-view adapter, lacking its per-skill PROVIDER env,
        // also stays on mock and reports it honestly.
        assert.equal(dual.usedMockMode, true);
        assert.equal(dual.invocation.usedMockMode, true);
      },
    );
  } finally {
    setOpenAIChatClientForTesting(null);
  }
});

// --- Orchestrator persists invocations + officer endpoint exposes them ------

test("runPrevalidation persists skillInvocations and officer can read them", async () => {
  const { dossierId } = await createDossier("intake_in_progress");
  const { runId } = await skillOrchestrationService.runPrevalidation(dossierId);
  const [row] = await db
    .select()
    .from(aiAnalysisRunsTable)
    .where(inArray(aiAnalysisRunsTable.id, [runId]));
  const invocations = row.skillInvocations as Array<Record<string, unknown>>;
  assert.ok(Array.isArray(invocations));
  assert.equal(invocations.length, 5);
  for (const inv of invocations) {
    assert.ok(typeof inv.skillName === "string");
    assert.ok(typeof inv.provider === "string");
    assert.ok(typeof inv.durationMs === "number");
  }

  // Move dossier to officer-visible status so the officer endpoint accepts it.
  await db
    .update(dossiersTable)
    .set({ status: "submitted_to_geenbank" })
    .where(inArray(dossiersTable.id, [dossierId]));
  const officer = await createUser("loan_officer");
  const res = await fetch(`${baseUrl}/dossiers/${dossierId}/latest-run`, {
    headers: { Cookie: `geenbank_session=${officer.sessionToken}` },
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { skillInvocations: unknown[] };
  assert.ok(Array.isArray(body.skillInvocations));
  assert.equal(body.skillInvocations.length, 5);
  // Make sure secrets never appear in the serialized payload.
  const serialized = JSON.stringify(body);
  assert.ok(!/sk-[A-Za-z0-9]/.test(serialized), "openai key leaked");
  assert.ok(!/OPENAI_API_KEY=\S/.test(serialized), "raw env leaked");
});

// --- Dual-view advice extractor + officer endpoint --------------------------

import { extractDualViewAdvice } from "../lib/skills/dual-view-advice";

function makeDualRun(opts: {
  id?: string;
  invocations: Array<Record<string, unknown>>;
  completedAt?: Date;
}): {
  id: string;
  startedAt: Date;
  completedAt: Date;
  skillInvocations: Array<Record<string, unknown>>;
} {
  const now = opts.completedAt ?? new Date();
  return {
    id: opts.id ?? randomUUID(),
    startedAt: now,
    completedAt: now,
    skillInvocations: opts.invocations,
  };
}

const SAMPLE_PARTNER_VIEW = {
  recommended_product: "Kortlopende werkkapitaalfaciliteit",
  alternative_product: "Achtergestelde lening",
  recommended_product_mix: ["Werkkapitaal", "Borgstelling MKB"],
  recommendation_status: "strong",
  rationale: ["Marge boven 15%", "DSCR > 1.5"],
  key_risks: ["Concentratie afnemers"],
  evidence_gaps: ["Tussentijdse cijfers ontbreken"],
  indicative_structure: {
    amount: 200000,
    tenor_months: 60,
    repayment_logic: "annuïteit",
    collateral_logic: "borgstelling",
    conditions: ["Persoonlijke borg DGA"],
  },
  shortlisted_products: [
    {
      product_name: "Werkkapitaal",
      product_fit_score: 8,
      evidence_strength_score: 7,
      structurability_score: 8,
      notes: ["Snelle doorlooptijd"],
    },
  ],
};

const SAMPLE_ENTREPRENEUR_VIEW = {
  summary: "Sterke casus, klaar voor indienen.",
  financeability_score: 8,
  submission_readiness_score: 7,
  cta_status: "ready_to_submit",
};

test("extractDualViewAdvice maps a live OpenAI invocation onto a typed payload", () => {
  const run = makeDualRun({
    invocations: [
      {
        skillName: "FinancingProductAdvisorDualView",
        provider: "openai",
        usedMockMode: false,
        model: "gpt-4o-mini",
        durationMs: 1234,
        fallbackReason: null,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        extras: {
          response: {
            partner_view: SAMPLE_PARTNER_VIEW,
            entrepreneur_view: SAMPLE_ENTREPRENEUR_VIEW,
          },
        },
      },
    ],
  });
  const advice = extractDualViewAdvice("dossier-x", run);
  assert.ok(advice, "expected advice to be extracted");
  assert.equal(advice!.dossierId, "dossier-x");
  assert.equal(advice!.executionMode, "live_openai");
  assert.equal(advice!.provider, "openai");
  assert.equal(advice!.model, "gpt-4o-mini");
  assert.equal(advice!.partial, false);
  assert.equal(
    advice!.partnerView.recommended_product,
    "Kortlopende werkkapitaalfaciliteit",
  );
  assert.equal(advice!.partnerView.recommendation_status, "strong");
  assert.equal(advice!.partnerView.indicative_structure?.amount, 200000);
  assert.equal(advice!.partnerView.shortlisted_products?.length, 1);
  assert.equal(advice!.entrepreneurSummary?.cta_status, "ready_to_submit");
});

test("extractDualViewAdvice flags deterministic mock with a Dutch warning", () => {
  const run = makeDualRun({
    invocations: [
      {
        skillName: "FinancingProductAdvisorDualView",
        provider: "mock",
        usedMockMode: true,
        model: null,
        durationMs: 5,
        fallbackReason: null,
        extras: { response: { partner_view: SAMPLE_PARTNER_VIEW } },
      },
    ],
  });
  const advice = extractDualViewAdvice("d1", run);
  assert.ok(advice);
  assert.equal(advice!.executionMode, "deterministic_mock");
  assert.equal(advice!.model, null);
  assert.ok(
    advice!.warnings.some((w) => /mock/i.test(w)),
    "expected a mock warning",
  );
});

test("extractDualViewAdvice classifies fallback_mock when the live attempt failed", () => {
  const run = makeDualRun({
    invocations: [
      {
        skillName: "FinancingProductAdvisorDualView",
        provider: "openai",
        usedMockMode: true,
        model: null,
        durationMs: 12,
        fallbackReason: "OpenAI gaf ongeldige JSON",
        extras: { response: { partner_view: SAMPLE_PARTNER_VIEW } },
      },
    ],
  });
  const advice = extractDualViewAdvice("d2", run);
  assert.ok(advice);
  assert.equal(advice!.executionMode, "fallback_mock");
  assert.equal(advice!.fallbackReason, "OpenAI gaf ongeldige JSON");
});

test("extractDualViewAdvice returns null when the dual-view invocation is missing", () => {
  const run = makeDualRun({
    invocations: [
      { skillName: "CreditProductAdvisor", provider: "mock", usedMockMode: true },
    ],
  });
  assert.equal(extractDualViewAdvice("d3", run), null);
});

test("extractDualViewAdvice marks runs without extras.response as partial", () => {
  const run = makeDualRun({
    invocations: [
      {
        skillName: "FinancingProductAdvisorDualView",
        provider: "mock",
        usedMockMode: true,
        extras: null,
      },
    ],
  });
  const advice = extractDualViewAdvice("d4", run);
  assert.ok(advice);
  assert.equal(advice!.partial, true);
  assert.ok(advice!.warnings.some((w) => /skill-antwoord/i.test(w)));
});

test("extractDualViewAdvice scrubs strings that look like API keys or bearer tokens", () => {
  const secret = "sk-test-secretvalue-shouldnotleak-7777777777";
  const run = makeDualRun({
    invocations: [
      {
        skillName: "FinancingProductAdvisorDualView",
        provider: "openai",
        usedMockMode: false,
        model: `model-${secret}`,
        fallbackReason: `Bearer ${secret}`,
        extras: {
          response: {
            partner_view: {
              ...SAMPLE_PARTNER_VIEW,
              recommended_product: secret,
              rationale: [`leaked ${secret}`, "Marge ok"],
            },
          },
        },
      },
    ],
  });
  const advice = extractDualViewAdvice("d5", run);
  assert.ok(advice);
  const serialized = JSON.stringify(advice);
  assert.ok(!serialized.includes(secret), "raw secret leaked through extractor");
  assert.equal(advice!.model, null);
  assert.equal(advice!.fallbackReason, null);
  assert.equal(advice!.partnerView.recommended_product, null);
  assert.deepEqual(advice!.partnerView.rationale, ["Marge ok"]);
});

test("GET /dossiers/:id/dual-view-advice returns typed advice for officers", async () => {
  const { dossierId } = await createDossier("submitted_to_geenbank");
  const completedAt = new Date();
  await db.insert(aiAnalysisRunsTable).values({
    dossierId,
    runType: "prevalidation",
    status: "completed",
    startedAt: completedAt,
    completedAt,
    usedMockMode: false,
    skillInvocations: [
      {
        skillName: "FinancingProductAdvisorDualView",
        provider: "openai",
        usedMockMode: false,
        model: "gpt-4o-mini",
        durationMs: 999,
        fallbackReason: null,
        startedAt: completedAt.toISOString(),
        completedAt: completedAt.toISOString(),
        extras: {
          response: {
            partner_view: SAMPLE_PARTNER_VIEW,
            entrepreneur_view: SAMPLE_ENTREPRENEUR_VIEW,
          },
        },
      },
    ],
  });
  const officer = await createUser("loan_officer");
  const res = await fetch(`${baseUrl}/dossiers/${dossierId}/dual-view-advice`, {
    headers: { Cookie: `geenbank_session=${officer.sessionToken}` },
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    executionMode: string;
    partnerView: { recommended_product: string; recommendation_status: string };
    entrepreneurSummary: { cta_status: string } | null;
  };
  assert.equal(body.executionMode, "live_openai");
  assert.equal(
    body.partnerView.recommended_product,
    "Kortlopende werkkapitaalfaciliteit",
  );
  assert.equal(body.partnerView.recommendation_status, "strong");
  assert.equal(body.entrepreneurSummary?.cta_status, "ready_to_submit");
});

test("GET /dossiers/:id/dual-view-advice returns 404 when no run exists", async () => {
  const { dossierId } = await createDossier("submitted_to_geenbank");
  const officer = await createUser("loan_officer");
  const res = await fetch(`${baseUrl}/dossiers/${dossierId}/dual-view-advice`, {
    headers: { Cookie: `geenbank_session=${officer.sessionToken}` },
  });
  assert.equal(res.status, 404);
});

test("GET /dossiers/:id/dual-view-advice returns 404 when extras.response is missing dual view", async () => {
  const { dossierId } = await createDossier("submitted_to_geenbank");
  const completedAt = new Date();
  await db.insert(aiAnalysisRunsTable).values({
    dossierId,
    runType: "prevalidation",
    status: "completed",
    startedAt: completedAt,
    completedAt,
    usedMockMode: true,
    skillInvocations: [
      {
        skillName: "CreditProductAdvisor",
        provider: "mock",
        usedMockMode: true,
        durationMs: 4,
      },
    ],
  });
  const officer = await createUser("loan_officer");
  const res = await fetch(`${baseUrl}/dossiers/${dossierId}/dual-view-advice`, {
    headers: { Cookie: `geenbank_session=${officer.sessionToken}` },
  });
  assert.equal(res.status, 404);
});

test("GET /dossiers/:id/dual-view-advice rejects prospects (RBAC)", async () => {
  const { dossierId } = await createDossier("submitted_to_geenbank");
  const prospect = await createUser("prospect");
  const res = await fetch(`${baseUrl}/dossiers/${dossierId}/dual-view-advice`, {
    headers: { Cookie: `geenbank_session=${prospect.sessionToken}` },
  });
  assert.ok(
    res.status === 401 || res.status === 403,
    `expected 401 or 403, got ${res.status}`,
  );
});

test("GET /dossiers/:id/dual-view-advice does not leak secrets in the response", async () => {
  const { dossierId } = await createDossier("submitted_to_geenbank");
  const secret = "sk-test-leak-9999999999";
  const completedAt = new Date();
  await db.insert(aiAnalysisRunsTable).values({
    dossierId,
    runType: "prevalidation",
    status: "completed",
    startedAt: completedAt,
    completedAt,
    usedMockMode: false,
    skillInvocations: [
      {
        skillName: "FinancingProductAdvisorDualView",
        provider: "openai",
        usedMockMode: false,
        model: `model-${secret}`,
        durationMs: 1,
        fallbackReason: `Bearer ${secret}`,
        extras: {
          response: {
            partner_view: {
              ...SAMPLE_PARTNER_VIEW,
              rationale: [`leaked ${secret}`],
            },
          },
        },
      },
    ],
  });
  const officer = await createUser("loan_officer");
  const res = await fetch(`${baseUrl}/dossiers/${dossierId}/dual-view-advice`, {
    headers: { Cookie: `geenbank_session=${officer.sessionToken}` },
  });
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.ok(!text.includes(secret), "raw secret leaked through endpoint");
});

test("GET /dossiers/:id/dual-view-advice falls back to an earlier analysis run when the latest run is a memorandum", async () => {
  const { dossierId } = await createDossier("submitted_to_geenbank");
  const earlier = new Date(Date.now() - 60_000);
  const later = new Date();
  // Earlier analysis run with a live dual-view invocation.
  await db.insert(aiAnalysisRunsTable).values({
    dossierId,
    runType: "prevalidation",
    status: "completed",
    startedAt: earlier,
    completedAt: earlier,
    usedMockMode: false,
    skillInvocations: [
      {
        skillName: "FinancingProductAdvisorDualView",
        provider: "openai",
        usedMockMode: false,
        model: "gpt-4o-mini",
        durationMs: 100,
        fallbackReason: null,
        startedAt: earlier.toISOString(),
        completedAt: earlier.toISOString(),
        extras: {
          response: {
            partner_view: SAMPLE_PARTNER_VIEW,
            entrepreneur_view: SAMPLE_ENTREPRENEUR_VIEW,
          },
        },
      },
    ],
  });
  // Newer memorandum run that does NOT contain a dual-view invocation.
  await db.insert(aiAnalysisRunsTable).values({
    dossierId,
    runType: "memorandum",
    status: "completed",
    startedAt: later,
    completedAt: later,
    usedMockMode: true,
    skillInvocations: [
      {
        skillName: "MoneycareKredietmemorandum",
        provider: "mock",
        usedMockMode: true,
        durationMs: 5,
      },
    ],
    memorandum: { sections: [], attachments: [], partnerNotes: null },
  });
  const officer = await createUser("loan_officer");
  const res = await fetch(`${baseUrl}/dossiers/${dossierId}/dual-view-advice`, {
    headers: { Cookie: `geenbank_session=${officer.sessionToken}` },
  });
  assert.equal(res.status, 200, "should fall back to the earlier analysis run");
  const body = (await res.json()) as {
    partnerView: { recommended_product: string };
    executionMode: string;
  };
  assert.equal(body.executionMode, "live_openai");
  assert.equal(
    body.partnerView.recommended_product,
    "Kortlopende werkkapitaalfaciliteit",
  );
});

// --- GeenbankKredietworkflow forward-only schema validator -----------------

const SAMPLE_KREDIETWORKFLOW_RESPONSE: GeenbankKredietworkflowSkillResponse = {
  confidenceScore: 72,
  verdict: "voorwaardelijk",
  verdictSummary:
    "Test BV laat potentie zien maar er zijn nog enkele aandachtspunten.",
  entrepreneurReport: {
    headline: "Je bent dichtbij — een paar aanvullingen maken het verschil.",
    summary: "Test BV laat potentie zien maar er zijn nog aandachtspunten.",
    strongPoints: ["Gezonde marge van 20% op de omzet."],
    weakPoints: ["Cashflow-prognose ontbreekt nog."],
    actionPoints: ["Upload de cashflow-prognose voor de komende 12 maanden."],
    likelyFinancierAsks: ["Toelichting op de financieringsbehoefte"],
    canSubmit: false,
  },
  strongPoints: ["Gezonde marge van 20% op de omzet."],
  weakPoints: ["Cashflow-prognose ontbreekt nog."],
};

test("validateGeenbankKredietworkflowJson accepts a valid sample response", () => {
  assert.equal(
    validateGeenbankKredietworkflowJson(SAMPLE_KREDIETWORKFLOW_RESPONSE),
    null,
  );
});

test("validateGeenbankKredietworkflowJson rejects an out-of-range confidenceScore", () => {
  const bad = { ...SAMPLE_KREDIETWORKFLOW_RESPONSE, confidenceScore: 150 };
  const problem = validateGeenbankKredietworkflowJson(bad);
  assert.ok(problem && /confidenceScore/i.test(problem));
});

test("validateGeenbankKredietworkflowJson rejects a non-numeric confidenceScore", () => {
  const bad = { ...SAMPLE_KREDIETWORKFLOW_RESPONSE, confidenceScore: "high" };
  const problem = validateGeenbankKredietworkflowJson(bad);
  assert.ok(problem && /confidenceScore/i.test(problem));
});

test("validateGeenbankKredietworkflowJson rejects an unknown verdict", () => {
  const bad = { ...SAMPLE_KREDIETWORKFLOW_RESPONSE, verdict: "approved" };
  const problem = validateGeenbankKredietworkflowJson(bad);
  assert.ok(problem && /verdict/i.test(problem));
});

test("validateGeenbankKredietworkflowJson rejects a missing entrepreneurReport", () => {
  const { entrepreneurReport: _omit, ...rest } = SAMPLE_KREDIETWORKFLOW_RESPONSE;
  const problem = validateGeenbankKredietworkflowJson(rest);
  assert.ok(problem && /entrepreneurReport/i.test(problem));
});

test("validateGeenbankKredietworkflowJson rejects a non-boolean canSubmit", () => {
  const bad = {
    ...SAMPLE_KREDIETWORKFLOW_RESPONSE,
    entrepreneurReport: {
      ...SAMPLE_KREDIETWORKFLOW_RESPONSE.entrepreneurReport,
      canSubmit: "yes" as unknown as boolean,
    },
  };
  const problem = validateGeenbankKredietworkflowJson(bad);
  assert.ok(problem && /canSubmit/i.test(problem));
});

test("validateGeenbankKredietworkflowJson rejects non-array strongPoints", () => {
  const bad = { ...SAMPLE_KREDIETWORKFLOW_RESPONSE, strongPoints: "ok" };
  const problem = validateGeenbankKredietworkflowJson(bad);
  assert.ok(problem && /strongPoints/i.test(problem));
});

test("validateGeenbankKredietworkflowJson rejects non-object input", () => {
  assert.ok(validateGeenbankKredietworkflowJson(null));
  assert.ok(validateGeenbankKredietworkflowJson("nope"));
});

test("verdict enum stays in sync with the SKILL.md contract", () => {
  assert.deepEqual(
    [...GEENBANK_KREDIETWORKFLOW_VERDICTS].sort(),
    ["kansrijk", "uitdagend", "voorwaardelijk"],
  );
});

test("GeenbankKredietworkflow deterministic mock output passes the forward-only schema validator", async () => {
  // Regression seam for the upcoming live wiring: the deterministic
  // mock the adapter returns today must already match the imported
  // skill JSON contract, so validating the live response with the same
  // helper cannot regress the gate.
  const { dossierId } = await createDossier();
  const [dossier] = await db
    .select()
    .from(dossiersTable)
    .where(inArray(dossiersTable.id, [dossierId]));
  const ctx = ctxFor(dossier);

  const need = await FinancingNeedAssessorAdapter.run(ctx);
  const credit = await CreditProductAdvisorAdapter.run(ctx);
  const dual = await FinancingProductAdvisorDualViewAdapter.run(ctx);
  const flow = await GeenbankKredietworkflowAdapter.run({
    ctx,
    completenessScore: need.data.completenessScore,
    correctnessScore: credit.data.correctnessScore,
    viabilityScore: dual.data.viabilityScore,
    completedDocs: need.data.completedDocs,
    requiredDocs: need.data.requiredDocs,
    margin: dual.data.margin,
    dscr: dual.data.dscr,
    revenue: dual.data.revenue,
    profit: dual.data.profit,
    requested: dual.data.requested,
  });

  const problem = validateGeenbankKredietworkflowJson(flow.data);
  assert.equal(
    problem,
    null,
    `mock adapter output should satisfy the live skill schema: ${problem}`,
  );
});

test("GeenbankKredietworkflow stays on mock when only OPENAI_API_KEY is set (honesty rule)", async () => {
  const originals = {
    AI_SKILL_PROVIDER: process.env.AI_SKILL_PROVIDER,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    AI_SKILL_GEENBANKKREDIETWORKFLOW_PROVIDER:
      process.env.AI_SKILL_GEENBANKKREDIETWORKFLOW_PROVIDER,
  };
  delete process.env.AI_SKILL_PROVIDER;
  delete process.env.AI_SKILL_GEENBANKKREDIETWORKFLOW_PROVIDER;
  process.env.OPENAI_API_KEY = "sk-test-fake-1234567890";
  try {
    const cfg = resolveSkillRuntime("GeenbankKredietworkflow");
    assert.equal(cfg.provider, "mock");
    assert.equal(cfg.usedMockMode, true);
    assert.equal(cfg.fallbackReason, null);
  } finally {
    for (const [k, v] of Object.entries(originals)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});


// --- GeenbankKredietworkflow CANONICAL financier-shape schema + mapper ----
//
// These tests cover the new forward-only artefacts:
//   - geenbank-kredietworkflow-financier-schema.ts (validator)
//   - geenbank-kredietworkflow-financier-mapper.ts (pure mapper)
//
// They do NOT enable live OpenAI invocation, do NOT change the adapter
// runtime, do NOT touch GATE_THRESHOLDS, RBAC, or the submit gate.

function buildFinancierSample(
  overrides: Partial<GeenbankKredietworkflowFinancierOutput> = {},
): GeenbankKredietworkflowFinancierOutput {
  const base: GeenbankKredietworkflowFinancierOutput = {
    decision: "Go",
    decisionRationale:
      "DSCR ruim boven 1,3, solvabiliteit op 38%, alle kerndocumenten gevalideerd.",
    feasibilityAssessment: "haalbaar zoals aangevraagd",
    borrower: { name: "Test BV", kvkNumber: "12345678", description: null },
    requestedStructure: {
      facilityType: "Annuïteitenlening",
      amount: 250000,
      rate: 0.069,
      rateComment: null,
      tenor: "60 mnd",
      repaymentProfile: "annuïtair",
      purpose: "groei en werkkapitaal",
    },
    recommendedStructure: {
      facilityType: "Annuïteitenlening",
      amount: 250000,
      rate: 0.069,
      rateComment: null,
      tenor: "60 mnd",
      repaymentProfile: "annuïtair",
      purpose: "groei en werkkapitaal",
    },
    riskAnalysis: {
      summary: "Stabiele kasstroom, geconcentreerde klantbasis.",
      metrics: { dscr: 1.45, solvency: 0.38, ltv: null, netWorkingCapital: 80000 },
      stressCase: "Bij omzet -15% blijft DSCR > 1,1.",
      keyRisks: ["Klantconcentratie top-3 = 55% van omzet."],
      mitigants: [
        "Meerjarig contract met grootste klant.",
        "Gezonde marge van 18% op de omzet.",
      ],
      assumptions: ["Volume blijft stabiel op huidig niveau."],
    },
    commercialProposal: {
      summary: "Annuïteitenlening met persoonlijke borg en pandrecht voorraden.",
      structure: {
        facilityType: "Annuïteitenlening",
        amount: 250000,
        rate: 0.069,
        rateComment: null,
        tenor: "60 mnd",
        repaymentProfile: "annuïtair",
        purpose: "groei en werkkapitaal",
      },
      fees: "Afsluitprovisie 1%",
      collateralPackage: ["Persoonlijke borg DGA EUR 50.000", "Pandrecht voorraden"],
      covenantPackage: ["Solvabiliteit > 30% per jaareinde"],
      monitoringCadence: "Kwartaalrapportage",
      conditionsPrecedent: ["Aktepassering binnen 30 dagen na akkoord"],
      eventsOfDefault: ["Niet-betaling > 30 dagen"],
    },
    validationFindings: {
      summary: "Onafhankelijke review bevestigt risico-inschatting.",
      blockingFindings: [],
      advisoryFindings: ["Verifieer doorlopende klantcontracten jaarlijks."],
      recalculatedMetrics: { dscr: 1.42, ltv: null, solvency: 0.38 },
      consistencyIssues: [],
    },
    creditReport: {
      headline: "Kredietvoorstel Test BV — Go",
      summary: "Casus voldoet aan acceptatiecriteria; voorstel voor commissie.",
      sections: [
        { title: "Samenvatting", body: "Korte samenvatting van de casus." },
        { title: "Risicoanalyse", body: "Stabiele kasstroom, klantconcentratie." },
      ],
      docxArtifactRef: null,
    },
    termSheet: {
      summary: "Indicatieve term sheet conform commercieel voorstel.",
      structure: {
        facilityType: "Annuïteitenlening",
        amount: 250000,
        rate: 0.069,
        rateComment: null,
        tenor: "60 mnd",
        repaymentProfile: "annuïtair",
        purpose: "groei en werkkapitaal",
      },
      fees: "Afsluitprovisie 1%",
      collateralPackage: ["Persoonlijke borg DGA EUR 50.000"],
      covenantPackage: ["Solvabiliteit > 30% per jaareinde"],
      monitoringCadence: "Kwartaalrapportage",
      conditionsPrecedent: ["Aktepassering binnen 30 dagen na akkoord"],
      eventsOfDefault: ["Niet-betaling > 30 dagen"],
    },
    conditions: [
      {
        id: "C-001",
        category: "monitoring",
        severity: "advisory",
        description: "Lever kwartaalrapportage aan via portaal.",
        prefunding: false,
      },
    ],
    riskFlags: [],
    securities: {
      items: [
        {
          type: "borg",
          description: "Persoonlijke borg DGA",
          marketValue: 50000,
          forcedSaleValue: 50000,
          ranking: null,
          enforceabilityNotes: null,
        },
      ],
      totalMarketValue: 50000,
      totalForcedSaleValue: 50000,
      ltv: null,
    },
    pricingIndication: {
      components: [
        { product: "OG Financiering", contribution: 250000, monthlyRate: 0.005, matrixBand: "A" },
      ],
      grandTotalMonthlyRate: 0.005,
      notes: "Vanaf-tarief; definitieve quote na credit committee.",
    },
    confidenceScore: 82,
    creditWorkflowContext: {
      decision: "Go",
      feasibilityAssessment: "haalbaar zoals aangevraagd",
      recommendedStructureSummary: "Annuïteitenlening EUR 250k / 60 mnd / 6,9%.",
      termSheetSummary: "Annuïteitenlening met persoonlijke borg DGA.",
      pricingSummary: "Gewogen maandtarief 0,5%.",
      blockingConditions: [],
      advisoryConditions: ["Lever kwartaalrapportage aan via portaal."],
      riskFlags: [],
    },
  };
  return { ...base, ...overrides };
}

test("validateGeenbankKredietworkflowFinancierJson accepts a valid sample", () => {
  assert.equal(
    validateGeenbankKredietworkflowFinancierJson(buildFinancierSample()),
    null,
  );
});

test("validateGeenbankKredietworkflowFinancierJson rejects an invalid decision enum", () => {
  const bad = { ...buildFinancierSample(), decision: "approved" };
  const problem = validateGeenbankKredietworkflowFinancierJson(bad);
  assert.ok(problem && /decision/i.test(problem));
});

test("validateGeenbankKredietworkflowFinancierJson rejects a missing riskAnalysis", () => {
  const sample = buildFinancierSample();
  const { riskAnalysis: _omit, ...rest } = sample;
  const problem = validateGeenbankKredietworkflowFinancierJson(rest);
  assert.ok(problem && /riskAnalysis/i.test(problem));
});

test("validateGeenbankKredietworkflowFinancierJson rejects a missing creditReport", () => {
  const sample = buildFinancierSample();
  const { creditReport: _omit, ...rest } = sample;
  const problem = validateGeenbankKredietworkflowFinancierJson(rest);
  assert.ok(problem && /creditReport/i.test(problem));
});

test("financier decision/feasibility enums stay in sync with the SKILL.md contract", () => {
  assert.deepEqual(
    [...GEENBANK_KREDIETWORKFLOW_DECISIONS].sort(),
    ["Conditional Go", "Go", "No Go"],
  );
  assert.deepEqual(
    [...GEENBANK_KREDIETWORKFLOW_FEASIBILITIES].sort(),
    [
      "haalbaar onder voorwaarden",
      "haalbaar zoals aangevraagd",
      "niet haalbaar zoals aangevraagd",
    ],
  );
});

test("mapper: Go + no blockers → kansrijk + canSubmit true", () => {
  const mapped = mapKredietworkflowFinancierOutputToAppAnalysis(
    buildFinancierSample(),
  );
  assert.equal(mapped.aiVerdict, "kansrijk");
  assert.equal(mapped.entrepreneurReport.canSubmit, true);
  assert.equal(mapped.blockingConditions.length, 0);
  assert.ok(mapped.confidenceScore >= 0 && mapped.confidenceScore <= 100);
});

test("mapper: Conditional Go → voorwaardelijk + actionPoints carry conditions", () => {
  const mapped = mapKredietworkflowFinancierOutputToAppAnalysis(
    buildFinancierSample({
      decision: "Conditional Go",
      feasibilityAssessment: "haalbaar onder voorwaarden",
      conditions: [
        {
          id: "C-002",
          category: "evidence",
          severity: "blocking",
          description: "Cashflow-prognose 12 mnd ontbreekt.",
        },
        {
          id: "C-003",
          category: "monitoring",
          severity: "advisory",
          description: "Lever kwartaalrapportage aan.",
        },
      ],
    }),
  );
  assert.equal(mapped.aiVerdict, "voorwaardelijk");
  assert.equal(mapped.entrepreneurReport.canSubmit, false);
  assert.ok(
    mapped.entrepreneurReport.actionPoints.includes(
      "Cashflow-prognose 12 mnd ontbreekt.",
    ),
  );
  assert.ok(
    mapped.entrepreneurReport.actionPoints.includes(
      "Lever kwartaalrapportage aan.",
    ),
  );
  assert.deepEqual(mapped.blockingConditions, [
    "Cashflow-prognose 12 mnd ontbreekt.",
  ]);
  // nonBlockingConditions = advisory conditions ⊕ advisory validation
  // findings ⊕ advisory risk flags (deduped). The base sample carries
  // an advisory validation finding too, so assert by inclusion.
  assert.ok(
    mapped.nonBlockingConditions.includes("Lever kwartaalrapportage aan."),
  );
});

test("mapper: No Go → uitdagend + canSubmit false", () => {
  const mapped = mapKredietworkflowFinancierOutputToAppAnalysis(
    buildFinancierSample({
      decision: "No Go",
      feasibilityAssessment: "niet haalbaar zoals aangevraagd",
      validationFindings: {
        summary: "Onafhankelijke review wijst op blokkers.",
        blockingFindings: ["Beleidsbreuk: solvabiliteit < 15%."],
        advisoryFindings: [],
      },
    }),
  );
  assert.equal(mapped.aiVerdict, "uitdagend");
  assert.equal(mapped.entrepreneurReport.canSubmit, false);
  assert.ok(
    mapped.blockingConditions.includes("Beleidsbreuk: solvabiliteit < 15%."),
  );
});

test("mapper: entrepreneur report is derived in Dutch from the same financier output", () => {
  const sample = buildFinancierSample();
  const mapped = mapKredietworkflowFinancierOutputToAppAnalysis(sample);
  // Same source, no translation invented out of thin air — the
  // borrower name and Dutch rationale must surface in the summary.
  assert.match(mapped.entrepreneurReport.summary, /Test BV/);
  assert.match(mapped.entrepreneurReport.summary, /DSCR/);
  // Dutch headline copy.
  assert.match(
    mapped.entrepreneurReport.headline,
    /sterk|dichtbij|werk te doen/i,
  );
});

test("mapper: canonical financier output is preserved untouched", () => {
  const sample = buildFinancierSample();
  const mapped = mapKredietworkflowFinancierOutputToAppAnalysis(sample);
  // Reference equality — the mapper returns the exact same object so
  // callers can persist it on SkillInvocation.extras without copying.
  assert.equal(mapped.canonical, sample);
  // And the canonical output still passes its own validator.
  assert.equal(
    validateGeenbankKredietworkflowFinancierJson(mapped.canonical),
    null,
  );
});

test("mapper: blocking risk flag forces canSubmit=false even for Go decision", () => {
  const mapped = mapKredietworkflowFinancierOutputToAppAnalysis(
    buildFinancierSample({
      riskFlags: [
        {
          id: "R-001",
          category: "compliance",
          severity: "blocking",
          description: "Sanctielijst-treffer op UBO.",
        },
      ],
    }),
  );
  // Decision label still maps deterministically …
  assert.equal(mapped.aiVerdict, "kansrijk");
  // … but a blocking risk flag prevents submit.
  assert.equal(mapped.entrepreneurReport.canSubmit, false);
  assert.ok(
    mapped.blockingConditions.includes("Sanctielijst-treffer op UBO."),
  );
});

// --- GeenbankKredietworkflow LIVE OPENAI PILOT (env-gated) ----------------
//
// These tests exercise the per-skill OpenAI live path on the canonical
// credit-analysis adapter. Real OpenAI is NEVER called — every test
// either sets no env (mock path), sets provider=openai without a key
// (resolver downgrades to mock), or injects a fake OpenAIChatClient via
// `setOpenAIChatClientForTesting`. The central gate (`GATE_THRESHOLDS`)
// MUST stay binding even when the live skill says canSubmit=true.

function buildKwArgs(
  dossier: typeof dossiersTable.$inferSelect,
  overrides: Partial<{
    completenessScore: number;
    correctnessScore: number;
    viabilityScore: number;
    completedDocs: number;
    requiredDocs: number;
    margin: number;
    dscr: number;
    revenue: number;
    profit: number;
    requested: number;
  }> = {},
) {
  return {
    ctx: ctxFor(dossier),
    completenessScore: 80,
    correctnessScore: 80,
    viabilityScore: 80,
    completedDocs: 4,
    requiredDocs: 4,
    margin: 0.2,
    dscr: 4.17,
    revenue: 500000,
    profit: 100000,
    requested: 200000,
    ...overrides,
  };
}

test("kredietworkflow adapter stays on mock when no provider env is set", async () => {
  const { dossierId } = await createDossier();
  const [dossier] = await db
    .select()
    .from(dossiersTable)
    .where(inArray(dossiersTable.id, [dossierId]));
  await withKwEnv(
    { [KW_PROVIDER_ENV]: undefined, OPENAI_API_KEY: undefined },
    async () => {
      const r = await GeenbankKredietworkflowAdapter.run(buildKwArgs(dossier));
      assert.equal(r.ok, true);
      assert.equal(r.usedMockMode, true);
      assert.equal(r.invocation.usedMockMode, true);
      assert.equal(r.invocation.model, null);
      assert.equal(r.invocation.fallbackReason, null);
      assert.equal(r.invocation.extras, null);
    },
  );
});

test("kredietworkflow adapter falls back to mock when provider=openai but key is missing", async () => {
  const { dossierId } = await createDossier();
  const [dossier] = await db
    .select()
    .from(dossiersTable)
    .where(inArray(dossiersTable.id, [dossierId]));
  await withKwEnv(
    { [KW_PROVIDER_ENV]: "openai", OPENAI_API_KEY: undefined },
    async () => {
      const r = await GeenbankKredietworkflowAdapter.run(buildKwArgs(dossier));
      assert.equal(r.usedMockMode, true);
      assert.equal(r.invocation.usedMockMode, true);
      assert.ok(
        r.invocation.fallbackReason &&
          /OPENAI_API_KEY/i.test(r.invocation.fallbackReason),
        `expected fallbackReason to mention OPENAI_API_KEY, got ${r.invocation.fallbackReason}`,
      );
    },
  );
});

function buildKwLiveResponse(
  overrides: Partial<GeenbankKredietworkflowFinancierOutput> = {},
): GeenbankKredietworkflowFinancierOutput {
  return buildFinancierSample(overrides);
}

test("kredietworkflow adapter maps a valid live OpenAI response onto app fields and preserves canonical", async () => {
  const { dossierId } = await createDossier();
  const [dossier] = await db
    .select()
    .from(dossiersTable)
    .where(inArray(dossiersTable.id, [dossierId]));
  const liveResponse = buildKwLiveResponse();
  setOpenAIChatClientForTesting(
    makeFakeOpenAI(() => ({
      content: JSON.stringify(liveResponse),
      model: "gpt-4o-mini",
    })),
  );
  try {
    await withKwEnv(
      { [KW_PROVIDER_ENV]: "openai", OPENAI_API_KEY: "sk-test-fake-1234567890" },
      async () => {
        const r = await GeenbankKredietworkflowAdapter.run(
          buildKwArgs(dossier),
        );
        assert.equal(r.ok, true);
        assert.equal(r.usedMockMode, false);
        assert.equal(r.invocation.usedMockMode, false);
        assert.equal(r.invocation.provider, "openai");
        assert.equal(r.invocation.model, "gpt-4o-mini");
        assert.equal(r.invocation.fallbackReason, null);
        // Decision Go → app verdict kansrijk.
        assert.equal(r.data.verdict, "kansrijk");
        assert.equal(r.data.entrepreneurReport.canSubmit, true);
        // Canonical financier output preserved on extras for officers.
        const extras = r.invocation.extras as
          | { canonical?: GeenbankKredietworkflowFinancierOutput }
          | null;
        assert.ok(extras && extras.canonical, "extras.canonical missing");
        assert.equal(extras!.canonical!.decision, "Go");
        assert.equal(extras!.canonical!.borrower.name, "Test BV");
      },
    );
  } finally {
    setOpenAIChatClientForTesting(null);
  }
});

test("kredietworkflow adapter falls back to mock when OpenAI returns invalid JSON", async () => {
  const { dossierId } = await createDossier();
  const [dossier] = await db
    .select()
    .from(dossiersTable)
    .where(inArray(dossiersTable.id, [dossierId]));
  setOpenAIChatClientForTesting(
    makeFakeOpenAI(() => ({ content: "definitely not json", model: "fake" })),
  );
  try {
    await withKwEnv(
      { [KW_PROVIDER_ENV]: "openai", OPENAI_API_KEY: "sk-test-fake-1234567890" },
      async () => {
        const r = await GeenbankKredietworkflowAdapter.run(
          buildKwArgs(dossier),
        );
        assert.equal(r.usedMockMode, true);
        assert.equal(r.invocation.usedMockMode, true);
        assert.equal(r.invocation.provider, "openai");
        assert.ok(
          r.invocation.fallbackReason &&
            /JSON|ongeldig|mislukt/i.test(r.invocation.fallbackReason),
          `unexpected fallbackReason: ${r.invocation.fallbackReason}`,
        );
        // Fell back to deterministic mock — still returns an answer.
        assert.ok(r.data.verdict);
      },
    );
  } finally {
    setOpenAIChatClientForTesting(null);
  }
});

test("kredietworkflow adapter falls back to mock when OpenAI client throws (network/HTTP error)", async () => {
  const { dossierId } = await createDossier();
  const [dossier] = await db
    .select()
    .from(dossiersTable)
    .where(inArray(dossiersTable.id, [dossierId]));
  setOpenAIChatClientForTesting(
    makeFakeOpenAI(() => {
      throw new Error("HTTP 503 Service Unavailable");
    }),
  );
  try {
    await withKwEnv(
      { [KW_PROVIDER_ENV]: "openai", OPENAI_API_KEY: "sk-test-fake-1234567890" },
      async () => {
        const r = await GeenbankKredietworkflowAdapter.run(
          buildKwArgs(dossier),
        );
        assert.equal(r.usedMockMode, true);
        assert.equal(r.invocation.usedMockMode, true);
        assert.equal(r.invocation.provider, "openai");
        assert.ok(
          r.invocation.fallbackReason &&
            /503|Service Unavailable|mislukt/i.test(
              r.invocation.fallbackReason,
            ),
          `unexpected fallbackReason: ${r.invocation.fallbackReason}`,
        );
        // Deterministic mock still produces a valid answer.
        assert.ok(r.data.verdict);
        assert.ok(r.data.entrepreneurReport);
      },
    );
  } finally {
    setOpenAIChatClientForTesting(null);
  }
});

test("kredietworkflow adapter falls back to mock when OpenAI returns invalid schema", async () => {
  const { dossierId } = await createDossier();
  const [dossier] = await db
    .select()
    .from(dossiersTable)
    .where(inArray(dossiersTable.id, [dossierId]));
  setOpenAIChatClientForTesting(
    makeFakeOpenAI(() => ({
      content: JSON.stringify({ decision: "approved", borrower: {} }),
      model: "fake",
    })),
  );
  try {
    await withKwEnv(
      { [KW_PROVIDER_ENV]: "openai", OPENAI_API_KEY: "sk-test-fake-1234567890" },
      async () => {
        const r = await GeenbankKredietworkflowAdapter.run(
          buildKwArgs(dossier),
        );
        assert.equal(r.usedMockMode, true);
        assert.equal(r.invocation.provider, "openai");
        assert.ok(
          r.invocation.fallbackReason &&
            /ongeldig|decision/i.test(r.invocation.fallbackReason),
        );
      },
    );
  } finally {
    setOpenAIChatClientForTesting(null);
  }
});

test("kredietworkflow adapter: live No Go → uitdagend + canSubmit false", async () => {
  const { dossierId } = await createDossier();
  const [dossier] = await db
    .select()
    .from(dossiersTable)
    .where(inArray(dossiersTable.id, [dossierId]));
  const liveResponse = buildKwLiveResponse({
    decision: "No Go",
    feasibilityAssessment: "niet haalbaar zoals aangevraagd",
    decisionRationale: "DSCR onder 1,0 in alle scenario's.",
  });
  setOpenAIChatClientForTesting(
    makeFakeOpenAI(() => ({
      content: JSON.stringify(liveResponse),
      model: "gpt-4o-mini",
    })),
  );
  try {
    await withKwEnv(
      { [KW_PROVIDER_ENV]: "openai", OPENAI_API_KEY: "sk-test-fake-1234567890" },
      async () => {
        const r = await GeenbankKredietworkflowAdapter.run(
          buildKwArgs(dossier),
        );
        assert.equal(r.usedMockMode, false);
        assert.equal(r.data.verdict, "uitdagend");
        assert.equal(r.data.entrepreneurReport.canSubmit, false);
      },
    );
  } finally {
    setOpenAIChatClientForTesting(null);
  }
});

test("kredietworkflow adapter: live Conditional Go → voorwaardelijk", async () => {
  const { dossierId } = await createDossier();
  const [dossier] = await db
    .select()
    .from(dossiersTable)
    .where(inArray(dossiersTable.id, [dossierId]));
  const liveResponse = buildKwLiveResponse({
    decision: "Conditional Go",
    feasibilityAssessment: "haalbaar onder voorwaarden",
  });
  setOpenAIChatClientForTesting(
    makeFakeOpenAI(() => ({
      content: JSON.stringify(liveResponse),
      model: "gpt-4o-mini",
    })),
  );
  try {
    await withKwEnv(
      { [KW_PROVIDER_ENV]: "openai", OPENAI_API_KEY: "sk-test-fake-1234567890" },
      async () => {
        const r = await GeenbankKredietworkflowAdapter.run(
          buildKwArgs(dossier),
        );
        assert.equal(r.usedMockMode, false);
        assert.equal(r.data.verdict, "voorwaardelijk");
        assert.equal(r.data.entrepreneurReport.canSubmit, false);
      },
    );
  } finally {
    setOpenAIChatClientForTesting(null);
  }
});

test("kredietworkflow adapter: central gate stays binding — Go from LLM cannot bypass GATE_THRESHOLDS", async () => {
  const { dossierId } = await createDossier();
  const [dossier] = await db
    .select()
    .from(dossiersTable)
    .where(inArray(dossiersTable.id, [dossierId]));
  // Live skill says decision=Go (would map to canSubmit=true) BUT the
  // current scores are below the gate thresholds. The adapter MUST
  // overwrite canSubmit to false.
  const liveResponse = buildKwLiveResponse({ decision: "Go" });
  setOpenAIChatClientForTesting(
    makeFakeOpenAI(() => ({
      content: JSON.stringify(liveResponse),
      model: "gpt-4o-mini",
    })),
  );
  try {
    await withKwEnv(
      { [KW_PROVIDER_ENV]: "openai", OPENAI_API_KEY: "sk-test-fake-1234567890" },
      async () => {
        const r = await GeenbankKredietworkflowAdapter.run(
          buildKwArgs(dossier, {
            completenessScore: 10,
            correctnessScore: 10,
            viabilityScore: 10,
          }),
        );
        assert.equal(r.usedMockMode, false);
        assert.equal(r.data.verdict, "kansrijk");
        // Gate binding: canSubmit must be FALSE despite live Go.
        assert.equal(r.data.entrepreneurReport.canSubmit, false);
        const extras = r.invocation.extras as {
          gateApplied?: {
            canSubmitFromMapper?: boolean;
            canSubmitAfterGate?: boolean;
          };
        } | null;
        assert.ok(extras?.gateApplied);
        assert.equal(extras!.gateApplied!.canSubmitFromMapper, true);
        assert.equal(extras!.gateApplied!.canSubmitAfterGate, false);
      },
    );
  } finally {
    setOpenAIChatClientForTesting(null);
  }
});

test("kredietworkflow adapter does NOT call OpenAI when borrower identity is missing — falls back to mock with explicit reason", async () => {
  const { dossierId } = await createDossier();
  const [dossier] = await db
    .select()
    .from(dossiersTable)
    .where(inArray(dossiersTable.id, [dossierId]));
  let openAiCalls = 0;
  setOpenAIChatClientForTesting(
    makeFakeOpenAI(() => {
      openAiCalls += 1;
      throw new Error("must not be called when borrower identity is missing");
    }),
  );
  try {
    await withKwEnv(
      { [KW_PROVIDER_ENV]: "openai", OPENAI_API_KEY: "sk-test-fake-1234567890" },
      async () => {
        // borrowerName=null simulates a prospect profile without
        // companyName. The adapter MUST refuse the live call.
        const args = {
          ...buildKwArgs(dossier),
          ctx: ctxFor(dossier, { companyName: "Onbekend", borrowerName: null }),
        };
        const r = await GeenbankKredietworkflowAdapter.run(args);
        assert.equal(openAiCalls, 0, "OpenAI must not be called");
        assert.equal(r.usedMockMode, true);
        assert.equal(r.invocation.usedMockMode, true);
        assert.equal(r.invocation.provider, "openai");
        assert.equal(
          r.invocation.fallbackReason,
          "Bedrijfsidentiteit ontbreekt; live kredietworkflow niet uitgevoerd.",
        );
        // Mock output still produced and gate-applied.
        assert.ok(r.data.verdict);
        assert.ok(r.data.entrepreneurReport);
      },
    );
  } finally {
    setOpenAIChatClientForTesting(null);
  }
});

test("kredietworkflow adapter sends borrower.name (not companyName) in the live payload", async () => {
  const { dossierId } = await createDossier();
  const [dossier] = await db
    .select()
    .from(dossiersTable)
    .where(inArray(dossiersTable.id, [dossierId]));
  let capturedPayload: { borrower?: { name?: unknown; companyName?: unknown } } | null =
    null;
  setOpenAIChatClientForTesting(
    makeFakeOpenAI((req) => {
      const r = req as { messages: { role: string; content: string }[] };
      const userMsg = r.messages.find((m) => m.role === "user");
      const json = userMsg!.content.slice(userMsg!.content.indexOf("{"));
      capturedPayload = JSON.parse(json);
      return { content: JSON.stringify(buildFinancierSample()), model: "fake" };
    }),
  );
  try {
    await withKwEnv(
      { [KW_PROVIDER_ENV]: "openai", OPENAI_API_KEY: "sk-test-fake-1234567890" },
      async () => {
        const args = {
          ...buildKwArgs(dossier),
          // Whitespace must be trimmed before reaching the LLM.
          ctx: ctxFor(dossier, {
            companyName: "  Brouwerij Noord B.V.  ",
            borrowerName: "  Brouwerij Noord B.V.  ",
          }),
        };
        const r = await GeenbankKredietworkflowAdapter.run(args);
        assert.equal(r.usedMockMode, false);
        assert.ok(capturedPayload, "payload not captured");
        assert.equal(capturedPayload!.borrower?.name, "Brouwerij Noord B.V.");
        // Old field name must NOT be present — the schema expects `name`.
        assert.equal(capturedPayload!.borrower?.companyName, undefined);
      },
    );
  } finally {
    setOpenAIChatClientForTesting(null);
  }
});

// --- pricing-rate normalization (live OpenAI shape) ----------------------
//
// These tests exercise the pure pricing-rate normalizer used by the
// live kredietworkflow adapter BEFORE schema validation. They never
// call real OpenAI. They guard against three regressions:
//   1. numeric rates must pass through untouched,
//   2. common percent-string LLM shapes must parse to a finite number,
//   3. textual / range / "marktconform" rates must NOT become NaN —
//      they land in `rateComment` with `rate=null`.
// The validator must continue to reject genuinely malformed payloads
// (bad enum, missing arrays, etc.); pricing normalization is scoped.

test("normalizeKredietworkflowFinancierPayload: numeric rate passes through", () => {
  const sample = buildFinancierSample();
  const before = sample.requestedStructure.rate;
  normalizeKredietworkflowFinancierPayload(sample);
  assert.equal(sample.requestedStructure.rate, before);
  assert.equal(sample.requestedStructure.rate, 0.069);
  assert.equal(validateGeenbankKredietworkflowFinancierJson(sample), null);
});

test("normalizeKredietworkflowFinancierPayload: \"8.5%\" parses to numeric on every structure node", () => {
  const sample = buildFinancierSample();
  // Force every structure-bearing node to carry the percent-string shape.
  (sample.requestedStructure as unknown as { rate: unknown }).rate = "8.5%";
  (sample.recommendedStructure as unknown as { rate: unknown }).rate = "8.5%";
  (sample.commercialProposal.structure as unknown as { rate: unknown }).rate =
    "8.5%";
  (sample.termSheet.structure as unknown as { rate: unknown }).rate = "8.5%";
  normalizeKredietworkflowFinancierPayload(sample);
  assert.equal(sample.requestedStructure.rate, 8.5);
  assert.equal(sample.recommendedStructure.rate, 8.5);
  assert.equal(sample.commercialProposal.structure.rate, 8.5);
  assert.equal(sample.termSheet.structure.rate, 8.5);
  assert.equal(validateGeenbankKredietworkflowFinancierJson(sample), null);
});

test("normalizeKredietworkflowFinancierPayload: \"8,5%\" (Dutch comma decimal) parses to numeric", () => {
  const sample = buildFinancierSample();
  (sample.requestedStructure as unknown as { rate: unknown }).rate = "8,5%";
  normalizeKredietworkflowFinancierPayload(sample);
  assert.equal(sample.requestedStructure.rate, 8.5);
  assert.equal(validateGeenbankKredietworkflowFinancierJson(sample), null);
});

test("normalizeKredietworkflowFinancierPayload: range \"8-10%\" stays non-numeric, lands in rateComment, never NaN", () => {
  const sample = buildFinancierSample();
  (sample.requestedStructure as unknown as { rate: unknown }).rate = "8-10%";
  normalizeKredietworkflowFinancierPayload(sample);
  assert.equal(sample.requestedStructure.rate, null);
  assert.equal(sample.requestedStructure.rateComment, "8-10%");
  assert.ok(
    !Number.isNaN(sample.requestedStructure.rate as unknown as number),
    "rate must never be NaN",
  );
  assert.equal(validateGeenbankKredietworkflowFinancierJson(sample), null);
});

test("normalizeKredietworkflowFinancierPayload: \"marktconform\" → rateComment + rate null", () => {
  const sample = buildFinancierSample();
  (sample.requestedStructure as unknown as { rate: unknown }).rate =
    "marktconform";
  normalizeKredietworkflowFinancierPayload(sample);
  assert.equal(sample.requestedStructure.rate, null);
  assert.equal(sample.requestedStructure.rateComment, "marktconform");
  assert.equal(validateGeenbankKredietworkflowFinancierJson(sample), null);
});

test("normalizeKredietworkflowFinancierPayload: missing rate but rateComment present is valid", () => {
  const sample = buildFinancierSample();
  (sample.requestedStructure as unknown as { rate: unknown }).rate = null;
  sample.requestedStructure.rateComment = "nader te bepalen";
  normalizeKredietworkflowFinancierPayload(sample);
  assert.equal(sample.requestedStructure.rate, null);
  assert.equal(sample.requestedStructure.rateComment, "nader te bepalen");
  assert.equal(validateGeenbankKredietworkflowFinancierJson(sample), null);
});

test("normalizeKredietworkflowFinancierPayload: NaN-shaped numbers get coerced to null (no validator NaN leak)", () => {
  const sample = buildFinancierSample();
  (sample.requestedStructure as unknown as { rate: unknown }).rate = Number.NaN;
  normalizeKredietworkflowFinancierPayload(sample);
  assert.equal(sample.requestedStructure.rate, null);
  assert.equal(validateGeenbankKredietworkflowFinancierJson(sample), null);
});

test("normalizeKredietworkflowFinancierPayload: existing rateComment is preserved when rate is non-numeric", () => {
  const sample = buildFinancierSample();
  (sample.requestedStructure as unknown as { rate: unknown }).rate = "8-10%";
  sample.requestedStructure.rateComment = "Pre-existing officer note";
  normalizeKredietworkflowFinancierPayload(sample);
  assert.equal(sample.requestedStructure.rate, null);
  // Existing comment must NOT be overwritten by the raw rate string.
  assert.equal(
    sample.requestedStructure.rateComment,
    "Pre-existing officer note",
  );
});

test("normalizeKredietworkflowFinancierPayload: unrelated invalid fields still fail validation after normalization", () => {
  const sample = buildFinancierSample();
  (sample.requestedStructure as unknown as { rate: unknown }).rate = "8.5%";
  // Unrelated regression: bad decision enum must still be rejected.
  const bad = { ...sample, decision: "approved" };
  normalizeKredietworkflowFinancierPayload(bad);
  const problem = validateGeenbankKredietworkflowFinancierJson(bad);
  assert.ok(problem && /decision/i.test(problem));
});

// --- riskAnalysis.summary normalization (live OpenAI shape) -------------
//
// These tests exercise the pure riskAnalysis-summary normalizer used
// by the live kredietworkflow adapter BEFORE schema validation. They
// never call real OpenAI. They guard against four regressions:
//   1. an existing valid summary is NEVER overwritten,
//   2. missing/empty summary WITH supporting risk evidence
//      (keyRisks/mitigants/assumptions/stressCase) derives a concise
//      Dutch summary,
//   3. missing/empty summary WITHOUT any evidence still triggers
//      validation failure (we refuse to invent content),
//   4. derived summary contains content traceable to the source
//      fields — no hollow / placeholder text.

test("normalizeKredietworkflowFinancierPayload: valid riskAnalysis.summary passes through unchanged", () => {
  const sample = buildFinancierSample();
  const before = sample.riskAnalysis.summary;
  normalizeKredietworkflowFinancierPayload(sample);
  assert.equal(sample.riskAnalysis.summary, before);
  assert.equal(validateGeenbankKredietworkflowFinancierJson(sample), null);
});

test("normalizeKredietworkflowFinancierPayload: missing summary with keyRisks+mitigants derives Dutch summary", () => {
  const sample = buildFinancierSample();
  (sample.riskAnalysis as unknown as { summary: unknown }).summary = undefined;
  normalizeKredietworkflowFinancierPayload(sample);
  const s = sample.riskAnalysis.summary;
  assert.ok(typeof s === "string" && s.length > 0, `summary should be derived, got ${s}`);
  // Must reference the source evidence — not invented content.
  assert.match(s, /Belangrijkste risico's:/);
  assert.match(s, /Mitigerende maatregelen:/);
  assert.match(s, /Klantconcentratie/);
  assert.match(s, /Meerjarig contract/);
  // Validator now passes.
  assert.equal(validateGeenbankKredietworkflowFinancierJson(sample), null);
});

test("normalizeKredietworkflowFinancierPayload: empty-string summary with risk evidence derives summary", () => {
  const sample = buildFinancierSample();
  sample.riskAnalysis.summary = "";
  normalizeKredietworkflowFinancierPayload(sample);
  const s = sample.riskAnalysis.summary;
  assert.ok(typeof s === "string" && s.trim().length > 0);
  assert.match(s, /Belangrijkste risico's:/);
  assert.equal(validateGeenbankKredietworkflowFinancierJson(sample), null);
});

test("normalizeKredietworkflowFinancierPayload: whitespace-only summary with evidence derives summary", () => {
  const sample = buildFinancierSample();
  sample.riskAnalysis.summary = "   \n  ";
  normalizeKredietworkflowFinancierPayload(sample);
  assert.match(sample.riskAnalysis.summary, /Belangrijkste risico's:/);
  assert.equal(validateGeenbankKredietworkflowFinancierJson(sample), null);
});

test("normalizeKredietworkflowFinancierPayload: null summary with stressCase only still derives summary", () => {
  const sample = buildFinancierSample();
  (sample.riskAnalysis as unknown as { summary: unknown }).summary = null;
  sample.riskAnalysis.keyRisks = [];
  sample.riskAnalysis.mitigants = [];
  sample.riskAnalysis.assumptions = [];
  // stressCase is the only remaining evidence.
  normalizeKredietworkflowFinancierPayload(sample);
  const s = sample.riskAnalysis.summary;
  assert.ok(typeof s === "string" && s.length > 0);
  assert.match(s, /Stresstest:/);
  assert.equal(validateGeenbankKredietworkflowFinancierJson(sample), null);
});

test("normalizeKredietworkflowFinancierPayload: missing summary AND no risk evidence still fails validation (no invented content)", () => {
  const sample = buildFinancierSample();
  (sample.riskAnalysis as unknown as { summary: unknown }).summary = "";
  sample.riskAnalysis.keyRisks = [];
  sample.riskAnalysis.mitigants = [];
  sample.riskAnalysis.assumptions = [];
  (sample.riskAnalysis as unknown as { stressCase: unknown }).stressCase = null;
  normalizeKredietworkflowFinancierPayload(sample);
  // Summary must NOT have been invented.
  assert.equal(sample.riskAnalysis.summary, "");
  const problem = validateGeenbankKredietworkflowFinancierJson(sample);
  assert.ok(problem && /riskAnalysis\.summary/i.test(problem));
});

test("normalizeKredietworkflowFinancierPayload: existing valid summary is NEVER overwritten even if other evidence exists", () => {
  const sample = buildFinancierSample();
  const original = "Een door de officer goedgekeurde samenvatting met specifieke nuance.";
  sample.riskAnalysis.summary = original;
  // Plenty of evidence is present — must still be ignored.
  normalizeKredietworkflowFinancierPayload(sample);
  assert.equal(sample.riskAnalysis.summary, original);
});

test("normalizeKredietworkflowFinancierPayload: derived summary only restates source evidence, never invents content", () => {
  const sample = buildFinancierSample();
  (sample.riskAnalysis as unknown as { summary: unknown }).summary = undefined;
  sample.riskAnalysis.keyRisks = ["Specifiek risico Alfa"];
  sample.riskAnalysis.mitigants = ["Specifieke mitigant Bravo"];
  sample.riskAnalysis.assumptions = ["Specifieke aanname Charlie"];
  (sample.riskAnalysis as unknown as { stressCase: unknown }).stressCase =
    "Specifieke stresstest Delta";
  normalizeKredietworkflowFinancierPayload(sample);
  const s = sample.riskAnalysis.summary;
  for (const token of [
    "Specifiek risico Alfa",
    "Specifieke mitigant Bravo",
    "Specifieke aanname Charlie",
    "Specifieke stresstest Delta",
  ]) {
    assert.ok(s.includes(token), `derived summary missing token "${token}": ${s}`);
  }
  // Must not contain hollow filler we never asked for.
  assert.ok(!/geen risico/i.test(s), `derived summary must not invent "geen risico" text: ${s}`);
});

test("normalizeKredietworkflowFinancierPayload: rate normalization still works alongside summary normalization", () => {
  const sample = buildFinancierSample();
  // Trigger BOTH normalizations in the same payload.
  (sample.requestedStructure as unknown as { rate: unknown }).rate = "8.5%";
  (sample.recommendedStructure as unknown as { rate: unknown }).rate = "marktconform";
  (sample.riskAnalysis as unknown as { summary: unknown }).summary = "";
  normalizeKredietworkflowFinancierPayload(sample);
  // Rate normalization unaffected.
  assert.equal(sample.requestedStructure.rate, 8.5);
  assert.equal(sample.recommendedStructure.rate, null);
  assert.equal(sample.recommendedStructure.rateComment, "marktconform");
  // Summary derived from existing evidence.
  assert.match(sample.riskAnalysis.summary, /Belangrijkste risico's:/);
  assert.equal(validateGeenbankKredietworkflowFinancierJson(sample), null);
});

test("kredietworkflow adapter: live OpenAI returning empty riskAnalysis.summary with evidence is normalized + accepted (no fallback)", async () => {
  const { dossierId } = await createDossier();
  const [dossier] = await db
    .select()
    .from(dossiersTable)
    .where(inArray(dossiersTable.id, [dossierId]));
  const liveResponse = buildFinancierSample();
  // Reproduce the exact production failure mode: empty summary,
  // but useful supporting evidence is present.
  (liveResponse.riskAnalysis as unknown as { summary: unknown }).summary = "";
  setOpenAIChatClientForTesting(
    makeFakeOpenAI(() => ({
      content: JSON.stringify(liveResponse),
      model: "gpt-4o-mini",
    })),
  );
  try {
    await withKwEnv(
      { [KW_PROVIDER_ENV]: "openai", OPENAI_API_KEY: "sk-test-fake-1234567890" },
      async () => {
        const r = await GeenbankKredietworkflowAdapter.run(buildKwArgs(dossier));
        assert.equal(r.ok, true);
        assert.equal(r.usedMockMode, false);
        assert.equal(r.invocation.fallbackReason, null);
        const extras = r.invocation.extras as
          | { canonical?: GeenbankKredietworkflowFinancierOutput }
          | null;
        assert.ok(extras?.canonical, "extras.canonical must be populated on live success");
        assert.match(
          extras!.canonical!.riskAnalysis.summary,
          /Belangrijkste risico's:/,
        );
      },
    );
  } finally {
    setOpenAIChatClientForTesting(null);
  }
});

test("kredietworkflow adapter: live OpenAI returning empty riskAnalysis.summary AND empty risk fields still falls back to mock cleanly", async () => {
  const { dossierId } = await createDossier();
  const [dossier] = await db
    .select()
    .from(dossiersTable)
    .where(inArray(dossiersTable.id, [dossierId]));
  const liveResponse = buildFinancierSample();
  (liveResponse.riskAnalysis as unknown as { summary: unknown }).summary = "";
  liveResponse.riskAnalysis.keyRisks = [];
  liveResponse.riskAnalysis.mitigants = [];
  liveResponse.riskAnalysis.assumptions = [];
  (liveResponse.riskAnalysis as unknown as { stressCase: unknown }).stressCase = null;
  setOpenAIChatClientForTesting(
    makeFakeOpenAI(() => ({
      content: JSON.stringify(liveResponse),
      model: "gpt-4o-mini",
    })),
  );
  try {
    await withKwEnv(
      { [KW_PROVIDER_ENV]: "openai", OPENAI_API_KEY: "sk-test-fake-1234567890" },
      async () => {
        const r = await GeenbankKredietworkflowAdapter.run(buildKwArgs(dossier));
        assert.equal(r.usedMockMode, true);
        assert.equal(r.invocation.provider, "openai");
        assert.ok(
          r.invocation.fallbackReason &&
            /riskAnalysis\.summary/i.test(r.invocation.fallbackReason),
          `unexpected fallbackReason: ${r.invocation.fallbackReason}`,
        );
        // Deterministic mock still produces an answer.
        assert.ok(r.data.verdict);
      },
    );
  } finally {
    setOpenAIChatClientForTesting(null);
  }
});

test("kredietworkflow adapter: live OpenAI never leaks OPENAI_API_KEY in the summary-fallback path", async () => {
  const { dossierId } = await createDossier();
  const [dossier] = await db
    .select()
    .from(dossiersTable)
    .where(inArray(dossiersTable.id, [dossierId]));
  const SECRET = "sk-test-secretvalue-xxxxxxxxxx";
  const liveResponse = buildFinancierSample();
  (liveResponse.riskAnalysis as unknown as { summary: unknown }).summary = "";
  liveResponse.riskAnalysis.keyRisks = [];
  liveResponse.riskAnalysis.mitigants = [];
  liveResponse.riskAnalysis.assumptions = [];
  (liveResponse.riskAnalysis as unknown as { stressCase: unknown }).stressCase = null;
  setOpenAIChatClientForTesting(
    makeFakeOpenAI(() => ({
      content: JSON.stringify(liveResponse),
      model: "gpt-4o-mini",
    })),
  );
  try {
    await withKwEnv(
      { [KW_PROVIDER_ENV]: "openai", OPENAI_API_KEY: SECRET },
      async () => {
        const r = await GeenbankKredietworkflowAdapter.run(buildKwArgs(dossier));
        const blob = JSON.stringify(r.invocation);
        assert.ok(!blob.includes(SECRET), "OPENAI_API_KEY must never appear in invocation");
      },
    );
  } finally {
    setOpenAIChatClientForTesting(null);
  }
});

// --- riskAnalysis.metrics normalization (live OpenAI shape) -------------
//
// These tests exercise the pure riskAnalysis-metrics normalizer used
// by the live kredietworkflow adapter BEFORE schema validation. They
// never call real OpenAI. They guard against:
//   1. valid metrics object passes through unchanged,
//   2. missing metrics object is created with deterministic dscr
//      backfill and explicit nulls for unknown solvency/ltv/nwc
//      (NEVER fabricated),
//   3. percentage / Dutch-comma strings normalize safely,
//   4. unparseable values become null, never NaN,
//   5. valid model-supplied dscr is NEVER overridden by deterministic,
//   6. unrelated invalid fields still fail validation,
//   7. rate + summary normalization still work alongside metrics
//      normalization,
//   8. live adapter accepts payloads with missing metrics (falls
//      through normalizer + validator without falling back to mock)
//      AND still falls back when other fields are truly invalid.

test("normalizeKredietworkflowFinancierPayload: valid metrics object passes through unchanged", () => {
  const sample = buildFinancierSample();
  const before = { ...sample.riskAnalysis.metrics };
  normalizeKredietworkflowFinancierPayload(sample, { deterministicDscr: 4.17 });
  // Model-supplied values win.
  assert.equal(sample.riskAnalysis.metrics.dscr, before.dscr);
  assert.equal(sample.riskAnalysis.metrics.solvency, before.solvency);
  assert.equal(sample.riskAnalysis.metrics.ltv, before.ltv);
  assert.equal(sample.riskAnalysis.metrics.netWorkingCapital, before.netWorkingCapital);
  assert.equal(validateGeenbankKredietworkflowFinancierJson(sample), null);
});

test("normalizeKredietworkflowFinancierPayload: missing metrics object is created with deterministic dscr backfill and null unknowns", () => {
  const sample = buildFinancierSample();
  delete (sample.riskAnalysis as { metrics?: unknown }).metrics;
  normalizeKredietworkflowFinancierPayload(sample, { deterministicDscr: 4.17 });
  const m = sample.riskAnalysis.metrics;
  assert.equal(m.dscr, 4.17, "dscr backfilled from deterministic proxy");
  assert.equal(m.solvency, null, "solvency must NOT be fabricated");
  assert.equal(m.ltv, null, "ltv must NOT be fabricated");
  assert.equal(m.netWorkingCapital, null, "netWorkingCapital must NOT be fabricated");
  assert.equal(validateGeenbankKredietworkflowFinancierJson(sample), null);
});

test("normalizeKredietworkflowFinancierPayload: missing metrics WITHOUT deterministic ctx → all null, validator still passes shape", () => {
  const sample = buildFinancierSample();
  delete (sample.riskAnalysis as { metrics?: unknown }).metrics;
  normalizeKredietworkflowFinancierPayload(sample);
  assert.deepEqual(sample.riskAnalysis.metrics, {
    dscr: null,
    solvency: null,
    ltv: null,
    netWorkingCapital: null,
  });
  // Validator allows null for both required dscr + solvency.
  assert.equal(validateGeenbankKredietworkflowFinancierJson(sample), null);
});

test("normalizeKredietworkflowFinancierPayload: percentage strings normalize safely (no scale conversion)", () => {
  const sample = buildFinancierSample();
  sample.riskAnalysis.metrics = {
    dscr: "1,45" as unknown as number,
    solvency: "38%" as unknown as number,
    ltv: "0.65" as unknown as number,
    netWorkingCapital: "80000" as unknown as number,
  };
  normalizeKredietworkflowFinancierPayload(sample, { deterministicDscr: 4.17 });
  const m = sample.riskAnalysis.metrics;
  assert.equal(m.dscr, 1.45);
  // No scale conversion — "38%" → 38, not 0.38. Documented behaviour.
  assert.equal(m.solvency, 38);
  assert.equal(m.ltv, 0.65);
  assert.equal(m.netWorkingCapital, 80000);
  assert.equal(validateGeenbankKredietworkflowFinancierJson(sample), null);
});

test("normalizeKredietworkflowFinancierPayload: unparseable metric values become null, never NaN", () => {
  const sample = buildFinancierSample();
  sample.riskAnalysis.metrics = {
    dscr: "n.v.t." as unknown as number,
    solvency: "30-40%" as unknown as number,
    ltv: Number.NaN as unknown as number,
    netWorkingCapital: { value: 80000 } as unknown as number,
  };
  normalizeKredietworkflowFinancierPayload(sample, { deterministicDscr: 4.17 });
  const m = sample.riskAnalysis.metrics;
  // dscr unparseable → backfilled from deterministic.
  assert.equal(m.dscr, 4.17);
  assert.equal(m.solvency, null, "range string must coerce to null");
  assert.equal(m.ltv, null, "NaN must coerce to null");
  assert.equal(m.netWorkingCapital, null, "object must coerce to null");
  // No NaN anywhere.
  for (const key of ["dscr", "solvency", "ltv", "netWorkingCapital"] as const) {
    const v = m[key];
    assert.ok(v === null || (typeof v === "number" && Number.isFinite(v)),
      `metrics.${key} must be finite number or null, got ${v}`);
  }
  assert.equal(validateGeenbankKredietworkflowFinancierJson(sample), null);
});

test("normalizeKredietworkflowFinancierPayload: valid model dscr is NEVER overridden by deterministic backfill", () => {
  const sample = buildFinancierSample();
  sample.riskAnalysis.metrics = { dscr: 1.45, solvency: 0.38, ltv: null, netWorkingCapital: null };
  normalizeKredietworkflowFinancierPayload(sample, { deterministicDscr: 99.9 });
  assert.equal(sample.riskAnalysis.metrics.dscr, 1.45, "model dscr must win over deterministic");
});

test("normalizeKredietworkflowFinancierPayload: metrics is null → replaced with explicit-nulls object (validator passes shape)", () => {
  const sample = buildFinancierSample();
  (sample.riskAnalysis as unknown as { metrics: unknown }).metrics = null;
  normalizeKredietworkflowFinancierPayload(sample, { deterministicDscr: 4.17 });
  assert.deepEqual(sample.riskAnalysis.metrics, {
    dscr: 4.17,
    solvency: null,
    ltv: null,
    netWorkingCapital: null,
  });
  assert.equal(validateGeenbankKredietworkflowFinancierJson(sample), null);
});

test("normalizeKredietworkflowFinancierPayload: non-finite deterministicDscr (NaN/Infinity) is ignored — dscr stays null", () => {
  const sample = buildFinancierSample();
  delete (sample.riskAnalysis as { metrics?: unknown }).metrics;
  normalizeKredietworkflowFinancierPayload(sample, { deterministicDscr: Number.NaN });
  assert.equal(sample.riskAnalysis.metrics.dscr, null);
  delete (sample.riskAnalysis as { metrics?: unknown }).metrics;
  normalizeKredietworkflowFinancierPayload(sample, { deterministicDscr: Number.POSITIVE_INFINITY });
  assert.equal(sample.riskAnalysis.metrics.dscr, null);
});

test("normalizeKredietworkflowFinancierPayload: rate + summary + metrics normalization all work in same payload", () => {
  const sample = buildFinancierSample();
  // Exercise every normalizer at once.
  (sample.requestedStructure as unknown as { rate: unknown }).rate = "8.5%";
  (sample.recommendedStructure as unknown as { rate: unknown }).rate = "marktconform";
  (sample.riskAnalysis as unknown as { summary: unknown }).summary = "";
  delete (sample.riskAnalysis as { metrics?: unknown }).metrics;
  normalizeKredietworkflowFinancierPayload(sample, { deterministicDscr: 4.17 });
  // Rate.
  assert.equal(sample.requestedStructure.rate, 8.5);
  assert.equal(sample.recommendedStructure.rate, null);
  assert.equal(sample.recommendedStructure.rateComment, "marktconform");
  // Summary.
  assert.match(sample.riskAnalysis.summary, /Belangrijkste risico's:/);
  // Metrics.
  assert.equal(sample.riskAnalysis.metrics.dscr, 4.17);
  assert.equal(sample.riskAnalysis.metrics.solvency, null);
  assert.equal(validateGeenbankKredietworkflowFinancierJson(sample), null);
});

test("normalizeKredietworkflowFinancierPayload: unrelated invalid fields still fail validation after metrics normalization", () => {
  const sample = buildFinancierSample();
  delete (sample.riskAnalysis as { metrics?: unknown }).metrics;
  // Deliberately corrupt an unrelated required field.
  (sample as unknown as { decision: unknown }).decision = "approved";
  normalizeKredietworkflowFinancierPayload(sample, { deterministicDscr: 4.17 });
  // Metrics was normalized…
  assert.deepEqual(sample.riskAnalysis.metrics, {
    dscr: 4.17, solvency: null, ltv: null, netWorkingCapital: null,
  });
  // …but the unrelated bad field still fails validation.
  const problem = validateGeenbankKredietworkflowFinancierJson(sample);
  assert.ok(problem && /decision/i.test(problem));
});

test("kredietworkflow adapter: live OpenAI omitting riskAnalysis.metrics is normalized + accepted (no fallback)", async () => {
  const { dossierId } = await createDossier();
  const [dossier] = await db
    .select()
    .from(dossiersTable)
    .where(inArray(dossiersTable.id, [dossierId]));
  const liveResponse = buildFinancierSample();
  // Reproduce production failure: live model returns no metrics object.
  delete (liveResponse.riskAnalysis as { metrics?: unknown }).metrics;
  setOpenAIChatClientForTesting(
    makeFakeOpenAI(() => ({
      content: JSON.stringify(liveResponse),
      model: "gpt-4o-mini",
    })),
  );
  try {
    await withKwEnv(
      { [KW_PROVIDER_ENV]: "openai", OPENAI_API_KEY: "sk-test-fake-1234567890" },
      async () => {
        const r = await GeenbankKredietworkflowAdapter.run(buildKwArgs(dossier));
        assert.equal(r.ok, true, `expected live success, got fallbackReason=${r.invocation.fallbackReason}`);
        assert.equal(r.usedMockMode, false);
        assert.equal(r.invocation.fallbackReason, null);
        const extras = r.invocation.extras as
          | { canonical?: GeenbankKredietworkflowFinancierOutput }
          | null;
        assert.ok(extras?.canonical, "extras.canonical must be populated on live success");
        const m = extras!.canonical!.riskAnalysis.metrics;
        // dscr backfilled from deterministic (buildKwArgs default = 4.17).
        assert.equal(m.dscr, 4.17);
        assert.equal(m.solvency, null);
        assert.equal(m.ltv, null);
        assert.equal(m.netWorkingCapital, null);
      },
    );
  } finally {
    setOpenAIChatClientForTesting(null);
  }
});

test("kredietworkflow adapter: live OpenAI with truly invalid riskAnalysis (missing keyRisks array) still falls back to mock cleanly", async () => {
  const { dossierId } = await createDossier();
  const [dossier] = await db
    .select()
    .from(dossiersTable)
    .where(inArray(dossiersTable.id, [dossierId]));
  const liveResponse = buildFinancierSample();
  delete (liveResponse.riskAnalysis as { metrics?: unknown }).metrics;
  // Corrupt an unrelated risk field that the metrics normalizer
  // does NOT touch — adapter must still fall back cleanly.
  (liveResponse.riskAnalysis as unknown as { keyRisks: unknown }).keyRisks = "not an array";
  setOpenAIChatClientForTesting(
    makeFakeOpenAI(() => ({
      content: JSON.stringify(liveResponse),
      model: "gpt-4o-mini",
    })),
  );
  try {
    await withKwEnv(
      { [KW_PROVIDER_ENV]: "openai", OPENAI_API_KEY: "sk-test-fake-1234567890" },
      async () => {
        const r = await GeenbankKredietworkflowAdapter.run(buildKwArgs(dossier));
        assert.equal(r.usedMockMode, true);
        assert.equal(r.invocation.provider, "openai");
        assert.ok(
          r.invocation.fallbackReason &&
            /keyRisks/i.test(r.invocation.fallbackReason),
          `unexpected fallbackReason: ${r.invocation.fallbackReason}`,
        );
      },
    );
  } finally {
    setOpenAIChatClientForTesting(null);
  }
});

// --- commercialProposal.summary / termSheet.summary normalization -------
//
// These tests exercise the pure commercial-proposal-summary normalizer
// used by the live kredietworkflow adapter BEFORE schema validation.
// They never call real OpenAI. They guard against four regressions:
//   1. an existing valid summary is NEVER overwritten on either node,
//   2. missing/empty summary WITH supporting evidence
//      (structure / collateral / covenants / conditions / events / fees
//      / monitoring) derives a concise Dutch summary,
//   3. missing/empty summary WITHOUT any evidence still triggers
//      validation failure (we refuse to invent content),
//   4. derived summary contains content traceable to the source
//      fields — no hollow / placeholder text.

test("normalizeKredietworkflowFinancierPayload: valid commercialProposal.summary passes through unchanged", () => {
  const sample = buildFinancierSample();
  const beforeCp = sample.commercialProposal.summary;
  const beforeTs = sample.termSheet.summary;
  normalizeKredietworkflowFinancierPayload(sample);
  assert.equal(sample.commercialProposal.summary, beforeCp);
  assert.equal(sample.termSheet.summary, beforeTs);
  assert.equal(validateGeenbankKredietworkflowFinancierJson(sample), null);
});

test("normalizeKredietworkflowFinancierPayload: missing commercialProposal.summary with structure+collateral derives Dutch summary", () => {
  const sample = buildFinancierSample();
  (sample.commercialProposal as unknown as { summary: unknown }).summary = undefined;
  normalizeKredietworkflowFinancierPayload(sample);
  const s = sample.commercialProposal.summary;
  assert.ok(typeof s === "string" && s.length > 0, `summary should be derived, got ${s}`);
  assert.match(s, /Voorgestelde structuur:/);
  assert.match(s, /Annuïteitenlening/);
  assert.match(s, /Zekerheden:/);
  assert.match(s, /Persoonlijke borg DGA EUR 50\.000/);
  assert.match(s, /Convenanten:/);
  assert.equal(validateGeenbankKredietworkflowFinancierJson(sample), null);
});

test("normalizeKredietworkflowFinancierPayload: empty-string termSheet.summary with evidence derives summary", () => {
  const sample = buildFinancierSample();
  sample.termSheet.summary = "";
  normalizeKredietworkflowFinancierPayload(sample);
  const s = sample.termSheet.summary;
  assert.ok(typeof s === "string" && s.trim().length > 0);
  assert.match(s, /Voorgestelde structuur:/);
  assert.equal(validateGeenbankKredietworkflowFinancierJson(sample), null);
});

test("normalizeKredietworkflowFinancierPayload: whitespace-only commercialProposal.summary with evidence derives summary", () => {
  const sample = buildFinancierSample();
  sample.commercialProposal.summary = "   \n  ";
  normalizeKredietworkflowFinancierPayload(sample);
  assert.match(sample.commercialProposal.summary, /Voorgestelde structuur:/);
  assert.equal(validateGeenbankKredietworkflowFinancierJson(sample), null);
});

test("normalizeKredietworkflowFinancierPayload: null commercialProposal.summary with rateComment-only structure still derives summary", () => {
  const sample = buildFinancierSample();
  (sample.commercialProposal as unknown as { summary: unknown }).summary = null;
  // Strip every other evidence field — only the rateComment in the
  // structure is left.
  sample.commercialProposal.collateralPackage = [];
  sample.commercialProposal.covenantPackage = [];
  sample.commercialProposal.conditionsPrecedent = [];
  sample.commercialProposal.eventsOfDefault = [];
  (sample.commercialProposal as unknown as { fees: unknown }).fees = null;
  (sample.commercialProposal as unknown as { monitoringCadence: unknown }).monitoringCadence = null;
  sample.commercialProposal.structure.rate = null;
  sample.commercialProposal.structure.rateComment = "marktconform";
  normalizeKredietworkflowFinancierPayload(sample);
  const s = sample.commercialProposal.summary;
  assert.ok(typeof s === "string" && s.length > 0);
  assert.match(s, /Voorgestelde structuur:/);
  assert.match(s, /tegen marktconform/);
  assert.equal(validateGeenbankKredietworkflowFinancierJson(sample), null);
});

test("normalizeKredietworkflowFinancierPayload: missing summary AND no commercial evidence still fails validation (no invented content)", () => {
  const sample = buildFinancierSample();
  (sample.commercialProposal as unknown as { summary: unknown }).summary = "";
  // Strip every supporting field on commercialProposal.
  (sample.commercialProposal as unknown as { structure: unknown }).structure = {
    facilityType: "",
    amount: null,
    rate: null,
    rateComment: null,
    tenor: null,
  };
  sample.commercialProposal.collateralPackage = [];
  sample.commercialProposal.covenantPackage = [];
  sample.commercialProposal.conditionsPrecedent = [];
  sample.commercialProposal.eventsOfDefault = [];
  (sample.commercialProposal as unknown as { fees: unknown }).fees = null;
  (sample.commercialProposal as unknown as { monitoringCadence: unknown }).monitoringCadence = null;
  normalizeKredietworkflowFinancierPayload(sample);
  // Summary must NOT have been invented.
  assert.equal(sample.commercialProposal.summary, "");
  const problem = validateGeenbankKredietworkflowFinancierJson(sample);
  assert.ok(
    problem && /commercialProposal\.summary/i.test(problem),
    `expected commercialProposal.summary failure, got ${problem}`,
  );
});

test("normalizeKredietworkflowFinancierPayload: existing valid commercialProposal.summary is NEVER overwritten even if other evidence exists", () => {
  const sample = buildFinancierSample();
  const original = "Een door de officer goedgekeurde commerciële samenvatting met specifieke nuance.";
  sample.commercialProposal.summary = original;
  // Plenty of evidence is present — must still be ignored.
  normalizeKredietworkflowFinancierPayload(sample);
  assert.equal(sample.commercialProposal.summary, original);
});

test("normalizeKredietworkflowFinancierPayload: derived commercial summary only restates source evidence, never invents content", () => {
  const sample = buildFinancierSample();
  (sample.commercialProposal as unknown as { summary: unknown }).summary = undefined;
  sample.commercialProposal.collateralPackage = ["Specifieke zekerheid Alfa"];
  sample.commercialProposal.covenantPackage = ["Specifieke convenant Bravo"];
  sample.commercialProposal.conditionsPrecedent = ["Specifieke conditie Charlie"];
  sample.commercialProposal.eventsOfDefault = ["Specifiek event Delta"];
  (sample.commercialProposal as unknown as { fees: unknown }).fees = "Specifieke fee Echo";
  (sample.commercialProposal as unknown as { monitoringCadence: unknown }).monitoringCadence = "Specifieke monitoring Foxtrot";
  normalizeKredietworkflowFinancierPayload(sample);
  const s = sample.commercialProposal.summary;
  for (const token of [
    "Specifieke zekerheid Alfa",
    "Specifieke convenant Bravo",
    "Specifieke conditie Charlie",
    "Specifiek event Delta",
    "Specifieke fee Echo",
    "Specifieke monitoring Foxtrot",
  ]) {
    assert.ok(s.includes(token), `derived summary missing token "${token}": ${s}`);
  }
  assert.ok(!/geen commercieel/i.test(s), `derived summary must not invent placeholder text: ${s}`);
});

test("normalizeKredietworkflowFinancierPayload: rate + summary + metrics + commercial summary normalization all work in same payload", () => {
  const sample = buildFinancierSample();
  (sample.requestedStructure as unknown as { rate: unknown }).rate = "8.5%";
  (sample.recommendedStructure as unknown as { rate: unknown }).rate = "marktconform";
  (sample.riskAnalysis as unknown as { summary: unknown }).summary = "";
  delete (sample.riskAnalysis as { metrics?: unknown }).metrics;
  (sample.commercialProposal as unknown as { summary: unknown }).summary = "";
  sample.termSheet.summary = "";
  normalizeKredietworkflowFinancierPayload(sample, { deterministicDscr: 4.17 });
  // Pre-existing normalizers still work.
  assert.equal(sample.requestedStructure.rate, 8.5);
  assert.equal(sample.recommendedStructure.rate, null);
  assert.equal(sample.recommendedStructure.rateComment, "marktconform");
  assert.match(sample.riskAnalysis.summary, /Belangrijkste risico's:/);
  assert.equal(sample.riskAnalysis.metrics.dscr, 4.17);
  // New commercial-proposal summary normalizer works on BOTH nodes.
  assert.match(sample.commercialProposal.summary, /Voorgestelde structuur:/);
  assert.match(sample.termSheet.summary, /Voorgestelde structuur:/);
  assert.equal(validateGeenbankKredietworkflowFinancierJson(sample), null);
});

test("normalizeKredietworkflowFinancierPayload: unrelated invalid fields still fail validation after commercial summary normalization", () => {
  const sample = buildFinancierSample();
  (sample.commercialProposal as unknown as { summary: unknown }).summary = "";
  // Unrelated regression: bad decision enum must still be rejected.
  (sample as unknown as { decision: unknown }).decision = "approved";
  normalizeKredietworkflowFinancierPayload(sample);
  // commercialProposal.summary was derived…
  assert.match(sample.commercialProposal.summary, /Voorgestelde structuur:/);
  // …but the unrelated bad field still fails validation.
  const problem = validateGeenbankKredietworkflowFinancierJson(sample);
  assert.ok(problem && /decision/i.test(problem));
});

test("kredietworkflow adapter: live OpenAI returning empty commercialProposal.summary + termSheet.summary with evidence is normalized + accepted (no fallback)", async () => {
  const { dossierId } = await createDossier();
  const [dossier] = await db
    .select()
    .from(dossiersTable)
    .where(inArray(dossiersTable.id, [dossierId]));
  const liveResponse = buildFinancierSample();
  // Reproduce the exact production failure mode: empty summary on
  // BOTH nodes, but useful supporting evidence is present.
  (liveResponse.commercialProposal as unknown as { summary: unknown }).summary = "";
  liveResponse.termSheet.summary = "";
  setOpenAIChatClientForTesting(
    makeFakeOpenAI(() => ({
      content: JSON.stringify(liveResponse),
      model: "gpt-4o-mini",
    })),
  );
  try {
    await withKwEnv(
      { [KW_PROVIDER_ENV]: "openai", OPENAI_API_KEY: "sk-test-fake-1234567890" },
      async () => {
        const r = await GeenbankKredietworkflowAdapter.run(buildKwArgs(dossier));
        assert.equal(r.ok, true, `expected live success, got fallbackReason=${r.invocation.fallbackReason}`);
        assert.equal(r.usedMockMode, false);
        assert.equal(r.invocation.fallbackReason, null);
        const extras = r.invocation.extras as
          | { canonical?: GeenbankKredietworkflowFinancierOutput }
          | null;
        assert.ok(extras?.canonical, "extras.canonical must be populated on live success");
        assert.match(extras!.canonical!.commercialProposal.summary, /Voorgestelde structuur:/);
        assert.match(extras!.canonical!.termSheet.summary, /Voorgestelde structuur:/);
      },
    );
  } finally {
    setOpenAIChatClientForTesting(null);
  }
});

test("kredietworkflow adapter: live OpenAI returning empty commercialProposal.summary AND empty commercial fields still falls back to mock cleanly", async () => {
  const { dossierId } = await createDossier();
  const [dossier] = await db
    .select()
    .from(dossiersTable)
    .where(inArray(dossiersTable.id, [dossierId]));
  const liveResponse = buildFinancierSample();
  (liveResponse.commercialProposal as unknown as { summary: unknown }).summary = "";
  (liveResponse.commercialProposal as unknown as { structure: unknown }).structure = {
    facilityType: "",
    amount: null,
    rate: null,
    rateComment: null,
    tenor: null,
  };
  liveResponse.commercialProposal.collateralPackage = [];
  liveResponse.commercialProposal.covenantPackage = [];
  liveResponse.commercialProposal.conditionsPrecedent = [];
  liveResponse.commercialProposal.eventsOfDefault = [];
  (liveResponse.commercialProposal as unknown as { fees: unknown }).fees = null;
  (liveResponse.commercialProposal as unknown as { monitoringCadence: unknown }).monitoringCadence = null;
  setOpenAIChatClientForTesting(
    makeFakeOpenAI(() => ({
      content: JSON.stringify(liveResponse),
      model: "gpt-4o-mini",
    })),
  );
  try {
    await withKwEnv(
      { [KW_PROVIDER_ENV]: "openai", OPENAI_API_KEY: "sk-test-fake-1234567890" },
      async () => {
        const r = await GeenbankKredietworkflowAdapter.run(buildKwArgs(dossier));
        assert.equal(r.usedMockMode, true);
        assert.equal(r.invocation.provider, "openai");
        assert.ok(
          r.invocation.fallbackReason &&
            /commercialProposal/i.test(r.invocation.fallbackReason),
          `unexpected fallbackReason: ${r.invocation.fallbackReason}`,
        );
        // Deterministic mock still produces an answer.
        assert.ok(r.data.verdict);
      },
    );
  } finally {
    setOpenAIChatClientForTesting(null);
  }
});

// --- validationFindings array normalization ------------------------------
//
// These tests exercise the pure validation-findings normalizer used by
// the live kredietworkflow adapter BEFORE schema validation. They never
// call real OpenAI. They guard against the production failure mode
// "validationFindings.blockingFindings geen string-array" without ever
// inventing finding text.

test("normalizeKredietworkflowFinancierPayload: valid validationFindings arrays pass through (trimmed)", () => {
  const sample = buildFinancierSample();
  sample.validationFindings.blockingFindings = ["  Geen externe accountantsverklaring  "];
  sample.validationFindings.advisoryFindings = ["Verifieer doorlopende klantcontracten jaarlijks."];
  normalizeKredietworkflowFinancierPayload(sample);
  assert.deepEqual(sample.validationFindings.blockingFindings, [
    "Geen externe accountantsverklaring",
  ]);
  assert.deepEqual(sample.validationFindings.advisoryFindings, [
    "Verifieer doorlopende klantcontracten jaarlijks.",
  ]);
  assert.equal(validateGeenbankKredietworkflowFinancierJson(sample), null);
});

test("normalizeKredietworkflowFinancierPayload: missing blockingFindings becomes []", () => {
  const sample = buildFinancierSample();
  delete (sample.validationFindings as unknown as { blockingFindings?: unknown }).blockingFindings;
  normalizeKredietworkflowFinancierPayload(sample);
  assert.deepEqual(sample.validationFindings.blockingFindings, []);
  assert.equal(validateGeenbankKredietworkflowFinancierJson(sample), null);
});

test("normalizeKredietworkflowFinancierPayload: blockingFindings=null becomes []", () => {
  const sample = buildFinancierSample();
  (sample.validationFindings as unknown as { blockingFindings: unknown }).blockingFindings = null;
  normalizeKredietworkflowFinancierPayload(sample);
  assert.deepEqual(sample.validationFindings.blockingFindings, []);
  assert.equal(validateGeenbankKredietworkflowFinancierJson(sample), null);
});

test("normalizeKredietworkflowFinancierPayload: blockingFindings=string becomes [string]", () => {
  const sample = buildFinancierSample();
  (sample.validationFindings as unknown as { blockingFindings: unknown }).blockingFindings =
    "Geen externe accountantsverklaring beschikbaar";
  normalizeKredietworkflowFinancierPayload(sample);
  assert.deepEqual(sample.validationFindings.blockingFindings, [
    "Geen externe accountantsverklaring beschikbaar",
  ]);
  assert.equal(validateGeenbankKredietworkflowFinancierJson(sample), null);
});

test("normalizeKredietworkflowFinancierPayload: blockingFindings=empty/whitespace string becomes []", () => {
  const sample = buildFinancierSample();
  (sample.validationFindings as unknown as { blockingFindings: unknown }).blockingFindings =
    "   ";
  normalizeKredietworkflowFinancierPayload(sample);
  assert.deepEqual(sample.validationFindings.blockingFindings, []);
  assert.equal(validateGeenbankKredietworkflowFinancierJson(sample), null);
});

test("normalizeKredietworkflowFinancierPayload: blockingFindings array with empty/whitespace entries is filtered", () => {
  const sample = buildFinancierSample();
  (sample.validationFindings as unknown as { blockingFindings: unknown }).blockingFindings = [
    "Punt A",
    "",
    "   ",
    "Punt B",
  ];
  normalizeKredietworkflowFinancierPayload(sample);
  assert.deepEqual(sample.validationFindings.blockingFindings, ["Punt A", "Punt B"]);
  assert.equal(validateGeenbankKredietworkflowFinancierJson(sample), null);
});

test("normalizeKredietworkflowFinancierPayload: blockingFindings array with objects carrying description/finding is converted to string-array", () => {
  const sample = buildFinancierSample();
  (sample.validationFindings as unknown as { blockingFindings: unknown }).blockingFindings = [
    { description: "Externe accountantsverklaring ontbreekt" },
    { finding: "DSCR < 1.2 in stressscenario" },
    { summary: "Aflossingscapaciteit niet onderbouwd" },
    { issue: "Borgstelling DGA niet bekrachtigd" },
    { message: "Pandakte voorraden ontbreekt" },
    { text: "Klantenconcentratie > 40%" },
    "Reeds gestructureerde tekst",
  ];
  normalizeKredietworkflowFinancierPayload(sample);
  assert.deepEqual(sample.validationFindings.blockingFindings, [
    "Externe accountantsverklaring ontbreekt",
    "DSCR < 1.2 in stressscenario",
    "Aflossingscapaciteit niet onderbouwd",
    "Borgstelling DGA niet bekrachtigd",
    "Pandakte voorraden ontbreekt",
    "Klantenconcentratie > 40%",
    "Reeds gestructureerde tekst",
  ]);
  assert.equal(validateGeenbankKredietworkflowFinancierJson(sample), null);
});

test("normalizeKredietworkflowFinancierPayload: objects without recognized text field are dropped, never invented", () => {
  const sample = buildFinancierSample();
  (sample.validationFindings as unknown as { blockingFindings: unknown }).blockingFindings = [
    { severity: "high", code: "DSCR_LOW" },
    { foo: "bar", baz: 42 },
    { description: "" },
    { description: "   " },
    "Echte bevinding",
    123,
    true,
    null,
  ];
  normalizeKredietworkflowFinancierPayload(sample);
  // Only the one real string entry survives. No placeholder text is invented.
  assert.deepEqual(sample.validationFindings.blockingFindings, ["Echte bevinding"]);
  assert.equal(validateGeenbankKredietworkflowFinancierJson(sample), null);
});

test("normalizeKredietworkflowFinancierPayload: advisoryFindings follows the same coercion pattern", () => {
  const sample = buildFinancierSample();
  (sample.validationFindings as unknown as { advisoryFindings: unknown }).advisoryFindings = [
    { description: "Verifieer klantcontracten jaarlijks" },
    "Monitor DSCR per kwartaal",
    "",
    null,
  ];
  normalizeKredietworkflowFinancierPayload(sample);
  assert.deepEqual(sample.validationFindings.advisoryFindings, [
    "Verifieer klantcontracten jaarlijks",
    "Monitor DSCR per kwartaal",
  ]);
  assert.equal(validateGeenbankKredietworkflowFinancierJson(sample), null);
});

test("normalizeKredietworkflowFinancierPayload: consistencyIssues follows the same coercion pattern when present", () => {
  const sample = buildFinancierSample();
  (sample.validationFindings as unknown as { consistencyIssues: unknown }).consistencyIssues = [
    { issue: "Omzet term sheet wijkt af van risico-memo" },
    "Tenor in commercieel voorstel ≠ tenor in term sheet",
    { foo: "bar" },
  ];
  normalizeKredietworkflowFinancierPayload(sample);
  assert.deepEqual(sample.validationFindings.consistencyIssues, [
    "Omzet term sheet wijkt af van risico-memo",
    "Tenor in commercieel voorstel ≠ tenor in term sheet",
  ]);
  assert.equal(validateGeenbankKredietworkflowFinancierJson(sample), null);
});

test("normalizeKredietworkflowFinancierPayload: unrelated invalid fields still fail validation after validationFindings normalization", () => {
  const sample = buildFinancierSample();
  (sample.validationFindings as unknown as { blockingFindings: unknown }).blockingFindings = null;
  // Unrelated regression: missing required validationFindings.summary must still be rejected.
  (sample.validationFindings as unknown as { summary: unknown }).summary = "";
  normalizeKredietworkflowFinancierPayload(sample);
  // Arrays were normalized…
  assert.deepEqual(sample.validationFindings.blockingFindings, []);
  // …but the unrelated bad field still fails validation.
  const problem = validateGeenbankKredietworkflowFinancierJson(sample);
  assert.ok(
    problem && /validationFindings\.summary/i.test(problem),
    `expected summary error, got ${problem}`,
  );
});

test("kredietworkflow adapter: live OpenAI returning non-array validationFindings.blockingFindings is normalized + accepted (no fallback)", async () => {
  const { dossierId } = await createDossier();
  const [dossier] = await db
    .select()
    .from(dossiersTable)
    .where(inArray(dossiersTable.id, [dossierId]));
  // Reproduce the exact production failure: the model returned
  // blockingFindings as an array of objects with description fields,
  // and advisoryFindings as a single string.
  const liveResponse = buildFinancierSample();
  (liveResponse.validationFindings as unknown as { blockingFindings: unknown }).blockingFindings =
    [
      { description: "Externe accountantsverklaring ontbreekt" },
      { finding: "DSCR-stress < 1.0" },
    ];
  (liveResponse.validationFindings as unknown as { advisoryFindings: unknown }).advisoryFindings =
    "Monitor DSCR per kwartaal";
  setOpenAIChatClientForTesting(
    makeFakeOpenAI(() => ({
      content: JSON.stringify(liveResponse),
      model: "gpt-4o-mini",
    })),
  );
  try {
    await withKwEnv(
      { [KW_PROVIDER_ENV]: "openai", OPENAI_API_KEY: "sk-test-fake-1234567890" },
      async () => {
        const r = await GeenbankKredietworkflowAdapter.run(buildKwArgs(dossier));
        assert.equal(
          r.ok,
          true,
          `expected live success, got fallbackReason=${r.invocation.fallbackReason}`,
        );
        assert.equal(r.usedMockMode, false);
        assert.equal(r.invocation.fallbackReason, null);
        const extras = r.invocation.extras as
          | { canonical?: GeenbankKredietworkflowFinancierOutput }
          | null;
        assert.ok(extras?.canonical, "extras.canonical must be populated on live success");
        assert.deepEqual(extras!.canonical!.validationFindings.blockingFindings, [
          "Externe accountantsverklaring ontbreekt",
          "DSCR-stress < 1.0",
        ]);
        assert.deepEqual(extras!.canonical!.validationFindings.advisoryFindings, [
          "Monitor DSCR per kwartaal",
        ]);
      },
    );
  } finally {
    setOpenAIChatClientForTesting(null);
  }
});

test("kredietworkflow adapter: live OpenAI with truly unusable validationFindings (missing summary) still falls back to mock cleanly", async () => {
  const { dossierId } = await createDossier();
  const [dossier] = await db
    .select()
    .from(dossiersTable)
    .where(inArray(dossiersTable.id, [dossierId]));
  const liveResponse = buildFinancierSample();
  // Even with array-shape problems the normalizer will accept the
  // findings; to exercise the *fallback* path on validationFindings
  // we make the required summary unusable.
  (liveResponse.validationFindings as unknown as { blockingFindings: unknown }).blockingFindings =
    [{ severity: "high" }, { foo: "bar" }]; // → [] after normalization (no text)
  (liveResponse.validationFindings as unknown as { summary: unknown }).summary = "";
  setOpenAIChatClientForTesting(
    makeFakeOpenAI(() => ({
      content: JSON.stringify(liveResponse),
      model: "gpt-4o-mini",
    })),
  );
  try {
    await withKwEnv(
      { [KW_PROVIDER_ENV]: "openai", OPENAI_API_KEY: "sk-test-fake-1234567890" },
      async () => {
        const r = await GeenbankKredietworkflowAdapter.run(buildKwArgs(dossier));
        assert.equal(r.usedMockMode, true);
        assert.equal(r.invocation.provider, "openai");
        assert.ok(
          r.invocation.fallbackReason &&
            /validationFindings\.summary/i.test(r.invocation.fallbackReason),
          `unexpected fallbackReason: ${r.invocation.fallbackReason}`,
        );
        assert.ok(r.data.verdict);
      },
    );
  } finally {
    setOpenAIChatClientForTesting(null);
  }
});

// --- creditReport.headline normalization ---------------------------------
//
// These tests exercise the pure credit-report-headline normalizer used
// by the live kredietworkflow adapter BEFORE schema validation. They
// never call real OpenAI. They guard against the production failure
// mode "creditReport.headline is geen niet-lege string" without ever
// inventing a credit conclusion.

test("normalizeKredietworkflowFinancierPayload: valid creditReport.headline passes through unchanged", () => {
  const sample = buildFinancierSample();
  const before = sample.creditReport.headline;
  normalizeKredietworkflowFinancierPayload(sample);
  assert.equal(sample.creditReport.headline, before);
  assert.equal(validateGeenbankKredietworkflowFinancierJson(sample), null);
});

test("normalizeKredietworkflowFinancierPayload: missing creditReport.headline derives from borrower.name + decision", () => {
  const sample = buildFinancierSample();
  (sample.creditReport as unknown as { headline: unknown }).headline = undefined;
  normalizeKredietworkflowFinancierPayload(sample);
  assert.equal(
    sample.creditReport.headline,
    `Kredietvoorstel ${sample.borrower.name} — ${sample.decision}`,
  );
  assert.equal(validateGeenbankKredietworkflowFinancierJson(sample), null);
});

test("normalizeKredietworkflowFinancierPayload: empty / whitespace / null headline with evidence is filled", () => {
  for (const bad of ["", "   ", null]) {
    const sample = buildFinancierSample();
    (sample.creditReport as unknown as { headline: unknown }).headline = bad;
    normalizeKredietworkflowFinancierPayload(sample);
    assert.equal(
      sample.creditReport.headline,
      `Kredietvoorstel ${sample.borrower.name} — ${sample.decision}`,
      `headline not filled for input ${JSON.stringify(bad)}`,
    );
    assert.equal(validateGeenbankKredietworkflowFinancierJson(sample), null);
  }
});

test("normalizeKredietworkflowFinancierPayload: missing headline + missing decision uses borrower.name only", () => {
  const sample = buildFinancierSample();
  (sample.creditReport as unknown as { headline: unknown }).headline = "";
  (sample as unknown as { decision: unknown }).decision = "not-a-real-decision";
  normalizeKredietworkflowFinancierPayload(sample);
  assert.equal(
    sample.creditReport.headline,
    `Kredietvoorstel ${sample.borrower.name}`,
  );
  // The unrelated bad decision must still be rejected by the validator.
  const problem = validateGeenbankKredietworkflowFinancierJson(sample);
  assert.ok(problem && /decision/i.test(problem));
});

test("normalizeKredietworkflowFinancierPayload: missing headline + no borrower falls back to first section title", () => {
  const sample = buildFinancierSample();
  (sample.creditReport as unknown as { headline: unknown }).headline = "";
  (sample.borrower as unknown as { name: unknown }).name = "";
  normalizeKredietworkflowFinancierPayload(sample);
  assert.equal(sample.creditReport.headline, sample.creditReport.sections[0].title);
  // borrower.name now empty → unrelated validator failure stays.
  const problem = validateGeenbankKredietworkflowFinancierJson(sample);
  assert.ok(problem && /borrower\.name/i.test(problem));
});

test("normalizeKredietworkflowFinancierPayload: missing headline + no borrower + no sections falls back to summary first sentence", () => {
  const sample = buildFinancierSample();
  (sample.creditReport as unknown as { headline: unknown }).headline = "";
  (sample.borrower as unknown as { name: unknown }).name = "";
  sample.creditReport.sections = [];
  sample.creditReport.summary =
    "Casus voldoet aan acceptatiecriteria. Voorstel voor commissie ter besluitvorming.";
  normalizeKredietworkflowFinancierPayload(sample);
  assert.equal(
    sample.creditReport.headline,
    "Casus voldoet aan acceptatiecriteria.",
  );
});

test("normalizeKredietworkflowFinancierPayload: missing headline + only decisionRationale evidence uses rationale", () => {
  const sample = buildFinancierSample();
  (sample.creditReport as unknown as { headline: unknown }).headline = "";
  (sample.borrower as unknown as { name: unknown }).name = "";
  sample.creditReport.sections = [];
  sample.creditReport.summary = "";
  sample.decisionRationale =
    "Stabiele kasstroom en sterke borgstelling rechtvaardigen het krediet.";
  normalizeKredietworkflowFinancierPayload(sample);
  assert.equal(
    sample.creditReport.headline,
    "Stabiele kasstroom en sterke borgstelling rechtvaardigen het krediet.",
  );
});

test("normalizeKredietworkflowFinancierPayload: missing headline AND no usable evidence stays empty (validator still rejects)", () => {
  const sample = buildFinancierSample();
  (sample.creditReport as unknown as { headline: unknown }).headline = "";
  (sample.borrower as unknown as { name: unknown }).name = "Anoniem";
  // Wipe every fallback source.
  sample.creditReport.sections = [{ title: "   ", body: "" }];
  sample.creditReport.summary = "";
  sample.decisionRationale = "";
  // Now strip the borrower.name fallback so headline truly cannot be derived.
  (sample.borrower as unknown as { name: unknown }).name = "   ";
  normalizeKredietworkflowFinancierPayload(sample);
  // Headline must remain empty / unusable so validator catches it.
  assert.ok(
    !sample.creditReport.headline || sample.creditReport.headline.trim() === "",
    `expected empty headline, got ${JSON.stringify(sample.creditReport.headline)}`,
  );
  // Validator rejects on whichever required field fails first
  // (decisionRationale / borrower.name / creditReport.headline / sections);
  // the headline normalizer must not invent content to mask that.
  const problem = validateGeenbankKredietworkflowFinancierJson(sample);
  assert.ok(problem, "expected validator to reject payload with no usable evidence");
});

test("normalizeKredietworkflowFinancierPayload: unrelated invalid creditReport.sections still fails validation after headline normalization", () => {
  const sample = buildFinancierSample();
  (sample.creditReport as unknown as { headline: unknown }).headline = "";
  // Section-shape regression — body wrong type.
  (sample.creditReport.sections[0] as unknown as { body: unknown }).body = 42;
  normalizeKredietworkflowFinancierPayload(sample);
  // headline was derived…
  assert.equal(
    sample.creditReport.headline,
    `Kredietvoorstel ${sample.borrower.name} — ${sample.decision}`,
  );
  // …but sections.body type error must still fail validation.
  const problem = validateGeenbankKredietworkflowFinancierJson(sample);
  assert.ok(
    problem && /sections.*body/i.test(problem),
    `expected sections.body error, got ${problem}`,
  );
});

test("normalizeKredietworkflowFinancierPayload: existing normalizers still cooperate (rate + risk + commercial + findings + headline)", () => {
  const sample = buildFinancierSample();
  // Force every prior-fix normalizer to fire too.
  (sample.requestedStructure as unknown as { rate: unknown }).rate = "8.5%";
  sample.riskAnalysis.summary = "";
  (sample.commercialProposal as unknown as { summary: unknown }).summary = "";
  (sample.validationFindings as unknown as { blockingFindings: unknown }).blockingFindings =
    "Externe verklaring ontbreekt";
  (sample.creditReport as unknown as { headline: unknown }).headline = "";
  normalizeKredietworkflowFinancierPayload(sample);
  assert.equal(sample.requestedStructure.rate, 8.5);
  assert.match(sample.riskAnalysis.summary, /Belangrijkste risico's:/);
  assert.match(sample.commercialProposal.summary, /Voorgestelde structuur:/);
  assert.deepEqual(sample.validationFindings.blockingFindings, [
    "Externe verklaring ontbreekt",
  ]);
  assert.equal(
    sample.creditReport.headline,
    `Kredietvoorstel ${sample.borrower.name} — ${sample.decision}`,
  );
  assert.equal(validateGeenbankKredietworkflowFinancierJson(sample), null);
});

// --- creditReport.sections[*].body normalization -------------------------
//
// Tests for the conservative section-body coercion that runs BEFORE
// schema validation. They guard against the production failure mode
// "creditReport.sections[*].body is geen string" without ever inventing
// committee content. They never call real OpenAI.

test("normalizeKredietworkflowFinancierPayload: valid string section body passes through trimmed (other sections untouched)", () => {
  const sample = buildFinancierSample();
  sample.creditReport.sections = [
    { title: "Inleiding", body: "  Casus voldoet aan acceptatiecriteria.  " },
    { title: "Conclusie", body: "Voorstel ter besluitvorming." },
  ];
  normalizeKredietworkflowFinancierPayload(sample);
  assert.equal(sample.creditReport.sections[0].body, "Casus voldoet aan acceptatiecriteria.");
  assert.equal(sample.creditReport.sections[1].body, "Voorstel ter besluitvorming.");
  assert.equal(validateGeenbankKredietworkflowFinancierJson(sample), null);
});

test("normalizeKredietworkflowFinancierPayload: array-of-strings section body is joined", () => {
  const sample = buildFinancierSample();
  (sample.creditReport.sections[0] as unknown as { body: unknown }).body = [
    "Eerste alinea over kasstroom.",
    "  ",
    "Tweede alinea over solvabiliteit.",
  ];
  normalizeKredietworkflowFinancierPayload(sample);
  assert.equal(
    sample.creditReport.sections[0].body,
    "Eerste alinea over kasstroom.\n\nTweede alinea over solvabiliteit.",
  );
  assert.equal(validateGeenbankKredietworkflowFinancierJson(sample), null);
});

test("normalizeKredietworkflowFinancierPayload: object body with text/summary/content fields is coerced", () => {
  for (const key of ["body", "text", "summary", "content", "description", "analysis"]) {
    const sample = buildFinancierSample();
    (sample.creditReport.sections[0] as unknown as { body: unknown }).body = {
      [key]: "  Gestructureerde tekst uit object.  ",
    };
    normalizeKredietworkflowFinancierPayload(sample);
    assert.equal(
      sample.creditReport.sections[0].body,
      "Gestructureerde tekst uit object.",
      `key=${key} did not coerce`,
    );
    assert.equal(validateGeenbankKredietworkflowFinancierJson(sample), null);
  }
});

test("normalizeKredietworkflowFinancierPayload: array of {text:...} objects is flattened", () => {
  const sample = buildFinancierSample();
  (sample.creditReport.sections[0] as unknown as { body: unknown }).body = [
    { text: "Punt 1." },
    { text: "Punt 2." },
    { content: "Punt 3." },
  ];
  normalizeKredietworkflowFinancierPayload(sample);
  assert.equal(
    sample.creditReport.sections[0].body,
    "Punt 1.\n\nPunt 2.\n\nPunt 3.",
  );
  assert.equal(validateGeenbankKredietworkflowFinancierJson(sample), null);
});

test("normalizeKredietworkflowFinancierPayload: section title is trimmed but kept", () => {
  const sample = buildFinancierSample();
  sample.creditReport.sections = [{ title: "  Inleiding  ", body: "Inhoud." }];
  normalizeKredietworkflowFinancierPayload(sample);
  assert.equal(sample.creditReport.sections[0].title, "Inleiding");
  assert.equal(validateGeenbankKredietworkflowFinancierJson(sample), null);
});

test("normalizeKredietworkflowFinancierPayload: unrecognised body shape (number) is left untouched and validator still rejects", () => {
  const sample = buildFinancierSample();
  (sample.creditReport.sections[0] as unknown as { body: unknown }).body = 42;
  normalizeKredietworkflowFinancierPayload(sample);
  // Body must remain non-string so validator rejects — we never invent.
  assert.equal(typeof sample.creditReport.sections[0].body, "number");
  const problem = validateGeenbankKredietworkflowFinancierJson(sample);
  assert.ok(
    problem && /sections.*body/i.test(problem),
    `expected sections[*].body validator error, got ${problem}`,
  );
});

test("normalizeKredietworkflowFinancierPayload: mixed-type body array (e.g. [42, 'ok']) is rejected, not silently coerced", () => {
  const sample = buildFinancierSample();
  (sample.creditReport.sections[0] as unknown as { body: unknown }).body = [42, "ok"];
  normalizeKredietworkflowFinancierPayload(sample);
  // Must NOT become "ok" — that would mask the schema error.
  assert.notEqual(sample.creditReport.sections[0].body, "ok");
  assert.equal(Array.isArray(sample.creditReport.sections[0].body), true);
  const problem = validateGeenbankKredietworkflowFinancierJson(sample);
  assert.ok(
    problem && /sections.*body/i.test(problem),
    `expected sections[*].body validator error, got ${problem}`,
  );
});

test("normalizeKredietworkflowFinancierPayload: object body whose recognised text key is itself an object is rejected (no recursion / no invention)", () => {
  const sample = buildFinancierSample();
  (sample.creditReport.sections[0] as unknown as { body: unknown }).body = {
    text: { content: "verstopt" },
  };
  normalizeKredietworkflowFinancierPayload(sample);
  assert.equal(typeof sample.creditReport.sections[0].body, "object");
  const problem = validateGeenbankKredietworkflowFinancierJson(sample);
  assert.ok(
    problem && /sections.*body/i.test(problem),
    `expected sections[*].body validator error, got ${problem}`,
  );
});

test("normalizeKredietworkflowFinancierPayload: object body without recognised text fields stays invalid (no invention)", () => {
  const sample = buildFinancierSample();
  (sample.creditReport.sections[0] as unknown as { body: unknown }).body = {
    score: 7,
    risk: "low",
  };
  normalizeKredietworkflowFinancierPayload(sample);
  assert.equal(typeof sample.creditReport.sections[0].body, "object");
  const problem = validateGeenbankKredietworkflowFinancierJson(sample);
  assert.ok(
    problem && /sections.*body/i.test(problem),
    `expected sections[*].body validator error, got ${problem}`,
  );
});

test("normalizeKredietworkflowFinancierPayload: empty section title still rejected after body normalization (no invention)", () => {
  const sample = buildFinancierSample();
  sample.creditReport.sections = [
    { title: "", body: "Geldige inhoud uit het model." },
  ];
  normalizeKredietworkflowFinancierPayload(sample);
  // Body trimmed, but empty title must still fail validation.
  assert.equal(sample.creditReport.sections[0].body, "Geldige inhoud uit het model.");
  const problem = validateGeenbankKredietworkflowFinancierJson(sample);
  assert.ok(
    problem && /sections.*title/i.test(problem),
    `expected sections[*].title validator error, got ${problem}`,
  );
});

test("kredietworkflow adapter: live OpenAI returning {body:{text:...}} sections is normalized + accepted (no fallback)", async () => {
  const { dossierId } = await createDossier();
  const [dossier] = await db
    .select()
    .from(dossiersTable)
    .where(inArray(dossiersTable.id, [dossierId]));
  const liveResponse = buildFinancierSample();
  // Reproduce the production failure mode for sections[*].body: the
  // model returned {text:"..."} objects instead of strings.
  liveResponse.creditReport.sections = [
    { title: "Inleiding", body: { text: "Casus voldoet aan acceptatiecriteria." } },
    { title: "Risico", body: ["Klantconcentratie top-3 = 55%.", "Bij stress DSCR > 1,1."] },
  ] as unknown as typeof liveResponse.creditReport.sections;
  setOpenAIChatClientForTesting(
    makeFakeOpenAI(() => ({
      content: JSON.stringify(liveResponse),
      model: "gpt-4o-mini",
    })),
  );
  try {
    await withKwEnv(
      { [KW_PROVIDER_ENV]: "openai", OPENAI_API_KEY: "sk-test-fake-1234567890" },
      async () => {
        const r = await GeenbankKredietworkflowAdapter.run(buildKwArgs(dossier));
        assert.equal(
          r.ok,
          true,
          `expected live success, got fallbackReason=${r.invocation.fallbackReason}`,
        );
        assert.equal(r.usedMockMode, false);
        assert.equal(r.invocation.fallbackReason, null);
        const extras = r.invocation.extras as
          | { canonical?: GeenbankKredietworkflowFinancierOutput }
          | null;
        assert.ok(extras?.canonical, "extras.canonical must be populated on live success");
        assert.equal(
          extras!.canonical!.creditReport.sections[0].body,
          "Casus voldoet aan acceptatiecriteria.",
        );
        assert.equal(
          extras!.canonical!.creditReport.sections[1].body,
          "Klantconcentratie top-3 = 55%.\n\nBij stress DSCR > 1,1.",
        );
      },
    );
  } finally {
    setOpenAIChatClientForTesting(null);
  }
});

test("kredietworkflow adapter: live OpenAI returning empty creditReport.headline is normalized + accepted (no fallback)", async () => {
  const { dossierId } = await createDossier();
  const [dossier] = await db
    .select()
    .from(dossiersTable)
    .where(inArray(dossiersTable.id, [dossierId]));
  const liveResponse = buildFinancierSample();
  // Reproduce the exact production failure mode: empty headline,
  // borrower.name + decision still present.
  (liveResponse.creditReport as unknown as { headline: unknown }).headline = "";
  setOpenAIChatClientForTesting(
    makeFakeOpenAI(() => ({
      content: JSON.stringify(liveResponse),
      model: "gpt-4o-mini",
    })),
  );
  try {
    await withKwEnv(
      { [KW_PROVIDER_ENV]: "openai", OPENAI_API_KEY: "sk-test-fake-1234567890" },
      async () => {
        const r = await GeenbankKredietworkflowAdapter.run(buildKwArgs(dossier));
        assert.equal(
          r.ok,
          true,
          `expected live success, got fallbackReason=${r.invocation.fallbackReason}`,
        );
        assert.equal(r.usedMockMode, false);
        assert.equal(r.invocation.fallbackReason, null);
        const extras = r.invocation.extras as
          | { canonical?: GeenbankKredietworkflowFinancierOutput }
          | null;
        assert.ok(extras?.canonical, "extras.canonical must be populated on live success");
        assert.equal(
          extras!.canonical!.creditReport.headline,
          `Kredietvoorstel ${liveResponse.borrower.name} — ${liveResponse.decision}`,
        );
      },
    );
  } finally {
    setOpenAIChatClientForTesting(null);
  }
});

test("kredietworkflow adapter: live OpenAI with unusable creditReport (headline normalized from rationale but summary still empty) falls back to mock cleanly", async () => {
  const { dossierId } = await createDossier();
  const [dossier] = await db
    .select()
    .from(dossiersTable)
    .where(inArray(dossiersTable.id, [dossierId]));
  const liveResponse = buildFinancierSample();
  // Headline gets derived from borrower+decision via the normalizer,
  // but `creditReport.summary` is an unrelated REQUIRED field that the
  // headline normalizer never touches. The validator must still
  // reject and the adapter must still fall back to the deterministic
  // mock with a structured fallbackReason mentioning creditReport.
  (liveResponse.creditReport as unknown as { headline: unknown }).headline = "";
  (liveResponse.creditReport as unknown as { summary: unknown }).summary = "";
  setOpenAIChatClientForTesting(
    makeFakeOpenAI(() => ({
      content: JSON.stringify(liveResponse),
      model: "gpt-4o-mini",
    })),
  );
  try {
    await withKwEnv(
      { [KW_PROVIDER_ENV]: "openai", OPENAI_API_KEY: "sk-test-fake-1234567890" },
      async () => {
        const r = await GeenbankKredietworkflowAdapter.run(buildKwArgs(dossier));
        assert.equal(r.usedMockMode, true);
        assert.equal(r.invocation.provider, "openai");
        assert.ok(
          r.invocation.fallbackReason &&
            /(creditReport|borrower|headline|summary)/i.test(r.invocation.fallbackReason),
          `unexpected fallbackReason: ${r.invocation.fallbackReason}`,
        );
        assert.ok(r.data.verdict);
      },
    );
  } finally {
    setOpenAIChatClientForTesting(null);
  }
});

test("validateGeenbankKredietworkflowFinancierJson rejects rateComment of wrong type", () => {
  const sample = buildFinancierSample();
  (sample.requestedStructure as unknown as { rateComment: unknown }).rateComment =
    42;
  const problem = validateGeenbankKredietworkflowFinancierJson(sample);
  assert.ok(problem && /rateComment/i.test(problem));
});

test("kredietworkflow adapter: live OpenAI returning \"8.5%\" rate is normalized + accepted (no fallback)", async () => {
  const { dossierId } = await createDossier();
  const [dossier] = await db
    .select()
    .from(dossiersTable)
    .where(inArray(dossiersTable.id, [dossierId]));
  // Build a live response with a percent-string rate on every
  // structure node — this is exactly the shape that triggered the
  // production failure ("requestedStructure.rate is geen geldig
  // getal of null").
  const liveResponse = buildFinancierSample();
  (liveResponse.requestedStructure as unknown as { rate: unknown }).rate =
    "8.5%";
  (liveResponse.recommendedStructure as unknown as { rate: unknown }).rate =
    "8.5%";
  (liveResponse.commercialProposal.structure as unknown as { rate: unknown }).rate =
    "8.5%";
  (liveResponse.termSheet.structure as unknown as { rate: unknown }).rate =
    "8.5%";
  setOpenAIChatClientForTesting(
    makeFakeOpenAI(() => ({
      content: JSON.stringify(liveResponse),
      model: "gpt-4o-mini",
    })),
  );
  try {
    await withKwEnv(
      { [KW_PROVIDER_ENV]: "openai", OPENAI_API_KEY: "sk-test-fake-1234567890" },
      async () => {
        const r = await GeenbankKredietworkflowAdapter.run(buildKwArgs(dossier));
        // Live path succeeded; no fallback to mock.
        assert.equal(r.ok, true);
        assert.equal(r.usedMockMode, false);
        assert.equal(r.invocation.fallbackReason, null);
        // Canonical canonical retains the normalized numeric rate.
        const extras = r.invocation.extras as
          | { canonical?: GeenbankKredietworkflowFinancierOutput }
          | null;
        assert.ok(extras?.canonical);
        assert.equal(extras!.canonical!.requestedStructure.rate, 8.5);
        assert.equal(extras!.canonical!.recommendedStructure.rate, 8.5);
      },
    );
  } finally {
    setOpenAIChatClientForTesting(null);
  }
});

test("kredietworkflow adapter: live OpenAI returning \"marktconform\" rate normalizes to rateComment (no fallback)", async () => {
  const { dossierId } = await createDossier();
  const [dossier] = await db
    .select()
    .from(dossiersTable)
    .where(inArray(dossiersTable.id, [dossierId]));
  const liveResponse = buildFinancierSample();
  (liveResponse.requestedStructure as unknown as { rate: unknown }).rate =
    "marktconform";
  (liveResponse.recommendedStructure as unknown as { rate: unknown }).rate =
    "marktconform";
  (liveResponse.commercialProposal.structure as unknown as { rate: unknown }).rate =
    "marktconform";
  (liveResponse.termSheet.structure as unknown as { rate: unknown }).rate =
    "marktconform";
  setOpenAIChatClientForTesting(
    makeFakeOpenAI(() => ({
      content: JSON.stringify(liveResponse),
      model: "gpt-4o-mini",
    })),
  );
  try {
    await withKwEnv(
      { [KW_PROVIDER_ENV]: "openai", OPENAI_API_KEY: "sk-test-fake-1234567890" },
      async () => {
        const r = await GeenbankKredietworkflowAdapter.run(buildKwArgs(dossier));
        assert.equal(r.ok, true);
        assert.equal(r.usedMockMode, false);
        assert.equal(r.invocation.fallbackReason, null);
        const extras = r.invocation.extras as
          | { canonical?: GeenbankKredietworkflowFinancierOutput }
          | null;
        assert.ok(extras?.canonical);
        assert.equal(extras!.canonical!.requestedStructure.rate, null);
        assert.equal(
          extras!.canonical!.requestedStructure.rateComment,
          "marktconform",
        );
      },
    );
  } finally {
    setOpenAIChatClientForTesting(null);
  }
});

test("kredietworkflow adapter: live OpenAI with truly invalid rate (boolean) still falls back to mock cleanly", async () => {
  // NB: a boolean rate is normalized to `rate=null + rateComment=String(rawRate)`,
  // so the structure becomes valid. To exercise the *fallback* path we
  // need a different field to be malformed — confirming pricing
  // normalization does NOT swallow unrelated schema violations.
  const { dossierId } = await createDossier();
  const [dossier] = await db
    .select()
    .from(dossiersTable)
    .where(inArray(dossiersTable.id, [dossierId]));
  const liveResponse = buildFinancierSample();
  (liveResponse.requestedStructure as unknown as { rate: unknown }).rate = true;
  // Now break an unrelated field that the normalizer does NOT touch.
  (liveResponse as unknown as { decision: unknown }).decision = "approved";
  setOpenAIChatClientForTesting(
    makeFakeOpenAI(() => ({
      content: JSON.stringify(liveResponse),
      model: "gpt-4o-mini",
    })),
  );
  try {
    await withKwEnv(
      { [KW_PROVIDER_ENV]: "openai", OPENAI_API_KEY: "sk-test-fake-1234567890" },
      async () => {
        const r = await GeenbankKredietworkflowAdapter.run(buildKwArgs(dossier));
        assert.equal(r.usedMockMode, true);
        assert.equal(r.invocation.provider, "openai");
        assert.ok(
          r.invocation.fallbackReason &&
            /decision/i.test(r.invocation.fallbackReason),
          `unexpected fallbackReason: ${r.invocation.fallbackReason}`,
        );
        // Deterministic mock still produced an answer.
        assert.ok(r.data.verdict);
      },
    );
  } finally {
    setOpenAIChatClientForTesting(null);
  }
});

test("validateGeenbankKredietworkflowFinancierJson still rejects empty borrower.name (not weakened)", () => {
  const sample = buildFinancierSample();
  const bad = { ...sample, borrower: { ...sample.borrower, name: "" } };
  const problem = validateGeenbankKredietworkflowFinancierJson(bad);
  assert.ok(problem && /borrower\.name/i.test(problem));
  const bad2 = { ...sample, borrower: { ...sample.borrower, name: "   " } };
  const problem2 = validateGeenbankKredietworkflowFinancierJson(bad2);
  assert.ok(problem2 && /borrower\.name/i.test(problem2));
});

test("seed.ts: every demo prospect profile insert has a non-empty companyName literal", async () => {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const seedSrc = await fs.readFile(
    path.resolve("src/lib/seed.ts"),
    "utf8",
  );
  // Find every `companyName: "..."` literal under prospectProfilesTable inserts.
  const matches = [...seedSrc.matchAll(/companyName:\s*"([^"]*)"/g)];
  assert.ok(matches.length >= 3, "expected at least 3 seeded prospect profiles");
  for (const m of matches) {
    assert.ok(m[1].trim().length > 0, `seed has empty companyName literal: ${m[0]}`);
  }
  // Anne / Brouwerij Noord must be present and a real company name.
  assert.ok(
    seedSrc.includes('companyName: "Brouwerij Noord B.V."'),
    "Anne/Brouwerij Noord seed prospect must have companyName 'Brouwerij Noord B.V.'",
  );
});

test("kredietworkflow adapter never leaks OPENAI_API_KEY into the SkillInvocation", async () => {
  const { dossierId } = await createDossier();
  const [dossier] = await db
    .select()
    .from(dossiersTable)
    .where(inArray(dossiersTable.id, [dossierId]));
  const secretKey = "sk-test-kwsecretvalue-shouldnotleak-9999999999";
  const liveResponse = {
    ...buildKwLiveResponse({
      decisionRationale: `key=${secretKey}`,
    }),
    api_key: secretKey,
    authorization: `Bearer ${secretKey}`,
  };
  setOpenAIChatClientForTesting(
    makeFakeOpenAI(() => ({
      content: JSON.stringify(liveResponse),
      model: "gpt-4o-mini",
    })),
  );
  try {
    await withKwEnv(
      { [KW_PROVIDER_ENV]: "openai", OPENAI_API_KEY: secretKey },
      async () => {
        const r = await GeenbankKredietworkflowAdapter.run(
          buildKwArgs(dossier),
        );
        const serialized = JSON.stringify(r.invocation);
        assert.ok(!serialized.includes(secretKey), "raw secret key leaked");
        assert.ok(
          !/sk-test-kwsecretvalue-shouldnotleak/.test(serialized),
          "raw secret prefix leaked",
        );
      },
    );
  } finally {
    setOpenAIChatClientForTesting(null);
  }
});

test("kredietworkflow live pilot does NOT promote other adapters; dual-view stays independently live-capable", async () => {
  const { dossierId } = await createDossier();
  const [dossier] = await db
    .select()
    .from(dossiersTable)
    .where(inArray(dossiersTable.id, [dossierId]));
  // Set ONLY the kredietworkflow per-skill provider env. Explicitly
  // scrub the dual-view per-skill env so a leaked value from earlier
  // tests cannot make the dual-view adapter go live in this scenario.
  // The four other adapters must remain on mock and must NOT call the
  // OpenAI client just because the kredietworkflow env is set.
  let openAiCalls = 0;
  setOpenAIChatClientForTesting(
    makeFakeOpenAI(() => {
      openAiCalls += 1;
      throw new Error("only kredietworkflow should call OpenAI in this test");
    }),
  );
  const savedDual = process.env[DUAL_PROVIDER_ENV];
  delete process.env[DUAL_PROVIDER_ENV];
  try {
    await withKwEnv(
      {
        [KW_PROVIDER_ENV]: "openai",
        OPENAI_API_KEY: "sk-test-fake-1234567890",
      },
      async () => {
        const ctx = ctxFor(dossier);
        const need = await FinancingNeedAssessorAdapter.run(ctx);
        const credit = await CreditProductAdvisorAdapter.run(ctx);
        const dual = await FinancingProductAdvisorDualViewAdapter.run(ctx);
        // None of these should have hit the (throwing) fake.
        assert.equal(openAiCalls, 0, "non-pilot adapters must not call OpenAI");
        assert.equal(need.usedMockMode, true);
        assert.equal(credit.usedMockMode, true);
        assert.equal(dual.usedMockMode, true);
      },
    );
  } finally {
    setOpenAIChatClientForTesting(null);
    if (savedDual === undefined) delete process.env[DUAL_PROVIDER_ENV];
    else process.env[DUAL_PROVIDER_ENV] = savedDual;
  }
});

test("dual-view adapter remains live-capable with its own per-skill provider env (regression)", async () => {
  const { dossierId } = await createDossier();
  const [dossier] = await db
    .select()
    .from(dossiersTable)
    .where(inArray(dossiersTable.id, [dossierId]));
  setOpenAIChatClientForTesting(
    makeFakeOpenAI(() => ({
      content: JSON.stringify({
        entrepreneur_view: {
          summary: "OK",
          strengths: [],
          weaknesses: [],
          financeability_score: 7,
          submission_readiness_score: 7,
          cta_status: "ready_to_submit",
          todo_minimum: [],
          todo_optimal: [],
        },
        partner_view: {
          recommended_product: "loan",
          alternative_product: "",
          recommended_product_mix: [],
          recommendation_status: "strong",
          rationale: [],
          key_risks: [],
          evidence_gaps: [],
          indicative_structure: {
            amount: 200000,
            tenor_months: 60,
            repayment_logic: "annuiteit",
            collateral_logic: "borg",
            conditions: [],
          },
          shortlisted_products: [],
        },
      }),
      model: "gpt-4o-mini",
    })),
  );
  try {
    await withDualEnv(
      { [DUAL_PROVIDER_ENV]: "openai", OPENAI_API_KEY: "sk-test-fake-1234567890" },
      async () => {
        const r = await FinancingProductAdvisorDualViewAdapter.run(
          ctxFor(dossier),
        );
        assert.equal(r.usedMockMode, false);
        assert.equal(r.invocation.provider, "openai");
        assert.equal(r.invocation.model, "gpt-4o-mini");
      },
    );
  } finally {
    setOpenAIChatClientForTesting(null);
  }
});

// --- KW Structured Outputs (json_schema) ----------------------------------
//
// Tests that lock in the live OpenAI Structured Outputs migration:
//
// 1. KW_FINANCIER_JSON_SCHEMA compiles in ajv (= valid JSON Schema).
// 2. Schema accepts the same happy fixture the TS validator accepts.
// 3. Schema rejects the same four core mutations the TS validator
//    rejects (decision-out-of-enum, missing/empty creditReport.headline,
//    non-string creditReport.sections[*].body, non-array conditions).
// 4. `buildOpenAIRequestBody` serialises a json_schema responseFormat to
//    `{ type: "json_schema", json_schema: { name, schema, strict: true } }`
//    on the wire body.
// 5. With KW_USE_STRUCTURED_OUTPUTS=true and a fake client returning a
//    valid fixture, the live KW path succeeds without normalizer fallback.
// 6. Regression: defensive `normalizeStructureRate` still runs through
//    the structured-outputs path — a fake client returning rate:"8,5%"
//    is normalized to a number and the call still succeeds.
// 7. With KW_USE_STRUCTURED_OUTPUTS=true and the fake client throwing
//    `OpenAIHttpError(400, ...)` on the first call, the adapter retries
//    once with `responseFormat: "json_object"` and the live path still
//    succeeds (= the documented unsupported-model fallback).

test("KW_FINANCIER_JSON_SCHEMA: ajv compiles the schema", () => {
  const ajv = new Ajv({ allErrors: false, strict: false });
  const validate = ajv.compile(KW_FINANCIER_JSON_SCHEMA);
  assert.equal(typeof validate, "function");
});

test("KW_FINANCIER_JSON_SCHEMA: accepts the happy fixture (parity with TS validator)", () => {
  const ajv = new Ajv({ allErrors: false, strict: false });
  const validate = ajv.compile(KW_FINANCIER_JSON_SCHEMA);
  const sample = buildFinancierSample();
  // Sanity: TS validator agrees.
  assert.equal(validateGeenbankKredietworkflowFinancierJson(sample), null);
  const ok = validate(sample);
  assert.equal(
    ok,
    true,
    `JSON schema rejected the happy fixture: ${JSON.stringify(validate.errors)}`,
  );
});

test("KW_FINANCIER_JSON_SCHEMA: rejects invalid decision (parity)", () => {
  const ajv = new Ajv({ allErrors: false, strict: false });
  const validate = ajv.compile(KW_FINANCIER_JSON_SCHEMA);
  const bad = { ...buildFinancierSample(), decision: "Maybe" };
  assert.notEqual(
    validateGeenbankKredietworkflowFinancierJson(bad),
    null,
    "TS validator should reject invalid decision",
  );
  assert.equal(validate(bad), false);
});

test("KW_FINANCIER_JSON_SCHEMA: rejects missing/empty creditReport.headline (parity)", () => {
  const ajv = new Ajv({ allErrors: false, strict: false });
  const validate = ajv.compile(KW_FINANCIER_JSON_SCHEMA);
  const sample = buildFinancierSample();
  const bad = {
    ...sample,
    creditReport: { ...sample.creditReport, headline: "" },
  };
  assert.notEqual(
    validateGeenbankKredietworkflowFinancierJson(bad),
    null,
    "TS validator should reject empty headline",
  );
  assert.equal(validate(bad), false);
});

test("KW_FINANCIER_JSON_SCHEMA: rejects non-string creditReport.sections[*].body (parity)", () => {
  const ajv = new Ajv({ allErrors: false, strict: false });
  const validate = ajv.compile(KW_FINANCIER_JSON_SCHEMA);
  const sample = buildFinancierSample();
  const bad = {
    ...sample,
    creditReport: {
      ...sample.creditReport,
      sections: [{ title: "Risico", body: 42 as unknown as string }],
    },
  };
  assert.notEqual(
    validateGeenbankKredietworkflowFinancierJson(bad),
    null,
    "TS validator should reject non-string section body",
  );
  assert.equal(validate(bad), false);
});

test("KW_FINANCIER_JSON_SCHEMA: rejects non-array conditions (parity)", () => {
  const ajv = new Ajv({ allErrors: false, strict: false });
  const validate = ajv.compile(KW_FINANCIER_JSON_SCHEMA);
  const bad = {
    ...buildFinancierSample(),
    conditions: "geen condities" as unknown as never[],
  };
  assert.notEqual(
    validateGeenbankKredietworkflowFinancierJson(bad),
    null,
    "TS validator should reject non-array conditions",
  );
  assert.equal(validate(bad), false);
});

test("buildOpenAIRequestBody serialises json_schema responseFormat correctly", () => {
  const body = buildOpenAIRequestBody({
    model: "gpt-4o-mini",
    temperature: 0,
    responseFormat: {
      type: "json_schema",
      schema: {
        name: "GeenbankKredietworkflowFinancierOutput",
        schema: KW_FINANCIER_JSON_SCHEMA,
        strict: true,
      },
    },
    messages: [{ role: "user", content: "hi" }],
  });
  assert.deepEqual(body.response_format, {
    type: "json_schema",
    json_schema: {
      name: "GeenbankKredietworkflowFinancierOutput",
      schema: KW_FINANCIER_JSON_SCHEMA,
      strict: true,
    },
  });
  assert.equal(body.model, "gpt-4o-mini");
  assert.equal(body.temperature, 0);
});

test("buildOpenAIRequestBody json_object form is unchanged (backward compat)", () => {
  const body = buildOpenAIRequestBody({
    model: "gpt-4o-mini",
    responseFormat: "json_object",
    messages: [{ role: "user", content: "hi" }],
  });
  assert.deepEqual(body.response_format, { type: "json_object" });
});

test("kredietworkflow live path with KW_USE_STRUCTURED_OUTPUTS=true sends json_schema and succeeds", async () => {
  const { dossierId } = await createDossier();
  const [dossier] = await db
    .select()
    .from(dossiersTable)
    .where(inArray(dossiersTable.id, [dossierId]));
  let observedResponseFormat: unknown = undefined;
  setOpenAIChatClientForTesting({
    async chat(req) {
      observedResponseFormat = req.responseFormat;
      return {
        content: JSON.stringify(buildFinancierSample()),
        model: "gpt-4o-mini-2024-07-18",
      };
    },
  });
  try {
    await withKwEnv(
      {
        [KW_PROVIDER_ENV]: "openai",
        OPENAI_API_KEY: "sk-test-fake-1234567890",
        KW_USE_STRUCTURED_OUTPUTS: "true",
      },
      async () => {
        const r = await GeenbankKredietworkflowAdapter.run(buildKwArgs(dossier));
        assert.equal(r.ok, true);
        assert.equal(r.usedMockMode, false);
        assert.equal(r.invocation.usedMockMode, false);
        assert.equal(r.invocation.provider, "openai");
        assert.equal(r.invocation.fallbackReason, null);
        const extras = r.invocation.extras as { canonical?: unknown } | null;
        assert.ok(extras && extras.canonical, "extras.canonical missing");
        // The adapter MUST have asked the client for json_schema.
        assert.ok(
          typeof observedResponseFormat === "object" &&
            observedResponseFormat !== null &&
            (observedResponseFormat as { type?: string }).type === "json_schema",
          `expected json_schema responseFormat, got ${JSON.stringify(observedResponseFormat)}`,
        );
        const rf = observedResponseFormat as {
          schema: { name: string; strict: boolean };
        };
        assert.equal(rf.schema.name, "GeenbankKredietworkflowFinancierOutput");
        assert.equal(rf.schema.strict, true);
      },
    );
  } finally {
    setOpenAIChatClientForTesting(null);
  }
});

test("kredietworkflow structured-outputs path still applies defensive normalizers (rate string)", async () => {
  const { dossierId } = await createDossier();
  const [dossier] = await db
    .select()
    .from(dossiersTable)
    .where(inArray(dossiersTable.id, [dossierId]));
  // Simulate a model that, despite strict json_schema, somehow emits a
  // rate-as-string. Defensive normalizer must coerce it before validation.
  const sample = buildFinancierSample();
  const payload = JSON.parse(JSON.stringify(sample)) as Record<string, unknown>;
  (payload.requestedStructure as Record<string, unknown>).rate = "8,5%";
  (payload.recommendedStructure as Record<string, unknown>).rate = "8,5%";
  ((payload.commercialProposal as Record<string, unknown>).structure as Record<
    string,
    unknown
  >).rate = "8,5%";
  ((payload.termSheet as Record<string, unknown>).structure as Record<
    string,
    unknown
  >).rate = "8,5%";
  setOpenAIChatClientForTesting(
    makeFakeOpenAI(() => ({
      content: JSON.stringify(payload),
      model: "gpt-4o-mini-2024-07-18",
    })),
  );
  try {
    await withKwEnv(
      {
        [KW_PROVIDER_ENV]: "openai",
        OPENAI_API_KEY: "sk-test-fake-1234567890",
        KW_USE_STRUCTURED_OUTPUTS: "true",
      },
      async () => {
        const r = await GeenbankKredietworkflowAdapter.run(buildKwArgs(dossier));
        assert.equal(r.ok, true);
        assert.equal(r.usedMockMode, false);
        assert.equal(r.invocation.fallbackReason, null);
        const extras = r.invocation.extras as
          | { canonical?: GeenbankKredietworkflowFinancierOutput }
          | null;
        assert.equal(extras?.canonical?.requestedStructure.rate, 8.5);
      },
    );
  } finally {
    setOpenAIChatClientForTesting(null);
  }
});

test("kredietworkflow retries with json_object on HTTP 400 from json_schema (unsupported-model fallback)", async () => {
  const { dossierId } = await createDossier();
  const [dossier] = await db
    .select()
    .from(dossiersTable)
    .where(inArray(dossiersTable.id, [dossierId]));
  const observedFormats: unknown[] = [];
  let calls = 0;
  setOpenAIChatClientForTesting({
    async chat(req) {
      calls += 1;
      observedFormats.push(req.responseFormat);
      if (calls === 1) {
        throw new OpenAIHttpError(
          400,
          "OpenAI HTTP 400 Bad Request: response_format json_schema not supported",
        );
      }
      return {
        content: JSON.stringify(buildFinancierSample()),
        model: "gpt-5.2-fake",
      };
    },
  });
  try {
    await withKwEnv(
      {
        [KW_PROVIDER_ENV]: "openai",
        OPENAI_API_KEY: "sk-test-fake-1234567890",
        KW_USE_STRUCTURED_OUTPUTS: "true",
      },
      async () => {
        const r = await GeenbankKredietworkflowAdapter.run(buildKwArgs(dossier));
        assert.equal(r.ok, true);
        assert.equal(r.usedMockMode, false);
        assert.equal(r.invocation.fallbackReason, null);
        assert.equal(calls, 2);
        assert.ok(
          typeof observedFormats[0] === "object" &&
            (observedFormats[0] as { type?: string })?.type === "json_schema",
        );
        assert.equal(observedFormats[1], "json_object");
      },
    );
  } finally {
    setOpenAIChatClientForTesting(null);
  }
});

test("kredietworkflow does NOT retry on non-400 errors from structured outputs path", async () => {
  const { dossierId } = await createDossier();
  const [dossier] = await db
    .select()
    .from(dossiersTable)
    .where(inArray(dossiersTable.id, [dossierId]));
  let calls = 0;
  setOpenAIChatClientForTesting({
    async chat() {
      calls += 1;
      throw new OpenAIHttpError(503, "OpenAI HTTP 503 Service Unavailable");
    },
  });
  try {
    await withKwEnv(
      {
        [KW_PROVIDER_ENV]: "openai",
        OPENAI_API_KEY: "sk-test-fake-1234567890",
        KW_USE_STRUCTURED_OUTPUTS: "true",
      },
      async () => {
        const r = await GeenbankKredietworkflowAdapter.run(buildKwArgs(dossier));
        assert.equal(r.usedMockMode, true);
        assert.equal(calls, 1);
        assert.ok(
          r.invocation.fallbackReason &&
            /503/.test(r.invocation.fallbackReason),
          `expected 503 in fallbackReason, got ${r.invocation.fallbackReason}`,
        );
      },
    );
  } finally {
    setOpenAIChatClientForTesting(null);
  }
});

test("kredietworkflow stays on json_object path when KW_USE_STRUCTURED_OUTPUTS is unset (rollback)", async () => {
  const { dossierId } = await createDossier();
  const [dossier] = await db
    .select()
    .from(dossiersTable)
    .where(inArray(dossiersTable.id, [dossierId]));
  let observed: unknown;
  setOpenAIChatClientForTesting({
    async chat(req) {
      observed = req.responseFormat;
      return {
        content: JSON.stringify(buildFinancierSample()),
        model: "gpt-4o-mini",
      };
    },
  });
  try {
    await withKwEnv(
      {
        [KW_PROVIDER_ENV]: "openai",
        OPENAI_API_KEY: "sk-test-fake-1234567890",
        KW_USE_STRUCTURED_OUTPUTS: undefined,
      },
      async () => {
        const r = await GeenbankKredietworkflowAdapter.run(buildKwArgs(dossier));
        assert.equal(r.ok, true);
        assert.equal(r.usedMockMode, false);
        assert.equal(observed, "json_object");
      },
    );
  } finally {
    setOpenAIChatClientForTesting(null);
  }
});

// --- serializeRunForProspect: hide internal financier output from prospects --

import {
  serializeRun as serializeRunForProspectTest_serializeRun,
  serializeRunForProspect,
} from "../lib/serializers";

function makeRunWithKw(): Parameters<typeof serializeRunForProspect>[0] {
  const now = new Date();
  return {
    id: "run-1",
    dossierId: "dossier-1",
    runType: "full_analysis",
    status: "completed",
    startedAt: now,
    completedAt: now,
    skillModulesUsed: ["GeenbankKredietworkflow"],
    skillInvocations: [
      {
        skillName: "GeenbankKredietworkflow",
        provider: "openai",
        usedMockMode: false,
        fallbackReason: null,
        model: "gpt-test",
        endpoint: null,
        assistantId: null,
        startedAt: now.toISOString(),
        completedAt: now.toISOString(),
        durationMs: 100,
        ok: true,
        inputSummary: "x",
        outputSummary: "y",
        errorMessage: null,
        extras: {
          skill: "GeenbankKredietworkflow",
          gateApplied: false,
          canonical: { decision: "Conditional Go", creditReport: { headline: "h" } },
        },
        creditReport: { headline: "leaked at top" },
        recommendedStructure: { facilityType: "x" },
        commercialProposal: { summary: "y" },
        termSheet: { summary: "z" },
        pricingIndication: { components: [] },
      },
      {
        skillName: "FinancingProductAdvisorDualView",
        provider: "openai",
        usedMockMode: false,
        fallbackReason: null,
        model: "gpt-test",
        endpoint: null,
        assistantId: null,
        startedAt: now.toISOString(),
        completedAt: now.toISOString(),
        durationMs: 50,
        ok: true,
        inputSummary: "x",
        outputSummary: "y",
        errorMessage: null,
        extras: { skill: "FinancingProductAdvisorDualView", response: { foo: "bar" } },
      },
    ],
    completenessScore: 90,
    correctnessScore: 90,
    viabilityScore: 80,
    confidenceScore: 72,
    verdict: "voorwaardelijk",
    verdictSummary: "ok",
    usedMockMode: false,
    errors: [],
  } as unknown as Parameters<typeof serializeRunForProspect>[0];
}

test("serializeRun (officer) preserves canonical + internal financier fields", () => {
  const out = serializeRunForProspectTest_serializeRun(makeRunWithKw());
  const kw = out.skillInvocations.find(
    (i) => (i as { skillName: string }).skillName === "GeenbankKredietworkflow",
  ) as Record<string, unknown>;
  const extras = kw.extras as Record<string, unknown>;
  assert.ok(extras.canonical, "officer must keep extras.canonical");
  assert.ok(kw.creditReport, "officer must keep top-level creditReport");
  assert.ok(kw.commercialProposal, "officer must keep top-level commercialProposal");
});

test("serializeRunForProspect strips canonical and internal financier fields", () => {
  const out = serializeRunForProspect(makeRunWithKw());
  // Top-level run fields preserved.
  assert.equal(out.verdict, "voorwaardelijk");
  assert.equal(out.status, "completed");
  // Each invocation: no canonical, no internal financier keys, anywhere.
  for (const inv of out.skillInvocations) {
    const r = inv as Record<string, unknown>;
    assert.equal(r.creditReport, undefined);
    assert.equal(r.recommendedStructure, undefined);
    assert.equal(r.commercialProposal, undefined);
    assert.equal(r.termSheet, undefined);
    assert.equal(r.pricingIndication, undefined);
    if (r.extras && typeof r.extras === "object") {
      const ex = r.extras as Record<string, unknown>;
      assert.equal(ex.canonical, undefined);
      assert.equal(ex.creditReport, undefined);
      assert.equal(ex.recommendedStructure, undefined);
      assert.equal(ex.commercialProposal, undefined);
      assert.equal(ex.termSheet, undefined);
      assert.equal(ex.pricingIndication, undefined);
    }
  }
  // Belt-and-braces: no JSON substring of these keys remains.
  const json = JSON.stringify(out);
  for (const k of [
    "\"canonical\"",
    "\"creditReport\"",
    "\"recommendedStructure\"",
    "\"commercialProposal\"",
    "\"termSheet\"",
    "\"pricingIndication\"",
  ]) {
    assert.ok(!json.includes(k), `prospect payload still contains key ${k}`);
  }
  // Other extras (e.g. DualView's response) and bookkeeping keys are kept.
  const dual = out.skillInvocations.find(
    (i) => (i as { skillName: string }).skillName === "FinancingProductAdvisorDualView",
  ) as Record<string, unknown>;
  const dualExtras = dual.extras as Record<string, unknown>;
  assert.ok(dualExtras.response, "DualView's non-canonical extras must be preserved");
  const kw = out.skillInvocations.find(
    (i) => (i as { skillName: string }).skillName === "GeenbankKredietworkflow",
  ) as Record<string, unknown>;
  const kwExtras = kw.extras as Record<string, unknown>;
  assert.equal(kwExtras.skill, "GeenbankKredietworkflow");
  assert.equal(kwExtras.gateApplied, false);
});

test("serializeRunForProspect does not mutate the input run", () => {
  const run = makeRunWithKw();
  serializeRunForProspect(run);
  const kw = (run.skillInvocations as Array<Record<string, unknown>>)[0];
  const extras = kw.extras as Record<string, unknown>;
  assert.ok(extras.canonical, "input run must remain untouched");
  assert.ok(kw.creditReport, "input run top-level keys must remain untouched");
});
