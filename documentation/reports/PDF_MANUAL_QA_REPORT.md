# PDF Manual QA Report

**Prepared:** 24 September 2026
**Documents reviewed:**

| File | Pages | Screenshots embedded | Size | PDF bookmarks |
| --- | --: | --: | --: | --: |
| `BAKENYE_SACCO_MEMBER_USER_MANUAL.pdf` | 36 | 25 | 2.6 MB | 18 |
| `BAKENYE_SACCO_STAFF_ADMIN_MANUAL.pdf` | 91 | 95 | 15.4 MB | 23 |

Both documents were produced from the HTML sources in `documentation/source/` through Chromium's own
print engine — the same mechanism the application itself uses for statements and receipts — and then
had their footers and bookmarks applied with PyMuPDF.

---

## 1. How the review was carried out

| Check | Method |
| --- | --- |
| Every page inspected | Both PDFs were rendered to images in full — 36 and 91 pages — and reviewed page by page as contact sheets, not only at the start and end. |
| Automated structural checks | `documentation/source/qa.py` was run over each file: blank pages, sparse pages, text or tables outside the margins, unresolved template placeholders, and text below 5.5 pt. |
| Text extraction | The full text of both PDFs was extracted and searched for credentials, tokens, local addresses and demonstration passwords. |
| Table of contents | Every contents entry was checked against the page the section actually starts on. |
| Content accuracy | Each claim about a workflow was checked against the corresponding verification result in `DOCUMENTATION_VERIFICATION_REPORT.md`. |
| Screenshot provenance | Every image in both manuals was traced to an entry in `SCREENSHOT_INVENTORY.md`. |

---

## 2. Content QA

| Check | Result |
| --- | --- |
| Every documented module exists in the application | ✅ Each one was loaded in the running application; see the feature inventory in the discovery report |
| Screenshots match the text around them | ✅ Checked page by page |
| Instructions match the real workflows | ✅ Every procedure in both manuals was performed end to end before it was written |
| Roles and permissions are correct | ✅ Taken from the live `permissions` and `role_permissions` tables, then confirmed by signing in as each role |
| No feature was invented | ✅ Four things the manuals deliberately do **not** describe as working: emailed password reset (untestable here), document uploads on finance entries (untestable here), savings reversal (defective), and any payment-provider integration (does not exist) |
| Financial terms used accurately | ✅ No interest rate, fee, savings amount or deadline is quoted as SACCO policy; the manuals point to where each is configured |
| No sensitive information | ✅ See §5 |
| No contradictions between the two manuals | ✅ The member manual's "a member of staff records your payment" matches the staff manual's recording procedures; both describe the same reversal rules and the same defects |
| No unresolved placeholders | ✅ Automated check found none |
| All required sections present | ✅ Member manual: cover, document control, contents, 15 sections including troubleshooting, FAQ, support and appendix. Staff manual: cover, document control, contents, 20 sections including roles, every module, data accuracy, troubleshooting, security, FAQ and appendix |

### Known defects carried into the manuals

Rather than describing broken features as working, both manuals state plainly what does not work.

| Finding | Where it is stated |
| --- | --- |
| **V‑1** savings reversal fails | Staff manual §7 and §10 (warning boxes), §17 (known defects table); front matter warning |
| **V‑2** repayment quick-fill enters 100× | Staff manual §8 (warning), §17; front matter warning |
| **V‑5** guarantor sees "Unknown member" | Member manual §11 (warning) |
| **V‑6** a repayment may be dated in the future | Staff manual §11, as the reason a reconciliation can look wrong |
| **V‑7** document uploads untested | Staff manual §11, marked as not verified |

---

## 3. Visual QA

Every page of both documents was rendered and reviewed.

| Check | Result |
| --- | --- |
| Text readable at printed size | ✅ Body text is 10.5 pt; the smallest text used is 8.5 pt (captions and table cells). No text below 5.5 pt anywhere. |
| Screenshot quality | ✅ Screenshots are embedded at ~185 dpi for their printed size. A crop of an embedded screenshot at print resolution was checked: dialog labels, field values and amounts are all legible. |
| Screenshots large enough | ✅ A desktop screenshot fills the 178 mm text column; a phone screenshot is printed 128 mm tall, and two are placed side by side where they belong together. |
| Correct page breaks | ✅ Each numbered section starts on a new page. Figures, notes, steps and table rows are never split across pages. |
| Table overflow | ✅ No table or block extends past the margins (automated check over every page). The widest table — the 9‑column permission matrix in staff §2 — fits the column. |
| Missing images | ✅ None. The builder raises an error if a referenced screenshot does not exist, so a missing file cannot reach the PDF. |
| Overlapping elements | ✅ None found. |
| Headings consistent | ✅ One H1 per section with a gold rule under it; H2 and H3 used consistently throughout. |
| Page numbering | ✅ Every page except the cover carries "Page N of M" and the manual's name. Verified: no page after the cover is missing a footer. |
| Cover layout | ✅ Full-bleed, with the SACCO crest, registered name, motto, title, version, audience and date, and the SACCO's own photograph. |
| Header/footer consistency | ✅ The same footer rule, title and page number on every page. |
| Mobile readability | ✅ A4 at 10.5 pt reads comfortably when zoomed on a phone; the contents page and PDF bookmarks both allow jumping to a section without scrolling. |
| Printing suitability | ✅ A4, 16 mm side margins, 20/18 mm top and bottom. Backgrounds and coloured note panels print correctly (`print-color-adjust: exact`). |

### Issues found, and what was done

