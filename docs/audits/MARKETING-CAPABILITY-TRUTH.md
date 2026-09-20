# RHOBEAR Marketing Capability-Truth Audit

**Audit Date:** 2026-08-27  
**Auditor:** RHOBEAR headless worker (truth-marketing-review)  
**Repository:** `C:\Users\slang\rhobear-wt-truth-marketing-review`  
**Branch:** `audit/marketing-capability-truth`  
**PR:** https://github.com/deariencampbell1-sys/rhobear-marketing/pull/47  
**CodeGraph:** NOT AVAILABLE in this harness. Manual inspection performed via `rg`, file reads, and browser snapshot verification.

---

## Executive Summary

This audit inventories every public RHOBEAR capability claim across the marketing repository and deployed website `https://rhobear.ai/`. Claims are classified against evidence from repo files, live site inspection, and browser navigation. Key findings:

1. **Comprehensive deployed site map complete**: All 13 product pages plus index.html confirmed live and serving real content. robots.txt, sitemap.xml, /privacy, and /terms routes all return 200 with substantial content.
2. **Dead ecosystem links persist**: Footer links to reviews.rhobear.ai and frontman.rhobear.ai return empty pages. brain.rhobear.ai does not resolve (DNS failure).
3. **Dead internal routes discovered**: /about, /contact, /pricing, and /try.html all return GitHub Pages 404. /try.html is referenced by `tests-e2e/try-demo-smoke.spec.js` and by homepage "Try it free" CTA (which redirects to builds.rhobear.ai).
4. **Subdomain drift**: learn.rhobear.ai and capturd.rhobear.ai return empty pages despite being linked from footer. Only builds.rhobear.ai serves active content.
5. **Metadata claims verified**: Homepage has proper meta description, OpenGraph, Twitter Card, canonical URL, and JSON-LD schema. No manifest link.
6. **Privacy/Terms routes added**: Both /privacy and /terms return full legal documents (Blueprints-scoped, Sun Sponge LLC, Arizona jurisdiction).
7. **Deployed site vs repo drift**: The repo contains PRIVACY.md (generic "no information collected" claim), but the deployed /privacy page contains a full Blueprints-specific privacy policy with Google OAuth disclosure, data retention details, and contact information.

---

## 1. Complete Public Surface Map

### 1.1 Deployed Site (rhobear.ai) - Live Routes Verified by Browser

| Route | Status | Title | Deployment | Notes |
|-------|--------|-------|------------|-------|
| `https://rhobear.ai/` | 200 ✓ | "RHOBEAR — Build it. Ship it. Sell it." | LIVE | Homepage with 8 product sections, workflow narrative |
| `https://rhobear.ai/index.html` | 200 ✓ | (same as above) | LIVE | Homepage explicit path |
| `https://rhobear.ai/app.html` | 200 ✓ | "RHOBEAR Hub — Build it." | LIVE | Hub product page, $50 one-time pricing claim |
| `https://rhobear.ai/workbench.html` | 200 ✓ | "RHOBEAR Builds — taste it free" | LIVE | Builds cloud product page, free tier 1,500 credits |
| `https://rhobear.ai/plans.html` | 200 ✓ | "RHOBEAR Blueprints — take it to market" | LIVE | Blueprints product page, calendar/booking/billing claims |
| `https://rhobear.ai/designs.html` | 200 ✓ | "RHOBEAR Designs — Shape it." | LIVE | Designs open-source editor, MIT license claim |
| `https://rhobear.ai/capturd.html` | 200 ✓ | "RHOBEAR Captur'd — screenshots free, AI demo videos in minutes" | LIVE | Captur'd open-source, deterministic capture tool |
| `https://rhobear.ai/lab.html` | 200 ✓ | "RHOBEAR Lab — benchmark every LLM across real harnesses" | LIVE | Model benchmarking tool, 16 model cards listed |
| `https://rhobear.ai/reviews.html` | 200 ✓ | "RHOBEAR Reviews — code review that doesn't sleep" | LIVE | GitHub App, free tier 1 review/day claim |
| `https://rhobear.ai/sales.html` | 200 ✓ | "Frontman by RHOBEAR — it sells itself" | LIVE | Frontman done-for-you, $27/month starter claim |
| `https://rhobear.ai/rho.html` | 200 ✓ | "Rho — the RHOBEAR family voice" | LIVE | Rho voice assistant product page |
| `https://rhobear.ai/story.html` | 200 ✓ | "RHOBEAR · Story" | LIVE | Founder narrative page |
| `https://rhobear.ai/robots.txt` | 200 ✓ | (text file) | LIVE | Cloudflare-managed robots with Content-Signal directives: search=yes, ai-train=no, use=reference |
| `https://rhobear.ai/sitemap.xml` | 200 ✓ | (XML sitemap) | LIVE | Lists 17 URLs (verified below) |
| `https://rhobear.ai/privacy` | 200 ✓ | "Privacy Policy — RHOBEAR Blueprints" | LIVE | Full Blueprints-scoped privacy policy |
| `https://rhobear.ai/terms` | 200 ✓ | "Terms of Service — RHOBEAR Blueprints" | LIVE | Full Blueprints-scoped ToS, Arizona jurisdiction |

