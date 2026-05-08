import type {
  Dossier as DbDossier,
  ProspectProfile as DbProspect,
  Document as DbDocument,
  AIAnalysisRun as DbRun,
  Condition as DbCondition,
  PartnerFinancier as DbPartner,
  PartnerSubmission as DbSubmission,
  ActivityLogEntry as DbActivity,
} from "@workspace/db";

const STAGE_LABELS: Record<string, string> = {
  lead_created: "Lead aangemaakt",
  account_invited: "Account uitgenodigd",
  prospect_logged_in: "Ondernemer ingelogd",
  intake_in_progress: "Intake bezig",
  documents_uploaded: "Documenten geüpload",
  pre_validation_running: "Pre-validatie loopt",
  blocked_missing_documents: "Geblokkeerd: ontbrekende documenten",
  blocked_invalid_documents: "Geblokkeerd: ongeldige documenten",
  ready_for_ai_analysis: "Klaar voor AI-analyse",
  ai_analysis_running: "AI-analyse loopt",
  entrepreneur_report_ready: "Ondernemersrapport klaar",
  submitted_to_geenbank: "Ingediend bij Geenbank",
  loan_officer_review: "In behandeling kredietacceptant",
  additional_info_requested: "Aanvullende info gevraagd",
  approved_for_partner_submission: "Goedgekeurd voor partneraanbod",
  rejected_by_loan_officer: "Afgewezen",
  memorandum_generated: "Memorandum gegenereerd",
  submitted_to_partners: "Bij partners uitstaan",
  partner_response_received: "Reactie partner ontvangen",
  closed: "Afgesloten",
};

export function stageLabel(status: string): string {
  return STAGE_LABELS[status] ?? status;
}

export function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : null;
}

export function iso(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  return typeof d === "string" ? d : d.toISOString();
}

export function isoReq(d: Date | string): string {
  return typeof d === "string" ? d : d.toISOString();
}

export function intakeCompletion(d: DbDossier): number {
  const fields = [
    d.financingPurpose,
    d.requestedAmount,
    d.financingTypePreference,
    d.annualRevenue,
    d.annualCost,
    d.annualProfit,
    d.companyDescription,
    d.existingFinancing,
  ];
  const filled = fields.filter((f) => f !== null && f !== undefined && f !== "").length;
  return Math.round((filled / fields.length) * 100);
}

export function bucketForDossier(status: string): string {
  if (
    [
      "intake_in_progress",
      "documents_uploaded",
      "pre_validation_running",
      "blocked_missing_documents",
      "blocked_invalid_documents",
      "ready_for_ai_analysis",
      "ai_analysis_running",
      "entrepreneur_report_ready",
    ].includes(status)
  )
    return "in_progress";
  if (status === "submitted_to_geenbank") return "new";
  if (status === "loan_officer_review") return "in_review";
  if (status === "additional_info_requested") return "additional_info";
  if (status === "approved_for_partner_submission") return "ready";
  if (
    [
      "memorandum_generated",
      "submitted_to_partners",
      "partner_response_received",
    ].includes(status)
  )
    return "approved";
  if (status === "rejected_by_loan_officer") return "rejected";
  return "other";
}

export function serializeProspect(p: DbProspect) {
  return {
    id: p.id,
    userId: p.userId,
    companyName: p.companyName,
    contactName: p.contactName,
    kvkNumber: p.kvkNumber,
    phone: p.phone,
    source: p.source,
    pipedriveDealId: p.pipedriveDealId,
    createdAt: isoReq(p.createdAt),
  };
}

export function serializeDossier(
  d: DbDossier,
  p: DbProspect,
  documentsCount: number,
  blockingConditionsCount: number,
) {
  return {
    id: d.id,
    prospectId: d.prospectId,
    prospect: serializeProspect(p),
    status: d.status,
    currentStage: stageLabel(d.status),
    financingPurpose: d.financingPurpose,
    requestedAmount: num(d.requestedAmount),
    financingTypePreference: d.financingTypePreference,
    existingFinancing: d.existingFinancing,
    annualRevenue: num(d.annualRevenue),
    annualCost: num(d.annualCost),
    annualProfit: num(d.annualProfit),
    companyDescription: d.companyDescription,
    completenessScore: d.completenessScore,
    correctnessScore: d.correctnessScore,
    viabilityScore: d.viabilityScore,
    confidenceScore: d.confidenceScore,
    aiVerdict: d.aiVerdict,
    loanOfficerDecision: d.loanOfficerDecision,
    loanOfficerNotes: d.loanOfficerNotes,
    submittedAt: iso(d.submittedAt),
    createdAt: isoReq(d.createdAt),
    updatedAt: isoReq(d.updatedAt),
    intakeCompletionPercent: intakeCompletion(d),
    documentsCount,
    blockingConditionsCount,
  };
}

