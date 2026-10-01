# Search engines and the public site

**Domain:** `https://bakenye-sacco.online`

This is a SACCO management system. Almost all of it is private, and the whole
point of this setup is that it stays that way: Google should rank the SACCO's
public page and nothing else. Member savings, shares, loans, guarantees,
receipts, statements, reports and every staff screen stay outside search
entirely.

---

## What is public, and what is not

| Address | Who sees it | In Google |
| --- | --- | --- |
| `/` (signed out) | anyone | **yes** — the landing page |
| `/help` | anyone | **yes** — how to sign in |
| `/` (signed in) | the member or staff member | no |
| `/login`, `/forgot-password`, `/reset-password`, `/change-password` | anyone | no |
| `/savings`, `/shares`, `/loans`, `/guarantees`, `/transactions`, `/statements`, `/reports`, `/profile`, `/notifications`, `/more` | the member, after signing in | no |
| everything under `/staff/` and `/admin/` | staff, by role permission | no |

`/` is the only address that serves two different pages. A visitor with no
session is shown the public landing page; a member who has signed in is shown
their dashboard. A crawler is never signed in, so the only thing Google can
fetch from `/` is the landing page.

### Three independent layers keep the private half private

1. **Authentication.** Every private route redirects to `/login` without a
   session, and the data behind it is protected by row-level security and
   permission checks in the database. This is the only one of the three that is
   a security boundary.
2. **`X-Robots-Tag: noindex, nofollow, noarchive`**, set by the middleware on
   every response that is not one of the three indexable paths — including the
   redirect to `/login`, because a redirect is itself a crawlable URL.
3. **`robots.txt`**, which asks crawlers not to spend their budget there.

`robots.txt` is a request, not a lock. It is the third layer for a reason.

---

## Configuration

Two environment variables, both set where the application is deployed
(Vercel → Project → Settings → Environment Variables):

| Variable | Value in production | Effect |
| --- | --- | --- |
| `NEXT_PUBLIC_SITE_URL` | `https://bakenye-sacco.online` | the canonical URL on every page, the base of the sitemap, and the origin of password-reset links |
| `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION` | the token from Search Console | renders the `google-site-verification` meta tag |

Both are build-time variables. **After changing either, redeploy** — they are
compiled into the pages and will not take effect until the next build.

Leave `NEXT_PUBLIC_SITE_URL` unset on preview deployments. Without it the build
knows it is not production, and then `robots.txt` blocks everything and the
sitemap is empty, so a preview URL cannot compete with the real site in search
results for the SACCO's own name.

---

## Google Search Console — the checklist

1. **Add the property.** <https://search.google.com/search-console> → *Add
   property* → **URL prefix** → `https://bakenye-sacco.online`.
   (A *Domain* property works too, and is verified by DNS instead of step 2.)
2. **Verify.** Choose **HTML tag**. Google shows
   `<meta name="google-site-verification" content="XXXXXXXX" />`.
   Copy **only the `content` value**.
3. Set `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION` to that value in the deployment's
   environment variables, and **redeploy**.
4. Confirm the tag is live: open `https://bakenye-sacco.online`, view source,
   and search for `google-site-verification`.
5. Back in Search Console, press **Verify**.
6. **Submit the sitemap.** *Sitemaps* → enter `sitemap.xml` → *Submit*. It
   should be read as containing **2 URLs**.
7. **Request indexing of the homepage.** *URL Inspection* → paste
   `https://bakenye-sacco.online/` → *Request indexing*.
8. **Confirm the private half is excluded.** *URL Inspection* →
   `https://bakenye-sacco.online/staff/desk` → it should report that the URL is
   **not available to Google** / excluded by `noindex`. Do the same for
   `https://bakenye-sacco.online/savings`.
9. **Set the preferred domain.** If both `bakenye-sacco.online` and
   `www.bakenye-sacco.online` resolve, make one redirect to the other at the DNS
   or hosting level. The canonical tag already names the non-`www` form.
10. **Check back after a week.** *Pages* → the report should show 2 indexed
    pages and a list of pages "Excluded by 'noindex' tag". That second list
    being long is the system working correctly, not a fault.

Indexing takes days to weeks. Nothing in steps 1–9 makes it instant.

---

## What is deliberately absent

The landing page and its structured data contain **no** postal address, branch
list, founding date, membership figure, rating, review, social-media link,
regulatory or licensing claim, and no superlative ("largest", "best",
"guaranteed"). None of those is recorded anywhere in this project. Inventing
them would be a lie that outlives whoever wrote it, and Google penalises
fabricated structured data.

Contact details appear only when the SACCO has actually published them in
**Settings → Organisation**; until then the page simply omits them, and the
`contactPoint` is omitted from the structured data too. Filling those two
fields in is the single highest-value SEO improvement still available, and it
needs no code change.

---

## Verifying it

```bash
npm run build
npx next start -p 3000

BASE_URL=http://127.0.0.1:3000 \
SITE_URL=https://bakenye-sacco.online \
node scripts/seo-check.mjs
```

The script checks both halves: that the public pages really are indexable, with
a canonical address on the SACCO's own domain and no invented claims in their
structured data, and that every private route is behind the login *and* served
`noindex` in its headers. Add `SEO_MEMBER_ID` and `SEO_MEMBER_PASSWORD` to also
confirm, in a real browser, that a signed-in member still gets their dashboard
at `/` rather than the public page.

The build must be made with the same `NEXT_PUBLIC_SITE_URL` the script is given;
these are build-time values.