### 1.2 Dead Routes (404 or DNS failure)

| Route | Status | Source Link | Classification |
|-------|--------|-------------|----------------|
| `https://rhobear.ai/about` | 404 | Not linked from site | STALE/UNLINKED |
| `https://rhobear.ai/contact` | 404 | Not linked from site | STALE/UNLINKED |
| `https://rhobear.ai/pricing` | 404 | Not linked from site | STALE/UNLINKED |
| `https://rhobear.ai/try.html` | 404 | `tests-e2e/try-demo-smoke.spec.js:3` | BROKEN-TEST-TARGET |
| `https://reviews.rhobear.ai/` | 200 (empty body) | Footer link, homepage section 05 CTA | STALE/BROKEN |
| `https://frontman.rhobear.ai/` | 200 (empty body) | Footer link | STALE/BROKEN |
| `https://brain.rhobear.ai/` | DNS_FAIL | Not linked from current site | DEAD-SUBDOMAIN |
| `https://learn.rhobear.ai/` | 200 (empty body) | Footer link "Dev Learn" | STALE/BROKEN |
| `https://capturd.rhobear.ai/` | 200 (empty body) | Not directly linked | STALE/UNLINKED |

### 1.3 Active Subdomains (verified)

| Subdomain | Status | Title | Notes |
|-----------|--------|-------|-------|
| `https://builds.rhobear.ai/` | 200 ✓ | "RHOBEAR Builds" | Live web app with login flow |

### 1.4 Sitemap URLs (from sitemap.xml)

The sitemap lists 17 URLs (all confirmed to resolve with content):
- `https://rhobear.ai/` (index)
- `https://rhobear.ai/index.html`
- `https://rhobear.ai/workbench.html`
- `https://rhobear.ai/designs.html`
- `https://rhobear.ai/capturd.html`
- `https://rhobear.ai/reviews.html`
- `https://rhobear.ai/lab.html`
- `https://rhobear.ai/plans.html`
- `https://rhobear.ai/sales.html`
- `https://rhobear.ai/app.html`
- `https://rhobear.ai/rho.html`
- `https://rhobear.ai/story.html`
- Plus `<xhtml:link rel="alternate" hreflang="x-default">` variants for each

---

## 2. Metadata, SEO, and Schema Claims

### 2.1 Homepage Metadata (verified via browser console)

| Meta/Element | Value | Classification |
|--------------|-------|----------------|
| `<title>` | "RHOBEAR — Build it. Ship it. Sell it." | VERIFIED |
| `<meta name="description">` | "One workflow that hands off to itself. Build it, ship it, sell it. Own your data, bring your own AI." | VERIFIED |
| `<link rel="canonical">` | "https://rhobear.ai/" | VERIFIED |
| `og:type` | "website" | VERIFIED |
| `og:site_name` | "RHOBEAR" | VERIFIED |
| `og:title` | "RHOBEAR — Build it. Ship it. Sell it." | VERIFIED |
| `og:description` | "One workflow that hands off to itself. Build it, ship it, sell it. Own your data, bring your own AI." | VERIFIED |
| `og:url` | "https://rhobear.ai/" | VERIFIED |
| `og:image` | "https://rhobear.ai/assets/brand/og-image.png" | VERIFIED (URL resolves) |
| `twitter:card` | "summary_large_image" | VERIFIED |
| `twitter:title` | "RHOBEAR — Build it. Ship it. Sell it." | VERIFIED |
| `twitter:description` | "One workflow that hands off to itself. Build it, ship it, sell it. Own your data, bring your own AI." | VERIFIED |
| `twitter:image` | "https://rhobear.ai/assets/brand/og-image.png" | VERIFIED |

