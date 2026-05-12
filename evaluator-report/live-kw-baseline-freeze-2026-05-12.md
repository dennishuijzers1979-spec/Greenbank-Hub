# Live Kredietworkflow Baseline Freeze — 2026-05-12

Documenteert de eerste bewezen live-KW baseline van Geenbank Hub vóór nieuwe
UI/productwijzigingen. Doel: een vast referentiepunt waar volgende
producttaken (zoals het tonen van de KW-financier-output in de loan-officer
UI) tegenaan worden gemeten.

Dit document beschrijft alleen de status; er zijn geen runtime-codewijzigingen
gedaan in deze taak.

---

## 1. Repository-status

- Branch: `main`
- Origin/main commit-SHA op moment van freeze:
  `fc78ac4ec33192661bb49ec0219ec0f70c3e800c`
- Commit-bericht: `Geenbank Hub: show kredietworkflow financier output`
- Datum: 2026-05-12 00:42:07 UTC
- Push-pad: GitHub Git Data API (helper script in `/tmp/push_kw.mjs`,
  authenticatie via `GITHUB_TOKEN`-secret).
- Vorige twee commits op main:
  - `f0dbf17` — Geenbank Hub: add structured outputs for kredietworkflow
  - `be7339b` — Add structured output for financial credit workflow

---

## 2. Kredietworkflow Structured Outputs

- Feature-flag: `KW_USE_STRUCTURED_OUTPUTS`
- Status in `.replit`: `KW_USE_STRUCTURED_OUTPUTS = "true"` (regel 37)
- Effect: `GeenbankKredietworkflow` stuurt bij live OpenAI-aanroepen een
  `response_format: { type: "json_schema", strict: true }` met het canonical
  schema mee. Bij parse-failure of API-fout valt de skill terug op de
  deterministische mock-pad en zet `usedMockMode=true` met een
  `fallbackReason`.
- Codepad: `artifacts/api-server/src/lib/skills/geenbank-kredietworkflow.ts`
  — `structuredOutputsEnabled()` (regel 294), gebruikt in
  `runGeenbankKredietworkflow` (regel 331+).
- Schema-bron:
  `artifacts/api-server/src/lib/skills/geenbank-kredietworkflow-financier-schema.ts`.

---

## 3. Live runtime-verificatie — Brouwerij Noord

Dossier: **Brouwerij Noord B.V.**
- Dossier-ID: `65407954-eed1-4704-a9e3-87336040e642`
- Status: `submitted_to_geenbank`
- Run-type: `full_analysis`
- Resultaat: laatste run completed met `verdict` gezet.

KW-invocation (`GeenbankKredietworkflow`) op deze run:
- `provider`: `openai` (niet mock)
- `model`: `gpt-5.2-2025-12-11`
- `usedMockMode`: `false`
- `fallbackReason`: `null`
- `ok`: `true`

Canonical-output (`extras.canonical`) verifieerbaar via
`GET /api/dossiers/65407954-eed1-4704-a9e3-87336040e642/runs/latest`:
- `decision`: `"Conditional Go"`
- `feasibilityAssessment`: `"haalbaar onder voorwaarden"`
- `confidenceScore`: aanwezig (>0)
- `creditReport.headline`: gevuld, vermeldt Brouwerij Noord
- `creditReport.sections`: 7 secties
- `recommendedStructure`: gevuld (faciliteit, bedrag, rente, looptijd,
  aflossingsprofiel, doel)
- `commercialProposal` / `termSheet`: gevuld met summary,
  collateralPackage, covenantPackage
- `conditions`: 6 stuks, met severities `blocking` en `advisory`,
  meerdere categorieën
- `pricingIndication`: components-lijst + `grandTotalMonthlyRate` + notes

Conclusie: dit is de eerste, reproduceerbaar bewezen live-KW run met
volledige canonical output op het demo-dossier.

---

## 4. Skills — live vs mock

Live (echte API-aanroep richting OpenAI, met fallback naar mock bij fout):
- `GeenbankKredietworkflow` — OpenAI Chat Completions, structured outputs
  aan, schema strict.
- `FinancingProductAdvisorDualView` — OpenAI, gebruikt voor de DualView
  "Financier productadvies (intern)" kaart.
- `DualViewAdvice` — OpenAI, prospect-/officer-adviespad.

Deterministisch / mock (geen externe calls, vaste output o.b.v. dossier
input):
- `Moneycare` (Moneycare-prevalidatie) — mock.
- `CreditProductAdvisor` — mock.
- `FinancingNeedAssessor` — mock.

