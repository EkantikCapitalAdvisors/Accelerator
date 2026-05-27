# Subscription-Publisher Rewrite — Build Plan

**Branch:** `subscription-rewrite` (off `main` at `78156e3`)
**Source spec:** ACC-LP-V1.1 (Accelerator Landing Page Specification, v1.1)
**Counsel review required before any public deployment.** No commits from this
branch are to be merged into `main` until counsel signs off on the deployed
compliance language.

---

## 0 · Decisions locked at kickoff

| Decision | Choice |
|---|---|
| Positioning | **Hybrid** — subscription publisher on top, doubling-doctrine + falsifiability + attribution architecture preserved as the "architecture behind the alerts" proof beneath the subscription hero. |
| Existing parser/dashboard infra | **None separate.** Spec misdescribes a parallel system; we work with the in-repo pipeline (`tenx_trades.json` → render). |
| Build mode | **Branch-only.** Build the full spec on `subscription-rewrite`; never push to `main` until counsel review is complete. |

---

## 1 · Open compliance / truthfulness concern

**The spec's "prop firm accounts" framing is not yet truthful.** Current fills
in `tenx_trades.json` are from the operator's personal account. Deploying
language that says "our live trading accounts — including the prop firm
accounts where we execute the model portfolio" would be a misstatement of
fact today, which is worse than the existing operator-capital framing.

**Options pending Hiren / counsel:**

- **(a)** Hold the "prop firm" wording until a real prop-firm relationship
  is in place and routing actual fills. Until then, use a truthful
  intermediate: e.g. *"the live trading accounts publishing the model
  portfolio"* without specifying prop vs retail.
- **(b)** Establish the prop-firm relationship and a fill feed first, then
  deploy the spec's verbatim language.
- **(c)** Counsel rules on the intermediate phrasing.

Default behavior on this branch: **option (a)**. Every spec instance of
"prop firm" carries a `<!-- TRUTHFULNESS-FLAG -->` comment so counsel /
Hiren can review before merge.

---

## 2 · Phased build plan (estimated 3 weeks per spec)

### Phase 1 · Compliance language scaffolding (foundation for everything else)
- [ ] Block 1 — Master site disclaimer (footer partial)
- [ ] Block 2 — Site header notice (under nav)
- [ ] Block 3 — "How We Operate" editorial block (About page + landing §E)
- [ ] Block 4 — Six (or seven) sign-up acknowledgments (form component)
- [ ] Block 5a/5b — Discord pinned welcome variants (markdown artifacts)
- [ ] Block 6 — Email footer (template snippet)
- [ ] Block 7a/7b — Subscription confirmation emails (template snippets)
- [ ] Block 8 — Performance dashboard header notice (component)
- [ ] Block 9 — Internal marketing language guidance (assets/ doc)
- [ ] Block 10 — Tagline update across surfaces

### Phase 2 · Active Futures landing page (six sections, hybrid framing)
- [ ] §A · Hero (subscription frame) — "Active Futures. Alerts You Can Execute Automatically — Without Ever Handing Over Your Account."
- [ ] §B · Three-Tier Execution (Manual / Semi-Auto / Full Auto)
- [ ] §C · 30-Minute Setup Walkthrough
- [ ] §D · Transparency Standard (Model + Live dashboard, truthful sourcing language)
- [ ] §E · How We Operate (Block 3 editorial)
- [ ] §F · Subscribe to Active Futures (signup form with Block 4 acknowledgments)
- [ ] **Architecture proof band** (hybrid) — concise "the architecture behind the alerts" section linking to the doubling-doctrine / falsifiability / attribution content as a sub-page or anchor.

### Phase 3 · Convexity Experiment landing page (parallel structure)
- [ ] All six sections mirrored with convex-specific deltas (Section 3.7).
- [ ] Word "Experiment" preserved everywhere.
- [ ] Convex-specific options-risk acknowledgment checkbox.
- [ ] Convex dashboard preview (separate from Active Futures).
- [ ] Architecture proof band → links to existing convex doctrine content (Earned Doubling Ladder, Revert Architecture).

### Phase 4 · Onboarding guides (web + PDF)
- [ ] `/onboarding` — Active Futures Subscriber Onboarding Guide (Appendix A1, verbatim).
- [ ] `/convexity-onboarding.html` — Convexity Experiment Subscriber Onboarding Guide (Appendix A2, verbatim).
- [ ] PDF generation for each (Cmd-P print-CSS, or build pipeline).

### Phase 5 · Analytics + QA + counsel handoff
- [ ] Section 9 analytics events instrumented.
- [ ] Section 10 acceptance criteria checklist run.
- [ ] WCAG AA, performance budgets, mobile responsive verified.
- [ ] **Counsel review package assembled and submitted.**
- [ ] No merge to `main` until counsel approves.

---

## 3 · Branch policy

- All work on `subscription-rewrite`.
- Commits push to `origin/subscription-rewrite` (never `origin/main`).
- The current `main` (live experiment + convexity tab) stays untouched.
- Cutover plan, post-counsel:
  1. Counsel approval recorded.
  2. PR from `subscription-rewrite` → `main` for human review.
  3. Squash-merge with the prop-firm-flag resolution documented.
  4. Soft-launch monitoring window.

---

## 4 · Hybrid framing — how the doctrine survives

The current site's load-bearing concepts that we want to **preserve beneath the
subscription frame**, not throw away:

- **Doubling doctrine** (3.3 doublings ≈ 10×) — keep as the "what the model
  portfolio targets" explainer beneath the hero, or as a /doctrine sub-link.
- **Falsifiability protocol v2** — keep as the "when we stop publishing" gate,
  shown on a dedicated /falsifiability sub-page linked from §E.
- **Attribution H2/H3** — keep as part of the architecture proof; surface in
  the dashboard as "every trade carries an honest post-mortem tag."
- **Trigger ladder / buffer system / earned doubling** (linear + convex) — keep
  as the sizing-discipline narrative on the architecture proof band.
- **Edge gate (rolling-100 EV $0)** — keep as published commitment beneath the
  dashboard. The subscription frame is *what you get*; the gate is *how we
  bound the publication's lifetime*.

The risk to manage: making the architecture-as-proof section feel like
substantive transparency rather than buried filler. If the subscription hero
is too tall, the architecture proof gets ignored; if it's too short, the
publisher framing loses its anchor.

---

## 5 · Open items needing Hiren confirmation (from spec §0.7)

- [ ] Tagline replacement (Block 10): "What We Trade. What You See. No Edits."
- [ ] TradersPost affiliate link: yes/no
- [ ] Active Futures pricing tiers + cadence + target subscriber profile
- [ ] Convexity Experiment pricing + positioning ("beta" vs "permanent product line")
- [ ] Confirm "Active Futures" / "Convexity Experiment" as final public names
- [ ] Confirm `/convexity-onboarding.html` URL convention
- [ ] **Counsel name + engagement window**
- [ ] **Prop-firm relationship status + data feed plan** (truthfulness gate above)
- [ ] Production trade alert schema document (spec says exists; in this repo we use the in-repo schema)

---

*Plan iteration 1. Update this file as scope is locked or shifted.*
