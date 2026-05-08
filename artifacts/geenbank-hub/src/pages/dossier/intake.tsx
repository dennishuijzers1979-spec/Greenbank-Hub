import { useState } from "react";
import { useGetMyDossier, getGetMyDossierQueryKey, useUpdateMyIntake } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { AlertCircle, ArrowLeft, Loader2, Save } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const intakeSchema = z.object({
  companyName: z.string().min(2, "Bedrijfsnaam is verplicht"),
  contactName: z.string().min(2, "Contactpersoon is verplicht"),
  kvkNumber: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  financingPurpose: z.string().min(10, "Beschrijf het doel van de financiering"),
  requestedAmount: z.coerce.number().min(1000, "Bedrag moet minimaal € 1.000 zijn").optional().nullable(),
  financingTypePreference: z.string().optional().nullable(),
  existingFinancing: z.string().optional().nullable(),
  annualRevenue: z.coerce.number().optional().nullable(),
  annualCost: z.coerce.number().optional().nullable(),
  annualProfit: z.coerce.number().optional().nullable(),
  companyDescription: z.string().min(20, "Geef een korte beschrijving van uw bedrijf").optional().nullable(),
});

type IntakeFormValues = z.infer<typeof intakeSchema>;

export default function IntakeWizard() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [step, setStep] = useState(1);

  const { data: dossier, isLoading } = useGetMyDossier({
    query: {
      queryKey: getGetMyDossierQueryKey()
    }
  });

  const updateMutation = useUpdateMyIntake();

  const form = useForm<IntakeFormValues>({
    resolver: zodResolver(intakeSchema),
    defaultValues: {
      companyName: dossier?.prospect?.companyName || "",
      contactName: dossier?.prospect?.contactName || "",
      kvkNumber: dossier?.prospect?.kvkNumber || "",
      phone: dossier?.prospect?.phone || "",
      financingPurpose: dossier?.financingPurpose || "",
      requestedAmount: dossier?.requestedAmount || undefined,
      financingTypePreference: dossier?.financingTypePreference || "",
      existingFinancing: dossier?.existingFinancing || "",
      annualRevenue: dossier?.annualRevenue || undefined,
      annualCost: dossier?.annualCost || undefined,
      annualProfit: dossier?.annualProfit || undefined,
      companyDescription: dossier?.companyDescription || "",
    },
    values: dossier ? {
      companyName: dossier.prospect?.companyName || "",
      contactName: dossier.prospect?.contactName || "",
      kvkNumber: dossier.prospect?.kvkNumber || "",
      phone: dossier.prospect?.phone || "",
      financingPurpose: dossier.financingPurpose || "",
      requestedAmount: dossier.requestedAmount || undefined,
      financingTypePreference: dossier.financingTypePreference || "",
      existingFinancing: dossier.existingFinancing || "",
      annualRevenue: dossier.annualRevenue || undefined,
      annualCost: dossier.annualCost || undefined,
      annualProfit: dossier.annualProfit || undefined,
      companyDescription: dossier.companyDescription || "",
    } : undefined
  });

  if (isLoading) {
    return <div className="p-8 max-w-3xl mx-auto animate-pulse"><div className="h-96 bg-muted rounded-xl"></div></div>;
  }

  const onSubmit = (data: IntakeFormValues) => {
    updateMutation.mutate({ data }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetMyDossierQueryKey() });
        toast({
          title: "Gegevens opgeslagen",
          description: "Uw intake gegevens zijn succesvol bijgewerkt.",
        });
        setLocation("/dossier");
      },
      onError: () => {
        toast({
          title: "Fout bij opslaan",
          description: "Er is een fout opgetreden. Probeer het opnieuw.",
          variant: "destructive"
        });
      }
    });
  };

  const nextStep = () => setStep(s => Math.min(s + 1, 3));
  const prevStep = () => setStep(s => Math.max(s - 1, 1));

  return (
    <div className="p-6 md:p-10 max-w-3xl mx-auto space-y-6">
      <Button variant="ghost" onClick={() => setLocation("/dossier")} className="mb-4 -ml-4">
        <ArrowLeft className="w-4 h-4 mr-2" /> Terug naar dossier
      </Button>
      
      <div>
        <h1 className="text-3xl font-serif font-bold tracking-tight mb-2">Intake & Bedrijfsgegevens</h1>
        <p className="text-muted-foreground">Vul de basisgegevens in voor uw financieringsaanvraag.</p>
      </div>

      <div className="flex gap-2 mb-8">
        {[1, 2, 3].map(i => (
          <div key={i} className={`h-2 flex-1 rounded-full transition-colors ${step >= i ? 'bg-primary' : 'bg-secondary'}`} />
        ))}
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <Card>
            <CardContent className="pt-6">
              {step === 1 && (
                <div className="space-y-4 animate-in fade-in slide-in-from-right-4">
                  <h2 className="text-xl font-medium mb-4">Stap 1: Bedrijf & Contact</h2>
                  <FormField control={form.control} name="companyName" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Bedrijfsnaam</FormLabel>
                      <FormControl><Input {...field} value={field.value || ''} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="contactName" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Contactpersoon</FormLabel>
                      <FormControl><Input {...field} value={field.value || ''} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <div className="grid grid-cols-2 gap-4">
                    <FormField control={form.control} name="kvkNumber" render={({ field }) => (
                      <FormItem>
                        <FormLabel>KVK Nummer</FormLabel>
                        <FormControl><Input {...field} value={field.value || ''} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="phone" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Telefoonnummer</FormLabel>
                        <FormControl><Input type="tel" {...field} value={field.value || ''} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                </div>
              )}

              {step === 2 && (
                <div className="space-y-4 animate-in fade-in slide-in-from-right-4">
                  <h2 className="text-xl font-medium mb-4">Stap 2: Financieringsbehoefte</h2>
                  <FormField control={form.control} name="financingPurpose" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Doel van de financiering</FormLabel>
                      <FormControl><Textarea rows={3} placeholder="Waarvoor heeft u de financiering nodig?" {...field} value={field.value || ''} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <div className="grid grid-cols-2 gap-4">
                    <FormField control={form.control} name="requestedAmount" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Aangevraagd bedrag (€)</FormLabel>
                        <FormControl><Input type="number" {...field} value={field.value || ''} onChange={e => field.onChange(e.target.value ? Number(e.target.value) : undefined)} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="financingTypePreference" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Gewenste vorm</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value || undefined}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Kies vorm" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="loan">Lening</SelectItem>
                            <SelectItem value="credit_facility">Rekening Courant</SelectItem>
                            <SelectItem value="lease">Lease</SelectItem>
                            <SelectItem value="factoring">Factoring</SelectItem>
                            <SelectItem value="other">Anders / Weet niet</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                  <FormField control={form.control} name="existingFinancing" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Bestaande financieringen</FormLabel>
                      <FormControl><Textarea rows={2} placeholder="Heeft u al lopende leningen? Zo ja, welke en voor hoeveel?" {...field} value={field.value || ''} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>
              )}

              {step === 3 && (
                <div className="space-y-4 animate-in fade-in slide-in-from-right-4">
                  <h2 className="text-xl font-medium mb-4">Stap 3: Financiële Situatie</h2>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <FormField control={form.control} name="annualRevenue" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Omzet afgelopen jaar</FormLabel>
                        <FormControl><Input type="number" {...field} value={field.value || ''} onChange={e => field.onChange(e.target.value ? Number(e.target.value) : undefined)} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="annualCost" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Kosten afgelopen jaar</FormLabel>
                        <FormControl><Input type="number" {...field} value={field.value || ''} onChange={e => field.onChange(e.target.value ? Number(e.target.value) : undefined)} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="annualProfit" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Winst afgelopen jaar</FormLabel>
                        <FormControl><Input type="number" {...field} value={field.value || ''} onChange={e => field.onChange(e.target.value ? Number(e.target.value) : undefined)} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                  <FormField control={form.control} name="companyDescription" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Bedrijfsomschrijving</FormLabel>
                      <FormControl><Textarea rows={4} placeholder="Wat doet uw bedrijf? Wie zijn uw klanten?" {...field} value={field.value || ''} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>
              )}
            </CardContent>
            <CardFooter className="flex justify-between border-t p-4 bg-muted/20">
              <Button type="button" variant="outline" onClick={prevStep} disabled={step === 1}>Vorige</Button>
              {step < 3 ? (
                <Button type="button" onClick={nextStep}>Volgende</Button>
              ) : (
                <Button type="submit" disabled={updateMutation.isPending}>
                  {updateMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                  Opslaan & Afronden
                </Button>
              )}
            </CardFooter>
          </Card>
        </form>
      </Form>
    </div>
  );
}