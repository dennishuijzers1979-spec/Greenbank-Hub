import { useState } from "react";
import { useListDossiers, getListDossiersQueryKey } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Search, Filter, Loader2, ArrowRight } from "lucide-react";
import { format } from "date-fns";
import { nl } from "date-fns/locale";

type Bucket = 'new' | 'in_review' | 'ready' | 'additional_info' | 'approved' | 'rejected' | 'all';

export default function LoanOfficerQueue() {
  const [bucket, setBucket] = useState<Bucket>('all');
  const [search, setSearch] = useState("");

  const { data: dossiers, isLoading } = useListDossiers(
    { bucket: bucket === 'all' ? undefined : bucket },
    { query: { queryKey: getListDossiersQueryKey({ bucket: bucket === 'all' ? undefined : bucket }) } }
  );

  const filteredDossiers = dossiers?.filter(d => 
    d.companyName.toLowerCase().includes(search.toLowerCase()) || 
    d.contactName.toLowerCase().includes(search.toLowerCase())
  ) || [];

  const getBucketBadge = (dBucket: string) => {
    switch (dBucket) {
      case 'new': return <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-400">Nieuw</Badge>;
      case 'in_review': return <Badge className="bg-purple-100 text-purple-800 hover:bg-purple-100 dark:bg-purple-900/30 dark:text-purple-400">In Review</Badge>;
      case 'additional_info': return <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100 dark:bg-amber-900/30 dark:text-amber-400">Wacht op Info</Badge>;
      case 'approved': return <Badge className="bg-green-100 text-green-800 hover:bg-green-100 dark:bg-green-900/30 dark:text-green-400">Goedgekeurd</Badge>;
      case 'rejected': return <Badge variant="destructive">Afgewezen</Badge>;
      default: return <Badge variant="outline">{dBucket}</Badge>;
    }
  };

  return (
    <div className="p-6 md:p-8 space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
        <div>
          <h1 className="text-3xl font-serif font-bold tracking-tight mb-1">Dossier Wachtrij</h1>
          <p className="text-muted-foreground">Beheer en beoordeel ingediende financieringsaanvragen.</p>
        </div>
      </div>

      <Card>
        <div className="p-4 border-b flex flex-col md:flex-row gap-4 items-center justify-between bg-muted/20">
          <Tabs value={bucket} onValueChange={(v) => setBucket(v as Bucket)} className="w-full md:w-auto">
            <TabsList className="bg-background border shadow-sm w-full md:w-auto flex flex-wrap h-auto p-1">
              <TabsTrigger value="all" className="flex-1 md:flex-none">Alle</TabsTrigger>
              <TabsTrigger value="new" className="flex-1 md:flex-none">Nieuw</TabsTrigger>
              <TabsTrigger value="in_review" className="flex-1 md:flex-none">In Review</TabsTrigger>
              <TabsTrigger value="additional_info" className="flex-1 md:flex-none">Wacht Info</TabsTrigger>
              <TabsTrigger value="approved" className="flex-1 md:flex-none">Goedgekeurd</TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="relative w-full md:w-64">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input 
              type="search" 
              placeholder="Zoek op bedrijf of naam..." 
              className="pl-9 h-9" 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        <div className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead>Bedrijf</TableHead>
                <TableHead>Bedrag</TableHead>
                <TableHead>AI Score</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden md:table-cell">Ingediend</TableHead>
                <TableHead className="text-right">Actie</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center">
                    <Loader2 className="w-6 h-6 animate-spin mx-auto text-primary" />
                  </TableCell>
                </TableRow>
              ) : filteredDossiers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">
                    Geen dossiers gevonden in deze categorie.
                  </TableCell>
                </TableRow>
              ) : (
                filteredDossiers.map((dossier) => (
                  <TableRow key={dossier.id} className="hover:bg-muted/10 cursor-pointer group">
                    <TableCell>
                      <div className="font-medium text-foreground">{dossier.companyName}</div>
                      <div className="text-xs text-muted-foreground">{dossier.contactName}</div>
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">
                        {dossier.requestedAmount ? new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(dossier.requestedAmount) : '-'}
                      </div>
                    </TableCell>
                    <TableCell>
                      {dossier.viabilityScore != null ? (
                        <div className="flex items-center gap-2">
                          <div className="w-8 text-sm font-bold">{dossier.viabilityScore}</div>
                          <div className="w-16 h-2 bg-secondary rounded-full overflow-hidden hidden sm:block">
                            <div 
                              className={`h-full ${(dossier.viabilityScore ?? 0) > 70 ? 'bg-green-500' : (dossier.viabilityScore ?? 0) > 40 ? 'bg-amber-500' : 'bg-red-500'}`}
                              style={{ width: `${dossier.viabilityScore ?? 0}%` }}
                            />
                          </div>
                        </div>
                      ) : '-'}
                    </TableCell>
                    <TableCell>{getBucketBadge(dossier.bucket)}</TableCell>
                    <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                      {dossier.submittedAt ? format(new Date(dossier.submittedAt), 'd MMM yyyy', { locale: nl }) : '-'}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" asChild className="opacity-0 group-hover:opacity-100 transition-opacity">
                        <Link href={`/dossiers/${dossier.id}`}>Beoordeel <ArrowRight className="ml-2 w-4 h-4" /></Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}