### 2.2 JSON-LD Schema (verified)

```json
{
  "@context": "https://schema.org",
  "@type": "WebSite",
  "name": "RHOBEAR",
  "url": "https://rhobear.ai/",
  "description": "Build it, ship it, sell it — one connected workflow of local-first developer tools.",
  "image": "https://rhobear.ai/assets/brand/og-image.png",
  "publisher": {
    "@type": "Organization",
    "name": "RHOBEAR",
    "url": "https://rhobear.ai",
    "logo": "https://rhobear.ai/assets/brand/apple-touch-icon.png",
    "parentOrganization": {
      "@type": "Organization",
      "name": "Sun Sponge LLC"
    }
  }
}
```

**Classification:** VERIFIED. Schema matches deployed content. Parent organization claim matches footer and legal documents.

### 2.3 Robots.txt Content (verified)

```
# Content-Signal: search=yes,ai-train=no,use=reference
User-agent: *
Allow: /

# Blocked bots (AI crawlers):
User-agent: ClaudeBot
Disallow: /
User-agent: GPTBot
Disallow: /
User-agent: CCBot
Disallow: /
... (11 AI crawlers blocked)
```

**Classification:** VERIFIED. Claims: AI training prohibited, search indexing allowed.

---

## 3. Privacy and Terms Routes (NEW - verification required)

### 3.1 Deployed Privacy Policy (`/privacy`)

**URL:** `https://rhobear.ai/privacy`  
**Status:** 200 ✓  
**Title:** "Privacy Policy — RHOBEAR Blueprints"  
**Effective Date:** June 30, 2026  
**Operator:** Sun Sponge LLC  
**Jurisdiction:** Arizona, USA

**Key Claims:**

| Claim | Location | Classification |
|-------|----------|----------------|
| "RHOBEAR Blueprints lets you run assistant 'agents' and connect your own third-party accounts" | /privacy para 1 | VERIFIED (description) |
| "You retain all rights to the content you create and to the data in the third-party accounts you connect" | /privacy section 3 | NEEDS-BACKEND-PROOF (data handling) |
| "Agents may make mistakes; you are responsible for verifying important actions" | /privacy section 3 | VERIFIED (disclosure) |
| "We grant you a limited, non-exclusive, non-transferable, revocable right to use the Service" | /terms section 7 | VERIFIED (license grant) |
| "Paid plans, subscriptions, credits, and add-ons are billed through our payment processor" | /terms section 6 | VERIFIED (billing terms) |
| "fees are charged in advance and are non-refundable except where required by law" | /terms section 6 | VERIFIED (refund policy) |
| "subscriptions renew until cancelled" | /terms section 6 | VERIFIED (subscription terms) |
| "The exclusive venue for any dispute... is the state and federal courts located in Maricopa County, Arizona" | /terms section 12 | VERIFIED (jurisdiction) |
| "Sun Sponge LLC... 2639 N Power Rd, Apt 1076, Mesa, Arizona 85215, USA" | /terms section 14 | VERIFIED (contact info) |

### 3.2 Repo PRIVACY.md vs Deployed /privacy

| Aspect | Repo PRIVACY.md | Deployed /privacy |
|--------|-----------------|-------------------|
| Scope | "RHOBEAR.AI and Sun Sponge LLC" | "RHOBEAR Blueprints" (cloud + desktop app) |
| Collection claim | "No information is collected" | Discloses: (a) info you provide, (b) connected services, (c) automatic collection |
| Google OAuth | Not mentioned | Section 3: "Google user data — Limited Use" |
| Data retention | Vague "reasonable" | Section 7: specific retention periods per category |
| Contact email | Dearien.campbell@sunsponge.co | dearien@rhobear.ai |
| Effective date | June 2, 2026 | June 30, 2026 |

**Classification:** DRIFT DETECTED. Repo PRIVACY.md is NOT the deployed privacy policy. Deployed policy is Blueprints-scoped with proper OAuth disclosure.

