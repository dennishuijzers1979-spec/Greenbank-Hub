import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BrainCircuit, ShieldAlert, Coins, FileText, Gavel, ListChecks } from "lucide-react";

type Decision = "Go" | "Conditional Go" | "No Go" | string;
type Severity = "blocking" | "advisory" | string;

type Structure = {
  facilityType?: string | null;
  amount?: number | null;
  rate?: number | null;
  rateComment?: string | null;
  tenor?: string | null;
  repaymentProfile?: string | null;
  purpose?: string | null;
};

type CommercialProposal = {
  summary?: string | null;
  structure?: Structure | null;
  fees?: string | null;
  collateralPackage?: string[] | null;
  covenantPackage?: string[] | null;
  monitoringCadence?: string | null;
  conditionsPrecedent?: string[] | null;
  eventsOfDefault?: string[] | null;
};

type Section = { title?: string | null; body?: string | null };

type Condition = {
  id?: string;
  category?: string | null;
  severity?: Severity | null;
  description?: string | null;
  prefunding?: boolean | null;
};

type PricingComponent = {
  product?: string | null;
  contribution?: number | null;
  monthlyRate?: number | null;
  matrixBand?: string | null;
};

export type KwCanonical = {
  decision?: Decision | null;
  decisionRationale?: string | null;
  feasibilityAssessment?: string | null;
  confidenceScore?: number | null;
  creditReport?: {
    headline?: string | null;
    summary?: string | null;
    sections?: Section[] | null;
  } | null;
  recommendedStructure?: Structure | null;
  commercialProposal?: CommercialProposal | null;
  termSheet?: CommercialProposal | null;
  conditions?: Condition[] | null;
  pricingIndication?: {
    components?: PricingComponent[] | null;
    grandTotalMonthlyRate?: number | null;
    notes?: string | null;
  } | null;
};

const eurFmt = new Intl.NumberFormat("nl-NL", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

const pctFmt = new Intl.NumberFormat("nl-NL", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 2,
});

function fmtAmount(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return eurFmt.format(n);
}

function fmtPct(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  // Schema convention: rate stored as decimal (0.069 = 6.9%) for structures,
  // monthlyRate likewise stored as decimal (0.005 = 0.5%/maand).
  return pctFmt.format(n);
}

function fmtRate(structure: Structure | null | undefined): string {
  if (!structure) return "—";
  if (structure.rate !== null && structure.rate !== undefined && Number.isFinite(structure.rate)) {
    const base = pctFmt.format(structure.rate);
    return structure.rateComment ? `${base} (${structure.rateComment})` : base;
  }
  if (structure.rateComment && structure.rateComment.trim()) return structure.rateComment;
  return "—";
}

function decisionBadgeClass(decision: Decision | null | undefined): string {
  switch (decision) {
    case "Go":
      return "bg-green-100 text-green-800 border border-green-200";
    case "Conditional Go":
      return "bg-amber-100 text-amber-800 border border-amber-200";
    case "No Go":
      return "bg-red-100 text-red-800 border border-red-200";
    default:
      return "bg-slate-100 text-slate-700 border border-slate-200";
  }
}

function feasibilityBadgeClass(feas: string | null | undefined): string {
  switch (feas) {
    case "haalbaar zoals aangevraagd":
      return "bg-green-50 text-green-700 border border-green-200";
    case "haalbaar onder voorwaarden":
      return "bg-amber-50 text-amber-700 border border-amber-200";
    case "niet haalbaar zoals aangevraagd":
      return "bg-red-50 text-red-700 border border-red-200";
    default:
      return "bg-slate-50 text-slate-700 border border-slate-200";
  }
}

function severityBadgeClass(s: Severity | null | undefined): string {
  return s === "blocking"
    ? "bg-red-100 text-red-800 border border-red-200"
    : "bg-slate-100 text-slate-700 border border-slate-200";
}

function severityLabel(s: Severity | null | undefined): string {
  return s === "blocking" ? "Blokkerend" : s === "advisory" ? "Aandacht" : String(s ?? "—");
}

