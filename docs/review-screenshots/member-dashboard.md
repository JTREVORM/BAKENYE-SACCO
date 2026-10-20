# Member dashboard review

The member home page uses the approved navy-and-gold design system with a personalized scenic hero, full UGX balances, savings and payment updates, existing account actions and readable transaction descriptions. The desktop layout uses the available width; mobile uses single-column financial cards and the existing navigation drawer.

| Review | JPG |
| --- | --- |
| Member desktop, 1855px | [Open/download](member-dashboard-desktop.jpg?raw=true) |
| Member mobile, 390px | [Open/download](member-dashboard-mobile.jpg?raw=true) |
| Corrected Finance preview, desktop | [Open/download](staff-finance-desktop.jpg?raw=true) |
| Corrected Finance preview, mobile | [Open/download](staff-finance-mobile.jpg?raw=true) |
| Finance ledger, scrolled to balances | [Open/download](staff-finance-ledger-end.jpg?raw=true) |

Images show development QA fixtures, not live financial reports. The member preview renders only the selected fixture member's balances and transactions. Active, no-loan, pending, empty, reversed-transaction and restricted loan-application states are covered. No financial action is submitted.

Production retains `requireMember()`, the original member-scoped financial and transaction queries, the registration-fee notice, existing loan-application permission and every account-action destination. No staff controls or SACCO-wide financial figures are introduced. Other member screens retain their original layouts. The approved staff layouts are unchanged.

Finance QA now uses today's date in Uganda for both its snapshot and today's activity. Posted sample movements follow their payment methods and account-specific running balances, reconciling to the existing closing totals. Loan disbursement is a payment. The reversed share sample lacks a matching reversal ledger pair, so the Finance preview omits it instead of inventing accounting entries; other fixture views still show its reversed transaction status. Production ledger queries and calculations are untouched.

Member responsive checks cover 320, 360, 390, 600, 768, 834, 1024, 1280, 1440 and 1855px, plus staff dashboard regression checks. The development preview route is disabled in production and signed-out account destinations retain their existing login redirects. Authenticated live account workflows are outside this fixture-based visual review.
