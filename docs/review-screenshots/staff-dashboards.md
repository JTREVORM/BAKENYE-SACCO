# Staff dashboard review

Frontend polish on `claude/cool-mendel-3ey330`. These images use the existing development QA fixtures and real presentation components; they are not live financial reports. Desktop images are 1855px wide and mobile images are 390px wide.

| Dashboard completed | Existing route | Desktop JPG | Mobile JPG |
| --- | --- | --- | --- |
| Administration — Admin and roles assigned to Administration | `/staff/admin` | [Open/download](staff-administration-desktop.jpg?raw=true) | [Open/download](staff-administration-mobile.jpg?raw=true) |
| Cashier / Teller | `/staff/desk` | [Open/download](staff-cashier-desktop.jpg?raw=true) | [Open/download](staff-cashier-mobile.jpg?raw=true) |
| Loans Officer | `/staff/loans-desk` | [Open/download](staff-loans-desktop.jpg?raw=true) | [Open/download](staff-loans-mobile.jpg?raw=true) |
| Finance — Accountant / Treasurer roles assigned to Finance | `/staff/finance` | [Open/download](staff-finance-desktop.jpg?raw=true) | [Open/download](staff-finance-mobile.jpg?raw=true) |
| Savings Collection — Field / Collection Staff | `/staff/savings/collect` | [Open/download](staff-collections-desktop.jpg?raw=true) | [Open/download](staff-collections-mobile.jpg?raw=true) |

The approved **Super Admin** and **SACCO Overview** designs are preserved. The seeded Manager and Viewer roles share SACCO Overview. Owner, Secretary, Treasurer and other custom roles keep their existing `roles.dashboard` assignment; no new role routes, permission grants or dashboard mappings were introduced. Role names in banners continue to come from the signed-in user.

The previews cover full labels and UGX amounts, long member names, an overdue loan, a reversed transaction, an empty due queue, finance charts and collections recording controls. No financial action is submitted during review. Production routes retain their original queries, permission checks, arithmetic and workflows. The preview handler is disabled in production; anonymous production requests are redirected to login by the existing authentication middleware.

Responsive checks: 320, 390, 600, 768, 1024, 1280, 1440 and 1855px for each completed dashboard, plus the existing Super Admin and Overview regression suites. Restricted fixture states and unchanged landing-path permission fallbacks are checked separately. Authenticated live sessions are outside this fixture-based review.
