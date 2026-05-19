import { DossierStatus } from "@workspace/api-client-react";

export const DOSSIER_STATUS_LABELS: Record<DossierStatus, string> = {
  lead_created: "Lead aangemaakt",
  account_invited: "Account uitgenodigd",
  prospect_logged_in: "Ondernemer ingelogd",
  intake_in_progress: "Aanvraag nog niet compleet",
  documents_uploaded: "Documenten ontvangen",
  pre_validation_running: "Pre-validatie loopt",
  blocked_missing_documents: "Documenten ontbreken",
  blocked_invalid_documents: "Documenten onvolledig",
  ready_for_ai_analysis: "Klaar voor AI-analyse",
  ai_analysis_running: "AI-analyse loopt",
  entrepreneur_report_ready: "Rapportage gereed",
  submitted_to_geenbank: "Ingediend bij bank",
  loan_officer_review: "Beoordeling loopt",
  additional_info_requested: "Aanvullende info nodig",
  approved_for_partner_submission: "Goedgekeurd voor partners",
  rejected_by_loan_officer: "Afgewezen door bank",
  memorandum_generated: "Memorandum gegenereerd",
  submitted_to_partners: "Ingediend bij partners",
  partner_response_received: "Reactie partner ontvangen",
  closed: "Gesloten",
};

export const getStatusLabel = (status: DossierStatus) => {
  return DOSSIER_STATUS_LABELS[status] || status;
};

/**
 * Founder-facing 6-step progress path. Sections 1 + 2 + 3 (Bedrijf,
 * Financieringsvraag, Cijfers) are all completed inside the intake
 * wizard — the visual step jumps forward as more of the intake
 * required fields land.
 */
export const PROSPECT_PIPELINE_STEPS = [
  { id: "company", label: "Bedrijf", statuses: ["intake_in_progress"] },
  { id: "financing", label: "Financieringsvraag", statuses: [] },
  { id: "numbers", label: "Cijfers", statuses: [] },
  {
    id: "documents",
    label: "Documenten",
    statuses: [
      "documents_uploaded",
      "pre_validation_running",
      "blocked_missing_documents",
      "blocked_invalid_documents",
    ],
  },
  {
    id: "analysis",
    label: "Analyse",
    statuses: ["ready_for_ai_analysis", "ai_analysis_running", "entrepreneur_report_ready"],
  },
  {
    id: "submitted",
    label: "Indienen",
    statuses: [
      "submitted_to_geenbank",
      "loan_officer_review",
      "additional_info_requested",
      "approved_for_partner_submission",
      "rejected_by_loan_officer",
      "memorandum_generated",
      "submitted_to_partners",
      "partner_response_received",
      "closed",
    ],
  },
];

/**
 * Compute the active step in the 6-step founder-facing pipeline.
 *
 * Steps 0/1/2 (Bedrijf / Financieringsvraag / Cijfers) are all
 * traversed while the dossier sits in `intake_in_progress` — they are
 * not separate backend statuses. The optional `intake` argument lets
 * the UI advance the highlight as required intake fields land. If it
 * is omitted, we stay on step 0 during intake.
 */
export interface IntakeStepProgressView {
  companyName?: string | null;
  financingPurpose?: string | null;
  requestedAmount?: number | null;
  annualRevenue?: number | null;
  annualCost?: number | null;
  annualProfit?: number | null;
}

export const getCurrentStepIndex = (
  status: DossierStatus,
  intake?: IntakeStepProgressView,
) => {
  if (["lead_created", "account_invited", "prospect_logged_in"].includes(status)) return 0;
  if (status === "intake_in_progress") {
    if (!intake) return 0;
    const nonEmpty = (s?: string | null) =>
      typeof s === "string" && s.trim().length > 0;
    const hasNumbers =
      typeof intake.annualRevenue === "number" ||
      typeof intake.annualCost === "number" ||
      typeof intake.annualProfit === "number";
    const hasFinancingAsk =
      nonEmpty(intake.financingPurpose) && (intake.requestedAmount ?? 0) > 0;
    const hasCompany = nonEmpty(intake.companyName);
    if (hasNumbers) return 2; // Cijfers
    if (hasFinancingAsk) return 1; // Financieringsvraag
    if (hasCompany) return 0; // still on Bedrijf, but visibly started
    return 0;
  }
  const index = PROSPECT_PIPELINE_STEPS.findIndex((step) =>
    step.statuses.includes(status),
  );
  if (index === -1) {
    if (
      [
        "loan_officer_review",
        "additional_info_requested",
        "approved_for_partner_submission",
        "rejected_by_loan_officer",
        "memorandum_generated",
        "submitted_to_partners",
        "partner_response_received",
        "closed",
      ].includes(status)
    ) {
      return PROSPECT_PIPELINE_STEPS.length - 1;
    }
    return 0;
  }
  return index;
};

/**
 * The seven required intake fields that, when all present, make the
 * dossier "intake-compleet" from the prospect's perspective — i.e. the
 * UI flips from "Aanvraag versterken" to "Documenten voorbereiden" as
 * the primary next-best-action.
 *
 * Note: revenue/cost/profit/existingFinancing/financingTypePreference
 * remain *encouraged but optional* per the product spec.
 */
export interface IntakeRequiredView {
  companyName?: string | null;
  contactName?: string | null;
  phone?: string | null;
  email?: string | null;
  financingPurpose?: string | null;
  requestedAmount?: number | null;
  companyDescription?: string | null;
}

export function isIntakeRequiredComplete(v: IntakeRequiredView): boolean {
  const nonEmpty = (s?: string | null) => typeof s === "string" && s.trim().length > 0;
  const reachable = nonEmpty(v.phone) || nonEmpty(v.email);
  return (
    nonEmpty(v.companyName) &&
    nonEmpty(v.contactName) &&
    reachable &&
    nonEmpty(v.financingPurpose) &&
    (v.requestedAmount ?? 0) > 0 &&
    nonEmpty(v.companyDescription)
  );
}

export function intakeRequiredMissing(v: IntakeRequiredView): string[] {
  const nonEmpty = (s?: string | null) => typeof s === "string" && s.trim().length > 0;
  const missing: string[] = [];
  if (!nonEmpty(v.companyName)) missing.push("Bedrijfsnaam");
  if (!nonEmpty(v.contactName)) missing.push("Contactpersoon");
  if (!nonEmpty(v.phone) && !nonEmpty(v.email)) missing.push("Telefoon of e-mail");
  if (!nonEmpty(v.financingPurpose)) missing.push("Doel van de financiering");
  if (!((v.requestedAmount ?? 0) > 0)) missing.push("Aangevraagd bedrag");
  if (!nonEmpty(v.companyDescription)) missing.push("Bedrijfsomschrijving");
  return missing;
}