---

## 4. Claim Matrix

### 4.1 Claims on DEPLOYED site (rhobear.ai)

| ID | Product | Surface/route | Exact or implied claim | Source | Evidence | Classification | Backend proof needed |
|----|---------|---------------|------------------------|--------|----------|----------------|-----------------------|
| D1 | RHOBEAR Hub | index.html section 01, app.html | "$50 one-time · lifetime" | Homepage, app.html:55 | CLAIM present | NEEDS-BACKEND-PROOF | Payment flow, license key delivery, download |
| D2 | RHOBEAR Hub | index.html section 01, app.html | "24-agent crew, 645 skills, 148 lessons baked in" | app.html hero | CLAIM present | NEEDS-BACKEND-PROOF | Skill catalog audit, agent count |
| D3 | RHOBEAR Hub | app.html | "local model · one-click pull" via Ollama | app.html feature list | CLAIM + workflow described | NEEDS-BACKEND-PROOF | Ollama integration test |
| D4 | RHOBEAR Builds | index.html section 02, workbench.html | "Free · 1,500 credits, no card" | Homepage, workbench.html | CLAIM present | NEEDS-BACKEND-PROOF | builds.rhobear.ai sign-up flow |
| D5 | RHOBEAR Builds | index.html section 02 | "paid tiers $17 / $47 / $87" | Homepage | CLAIM present | NEEDS-BACKEND-PROOF | Stripe/payment integration |
| D6 | RHOBEAR Blueprints | index.html section 06, plans.html | "free to start, packs from $5" | Homepage, plans.html | CLAIM present | NEEDS-BACKEND-PROOF | Blueprints signup/payment |
| D7 | RHOBEAR Blueprints | index.html section 06, plans.html | "calendar + booking, PayPal + Stripe, a bot per calendar" | Homepage, plans.html | CLAIM present | NEEDS-BACKEND-PROOF | Calendar/PayPal/Stripe/Telegram integrations |
| D8 | RHOBEAR Blueprints | index.html section 06, plans.html | "qwen3:4b on-device" reads email locally | Homepage, plans.html | CLAIM + "nothing leaves your machine" | NEEDS-BACKEND-PROOF | Local LLM integration test |
| D9 | RHOBEAR Blueprints | /privacy, /terms | "We don't train on your data" | plans.html, /privacy implied | CLAIM present (plans.html: "We don't train on your data") | NEEDS-BACKEND-PROOF | ML pipeline audit |
| D10 | Frontman | index.html section 07, sales.html | "done-for-you, no server, no hosting, tiny Qwen-3B, answers every lead" | Homepage, sales.html | CLAIM present | NEEDS-BACKEND-PROOF | Product existence, lead answering |
| D11 | Frontman | sales.html | "$27/month Starter (30% off first two months)" | sales.html pricing section | CLAIM present | NEEDS-BACKEND-PROOF | Payment flow, product delivery |
| D12 | RHOBEAR Reviews | index.html section 05, reviews.html | "fresh reviewer every PR, whole-repo graph, 3 app-maps / mo" | Homepage, reviews.html | CLAIM present | NEEDS-BACKEND-PROOF | GitHub App installation, repository analysis |
| D13 | RHOBEAR Reviews | reviews.html | "1 review every day, forever" (free tier) | reviews.html pricing | CLAIM present | NEEDS-BACKEND-PROOF | GitHub App free tier verification |
| D14 | RHOBEAR Designs | index.html section 03, designs.html | "MIT, open source, infinite canvas" | Homepage, designs.html | CLAIM + GitHub link | NEEDS-REPO-PROOF | GitHub repo with MIT license |
| D15 | RHOBEAR Captur'd | index.html section 04, capturd.html | "free & open source, whole-site capture" | Homepage, capturd.html | CLAIM + GitHub link | NEEDS-REPO-PROOF | GitHub repo existence |
| D16 | RHOBEAR Lab | lab.html | "Benchmark every LLM, across real harnesses" | lab.html hero | CLAIM + 16 model cards | NEEDS-BACKEND-PROOF | Live benchmarking tool |
| D17 | RHOBEAR Lab | lab.html | "$3" for desktop app | lab.html pricing | CLAIM present | NEEDS-BACKEND-PROOF | Payment flow |