function groupConditions(
  conditions: Condition[] | null | undefined,
): Array<{ severity: Severity; categories: Array<{ category: string; items: Condition[] }> }> {
  if (!conditions || conditions.length === 0) return [];
  const order: Severity[] = ["blocking", "advisory"];
  const bySev = new Map<Severity, Condition[]>();
  for (const c of conditions) {
    const sev = (c.severity as Severity) ?? "advisory";
    if (!bySev.has(sev)) bySev.set(sev, []);
    bySev.get(sev)!.push(c);
  }
  // include any custom severities at the end in insertion order
  for (const sev of bySev.keys()) {
    if (!order.includes(sev)) order.push(sev);
  }
  const result: Array<{ severity: Severity; categories: Array<{ category: string; items: Condition[] }> }> = [];
  for (const sev of order) {
    const list = bySev.get(sev);
    if (!list || list.length === 0) continue;
    const byCat = new Map<string, Condition[]>();
    for (const c of list) {
      const cat = (c.category && c.category.trim()) || "Overig";
      if (!byCat.has(cat)) byCat.set(cat, []);
      byCat.get(cat)!.push(c);
    }
    result.push({
      severity: sev,
      categories: Array.from(byCat.entries()).map(([category, items]) => ({ category, items })),
    });
  }
  return result;
}

