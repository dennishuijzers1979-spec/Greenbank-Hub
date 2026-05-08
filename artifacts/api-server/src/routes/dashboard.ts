import { Router, type IRouter } from "express";
import { sql, desc, eq, inArray } from "drizzle-orm";
import {
  db,
  dossiersTable,
  prospectProfilesTable,
  partnerFinanciersTable,
  partnerSubmissionsTable,
} from "@workspace/db";
import { requireAuth } from "../lib/auth";
import { stageLabel, bucketForDossier } from "../lib/serializers";
import { OFFICER_VISIBLE_STATUSES } from "../lib/dossier-access";

const router: IRouter = Router();

const VISIBLE_STATUSES = [...OFFICER_VISIBLE_STATUSES];

router.get("/dashboard/loan-officer", requireAuth(["loan_officer", "admin"]), async (_req, res): Promise<void> => {
  const all = await db
    .select()
    .from(dossiersTable)
    .innerJoin(prospectProfilesTable, eq(prospectProfilesTable.id, dossiersTable.prospectId))
    .where(inArray(dossiersTable.status, VISIBLE_STATUSES))
    .orderBy(desc(dossiersTable.updatedAt));

  const totals = {
    newSubmitted: 0,
    inReview: 0,
    additionalInfoRequested: 0,
    approved: 0,
    rejected: 0,
    submittedToPartners: 0,
  };
  for (const r of all) {
    const b = bucketForDossier(r.dossiers.status);
    if (b === "new") totals.newSubmitted++;
    if (b === "in_review") totals.inReview++;
    if (b === "additional_info") totals.additionalInfoRequested++;
    if (b === "ready" || b === "approved") totals.approved++;
    if (b === "rejected") totals.rejected++;
    if (r.dossiers.status === "submitted_to_partners" || r.dossiers.status === "partner_response_received") {
      totals.submittedToPartners++;
    }
  }

  const buckets = [
    {
      label: "Sterk dossier",
      description: "Hoge levensvatbaarheid en compleetheid",
      count: all.filter((r) => (r.dossiers.viabilityScore ?? 0) >= 75 && (r.dossiers.completenessScore ?? 0) >= 70).length,
    },
    {
      label: "Voorwaardelijk",
      description: "Potentie, maar aanvullende informatie nodig",
      count: all.filter(
        (r) =>
          (r.dossiers.viabilityScore ?? 0) >= 55 &&
          (r.dossiers.viabilityScore ?? 0) < 75,
      ).length,
    },
    {
      label: "Uitdagend",
      description: "Lage levensvatbaarheid of incompleet",
      count: all.filter((r) => (r.dossiers.viabilityScore ?? 0) < 55 && r.dossiers.viabilityScore !== null).length,
    },
    {
      label: "Nog niet geanalyseerd",
      description: "Wacht op pre-validatie of intake",
      count: all.filter((r) => r.dossiers.viabilityScore === null).length,
    },
  ];

  const stages = await db
    .select({
      stage: dossiersTable.status,
      c: sql<number>`count(*)::int`,
    })
    .from(dossiersTable)
    .where(inArray(dossiersTable.status, VISIBLE_STATUSES))
    .groupBy(dossiersTable.status);
  const pipeline = stages.map((s) => ({
    stage: s.stage,
    label: stageLabel(s.stage),
    count: Number(s.c),
  }));

  const now = Date.now();
  const stuckProspects = all
    .filter((r) => {
      const days = (now - r.dossiers.updatedAt.getTime()) / 86400000;
      return days >= 5 && !["closed", "rejected_by_loan_officer", "submitted_to_partners"].includes(r.dossiers.status);
    })
    .slice(0, 6)
    .map((r) => ({
      dossierId: r.dossiers.id,
      companyName: r.prospect_profiles.companyName,
      stage: stageLabel(r.dossiers.status),
      daysStuck: Math.floor((now - r.dossiers.updatedAt.getTime()) / 86400000),
    }));

  const dailyMap = new Map<string, number>();
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now - i * 86400000);
    dailyMap.set(d.toISOString().slice(0, 10), 0);
  }
  for (const r of all) {
    const k = r.dossiers.createdAt.toISOString().slice(0, 10);
    if (dailyMap.has(k)) dailyMap.set(k, (dailyMap.get(k) ?? 0) + 1);
  }
  const dailyIntake = Array.from(dailyMap.entries()).map(([date, count]) => ({ date, count }));

  res.json({
    totals,
    qualityBuckets: buckets,
    pipeline,
    stuckProspects,
    dailyIntake,
  });
});

router.get("/dashboard/admin-metrics", requireAuth(["admin"]), async (_req, res): Promise<void> => {
  const [{ c: totalDossiers }] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(dossiersTable);
  const [{ c: totalSubmittedToPartners }] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(partnerSubmissionsTable);
  const [{ c: activePartners }] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(partnerFinanciersTable)
    .where(eq(partnerFinanciersTable.activeStatus, "active"));
  const [{ avg }] = await db
    .select({ avg: sql<number | null>`avg(${dossiersTable.viabilityScore})` })
    .from(dossiersTable);
  const performance = await db
    .select({
      partnerId: partnerFinanciersTable.id,
      partnerName: partnerFinanciersTable.name,
      submissions: sql<number>`coalesce(count(${partnerSubmissionsTable.id}), 0)::int`,
      accepted: sql<number>`coalesce(sum(case when ${partnerSubmissionsTable.responseStatus} = 'accepted' then 1 else 0 end), 0)::int`,
    })
    .from(partnerFinanciersTable)
    .leftJoin(partnerSubmissionsTable, eq(partnerSubmissionsTable.partnerId, partnerFinanciersTable.id))
    .groupBy(partnerFinanciersTable.id, partnerFinanciersTable.name);
  res.json({
    totalDossiers: Number(totalDossiers),
    totalSubmittedToPartners: Number(totalSubmittedToPartners),
    activePartners: Number(activePartners),
    averageViabilityScore: avg !== null ? Number(avg) : null,
    partnerPerformance: performance.map((p) => ({
      partnerId: p.partnerId,
      partnerName: p.partnerName,
      submissions: Number(p.submissions),
      accepted: Number(p.accepted),
    })),
  });
});

export default router;
