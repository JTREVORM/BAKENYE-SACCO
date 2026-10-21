# Certification evidence

21 October 2026. All accounts and financial records shown here are synthetic, generated in the isolated local database. Screenshots show the real authenticated application, not preview fixtures. Height: 900px.

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

Machine-readable evidence: [browser checks](browser-results.json), [Auth/RLS API checks](api-results.json), [password security](password-results.json), notification stability [run 1](notification-results.json) / [run 2](notification-repeat-results.json) / [run 3](notification-recheck-results.json), change-password form [run 1](password-form-results.json) / [run 2](password-form-repeat-results.json), [blocker investigation](blocker-investigation.json), [preview/accessibility suites](preview-results.json), [financial workflows](workflow-results.json), [dashboard reconciliation](metrics-results.json), [account restrictions](restrictions-results.json), [SSR refresh](refresh-results.json), [standard checks](standards-results.json), [SQL suite output](database-suites.log), and [synthetic database snapshot](synthetic-snapshot.json).

Focused browser retries are included separately. Failed previous attempts are retained in merged results; they are not erased. The report distinguishes confirmed failures from remaining coverage limits.

This directory was regenerated from a clean database run in which every suite
passed: **209/209** browser snapshots, including the two profile password-form
checks that previously failed. Certification is nonetheless still a HOLD, for
BKC-05: the client tree-update defect behind BKC-02, BKC-03 and BKC-04 is itself
unfixed and still reaches every other server-action form.

`baseline/` holds records the per-run exporter does not regenerate and must not
clear: the pre-fix reproductions for
[BKC-03](baseline/bkc-03-baseline-trace.json) (6/10) and
[BKC-04](baseline/bkc-04-baseline-trace.json) (7/16 displayed, 16/16 resolved on
the promise), the earlier
[change-password measurements](baseline/change-password-error-display.json),
the [collection-confirmation exposure](baseline/collection-confirmation-exposure.json)
behind BKC-05, the previous certification's focused notification retries
including its
[failed attempt](baseline/browser-sessions-member-notifications-stability-two-results.json),
its retained [ordering failure](baseline/notification-order-results.json), and
the previously failing
[focused profile password recheck](baseline/browser-sessions-profile-password-form-results.json)
(0/2), whose two checks now pass in the broad run.

Repeated suites are the ones that can clear an intermittent defect: notifications
run 54 interactions three times, and the change-password form runs 66 checks —
50 of them wrong-password submissions — twice here and twice before this stack.
