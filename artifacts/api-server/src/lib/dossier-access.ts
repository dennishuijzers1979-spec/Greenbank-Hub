import { eq } from "drizzle-orm";
import { db, dossiersTable, prospectProfilesTable } from "@workspace/db";

/**
 * Statuses where a dossier is part of the Geenbank loan-officer workflow.
 * Pre-submission statuses (intake, prospect-only AI runs, etc.) are normally
 * invisible to officers/admins so the queue only surfaces dossiers that
 * require their attention.
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

/**
 * Prospect sources that the officer must be able to track from intake onwards.
 * Manual-pilot prospects are created BY the officer, so the officer needs
 * visibility even while the prospect is still completing intake.
 */
export const OFFICER_VISIBLE_INTAKE_SOURCES = ["manual_pilot"] as const;
const OFFICER_VISIBLE_SOURCES_SET: ReadonlySet<string> = new Set(
  OFFICER_VISIBLE_INTAKE_SOURCES,
);

export function isOfficerVisibleStatus(status: string): boolean {
  return OFFICER_VISIBLE_SET.has(status);
}

export function isOfficerVisibleSource(
  source: string | null | undefined,
): boolean {
  return !!source && OFFICER_VISIBLE_SOURCES_SET.has(source);
}

/**
 * Combined check: officer can see a dossier if it has progressed into the
 * Geenbank workflow OR if its prospect was manually onboarded by an officer.
 */
export function isOfficerVisibleRow(
  status: string,
  source: string | null | undefined,
): boolean {
  return isOfficerVisibleStatus(status) || isOfficerVisibleSource(source);
}

/**
 * Returns true if a loan_officer/admin is allowed to access the dossier.
 * Returns false if the dossier doesn't exist or is still in a pre-submission
 * stage that is also not from an officer-visible source. Callers should
 * respond with 404 in both cases to avoid leaking existence of hidden
 * dossiers.
 */
export async function officerCanAccessDossier(
  dossierId: string,
): Promise<boolean> {
  const [row] = await db
    .select({
      status: dossiersTable.status,
      source: prospectProfilesTable.source,
    })
    .from(dossiersTable)
    .innerJoin(
      prospectProfilesTable,
      eq(prospectProfilesTable.id, dossiersTable.prospectId),
    )
    .where(eq(dossiersTable.id, dossierId))
    .limit(1);
  if (!row) return false;
  return isOfficerVisibleRow(row.status, row.source);
}
