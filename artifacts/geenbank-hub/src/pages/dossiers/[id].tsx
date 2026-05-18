import { useState } from "react";
import { useLocation, useParams } from "wouter";
import { 
  useGetDossier, getGetDossierQueryKey,
  useMakeDossierDecision,
  useGetFinancierReport, getGetFinancierReportQueryKey,
  useListDossierDocuments, getListDossierDocumentsQueryKey,
  useGenerateMemorandum, useGetMemorandum, getGetMemorandumQueryKey,
  useListPartners, getListPartnersQueryKey,
  useSubmitDossierToPartners,
  useListDossierSubmissions, getListDossierSubmissionsQueryKey,
  useGetLatestRun, getGetLatestRunQueryKey,
  useGetDualViewAdvice, getGetDualViewAdviceQueryKey,
  useListConditions, getListConditionsQueryKey,
  useResolveCondition, useReturnDossierToReview,
  useRequestAdditionalInfo,
} from "@workspace/api-client-react";
import type { Condition } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Activity, AlertCircle, AlertTriangle, ArrowLeft, Building2, CheckCircle2, Clock, Download, FileText, Loader2, Mail, Send, XCircle } from "lucide-react";
import { KredietworkflowFinancierCard, type KwCanonical } from "@/components/kredietworkflow-financier-card";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { nl } from "date-fns/locale";

/**
 * Surface a meaningful error toast for an API mutation error. The
 * generated api-client may surface errors with a parsed JSON `data`
 * (object with `error`/`message`), a raw string body (e.g. the
 * Express default 404 HTML when a route is unreachable), or no body
 * at all. We also fall back to `Error.message` so a network failure
 * doesn't degrade to the generic Dutch fallback.
 */
function extractApiError(
  err: unknown,
  fallbackTitle: string,
  fallbackDescription: string,
): { title: string; description: string } {
  let title: string | undefined;
  let description: string | undefined;
  if (err && typeof err === "object") {
    const data = (err as { data?: unknown }).data;
    if (data && typeof data === "object") {
      const d = data as { error?: unknown; message?: unknown };
      if (typeof d.error === "string") title = d.error;
      if (typeof d.message === "string") description = d.message;
    } else if (typeof data === "string" && data.trim()) {
      description = data.trim().slice(0, 300);
    }
    const status = (err as { status?: unknown }).status;
    if (!title && typeof status === "number") {
      title = `${fallbackTitle} (HTTP ${status})`;
    }
    const msg = (err as { message?: unknown }).message;
    if (!description && typeof msg === "string" && msg.trim()) {
      description = msg.trim();
    }
  }
  return {
    title: title ?? fallbackTitle,
    description: description ?? fallbackDescription,
  };
}