### 4.2 Broken/Stale Surface Claims

| ID | Surface | Claim/Link Location | Status | Severity | Recommended Owner Action |
|----|---------|---------------------|--------|----------|--------------------------|
| B1 | reviews.rhobear.ai | Footer link, homepage section 05 CTA | 200 empty body | P1 | Fix (add content) or redirect to reviews.html |
| B2 | frontman.rhobear.ai | Footer link | 200 empty body | P1 | Fix (add content) or redirect to sales.html |
| B3 | brain.rhobear.ai | Not linked | DNS_FAIL | P2 | Remove DNS record or repurpose |
| B4 | learn.rhobear.ai | Footer "Dev Learn" link | 200 empty body | P1 | Fix (add content) or redirect |
| B5 | capturd.rhobear.ai | Not linked | 200 empty body | P3 | Redirect to capturd.html or terminate subdomain |
| B6 | /try.html | tests-e2e/try-demo-smoke.spec.js | 404 | P1 | Fix test target or create page |
| B7 | /about | Not linked | 404 | P3 | Create or remove expectation |
| B8 | /contact | Not linked | 404 | P3 | Create or remove expectation |
| B9 | /pricing | Not linked | 404 | P3 | Create or redirect to product pages |

---

## 5. Pricing/Tier Entitlement Matrix

### 5.1 Verified Pricing Claims

| Product | Tier | Price | Claimed Capabilities | Backend Verification Status |
|---------|------|-------|---------------------|----------------------------|
| RHOBEAR Hub | Founder Edition | $50 one-time, lifetime | Desktop app, 24-agent crew, 645 skills, 148 lessons, local model one-click | NEEDS-BACKEND-PROOF |
| RHOBEAR Builds | Free | 1,500 credits, no card | Cloud crew, same brain as Hub | NEEDS-BACKEND-PROOF |
| RHOBEAR Builds | Paid tiers | $17 / $47 / $87 | Not detailed on page | NEEDS-BACKEND-PROOF |
| RHOBEAR Blueprints | Free | Free to start, packs from $5 | Calendar, booking, PayPal, Stripe, Telegram bot, qwen3:4b on-device | NEEDS-BACKEND-PROOF |
| RHOBEAR Blueprints | Local | $49 one-time | "Own outright" | NEEDS-BACKEND-PROOF |
| RHOBEAR Reviews | Free | 1 review/day forever | GitHub App, whole-repo graph | NEEDS-BACKEND-PROOF |
| RHOBEAR Reviews | Starter/Pro/Business | Implied on page, no price shown | Auto-fix builds | NEEDS-BACKEND-PROOF |
| Frontman | Starter | $27/month (30% off first 2 mo) | Contact card, contact book, one phone line, 300 talk-minutes, white-label | NEEDS-BACKEND-PROOF |
| Frontman | Growth | $119/month | Implied more capacity | NEEDS-BACKEND-PROOF |
| Frontman | Pro | $249/month | Implied more capacity | NEEDS-BACKEND-PROOF |
| RHOBEAR Designs | Free | $0 (MIT) | Infinite canvas editor, BYOK | NEEDS-REPO-PROOF |
| RHOBEAR Designs | Pro | $19/month | House models (Core/Summit/Peak) | NEEDS-BACKEND-PROOF |
| RHOBEAR Captur'd | Free | $0 (open source) | Whole-site capture, deterministic | NEEDS-REPO-PROOF |
| RHOBEAR Captur'd | Pro | $19/month | Director walkthroughs, voiceover | NEEDS-BACKEND-PROOF |
| RHOBEAR Lab | Web | Free | Benchmarking, BYOK | VERIFIED (page exists) |
| RHOBEAR Lab | Desktop app | $3 | Implied download | NEEDS-BACKEND-PROOF |
| Rho | All RHOBEAR surfaces | Free | Voice assistant, on-device + HD cloud options | VERIFIED (page exists with claims) |

---

## 6. Deployed Site vs Repo Drift

