import { DossierStatus } from "@workspace/api-client-react";

export const DOSSIER_STATUS_LABELS: Record<DossierStatus, string> = {
  lead_created: "Lead aangemaakt",
  account_invited: "Account uitgenodigd",
  prospect_logged_in: "Ondernemer ingelogd",
  intake_in_progress: "Intake in behandeling",
  documents_uploaded: "Documenten geüpload",
  pre_validation_running: "Pre-validatie loopt",
  blocked_missing_documents: "Geblokkeerd: ontbrekende documenten",
  blocked_invalid_documents: "Geblokkeerd: ongeldige documenten",
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
  closed: "Gesloten"
};

export const getStatusLabel = (status: DossierStatus) => {
  return DOSSIER_STATUS_LABELS[status] || status;
};

// Simplified steps for the progress visualization
export const PROSPECT_PIPELINE_STEPS = [
  { id: "intake", label: "Intake", statuses: ["intake_in_progress"] },
  { id: "documents", label: "Documenten", statuses: ["documents_uploaded", "pre_validation_running", "blocked_missing_documents", "blocked_invalid_documents"] },
  { id: "analysis", label: "AI Analyse", statuses: ["ready_for_ai_analysis", "ai_analysis_running"] },
  { id: "report", label: "Rapportage", statuses: ["entrepreneur_report_ready"] },
  { id: "submitted", label: "Ingediend", statuses: ["submitted_to_geenbank", "loan_officer_review", "additional_info_requested", "approved_for_partner_submission", "rejected_by_loan_officer", "memorandum_generated", "submitted_to_partners", "partner_response_received", "closed"] }
];

export const getCurrentStepIndex = (status: DossierStatus) => {
  // If it's earlier than intake
  if (["lead_created", "account_invited", "prospect_logged_in"].includes(status)) return 0;
  
  const index = PROSPECT_PIPELINE_STEPS.findIndex(step => step.statuses.includes(status));
  
  // If it's a later status not explicitly in the groups above, default to last
  if (index === -1) {
      if (["loan_officer_review", "additional_info_requested", "approved_for_partner_submission", "rejected_by_loan_officer", "memorandum_generated", "submitted_to_partners", "partner_response_received", "closed"].includes(status)) {
          return PROSPECT_PIPELINE_STEPS.length - 1;
      }
      return 0;
  }
  return index;
};