export default function DossierDetail() {
  const params = useParams<{ id: string }>();
  const id = params.id as string;
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [decisionNotes, setDecisionNotes] = useState("");
  const [requestedItemsText, setRequestedItemsText] = useState("");
  const [selectedPartners, setSelectedPartners] = useState<string[]>([]);
  const [isDecisionDialogOpen, setIsDecisionDialogOpen] = useState(false);
  const [decisionType, setDecisionType] = useState<"approve" | "reject" | "request_additional_info" | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [isPackagePreviewOpen, setIsPackagePreviewOpen] = useState(false);
  const [partnerSubmissionNotes, setPartnerSubmissionNotes] = useState("");

  // Additional-info request dialog state. Each draft item carries the
  // editable entrepreneur-facing copy (rewritten from the internal
  // condition title if the LO opened the dialog from a specific row).
  interface RequestDraftItem {
    internalConditionId: string | null;
    prospectTitle: string;
    prospectExplanation: string;
    prospectRequiredAction: string;
    documentTypeHint: string;
    reviewerNotes: string;
  }
  const [isRequestInfoOpen, setIsRequestInfoOpen] = useState(false);
  const [requestDraft, setRequestDraft] = useState<RequestDraftItem[]>([]);

  // Force-resolve dialog: lets the officer accept a still-open
  // requested item without a prospect response, provided they record
  // an internal reviewer note explaining why.
  const [forceResolveTarget, setForceResolveTarget] = useState<Condition | null>(null);
  const [forceResolveNote, setForceResolveNote] = useState("");

  // Build a sensible Dutch starting draft from an internal condition.
  // The LO is expected to refine the copy before sending — this is
  // explicitly NOT a verbatim copy of the credit/AI wording.
  function draftFromCondition(c: Condition): RequestDraftItem {
    const internal = (c.title || "").trim();
    return {
      internalConditionId: c.id,
      prospectTitle: c.prospectTitle && c.prospectTitle.trim()
        ? c.prospectTitle
        : `Aanvullende informatie nodig${internal ? `: ${internal}` : ""}`,
      prospectExplanation: c.prospectExplanation && c.prospectExplanation.trim()
        ? c.prospectExplanation
        : "Met deze informatie kunnen we je financieringsaanvraag beter en sneller beoordelen. Pas de tekst hieronder gerust aan zodat deze duidelijk is voor de ondernemer.",
      prospectRequiredAction: c.prospectRequiredAction && c.prospectRequiredAction.trim()
        ? c.prospectRequiredAction
        : "Lever de gevraagde documenten of een toelichting aan via dit dossier.",
      documentTypeHint: c.documentTypeHint ?? "",
      reviewerNotes: c.reviewerNotes ?? "",
    };
  }
  const blankDraft = (): RequestDraftItem => ({
    internalConditionId: null,
    prospectTitle: "",
    prospectExplanation: "",
    prospectRequiredAction: "",
    documentTypeHint: "",
    reviewerNotes: "",
  });

  function openRequestInfoBlank() {
    setRequestDraft([blankDraft()]);
    setIsRequestInfoOpen(true);
  }
  function openRequestInfoFromCondition(c: Condition) {
    setRequestDraft([draftFromCondition(c)]);
    setIsRequestInfoOpen(true);
  }
  function updateDraftItem(idx: number, patch: Partial<RequestDraftItem>) {
    setRequestDraft((prev) =>
      prev.map((item, i) => (i === idx ? { ...item, ...patch } : item)),
    );
  }
  function addDraftItem() {
    setRequestDraft((prev) => [...prev, blankDraft()]);
  }
  function removeDraftItem(idx: number) {
    setRequestDraft((prev) => prev.filter((_, i) => i !== idx));
  }

  const DECIDABLE_STATUSES = new Set([
    "submitted_to_geenbank",
    "loan_officer_review",
    "additional_info_requested",
  ]);

  const openDecisionDialog = (type: "approve" | "reject" | "request_additional_info") => {
    setDecisionType(type);
    setDecisionNotes("");
    setRequestedItemsText("");
    setIsDecisionDialogOpen(true);
  };

  const handleDownload = async (docId: string, filename: string) => {
    setDownloadingId(docId);
    try {
      const url = `${import.meta.env.BASE_URL}api/documents/${docId}/content`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) {
        let message = "Download niet beschikbaar.";
        try {
          const body = await res.json();
          if (body && typeof body.error === "string") message = body.error;
        } catch {
          // ignore parse error
        }
        toast({ title: "Download mislukt", description: message, variant: "destructive" });
        return;
      }
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch {
      toast({ title: "Download mislukt", description: "Probeer het later opnieuw.", variant: "destructive" });
    } finally {
      setDownloadingId(null);
    }
  };

  const { data: dossier, isLoading } = useGetDossier(id, { query: { queryKey: getGetDossierQueryKey(id), enabled: !!id } });
  const { data: report } = useGetFinancierReport(id, { query: { queryKey: getGetFinancierReportQueryKey(id), enabled: !!id } });
  const { data: latestRun } = useGetLatestRun(id, { query: { queryKey: getGetLatestRunQueryKey(id), enabled: !!id, retry: false } });
  const { data: dualAdvice, isLoading: dualAdviceLoading, error: dualAdviceError } = useGetDualViewAdvice(id, { query: { queryKey: getGetDualViewAdviceQueryKey(id), enabled: !!id, retry: false } });
  const { data: documents } = useListDossierDocuments(id, { query: { queryKey: getListDossierDocumentsQueryKey(id), enabled: !!id } });
  const { data: memo } = useGetMemorandum(id, { query: { queryKey: getGetMemorandumQueryKey(id), enabled: !!id, retry: false } });
  const { data: partners } = useListPartners({ query: { queryKey: getListPartnersQueryKey() } });
  const { data: existingSubmissions } = useListDossierSubmissions(id, { query: { queryKey: getListDossierSubmissionsQueryKey(id), enabled: !!id } });
  const { data: conditions } = useListConditions(id, { query: { queryKey: getListConditionsQueryKey(id), enabled: !!id } });

  const decisionMutation = useMakeDossierDecision();
  const memoMutation = useGenerateMemorandum();
  const submitPartnerMutation = useSubmitDossierToPartners();
  const resolveConditionMutation = useResolveCondition();
  const returnToReviewMutation = useReturnDossierToReview();
  const requestAdditionalInfoMutation = useRequestAdditionalInfo();

  const handleSubmitRequestInfo = () => {
    if (requestAdditionalInfoMutation.isPending) return;
    const cleaned = requestDraft
      .map((d) => ({
        internalConditionId: d.internalConditionId,
        prospectTitle: d.prospectTitle.trim(),
        prospectExplanation: d.prospectExplanation.trim(),
        prospectRequiredAction: d.prospectRequiredAction.trim(),
        documentTypeHint: d.documentTypeHint.trim() || null,
        reviewerNotes: d.reviewerNotes.trim() || null,
      }))
      .filter((d) => d.prospectTitle || d.prospectExplanation || d.prospectRequiredAction);
    if (cleaned.length === 0) {
      toast({
        title: "Geen verzoeken",
        description: "Vul minimaal één verzoek volledig in.",
        variant: "destructive",
      });
      return;
    }
    const incomplete = cleaned.find(
      (d) => !d.prospectTitle || !d.prospectExplanation || !d.prospectRequiredAction,
    );
    if (incomplete) {
      toast({
        title: "Verzoek onvolledig",
        description: "Titel, toelichting en gevraagde actie zijn verplicht voor elk verzoek.",
        variant: "destructive",
      });
      return;
    }
    requestAdditionalInfoMutation.mutate(
      { dossierId: id, data: { items: cleaned } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListConditionsQueryKey(id) });
          queryClient.invalidateQueries({ queryKey: getGetDossierQueryKey(id) });
          setIsRequestInfoOpen(false);
          setRequestDraft([]);
          toast({
            title: "Verzoek klaargezet",
            description: `${cleaned.length} verzoek(en) staan klaar voor de ondernemer.`,
          });
        },
        onError: (err: unknown) => {
          const { title, description } = extractApiError(
            err,
            "Verzoek mislukt",
            "Controleer de ingevoerde gegevens en probeer het opnieuw.",
          );
          toast({ title, description, variant: "destructive" });
        },
      },
    );
  };

  const handleForceResolve = () => {
    if (!forceResolveTarget) return;
    if (resolveConditionMutation.isPending) return;
    const note = forceResolveNote.trim();
    if (!note) {
      toast({
        title: "Interne notitie vereist",
        description: "Geef een interne reden op om dit punt zonder reactie te accepteren.",
        variant: "destructive",
      });
      return;
    }
    resolveConditionMutation.mutate(
      { conditionId: forceResolveTarget.id, data: { reviewerNotes: note } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListConditionsQueryKey(id) });
          queryClient.invalidateQueries({ queryKey: getGetDossierQueryKey(id) });
          setForceResolveTarget(null);
          setForceResolveNote("");
          toast({ title: "Voorwaarde geforceerd opgelost", description: "Inclusief interne notitie." });
        },
        onError: (err: unknown) => {
          const { title, description } = extractApiError(
            err,
            "Kan niet opgelost worden",
            "Probeer het later opnieuw.",
          );
          toast({ title, description, variant: "destructive" });
        },
      },
    );
  };

  const handleResolveCondition = (conditionId: string) => {
    if (resolveConditionMutation.isPending) return;
    resolveConditionMutation.mutate(
      { conditionId, data: {} },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListConditionsQueryKey(id) });
          queryClient.invalidateQueries({ queryKey: getGetDossierQueryKey(id) });
          toast({ title: "Voorwaarde opgelost", description: "De reactie is geaccepteerd." });
        },
        onError: (err: unknown) => {
          const { title, description } = extractApiError(
            err,
            "Kan niet opgelost worden",
            "Probeer het later opnieuw.",
          );
          toast({ title, description, variant: "destructive" });
        },
      },
    );
  };

  const handleReturnToReview = () => {
    if (returnToReviewMutation.isPending) return;
    returnToReviewMutation.mutate(
      { dossierId: id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetDossierQueryKey(id) });
          queryClient.invalidateQueries({ queryKey: getListConditionsQueryKey(id) });
          toast({
            title: "Dossier teruggezet",
            description: "Het dossier staat weer in beoordeling.",
          });
        },
        onError: (err: unknown) => {
          const data =
            err && typeof err === "object" && "data" in err && (err as { data: unknown }).data && typeof (err as { data: unknown }).data === "object"
              ? ((err as { data: { error?: string; message?: string } }).data ?? {})
              : {};
          toast({
            title: data.error ?? "Terugzetten mislukt",
            description: data.message ?? "Probeer het later opnieuw.",
            variant: "destructive",
          });
        },
      },
    );
  };

  if (isLoading || !dossier) {
    return <div className="p-8 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }

  const parsedRequestedItems = requestedItemsText
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(Boolean);

  const handleDecision = () => {
    if (!decisionType) return;
    if (decisionMutation.isPending) return;

    if (decisionType === "request_additional_info" && parsedRequestedItems.length === 0) {
      toast({
        title: "Geef minimaal één item op",
        description: "Beschrijf één item per regel dat de ondernemer moet aanleveren.",
        variant: "destructive",
      });
      return;
    }

    decisionMutation.mutate(
      {
        dossierId: id,
        data: {
          decision: decisionType,
          notes: decisionNotes || null,
          ...(decisionType === "request_additional_info"
            ? { requestedItems: parsedRequestedItems }
            : {}),
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetDossierQueryKey(id) });
          setIsDecisionDialogOpen(false);
          const label =
            decisionType === "approve"
              ? "goedgekeurd voor partners"
              : decisionType === "reject"
                ? "afgewezen"
                : "aanvullende informatie gevraagd";
          toast({ title: "Besluit opgeslagen", description: `Dossier is ${label}.` });
        },
        onError: (err: unknown) => {
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
              ? ((err as { data: { error?: string; message?: string } }).data ?? {})
              : {};
          toast({
            title: data.error ?? (status === 409 ? "Besluit niet meer mogelijk" : "Besluit mislukt"),
            description: data.message ?? "Probeer het later opnieuw.",
            variant: "destructive",
          });
        },
      },
    );
  };

  const handleGenerateMemo = () => {
    memoMutation.mutate({ dossierId: id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetMemorandumQueryKey(id) });
        queryClient.invalidateQueries({ queryKey: getGetDossierQueryKey(id) });
        toast({ title: "Memorandum in de maak", description: "Het kredietmemorandum wordt gegenereerd." });
      }
    });
  };

  const SUBMITTABLE_STATUSES = new Set([
    "approved_for_partner_submission",
    "memorandum_generated",
  ]);

  const activePartners = (partners ?? []).filter(p => p.activeStatus === "active");
  const requestedAmountNum = dossier.requestedAmount ?? 0;

  const partnerFitsTicketRange = (p: { minimumTicketSize?: number | null; maximumTicketSize?: number | null }) => {
    if (!requestedAmountNum) return true;
    const min = p.minimumTicketSize ?? null;
    const max = p.maximumTicketSize ?? null;
    if (min !== null && requestedAmountNum < min) return false;
    if (max !== null && requestedAmountNum > max) return false;
    return true;
  };

  const selectedPartnerObjects = activePartners.filter(p => selectedPartners.includes(p.id));
  const ticketWarnings = selectedPartnerObjects.filter(p => !partnerFitsTicketRange(p));

  const openPackagePreview = () => {
    if (selectedPartners.length === 0) {
      toast({ title: "Selecteer partners", description: "Kies minimaal 1 actieve partner.", variant: "destructive" });
      return;
    }
    if (!SUBMITTABLE_STATUSES.has(dossier.status)) {
      toast({
        title: "Indienen niet mogelijk",
        description: "Het dossier moet eerst goedgekeurd zijn voor partneraanbod.",
        variant: "destructive",
      });
      return;
    }
    setIsPackagePreviewOpen(true);
  };

  const handleSubmitToPartners = () => {
    if (selectedPartners.length === 0) return;
    if (submitPartnerMutation.isPending) return;

    submitPartnerMutation.mutate(
      {
        dossierId: id,
        data: {
          partnerIds: selectedPartners,
          notes: partnerSubmissionNotes || null,
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetDossierQueryKey(id) });
          queryClient.invalidateQueries({ queryKey: getListDossierSubmissionsQueryKey(id) });
          toast({
            title: "Mock-aanbieding aangemaakt",
            description: `Aanbiedpakket geregistreerd voor ${selectedPartners.length} ${selectedPartners.length === 1 ? "partner" : "partners"} (mock-verzending).`,
          });
          setSelectedPartners([]);
          setPartnerSubmissionNotes("");
          setIsPackagePreviewOpen(false);
        },
        onError: (err: unknown) => {
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
              ? ((err as { data: { error?: string; message?: string } }).data ?? {})
              : {};
          toast({
            title: data.error ?? (status === 409 ? "Indienen niet mogelijk" : "Indienen mislukt"),
            description: data.message ?? "Probeer het later opnieuw.",
            variant: "destructive",
          });
        },
      },
    );
  };

  return (
    <div className="p-6 md:p-10 max-w-6xl mx-auto space-y-6">
      <Button variant="ghost" onClick={() => setLocation("/dossiers")} className="mb-2 -ml-4">
        <ArrowLeft className="w-4 h-4 mr-2" /> Terug naar wachtrij
      </Button>

      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-3xl font-serif font-bold tracking-tight">{dossier.prospect?.companyName}</h1>
            <span className="px-3 py-1 rounded-full bg-secondary text-secondary-foreground text-xs font-semibold uppercase tracking-wider">
              {dossier.status.replace(/_/g, ' ')}
            </span>
          </div>
          <p className="text-muted-foreground">{dossier.prospect?.contactName} • Ingediend op {dossier.submittedAt ? format(new Date(dossier.submittedAt), 'd MMM yyyy', { locale: nl }) : '-'}</p>
        </div>

        {DECIDABLE_STATUSES.has(dossier.status) && (
          <div className="flex gap-2" data-testid="officer-decision-actions">
            <Button
              variant="outline"
              className="text-amber-600 border-amber-200 hover:bg-amber-50"
              data-testid="button-request-info"
              disabled={decisionMutation.isPending}
              onClick={() => openDecisionDialog("request_additional_info")}
            >
              Aanvullende info vragen
            </Button>
            <Button
              variant="destructive"
              data-testid="button-reject"
              disabled={decisionMutation.isPending}
              onClick={() => openDecisionDialog("reject")}
            >
              Afwijzen
            </Button>
            <Button
              className="bg-green-600 hover:bg-green-700 text-white"
              data-testid="button-approve"
              disabled={decisionMutation.isPending}
              onClick={() => openDecisionDialog("approve")}
            >
              <CheckCircle2 className="w-4 h-4 mr-2" /> Goedkeuren voor partners
            </Button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <Card className="bg-primary/5 border-primary/20">
          <CardContent className="p-4 flex flex-col justify-center h-full">
            <p className="text-sm font-medium text-muted-foreground">Aangevraagd bedrag</p>
            <p className="text-2xl font-bold text-foreground">
              {dossier.requestedAmount ? new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(dossier.requestedAmount) : 'N.v.t.'}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex flex-col justify-center h-full">
            <p className="text-sm font-medium text-muted-foreground">Financieringsdoel</p>
            <p className="text-lg font-medium text-foreground capitalize truncate">{dossier.financingTypePreference || 'Onbekend'}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center justify-between h-full">
            <div>
              <p className="text-sm font-medium text-muted-foreground">AI Haalbaarheid</p>
              <p className="text-2xl font-bold">{dossier.viabilityScore || 0}/100</p>
            </div>
            <div className={`w-12 h-12 rounded-full flex items-center justify-center border-4 ${
              (dossier.viabilityScore || 0) > 70 ? 'border-green-500 text-green-600' : 'border-amber-500 text-amber-600'
            }`}>
              <span className="font-bold text-sm">{dossier.viabilityScore}</span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex flex-col justify-center h-full">
            <p className="text-sm font-medium text-muted-foreground">Documenten</p>
            <div className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-primary" />
              <p className="text-xl font-bold">{documents?.length || 0}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="grid grid-cols-2 md:grid-cols-6 mb-6">
          <TabsTrigger value="overview">AI Analyse</TabsTrigger>
          <TabsTrigger value="intake">Intake</TabsTrigger>
          <TabsTrigger value="documents">Documenten</TabsTrigger>
          <TabsTrigger value="conditions" data-testid="tab-conditions">
            Voorwaarden
            {(conditions?.filter(c => c.type === "blocking" && c.status !== "resolved").length ?? 0) > 0 && (
              <Badge variant="outline" className="ml-1 text-[10px] border-amber-400 text-amber-900">
                {conditions!.filter(c => c.type === "blocking" && c.status !== "resolved").length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="memo" disabled={!['approved_for_partner_submission', 'memorandum_generated', 'submitted_to_partners'].includes(dossier.status)}>Memorandum</TabsTrigger>
          <TabsTrigger value="partners" disabled={!['approved_for_partner_submission', 'memorandum_generated', 'submitted_to_partners', 'partner_response_received'].includes(dossier.status)}>Partners</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          {report ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="md:col-span-2 space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle>Samenvatting & Beoordeling</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div>
                      <h4 className="font-medium text-sm text-muted-foreground mb-1">Bedrijfsanalyse</h4>
                      <p className="text-sm leading-relaxed">{report.companySummary}</p>
                    </div>
                    <div>
                      <h4 className="font-medium text-sm text-muted-foreground mb-1">Financiële Analyse</h4>
                      <p className="text-sm leading-relaxed">{report.financialAnalysis}</p>
                    </div>
                    <div className="bg-secondary/30 p-4 rounded-lg mt-4 border border-border/50">
                      <h4 className="font-medium text-sm text-primary mb-2 flex items-center gap-2"><Building2 className="w-4 h-4"/> AI Aanbeveling</h4>
                      <p className="text-sm font-medium">{report.recommendation}</p>
                    </div>
                  </CardContent>
                </Card>
              </div>
              <div className="space-y-6">
                <Card className="border-amber-200">
                  <CardHeader className="bg-amber-50/50 pb-3">
                    <CardTitle className="text-base flex items-center gap-2 text-amber-700">
                      <AlertTriangle className="w-4 h-4" /> Risicofactoren
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-4">
                    <ul className="space-y-2">
                      {report.riskFactors.map((r, i) => (
                        <li key={i} className="text-sm flex gap-2"><span className="text-amber-500">•</span> {r}</li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
                <Card className="border-green-200">
                  <CardHeader className="bg-green-50/50 pb-3">
                    <CardTitle className="text-base flex items-center gap-2 text-green-700">
                      <CheckCircle2 className="w-4 h-4" /> Sterke punten
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-4">
                    <ul className="space-y-2">
                      {report.strengths.map((r, i) => (
                        <li key={i} className="text-sm flex gap-2"><span className="text-green-500">•</span> {r}</li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              </div>
            </div>
          ) : (
            <Card><CardContent className="py-10 text-center text-muted-foreground">Geen AI rapport beschikbaar voor dit dossier.</CardContent></Card>
          )}

          {!dualAdvice && !dualAdviceLoading && dualAdviceError && (
            <Card data-testid="dual-view-advice-empty" className="border-dashed">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Building2 className="w-4 h-4" /> Financier productadvies (intern)
                </CardTitle>
                <CardDescription>
                  Nog geen interne productuitkomst beschikbaar voor dit dossier.
                </CardDescription>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                <p>
                  Zodra de prospect een AI-analyse heeft uitgevoerd verschijnt hier de uitkomst van
                  {' '}<span className="font-mono">FinancingProductAdvisorDualView</span>: aanbevolen product, alternatief,
                  indicatieve structuur, risico's en bewijs-gaten. Alleen zichtbaar voor loan officers en admins.
                </p>
              </CardContent>
            </Card>
          )}

          {dualAdvice && (() => {
            const pv = dualAdvice.partnerView;
            const ind = pv.indicative_structure;
            const modeLabel =
              dualAdvice.executionMode === "live_openai"
                ? "Live OpenAI"
                : dualAdvice.executionMode === "fallback_mock"
                  ? "Fallback naar mock"
                  : "Deterministisch / mock";
            const modeBadge =
              dualAdvice.executionMode === "live_openai"
                ? "bg-green-100 text-green-800"
                : dualAdvice.executionMode === "fallback_mock"
                  ? "bg-amber-100 text-amber-800"
                  : "bg-slate-100 text-slate-700";
            const statusLabel =
              pv.recommendation_status === "strong"
                ? "Sterk"
                : pv.recommendation_status === "provisional"
                  ? "Voorlopig"
                  : pv.recommendation_status === "weak"
                    ? "Zwak"
                    : "Onbekend";
            const statusBadge =
              pv.recommendation_status === "strong"
                ? "bg-green-100 text-green-800"
                : pv.recommendation_status === "provisional"
                  ? "bg-amber-100 text-amber-800"
                  : pv.recommendation_status === "weak"
                    ? "bg-red-100 text-red-800"
                    : "bg-slate-100 text-slate-700";
            return (
              <Card data-testid="dual-view-advice">
                <CardHeader>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <CardTitle className="flex items-center gap-2 text-base">
                        <Building2 className="w-4 h-4" /> Financier productadvies (intern)
                      </CardTitle>
                      <CardDescription>
                        Interne productuitkomst van <span className="font-mono">FinancingProductAdvisorDualView</span>.
                        Niet zichtbaar voor de prospect — alleen voor loan officers en admins.
                      </CardDescription>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`text-xs px-2 py-0.5 rounded ${modeBadge}`}>{modeLabel}</span>
                      <span className={`text-xs px-2 py-0.5 rounded ${statusBadge}`}>Status: {statusLabel}</span>
                      {dualAdvice.partial && (
                        <span className="text-xs px-2 py-0.5 rounded bg-amber-100 text-amber-800">Onvolledig</span>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {dualAdvice.warnings.length > 0 && (
                    <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 space-y-1">
                      {dualAdvice.warnings.map((w, i) => (
                        <div key={i} className="flex gap-2"><AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /><span>{w}</span></div>
                      ))}
                    </div>
                  )}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="border rounded-lg p-3 bg-muted/10">
                      <h4 className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Aanbevolen product</h4>
                      <p className="text-sm font-medium">{pv.recommended_product || "—"}</p>
                      {pv.recommended_product_mix && pv.recommended_product_mix.length > 0 && (
                        <p className="text-xs text-muted-foreground mt-1">
                          Mix: {pv.recommended_product_mix.join(" + ")}
                        </p>
                      )}
                    </div>
                    <div className="border rounded-lg p-3 bg-muted/10">
                      <h4 className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Alternatief</h4>
                      <p className="text-sm font-medium">{pv.alternative_product || "—"}</p>
                    </div>
                  </div>

                  {ind && (ind.amount !== null || ind.tenor_months !== null || ind.repayment_logic || ind.collateral_logic || (ind.conditions && ind.conditions.length > 0)) && (
                    <div className="border rounded-lg p-3">
                      <h4 className="text-sm font-semibold mb-2">Indicatieve structuur</h4>
                      <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1 text-xs">
                        {ind.amount !== null && ind.amount !== undefined && (
                          <><dt className="text-muted-foreground">Bedrag</dt><dd>€ {ind.amount.toLocaleString("nl-NL")}</dd></>
                        )}
                        {ind.tenor_months !== null && ind.tenor_months !== undefined && (
                          <><dt className="text-muted-foreground">Looptijd</dt><dd>{ind.tenor_months} maanden</dd></>
                        )}
                        {ind.repayment_logic && (<><dt className="text-muted-foreground">Aflossing</dt><dd>{ind.repayment_logic}</dd></>)}
                        {ind.collateral_logic && (<><dt className="text-muted-foreground">Zekerheden</dt><dd>{ind.collateral_logic}</dd></>)}
                      </dl>
                      {ind.conditions && ind.conditions.length > 0 && (
                        <div className="mt-2">
                          <h5 className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Voorwaarden</h5>
                          <ul className="text-xs space-y-1">
                            {ind.conditions.map((c, i) => (
                              <li key={i} className="flex gap-2"><span className="text-muted-foreground">•</span><span>{c}</span></li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {pv.rationale && pv.rationale.length > 0 && (
                      <div className="border rounded-lg p-3 border-green-200 bg-green-50/30">
                        <h5 className="text-xs uppercase tracking-wide text-green-800 mb-1">Onderbouwing</h5>
                        <ul className="text-xs space-y-1">
                          {pv.rationale.map((r, i) => <li key={i} className="flex gap-2"><span className="text-green-600">•</span><span>{r}</span></li>)}
                        </ul>
                      </div>
                    )}
                    {pv.key_risks && pv.key_risks.length > 0 && (
                      <div className="border rounded-lg p-3 border-red-200 bg-red-50/30">
                        <h5 className="text-xs uppercase tracking-wide text-red-800 mb-1">Risico's</h5>
                        <ul className="text-xs space-y-1">
                          {pv.key_risks.map((r, i) => <li key={i} className="flex gap-2"><span className="text-red-600">•</span><span>{r}</span></li>)}
                        </ul>
                      </div>
                    )}
                    {pv.evidence_gaps && pv.evidence_gaps.length > 0 && (
                      <div className="border rounded-lg p-3 border-amber-200 bg-amber-50/30">
                        <h5 className="text-xs uppercase tracking-wide text-amber-800 mb-1">Bewijs-gaten</h5>
                        <ul className="text-xs space-y-1">
                          {pv.evidence_gaps.map((r, i) => <li key={i} className="flex gap-2"><span className="text-amber-700">•</span><span>{r}</span></li>)}
                        </ul>
                      </div>
                    )}
                  </div>

                  {pv.shortlisted_products && pv.shortlisted_products.length > 0 && (
                    <div className="border rounded-lg p-3">
                      <h4 className="text-sm font-semibold mb-2">Shortlist</h4>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-left text-muted-foreground border-b">
                              <th className="py-1 pr-2">Product</th>
                              <th className="py-1 pr-2">Fit</th>
                              <th className="py-1 pr-2">Bewijs</th>
                              <th className="py-1 pr-2">Structuur</th>
                              <th className="py-1">Notities</th>
                            </tr>
                          </thead>
                          <tbody>
                            {pv.shortlisted_products.map((sp, i) => (
                              <tr key={i} className="border-b last:border-b-0 align-top">
                                <td className="py-1 pr-2 font-medium">{sp.product_name}</td>
                                <td className="py-1 pr-2">{sp.product_fit_score ?? "—"}</td>
                                <td className="py-1 pr-2">{sp.evidence_strength_score ?? "—"}</td>
                                <td className="py-1 pr-2">{sp.structurability_score ?? "—"}</td>
                                <td className="py-1">
                                  {sp.notes && sp.notes.length > 0 ? sp.notes.join("; ") : "—"}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  <dl className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-1 text-xs pt-2 border-t">
                    <dt className="text-muted-foreground">Bron</dt>
                    <dd className="font-mono">{dualAdvice.provider}</dd>
                    {dualAdvice.model && (
                      <>
                        <dt className="text-muted-foreground">Model</dt>
                        <dd className="font-mono truncate">{dualAdvice.model}</dd>
                      </>
                    )}
                    {dualAdvice.generatedAt && (
                      <>
                        <dt className="text-muted-foreground">Gegenereerd</dt>
                        <dd>{format(new Date(dualAdvice.generatedAt), "d MMM yyyy HH:mm", { locale: nl })}</dd>
                      </>
                    )}
                    {dualAdvice.durationMs !== null && dualAdvice.durationMs !== undefined && (
                      <>
                        <dt className="text-muted-foreground">Duur</dt>
                        <dd>{dualAdvice.durationMs} ms</dd>
                      </>
                    )}
                    {dualAdvice.fallbackReason && (
                      <>
                        <dt className="text-muted-foreground">Fallback</dt>
                        <dd className="text-amber-700 col-span-3 md:col-span-3">{dualAdvice.fallbackReason}</dd>
                      </>
                    )}
                  </dl>
                </CardContent>
              </Card>
            );
          })()}

          {latestRun && latestRun.skillInvocations && (() => {
            const kwInv = latestRun.skillInvocations.find(
              (i) => i.skillName === "GeenbankKredietworkflow",
            ) as (typeof latestRun.skillInvocations)[number] | undefined;
            const kwExtras = kwInv
              ? (kwInv as unknown as { extras?: { canonical?: KwCanonical | null } | null }).extras
              : null;
            const canonical = kwExtras?.canonical ?? null;
            if (!kwInv && !canonical) return null;
            return (
              <KredietworkflowFinancierCard
                canonical={canonical}
                invocation={kwInv ? {
                  provider: kwInv.provider,
                  usedMockMode: kwInv.usedMockMode,
                  fallbackReason: kwInv.fallbackReason,
                  model: kwInv.model,
                } : null}
              />
            );
          })()}

          {latestRun && latestRun.skillInvocations && latestRun.skillInvocations.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Activity className="w-4 h-4" /> AI uitvoeringsdetails
                </CardTitle>
                <CardDescription>
                  Per skill tonen we de daadwerkelijke uitvoeringsmodus: <strong>Live OpenAI</strong> (echte API-aanroep gelukt),
                  {' '}<strong>Fallback naar mock</strong> (live geprobeerd, mislukt — zie reden) of <strong>Deterministisch / mock</strong>
                  {' '}(geen live aanroep gedaan). Vandaag heeft alleen <span className="font-mono">FinancingProductAdvisorDualView</span> een
                  {' '}live-pad; de overige skills draaien deterministisch.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {latestRun.skillInvocations.map((inv, idx) => {
                    const isLive = !inv.usedMockMode;
                    const isFallback = inv.usedMockMode && !!inv.fallbackReason;
                    const modeLabel = isLive
                      ? `Live ${inv.provider === 'openai' ? 'OpenAI' : inv.provider}`
                      : isFallback
                        ? 'Fallback naar mock'
                        : 'Deterministisch / mock';
                    const badgeClass = isLive
                      ? 'bg-green-100 text-green-800'
                      : isFallback
                        ? 'bg-amber-100 text-amber-800'
                        : 'bg-slate-100 text-slate-700';
                    const showModel = !!inv.model && (isLive || isFallback);
                    return (
                    <div key={idx} className="border rounded-lg p-3 bg-muted/10">
                      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm font-semibold">{inv.skillName}</span>
                          <span className={`text-xs px-2 py-0.5 rounded ${badgeClass}`}>
                            {modeLabel}
                          </span>
                          {!inv.ok && (
                            <span className="text-xs px-2 py-0.5 rounded bg-red-100 text-red-800">fout</span>
                          )}
                        </div>
                        <span className="text-xs text-muted-foreground">{inv.durationMs} ms</span>
                      </div>
                      <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1 text-xs">
                        {showModel && (<><dt className="text-muted-foreground">Model</dt><dd className="font-mono">{inv.model}</dd></>)}
                        {inv.endpoint && (<><dt className="text-muted-foreground">Endpoint</dt><dd className="font-mono truncate">{inv.endpoint}</dd></>)}
                        {inv.assistantId && (<><dt className="text-muted-foreground">Assistant</dt><dd className="font-mono truncate">{inv.assistantId}</dd></>)}
                        {inv.fallbackReason && (<><dt className="text-muted-foreground">Fallback</dt><dd className="text-amber-700">{inv.fallbackReason}</dd></>)}
                        <dt className="text-muted-foreground">Input</dt><dd className="font-mono break-words">{inv.inputSummary || '—'}</dd>
                        <dt className="text-muted-foreground">Output</dt><dd className="font-mono break-words">{inv.outputSummary || '—'}</dd>
                        {inv.errorMessage && (<><dt className="text-muted-foreground">Foutmelding</dt><dd className="text-red-700">{inv.errorMessage}</dd></>)}
                      </dl>
                    </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="intake">
          <Card>
            <CardHeader>
              <CardTitle>Aangeleverde Intakegegevens</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-6">
                <div>
                  <h4 className="text-sm font-medium text-muted-foreground mb-1">Bedrijfsnaam</h4>
                  <p>{dossier.prospect?.companyName}</p>
                </div>
                <div>
                  <h4 className="text-sm font-medium text-muted-foreground mb-1">Contactpersoon</h4>
                  <p>{dossier.prospect?.contactName}</p>
                </div>
                <div className="md:col-span-2">
                  <h4 className="text-sm font-medium text-muted-foreground mb-1">Bedrijfsomschrijving</h4>
                  <p className="text-sm">{dossier.companyDescription || '-'}</p>
                </div>
                <div className="md:col-span-2 border-t pt-4 mt-2">
                  <h4 className="font-semibold mb-4">Financiële Kerncijfers</h4>
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <h4 className="text-sm font-medium text-muted-foreground mb-1">Omzet</h4>
                      <p className="font-medium">{dossier.annualRevenue ? `€ ${dossier.annualRevenue}` : '-'}</p>
                    </div>
                    <div>
                      <h4 className="text-sm font-medium text-muted-foreground mb-1">Kosten</h4>
                      <p className="font-medium">{dossier.annualCost ? `€ ${dossier.annualCost}` : '-'}</p>
                    </div>
                    <div>
                      <h4 className="text-sm font-medium text-muted-foreground mb-1">Winst</h4>
                      <p className="font-medium">{dossier.annualProfit ? `€ ${dossier.annualProfit}` : '-'}</p>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="documents">
          <Card>
            <CardHeader>
              <CardTitle>Geüploade Documenten</CardTitle>
            </CardHeader>
            <CardContent>
              {documents && documents.length > 0 ? (
                <div className="space-y-2">
                  {documents.map(doc => (
                    <div key={doc.id} className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/10">
                      <div className="flex items-center gap-3">
                        <FileText className="w-5 h-5 text-muted-foreground" />
                        <div>
                          <p className="text-sm font-medium">{doc.filename}</p>
                          <p className="text-xs text-muted-foreground capitalize">{doc.documentType.replace('_', ' ')}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <span className={`text-xs px-2 py-1 rounded ${doc.validationStatus === 'valid' ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}`}>
                          {doc.validationStatus === 'valid' ? 'Gevalideerd' : 'Niet gevalideerd'}
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8"
                          onClick={() => handleDownload(doc.id, doc.filename)}
                          disabled={downloadingId === doc.id}
                        >
                          {downloadingId === doc.id
                            ? <Loader2 className="w-4 h-4 animate-spin" />
                            : <Download className="w-4 h-4" />}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-center py-8 text-muted-foreground">Geen documenten gevonden.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="conditions">
          <Card>
            <CardHeader>
              <CardTitle>Aanvullende voorwaarden &amp; reacties</CardTitle>
              <CardDescription>
                Beoordeel de reacties van de prospect op de gevraagde
                aanvullende informatie. Markeer een reactie als opgelost
                wanneer deze voldoet. Zodra alle blokkerende voorwaarden
                opgelost zijn, kun je het dossier terugzetten naar
                beoordeling.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  Tip: zet interne credit-bevindingen om in heldere
                  ondernemer-vragen voordat je ze opvraagt.
                </p>
                <Button
                  size="sm"
                  onClick={openRequestInfoBlank}
                  data-testid="lo-button-request-additional-info"
                >
                  <Mail className="w-4 h-4 mr-2" />
                  Aanvullende informatie vragen
                </Button>
              </div>
              {!conditions || conditions.length === 0 ? (
                <p className="text-sm italic text-muted-foreground">
                  Er zijn geen voorwaarden vastgelegd voor dit dossier.
                </p>
              ) : (
                <>
                  {(() => {
                    const blocking = conditions.filter(c => c.type === "blocking");
                    const open = blocking.filter(c => c.status === "open").length;
                    const submitted = blocking.filter(c => c.status === "submitted").length;
                    const resolved = blocking.filter(c => c.status === "resolved").length;
                    const allResolved = blocking.length > 0 && resolved === blocking.length;
                    return (
                      <>
                        <div className="flex flex-wrap gap-2 text-xs">
                          <Badge variant="outline" className="border-amber-400 text-amber-900" data-testid="lo-conditions-open-count">
                            {open} open
                          </Badge>
                          <Badge variant="outline" className="border-blue-400 text-blue-900" data-testid="lo-conditions-submitted-count">
                            {submitted} ingediend
                          </Badge>
                          <Badge variant="outline" className="border-green-400 text-green-900" data-testid="lo-conditions-resolved-count">
                            {resolved} opgelost
                          </Badge>
                        </div>
                        {dossier.status === "additional_info_requested" && (
                          <div className="flex justify-end">
                            <Button
                              size="sm"
                              onClick={handleReturnToReview}
                              disabled={!allResolved || returnToReviewMutation.isPending}
                              data-testid="button-return-to-review"
                            >
                              {returnToReviewMutation.isPending ? (
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                              ) : null}
                              Terugzetten naar beoordeling
                            </Button>
                          </div>
                        )}
                      </>
                    );
                  })()}
                  <div className="space-y-3">
                    {conditions.map(c => {
                      const isRequested = !!c.requestedAt;
                      return (
                      <div
                        key={c.id}
                        data-testid={`lo-condition-${c.id}`}
                        data-status={c.status}
                        data-visibility={isRequested ? "requested" : "internal"}
                        className="rounded-lg border p-4 space-y-2"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <h4 className="font-medium">{c.title}</h4>
                            {c.requiredAction && c.requiredAction !== c.title && (
                              <p className="text-sm text-muted-foreground">{c.requiredAction}</p>
                            )}
                            <div className="flex flex-wrap gap-2 mt-1">
                              <Badge variant="outline" className="text-[10px]">
                                {c.type === "blocking" ? "blokkerend" : "advies"}
                              </Badge>
                              <Badge variant="outline" className="text-[10px]">
                                {c.status === "open" ? (isRequested ? "open bij ondernemer" : "intern") : c.status === "submitted" ? "ingediend" : "opgelost"}
                              </Badge>
                              {isRequested ? (
                                <Badge
                                  variant="outline"
                                  className="text-[10px] border-blue-400 text-blue-900"
                                  data-testid={`lo-badge-requested-${c.id}`}
                                >
                                  gevraagd bij ondernemer
                                </Badge>
                              ) : (
                                <Badge
                                  variant="outline"
                                  className="text-[10px] border-slate-400 text-slate-700"
                                  data-testid={`lo-badge-internal-${c.id}`}
                                >
                                  alleen intern
                                </Badge>
                              )}
                            </div>
                            {isRequested && c.prospectTitle && c.prospectTitle !== c.title && (
                              <div className="mt-2 rounded-md bg-blue-50/60 dark:bg-blue-950/20 p-2 text-xs space-y-0.5">
                                <p className="font-medium text-blue-900 dark:text-blue-200">Prospect ziet:</p>
                                <p className="text-blue-900/80 dark:text-blue-200/80">{c.prospectTitle}</p>
                                {c.prospectExplanation && (
                                  <p className="text-blue-900/70 dark:text-blue-200/70 italic">{c.prospectExplanation}</p>
                                )}
                              </div>
                            )}
                          </div>
                          <div className="flex flex-col gap-1 shrink-0">
                            {c.type === "blocking" && c.status === "open" && !isRequested && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => openRequestInfoFromCondition(c)}
                                data-testid={`lo-request-${c.id}`}
                              >
                                <Mail className="w-3.5 h-3.5 mr-1.5" />
                                Opvragen bij ondernemer
                              </Button>
                            )}
                            {c.type === "blocking" && c.status === "submitted" && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleResolveCondition(c.id)}
                                disabled={resolveConditionMutation.isPending}
                                data-testid={`lo-resolve-${c.id}`}
                              >
                                Markeer als opgelost
                              </Button>
                            )}
                            {c.type === "blocking" && c.status === "open" && isRequested && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  setForceResolveTarget(c);
                                  setForceResolveNote("");
                                }}
                                data-testid={`lo-force-resolve-${c.id}`}
                              >
                                Forceer oplossen
                              </Button>
                            )}
                          </div>
                        </div>
                        {c.reviewerNotes && (
                          <p className="text-sm bg-muted/30 p-2 rounded">
                            <span className="font-medium">Interne notitie:</span> {c.reviewerNotes}
                          </p>
                        )}
                        {(c.responseText || c.responseDocumentFilename) && (
                          <div className="rounded-md bg-blue-50/60 dark:bg-blue-950/20 p-3 text-sm space-y-1">
                            <p className="font-medium text-blue-900 dark:text-blue-200">
                              Reactie van prospect
                            </p>
                            {c.responseText && (
                              <p className="whitespace-pre-wrap text-blue-900/80 dark:text-blue-200/80">
                                "{c.responseText}"
                              </p>
                            )}
                            {c.responseDocumentFilename && (
                              <p className="text-blue-900/80 dark:text-blue-200/80">
                                Document: {c.responseDocumentFilename}
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                      );
                    })}
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Request additional information dialog */}
          <Dialog open={isRequestInfoOpen} onOpenChange={setIsRequestInfoOpen}>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="lo-request-info-dialog">
              <DialogHeader>
                <DialogTitle>Aanvullende informatie vragen</DialogTitle>
                <DialogDescription>
                  Schrijf elk verzoek in heldere ondernemer-taal. Wat de
                  ondernemer hieronder ziet, is precies wat hij/zij in
                  het portaal te zien krijgt.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                {requestDraft.map((draft, idx) => (
                  <div
                    key={idx}
                    className="rounded-lg border p-3 space-y-3"
                    data-testid={`lo-request-draft-${idx}`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-muted-foreground">
                        Verzoek {idx + 1}{draft.internalConditionId ? " · gebaseerd op interne voorwaarde" : ""}
                      </span>
                      {requestDraft.length > 1 && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => removeDraftItem(idx)}
                          data-testid={`lo-request-remove-${idx}`}
                        >
                          Verwijderen
                        </Button>
                      )}
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium">Titel voor de ondernemer</label>
                      <input
                        className="w-full rounded-md border px-3 py-2 text-sm"
                        value={draft.prospectTitle}
                        onChange={(e) => updateDraftItem(idx, { prospectTitle: e.target.value })}
                        placeholder='Bijv. "Upload de offerte of factuur van de vergistingstanks"'
                        data-testid={`lo-request-title-${idx}`}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium">Toelichting (waarom we dit vragen)</label>
                      <Textarea
                        value={draft.prospectExplanation}
                        onChange={(e) => updateDraftItem(idx, { prospectExplanation: e.target.value })}
                        rows={3}
                        placeholder="Met deze informatie kunnen we beter beoordelen…"
                        data-testid={`lo-request-explanation-${idx}`}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium">Gevraagde actie</label>
                      <Textarea
                        value={draft.prospectRequiredAction}
                        onChange={(e) => updateDraftItem(idx, { prospectRequiredAction: e.target.value })}
                        rows={2}
                        placeholder="Upload een offerte, factuur, taxatie of specificatie."
                        data-testid={`lo-request-action-${idx}`}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium">Document-hint (optioneel)</label>
                      <input
                        className="w-full rounded-md border px-3 py-2 text-sm"
                        value={draft.documentTypeHint}
                        onChange={(e) => updateDraftItem(idx, { documentTypeHint: e.target.value })}
                        placeholder='Bijv. "offerte_tanks.pdf"'
                        data-testid={`lo-request-hint-${idx}`}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium">Interne notitie (alleen voor de kredietacceptant)</label>
                      <Textarea
                        value={draft.reviewerNotes}
                        onChange={(e) => updateDraftItem(idx, { reviewerNotes: e.target.value })}
                        rows={2}
                        placeholder="Interne context, niet zichtbaar voor de ondernemer."
                        data-testid={`lo-request-note-${idx}`}
                      />
                    </div>
                  </div>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={addDraftItem}
                  data-testid="lo-request-add-item"
                >
                  + Extra verzoek toevoegen
                </Button>
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setIsRequestInfoOpen(false)}>
                  Annuleren
                </Button>
                <Button
                  onClick={handleSubmitRequestInfo}
                  disabled={requestAdditionalInfoMutation.isPending}
                  data-testid="lo-request-submit"
                >
                  {requestAdditionalInfoMutation.isPending ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4 mr-2" />
                  )}
                  Verzoek versturen
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Force-resolve dialog */}
          <Dialog open={!!forceResolveTarget} onOpenChange={(o) => { if (!o) { setForceResolveTarget(null); setForceResolveNote(""); } }}>
            <DialogContent data-testid="lo-force-resolve-dialog">
              <DialogHeader>
                <DialogTitle>Zonder reactie afhandelen</DialogTitle>
                <DialogDescription>
                  Je sluit dit punt zonder reactie van de ondernemer.
                  Geef een interne notitie waarom dit verantwoord is —
                  deze is alleen zichtbaar voor de kredietacceptant.
                </DialogDescription>
              </DialogHeader>
              <Textarea
                value={forceResolveNote}
                onChange={(e) => setForceResolveNote(e.target.value)}
                rows={4}
                placeholder="Bijv. 'Telefonisch akkoord met ondernemer op 18-05; aanvullende documentatie n.v.t.'"
                data-testid="lo-force-resolve-note"
              />
              <DialogFooter>
                <Button variant="ghost" onClick={() => { setForceResolveTarget(null); setForceResolveNote(""); }}>
                  Annuleren
                </Button>
                <Button
                  onClick={handleForceResolve}
                  disabled={resolveConditionMutation.isPending}
                  data-testid="lo-force-resolve-submit"
                >
                  {resolveConditionMutation.isPending ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : null}
                  Forceer oplossen
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </TabsContent>

        <TabsContent value="memo">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <div>
                <CardTitle>Kredietmemorandum</CardTitle>
                <CardDescription>Gestandaardiseerd format voor partner financiers.</CardDescription>
              </div>
              {!memo && (
                <Button onClick={handleGenerateMemo} disabled={memoMutation.isPending}>
                  {memoMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <FileText className="w-4 h-4 mr-2" />}
                  Genereer Memorandum
                </Button>
              )}
            </CardHeader>
            <CardContent>
              {memo ? (
                <div className="space-y-6 pt-4">
                  {memo.sections.map((section, idx) => (
                    <div key={idx} className="space-y-2">
                      <h3 className="text-lg font-semibold border-b pb-1">{section.title}</h3>
                      <div className="text-sm whitespace-pre-wrap leading-relaxed text-muted-foreground font-mono bg-muted/20 p-4 rounded-md">
                        {section.body}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-12 flex flex-col items-center text-center">
                  <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
                    <FileText className="w-8 h-8 text-muted-foreground" />
                  </div>
                  <h3 className="text-lg font-medium mb-1">Nog geen memorandum</h3>
                  <p className="text-muted-foreground text-sm max-w-sm mb-4">
                    Genereer een gestandaardiseerd kredietmemorandum gebaseerd op de AI analyse en uw beoordeling.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="partners" className="space-y-6">
          {!SUBMITTABLE_STATUSES.has(dossier.status) && (
            <Alert data-testid="partners-already-submitted">
              <CheckCircle2 className="w-4 h-4" />
              <AlertTitle>Reeds aangeboden bij partners</AlertTitle>
              <AlertDescription>
                Dit dossier is al aangeboden bij partners en kan niet opnieuw worden ingediend.
                Hieronder zie je de bestaande aanbiedingen.
              </AlertDescription>
            </Alert>
          )}

          {SUBMITTABLE_STATUSES.has(dossier.status) && (
            <Card data-testid="partner-selection-card">
              <CardHeader>
                <CardTitle>Partner Selectie</CardTitle>
                <CardDescription>
                  Selecteer één of meer actieve financiers voor dit dossier. Aangevraagd bedrag:
                  {" "}<strong>€{Number(requestedAmountNum).toLocaleString("nl-NL")}</strong>
                  {" • "}Doel: {dossier.financingPurpose ?? "n.v.t."}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {activePartners.length === 0 ? (
                  <Alert variant="destructive">
                    <AlertCircle className="w-4 h-4" />
                    <AlertTitle>Geen actieve partners beschikbaar</AlertTitle>
                    <AlertDescription>
                      Er zijn momenteel geen actieve partner-financiers geconfigureerd.
                      Vraag een beheerder om partners toe te voegen of te activeren.
                    </AlertDescription>
                  </Alert>
                ) : (
                  <div className="space-y-3">
                    {activePartners.map(partner => {
                      const fits = partnerFitsTicketRange(partner);
                      const min = partner.minimumTicketSize ?? null;
                      const max = partner.maximumTicketSize ?? null;
                      const ticketLabel =
                        min !== null || max !== null
                          ? `€${(min ?? 0).toLocaleString("nl-NL")}–€${(max ?? 0).toLocaleString("nl-NL")}`
                          : "geen ticket-range opgegeven";
                      return (
                        <div
                          key={partner.id}
                          data-testid={`partner-row-${partner.id}`}
                          className="flex items-start space-x-3 p-3 border rounded-lg"
                        >
                          <Checkbox
                            id={`partner-${partner.id}`}
                            data-testid={`partner-checkbox-${partner.id}`}
                            checked={selectedPartners.includes(partner.id)}
                            onCheckedChange={(checked) => {
                              if (checked) setSelectedPartners(prev => [...prev, partner.id]);
                              else setSelectedPartners(prev => prev.filter(pid => pid !== partner.id));
                            }}
                          />
                          <div className="grid gap-1.5 leading-none flex-1">
                            <div className="flex items-center gap-2">
                              <label htmlFor={`partner-${partner.id}`} className="text-sm font-medium leading-none cursor-pointer">
                                {partner.name}
                              </label>
                              <Badge variant="outline" className="text-[10px]">actief</Badge>
                              {!fits && (
                                <Badge variant="outline" className="text-[10px] border-amber-300 text-amber-700">
                                  buiten ticket-range
                                </Badge>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground">
                              Focus: {partner.productFocus} • Ticket: {ticketLabel}
                            </p>
                            {partner.notes && (
                              <p className="text-xs text-muted-foreground italic">{partner.notes}</p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {ticketWarnings.length > 0 && (
                  <Alert
                    data-testid="ticket-range-warning"
                    className="border-amber-300 bg-amber-50 text-amber-900"
                  >
                    <AlertTriangle className="w-4 h-4" />
                    <AlertTitle>Aangevraagd bedrag valt buiten ticket-range</AlertTitle>
                    <AlertDescription>
                      €{Number(requestedAmountNum).toLocaleString("nl-NL")} past niet bij:{" "}
                      {ticketWarnings.map(p => p.name).join(", ")}.
                      De aanbieding wordt alsnog verstuurd, maar partners zullen mogelijk afzien.
                    </AlertDescription>
                  </Alert>
                )}

                <div className="flex gap-2 pt-2">
                  <Button
                    variant="outline"
                    onClick={() => setLocation("/dossiers")}
                    data-testid="button-back-to-queue"
                  >
                    <ArrowLeft className="w-4 h-4 mr-2" /> Terug naar wachtrij
                  </Button>
                  <Button
                    className="flex-1"
                    disabled={selectedPartners.length === 0 || submitPartnerMutation.isPending}
                    onClick={openPackagePreview}
                    data-testid="button-prepare-package"
                  >
                    <FileText className="w-4 h-4 mr-2" />
                    Aanbiedpakket voorbereiden ({selectedPartners.length})
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          <Card data-testid="partner-submissions-card">
            <CardHeader>
              <CardTitle>Verzonden aanbiedingen</CardTitle>
              <CardDescription>Mock-aanbiedingen die voor dit dossier zijn aangemaakt.</CardDescription>
            </CardHeader>
            <CardContent>
              {!existingSubmissions || existingSubmissions.length === 0 ? (
                <p className="text-sm text-muted-foreground italic">Nog geen aanbiedingen verzonden.</p>
              ) : (
                <div className="space-y-3" data-testid="partner-submissions-list">
                  {existingSubmissions.map(s => (
                    <div key={s.id} className="border rounded-lg p-3 space-y-1" data-testid={`submission-${s.id}`}>
                      <div className="flex items-center gap-2">
                        <Mail className="w-4 h-4 text-muted-foreground" />
                        <span className="text-sm font-medium">{s.partnerName}</span>
                        <Badge variant="outline" className="text-[10px]">{s.status}</Badge>
                        {s.usedMockMode && (
                          <Badge variant="outline" className="text-[10px]">mock</Badge>
                        )}
                      </div>
                      {s.packageSummary && (
                        <p className="text-xs text-muted-foreground">{s.packageSummary}</p>
                      )}
                      {s.submittedAt && (
                        <p className="text-xs text-muted-foreground">
                          Verzonden: {format(new Date(s.submittedAt), "d MMM yyyy HH:mm", { locale: nl })}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={isDecisionDialogOpen} onOpenChange={setIsDecisionDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {decisionType === 'approve' && 'Goedkeuren voor partners'}
              {decisionType === 'reject' && 'Dossier afwijzen'}
              {decisionType === 'request_additional_info' && 'Aanvullende info vragen'}
            </DialogTitle>
            <DialogDescription>
              {decisionType === 'request_additional_info'
                ? 'Beschrijf concreet welke aanvullende informatie de ondernemer moet aanleveren. Eén item per regel — elk item wordt als blokkerende voorwaarde aangemaakt.'
                : 'Voeg notities toe bij uw besluit. Deze zijn alleen zichtbaar voor het team — de ondernemer ziet alleen de status en eventueel gevraagde items.'}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-4">
            {decisionType === 'request_additional_info' && (
              <div className="space-y-1">
                <label className="text-sm font-medium" htmlFor="decision-requested-items">
                  Gevraagde items <span className="text-destructive">*</span>
                </label>
                <Textarea
                  id="decision-requested-items"
                  data-testid="decision-requested-items"
                  placeholder={"Bijv:\nKopie identiteitsbewijs DGA\nMeest recente bankafschrift Q4"}
                  value={requestedItemsText}
                  onChange={e => setRequestedItemsText(e.target.value)}
                  rows={4}
                />
                <p className="text-xs text-muted-foreground">
                  {parsedRequestedItems.length === 0
                    ? 'Nog geen items.'
                    : `${parsedRequestedItems.length} ${parsedRequestedItems.length === 1 ? 'item' : 'items'} worden aangemaakt.`}
                </p>
              </div>
            )}
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="decision-notes">
                Interne notities (optioneel)
              </label>
              <Textarea
                id="decision-notes"
                data-testid="decision-notes"
                placeholder="Typ hier uw motivatie of notities..."
                value={decisionNotes}
                onChange={e => setDecisionNotes(e.target.value)}
                rows={4}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDecisionDialogOpen(false)} disabled={decisionMutation.isPending}>Annuleren</Button>
            <Button
              variant={decisionType === 'reject' ? 'destructive' : 'default'}
              className={decisionType === 'approve' ? 'bg-green-600 hover:bg-green-700' : ''}
              onClick={handleDecision}
              data-testid="button-confirm-decision"
              disabled={
                decisionMutation.isPending ||
                (decisionType === 'request_additional_info' && parsedRequestedItems.length === 0)
              }
            >
              {decisionMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Bevestig Besluit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isPackagePreviewOpen} onOpenChange={setIsPackagePreviewOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto" data-testid="package-preview-dialog">
          <DialogHeader>
            <DialogTitle>Aanbiedpakket — voorbeeld</DialogTitle>
            <DialogDescription>
              Dit is een interne preview van het pakket dat (in mock-modus) naar de geselecteerde partners
              wordt verzonden. De ondernemer ziet deze inhoud niet.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 text-sm">
            <section>
              <h4 className="font-semibold mb-1">Bedrijf & aanvraag</h4>
              <ul className="text-muted-foreground space-y-0.5">
                <li>Bedrijf: {dossier.prospect?.companyName ?? "n.v.t."}</li>
                <li>Contactpersoon: {dossier.prospect?.contactName ?? "n.v.t."}</li>
                <li>Aangevraagd bedrag: €{Number(requestedAmountNum).toLocaleString("nl-NL")}</li>
                <li>Doel: {dossier.financingPurpose ?? "n.v.t."}</li>
                <li>Voorkeur financieringstype: {dossier.financingTypePreference ?? "n.v.t."}</li>
              </ul>
            </section>

            <Separator />

            <section>
              <h4 className="font-semibold mb-1">AI-verdict & scores</h4>
              <ul className="text-muted-foreground space-y-0.5">
                <li>Verdict: {dossier.aiVerdict ?? "n.v.t."}</li>
                <li>Volledigheid: {dossier.completenessScore ?? "—"} / 100</li>
                <li>Correctheid: {dossier.correctnessScore ?? "—"} / 100</li>
                <li>Vertrouwen: {dossier.confidenceScore ?? "—"} / 100</li>
                <li>Levensvatbaarheid: {dossier.viabilityScore ?? "—"} / 100</li>
              </ul>
            </section>

            {dualAdvice && (
              <>
                <Separator />
                <section>
                  <h4 className="font-semibold mb-1">Dual-view advies</h4>
                  <p className="text-muted-foreground text-xs">
                    Partnerview &amp; ondernemerview beschikbaar — zie tab AI Analyse voor volledige tekst.
                  </p>
                </section>
              </>
            )}

            {report && (
              <>
                <Separator />
                <section>
                  <h4 className="font-semibold mb-1">Financierrapportage</h4>
                  <p className="text-muted-foreground text-xs">
                    Volledig rapport beschikbaar — zie tab AI Analyse.
                  </p>
                </section>
              </>
            )}

            <Separator />

            <section>
              <h4 className="font-semibold mb-1">Geselecteerde partners ({selectedPartnerObjects.length})</h4>
              <ul className="text-muted-foreground space-y-0.5">
                {selectedPartnerObjects.map(p => (
                  <li key={p.id}>
                    {p.name} — {p.productFocus}
                    {!partnerFitsTicketRange(p) && (
                      <span className="text-amber-700 ml-1">(buiten ticket-range)</span>
                    )}
                  </li>
                ))}
              </ul>
            </section>

            <Separator />

            <section>
              <h4 className="font-semibold mb-1">Documenten ({documents?.length ?? 0})</h4>
              {documents && documents.length > 0 ? (
                <ul className="text-muted-foreground space-y-0.5">
                  {documents.map(d => (
                    <li key={d.id}>{d.filename} ({d.documentType})</li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground italic">Geen documenten gekoppeld.</p>
              )}
            </section>

            <Separator />

            <section className="space-y-1">
              <label htmlFor="partner-submission-notes" className="font-semibold">
                Begeleidende notitie aan partner (optioneel)
              </label>
              <Textarea
                id="partner-submission-notes"
                data-testid="partner-submission-notes"
                placeholder="Bijv: focus ligt op snelle besluitvorming..."
                value={partnerSubmissionNotes}
                onChange={e => setPartnerSubmissionNotes(e.target.value)}
                rows={3}
              />
            </section>

            <Alert className="border-blue-300 bg-blue-50 text-blue-900">
              <Mail className="w-4 h-4" />
              <AlertTitle>Mock-verzending</AlertTitle>
              <AlertDescription className="text-xs">
                Verzending gebeurt in mock-modus — er wordt geen daadwerkelijke e-mail verstuurd.
                Voor elke geselecteerde partner wordt een PartnerSubmission-record (status:
                <code className="mx-1">submitted_mock</code>) aangemaakt en het dossier gaat naar
                status <code>submitted_to_partners</code>.
              </AlertDescription>
            </Alert>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsPackagePreviewOpen(false)}
              disabled={submitPartnerMutation.isPending}
            >
              Annuleren
            </Button>
            <Button
              onClick={handleSubmitToPartners}
              disabled={submitPartnerMutation.isPending}
              data-testid="button-confirm-mock-send"
            >
              {submitPartnerMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Send className="w-4 h-4 mr-2" />
              )}
              Mock-verzending bevestigen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}