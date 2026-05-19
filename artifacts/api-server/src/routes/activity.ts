import { Router, type IRouter } from "express";
import { desc, eq, inArray, or } from "drizzle-orm";
import {
  db,
  activityLogsTable,
  dossiersTable,
  prospectProfilesTable,
} from "@workspace/db";
import { ListRecentActivityQueryParams } from "@workspace/api-zod";
import { requireAuth } from "../lib/auth";
import { serializeActivity } from "../lib/serializers";
import {
  OFFICER_VISIBLE_STATUSES,
  OFFICER_VISIBLE_INTAKE_SOURCES,
} from "../lib/dossier-access";

const router: IRouter = Router();

router.get("/activity", requireAuth(["loan_officer", "admin"]), async (req, res): Promise<void> => {
  const params = ListRecentActivityQueryParams.safeParse(req.query);
  const limit = params.success ? params.data.limit ?? 25 : 25;
  // Only surface activity for dossiers visible to officers — never leak
  // existence of pre-submission/intake-only dossiers that weren't created
  // by an officer.
  const visibleDossiers = await db
    .select({ id: dossiersTable.id })
    .from(dossiersTable)
    .innerJoin(prospectProfilesTable, eq(prospectProfilesTable.id, dossiersTable.prospectId))
    .where(
      or(
        inArray(dossiersTable.status, [...OFFICER_VISIBLE_STATUSES]),
        inArray(prospectProfilesTable.source, [...OFFICER_VISIBLE_INTAKE_SOURCES]),
      ),
    );
  const visibleIds = new Set(visibleDossiers.map((d) => d.id));
  const items = await db
    .select()
    .from(activityLogsTable)
    .orderBy(desc(activityLogsTable.createdAt))
    .limit(limit * 4);
  const filtered = items
    .filter((a) => a.dossierId === null || visibleIds.has(a.dossierId))
    .slice(0, limit);
  res.json(filtered.map(serializeActivity));
});

export default router;
