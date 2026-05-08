import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import {
  db,
  conditionsTable,
  dossiersTable,
  prospectProfilesTable,
} from "@workspace/db";
import { ListConditionsParams } from "@workspace/api-zod";
import { requireAuth } from "../lib/auth";
import { serializeCondition } from "../lib/serializers";
import { officerCanAccessDossier } from "../lib/dossier-access";

const router: IRouter = Router();

router.get("/dossiers/me/conditions", requireAuth(["prospect"]), async (req, res): Promise<void> => {
  const [prospect] = await db
    .select()
    .from(prospectProfilesTable)
    .where(eq(prospectProfilesTable.userId, req.user!.id))
    .limit(1);
  if (!prospect) {
    res.json([]);
    return;
  }
  const [dossier] = await db
    .select()
    .from(dossiersTable)
    .where(eq(dossiersTable.prospectId, prospect.id))
    .limit(1);
  if (!dossier) {
    res.json([]);
    return;
  }
  const items = await db
    .select()
    .from(conditionsTable)
    .where(eq(conditionsTable.dossierId, dossier.id))
    .orderBy(desc(conditionsTable.createdAt));
  res.json(items.map(serializeCondition));
});

router.get("/dossiers/:dossierId/conditions", requireAuth(["loan_officer", "admin"]), async (req, res): Promise<void> => {
  const params = ListConditionsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!(await officerCanAccessDossier(params.data.dossierId))) {
    res.status(404).json({ error: "Dossier niet gevonden" });
    return;
  }
  const items = await db
    .select()
    .from(conditionsTable)
    .where(eq(conditionsTable.dossierId, params.data.dossierId))
    .orderBy(desc(conditionsTable.createdAt));
  res.json(items.map(serializeCondition));
});

export default router;
