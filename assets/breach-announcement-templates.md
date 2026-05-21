# Breach-Announcement Templates · Discord journal

Pre-written copy so any breach can be filed within the 24-hour SLA under stress.
Fill the `[BRACKETED]` fields. Post verbatim to the public `#futures-trades` (or
dedicated `#protocol-events`) Discord channel. Never reclassify or delete after posting —
the audit trail is the artifact.

Per Falsifiability Protocol v2.0 (Doc Ref FP-V2-2026-05), Articles V–VII.

---

## T1 — Logged Breach

**Trigger:** single isolated breach of Criterion 01 (attribution) or 03 (routine).

```
PROTOCOL EVENT · TIER 1 · LOGGED BREACH
Event ID: BE-[YYYY]-[NNN]   ·   Filed: [TIMESTAMP, within 24h of breach]

Criterion: [01 Attribution Discipline | 03 Daily Routine Adherence]
What happened: [one-sentence factual description — e.g. "Attribution tag for
F[NN] was not logged before the next entry."]

Classification: Tier 1 — isolated, logged.
Consequence: Stage-1 counter resets to zero. No position-size or operational
change. Trading continues.
Resumption: immediate; counter restarts at zero.
Witness review: scheduled within 7 days. Corrective action will be filed.

Per Falsifiability Protocol v2.0, Article VI. This is logged, not hidden —
counter progress is the cost, not trading capacity.
```

---

## T2 — Conditions Reduced

**Trigger:** 3+ breaches of Criterion 01/03 in rolling 30 trades, **or** sustained
Criterion 03 adherence below 95% across the rolling 30-day window.

```
PROTOCOL EVENT · TIER 2 · CONDITIONS REDUCED
Event ID: BE-[YYYY]-[NNN]   ·   Filed: [TIMESTAMP, within 24h]

Trigger: [3+ breaches of Criterion [01/03] in rolling 30 trades
          | Criterion 03 adherence sustained below 95% — currently [X.X]%]
Breach events referenced: [BE-…, BE-…, BE-…]

Classification: Tier 2 — conditions reduced.
Consequence (effective next session):
  · Position size cut to MINIMUM — 1 MES, no scaling, no ES contracts —
    for the next 20 qualified trades.
  · Daily routine adherence becomes mandatory daily filing under witness
    oversight (not monthly).
  · Stage-1 counter resets to zero.
  · Trading continues at reduced conditions.
Resumption: 20 clean minimum-size trades + witness countersignature.

Per Falsifiability Protocol v2.0, Article VI. The reduction is mechanical,
not discretionary. The stand-down state widget on accelerator.ekantikcapital.com
now reflects T2 with live resumption progress.
```

---

## T3 — Full Cessation

**Trigger:** any Criterion 02 breach (rule modification without the four-step
protocol), **or** a second Tier 2 event inside the rolling 100-trade window.

```
PROTOCOL EVENT · TIER 3 · FULL CESSATION
Event ID: BE-[YYYY]-[NNN]   ·   Filed: [TIMESTAMP, within 24h]

Trigger: [Criterion 02 breach — rule modification without four-step protocol
          | Second Tier 2 event inside rolling 100 trades]
Structural cause: [honest account of what failed structurally — not "bad luck",
not "recent P&L". What in the architecture or the operator's adherence broke.]

Classification: Tier 3 — full cessation.
Consequence (immediate):
  · New entries → zero size next session.
  · Open positions exit per the original trade plan.
  · Witness convenes a structural review.
  · Locked-protocol PDF is updated if the breach revealed structural inadequacy.
Remediation pathway: [what must change before resumption is considered].
Resumption: witness-countersigned remediation artifact + 30-day calendar gap
            + 20 minimum-size trades.

Per Falsifiability Protocol v2.0, Article VI. During the 30-day gap the page sits
with no active trades and the journal pauses. That is the protocol's price, paid
in public.
```

---

## Edge-Gate (Expression Layer) Stand-Down — T0 reference

**Trigger:** rolling 100-trade realized expectancy drops to $0/trade.

```
PROTOCOL EVENT · EXPRESSION LAYER · EDGE GATE FIRED
Filed: [TIMESTAMP, within 24h]

Rolling-100 realized expectancy: $[X.XX]/trade (crossed the $0 trigger).
Closing trade ID: F[NN].

Consequence (immediate): new entries → zero next session; open positions exit
per plan; strategy moves to research-only.
Re-deploy gate (all three required): OOS test ≥ +$50/trade over 50 qualified
trades (paper/prop) · written re-derivation of structural cause · 48-hour cool-off.

INTERPRETATION NOTE: [If a Fidelity-Layer T2/T3 breach is active in the rolling
30-day window, append:] "Per the Binding Interpretation Rule, this firing is
INTERPRETATION-SUSPENDED — the edge is not declared falsified from data generated
during an active transmission-fidelity breach (Event BE-…). Remediation precedes
any edge conclusion."

Per Falsifiability Protocol v2.0, Articles I–III.
```

---

### Filing checklist (every tier)
- [ ] Event ID assigned (`BE-YYYY-NNN`, sequential, never reused)
- [ ] Filed within 24 hours of the breach
- [ ] Appended to `data/breach-events.json` (id, timestamp, criterion, tier, description, witness_review_status: "pending")
- [ ] `data/standdown-state.json` updated to the new tier
- [ ] Posted verbatim to the public Discord journal
- [ ] No retroactive edit or reclassification after posting
