# BAKENYE SACCO — user documentation

This folder holds the two user manuals for the Bakenye Unity and Development SACCO system, the
screenshots they are built from, and the reports that record how they were verified.

```
documentation/
├── manuals/
│   ├── BAKENYE_SACCO_MEMBER_USER_MANUAL.pdf      37 pages, for members
│   └── BAKENYE_SACCO_STAFF_ADMIN_MANUAL.pdf      92 pages, for staff and administrators
├── screenshots/
│   ├── member/    the member portal, captured at phone size (390 × 844)
│   ├── staff/     the back office, captured per role at 1440 × 900
│   ├── admin/     administrator screens
│   └── shared/    the signed-out screens, at both sizes
├── reports/
│   ├── BAKENYE_SYSTEM_REMEDIATION_REPORT.md      the defects found, and how each was fixed
│   ├── DOCUMENTATION_DISCOVERY_REPORT.md         what the application actually contains
│   ├── DOCUMENTATION_VERIFICATION_REPORT.md      what was run, what passed, what failed
│   ├── SCREENSHOT_INVENTORY.md                   every screenshot, catalogued
│   └── PDF_MANUAL_QA_REPORT.md                   the page-by-page review of both PDFs
└── source/                                       everything the manuals are built from
```

## Read these first

* **`reports/BUSINESS_RULES_2026_REPORT.md`** — the approved change to the SACCO's business rules
  (UGX 20,000 registration, open monthly savings, UGX 10,000 a share) and everything done to carry
  it out. Read this first: it is why the manuals are at version 2.0.
* **`reports/BAKENYE_SYSTEM_REMEDIATION_REPORT.md`** — the eight defects that were found and fixed
  in the application, with the root cause, the fix and the test for each. It is why the manuals
  reached version 1.1.
* **`reports/DOCUMENTATION_VERIFICATION_REPORT.md`** — records the seven findings as they were first
  observed, kept unaltered as the record of that verification. All of them have since been fixed.
* **`reports/PDF_MANUAL_QA_REPORT.md`** — what was checked in the finished PDFs, and the decision
  SACCO management still needs to make before circulating them.

## Regenerating the PDFs

The manuals are built from HTML, rendered through Chromium's own print engine — the same mechanism
the application uses for statements and receipts. Nothing else is needed: no LaTeX, no Word, no PDF
library.

```bash
# Requires: node + the repository's devDependencies (Playwright), and python3 with pymupdf + pillow
npm install
pip install pymupdf pillow

python3 documentation/source/build_manual.py member_manual \
        /tmp/member.html documentation/manuals/BAKENYE_SACCO_MEMBER_USER_MANUAL.pdf \
        "Bakenye SACCO · Member User Guide"

python3 documentation/source/build_manual.py staff_manual \
        /tmp/staff.html documentation/manuals/BAKENYE_SACCO_STAFF_ADMIN_MANUAL.pdf \
        "Bakenye SACCO · Staff & Administrator Manual"
```

`build_manual.py` renders once to find where each section falls, writes the contents page with the
real page numbers, renders again, then stamps the running footers and the PDF bookmarks. Run it
again after any edit — the page numbers look after themselves.

If Chromium is somewhere other than `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`, set
`CHROME_PATH`.

### Editing the text

| File | What it holds |
| --- | --- |
| `source/member_manual.py` | Every word of the member manual |
| `source/staff_manual_part1.py` | Every word of the staff manual |
| `source/staff_manual.py` | Assembles the staff manual |
| `source/common.py` | Cover, figures, tables, steps and notes; `PRINT_DPI` controls the file size |
| `source/manual.css` | The whole design: A4 page, type, colours, tables, figures, note panels |

Sections are plain Python strings of HTML. Add one with `sec('Title', '''…''')`; the numbering, the
contents page and the bookmarks all follow automatically.

### Checking the result

```bash
python3 documentation/source/qa.py documentation/manuals/BAKENYE_SACCO_MEMBER_USER_MANUAL.pdf
```

Reports blank pages, sparse pages, anything outside the margins, unresolved placeholders and text
too small to read.

## Re-capturing the screenshots

The screenshots are photographs of the real application driven through a browser. To retake them you
need the application running against a database you are willing to change — **never the SACCO's live
system**. `reports/DOCUMENTATION_VERIFICATION_REPORT.md` §1 describes the isolated environment that
was used.

```bash
# every route, as one role
ROUTE_FILE=routes.json FOLDER=staff ID=<phone or member no> PW=<password> \
  node documentation/source/walk.mjs

# a whole workflow, step by step
ID=<phone> PW=<password> node documentation/source/workflow-collection.mjs
```

The scripts in `source/` cover sign-in, member registration, savings collection, the loan lifecycle,
share sales, expenses and their approval, reconciliation, and the report print views. Each one drives
the real application exactly as a person would.

After capturing, shrink the images and rebuild the catalogue:

```bash
python3 documentation/source/make-notes.py        # descriptions from the capture logs
python3 documentation/source/build-inventory.py   # rewrites SCREENSHOT_INVENTORY.md
```

## Rules these manuals were written under

1. Nothing is described unless it was seen working in the running application.
2. Where the system only *records* something a person did elsewhere — every payment — the manuals
   say so plainly. There is no payment-provider integration.
3. Role restrictions are stated on every workflow.
4. No interest rate, fee, deadline or category amount is quoted as SACCO policy. The manuals show
   where each is configured and treat the demonstration values as examples.
5. No real member data. Every name, number and amount is invented.
