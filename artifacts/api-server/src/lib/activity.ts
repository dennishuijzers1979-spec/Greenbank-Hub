import { db, activityLogsTable } from "@workspace/db";
import type { AuthUserRow } from "./auth";

export async function logActivity(opts: {
  dossierId?: string | null;
  actor?: AuthUserRow | null;
  actorType?: string;
  action: string;
  description: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await db.insert(activityLogsTable).values({
    dossierId: opts.dossierId ?? null,
    actorType: opts.actor?.role ?? opts.actorType ?? "system",
    actorId: opts.actor?.id ?? null,
    actorLabel:
      opts.actor?.displayName ?? opts.actor?.email ?? opts.actorType ?? "Systeem",
    action: opts.action,
    description: opts.description,
    metadata: opts.metadata ?? null,
  });
}
