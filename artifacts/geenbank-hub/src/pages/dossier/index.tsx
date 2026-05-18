import { useState } from "react";
import {
  useGetMyDossier, getGetMyDossierQueryKey, useSubmitMyDossier,
  useRunMyPrevalidation, useRunMyAnalysis,
  useListMyConditions, getListMyConditionsQueryKey,
  getGetMyEntrepreneurReportQueryKey,
  useListMyDocuments, getListMyDocumentsQueryKey,
  useRespondToCondition,
} from "@workspace/api-client-react";
import type { Condition } from "@workspace/api-client-react";
import type { GateBlockedError } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ProgressSteps } from "@/components/ui/progress-steps";
import { PROSPECT_PIPELINE_STEPS, getCurrentStepIndex, getStatusLabel } from "@/lib/dossier-utils";
import { Link, useLocation } from "wouter";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertCircle, FileText, Upload, BrainCircuit, CheckCircle2, ArrowRight, Loader2, PlayCircle, Sparkles, Send, Hourglass, Paperclip } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

/**
 * Extracts the typed structured 409 payload (`GateBlockedError`) from a
 * mutation error thrown by the generated API client. Both
 * `useRunMyAnalysis` and `useSubmitMyDossier` declare their error type as
 * `ErrorType<GateBlockedError>` in the generated client, so this helper
 * keeps consumers honest about the shape.
 */
function extractGateError(err: unknown): {
  status: number;
  data: Partial<GateBlockedError>;
} {
  const status =
    err && typeof err === "object" && "status" in err
      ? Number((err as { status: unknown }).status) || 0
      : 0;
  const data =
    err &&
    typeof err === "object" &&
    "data" in err &&
    (err as { data: unknown }).data &&
    typeof (err as { data: unknown }).data === "object"
      ? ((err as { data: Partial<GateBlockedError> }).data ?? {})
      : {};
  return { status, data };
}