Externe diensten / integraties die nu ook nog mock zijn:
- **Pipedrive** — partner-submit roept geen echte CRM aan; de submit
  registreert lokaal en logt een mock-event.
- **SendGrid** — uitnodigings- en notificatie-mails worden niet echt
  verstuurd; de stub logt alleen.
- **Object Storage** (App Storage) — document-uploads worden in de
  database opgeslagen (base64), niet richting echte object-storage.

---

## 5. Bekende beperkingen op deze baseline

1. **KW canonical output nog niet zichtbaar in loan-officer UI**
   - De volledige `extras.canonical` van `GeenbankKredietworkflow` (decision,
     creditReport, recommendedStructure, commercialProposal/termSheet,
     conditions, pricingIndication) wordt op `/dossiers/:id` nog niet als
     scanbare card getoond. Loan officers zien op dit moment alleen de
     bestaande DualView-kaart en de generieke "AI uitvoeringsdetails"-kaart.
   - Wordt opgepakt in de eerstvolgende producttaak (zie sectie 6).

2. **mockup-sandbox `vite build` PORT-issue**
   - `pnpm --filter @workspace/geenbank-hub run build` (en sandbox-build)
     faalt in `vite.config.ts` met
     `Error: PORT environment variable is required but was not provided.`
     omdat de config `PORT` ook in build-context vereist.
   - Alleen `vite build` raakt dit; de dev-server (de workflow) draait
     prima. Niet blokkerend voor runtime, wel een tech-debt-item voor
     CI/preview-builds.

3. **Pipedrive / SendGrid / Object Storage gemockt**
   - Zoals beschreven in sectie 4. Live-integratie vereist secrets,
     sandbox-accounts en een echte storage-backend; bewust nog niet
     ingezet.

4. **Skills `Moneycare` / `CreditProductAdvisor` / `FinancingNeedAssessor`
   gemockt**
   - Deze drie zijn nog niet aangesloten op een live LLM/regel-engine.
     Alleen `GeenbankKredietworkflow`, `FinancingProductAdvisorDualView`
     en `DualViewAdvice` doen op dit moment echte OpenAI-calls.

5. **Validatie-infrastructuur — Playwright-tests**
   - De `runTest` (Playwright) subagent verloor in de vorige sessie
     tweemaal zijn notebook-sessie tijdens login-flows. End-to-end
     screenshot-validatie is op deze baseline daardoor niet automatisch
     uitgevoerd; functionele verificatie gebeurde via API-calls en
     handmatige inspectie.

---

## 6. Volgende geplande producttaak

`Geenbank Hub: show kredietworkflow financier output`

Doel: de canonical output van `GeenbankKredietworkflow` voor
loan officers en admins zichtbaar maken op de dossier-detailpagina,
in het Nederlands, scanbaar, zonder raw JSON, zonder backend- of
RBAC-wijziging. Sluit beperking 1 hierboven.

(Implementatie van deze taak is feitelijk al geland in commit
`fc78ac4` — dit document fungeert nog steeds als baseline-snapshot
van de runtime-status op het moment van die commit.)

---

## 7. Reproduceerbare verificatie-stappen

Om de baseline opnieuw aan te tonen:

1. Login als loan officer:
   `POST /api/auth/login` met `{ email: "maarten@geenbank.nl",
   password: "Welkom2025!" }`.
2. Ophalen laatste run:
   `GET /api/dossiers/65407954-eed1-4704-a9e3-87336040e642/runs/latest`.
3. Controleer in de respons:
   - `skillInvocations[].skillName === "GeenbankKredietworkflow"` heeft
     `provider="openai"`, `usedMockMode=false`, `fallbackReason=null`.
   - `extras.canonical.decision === "Conditional Go"`.
   - `extras.canonical.conditions.length >= 1` met meerdere severities.
4. Optioneel — login als prospect (`anne@brouwerij-noord.nl` /
   `Welkom2025!`) en `GET /dossier/rapport`: deze pagina toont alleen
   semantische `EntrepreneurReport`-velden, geen canonical-data en geen
   raw JSON.

---

_Vastgelegd op 2026-05-12. Volgende baseline-update aanbevolen zodra een
van de gemockte skills/integraties (Pipedrive, SendGrid, Object Storage,
Moneycare, CreditProductAdvisor, FinancingNeedAssessor) live gaat._
