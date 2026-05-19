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
    // Pilot-account hygiene summary. Derived from `status` and
    // `password_rotated_at` — never exposes hashes or any password
    // material.
    //
    //  - activeRotated      : active accounts whose password has been
    //                         rotated away from the seed value.
    //  - activeUnrotated    : active accounts that still carry their
    //                         original seed/demo password. This is the
    //                         only condition that produces a blocking
    //                         warning.
    //  - disabledUnrotated  : disabled accounts that still have the
    //                         seed hash on file. Surfaced as a
    //                         lower-severity note (informational).
    //  - disabled           : total disabled accounts (any reason).
    let pilotAccounts = {
      activeRotated: 0,
      activeUnrotated: 0,
      disabledUnrotated: 0,
      disabled: 0,
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
      const [activeRotated] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(usersTable)
        .where(
          sql`${usersTable.status} = 'active' AND ${usersTable.passwordRotatedAt} IS NOT NULL`,
        );
      const [activeUnrotated] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(usersTable)
        .where(
          sql`${usersTable.status} = 'active' AND ${usersTable.passwordRotatedAt} IS NULL`,
        );
      const [disabledUnrotated] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(usersTable)
        .where(
          sql`${usersTable.status} = 'disabled' AND ${usersTable.passwordRotatedAt} IS NULL`,
        );
      const [disabled] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(usersTable)
        .where(sql`${usersTable.status} = 'disabled'`);
      counts = {
        admin: admin?.n ?? 0,
        loanOfficer: officer?.n ?? 0,
        prospect: prospect?.n ?? 0,
        dossier: dossier?.n ?? 0,
        partner: partner?.n ?? 0,
        prospectProfile: profile?.n ?? 0,
      };
      pilotAccounts = {
        activeRotated: activeRotated?.n ?? 0,
        activeUnrotated: activeUnrotated?.n ?? 0,
        disabledUnrotated: disabledUnrotated?.n ?? 0,
        disabled: disabled?.n ?? 0,
      };
      dbReachable = true;
    } catch {
      dbReachable = false;
    }

    const demoWarning =
      pilotAccounts.activeUnrotated > 0
        ? `Demo-wachtwoorden zijn nog actief op ${pilotAccounts.activeUnrotated} actieve account(s). Roteer deze wachtwoorden vóór externe pilot-toegang.`
        : null;
    const demoNotice =
      pilotAccounts.activeUnrotated === 0 &&
      pilotAccounts.disabledUnrotated > 0
        ? `${pilotAccounts.disabledUnrotated} gedeactiveerde demo-account(s) hebben nog hun originele seed-wachtwoord. Niet blokkerend — ze kunnen niet inloggen.`
        : null;

    res.json({
      app: {
        status: "ok",
        nodeEnv: env.nodeEnv,
        timestamp: new Date().toISOString(),
        commit: process.env.REPL_DEPLOYMENT_ID ?? process.env.GIT_COMMIT ?? null,
      },
      database: { reachable: dbReachable, counts },
      pilotAccounts,
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
      demoWarning,
      demoNotice,
    });
  },
);

export default router;