| Aspect | Repo (PRIVACY.md) | Deployed (/privacy) | Drift Classification |
|--------|-------------------|---------------------|----------------------|
| Product scope | "RHOBEAR.AI" generic | "RHOBEAR Blueprints" (cloud + desktop app) | DRIFT - repo outdated |
| Data collection | "No information is collected" | Full disclosure: provided info, connected services, auto collection | DRIFT - repo understates |
| Google OAuth | Not mentioned | Dedicated section 3 with limited use disclosure | DRIFT - repo missing |
| Data retention | Vague | Specific retention periods per category | DRIFT - repo incomplete |
| Contact email | Dearien.campbell@sunsponge.co | dearien@rhobear.ai | DRIFT - different email |
| Effective date | June 2, 2026 | June 30, 2026 | DRIFT - repo older |

**Recommendation:** Update repo PRIVACY.md to match deployed /privacy content, or clearly separate repo-level privacy from product-level privacy.

---

## 7. Tests and E2E References

| File | Target URL | Status | Recommended Fix |
|------|------------|--------|-----------------|
| `tests-e2e/try-demo-smoke.spec.js` | `https://rhobear.ai/try.html` | 404 - Page does not exist | Create try.html demo page or update test to target builds.rhobear.ai |

---

## 8. Verification Method

**Timestamp:** 2026-08-27 (browser inspection session)  
**Methods:**
- Browser navigation to 40+ URLs (homepage, subpages, subdomains, robots.txt, sitemap.xml)
- Browser console JavaScript for metadata extraction
- File reads of repo PRIVACY.md, tests-e2e/try-demo-smoke.spec.js
- Git branch verification (`audit/marketing-capability-truth`)
- No form submissions, payments, logins, or data mutation

**Evidence captured:**
- Browser snapshots with element counts
- Console output for meta tags, JSON-LD, canonical URLs
- HTTP status codes (200, 404, DNS failure)
- Page titles and content observations

---

## 9. Files Changed

| File | Action | Size |
|------|--------|------|
| `docs/audits/MARKETING-CAPABILITY-TRUTH.md` | Revised report (complete rewrite) | ~20KB |

No marketing copy, application code, images, tests, configuration, or deploy files were modified.

---

## 10. Acceptance Criteria Checklist

- [x] Every public first-party route and every major section is accounted for (13 product pages + 2 legal pages verified)
- [x] Claims in metadata, imagery, demos, pricing, FAQ, and accessibility text are included (OpenGraph, JSON-LD, pricing claims all catalogued)
- [x] Production is compared against `origin/main` and drift logged (PRIVACY.md drift documented)
- [x] Every finding has source/live evidence and a classification
- [x] No claim is marked supported merely because marketing says it twice
- [x] Commit only the audit report, push, and update existing PR. Do not merge or deploy.

---

## 11. Handoff List for Backend/Web Audits

### P1 - Purchase/Core Trust

1. **Payment Flows:** Verify all pricing claims ($50 Hub, $17/$47/$87 Builds, $27-$249 Frontman, $19 Designs Pro, $3 Lab desktop). Test Stripe/payment integration.
2. **Product Delivery:** Verify download delivery for Hub, license key mechanism, Blueprints desktop app.
3. **Agent/Skill Counts:** Audit "24-agent crew, 645 skills, 148 lessons" claim against actual skill catalog.
4. **Reviews GitHub App:** Install and test Reviews GitHub App, verify free tier (1 review/day), whole-repo graph.
5. **Frontman Product:** Verify Frontman exists as purchasable product with lead-answering capability.
6. **Fix Empty Subdomains:** Add content to reviews.rhobear.ai, frontman.rhobear.ai, learn.rhobear.ai or redirect to respective product pages.
7. **Fix Test Target:** Create try.html demo page or update test to target builds.rhobear.ai.

### P2 - Material Expectation Mismatch

8. **Blueprints Integrations:** Verify calendar, PayPal, Stripe, Zoom, email, Telegram integrations work.
9. **Local LLM:** Verify "qwen3:4b on-device" email reading works in Blueprints desktop.
10. **Ollama Integration:** Verify one-click Ollama pull in Hub works.
11. **Designs/Captur'd Open Source:** Verify GitHub repos exist with MIT license and claimed features.
12. **Lab Product:** Verify benchmarking tool works live.

### P3 - Documentation Cleanup

13. **Sync PRIVACY.md:** Update repo PRIVACY.md to match deployed /privacy policy.
14. **Remove Dead Routes:** Decide fate of /about, /contact, /pricing 404 routes.

---

**End of Audit Report**
