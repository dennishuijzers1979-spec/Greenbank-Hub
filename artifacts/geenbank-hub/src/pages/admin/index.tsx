import { useGetAdminMetrics, getGetAdminMetricsQueryKey, useGetIntegrationsStatus, getGetIntegrationsStatusQueryKey, type IntegrationStatus } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Database, Link as LinkIcon, Activity, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

export default function AdminDashboard() {
  const { data: metrics, isLoading: loadingMetrics } = useGetAdminMetrics({ query: { queryKey: getGetAdminMetricsQueryKey() } });
  const { data: integrations, isLoading: loadingIntegrations } = useGetIntegrationsStatus({ query: { queryKey: getGetIntegrationsStatusQueryKey() } });

  if (loadingMetrics || loadingIntegrations) {
    return <div className="p-8 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }

  return (
    <div className="p-6 md:p-8 space-y-6 max-w-6xl mx-auto">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-serif font-bold tracking-tight mb-1">Systeem & Metrics</h1>
          <p className="text-muted-foreground">Systeemstatus en overkoepelende prestaties.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-primary/10 text-primary rounded-lg"><Database className="w-6 h-6" /></div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Totaal Dossiers</p>
                <p className="text-2xl font-bold">{metrics?.totalDossiers || 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 rounded-lg"><CheckCircle2 className="w-6 h-6" /></div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Verstuurd naar Partners</p>
                <p className="text-2xl font-bold">{metrics?.totalSubmittedToPartners || 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 rounded-lg"><Activity className="w-6 h-6" /></div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Gemiddelde AI Score</p>
                <p className="text-2xl font-bold">{metrics?.averageViabilityScore ? Math.round(metrics.averageViabilityScore) : '-'}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Partner Prestaties</CardTitle>
            <CardDescription>Aantal inzendingen vs geaccepteerd per partner</CardDescription>
          </CardHeader>
          <CardContent className="h-80">
            {metrics?.partnerPerformance && metrics.partnerPerformance.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={metrics.partnerPerformance} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="partnerName" tick={{fontSize: 12}} />
                  <YAxis />
                  <Tooltip 
                    contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))' }}
                  />
                  <Bar dataKey="submissions" name="Ingediend" fill="hsl(var(--muted))" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="accepted" name="Geaccepteerd" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-muted-foreground">Geen partner data beschikbaar</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><LinkIcon className="w-5 h-5" /> Integraties</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {integrations && (Object.entries(integrations) as Array<[string, IntegrationStatus]>).map(([key, status]) => (
              <div key={key} className="p-3 border rounded-lg">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium capitalize">{status.name}</p>
                    <p className="text-xs text-muted-foreground">{status.message}</p>
                  </div>
                  {status.live ? (
                    <CheckCircle2 className="w-5 h-5 text-green-500" />
                  ) : (
                    <XCircle className="w-5 h-5 text-red-500" />
                  )}
                </div>
                {status.runtime && status.runtime.perSkill && status.runtime.perSkill.length > 0 && (
                  <div className="mt-3 border-t pt-2 space-y-1">
                    <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Skills ({status.runtime.liveSkills} live / {status.runtime.totalSkills} totaal)</p>
                    {status.runtime.perSkill.map((s) => (
                      <div key={s.module} className="flex items-center justify-between text-xs gap-2">
                        <span className="font-mono truncate">{s.module}</span>
                        <span className={`px-1.5 py-0.5 rounded text-[10px] ${s.usedMockMode ? 'bg-amber-100 text-amber-800' : 'bg-green-100 text-green-800'}`}>
                          {s.provider}{s.model ? ` · ${s.model}` : ''}
                        </span>
                      </div>
                    ))}
                    {status.runtime.perSkill.some((s) => s.fallbackReason) && (
                      <p className="text-[11px] text-amber-700 mt-1">
                        Een of meer skills vielen terug op mock — controleer ontbrekende variabelen.
                      </p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}