export default function DossierHub() {
  const { data: dossier, isLoading, isError } = useGetMyDossier({
    query: {
      queryKey: getGetMyDossierQueryKey()
    }
  });
  
  const submitMutation = useSubmitMyDossier();
  const prevalidationMutation = useRunMyPrevalidation();
  const analysisMutation = useRunMyAnalysis();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const { data: conditions } = useListMyConditions({ query: { queryKey: getListMyConditionsQueryKey() } });
  const { data: docs } = useListMyDocuments({ query: { queryKey: getListMyDocumentsQueryKey() } });

  const refreshAfterRun = () => {
    queryClient.invalidateQueries({ queryKey: getGetMyDossierQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetMyEntrepreneurReportQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListMyConditionsQueryKey() });
  };

  const handleRunPrevalidation = () => {
    prevalidationMutation.mutate(undefined, {
      onSuccess: () => {
        refreshAfterRun();
        toast({
          title: "Pre-validatie klaar",
          description: "We hebben je dossier doorgenomen — bekijk het rapport.",
        });
      },
      onError: () => {
        toast({
          title: "Pre-validatie mislukt",
          description: "Probeer het opnieuw of neem contact op.",
          variant: "destructive",
        });
      },
    });
  };

  const handleRunAnalysis = () => {
    analysisMutation.mutate(undefined, {
      onSuccess: () => {
        refreshAfterRun();
        toast({
          title: "AI-analyse afgerond",
          description: "Je rapport is bijgewerkt met de volledige analyse.",
        });
      },
      onError: (err: unknown) => {
        const { status, data } = extractGateError(err);
        if (status === 409) {
          toast({
            title: data.error ?? "AI-analyse geblokkeerd",
            description:
              (data.reasons && data.reasons.length > 0
                ? data.reasons.join(" ")
                : data.message) ?? "Vul je dossier eerst aan.",
            variant: "destructive",
          });
        } else {
          toast({
            title: "AI-analyse mislukt",
            description: "Probeer het later opnieuw.",
            variant: "destructive",
          });
        }
      },
    });
  };

  if (isLoading) {
    return (
      <div className="p-8 max-w-4xl mx-auto space-y-8 animate-pulse">
        <div className="h-12 w-64 bg-muted rounded"></div>
        <div className="h-32 bg-muted rounded-xl"></div>
        <div className="grid gap-4"><div className="h-24 bg-muted rounded-xl"></div><div className="h-24 bg-muted rounded-xl"></div></div>
      </div>
    );
  }

  if (isError || !dossier) {
    return (
      <div className="p-8 max-w-4xl mx-auto">
        <div className="bg-destructive/10 text-destructive p-4 rounded-lg flex items-center gap-3">
          <AlertCircle /> <span>Kon dossier niet laden.</span>
        </div>
      </div>
    );
  }

  const stepIndex = getCurrentStepIndex(dossier.status);
  const canSubmit = dossier.status === "entrepreneur_report_ready";
  const docCount = docs?.length ?? 0;
  const blockingCount = conditions?.filter(c => c.type === 'blocking' && c.status === 'open').length ?? 0;

  const prevalidationReadyStatuses = new Set([
    "intake_in_progress",
    "documents_uploaded",
    "blocked_missing_documents",
    "blocked_invalid_documents",
    "ready_for_ai_analysis",
    "entrepreneur_report_ready",
  ]);
  const showPrevalidationButton =
    prevalidationReadyStatuses.has(dossier.status) && docCount > 0;
  const showAnalysisButton =
    dossier.status === "ready_for_ai_analysis" ||
    dossier.status === "entrepreneur_report_ready";
  const analysisBlocked = blockingCount > 0;

  const handleSubmitToBank = () => {
    submitMutation.mutate(undefined, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetMyDossierQueryKey() });
        toast({
          title: "Dossier ingediend!",
          description: "Uw dossier is succesvol ingediend bij de kredietbeoordelaars.",
        });
      },
      onError: (err: unknown) => {
        const { status, data } = extractGateError(err);
        if (status === 409) {
          toast({
            title: data.error ?? "Dossier kan nog niet ingediend worden",
            description:
              (data.reasons && data.reasons.length > 0
                ? data.reasons.join(" ")
                : data.message) ?? "Vul je dossier eerst aan.",
            variant: "destructive",
          });
        } else {
          toast({
            title: "Fout bij indienen",
            description: "Er is iets misgegaan. Probeer het later opnieuw.",
            variant: "destructive",
          });
        }
      }
    });
  };

  return (
    <div className="p-6 md:p-10 max-w-4xl mx-auto space-y-8">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
        <div>
          <h1 className="text-3xl font-serif font-bold tracking-tight mb-2">Mijn Dossier</h1>
          <p className="text-muted-foreground">Voltooi de onderstaande stappen om uw financieringsaanvraag in te dienen.</p>
        </div>
        <div className="px-4 py-2 bg-secondary rounded-lg border text-sm font-medium">
          Status: {getStatusLabel(dossier.status)}
        </div>
      </div>

      <Card className="border-primary/20 shadow-md">
        <CardContent className="pt-6">
          <ProgressSteps steps={PROSPECT_PIPELINE_STEPS} currentStepIndex={stepIndex} />
        </CardContent>
      </Card>

      {dossier.status === "additional_info_requested" && (
        <AdditionalInfoSection
          conditions={conditions ?? []}
          documents={docs ?? []}
        />
      )}

      {dossier.status === "rejected_by_loan_officer" && (
        <Alert
          data-testid="alert-rejected"
          variant="destructive"
          className="bg-destructive/10 border-destructive/30 text-destructive"
        >
          <AlertCircle className="w-4 h-4" />
          <AlertTitle>Dossier afgewezen</AlertTitle>
          <AlertDescription>
            Je dossier is door de kredietacceptant afgewezen. Neem contact op
            met je begeleider voor toelichting en eventuele vervolgstappen.
          </AlertDescription>
        </Alert>
      )}

      {dossier.status === "approved_for_partner_submission" && (
        <Alert
          data-testid="alert-approved"
          className="border-green-300 bg-green-50 text-green-900 dark:border-green-800 dark:bg-green-950/30 dark:text-green-200"
        >
          <CheckCircle2 className="w-4 h-4" />
          <AlertTitle>Dossier goedgekeurd voor partnerselectie</AlertTitle>
          <AlertDescription>
            Je dossier is goedgekeurd. De kredietacceptant zal je dossier
            voorleggen aan onze partnerfinanciers.
          </AlertDescription>
        </Alert>
      )}

      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Acties</h2>
        
        <div className="grid gap-4">
          <Link href="/dossier/intake" className="block">
            <Card className="hover-elevate cursor-pointer transition-colors hover:border-primary/50 group">
              <CardContent className="p-6 flex items-center gap-6">
                <div className={`p-4 rounded-full ${dossier.intakeCompletionPercent === 100 ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-primary/10 text-primary'}`}>
                  {dossier.intakeCompletionPercent === 100 ? <CheckCircle2 className="w-6 h-6" /> : <FileText className="w-6 h-6" />}
                </div>
                <div className="flex-1">
                  <h3 className="text-lg font-medium group-hover:text-primary transition-colors">1. Intake & Bedrijfsgegevens</h3>
                  <p className="text-muted-foreground text-sm">Vul basisgegevens in over uw bedrijf en uw financieringsbehoefte.</p>
                  
                  <div className="mt-3 flex items-center gap-3">
                    <div className="h-2 flex-1 bg-secondary rounded-full overflow-hidden">
                      <div className="h-full bg-primary transition-all" style={{ width: `${dossier.intakeCompletionPercent}%` }}></div>
                    </div>
                    <span className="text-xs font-medium w-8 text-right">{dossier.intakeCompletionPercent}%</span>
                  </div>
                </div>
                <ArrowRight className="w-5 h-5 text-muted-foreground" />
              </CardContent>
            </Card>
          </Link>

          <Link href="/dossier/documenten" className="block">
            <Card className="hover-elevate cursor-pointer transition-colors hover:border-primary/50 group">
              <CardContent className="p-6 flex items-center gap-6">
                <div className={`p-4 rounded-full ${dossier.documentsCount >= 2 && dossier.status !== 'blocked_missing_documents' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-primary/10 text-primary'}`}>
                  <Upload className="w-6 h-6" />
                </div>
                <div className="flex-1">
                  <div className="flex justify-between items-start">
                    <div>
                      <h3 className="text-lg font-medium group-hover:text-primary transition-colors">2. Documenten Aanleveren</h3>
                      <p className="text-muted-foreground text-sm">Upload recente jaarcijfers en banktransacties.</p>
                    </div>
                    {dossier.blockingConditionsCount > 0 && (
                      <span className="px-2 py-1 bg-destructive/10 text-destructive text-xs font-medium rounded-full flex items-center gap-1">
                        <AlertCircle className="w-3 h-3" /> Actie vereist
                      </span>
                    )}
                  </div>
                  <div className="mt-2 text-sm">
                    <span className="font-medium">{dossier.documentsCount}</span> documenten geüpload
                  </div>
                </div>
                <ArrowRight className="w-5 h-5 text-muted-foreground" />
              </CardContent>
            </Card>
          </Link>

          <Link href="/dossier/rapport" className="block">
            <Card className={`transition-colors group ${stepIndex >= 3 ? 'hover-elevate cursor-pointer hover:border-primary/50' : 'opacity-60 cursor-not-allowed'}`}>
              <CardContent className="p-6 flex items-center gap-6">
                <div className={`p-4 rounded-full ${dossier.status === 'entrepreneur_report_ready' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
                  <BrainCircuit className="w-6 h-6" />
                </div>
                <div className="flex-1">
                  <h3 className="text-lg font-medium group-hover:text-primary transition-colors">3. AI Feedback & Rapportage</h3>
                  <p className="text-muted-foreground text-sm">
                    {stepIndex >= 3 
                      ? "Bekijk de pre-validatie van uw dossier met sterke punten en mogelijke risico's." 
                      : "Dit rapport wordt gegenereerd zodra uw intake en documenten compleet zijn."}
                  </p>
                </div>
                {stepIndex >= 3 && <ArrowRight className="w-5 h-5 text-muted-foreground" />}
              </CardContent>
            </Card>
          </Link>
        </div>
      </div>

      {(showPrevalidationButton || showAnalysisButton) && (
        <Card className="border-primary/30 shadow-sm">
          <CardContent className="p-6 space-y-4">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div>
                <h3 className="text-lg font-medium flex items-center gap-2">
                  <BrainCircuit className="w-5 h-5 text-primary" /> AI-pre-validatie & analyse
                </h3>
                <p className="text-sm text-muted-foreground">
                  Laat de AI je dossier checken voordat je het indient bij Geenbank.
                </p>
              </div>
              <div className="flex flex-col md:flex-row gap-2">
                {showPrevalidationButton && (
                  <Button
                    variant="outline"
                    onClick={handleRunPrevalidation}
                    disabled={prevalidationMutation.isPending || analysisMutation.isPending}
                  >
                    {prevalidationMutation.isPending
                      ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      : <PlayCircle className="w-4 h-4 mr-2" />}
                    Start pre-validatie
                  </Button>
                )}
                {showAnalysisButton && (
                  <Button
                    onClick={handleRunAnalysis}
                    disabled={analysisMutation.isPending || prevalidationMutation.isPending || analysisBlocked}
                  >
                    {analysisMutation.isPending
                      ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      : <Sparkles className="w-4 h-4 mr-2" />}
                    Start AI-analyse
                  </Button>
                )}
              </div>
            </div>
            {prevalidationMutation.isSuccess && !prevalidationMutation.isPending && (
              <Alert>
                <CheckCircle2 className="w-4 h-4" />
                <AlertTitle>Pre-validatie afgerond</AlertTitle>
                <AlertDescription>
                  Open het rapport om de uitkomst te zien.
                </AlertDescription>
              </Alert>
            )}
            {analysisBlocked && (
              <Alert variant="destructive" className="bg-destructive/10 border-destructive/20 text-destructive">
                <AlertCircle className="w-4 h-4" />
                <AlertTitle>AI-analyse geblokkeerd</AlertTitle>
                <AlertDescription>
                  Los eerst de openstaande aandachtspunten op uit het rapport.
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      )}

      {/* Submission Card */}
      {/* (AdditionalInfoSection is rendered above when status === additional_info_requested) */}
      {stepIndex >= 3 && dossier.status !== "closed" && (
        <Card className={`border-2 ${canSubmit ? 'border-primary' : 'border-muted'} shadow-md overflow-hidden`}>
          <div className="absolute top-0 left-0 w-1 h-full bg-primary"></div>
          <CardContent className="p-6 flex flex-col md:flex-row items-center justify-between gap-6 pl-8">
            <div>
              <h3 className="text-xl font-medium mb-1">Dossier Indienen</h3>
              <p className="text-muted-foreground text-sm max-w-lg">
                Zodra u tevreden bent met het AI rapport, kunt u het dossier indienen voor handmatige beoordeling door een van onze kredietexperts.
              </p>
            </div>
            
            {["submitted_to_geenbank", "loan_officer_review", "additional_info_requested", "approved_for_partner_submission", "rejected_by_loan_officer", "memorandum_generated", "submitted_to_partners", "partner_response_received"].includes(dossier.status) ? (
              <div className="flex items-center gap-2 text-green-600 dark:text-green-500 font-medium bg-green-50 dark:bg-green-900/20 px-4 py-2 rounded-lg">
                <CheckCircle2 className="w-5 h-5" /> Ingediend ter beoordeling
              </div>
            ) : (
              <Button 
                size="lg" 
                disabled={!canSubmit || submitMutation.isPending} 
                onClick={handleSubmitToBank}
                className="whitespace-nowrap"
              >
                {submitMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Dossier Definitief Indienen
              </Button>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Additional-information recovery loop
// ---------------------------------------------------------------------------

type DocumentRef = { id: string; filename: string; documentType: string };

interface AdditionalInfoSectionProps {
  conditions: Condition[];
  documents: DocumentRef[];
}

function AdditionalInfoSection({ conditions, documents }: AdditionalInfoSectionProps) {
  // Filter to blocking items only — non-blocking conditions are advisory
  // and never gate the dossier. Sort: open first, then submitted, then
  // resolved, so the prospect's eyes land on actionable items.
  const blocking = conditions.filter((c) => c.type === "blocking");
  const order = (s: string) => (s === "open" ? 0 : s === "submitted" ? 1 : 2);
  const sorted = [...blocking].sort((a, b) => order(a.status) - order(b.status));

  const total = sorted.length;
  const resolvedCount = sorted.filter((c) => c.status === "resolved").length;
  const submittedCount = sorted.filter((c) => c.status === "submitted").length;
  const openCount = sorted.filter((c) => c.status === "open").length;

  return (
    <Card
      data-testid="alert-additional-info-requested"
      className="border-amber-300 bg-amber-50/40 dark:border-amber-800 dark:bg-amber-950/20"
    >
      <CardHeader>
        <div className="flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-amber-700 mt-0.5" />
          <div className="flex-1">
            <CardTitle className="text-amber-900 dark:text-amber-200">
              De kredietacceptant vraagt aanvullende informatie
            </CardTitle>
            <CardDescription className="text-amber-900/80 dark:text-amber-200/80">
              Hoe vollediger en eerlijker je antwoord, hoe beter de
              kredietacceptant je dossier kan beoordelen — en hoe groter de
              kans op een passende financiering. Behandel hieronder elk punt
              afzonderlijk.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {total === 0 ? (
          <p className="text-sm italic text-muted-foreground" data-testid="prospect-requested-items-empty">
            Er zijn op dit moment geen specifieke punten opgegeven. Neem
            contact op met je kredietacceptant voor de details.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2 text-xs" data-testid="conditions-summary">
              <Badge variant="outline" className="border-amber-400 text-amber-900">
                {openCount} open
              </Badge>
              <Badge variant="outline" className="border-blue-400 text-blue-900">
                {submittedCount} ingediend
              </Badge>
              <Badge variant="outline" className="border-green-400 text-green-900">
                {resolvedCount} afgehandeld
              </Badge>
            </div>
            <div className="space-y-3" data-testid="prospect-requested-items">
              {sorted.map((c) => (
                <ConditionResponseCard
                  key={c.id}
                  condition={c}
                  documents={documents}
                />
              ))}
            </div>
            {openCount === 0 && submittedCount > 0 && (
              <Alert className="border-blue-300 bg-blue-50 text-blue-900">
                <Hourglass className="w-4 h-4" />
                <AlertTitle>Reacties in beoordeling</AlertTitle>
                <AlertDescription>
                  Je hebt op alle punten gereageerd. De kredietacceptant
                  beoordeelt je antwoorden — je hoeft nu niets te doen.
                </AlertDescription>
              </Alert>
            )}
            {openCount === 0 && submittedCount === 0 && resolvedCount === total && total > 0 && (
              <Alert className="border-green-300 bg-green-50 text-green-900" data-testid="all-resolved-banner">
                <CheckCircle2 className="w-4 h-4" />
                <AlertTitle>Alle punten zijn afgehandeld</AlertTitle>
                <AlertDescription>
                  Je dossier wordt teruggezet voor verdere beoordeling.
                </AlertDescription>
              </Alert>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

interface ConditionResponseCardProps {
  condition: Condition;
  documents: DocumentRef[];
}

function ConditionResponseCard({ condition, documents }: ConditionResponseCardProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [text, setText] = useState("");
  const [documentId, setDocumentId] = useState<string>("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const respondMutation = useRespondToCondition();
  const isSubmitting = respondMutation.isPending;

  const handleSubmit = () => {
    const trimmed = text.trim();
    const docId = documentId || null;
    if (!trimmed && !docId) {
      setValidationError(
        "Geef een toelichting of kies een geüpload document om dit punt af te handelen.",
      );
      return;
    }
    setValidationError(null);
    respondMutation.mutate(
      {
        conditionId: condition.id,
        data: {
          responseText: trimmed || null,
          responseDocumentId: docId,
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListMyConditionsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetMyDossierQueryKey() });
          toast({
            title: "Aanvullende informatie verzonden",
            description: "De kredietacceptant beoordeelt je reactie.",
          });
          setText("");
          setDocumentId("");
        },
        onError: (err: unknown) => {
          const data =
            err && typeof err === "object" && "data" in err && (err as { data: unknown }).data && typeof (err as { data: unknown }).data === "object"
              ? ((err as { data: { error?: string; message?: string } }).data ?? {})
              : {};
          toast({
            title: data.error ?? "Verzenden mislukt",
            description: data.message ?? "Probeer het later opnieuw.",
            variant: "destructive",
          });
        },
      },
    );
  };

  const status = condition.status;
  const label = condition.requiredAction || condition.title;

  return (
    <div
      data-testid={`condition-card-${condition.id}`}
      data-status={status}
      className="rounded-lg border bg-card p-4 space-y-3"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h4 className="font-medium leading-snug">{label}</h4>
          {condition.description && condition.description !== label && (
            <p className="text-sm text-muted-foreground">{condition.description}</p>
          )}
        </div>
        <ConditionStatusBadge status={status} />
      </div>

      {status === "open" && (
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor={`response-text-${condition.id}`} className="text-sm">
              Toelichting (optioneel als je een document koppelt)
            </Label>
            <Textarea
              id={`response-text-${condition.id}`}
              data-testid={`response-text-${condition.id}`}
              placeholder="Beschrijf hier je antwoord of context..."
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={3}
              disabled={isSubmitting}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-sm">Koppel een geüpload document (optioneel)</Label>
            <div className="flex flex-col sm:flex-row gap-2">
              <Select
                value={documentId}
                onValueChange={(v) => setDocumentId(v === "__none" ? "" : v)}
                disabled={isSubmitting || documents.length === 0}
              >
                <SelectTrigger
                  className="flex-1"
                  data-testid={`response-document-${condition.id}`}
                >
                  <SelectValue
                    placeholder={
                      documents.length === 0
                        ? "Nog geen documenten geüpload"
                        : "Kies een document..."
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">— geen —</SelectItem>
                  {documents.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.filename}{" "}
                      <span className="text-muted-foreground">({d.documentType})</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button asChild variant="outline" size="sm">
                <Link href="/dossier/documenten">
                  <Upload className="w-3.5 h-3.5 mr-1" />
                  Upload nieuw document
                </Link>
              </Button>
            </div>
          </div>
          {validationError && (
            <p
              className="text-sm text-destructive"
              data-testid={`response-error-${condition.id}`}
            >
              {validationError}
            </p>
          )}
          <div className="flex justify-end">
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={isSubmitting}
              data-testid={`response-submit-${condition.id}`}
            >
              {isSubmitting ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Send className="w-4 h-4 mr-2" />
              )}
              Verstuur reactie
            </Button>
          </div>
        </div>
      )}

      {status === "submitted" && (
        <div className="space-y-2 rounded-md bg-blue-50 dark:bg-blue-950/30 p-3 text-sm">
          <p className="font-medium text-blue-900 dark:text-blue-200">
            Wachtend op beoordeling
          </p>
          {condition.responseText && (
            <p className="text-blue-900/80 dark:text-blue-200/80 whitespace-pre-wrap">
              "{condition.responseText}"
            </p>
          )}
          {condition.responseDocumentFilename && (
            <p className="text-blue-900/80 dark:text-blue-200/80 flex items-center gap-1">
              <Paperclip className="w-3.5 h-3.5" />
              {condition.responseDocumentFilename}
            </p>
          )}
        </div>
      )}

      {status === "resolved" && (
        <div className="rounded-md bg-green-50 dark:bg-green-950/30 p-3 text-sm flex items-start gap-2">
          <CheckCircle2 className="w-4 h-4 text-green-700 mt-0.5" />
          <div>
            <p className="font-medium text-green-900 dark:text-green-200">
              Geaccepteerd door de kredietacceptant
            </p>
            {condition.responseText && (
              <p className="text-green-900/80 dark:text-green-200/80 whitespace-pre-wrap">
                "{condition.responseText}"
              </p>
            )}
            {condition.responseDocumentFilename && (
              <p className="text-green-900/80 dark:text-green-200/80 flex items-center gap-1">
                <Paperclip className="w-3.5 h-3.5" />
                {condition.responseDocumentFilename}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ConditionStatusBadge({ status }: { status: string }) {
  if (status === "resolved") {
    return (
      <Badge className="bg-green-600 hover:bg-green-700 text-white text-[10px]">
        afgehandeld
      </Badge>
    );
  }
  if (status === "submitted") {
    return (
      <Badge variant="outline" className="border-blue-400 text-blue-900 text-[10px]">
        ingediend
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="border-amber-400 text-amber-900 text-[10px]">
      open
    </Badge>
  );
}