| # | Issue | Action |
| --- | --- | --- |
| 1 | The first draft placed a tall phone screenshot next to a wide desktop screenshot; the block would not fit and left a page two-thirds empty. | Figures are now sized from their own aspect ratio — wide images fill the column, phone images are given a fixed printed height — and the layout was rebuilt. |
| 2 | The Next.js development badge appeared in the corner of early captures. | Hidden at capture time. It belongs to `npm run dev`, not to the application, and appears in no screenshot in either manual. |
| 3 | The member loan-application screenshot showed the "you already have a loan" message rather than the application form, because the demonstration member had a live loan. | Recaptured from a member with no loan; the manual now shows step 1 of the six-step application. |
| 4 | The Guarantees screenshot showed an empty list. | Recaptured from a member who guarantees two live loans — which is also what exposed finding **V‑5**. |
| 5 | The reconciliation screenshot showed an account that had never been reconciled, and a first attempt produced a variance that did not match its own written reason. | A reconciliation of Cash at Hand was carried out properly, with a UGX 4,999.67 shortfall and a reason that matches it. |
| 6 | An expense was first recorded under the wrong category (Bank charges for stationery). | Re-recorded under Office supplies and approved; that is the one shown. |
| 7 | The first PDFs were 6.6 MB and 21.4 MB. | Screenshots are now downsampled to the resolution their printed size needs (185 dpi). The manuals are 2.6 MB and 15.4 MB, with no visible loss. |
| 8 | Contents page numbers could have drifted from the body. | The build renders once to find where each section falls, writes the real page numbers, then renders again. Four entries were spot-checked against the finished file and all matched. |

### Remaining, accepted

| Item | Why it is accepted |
| --- | --- |
| Some pages end with white space (member pages 5, 34, 36; staff pages 5, 29, 40, 52, 69, 88) | Each numbered section begins on a new page, which is right for a manual people will dip into. The white space is at the end of a section, never in the middle of one. |
| The staff manual is 15.4 MB | Fine for email and well within WhatsApp's document limit. A lighter copy can be produced by lowering `PRINT_DPI` in `documentation/source/common.py` and rebuilding. |
| No SACCO telephone number, email or opening hours | None was supplied, and inventing contact details would be worse than omitting them. Both manuals say to ask at the office, and the member manual notes that the SACCO may add them at the next revision. |

---

## 4. Functional QA

| Check | Result |
| --- | --- |
| Both files open | ✅ Opened and parsed with PyMuPDF; all pages render. |
| Table of contents correct | ✅ Every entry checked against the page the section starts on. |
| PDF bookmarks | ✅ 18 in the member manual, 23 in the staff manual, each jumping to the right page. |
| Page navigation | ✅ Page numbers on the contents page match the printed page numbers. |
| Screenshots visible | ✅ 25 and 95 images embedded and rendering. |
| Text selectable and searchable | ✅ Text extracts cleanly (33,000 and 70,000 characters). |
| Links | No external hyperlinks are used, so there are none to break. |

---

## 5. Sensitive-information check

| Check | Result |
| --- | --- |
| Real member data | ✅ None. Every member, phone number, National ID and amount is invented demonstration data, created in a throwaway local database. |
| Real transaction references | ✅ None. Every reference shown was generated by the test database. |
| Credentials in the PDFs | ✅ Searched for JWTs, `service_role`, Supabase hostnames, local addresses and the demonstration passwords: **no matches in either document**. |
| Credentials in the repository files | ✅ The only occurrence of `SUPABASE_SERVICE_ROLE_KEY` anywhere under `documentation/` is the *name* of the variable, in the verification report's warning that such a key exists in the build container and should be rotated. No key value is stored anywhere. |
| Temporary passwords in screenshots | ⚠️ Two screenshots show a generated temporary password (`admin/users-temporary-password.png` and `staff/member-reset-password-result.png`). This is unavoidable — the manuals have to show what that screen looks like — and both belong to demonstration accounts in a throwaway database that no longer exists. Neither opens anything. |
| Production database credentials, API keys, environment secrets | ✅ None appear in any screenshot, source file or PDF. |
| Browser address bar | ✅ No screenshot includes browser chrome, so the local test address appears nowhere. |

---

## 6. Approval status

| Deliverable | Status |
| --- | --- |
| `BAKENYE_SACCO_MEMBER_USER_MANUAL.pdf` | **Ready for SACCO review.** |
| `BAKENYE_SACCO_STAFF_ADMIN_MANUAL.pdf` | **Ready for SACCO review.** |

Both manuals are complete, accurate against the version of the system verified on 24 September 2026,
and free of sensitive information.

**Two things SACCO management should decide before the manuals are circulated:**

1. **Fix, or accept, the two defects the staff manual warns about** (V‑1 savings reversal, V‑2
   repayment quick-fill). The manuals describe safe ways to work around both, but the workarounds
   should not become permanent. When they are fixed, the warning boxes in staff §7, §8, §10 and §17
   and the front-matter warning should be removed and the manual reissued as version 1.1.
2. **Add the SACCO's own contact details** — office telephone, email and opening hours — to member
   manual §15 and to the staff manual's escalation table, if management wants them printed.

**How to review the PDFs**

1. Open `documentation/manuals/` and open each file in any PDF reader.
2. Use the contents page, or the reader's bookmark panel, to jump between sections.
3. Read the sections that cover your own role first; the staff manual lists which ones those are in
   its Section 1.
4. Check the screenshots against your own screens. Where they differ, the screen is right and the
   manual needs correcting — tell whoever maintains this documentation.
5. To regenerate either manual after an edit, follow `documentation/README.md`.
