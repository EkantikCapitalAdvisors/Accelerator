# Subscription-Rewrite Mockup

These files preview the v1.1 spec rewrite of the accelerator landing pages.
**They live on the `subscription-rewrite` branch only and are not deployed to
the live site.** No merge to `main` until counsel review.

## Files in this directory

| File | What it shows |
|---|---|
| `active-futures.html` | Mockup of the Active Futures landing page (the main `/` URL after merge), all six spec sections + the hybrid "architecture behind the alerts" band. Block 1 footer + Block 2 header notice deployed verbatim. Block 3 "How We Operate" as §E. Block 4 acknowledgments on the §F signup form. Block 8 dashboard notice. |
| `mockup.css` | Mockup-only styles overlaying production tokens/components. Strip before any production merge. |
| `README.md` | This file. |

To follow next on this branch: `convexity-active.html` (Convexity Experiment
landing rewrite) and `onboarding.html` / `convexity-onboarding.html`
(Appendices A1 and A2 verbatim).

## How to review

**Option 1 — clone the branch locally:**
```
git fetch origin subscription-rewrite
git checkout subscription-rewrite
open mockup/active-futures.html       # macOS
# or just double-click the file
```

**Option 2 — htmlpreview.github.io:**
Paste the file's GitHub URL into <https://htmlpreview.github.io/> after the
branch is pushed. Some CSS may render imperfectly because of the relative
imports of `../css/tokens.css` etc.; the visual hierarchy still comes through.

**Option 3 — temporary GitHub Pages preview:**
If we want a real preview URL without merging to main, configure a
`gh-pages-preview` source or stand up a Cloudflare Pages preview against
this branch. Out of scope for this commit; ask if you want it set up.

## What to look for

A few load-bearing elements worth scrutinizing first:

1. **The hero (§A)** — does "Active Futures. Alerts You Can Execute
   Automatically — Without Ever Handing Over Your Account." land right? Does
   the three-badge strip read as the right value proposition?
2. **The hybrid architecture-proof band** — sits between §D (dashboard) and
   §E (How We Operate). It links the doubling doctrine + Falsifiability Gate
   + attribution discipline + buffer ladder back into the page as the
   "architecture behind the alerts." If this feels buried or feels too
   prominent, that's the dial to turn.
3. **TRUTHFULNESS-FLAG markers** — every place the spec calls for "prop firm
   accounts" language but no prop-firm relationship exists yet. Search for
   `TRUTHFULNESS-FLAG` in the HTML. Current behavior: render an honest
   intermediate phrase (e.g. "the live trading accounts publishing the model
   portfolio") and flag for counsel review.
4. **The Block 4 signup acknowledgments (§F)** — six required, none
   pre-checked, all individually checked. The form does not submit in the
   mockup (no Formspree endpoint wired here).
5. **§E "How We Operate"** — Block 3 verbatim. Verify it reads as editorial
   rather than as legalese.

## What's intentionally NOT in this mockup yet

| Item | Why |
|---|---|
| Convexity Experiment landing (§3.7) | Next mockup. Will mirror the Active Futures structure with the convex-specific deltas. |
| `/onboarding` and `/convexity-onboarding.html` web pages + PDFs (Appendices A1, A2) | Next mockups. Content from spec is verbatim; web page treatment + PDF generation in the next pass. |
| Discord welcome messages (Block 5a/5b), email footer (Block 6), confirmation emails (Block 7a/7b) | Out of scope for the page-build mockup; will be drafted as separate markdown artifacts when we move to email-template work. |
| Real Formspree endpoint, real pricing tiers, TradersPost affiliate link | Pending operator confirmation (per spec §0.7). |
| Counsel sign-off | Required before any merge to `main`. |

## Mockup ribbon

Every mockup page renders a sticky green ribbon at the top:

> **MOCKUP · subscription rewrite** · This file is on `subscription-rewrite` branch only. Counsel review required before public deployment. Items marked **TRUTHFULNESS-FLAG** use intermediate language pending real prop-firm relationship.

That ribbon is removed before any production merge.
