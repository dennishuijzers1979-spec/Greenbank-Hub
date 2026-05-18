import { useState, useRef } from "react";
import { 
  useListMyDocuments, getListMyDocumentsQueryKey, 
  useUploadMyDocument, useDeleteMyDocument,
  useGetMyDossier, getGetMyDossierQueryKey,
  useListMyConditions, getListMyConditionsQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ArrowLeft, FileType, FileUp, Loader2, Trash2, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

const DOCUMENT_TYPE_OPTIONS: { value: string; label: string; required: boolean }[] = [
  { value: "annual_accounts", label: "Jaarrekening", required: true },
  { value: "bank_statements", label: "Bankafschriften", required: true },
  { value: "kvk_extract", label: "KVK-uittreksel", required: true },
  { value: "id_document", label: "Identiteitsbewijs", required: true },
  { value: "forecast", label: "Prognose / cashflow", required: false },
  { value: "business_plan", label: "Ondernemingsplan", required: false },
  { value: "other", label: "Overig", required: false },
];

const MAX_BYTES = 20 * 1024 * 1024;

const labelForType = (type: string) =>
  DOCUMENT_TYPE_OPTIONS.find((o) => o.value === type)?.label ?? type;

export default function DocumentenUpload() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [isUploading, setIsUploading] = useState(false);
  const [selectedType, setSelectedType] = useState<string>("annual_accounts");

  useGetMyDossier({ query: { queryKey: getGetMyDossierQueryKey() } });
  const { data: documents, isLoading } = useListMyDocuments({ query: { queryKey: getListMyDocumentsQueryKey() } });
  const { data: conditions } = useListMyConditions({ query: { queryKey: getListMyConditionsQueryKey() } });

  const uploadMutation = useUploadMyDocument();
  const deleteMutation = useDeleteMyDocument();

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > MAX_BYTES) {
      toast({
        title: "Bestand te groot",
        description: "Het bestand mag maximaal 20 MB groot zijn.",
        variant: "destructive"
      });
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    setIsUploading(true);
    const reader = new FileReader();
    reader.onloadend = async () => {
      try {
        const base64 = reader.result?.toString().split(',')[1];
        if (!base64) throw new Error("Kon bestand niet lezen");

        await uploadMutation.mutateAsync({
          data: {
            filename: file.name,
            mimeType: file.type || "application/octet-stream",
            sizeBytes: file.size,
            documentType: selectedType,
            contentBase64: base64
          }
        });

        queryClient.invalidateQueries({ queryKey: getListMyDocumentsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetMyDossierQueryKey() });
        
        toast({ title: "Bestand geüpload", description: `${file.name} is succesvol geüpload als ${labelForType(selectedType)}.` });
      } catch (err) {
        const message =
          err && typeof err === "object" && "data" in err && err.data && typeof (err as { data: unknown }).data === "object"
            ? ((err as { data: { error?: string } }).data.error ?? "Probeer het opnieuw.")
            : "Probeer het opnieuw.";
        toast({ title: "Upload mislukt", description: message, variant: "destructive" });
      } finally {
        setIsUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    };
    reader.readAsDataURL(file);
  };

  const handleDelete = (docId: string) => {
    deleteMutation.mutate({ documentId: docId }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListMyDocumentsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetMyDossierQueryKey() });
        toast({ title: "Bestand verwijderd" });
      }
    });
  };

  const getStatusColor = (status: string) => {
    if (status === 'valid') return 'text-green-600 bg-green-50 dark:bg-green-900/20';
    if (status === 'invalid') return 'text-red-600 bg-red-50 dark:bg-red-900/20';
    return 'text-amber-600 bg-amber-50 dark:bg-amber-900/20';
  };

  // Belt-and-suspenders prospect privacy: only ever show items the
  // loan officer has EXPLICITLY turned into a prospect-facing request
  // (requestedAt non-null). The server already filters internal-only
  // rows, but we double-filter here so even a buggy/legacy server
  // response can never leak internal credit wording (LTV, covenants,
  // solvency, reviewer notes, raw AI text) into the red
  // "Aandachtspunten" box.
  const blockingConditions = (conditions ?? []).filter(
    (c) => c.type === 'blocking' && c.status === 'open' && !!c.requestedAt,
  );

  const requiredTypes = DOCUMENT_TYPE_OPTIONS.filter(o => o.required);
  const presentTypes = new Set(
    (documents ?? [])
      .filter(d => d.validationStatus === 'valid')
      .map(d => d.documentType)
  );
  const missingRequired = requiredTypes.filter(t => !presentTypes.has(t.value));

  return (
    <div className="p-6 md:p-10 max-w-4xl mx-auto space-y-6">
      <Button variant="ghost" onClick={() => setLocation("/dossier")} className="mb-4 -ml-4">
        <ArrowLeft className="w-4 h-4 mr-2" /> Terug naar dossier
      </Button>
      
      <div>
        <h1 className="text-3xl font-serif font-bold tracking-tight mb-2">Documenten</h1>
        <p className="text-muted-foreground">Upload uw kerndocumenten. AI valideert deze direct.</p>
      </div>

      {missingRequired.length > 0 && (
        <Alert>
          <AlertTriangle className="w-5 h-5" />
          <AlertTitle>Nog te uploaden</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-5 mt-2 space-y-1">
              {missingRequired.map(t => <li key={t.value}>{t.label}</li>)}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {blockingConditions.length > 0 && (
        <Alert variant="destructive" className="bg-destructive/10 text-destructive border-destructive/20">
          <AlertTriangle className="w-5 h-5" />
          <AlertTitle>Aandachtspunten</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-5 mt-2 space-y-1">
              {blockingConditions.map(cond => (
                <li key={cond.id}>
                  {cond.prospectTitle ?? cond.title}
                  {(cond.prospectExplanation ?? cond.description)
                    ? `: ${cond.prospectExplanation ?? cond.description}`
                    : ""}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Nieuw document uploaden</CardTitle>
          <CardDescription>Ondersteund: PDF, Excel, CSV, Word, PNG, JPG (max 20 MB)</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label htmlFor="docType" className="block text-sm font-medium mb-2">
              Documenttype
            </label>
            <select
              id="docType"
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value)}
              className="w-full border rounded-md px-3 py-2 bg-background"
              disabled={isUploading}
            >
              {DOCUMENT_TYPE_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}{opt.required ? " (verplicht)" : ""}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground mt-1">
              Kies het type dat past bij dit bestand — wordt gebruikt door de AI-analyse.
            </p>
          </div>
          <div 
            className="border-2 border-dashed border-muted-foreground/25 rounded-xl p-10 flex flex-col items-center justify-center bg-muted/10 hover:bg-muted/30 transition-colors cursor-pointer"
            onClick={() => !isUploading && fileInputRef.current?.click()}
          >
            {isUploading ? (
              <div className="flex flex-col items-center text-muted-foreground">
                <Loader2 className="w-10 h-10 animate-spin mb-4 text-primary" />
                <p>Bezig met uploaden en valideren...</p>
              </div>
            ) : (
              <div className="flex flex-col items-center text-muted-foreground">
                <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center text-primary mb-4">
                  <FileUp className="w-8 h-8" />
                </div>
                <p className="text-lg font-medium mb-1 text-foreground">Klik om bestand te selecteren</p>
                <p className="text-sm">Type: <strong>{labelForType(selectedType)}</strong></p>
              </div>
            )}
            <input 
              type="file" 
              ref={fileInputRef} 
              className="hidden" 
              onChange={handleFileChange}
              accept=".pdf,.xlsx,.xls,.csv,.docx,.doc,.png,.jpg,.jpeg"
            />
          </div>
        </CardContent>
      </Card>

      <div className="space-y-4">
        <h2 className="text-xl font-medium">Geüploade Documenten</h2>
        
        {isLoading ? (
          <div className="space-y-3"><div className="h-20 bg-muted rounded-xl animate-pulse" /></div>
        ) : documents && documents.length > 0 ? (
          <div className="space-y-3">
            {documents.map((doc) => (
              <Card key={doc.id} className="overflow-hidden">
                <div className="flex items-center p-4">
                  <div className="w-10 h-10 rounded-lg bg-secondary flex items-center justify-center mr-4 text-muted-foreground">
                    <FileType className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium truncate">{doc.filename}</p>
                      <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider ${getStatusColor(doc.validationStatus)}`}>
                        {doc.validationStatus === 'valid' ? 'Goedgekeurd' : doc.validationStatus === 'invalid' ? 'Ongeldig' : 'Valideren...'}
                      </span>
                    </div>
                    <div className="flex items-center text-xs text-muted-foreground mt-1 gap-3">
                      <span>{(doc.sizeBytes / 1024 / 1024).toFixed(2)} MB</span>
                      <span>{format(new Date(doc.createdAt), 'dd MMM yyyy HH:mm')}</span>
                      <span>{labelForType(doc.documentType)}</span>
                    </div>
                    {doc.validationNotes && doc.validationStatus !== 'valid' && (
                      <p className="text-xs text-destructive mt-1">{doc.validationNotes}</p>
                    )}
                  </div>
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => handleDelete(doc.id)}
                    disabled={deleteMutation.isPending}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <div className="text-center py-10 bg-muted/20 rounded-xl border border-dashed">
            <p className="text-muted-foreground">Nog geen documenten geüpload.</p>
          </div>
        )}
      </div>
    </div>
  );
}
