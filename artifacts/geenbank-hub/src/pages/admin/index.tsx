import { useGetAdminMetrics, getGetAdminMetricsQueryKey, useGetIntegrationsStatus, getGetIntegrationsStatusQueryKey, type IntegrationStatus } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Database, Link as LinkIcon, Activity, CheckCircle2, XCircle, Loader2, AlertTriangle } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

type PilotStatus = {
  app: { status: string; nodeEnv: string; timestamp: string; commit: string | null };
  database: {
    reachable: boolean;
    counts: { admin: number; loanOfficer: number; prospect: number; dossier: number; partner: number; prospectProfile: number };
  };
  env: {
    required: Array<{ name: string; present: boolean; description: string }>;
    optional: Array<{ name: string; present: boolean; description: string }>;
    missingRequired: string[];
  };
  integrations: {
    pipedrive: { name: string; live: boolean; message: string };
    sendgrid: { name: string; live: boolean; message: string };
    aiSkills: { name: string; live: boolean; message: string };
    objectStorage: { name: string; live: boolean; message: string };
    partnerSending: { name: string; live: boolean; message: string };
  };
  autoSeed: { enabled: boolean; reason: string };
  demoWarning: string | null;
};

export default function AdminDashboard() {
  const { data: metrics, isLoading: loadingMetrics } = useGetAdminMetrics({ query: { queryKey: getGetAdminMetricsQueryKey() } });
  const { data: integrations, isLoading: loadingIntegrations } = useGetIntegrationsStatus({ query: { queryKey: getGetIntegrationsStatusQueryKey() } });
  const { data: pilot, isLoading: loadingPilot } = useQuery<PilotStatus>({
    queryKey: ["admin", "pilot-status"],
    queryFn: async () => {
      const r = await fetch("/api/admin/pilot-status", { credentials: "include" });
      if (!r.ok) throw new Error(`pilot-status failed: ${r.status}`);
      return r.json() as Promise<PilotStatus>;
    },
  });

  if (loadingMetrics || loadingIntegrations || loadingPilot) {
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

      {pilot?.demoWarning && (
        <div className="border border-amber-300 bg-amber-50 text-amber-900 rounded-lg p-4 flex gap-3 items-start" data-testid="demo-warning">
          <AlertTriangle className="w-5 h-5 mt-0.5 flex-shrink-0 text-amber-600" />
          <div className="text-sm">
            <p className="font-medium">Let op — demo-gegevens actief</p>
            <p className="mt-1">{pilot.demoWarning}</p>
            <p className="mt-1 text-amber-800">
              De cleanup-scripts in <code className="font-mono text-xs">scripts/src/</code> kunnen
              ongewenste testfixtures of Aurora alsnog verwijderen vóór externe pilot-toegang.
              Voer <code className="font-mono text-xs">demo:reset</code> nooit uit op een productie-DB.
            </p>
          </div>
        </div>
      )}

      {pilot && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Database className="w-5 h-5" /> Pilot-status</CardTitle>
            <CardDescription>
              {pilot.app.nodeEnv} · DB {pilot.database.reachable ? "bereikbaar" : "onbereikbaar"} ·
              auto-seed: {pilot.autoSeed.reason}
              {pilot.app.commit ? ` · build ${pilot.app.commit.slice(0, 8)}` : ""}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-6 gap-3 text-sm">
              <Stat label="Admin" value={pilot.database.counts.admin} />
              <Stat label="Loan officers" value={pilot.database.counts.loanOfficer} />
              <Stat label="Prospects" value={pilot.database.counts.prospect} />
              <Stat label="Dossiers" value={pilot.database.counts.dossier} />
              <Stat label="Profielen" value={pilot.database.counts.prospectProfile} />
              <Stat label="Partners" value={pilot.database.counts.partner} />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-5 gap-2 text-xs">
              {Object.values(pilot.integrations).map((i) => (
                <div key={i.name} className="border rounded p-2">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{i.name}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] ${i.live ? "bg-green-100 text-green-800" : "bg-slate-100 text-slate-700"}`}>
                      {i.live ? "live" : "mock"}
                    </span>
                  </div>
                  <p className="text-muted-foreground mt-1">{i.message}</p>
                </div>
              ))}
            </div>
            {pilot.env.missingRequired.length > 0 && (
              <div className="text-xs text-red-700 border border-red-200 bg-red-50 rounded p-2">
                Ontbrekende verplichte omgevingsvariabelen: {pilot.env.missingRequired.join(", ")}
              </div>
            )}
          </CardContent>
        </Card>
      )}

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
                    {status.runtime.perSkill.map((s) => {
                      const isLive = !s.usedMockMode;
                      const isFallback = s.usedMockMode && !!s.fallbackReason;
                      const label = isLive
                        ? `Live ${s.provider === 'openai' ? 'OpenAI' : s.provider}${s.model ? ` · ${s.model}` : ''}`
                        : isFallback
                          ? 'Fallback naar mock'
                          : 'Deterministisch / mock';
                      const cls = isLive
                        ? 'bg-green-100 text-green-800'
                        : isFallback
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-slate-100 text-slate-700';
                      return (
                        <div key={s.module} className="flex items-center justify-between text-xs gap-2">
                          <span className="font-mono truncate">{s.module}</span>
                          <span className={`px-1.5 py-0.5 rounded text-[10px] ${cls}`}>{label}</span>
                        </div>
                      );
                    })}
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

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="border rounded-lg p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold">{value}</p>
    </div>
  );
}