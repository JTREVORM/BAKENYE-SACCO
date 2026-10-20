# Certification evidence

20 October 2026. All accounts and financial records shown here are synthetic, generated in the isolated local database. Screenshots show the real authenticated application, not preview fixtures. Height: 900px.

| Dashboard / account | Desktop 1440px | Mobile 390px | Narrow mobile 320px |
| --- | --- | --- | --- |
| Super Admin | [JPG](screenshots/super_admin-1440.jpg) | [JPG](screenshots/super_admin-390.jpg) | [JPG](screenshots/super_admin-320.jpg) |
| Admin | [JPG](screenshots/admin-1440.jpg) | [JPG](screenshots/admin-390.jpg) | [JPG](screenshots/admin-320.jpg) |
| Manager / Overview | [JPG](screenshots/manager-1440.jpg) | [JPG](screenshots/manager-390.jpg) | [JPG](screenshots/manager-320.jpg) |
| Loans Officer | [JPG](screenshots/loan_officer-1440.jpg) | [JPG](screenshots/loan_officer-390.jpg) | [JPG](screenshots/loan_officer-320.jpg) |
| Cashier | [JPG](screenshots/cashier-1440.jpg) | [JPG](screenshots/cashier-390.jpg) | [JPG](screenshots/cashier-320.jpg) |
| Accountant / Finance | [JPG](screenshots/accountant-1440.jpg) | [JPG](screenshots/accountant-390.jpg) | [JPG](screenshots/accountant-320.jpg) |
| Collections | [JPG](screenshots/field_officer-1440.jpg) | [JPG](screenshots/field_officer-390.jpg) | [JPG](screenshots/field_officer-320.jpg) |
| Viewer / Overview | [JPG](screenshots/viewer-1440.jpg) | [JPG](screenshots/viewer-390.jpg) | [JPG](screenshots/viewer-320.jpg) |
| Member Alpha | [JPG](screenshots/member_a-1440.jpg) | [JPG](screenshots/member_a-390.jpg) | [JPG](screenshots/member_a-320.jpg) |
| Member Beta | [JPG](screenshots/member_b-1440.jpg) | [JPG](screenshots/member_b-390.jpg) | [JPG](screenshots/member_b-320.jpg) |

[Certification report](../release-certification.md) · [Reproduction](../../scripts/certification/README.md)

Chart review (12 months, all twelve buckets retained):

| Chart | Desktop 1440px | Mobile 390px | Narrow mobile 320px |
| --- | --- | --- | --- |
| Super Admin | [JPG](screenshots/chart-super_admin-1440-12.jpg) | [JPG](screenshots/chart-super_admin-390-12.jpg) | [JPG](screenshots/chart-super_admin-320-12.jpg) |
| Overview | [JPG](screenshots/chart-manager-1440-12.jpg) | [JPG](screenshots/chart-manager-390-12.jpg) | [JPG](screenshots/chart-manager-320-12.jpg) |

Machine-readable evidence: [browser checks](browser-results.json), [Auth/RLS API checks](api-results.json), [password security](password-results.json), notification stability [run 1](notification-results.json) / [run 2](notification-repeat-results.json) / [run 3](notification-recheck-results.json), [blocker investigation](blocker-investigation.json), [preview/accessibility suites](preview-results.json), [financial workflows](workflow-results.json), [dashboard reconciliation](metrics-results.json), [account restrictions](restrictions-results.json), [SSR refresh](refresh-results.json), [standard checks](standards-results.json), [SQL suite output](database-suites.log), and [synthetic database snapshot](synthetic-snapshot.json).

Focused browser retries are included separately. Failed previous attempts are retained in merged results; they are not erased. The report distinguishes confirmed failures from remaining coverage limits.

This directory was regenerated from the current clean database run. The 209
latest browser snapshots include the focused rechecks and retain failed previous
attempts; two of them — the staff and member profile password forms — still fail,
which is the open BKC-04 blocker and why certification remains on HOLD.

`baseline/` holds records the per-run exporter does not regenerate and must not
clear: the [pre-fix BKC-03 reproduction](baseline/bkc-03-baseline-trace.json)
(6/10), the previous certification's focused notification retries including its
[failed attempt](baseline/browser-sessions-member-notifications-stability-two-results.json),
and the [BKC-04 measurements](baseline/change-password-error-display.json).
The repeated notification suite itself now passes 54/54 in each of three runs;
its retained [ordering failure](notification-order-results.json) is kept beside
them.
