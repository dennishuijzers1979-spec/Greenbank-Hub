import { Router, type IRouter } from "express";
import { desc } from "drizzle-orm";
import { db, activityLogsTable } from "@workspace/db";
import { ListRecentActivityQueryParams } from "@workspace/api-zod";
import { requireAuth } from "../lib/auth";
import { serializeActivity } from "../lib/serializers";

const router: IRouter = Router();

router.get("/activity", requireAuth(["loan_officer", "admin"]), async (req, res): Promise<void> => {
  const params = ListRecentActivityQueryParams.safeParse(req.query);
  const limit = params.success ? params.data.limit ?? 25 : 25;
  const items = await db
    .select()
    .from(activityLogsTable)
    .orderBy(desc(activityLogsTable.createdAt))
    .limit(limit);
  res.json(items.map(serializeActivity));
});

export default router;
