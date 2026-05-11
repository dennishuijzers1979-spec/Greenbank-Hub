# Acceptatiecriteria and policy gates

This file combines:
- explicit internal criteria found in SharePoint source material
- indirect criteria inferred from uploaded examples and planning files
- a conservative default policy layer for cases where no harder internal threshold is documented

## Source-backed internal criteria

### Kevin Credit instruction
Internal review requires:
- recalculate DSCR, LTV, and solvency
- perform consistency matrix checks between report, source, and proposal
- compare market value versus net forced-sale value of collateral
- test policy gates and explicitly motivate deviations
- run a stress case with revenue down 20 percent and assess DSCR and covenant impact
- assign go / conditional go / no go

The documented score anchors include:
- financial strength: DSCR < 1.0 is poor; DSCR >= 1.5 is excellent
- collateral/structure: LTV > 90 percent is poor; LTV < 60 percent is excellent
- policy conformity and data quality are also scored dimensions

### Internal term sheet precedent
Observed precedent thresholds / terms:
- minimum DSCR >= 1.25x
- maximum LTV <= 0.60
- dividend stop while solvency < 25 percent
- annual review with reporting cadence and conditions precedent

### Internal risk matrix early warning indicators
Treat these as hard review triggers even when not automatic declines:
- DSCR < 1.1
- payment arrears > 30 days
- negative equity or negative operating cash flow
- top-3 customers > 50 percent
- LTV > 80 percent
- collateral valuation older than 24 months
- exposure > 20 percent of portfolio
- sector concentration > 40 percent
- regional concentration > 50 percent
- funding buffer below norm

### Uploaded planning spreadsheet signals
The uploaded workbook suggests additional practical criteria:
- reservation / provisioning scale tied to risk score 1-5 with reserve percentages from 0 to 15 percent
- collateral coverage is explicitly compared on both absolute and permitted bases
- concentration risk is calculated against total available funding
- available funds and bank balance reconciliation matter operationally

## Recommended decision matrix

### Go
Use go only when all or nearly all of the following hold:
- DSCR >= 1.25x base case
- DSCR remains >= 1.10x under stress case, or any shortfall is over-cured by immediate cash controls
- LTV <= 60 percent where LTV is relevant, or collateral coverage comfortably exceeds exposure
- solvency is acceptable for the borrower profile and not deteriorating sharply
- no material document gaps
- collateral package is enforceable and documented
- no major concentration or governance red flags

### Conditional Go
Use conditional go when the case is supportable but one or more of the following is needed:
- collateral perfection before funding
- drawdown restrictions or staged utilization
- tighter reporting covenant package
- minimum liquidity or borrowing-base mechanics
- escrow, cash sweep, or blocked-account control
- covenant cure for DSCR, LTV, solvency, or concentration
- updated valuation or legal confirmation

Typical conditional-go triggers:
- DSCR between 1.10x and 1.25x
- collateral value adequate but documentation or ranking incomplete
- solvency weak but explainable and improving
- high customer concentration with strong cash control
- missing forecast that can be modeled but not yet validated by management

### No Go
Use no go when one or more material blockers remains:
- DSCR < 1.0x with no credible near-term cure
- stress case clearly breaks repayment capacity
- LTV materially above 80 to 90 percent without exceptional over-collateralized support elsewhere
- enforceability of collateral is doubtful
- data quality too weak for reliable underwriting
- serious legal / integrity / governance concerns
- concentration or liquidity mismatch too extreme for the funding structure

## Covenant suggestions by risk profile

### Standard / stronger case
- DSCR >= 1.25x quarterly
- solvency >= 25 percent unless product economics justify another metric
- monthly liquidity update
- quarterly management figures

### Weaker but workable case
- DSCR >= 1.10x hard floor; draw restrictions below 1.20x
- borrowing-base certificate monthly
- cash sweep on surplus cash / collections
- dividend block while covenant pressure exists
- mandatory refresh of collateral values and debtor aging

## How to use this file

- Prefer explicit internal thresholds over inferred ones.
- Where multiple thresholds exist, use the strictest relevant test and explain why.
- If future official policy documents are added, update this file and retire inferred thresholds.
