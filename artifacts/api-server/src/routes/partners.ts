import { Router, type IRouter } from "express";
import { eq, desc, sql } from "drizzle-orm";
import {
  db,
  partnerFinanciersTable,
  partnerSubmissionsTable,
} from "@workspace/db";
import {
  CreatePartnerBody,
  UpdatePartnerParams,
  UpdatePartnerBody,
} from "@workspace/api-zod";
import { requireAuth } from "../lib/auth";
import { serializePartner } from "../lib/serializers";

const router: IRouter = Router();

async function withCounts() {
  const partners = await db
    .select()
    .from(partnerFinanciersTable)
    .orderBy(desc(partnerFinanciersTable.createdAt));
  const submissions = await db
    .select({
      partnerId: partnerSubmissionsTable.partnerId,
      total: sql<number>`count(*)::int`,
      accepted: sql<number>`sum(case when ${partnerSubmissionsTable.responseStatus} = 'accepted' then 1 else 0 end)::int`,
    })
    .from(partnerSubmissionsTable)
    .groupBy(partnerSubmissionsTable.partnerId);
  const byId = new Map(submissions.map((s) => [s.partnerId, s]));
  return partners.map((p) =>
    serializePartner(p, byId.get(p.id)?.total ?? 0, byId.get(p.id)?.accepted ?? 0),
  );
}

router.get("/partners", requireAuth(["loan_officer", "admin"]), async (_req, res): Promise<void> => {
  res.json(await withCounts());
});

router.post("/partners", requireAuth(["admin"]), async (req, res): Promise<void> => {
  const parsed = CreatePartnerBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [p] = await db
    .insert(partnerFinanciersTable)
    .values({
      name: parsed.data.name,
      contactEmail: parsed.data.contactEmail,
      productFocus: parsed.data.productFocus,
      minimumTicketSize: parsed.data.minimumTicketSize?.toString() ?? null,
      maximumTicketSize: parsed.data.maximumTicketSize?.toString() ?? null,
      activeStatus: parsed.data.activeStatus,
      notes: parsed.data.notes ?? null,
    })
    .returning();
  res.status(201).json(serializePartner(p));
});

router.put("/partners/:partnerId", requireAuth(["admin"]), async (req, res): Promise<void> => {
  const params = UpdatePartnerParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = UpdatePartnerBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const [p] = await db
    .update(partnerFinanciersTable)
    .set({
      name: body.data.name,
      contactEmail: body.data.contactEmail,
      productFocus: body.data.productFocus,
      minimumTicketSize: body.data.minimumTicketSize?.toString() ?? null,
      maximumTicketSize: body.data.maximumTicketSize?.toString() ?? null,
      activeStatus: body.data.activeStatus,
      notes: body.data.notes ?? null,
    })
    .where(eq(partnerFinanciersTable.id, params.data.partnerId))
    .returning();
  if (!p) {
    res.status(404).json({ error: "Partner niet gevonden" });
    return;
  }
  res.json(serializePartner(p));
});

export default router;
