import { useListRecentActivity, getListRecentActivityQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Activity as ActivityIcon, User, Bot, Building2 } from "lucide-react";
import { format } from "date-fns";
import { nl } from "date-fns/locale";
import { Link } from "wouter";

export default function Activiteit() {
  const { data: activities, isLoading } = useListRecentActivity(
    { limit: 50 },
    { query: { queryKey: getListRecentActivityQueryKey({ limit: 50 }) } }
  );

  const getActorIcon = (actorType: string) => {
    switch(actorType) {
      case 'prospect': return <User className="w-4 h-4 text-blue-500" />;
      case 'loan_officer': return <Building2 className="w-4 h-4 text-primary" />;
      case 'system': return <Bot className="w-4 h-4 text-purple-500" />;
      default: return <User className="w-4 h-4 text-muted-foreground" />;
    }
  };

  return (
    <div className="p-6 md:p-8 space-y-6 max-w-4xl mx-auto">
      <div>
        <h1 className="text-3xl font-serif font-bold tracking-tight mb-1">Activiteitenlog</h1>
        <p className="text-muted-foreground">Recente gebeurtenissen in het platform.</p>
      </div>

      <Card>
        <CardHeader className="border-b bg-muted/20 pb-4">
          <CardTitle className="text-lg flex items-center gap-2">
            <ActivityIcon className="w-5 h-5" /> Tijdlijn
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-12 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
          ) : activities && activities.length > 0 ? (
            <div className="divide-y">
              {activities.map((activity) => (
                <div key={activity.id} className="p-4 hover:bg-muted/10 transition-colors flex gap-4">
                  <div className="mt-1 flex-shrink-0 w-8 h-8 rounded-full bg-secondary flex items-center justify-center">
                    {getActorIcon(activity.actorType)}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium">
                      {activity.description}
                    </p>
                    <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                      <span className="capitalize font-medium">{activity.actorType.replace('_', ' ')}</span>
                      <span>•</span>
                      <span>{format(new Date(activity.createdAt), "d MMM HH:mm", { locale: nl })}</span>
                      {activity.dossierId && (
                        <>
                          <span>•</span>
                          <Link href={`/dossiers/${activity.dossierId}`} className="text-primary hover:underline">
                            Bekijk dossier
                          </Link>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-12 text-center text-muted-foreground">Geen activiteiten gevonden.</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}