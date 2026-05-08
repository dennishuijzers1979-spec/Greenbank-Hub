import { useGetLoanOfficerDashboard, getGetLoanOfficerDashboardQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertCircle, FileText, CheckCircle2, Clock, AlertTriangle, TrendingUp, Users } from "lucide-react";
import { Link } from "wouter";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts';

export default function LoanOfficerDashboard() {
  const { data: dashboard, isLoading, isError } = useGetLoanOfficerDashboard({
    query: {
      queryKey: getGetLoanOfficerDashboardQueryKey()
    }
  });

  if (isLoading) {
    return (
      <div className="p-8 space-y-8 animate-pulse">
        <div className="h-8 w-48 bg-muted rounded"></div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[1,2,3,4].map(i => <div key={i} className="h-32 bg-muted rounded-xl"></div>)}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="h-80 bg-muted rounded-xl"></div>
          <div className="h-80 bg-muted rounded-xl"></div>
        </div>
      </div>
    );
  }

  if (isError || !dashboard) {
    return (
      <div className="p-8">
        <Card className="border-destructive">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive"><AlertCircle /> Fout bij laden</CardTitle>
            <CardDescription>Kan het dashboard niet laden. Probeer het later opnieuw.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8 space-y-8">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-serif font-bold tracking-tight mb-2">Command Center</h1>
          <p className="text-muted-foreground">Overzicht van alle lopende dossiers en pipeline status.</p>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-primary text-primary-foreground shadow-md hover-elevate">
          <CardHeader className="pb-2">
            <CardTitle className="text-primary-foreground/80 text-sm font-medium flex items-center gap-2">
              <FileText className="w-4 h-4" /> Nieuwe Aanvragen
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{dashboard.totals.newSubmitted}</div>
            <Link href="/dossiers?bucket=new" className="text-xs text-primary-foreground/80 hover:text-primary-foreground underline mt-2 inline-block">Bekijk lijst &rarr;</Link>
          </CardContent>
        </Card>

        <Card className="shadow-sm hover-elevate">
          <CardHeader className="pb-2">
            <CardTitle className="text-muted-foreground text-sm font-medium flex items-center gap-2">
              <Clock className="w-4 h-4" /> In Beoordeling
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{dashboard.totals.inReview}</div>
            <Link href="/dossiers?bucket=in_review" className="text-xs text-muted-foreground hover:text-foreground underline mt-2 inline-block">Bekijk lijst &rarr;</Link>
          </CardContent>
        </Card>

        <Card className="shadow-sm hover-elevate border-l-4 border-l-amber-500">
          <CardHeader className="pb-2">
            <CardTitle className="text-muted-foreground text-sm font-medium flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500" /> Wacht op Info
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{dashboard.totals.additionalInfoRequested}</div>
            <Link href="/dossiers?bucket=additional_info" className="text-xs text-muted-foreground hover:text-foreground underline mt-2 inline-block">Bekijk lijst &rarr;</Link>
          </CardContent>
        </Card>

        <Card className="shadow-sm hover-elevate border-l-4 border-l-green-500">
          <CardHeader className="pb-2">
            <CardTitle className="text-muted-foreground text-sm font-medium flex items-center gap-2">
              <Users className="w-4 h-4 text-green-500" /> Bij Partners
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{dashboard.totals.submittedToPartners}</div>
            <Link href="/dossiers?bucket=approved" className="text-xs text-muted-foreground hover:text-foreground underline mt-2 inline-block">Bekijk lijst &rarr;</Link>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Pipeline Chart */}
        <Card className="shadow-sm col-span-1">
          <CardHeader>
            <CardTitle className="text-lg">Pipeline Status</CardTitle>
            <CardDescription>Aantal dossiers per fase</CardDescription>
          </CardHeader>
          <CardContent className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dashboard.pipeline} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="hsl(var(--border))" />
                <XAxis type="number" />
                <YAxis dataKey="label" type="category" width={150} tick={{fontSize: 12}} />
                <Tooltip 
                  cursor={{fill: 'hsl(var(--muted))'}}
                  contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', borderRadius: '8px' }}
                />
                <Bar dataKey="count" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} barSize={24} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Quality Buckets */}
        <Card className="shadow-sm col-span-1">
          <CardHeader>
            <CardTitle className="text-lg">Kwaliteitsverdeling</CardTitle>
            <CardDescription>AI beoordeling van nieuwe dossiers</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-6 mt-4">
              {dashboard.qualityBuckets.map((bucket) => {
                const total = dashboard.qualityBuckets.reduce((sum, b) => sum + b.count, 0);
                const percentage = total > 0 ? Math.round((bucket.count / total) * 100) : 0;
                
                let colorClass = "bg-muted text-muted-foreground";
                if (bucket.label.includes("Sterk") || bucket.label.includes("Goed")) colorClass = "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400";
                if (bucket.label.includes("Gemiddeld")) colorClass = "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400";
                if (bucket.label.includes("Zwak") || bucket.label.includes("Risico")) colorClass = "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400";
                
                return (
                  <div key={bucket.label} className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${colorClass}`}>
                          {bucket.label}
                        </span>
                        <span className="text-muted-foreground text-xs">{bucket.description}</span>
                      </div>
                      <span className="font-medium">{bucket.count} ({percentage}%)</span>
                    </div>
                    <div className="h-2 w-full bg-secondary rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-primary rounded-full transition-all duration-500" 
                        style={{ width: `${percentage}%` }}
                      ></div>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>
      
      {/* Stuck Prospects */}
      {dashboard.stuckProspects.length > 0 && (
        <Card className="shadow-sm border-amber-200 dark:border-amber-900/50">
          <CardHeader className="bg-amber-50/50 dark:bg-amber-900/10 pb-4">
            <CardTitle className="text-lg flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
              Aandacht Vereist: Vastgelopen Dossiers
            </CardTitle>
            <CardDescription>Dossiers die langer dan 3 dagen in dezelfde fase zitten</CardDescription>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {dashboard.stuckProspects.map(prospect => (
                <Link key={prospect.dossierId} href={`/dossiers/${prospect.dossierId}`}>
                  <div className="p-4 border rounded-lg hover:border-amber-400 hover:bg-amber-50/30 transition-colors cursor-pointer group">
                    <div className="flex justify-between items-start mb-2">
                      <h4 className="font-medium group-hover:text-primary transition-colors">{prospect.companyName}</h4>
                      <span className="text-xs font-bold px-2 py-1 bg-amber-100 text-amber-800 rounded-full">{prospect.daysStuck} dgn</span>
                    </div>
                    <p className="text-sm text-muted-foreground">Fase: {prospect.stage}</p>
                  </div>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}