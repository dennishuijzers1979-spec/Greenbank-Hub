import { useGetMyDossier, getGetMyDossierQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ProgressSteps } from "@/components/ui/progress-steps";
import { PROSPECT_PIPELINE_STEPS, getCurrentStepIndex, getStatusLabel } from "@/lib/dossier-utils";
import { Link } from "wouter";
import { ArrowRight, FileText, Upload, BrainCircuit, ActivitySquare, AlertCircle } from "lucide-react";

export default function ProspectDashboard() {
  const { data: dossier, isLoading, isError } = useGetMyDossier({
    query: {
      queryKey: getGetMyDossierQueryKey()
    }
  });

  if (isLoading) {
    return (
      <div className="p-8 max-w-5xl mx-auto space-y-8 animate-pulse">
        <div className="h-32 bg-muted rounded-xl"></div>
        <div className="h-64 bg-muted rounded-xl"></div>
      </div>
    );
  }

  if (isError || !dossier) {
    return (
      <div className="p-8 max-w-5xl mx-auto">
        <Card className="border-destructive">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive"><AlertCircle /> Fout bij laden</CardTitle>
            <CardDescription>Kan uw dossier niet laden. Probeer het later opnieuw.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const stepIndex = getCurrentStepIndex(dossier.status, {
    companyName: dossier.prospect?.companyName,
    financingPurpose: dossier.financingPurpose,
    requestedAmount: dossier.requestedAmount,
    annualRevenue: dossier.annualRevenue,
    annualCost: dossier.annualCost,
    annualProfit: dossier.annualProfit,
  });
  
  return (
    <div className="p-6 md:p-10 max-w-5xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-serif font-bold tracking-tight mb-2">Welkom terug, {dossier.prospect?.contactName?.split(' ')[0] || 'Ondernemer'}</h1>
        <p className="text-muted-foreground text-lg">Laten we samen aan de slag gaan met de financieringsaanvraag voor {dossier.prospect?.companyName}.</p>
      </div>

      <Card className="border-primary/20 shadow-md">
        <CardHeader className="bg-primary/5 pb-8 border-b">
          <CardTitle className="text-xl">Uw Financieringsreis</CardTitle>
          <CardDescription>Status: <span className="font-medium text-foreground">{getStatusLabel(dossier.status)}</span></CardDescription>
          
          <div className="pt-6 px-4 md:px-8">
            <ProgressSteps steps={PROSPECT_PIPELINE_STEPS} currentStepIndex={stepIndex} />
          </div>
        </CardHeader>
        
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <h3 className="font-medium text-lg">Volgende stappen</h3>
              
              <Link href="/dossier/intake" className="block">
                <Card className={`transition-colors hover-elevate cursor-pointer ${stepIndex === 0 ? 'border-primary bg-primary/5' : ''}`}>
                  <CardContent className="p-4 flex items-center gap-4">
                    <div className={`p-2 rounded-full ${stepIndex === 0 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
                      <FileText className="w-5 h-5" />
                    </div>
                    <div className="flex-1">
                      <h4 className="font-medium">Bedrijfsgegevens & Behoefte</h4>
                      <p className="text-sm text-muted-foreground">{dossier.intakeCompletionPercent}% voltooid</p>
                    </div>
                    <ArrowRight className="w-4 h-4 text-muted-foreground" />
                  </CardContent>
                </Card>
              </Link>

              <Link href="/dossier/documenten" className="block">
                <Card className={`transition-colors hover-elevate cursor-pointer ${stepIndex === 1 ? 'border-primary bg-primary/5' : ''}`}>
                  <CardContent className="p-4 flex items-center gap-4">
                    <div className={`p-2 rounded-full ${stepIndex === 1 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
                      <Upload className="w-5 h-5" />
                    </div>
                    <div className="flex-1">
                      <h4 className="font-medium">Documenten Uploaden</h4>
                      <p className="text-sm text-muted-foreground">{dossier.documentsCount} documenten</p>
                    </div>
                    <ArrowRight className="w-4 h-4 text-muted-foreground" />
                  </CardContent>
                </Card>
              </Link>
            </div>

            <div className="space-y-4">
              <h3 className="font-medium text-lg">Inzichten</h3>
              
              <Link href="/dossier/rapport" className="block">
                <Card className={`transition-colors hover-elevate cursor-pointer ${stepIndex >= 3 ? 'border-primary bg-primary/5' : 'opacity-70'}`}>
                  <CardContent className="p-4 flex items-center gap-4">
                    <div className={`p-2 rounded-full ${stepIndex >= 3 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
                      <BrainCircuit className="w-5 h-5" />
                    </div>
                    <div className="flex-1">
                      <h4 className="font-medium">AI Ondernemersrapport</h4>
                      <p className="text-sm text-muted-foreground">
                        {stepIndex >= 3 ? 'Bekijk uw sterke punten en actiepunten' : 'Beschikbaar na documentanalyse'}
                      </p>
                    </div>
                    {stepIndex >= 3 && <ArrowRight className="w-4 h-4 text-muted-foreground" />}
                  </CardContent>
                </Card>
              </Link>
            </div>
          </div>
        </CardContent>
        <CardFooter className="bg-muted/30 border-t flex justify-end p-4">
          <Link href="/dossier" className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2">
            Naar Dossier Overzicht <ArrowRight className="ml-2 w-4 h-4" />
          </Link>
        </CardFooter>
      </Card>
    </div>
  );
}