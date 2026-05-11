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
  validateGeenbankKredietworkflowFinancierJson,
  GEENBANK_KREDIETWORKFLOW_DECISIONS,
  GEENBANK_KREDIETWORKFLOW_FEASIBILITIES,
  type GeenbankKredietworkflowFinancierOutput,
} from "../lib/skills/geenbank-kredietworkflow-financier-schema";
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

function ctxFor(dossier: typeof dossiersTable.$inferSelect) {
  return { dossier, documents: [], companyName: "Test BV" };
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
  };
  delete process.env.AI_SKILL_PROVIDER;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.AI_API_KEY;
  delete process.env.AI_SKILL_ENDPOINT;
  delete process.env[DUAL_PROVIDER_ENV];
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
  };
  delete process.env.AI_SKILL_PROVIDER;
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
      tenor: "60 mnd",
      repaymentProfile: "annuïtair",
      purpose: "groei en werkkapitaal",
    },
    recommendedStructure: {
      facilityType: "Annuïteitenlening",
      amount: 250000,
      rate: 0.069,
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
