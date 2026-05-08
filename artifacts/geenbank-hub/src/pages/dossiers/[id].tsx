import { useState } from "react";
import { useLocation, useParams } from "wouter";
import { 
  useGetDossier, getGetDossierQueryKey,
  useMakeDossierDecision,
  useGetFinancierReport, getGetFinancierReportQueryKey,
  useListDossierDocuments, getListDossierDocumentsQueryKey,
  useGenerateMemorandum, useGetMemorandum, getGetMemorandumQueryKey,
  useListPartners, getListPartnersQueryKey,
  useSubmitDossierToPartners
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { AlertCircle, AlertTriangle, ArrowLeft, Building2, CheckCircle2, Clock, Download, FileText, Loader2, Send, XCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { nl } from "date-fns/locale";

export default function DossierDetail() {
  const params = useParams<{ id: string }>();
  const id = params.id as string;
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [decisionNotes, setDecisionNotes] = useState("");
  const [selectedPartners, setSelectedPartners] = useState<string[]>([]);
  const [isDecisionDialogOpen, setIsDecisionDialogOpen] = useState(false);
  const [decisionType, setDecisionType] = useState<"approve" | "reject" | "request_additional_info" | null>(null);

  const { data: dossier, isLoading } = useGetDossier(id, { query: { queryKey: getGetDossierQueryKey(id), enabled: !!id } });
  const { data: report } = useGetFinancierReport(id, { query: { queryKey: getGetFinancierReportQueryKey(id), enabled: !!id } });
  const { data: documents } = useListDossierDocuments(id, { query: { queryKey: getListDossierDocumentsQueryKey(id), enabled: !!id } });
  const { data: memo } = useGetMemorandum(id, { query: { queryKey: getGetMemorandumQueryKey(id), enabled: !!id, retry: false } });
  const { data: partners } = useListPartners({ query: { queryKey: getListPartnersQueryKey() } });

  const decisionMutation = useMakeDossierDecision();
  const memoMutation = useGenerateMemorandum();
  const submitPartnerMutation = useSubmitDossierToPartners();

  if (isLoading || !dossier) {
    return <div className="p-8 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }

  const handleDecision = () => {
    if (!decisionType) return;
    
    decisionMutation.mutate({ dossierId: id, data: { decision: decisionType, notes: decisionNotes } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetDossierQueryKey(id) });
        setIsDecisionDialogOpen(false);
        toast({ title: "Besluit opgeslagen", description: `Dossier status is bijgewerkt.` });
      }
    });
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

  const handleSubmitToPartners = () => {
    if (selectedPartners.length === 0) {
      toast({ title: "Selecteer partners", description: "Kies minimaal 1 partner.", variant: "destructive" });
      return;
    }

    submitPartnerMutation.mutate({ dossierId: id, data: { partnerIds: selectedPartners } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetDossierQueryKey(id) });
        toast({ title: "Ingediend", description: "Dossier verstuurd naar geselecteerde partners." });
        setSelectedPartners([]);
      }
    });
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

        {dossier.status === 'loan_officer_review' && (
          <div className="flex gap-2">
            <Button variant="outline" className="text-amber-600 border-amber-200 hover:bg-amber-50" onClick={() => { setDecisionType("request_additional_info"); setIsDecisionDialogOpen(true); }}>
              Aanvullende info vragen
            </Button>
            <Button variant="destructive" onClick={() => { setDecisionType("reject"); setIsDecisionDialogOpen(true); }}>
              Afwijzen
            </Button>
            <Button className="bg-green-600 hover:bg-green-700 text-white" onClick={() => { setDecisionType("approve"); setIsDecisionDialogOpen(true); }}>
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
          <TabsTrigger value="memo" disabled={!['approved_for_partner_submission', 'memorandum_generated', 'submitted_to_partners'].includes(dossier.status)}>Memorandum</TabsTrigger>
          <TabsTrigger value="partners" disabled={!['memorandum_generated', 'submitted_to_partners'].includes(dossier.status)}>Partners</TabsTrigger>
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
                        <Button variant="ghost" size="sm" className="h-8"><Download className="w-4 h-4" /></Button>
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

        <TabsContent value="partners">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card className="md:col-span-2">
              <CardHeader>
                <CardTitle>Partner Selectie</CardTitle>
                <CardDescription>Selecteer de financiers waarnaar dit dossier verstuurd moet worden.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {partners?.map(partner => (
                    <div key={partner.id} className="flex items-start space-x-3 p-3 border rounded-lg">
                      <Checkbox 
                        id={`partner-${partner.id}`} 
                        checked={selectedPartners.includes(partner.id)}
                        onCheckedChange={(checked) => {
                          if (checked) setSelectedPartners(prev => [...prev, partner.id]);
                          else setSelectedPartners(prev => prev.filter(id => id !== partner.id));
                        }}
                      />
                      <div className="grid gap-1.5 leading-none">
                        <label htmlFor={`partner-${partner.id}`} className="text-sm font-medium leading-none cursor-pointer">
                          {partner.name}
                        </label>
                        <p className="text-xs text-muted-foreground">Focus: {partner.productFocus}</p>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-6">
                  <Button 
                    className="w-full" 
                    disabled={selectedPartners.length === 0 || submitPartnerMutation.isPending}
                    onClick={handleSubmitToPartners}
                  >
                    {submitPartnerMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
                    Verstuur naar {selectedPartners.length} {selectedPartners.length === 1 ? 'partner' : 'partners'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
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
              Voeg notities toe bij uw besluit. Deze zijn zichtbaar voor het team.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Textarea 
              placeholder="Typ hier uw motivatie of notities..." 
              value={decisionNotes}
              onChange={e => setDecisionNotes(e.target.value)}
              rows={4}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDecisionDialogOpen(false)}>Annuleren</Button>
            <Button 
              variant={decisionType === 'reject' ? 'destructive' : 'default'}
              className={decisionType === 'approve' ? 'bg-green-600 hover:bg-green-700' : ''}
              onClick={handleDecision}
              disabled={decisionMutation.isPending}
            >
              {decisionMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Bevestig Besluit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}