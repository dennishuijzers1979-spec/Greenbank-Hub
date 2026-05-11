# Pricing matrix

Use the bundled spreadsheet asset `assets/tarieven-lijst-geenbank.xlsx` as the default pricing matrix when the user does not provide a newer tarievenlijst in the current chat. If the user provides a newer tarievenlijst, that newer file overrides the bundled matrix.

Treat all listed percentages as **vanaf-tarieven** (minimum starting rates), not guaranteed quotes. Do not price below the minimum band unless the user explicitly instructs an exception and that exception is clearly flagged in the outputs.

## Onroerend Goed Financiering (o.b.v. LTV)
- 0%-25%: vanaf 1% per maand
- 25%-50%: vanaf 1,50% per maand
- 50%-60%: vanaf 1,75% per maand
- 60%-70%: vanaf 1,90% per maand
- 70%-80%: vanaf 2% per maand

## Debiteuren Financiering (o.b.v. % debiteuren)
- <50%: vanaf 1,50% per maand
- 50%-60%: vanaf 2% per maand
- 60%-80%: vanaf 2,25% per maand
- 70%-80%: vanaf 2,50% per maand

## Voorraad Financiering (o.b.v. % kostprijs voorraad)
- <25%: vanaf 1,50% per maand
- 25%-50%: vanaf 2% per maand
- 50%-60%: vanaf 2,25% per maand
- 60%-75%: vanaf 2,50% per maand

## American Factoring (o.b.v. factuurtermijnen)
- <14 dgn.: vanaf 1% per maand
- 30 dgn.: vanaf 2,50% per maand
- 45 dgn.: vanaf 4% per maand
- 60 dgn.: vanaf 6% per maand
- 90 dgn.: vanaf 8% per maand

## Overig
- Overige financieringen die niet in bovenstaande producten vallen: vanaf 3,00% per maand.

## How to apply the matrix

1. Determine the feasible product or product mix from the collateral package and case facts.
2. Determine the relevant collateral band:
   - onroerend goed -> LTV band
   - debiteuren -> eligible debtor percentage / advance-rate band
   - voorraad -> % kostprijs voorraad / advance-rate band
   - american factoring -> invoice tenor band
3. Pick the minimum rate from the applicable band as the floor.
4. If the case is weaker than the floor assumption (documentation gaps, weaker enforceability, concentration, volatility, aged collateral), move upward within a realistic commercial range and explain why.
5. If more than one product component is used, show each product separately and compute a weighted Grand total pricing line based on each product's contribution to the supported facility / dekking.
6. If only one product applies, still show one product line plus a Grand total line.
7. The same pricing logic must flow through:
   - Leendoel en invulling
   - Commercieel voorstel – Term Sheet
   - Product- en prijsopbouw
   - Rendementsindicatie voor Geenbank
   - Aanbeveling voor de kredietcommissie

## Product- en prijsopbouw table

The executive summary / committee report must contain a dedicated section titled exactly `Product- en prijsopbouw` immediately after `Commercieel voorstel – Term Sheet`.

The section must contain a table with exactly these columns:
1. Product
2. Bijdrage aan dekking
3. Rentepercentage op dit product
4. Grand total

Interpretation rules:
- `Bijdrage aan dekking` = the share of the proposed facility / coverage that is supported by that product component. Present as EUR and/or % as long as it is unambiguous.
- `Rentepercentage op dit product` = the selected monthly rate for that component, tied back to the matrix band.
- `Grand total` = the weighted total pricing of the entire structure. Show this as a final total row even if there is only one product.
