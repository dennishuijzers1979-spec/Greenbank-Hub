import { useGetMyDossier, getGetMyDossierQueryKey, useSubmitMyDossier } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ProgressSteps } from "@/components/ui/progress-steps";
import { PROSPECT_PIPELINE_STEPS, getCurrentStepIndex, getStatusLabel } from "@/lib/dossier-utils";
import { Link, useLocation } from "wouter";
import { AlertCircle, FileText, Upload, BrainCircuit, CheckCircle2, ArrowRight, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function DossierHub() {
  const { data: dossier, isLoading, isError } = useGetMyDossier({
    query: {
      queryKey: getGetMyDossierQueryKey()
    }
  });
  
  const submitMutation = useSubmitMyDossier();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

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

  const handleSubmitToBank = () => {
    submitMutation.mutate(undefined, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetMyDossierQueryKey() });
        toast({
          title: "Dossier ingediend!",
          description: "Uw dossier is succesvol ingediend bij de kredietbeoordelaars.",
        });
      },
      onError: (err) => {
        toast({
          title: "Fout bij indienen",
          description: "Er is iets misgegaan. Probeer het later opnieuw.",
          variant: "destructive"
        });
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

      {/* Submission Card */}
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