export function KredietworkflowFinancierCard({
  canonical,
  invocation,
}: {
  canonical: KwCanonical | null | undefined;
  invocation: { provider?: string; usedMockMode?: boolean; fallbackReason?: string | null; model?: string | null } | null;
}) {
  const isLive = invocation && !invocation.usedMockMode && !invocation.fallbackReason;
  const modeBadge = !invocation
    ? null
    : isLive
      ? { label: `Live ${invocation.provider === "openai" ? "OpenAI" : invocation.provider ?? ""}`.trim(), cls: "bg-green-100 text-green-800" }
      : invocation.usedMockMode && invocation.fallbackReason
        ? { label: "Fallback naar mock", cls: "bg-amber-100 text-amber-800" }
        : { label: "Deterministisch / mock", cls: "bg-slate-100 text-slate-700" };

  if (!canonical) {
    return (
      <Card data-testid="kredietworkflow-financier-card">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <BrainCircuit className="w-4 h-4" /> Kredietworkflow — financier-output
              </CardTitle>
              <CardDescription>
                Volledige credit-committee output van{" "}
                <span className="font-mono">GeenbankKredietworkflow</span>. Alleen zichtbaar voor loan officers en admins.
              </CardDescription>
            </div>
            {modeBadge && <span className={`text-xs px-2 py-0.5 rounded ${modeBadge.cls}`}>{modeBadge.label}</span>}
          </div>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <p>
            Nog geen Kredietworkflow output beschikbaar voor dit dossier. Zodra de skill een live of mock-uitvoering
            heeft afgerond verschijnt hier de kredietbeoordeling, aanbevolen structuur, condities en pricing.
          </p>
        </CardContent>
      </Card>
    );
  }

  const cr = canonical.creditReport ?? null;
  const rec = canonical.recommendedStructure ?? null;
  const proposal = canonical.commercialProposal ?? canonical.termSheet ?? null;
  const grouped = groupConditions(canonical.conditions);
  const pricing = canonical.pricingIndication ?? null;
  const confidence =
    canonical.confidenceScore !== null && canonical.confidenceScore !== undefined && Number.isFinite(canonical.confidenceScore)
      ? Math.round(canonical.confidenceScore)
      : null;

  return (
    <Card data-testid="kredietworkflow-financier-card">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <BrainCircuit className="w-4 h-4" /> Kredietworkflow — financier-output
            </CardTitle>
            <CardDescription>
              Credit-committee output van <span className="font-mono">GeenbankKredietworkflow</span>: beslissing,
              aanbevolen structuur, condities en pricing-indicatie. Alleen zichtbaar voor loan officers en admins.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {modeBadge && <span className={`text-xs px-2 py-0.5 rounded ${modeBadge.cls}`}>{modeBadge.label}</span>}
            {invocation?.model && (
              <span className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground font-mono">
                {invocation.model}
              </span>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* 1. Decision header */}
        <div className="flex flex-wrap items-center gap-2">
          <span
            data-testid="kw-decision-badge"
            className={`text-sm font-semibold px-3 py-1 rounded ${decisionBadgeClass(canonical.decision)}`}
          >
            {canonical.decision ?? "Beslissing onbekend"}
          </span>
          {canonical.feasibilityAssessment && (
            <span className={`text-xs px-2 py-0.5 rounded ${feasibilityBadgeClass(canonical.feasibilityAssessment)}`}>
              {canonical.feasibilityAssessment}
            </span>
          )}
          {confidence !== null && (
            <span className="text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
              Vertrouwen: <span className="font-semibold">{confidence}/100</span>
            </span>
          )}
        </div>

        {canonical.decisionRationale && (
          <p className="text-sm leading-relaxed text-muted-foreground">{canonical.decisionRationale}</p>
        )}

        {/* 2. Credit report headline + sections */}
        {cr && (cr.headline || cr.summary || (cr.sections && cr.sections.length > 0)) && (
          <section className="space-y-3 border-t pt-4">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <FileText className="w-4 h-4" /> Kredietrapport
            </h3>
            {cr.headline && <p className="text-sm font-medium">{cr.headline}</p>}
            {cr.summary && <p className="text-sm text-muted-foreground leading-relaxed">{cr.summary}</p>}
            {cr.sections && cr.sections.length > 0 && (
              <div className="space-y-3">
                {cr.sections.map((s, i) => (
                  <div key={i} className="text-sm">
                    {s.title && <p className="font-medium mb-1">{s.title}</p>}
                    {s.body && <p className="text-muted-foreground whitespace-pre-line leading-relaxed">{s.body}</p>}
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* 3. Recommended structure */}
        {rec && (
          <section className="space-y-2 border-t pt-4">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Coins className="w-4 h-4" /> Aanbevolen structuur
            </h3>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-sm">
              <dt className="text-muted-foreground">Faciliteit</dt>
              <dd>{rec.facilityType || "—"}</dd>
              <dt className="text-muted-foreground">Bedrag</dt>
              <dd>{fmtAmount(rec.amount)}</dd>
              <dt className="text-muted-foreground">Rente</dt>
              <dd>{fmtRate(rec)}</dd>
              <dt className="text-muted-foreground">Looptijd</dt>
              <dd>{rec.tenor || "—"}</dd>
              <dt className="text-muted-foreground">Aflossingsprofiel</dt>
              <dd>{rec.repaymentProfile || "—"}</dd>
              <dt className="text-muted-foreground">Doel</dt>
              <dd className="sm:col-span-1">{rec.purpose || "—"}</dd>
            </dl>
          </section>
        )}

        {/* 4. Commercial proposal / term sheet summary */}
        {proposal && (
          proposal.summary ||
          (proposal.structure && (
            proposal.structure.facilityType ||
            (proposal.structure.amount !== null && proposal.structure.amount !== undefined) ||
            (proposal.structure.rate !== null && proposal.structure.rate !== undefined) ||
            proposal.structure.rateComment ||
            proposal.structure.tenor ||
            proposal.structure.repaymentProfile ||
            proposal.structure.purpose
          )) ||
          (proposal.collateralPackage && proposal.collateralPackage.length > 0) ||
          (proposal.covenantPackage && proposal.covenantPackage.length > 0) ||
          (proposal.conditionsPrecedent && proposal.conditionsPrecedent.length > 0) ||
          (proposal.eventsOfDefault && proposal.eventsOfDefault.length > 0) ||
          proposal.fees ||
          proposal.monitoringCadence
        ) && (
          <section className="space-y-2 border-t pt-4">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Gavel className="w-4 h-4" /> Commercieel voorstel / term sheet
            </h3>
            {proposal.summary && <p className="text-sm text-muted-foreground leading-relaxed">{proposal.summary}</p>}
            {proposal.structure && (
              proposal.structure.facilityType ||
              (proposal.structure.amount !== null && proposal.structure.amount !== undefined) ||
              (proposal.structure.rate !== null && proposal.structure.rate !== undefined) ||
              proposal.structure.rateComment ||
              proposal.structure.tenor ||
              proposal.structure.repaymentProfile
            ) && (
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-sm">
                {proposal.structure.facilityType && (<><dt className="text-muted-foreground">Faciliteit</dt><dd>{proposal.structure.facilityType}</dd></>)}
                {(proposal.structure.amount !== null && proposal.structure.amount !== undefined) && (<><dt className="text-muted-foreground">Bedrag</dt><dd>{fmtAmount(proposal.structure.amount)}</dd></>)}
                {((proposal.structure.rate !== null && proposal.structure.rate !== undefined) || proposal.structure.rateComment) && (<><dt className="text-muted-foreground">Rente</dt><dd>{fmtRate(proposal.structure)}</dd></>)}
                {proposal.structure.tenor && (<><dt className="text-muted-foreground">Looptijd</dt><dd>{proposal.structure.tenor}</dd></>)}
                {proposal.structure.repaymentProfile && (<><dt className="text-muted-foreground">Aflossingsprofiel</dt><dd>{proposal.structure.repaymentProfile}</dd></>)}
              </dl>
            )}
            <dl className="grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-1 text-sm">
              {proposal.fees && (
                <>
                  <dt className="text-muted-foreground">Vergoedingen</dt>
                  <dd className="sm:col-span-2">{proposal.fees}</dd>
                </>
              )}
              {proposal.monitoringCadence && (
                <>
                  <dt className="text-muted-foreground">Monitoring</dt>
                  <dd className="sm:col-span-2">{proposal.monitoringCadence}</dd>
                </>
              )}
            </dl>
            {proposal.collateralPackage && proposal.collateralPackage.length > 0 && (
              <div className="text-sm">
                <p className="text-muted-foreground mb-1">Zekerhedenpakket</p>
                <ul className="list-disc list-inside space-y-0.5 ml-1">
                  {proposal.collateralPackage.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              </div>
            )}
            {proposal.covenantPackage && proposal.covenantPackage.length > 0 && (
              <div className="text-sm">
                <p className="text-muted-foreground mb-1">Convenanten</p>
                <ul className="list-disc list-inside space-y-0.5 ml-1">
                  {proposal.covenantPackage.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              </div>
            )}
            {proposal.conditionsPrecedent && proposal.conditionsPrecedent.length > 0 && (
              <div className="text-sm">
                <p className="text-muted-foreground mb-1">Opschortende voorwaarden</p>
                <ul className="list-disc list-inside space-y-0.5 ml-1">
                  {proposal.conditionsPrecedent.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              </div>
            )}
            {proposal.eventsOfDefault && proposal.eventsOfDefault.length > 0 && (
              <div className="text-sm">
                <p className="text-muted-foreground mb-1">Events of default</p>
                <ul className="list-disc list-inside space-y-0.5 ml-1">
                  {proposal.eventsOfDefault.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}

        {/* 5. Conditions grouped by severity then category */}
        {grouped.length > 0 && (
          <section className="space-y-3 border-t pt-4">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <ShieldAlert className="w-4 h-4" /> Condities ({canonical.conditions?.length ?? 0})
            </h3>
            <div className="space-y-3">
              {grouped.map((g) => (
                <div key={g.severity} className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className={`text-xs px-2 py-0.5 rounded ${severityBadgeClass(g.severity)}`}>
                      {severityLabel(g.severity)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {g.categories.reduce((n, c) => n + c.items.length, 0)} stuks
                    </span>
                  </div>
                  <div className="space-y-2 ml-1">
                    {g.categories.map((cat) => (
                      <div key={cat.category}>
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
                          {cat.category}
                        </p>
                        <ul className="space-y-1.5">
                          {cat.items.map((c, i) => (
                            <li key={c.id ?? i} className="text-sm flex gap-2">
                              <span className="mt-1 w-1.5 h-1.5 rounded-full bg-slate-400 flex-shrink-0" />
                              <span>
                                {c.description || "—"}
                                {c.prefunding && (
                                  <span className="ml-2 text-[11px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
                                    vooraf te voldoen
                                  </span>
                                )}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* 6. Pricing indication */}
        {pricing && ((pricing.components && pricing.components.length > 0) || (pricing.grandTotalMonthlyRate !== null && pricing.grandTotalMonthlyRate !== undefined) || pricing.notes) && (
          <section className="space-y-2 border-t pt-4">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <ListChecks className="w-4 h-4" /> Pricing-indicatie
            </h3>
            {pricing.components && pricing.components.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground border-b">
                      <th className="py-1.5 pr-4 font-medium">Product</th>
                      <th className="py-1.5 pr-4 font-medium text-right">Inbreng</th>
                      <th className="py-1.5 pr-4 font-medium text-right">Maandtarief</th>
                      <th className="py-1.5 font-medium">Matrix-band</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pricing.components.map((c, i) => (
                      <tr key={i} className="border-b last:border-0">
                        <td className="py-1.5 pr-4">{c.product || "—"}</td>
                        <td className="py-1.5 pr-4 text-right tabular-nums">{fmtAmount(c.contribution)}</td>
                        <td className="py-1.5 pr-4 text-right tabular-nums">{fmtPct(c.monthlyRate)}</td>
                        <td className="py-1.5 font-mono text-xs">{c.matrixBand || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {(pricing.grandTotalMonthlyRate !== null && pricing.grandTotalMonthlyRate !== undefined) && (
              <p className="text-sm">
                <span className="text-muted-foreground">Gewogen maandtarief: </span>
                <span className="font-semibold tabular-nums">{fmtPct(pricing.grandTotalMonthlyRate)}</span>
              </p>
            )}
            {pricing.notes && <p className="text-xs text-muted-foreground italic">{pricing.notes}</p>}
          </section>
        )}
      </CardContent>
    </Card>
  );
}
