import { useGetMyEntrepreneurReport, getGetMyEntrepreneurReportQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, CheckCircle2, AlertTriangle, Lightbulb, TrendingUp, BrainCircuit, Loader2 } from "lucide-react";
import { Link, useLocation } from "wouter";

export default function Rapportage() {
  const [, setLocation] = useLocation();
  const { data: report, isLoading, isError } = useGetMyEntrepreneurReport({
    query: {
      queryKey: getGetMyEntrepreneurReportQueryKey(),
      retry: false
    }
  });

  if (isLoading) {
    return (
      <div className="p-8 max-w-4xl mx-auto space-y-8 animate-pulse">
        <div className="h-12 w-64 bg-muted rounded"></div>
        <div className="h-40 bg-muted rounded-xl"></div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="h-64 bg-muted rounded-xl"></div>
          <div className="h-64 bg-muted rounded-xl"></div>
        </div>
      </div>
    );
  }

  if (isError || !report) {
    return (
      <div className="p-6 md:p-10 max-w-4xl mx-auto space-y-6">
        <Button variant="ghost" onClick={() => setLocation("/dossier")} className="mb-4 -ml-4">
          <ArrowLeft className="w-4 h-4 mr-2" /> Terug naar dossier
        </Button>
        <Card className="border-amber-200 dark:border-amber-900/50 bg-amber-50/50 dark:bg-amber-900/10">
          <CardContent className="pt-6 flex flex-col items-center text-center py-10">
            <div className="w-16 h-16 bg-amber-100 dark:bg-amber-900 text-amber-600 dark:text-amber-400 rounded-full flex items-center justify-center mb-4">
              <BrainCircuit className="w-8 h-8" />
            </div>
            <h2 className="text-xl font-medium mb-2">Rapport nog niet beschikbaar</h2>
            <p className="text-muted-foreground mb-6 max-w-md">
              Het AI-rapport wordt gegenereerd zodra uw intake en benodigde documenten compleet en gevalideerd zijn.
            </p>
            <Button asChild><Link href="/dossier">Terug naar overzicht</Link></Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 md:p-10 max-w-4xl mx-auto space-y-8">
      <Button variant="ghost" onClick={() => setLocation("/dossier")} className="mb-4 -ml-4">
        <ArrowLeft className="w-4 h-4 mr-2" /> Terug naar dossier
      </Button>

      <div>
        <h1 className="text-3xl font-serif font-bold tracking-tight mb-2">AI Pre-validatie Rapport</h1>
        <p className="text-muted-foreground">Een eerlijke, constructieve analyse van uw financieringsaanvraag, net zoals een kredietspecialist deze ziet.</p>
      </div>

      <Card className="border-primary/20 bg-gradient-to-br from-primary/5 to-transparent">
        <CardContent className="pt-8 pb-8 px-8">
          <h2 className="text-2xl font-bold mb-4">{report.headline}</h2>
          <p className="text-lg leading-relaxed text-muted-foreground">{report.summary}</p>
          
          {report.viabilityScore !== null && report.viabilityScore !== undefined && (
            <div className="mt-6 flex items-center gap-4">
              <div className="text-sm font-medium">Haalbaarheidsscore:</div>
              <div className="flex-1 h-3 bg-secondary rounded-full overflow-hidden max-w-xs">
                <div 
                  className={`h-full ${report.viabilityScore > 70 ? 'bg-green-500' : report.viabilityScore > 40 ? 'bg-amber-500' : 'bg-red-500'}`} 
                  style={{ width: `${report.viabilityScore}%` }}
                ></div>
              </div>
              <div className="text-sm font-bold">{report.viabilityScore}/100</div>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="border-green-200 dark:border-green-900/50 shadow-sm">
          <CardHeader className="bg-green-50/50 dark:bg-green-900/10 pb-4">
            <CardTitle className="flex items-center gap-2 text-green-700 dark:text-green-400">
              <CheckCircle2 className="w-5 h-5" /> Sterke Punten
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            <ul className="space-y-3">
              {report.strongPoints.map((point, i) => (
                <li key={i} className="flex gap-3">
                  <div className="mt-1 w-1.5 h-1.5 rounded-full bg-green-500 flex-shrink-0" />
                  <span className="text-sm">{point}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card className="border-amber-200 dark:border-amber-900/50 shadow-sm">
          <CardHeader className="bg-amber-50/50 dark:bg-amber-900/10 pb-4">
            <CardTitle className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
              <AlertTriangle className="w-5 h-5" /> Aandachtspunten
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            <ul className="space-y-3">
              {report.weakPoints.map((point, i) => (
                <li key={i} className="flex gap-3">
                  <div className="mt-1 w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0" />
                  <span className="text-sm">{point}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      <Card className="shadow-sm">
        <CardHeader className="bg-secondary/30 pb-4 border-b">
          <CardTitle className="flex items-center gap-2">
            <Lightbulb className="w-5 h-5 text-primary" /> Wat financiers waarschijnlijk zullen vragen
          </CardTitle>
          <CardDescription>Bereid u voor op deze vragen van mogelijke geldverstrekkers</CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          <ul className="space-y-4">
            {report.likelyFinancierAsks.map((ask, i) => (
              <li key={i} className="flex gap-3 bg-muted/20 p-3 rounded-lg border border-border/50">
                <div className="font-bold text-primary shrink-0">Q:</div>
                <span className="text-sm italic text-muted-foreground">"{ask}"</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card className="border-primary shadow-md bg-primary/5">
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-primary" /> Actieplan
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-3 mb-6">
            {report.actionPoints.map((point, i) => (
              <li key={i} className="flex gap-3 items-start">
                <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/20 text-primary flex items-center justify-center text-xs font-bold mt-0.5">
                  {i + 1}
                </div>
                <span className="text-sm font-medium">{point}</span>
              </li>
            ))}
          </ul>
          
          <div className="flex justify-end pt-4 border-t border-primary/10">
            {report.canSubmit ? (
              <Button onClick={() => setLocation("/dossier")}>
                Dossier Indienen <ArrowLeft className="w-4 h-4 ml-2 rotate-180" />
              </Button>
            ) : (
              <p className="text-sm text-amber-600 dark:text-amber-400 font-medium">Voltooi eerst de actiepunten om uw dossier in te kunnen dienen.</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}