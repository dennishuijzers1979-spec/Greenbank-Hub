# Output specifications

## Required output set

Unless the user explicitly asks for less, produce:
1. risicoanalyse
2. indicatieve term sheet
3. kevin credit validatie / kredietcommissie advies
4. executive summary / credit committee report as .docx
5. structured json summary

All outputs must be consistent with one canonical case model.

## 1. Intake summary

Always begin the working analysis with a compact intake block that states:
- received files
- missing files
- modeled items
- confidence level

## 2. Requested structure and feasibility summary

Always state the requested structure explicitly before presenting the recommended structure.

Minimum fields:
- requested product
- requested amount / limit
- requested interest rate
- requested tenor if known
- requested repayment profile if known
- purpose

Then state one feasibility conclusion:
- haalbaar zoals aangevraagd
- haalbaar onder voorwaarden
- niet haalbaar zoals aangevraagd

If the requested structure is not the recommended structure, explain the gap in one compact table or bullet block.

## 3. Risk analysis memo

Minimum sections:
- management summary
- document overview
- liquidity and cash flow
- solvency and profitability
- collateral and coverage
- key risks and mitigants
- stress case
- preliminary structure view

Always include:
- DSCR
- solvency
- key cash-flow observations
- collateral coverage or borrowing-base support
- assumptions
- explicit uncertainty flags

## 4. Indicative term sheet

Use the internal precedent format.

Minimum fields:
- requested structure summary
- recommended structure summary
- kredietvorm
- doel
- hoofdsom / limiet
- borrowing base / availability mechanics where relevant
- looptijd
- rente
- aflossing / revolving logic
- zekerheden
- financiële convenanten
- monitoring & rapportage
- voorwaarden precedent
- events of default
- kosten & fees
- disclaimer

The term sheet must reflect the recommended structure, not blindly repeat the requested structure.

## 5. Executive summary / credit committee report (.docx)

Use the bundled executive summary template as the model for the report type and heading order. The example content inside the template is illustrative only.

### Mandatory heading order
Use these headings exactly:
- Executive Summary
- Credit Committee
- Bedrijfsgegevens
- Krediet aanvraag
- Omschrijving van de onderneming en activiteiten
- Leendoel en invulling
- Financiële gegevens van de onderneming
- Huidige financiering
- Risicoanalyse
- Commercieel voorstel – Term Sheet
- Product- en prijsopbouw
- Risico’s en mitigaties
- Rendementsindicatie voor Geenbank
- Aanbeveling voor de kredietcommissie
- Beoordeling Krediet Beoordelaar
- Akkoord kredietcommissie
- Lijst met bijlagen

### Section rules

#### Bedrijfsgegevens
Include available borrower identity and registration details.

#### Krediet aanvraag
State the user-requested structure explicitly:
- requested product
- requested amount
- requested rate
- requested tenor if known
- purpose

#### Leendoel en invulling
Explain:
- what the borrower wants
- whether that requested structure is feasible
- what the recommended structure is
- why the recommended structure is safer or more realistic if it differs

#### Financiële gegevens van de onderneming
Use compact tables. Include historical data, current position, and brief interpretation.

#### Huidige financiering
Describe existing debt, refinancing, exits of prior lenders, and structural implications.

#### Risicoanalyse
Present a compact risk table with impact / probability / explanation.

#### Commercieel voorstel – Term Sheet
Summarize the recommended structure only. Keep it consistent with the detailed term sheet.

#### Product- en prijsopbouw
Mandatory table with exactly these columns:
- Product
- Bijdrage aan dekking
- Rentepercentage op dit product
- Grand total

Rules:
- include one row per product component used in the structure
- `Bijdrage aan dekking` must show how much of the supported facility / dekking is carried by that product component
- `Rentepercentage op dit product` must match the selected rate from the pricing matrix logic
- add a final total row showing the weighted grand total pricing of the structure
- if only one product applies, still include the grand total row

#### Risico’s en mitigaties
Present the major risks and the direct mitigants in concise bullet or short paragraph form. If the recommended structure differs from the requested structure, tie the mitigants to that change.

#### Rendementsindicatie voor Geenbank
Address at minimum:
- bruto rentebaten
- arrangement / structureringsfee
- commitment fee if any
- commentary on return versus risk
- tie the yield discussion back to the selected product pricing and the grand total pricing row

#### Aanbeveling voor de kredietcommissie
State clearly:
- Advies: GO / CONDITIONAL GO / NO GO
- short motivation
- voorwaarden
- core covenants
- explicit statement whether approval applies to the requested structure or only to the recommended structure

#### Beoordeling Krediet Beoordelaar
Provide the reviewer-style assessment of the main risk themes, whether the requested structure is supportable, and whether the recommended structure is sufficiently mitigated. End with a conclusion.

#### Akkoord kredietcommissie
Include a decision line and signature placeholders for the committee.

#### Lijst met bijlagen
List the actual source files used in the case.

### Formatting and consistency rules
- Keep the document committee-ready, compact, and evidence-based.
- Use the heading names exactly as written above.
- Treat the template content as an example, not as a source of facts.
- Ensure the decision, pricing, tenor, facility amount, covenants, collateral, requested structure, and recommended structure match the canonical case model exactly.
- If data is missing, mark it explicitly instead of fabricating content.

## 6. Structured JSON output

Include at minimum:
- borrower
- requested_structure
- recommended_structure
- feasibility_assessment
- request_vs_recommendation_differences
- metrics
- collateral
- covenants
- assumptions
- missing_information
- policy_breaches
- mitigants
- decision
- decision_rationale
