import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import {
  db,
  usersTable,
  dossiersTable,
  partnerFinanciersTable,
  prospectProfilesTable,
} from "@workspace/db";
import { requireAuth } from "../lib/auth";
import { buildEnvReport } from "../lib/env-validation";
import {
  pipedriveStatus,
  sendgridStatus,
  aiSkillsStatus,
  objectStorageStatus,
} from "../lib/integrations";

const router: IRouter = Router();

router.get(
  "/admin/pilot-status",
  requireAuth(["admin"]),
  async (_req, res): Promise<void> => {
    const env = buildEnvReport();
    let dbReachable = false;
    let counts = {
      admin: 0,
      loanOfficer: 0,
      prospect: 0,
      dossier: 0,
      partner: 0,
      prospectProfile: 0,
    };
    try {
      const [admin] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(usersTable)
        .where(sql`${usersTable.role} = 'admin'`);
      const [officer] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(usersTable)
        .where(sql`${usersTable.role} = 'loan_officer'`);
      const [prospect] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(usersTable)
        .where(sql`${usersTable.role} = 'prospect'`);
      const [dossier] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(dossiersTable);
      const [partner] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(partnerFinanciersTable);
      const [profile] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(prospectProfilesTable);
      counts = {
        admin: admin?.n ?? 0,
        loanOfficer: officer?.n ?? 0,
        prospect: prospect?.n ?? 0,
        dossier: dossier?.n ?? 0,
        partner: partner?.n ?? 0,
        prospectProfile: profile?.n ?? 0,
      };
      dbReachable = true;
    } catch {
      dbReachable = false;
    }
    res.json({
      app: {
        status: "ok",
        nodeEnv: env.nodeEnv,
        timestamp: new Date().toISOString(),
        commit: process.env.REPL_DEPLOYMENT_ID ?? process.env.GIT_COMMIT ?? null,
      },
      database: { reachable: dbReachable, counts },
      env: {
        required: env.required,
        optional: env.optional,
        missingRequired: env.missingRequired,
      },
      integrations: {
        pipedrive: pipedriveStatus(),
        sendgrid: sendgridStatus(),
        aiSkills: aiSkillsStatus(),
        objectStorage: objectStorageStatus(),
        partnerSending: {
          name: "Partner Sending",
          live: env.integrations.partnerSending === "live",
          message:
            env.integrations.partnerSending === "live"
              ? "Live — partneraanvragen worden daadwerkelijk verstuurd."
              : "Mock-modus — partneraanvragen worden gelogd maar niet daadwerkelijk verstuurd.",
        },
      },
      autoSeed: env.autoSeed,
      demoWarning:
        counts.admin > 0 || counts.loanOfficer > 0
          ? "Demo-wachtwoorden zijn nog actief. Roteer admin- en loan-officer wachtwoorden vóór externe pilot-toegang."
          : null,
    });
  },
);

export default router;