export function serializeDossierListItem(d: DbDossier, p: DbProspect) {
  return {
    id: d.id,
    companyName: p.companyName,
    contactName: p.contactName,
    status: d.status,
    currentStage: stageLabel(d.status),
    requestedAmount: num(d.requestedAmount),
    financingPurpose: d.financingPurpose,
    completenessScore: d.completenessScore,
    correctnessScore: d.correctnessScore,
    viabilityScore: d.viabilityScore,
    confidenceScore: d.confidenceScore,
    aiVerdict: d.aiVerdict,
    submittedAt: iso(d.submittedAt),
    updatedAt: isoReq(d.updatedAt),
    bucket: bucketForDossier(d.status),
  };
}

export function serializeDocument(doc: DbDocument) {
  return {
    id: doc.id,
    dossierId: doc.dossierId,
    uploadedBy: doc.uploadedBy,
    documentType: doc.documentType,
    filename: doc.filename,
    mimeType: doc.mimeType,
    sizeBytes: doc.sizeBytes,
    storagePath: doc.storagePath,
    uploadStatus: doc.uploadStatus,
    validationStatus: doc.validationStatus,
    extractedDataStatus: doc.extractedDataStatus,
    usedInAnalysis: doc.usedInAnalysis,
    validationNotes: doc.validationNotes,
    createdAt: isoReq(doc.createdAt),
  };
}

export function serializeRun(r: DbRun) {
  return {
    id: r.id,
    dossierId: r.dossierId,
    runType: r.runType,
    status: r.status,
    startedAt: isoReq(r.startedAt),
    completedAt: iso(r.completedAt),
    skillModulesUsed: (r.skillModulesUsed as string[] | null) ?? [],
    completenessScore: r.completenessScore,
    correctnessScore: r.correctnessScore,
    viabilityScore: r.viabilityScore,
    confidenceScore: r.confidenceScore,
    verdict: r.verdict,
    verdictSummary: r.verdictSummary,
    usedMockMode: r.usedMockMode,
    errors: (r.errors as string[] | null) ?? [],
  };
}

export function serializeCondition(c: DbCondition) {
  return {
    id: c.id,
    dossierId: c.dossierId,
    type: c.type,
    title: c.title,
    description: c.description,
    requiredAction: c.requiredAction,
    status: c.status,
    createdAt: isoReq(c.createdAt),
  };
}

export function serializePartner(
  p: DbPartner,
  submissionsCount = 0,
  acceptedCount = 0,
) {
  return {
    id: p.id,
    name: p.name,
    contactEmail: p.contactEmail,
    productFocus: p.productFocus,
    minimumTicketSize: num(p.minimumTicketSize),
    maximumTicketSize: num(p.maximumTicketSize),
    activeStatus: p.activeStatus,
    notes: p.notes,
    submissionsCount,
    acceptedCount,
    createdAt: isoReq(p.createdAt),
  };
}

export function serializeSubmission(s: DbSubmission, partnerName: string) {
  return {
    id: s.id,
    dossierId: s.dossierId,
    partnerId: s.partnerId,
    partnerName,
    status: s.status,
    submittedAt: iso(s.submittedAt),
    packageSummary: s.packageSummary,
    responseStatus: s.responseStatus,
    responseNotes: s.responseNotes,
    usedMockMode: s.usedMockMode,
  };
}

export function serializeActivity(a: DbActivity) {
  return {
    id: a.id,
    dossierId: a.dossierId,
    actorType: a.actorType,
    actorId: a.actorId,
    actorLabel: a.actorLabel,
    action: a.action,
    description: a.description,
    createdAt: isoReq(a.createdAt),
  };
}
