import { eq } from "drizzle-orm";
import { db, dossiersTable } from "@workspace/db";

/**
 * Statuses where a dossier is part of the Geenbank loan-officer workflow.
 * Pre-submission statuses (intake, prospect-only AI runs, etc.) must remain
 * invisible to officers/admins regardless of the access path.
 */
export const OFFICER_VISIBLE_STATUSES = [
  "submitted_to_geenbank",
  "loan_officer_review",
  "additional_info_requested",
  "approved_for_partner_submission",
  "rejected_by_loan_officer",
  "memorandum_generated",
  "submitted_to_partners",
  "partner_response_received",
  "closed",
] as const;

const OFFICER_VISIBLE_SET: ReadonlySet<string> = new Set(
  OFFICER_VISIBLE_STATUSES,
);

export function isOfficerVisibleStatus(status: string): boolean {
  return OFFICER_VISIBLE_SET.has(status);
}

/**
 * Returns true if a loan_officer/admin is allowed to access the dossier.
 * Returns false if the dossier doesn't exist or is still in a pre-submission
 * stage. Callers should respond with 404 in both cases to avoid leaking
 * existence of hidden dossiers.
 */
export async function officerCanAccessDossier(
  dossierId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ status: dossiersTable.status })
    .from(dossiersTable)
    .where(eq(dossiersTable.id, dossierId))
    .limit(1);
  if (!row) return false;
  return isOfficerVisibleStatus(row.status);
}
