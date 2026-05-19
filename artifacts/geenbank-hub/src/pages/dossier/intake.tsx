import { useEffect, useMemo, useRef, useState } from "react";
import {
  useGetMyDossier,
  getGetMyDossierQueryKey,
  useUpdateMyIntake,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Circle,
  Info,
  Loader2,
  Save,
  Sparkles,
  Upload,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { isIntakeRequiredComplete } from "@/lib/dossier-utils";

/**
 * Intake schema — kept permissive at save-time. Only the *required-for-
 * complete* fields are validated as required; everything else is
 * optional so the prospect can save partial progress at any moment.
 *
 * Hard validation rules (rejects save if violated):
 *   companyName ≥ 2  contactName ≥ 2  requestedAmount ≥ 1000 when set
 *   financingPurpose ≥ 10 when set     companyDescription ≥ 20 when set
 */
const intakeSchema = z.object({
  companyName: z.string().min(2, "Bedrijfsnaam is verplicht").or(z.literal("")),
  contactName: z.string().min(2, "Contactpersoon is verplicht").or(z.literal("")),
  kvkNumber: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  financingPurpose: z
    .string()
    .min(10, "Geef minimaal een paar zinnen — financiers willen je doel begrijpen")
    .optional()
    .or(z.literal("")),
  requestedAmount: z.coerce
    .number()
    .min(1000, "Minimaal € 1.000")
    .optional()
    .nullable(),
  financingTypePreference: z.string().optional().nullable(),
  existingFinancing: z.string().optional().nullable(),
  annualRevenue: z.coerce.number().optional().nullable(),
  annualCost: z.coerce.number().optional().nullable(),
  annualProfit: z.coerce.number().optional().nullable(),
  companyDescription: z
    .string()
    .min(20, "Vertel kort wat je bedrijf doet (minimaal 20 tekens)")
    .optional()
    .or(z.literal("")),
});

type IntakeFormValues = z.infer<typeof intakeSchema>;

// ---------------------------------------------------------------------------
// Section model
// ---------------------------------------------------------------------------

type SectionId =
  | "company"
  | "contact"
  | "need"
  | "purpose"
  | "situation"
  | "numbers"
  | "existing";

interface SectionDef {
  id: SectionId;
  step: number;
  title: string;
  intro: string;
  why: string;
  fields: (keyof IntakeFormValues)[];
  required: boolean;
}

const SECTIONS: SectionDef[] = [
  {
    id: "company",
    step: 1,
    title: "Bedrijf",
    intro: "Wie ben je formeel? Dit koppelen we aan KVK-data.",
    why: "Een correct geregistreerd bedrijf is voor financiers de basis. Zonder KVK-koppeling kunnen ze je dossier niet beoordelen.",
    fields: ["companyName", "kvkNumber"],
    required: true,
  },
  {
    id: "contact",
    step: 2,
    title: "Contact",
    intro: "Hoe bereiken we je als er iets mist of als een financier wil schakelen?",
    why: "Snel kunnen schakelen versnelt je beoordeling. Bereikbare contactpersonen maken het verschil tussen wel of niet doorgaan.",
    fields: ["contactName", "phone"],
    required: true,
  },
  {
    id: "need",
    step: 3,
    title: "Financieringsbehoefte",
    intro: "Hoeveel zoek je, en in welke vorm denk je?",
    why: "Hoe scherper het bedrag en de gewenste vorm, hoe gerichter we partners kunnen aanspreken. Onzeker? Kies 'Anders' — we begeleiden je.",
    fields: ["requestedAmount", "financingTypePreference"],
    required: true,
  },
  {
    id: "purpose",
    step: 4,
    title: "Doel van de financiering",
    intro: "Waarvoor ga je het geld inzetten?",
    why: "Concrete bestedingsdoelen ('twee nieuwe ovens', 'voorraad voor Q4') zijn vele malen sterker dan algemene termen als 'werkkapitaal'. Financiers kopen het verhaal achter het bedrag, niet alleen het bedrag.",
    fields: ["financingPurpose"],
    required: true,
  },
  {
    id: "situation",
    step: 5,
    title: "Huidige situatie & verhaal",
    intro: "Wat doet je bedrijf vandaag, voor wie, en waarom is dit het juiste moment?",
    why: "Dit is het stuk waar financiers het verschil leren zien tussen jou en de tien aanvragen die ze die week ook lezen. Schrijf zoals je het aan een serieuze klant zou vertellen.",
    fields: ["companyDescription"],
    required: true,
  },
  {
    id: "numbers",
    step: 6,
    title: "Cijfers",
    intro: "Hoofdlijnen van het afgelopen jaar — geen jaarrekening, alleen drie getallen.",
    why: "Cijfers maken je verhaal hard. Zelfs ruwe schattingen helpen: financiers zien direct of de financiering past bij je omvang en marge.",
    fields: ["annualRevenue", "annualCost", "annualProfit"],
    required: false,
  },
  {
    id: "existing",
    step: 7,
    title: "Bestaande financieringen",
    intro: "Welke financieringen lopen er al? Lease, krediet, microkrediet — alles telt.",
    why: "Transparantie over bestaande verplichtingen voorkomt verrassingen later in het traject. Een open dossier wint vrijwel altijd van een dossier met gaten.",
    fields: ["existingFinancing"],
    required: false,
  },
];

function sectionIsComplete(
  s: SectionDef,
  v: IntakeFormValues,
): boolean {
  for (const f of s.fields) {
    const val = v[f];
    if (val === null || val === undefined || val === "") return false;
    if (typeof val === "string" && val.trim() === "") return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function IntakeWizard() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeSectionId, setActiveSectionId] = useState<SectionId>("company");
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);

  const { data: dossier, isLoading } = useGetMyDossier({
    query: { queryKey: getGetMyDossierQueryKey() },
  });

  const updateMutation = useUpdateMyIntake();

  const form = useForm<IntakeFormValues>({
    resolver: zodResolver(intakeSchema),
    defaultValues: {
      companyName: "",
      contactName: "",
      kvkNumber: "",
      phone: "",
      financingPurpose: "",
      requestedAmount: undefined,
      financingTypePreference: "",
      existingFinancing: "",
      annualRevenue: undefined,
      annualCost: undefined,
      annualProfit: undefined,
      companyDescription: "",
    },
  });

  // One-shot hydrate from the server dossier on first load (and any
  // time the dossier identity changes — e.g. after impersonation).
  // We intentionally do NOT use react-hook-form's reactive `values`
  // prop here, because the dossier query may refetch after our own
  // PUT and would clobber in-flight user edits in other sections.
  const hydratedForDossierId = useRef<string | null>(null);
  useEffect(() => {
    if (!dossier) return;
    if (hydratedForDossierId.current === dossier.id) return;
    form.reset({
      companyName: dossier.prospect?.companyName || "",
      contactName: dossier.prospect?.contactName || "",
      kvkNumber: dossier.prospect?.kvkNumber || "",
      phone: dossier.prospect?.phone || "",
      financingPurpose: dossier.financingPurpose || "",
      requestedAmount: dossier.requestedAmount ?? undefined,
      financingTypePreference: dossier.financingTypePreference || "",
      existingFinancing: dossier.existingFinancing || "",
      annualRevenue: dossier.annualRevenue ?? undefined,
      annualCost: dossier.annualCost ?? undefined,
      annualProfit: dossier.annualProfit ?? undefined,
      companyDescription: dossier.companyDescription || "",
    });
    hydratedForDossierId.current = dossier.id;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dossier?.id]);

  const watched = form.watch();
  const sectionStatus = useMemo(
    () =>
      Object.fromEntries(
        SECTIONS.map((s) => [s.id, sectionIsComplete(s, watched)]),
      ) as Record<SectionId, boolean>,
    [watched],
  );
  const completedCount = SECTIONS.filter((s) => sectionStatus[s.id]).length;
  const progressPct = Math.round((completedCount / SECTIONS.length) * 100);
  const allRequiredDone = isIntakeRequiredComplete({
    companyName: watched.companyName,
    contactName: watched.contactName,
    phone: watched.phone,
    // we don't know the prospect's email here, but the API/dossier model
    // always carries a user account email, so phone alone is enough at
    // the UI level. The hub uses the full check.
    email: "from-account",
    financingPurpose: watched.financingPurpose,
    requestedAmount: watched.requestedAmount ?? null,
    companyDescription: watched.companyDescription,
  });

  if (isLoading) {
    return (
      <div className="p-8 max-w-5xl mx-auto animate-pulse">
        <div className="h-96 bg-muted rounded-xl"></div>
      </div>
    );
  }

  // Save the whole form. Backend accepts partial updates and ignores
  // empty optional fields → "Opslaan" is also "Opslaan & doorgaan".
  const saveCurrent = (opts: { advance: boolean; finalize?: boolean }) => {
    form.handleSubmit(
      (data) => {
        // Normalize empty strings to null so optional fields don't end
        // up persisted as the literal string "".
        const payload = {
          companyName: data.companyName?.trim() || null,
          contactName: data.contactName?.trim() || null,
          kvkNumber: data.kvkNumber?.trim() || null,
          phone: data.phone?.trim() || null,
          financingPurpose: data.financingPurpose?.trim() || null,
          requestedAmount:
            typeof data.requestedAmount === "number" ? data.requestedAmount : null,
          financingTypePreference: data.financingTypePreference || null,
          existingFinancing: data.existingFinancing?.trim() || null,
          annualRevenue:
            typeof data.annualRevenue === "number" ? data.annualRevenue : null,
          annualCost:
            typeof data.annualCost === "number" ? data.annualCost : null,
          annualProfit:
            typeof data.annualProfit === "number" ? data.annualProfit : null,
          companyDescription: data.companyDescription?.trim() || null,
        };
        updateMutation.mutate(
          { data: payload },
          {
            onSuccess: () => {
              queryClient.invalidateQueries({ queryKey: getGetMyDossierQueryKey() });
              setLastSavedAt(new Date());
              toast({
                title: "Opgeslagen",
                description: opts.finalize
                  ? "Je intake is compleet. Tijd om bewijs onder je aanvraag te leggen."
                  : "Je voortgang is veilig opgeslagen.",
              });
              if (opts.finalize) {
                setLocation("/dossier");
                return;
              }
              if (opts.advance) {
                const idx = SECTIONS.findIndex((s) => s.id === activeSectionId);
                const next = SECTIONS[idx + 1];
                if (next) setActiveSectionId(next.id);
              }
            },
            onError: () => {
              toast({
                title: "Opslaan mislukt",
                description: "Controleer je verbinding en probeer het opnieuw.",
                variant: "destructive",
              });
            },
          },
        );
      },
      () => {
        toast({
          title: "Controleer de invoer",
          description: "Een of meer velden in deze sectie hebben aandacht nodig.",
          variant: "destructive",
        });
      },
    )();
  };

  const activeSection = SECTIONS.find((s) => s.id === activeSectionId) ?? SECTIONS[0];
  const activeIdx = SECTIONS.findIndex((s) => s.id === activeSectionId);
  const isLastSection = activeIdx === SECTIONS.length - 1;

  return (
    <div className="p-4 sm:p-6 md:p-10 max-w-6xl mx-auto space-y-6">
      <Button
        variant="ghost"
        onClick={() => setLocation("/dossier")}
        className="-ml-3"
        data-testid="button-back-to-hub"
      >
        <ArrowLeft className="w-4 h-4 mr-2" /> Terug naar mijn dossier
      </Button>

      <div className="space-y-2">
        <h1 className="text-3xl md:text-4xl font-serif font-bold tracking-tight">
          Bouw je financieringsdossier
        </h1>
        <p className="text-muted-foreground max-w-2xl">
          Zeven korte secties. Tussendoor opslaan kan altijd — niets gaat
          verloren. Hoe scherper je antwoorden, hoe sterker we je verhaal
          aan financiers kunnen brengen.
        </p>
      </div>

      {/* Top progress bar */}
      <Card className="border-primary/20">
        <CardContent className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex-1 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">
                Voortgang: {completedCount} van {SECTIONS.length} secties compleet
              </span>
              <span className="text-muted-foreground" data-testid="text-progress-pct">
                {progressPct}%
              </span>
            </div>
            <div className="h-2 bg-secondary rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
          {lastSavedAt && (
            <div
              className="flex items-center gap-2 text-sm text-green-700 dark:text-green-400"
              data-testid="text-last-saved"
            >
              <CheckCircle2 className="w-4 h-4" />
              Opgeslagen
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
        {/* Section navigator */}
        <aside className="space-y-1 lg:sticky lg:top-4 lg:self-start" data-testid="section-nav">
          {SECTIONS.map((s) => {
            const done = sectionStatus[s.id];
            const active = s.id === activeSectionId;
            return (
              <button
                key={s.id}
                type="button"
                data-testid={`nav-section-${s.id}`}
                data-active={active ? "true" : "false"}
                data-complete={done ? "true" : "false"}
                onClick={() => setActiveSectionId(s.id)}
                className={`w-full text-left px-3 py-3 rounded-lg flex items-start gap-3 transition-colors border ${
                  active
                    ? "bg-primary/10 border-primary/30"
                    : "border-transparent hover:bg-secondary/60"
                }`}
              >
                <div className="mt-0.5">
                  {done ? (
                    <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-500" />
                  ) : (
                    <Circle className="w-5 h-5 text-muted-foreground" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-muted-foreground">
                    Sectie {s.step}
                    {s.required ? "" : " · optioneel"}
                  </div>
                  <div
                    className={`text-sm font-medium leading-tight ${
                      active ? "text-primary" : ""
                    }`}
                  >
                    {s.title}
                  </div>
                </div>
              </button>
            );
          })}
        </aside>

        {/* Active section */}
        <Form {...form}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              saveCurrent({ advance: true });
            }}
            className="space-y-4"
          >
            <Card data-testid={`section-${activeSection.id}`}>
              <CardHeader>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">
                      Sectie {activeSection.step} van {SECTIONS.length}
                    </div>
                    <CardTitle className="text-2xl font-serif">
                      {activeSection.title}
                    </CardTitle>
                  </div>
                  {sectionStatus[activeSection.id] && (
                    <div
                      className="text-xs font-medium text-green-700 dark:text-green-400 flex items-center gap-1.5 bg-green-50 dark:bg-green-950/30 px-2.5 py-1 rounded-full"
                      data-testid={`section-status-${activeSection.id}`}
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" /> compleet
                    </div>
                  )}
                </div>
                <CardDescription className="pt-1">{activeSection.intro}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="rounded-lg border border-primary/15 bg-primary/[0.04] p-3 flex gap-2.5 text-sm">
                  <Info className="w-4 h-4 mt-0.5 text-primary shrink-0" />
                  <div>
                    <span className="font-medium">Waarom dit belangrijk is. </span>
                    <span className="text-muted-foreground">{activeSection.why}</span>
                  </div>
                </div>

                {activeSection.id === "company" && (
                  <div className="grid sm:grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="companyName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Bedrijfsnaam</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              value={field.value || ""}
                              data-testid="input-company-name"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="kvkNumber"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>KVK-nummer</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              value={field.value || ""}
                              placeholder="bijv. 12345678"
                              data-testid="input-kvk-number"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                )}

                {activeSection.id === "contact" && (
                  <div className="grid sm:grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="contactName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Contactpersoon</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              value={field.value || ""}
                              data-testid="input-contact-name"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="phone"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Telefoonnummer</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              type="tel"
                              value={field.value || ""}
                              placeholder="bijv. 06 12 34 56 78"
                              data-testid="input-phone"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                )}

                {activeSection.id === "need" && (
                  <div className="grid sm:grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="requestedAmount"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Aangevraagd bedrag (€)</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              {...field}
                              value={field.value ?? ""}
                              onChange={(e) =>
                                field.onChange(
                                  e.target.value ? Number(e.target.value) : undefined,
                                )
                              }
                              data-testid="input-requested-amount"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="financingTypePreference"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Gewenste vorm</FormLabel>
                          <Select
                            onValueChange={field.onChange}
                            value={field.value || undefined}
                          >
                            <FormControl>
                              <SelectTrigger data-testid="select-financing-type">
                                <SelectValue placeholder="Kies een vorm" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="loan">Lening</SelectItem>
                              <SelectItem value="credit_facility">Rekening-courant krediet</SelectItem>
                              <SelectItem value="lease">Lease</SelectItem>
                              <SelectItem value="factoring">Factoring</SelectItem>
                              <SelectItem value="other">Anders / weet ik nog niet</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                )}

                {activeSection.id === "purpose" && (
                  <FormField
                    control={form.control}
                    name="financingPurpose"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Doel van de financiering</FormLabel>
                        <FormControl>
                          <Textarea
                            rows={5}
                            placeholder="bijv. Twee extra ovens voor de productie, plus voorraad meel en boter voor Q4 om de groei in horeca-afzet te kunnen leveren."
                            {...field}
                            value={field.value || ""}
                            data-testid="textarea-financing-purpose"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}

                {activeSection.id === "situation" && (
                  <FormField
                    control={form.control}
                    name="companyDescription"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Wat doet je bedrijf, voor wie, en waarom nu?</FormLabel>
                        <FormControl>
                          <Textarea
                            rows={6}
                            placeholder="Bijv. Aurora Bakkerij is een ambachtelijke groothandelsbakker in Utrecht die levert aan ~40 horecazaken. Sinds Q2 hebben we 12 nieuwe klanten — vandaar de capaciteitsuitbreiding."
                            {...field}
                            value={field.value || ""}
                            data-testid="textarea-company-description"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}

                {activeSection.id === "numbers" && (
                  <div className="grid sm:grid-cols-3 gap-4">
                    <FormField
                      control={form.control}
                      name="annualRevenue"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Omzet afgelopen jaar (€)</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              {...field}
                              value={field.value ?? ""}
                              onChange={(e) =>
                                field.onChange(
                                  e.target.value ? Number(e.target.value) : undefined,
                                )
                              }
                              data-testid="input-annual-revenue"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="annualCost"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Kosten afgelopen jaar (€)</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              {...field}
                              value={field.value ?? ""}
                              onChange={(e) =>
                                field.onChange(
                                  e.target.value ? Number(e.target.value) : undefined,
                                )
                              }
                              data-testid="input-annual-cost"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="annualProfit"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Winst afgelopen jaar (€)</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              {...field}
                              value={field.value ?? ""}
                              onChange={(e) =>
                                field.onChange(
                                  e.target.value ? Number(e.target.value) : undefined,
                                )
                              }
                              data-testid="input-annual-profit"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                )}

                {activeSection.id === "existing" && (
                  <FormField
                    control={form.control}
                    name="existingFinancing"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Bestaande financieringen</FormLabel>
                        <FormControl>
                          <Textarea
                            rows={4}
                            placeholder="bijv. Lopende microkrediet Qredits € 35.000 (resterend ~€ 22.000, looptijd t/m 2027). Geen lease, geen factoring."
                            {...field}
                            value={field.value || ""}
                            data-testid="textarea-existing-financing"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
              </CardContent>
            </Card>

            <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3">
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  const prev = SECTIONS[activeIdx - 1];
                  if (prev) setActiveSectionId(prev.id);
                }}
                disabled={activeIdx === 0}
              >
                <ArrowLeft className="w-4 h-4 mr-2" /> Vorige sectie
              </Button>
              <div className="flex flex-col-reverse sm:flex-row gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => saveCurrent({ advance: false })}
                  disabled={updateMutation.isPending}
                  data-testid="button-save"
                >
                  {updateMutation.isPending ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Save className="w-4 h-4 mr-2" />
                  )}
                  Opslaan
                </Button>
                {isLastSection ? (
                  <Button
                    type="button"
                    onClick={() => saveCurrent({ advance: false, finalize: allRequiredDone })}
                    disabled={updateMutation.isPending}
                    data-testid="button-save-and-finish"
                  >
                    {updateMutation.isPending ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : allRequiredDone ? (
                      <Sparkles className="w-4 h-4 mr-2" />
                    ) : (
                      <Save className="w-4 h-4 mr-2" />
                    )}
                    {allRequiredDone ? "Opslaan & afronden" : "Opslaan"}
                  </Button>
                ) : (
                  <Button
                    type="submit"
                    disabled={updateMutation.isPending}
                    data-testid="button-save-and-next"
                  >
                    {updateMutation.isPending ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <ArrowRight className="w-4 h-4 mr-2" />
                    )}
                    Opslaan & volgende
                  </Button>
                )}
              </div>
            </div>

            {allRequiredDone && (
              <Card className="border-green-300 bg-green-50/60 dark:border-green-800 dark:bg-green-950/20">
                <CardContent className="p-5 flex flex-col sm:flex-row items-start sm:items-center gap-4">
                  <CheckCircle2 className="w-6 h-6 text-green-700 dark:text-green-500 shrink-0" />
                  <div className="flex-1">
                    <h4 className="font-medium text-green-900 dark:text-green-200">
                      Je intake is compleet
                    </h4>
                    <p className="text-sm text-green-900/80 dark:text-green-200/80">
                      Nu bouwen we bewijs onder je aanvraag. Tijd voor de documenten.
                    </p>
                  </div>
                  <Button
                    type="button"
                    onClick={() => setLocation("/dossier/documenten")}
                    data-testid="button-go-to-documents"
                  >
                    <Upload className="w-4 h-4 mr-2" /> Documenten voorbereiden
                  </Button>
                </CardContent>
              </Card>
            )}
          </form>
        </Form>
      </div>
    </div>
  );
}
