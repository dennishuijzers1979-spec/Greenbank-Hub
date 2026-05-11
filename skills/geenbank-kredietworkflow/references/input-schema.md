# Input schema

## Mandatory inputs

1. Most recent annual accounts
2. Bank transactions in at least one accepted format:
   - csv
   - xml
   - xls / xlsx
   - pdf
3. Current trial balance
4. Requested structure metadata:
   - requested facility type / kredietproduct
   - requested amount / limit / kredietsom
   - requested interest rate
5. If known, also capture:
   - requested tenor
   - requested repayment profile
   - stated use of proceeds

## Optional but strongly recommended

- liquidity forecast
- debtor aging
- collateral documents
- existing financing overview
- management explanation of recent one-offs
- requested covenant preferences or user constraints

## Accepted file types

- pdf
- docx
- xml
- xls
- xlsx
- csv
- json

## Intake handling rules

- Confirm period coverage for each file.
- Flag scanned PDFs with weak extractability.
- If bank files are only PDF, warn that transaction parsing confidence is lower than structured csv/xml.
- If the liquidity forecast is missing, build a modeled forecast from source material.
- If debtor aging is missing, derive aging observations where possible from trial balance and open item schedules, but mark the result as inferred.
- If any of the required requested-structure fields are missing, stop and ask for them before producing a definitive term sheet or definitive feasibility conclusion.
