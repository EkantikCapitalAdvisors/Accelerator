// =====================================================
// Income Modules — A (Quarterly Income), B (Scale-Then-Distribute),
// and C (Capacity & Allocation Status + Indication-of-Interest form).
// Spec: 10x-cash-generator-spec.md v1.6.
// =====================================================
(function (root) {
    'use strict';

    function $(id) { return document.getElementById(id); }
    function fmt$(n)   { return '$' + Math.round(n).toLocaleString('en-US'); }
    function fmt$0(n)  { return '$' + Math.round(n).toLocaleString('en-US'); }
    function fmt$2(n)  { return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
    function fmtPct(x, d) { return (x * 100).toFixed(d == null ? 0 : d) + '%'; }
    function escapeHTML(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

    // ─────────────────────────────────────────────────────
    // Strategy assumptions
    // ACTIVE_MONTHS_PER_YEAR — the strategy trades 10 months and stands down
    // for 2 (low-liquidity / holiday windows). Both modules use this; both
    // modules surface it in the caveat copy so the assumption is visible.
    // ─────────────────────────────────────────────────────
    const ACTIVE_MONTHS_PER_YEAR = 10;

    // ─────────────────────────────────────────────────────
    // Module A — Quarterly Income engine
    // Input is MONTHLY rate (the strategy's natural cadence). Profits strip
    // each period; base capital is constant; SIMPLE accumulation (cash exits
    // at each period boundary, no within-period compounding).
    //   annualIncome    = capital × monthlyRate × ACTIVE_MONTHS_PER_YEAR
    //   perPeriodCheck  = annualIncome / periodsPerYear
    //                     (averages over 12 calendar months — distributions
    //                      are smooth across the cycle, even though only 10
    //                      months are active.)
    // ─────────────────────────────────────────────────────
    const FREQ_PERIODS = { monthly: 12, quarterly: 4, 'semi-annual': 2 };
    const FREQ_LABEL   = { monthly: 'Monthly', quarterly: 'Quarterly', 'semi-annual': 'Semi-Annual' };
    const FREQ_PER     = { monthly: 'month',   quarterly: 'quarter',   'semi-annual': 'half-year' };

    function moduleAMath({ capital, monthlyRate, frequency }) {
        const periodsPerYear = FREQ_PERIODS[frequency] || 4;
        const annualIncome   = capital * monthlyRate * ACTIVE_MONTHS_PER_YEAR;
        const perPeriodCheck = annualIncome / periodsPerYear;
        const fiveYearTotal  = annualIncome * 5;
        return { periodsPerYear, perPeriodCheck, annualIncome, fiveYearTotal };
    }

    // ─────────────────────────────────────────────────────
    // Module B — Scale-Then-Distribute engine
    // Input is MONTHLY rate directly. Within each year, capital compounds for
    // ACTIVE_MONTHS_PER_YEAR months at monthlyRate. The other 2 months the
    // strategy is closed — capital sits flat. At each `threshold` × N crossing
    // during active months, log a scale event. At year-end: distribute
    // (capital - base), reset capital to base for the next year.
    // ─────────────────────────────────────────────────────
    function moduleBSimulate({ capital: base, monthlyRate, threshold, years }) {
        const yearTimelines = [];
        for (let yr = 0; yr < years; yr++) {
            let cap = base;
            let prevTier = 0;
            const events = [];
            for (let m = 1; m <= ACTIVE_MONTHS_PER_YEAR; m++) {
                cap *= (1 + monthlyRate);
                const growth = (cap - base) / base;
                const tier = Math.floor(growth / threshold);
                if (tier > prevTier) {
                    events.push({ month: m, multiple: 1 + threshold * tier, capital: cap });
                    prevTier = tier;
                }
            }
            const distribution = cap - base;
            yearTimelines.push({ year: yr + 1, events, yearEndCapital: cap, distribution });
            // Capital resets to base at the top of the next iteration.
        }
        const totalDistribution = yearTimelines.reduce((s, y) => s + y.distribution, 0);
        const perYearEvents = yearTimelines.map(y => y.events.length);
        return {
            yearTimelines,
            totalDistribution,
            scaleEventsPerYear: perYearEvents[0] || 0,
            yearEndDistribution: yearTimelines[0]?.distribution || 0,
            monthlyRate,
            activeMonths: ACTIVE_MONTHS_PER_YEAR
        };
    }

    // ─────────────────────────────────────────────────────
    // Module A — Render (target rate only; live evidence lives elsewhere)
    // ─────────────────────────────────────────────────────
    function renderModuleA(/* state */) {
        const capEl  = $('mod-a-capital');
        const rateEl = $('mod-a-rate');
        if (!capEl || !rateEl) return;

        const recompute = () => {
            const capital = parseFloat(capEl.value);
            const monthlyRate = parseFloat(rateEl.value) / 100;
            const freqRadio = document.querySelector('input[name="mod-a-freq"]:checked');
            const frequency = freqRadio ? freqRadio.value : 'quarterly';

            const tgt = moduleAMath({ capital, monthlyRate, frequency });
            $('mod-a-capital-val').textContent = fmt$0(capital);
            $('mod-a-rate-val').textContent    = (monthlyRate * 100).toFixed(0) + '%/mo';

            $('mod-a-target-period').textContent = fmt$0(tgt.perPeriodCheck);
            $('mod-a-target-annual').textContent = fmt$0(tgt.annualIncome);
            $('mod-a-target-5y').textContent     = fmt$0(tgt.fiveYearTotal);

            const perWord = FREQ_PER[frequency];
            const perLabelEl = $('mod-a-per-label');
            if (perLabelEl) perLabelEl.textContent = `Per-${perWord} check`;

            // Subhead reflects current slider value.
            const subhead = $('mod-a-target-header');
            if (subhead) {
                subhead.textContent = `${(monthlyRate * 100).toFixed(0)}% per month — the strategy's income target.`;
            }
        };

        // Wire once
        if (!capEl._wired) {
            [capEl, rateEl].forEach(el => el.addEventListener('input', recompute));
            document.querySelectorAll('input[name="mod-a-freq"]').forEach(r => r.addEventListener('change', recompute));
            capEl._wired = true;
        }
        recompute();
    }

    // ─────────────────────────────────────────────────────
    // Module B — Render (target rate only; clean timeline)
    // Timeline now shows just base → year-end-capital fill with the year-end
    // distribution as the right-edge label. Scale-event count is shown in the
    // scoreboard, not as cluttered per-event labels on the bar.
    // ─────────────────────────────────────────────────────
    function renderModuleB(/* state */) {
        const capEl = $('mod-b-capital');
        const rateEl = $('mod-b-rate');
        const thrEl = $('mod-b-threshold');
        const horEl = $('mod-b-horizon');
        if (!capEl || !rateEl || !thrEl || !horEl) return;

        const recompute = () => {
            const capital = parseFloat(capEl.value);
            const monthlyRate = parseFloat(rateEl.value) / 100;
            const threshold = parseFloat(thrEl.value) / 100;
            const years = parseInt(horEl.value, 10);

            $('mod-b-capital-val').textContent   = fmt$0(capital);
            $('mod-b-rate-val').textContent      = (monthlyRate * 100).toFixed(0) + '%/mo';
            $('mod-b-threshold-val').textContent = (threshold * 100).toFixed(0) + '%';
            $('mod-b-horizon-val').textContent   = years + (years === 1 ? ' yr' : ' yrs');

            const tgt = moduleBSimulate({ capital, monthlyRate, threshold, years });
            renderModuleBTimeline($('mod-b-timeline-target'), tgt, capital);

            $('mod-b-target-events').textContent     = String(tgt.scaleEventsPerYear);
            $('mod-b-target-yearend').textContent    = fmt$0(tgt.yearEndDistribution);
            $('mod-b-target-cumulative').textContent = fmt$0(tgt.totalDistribution);

            const h4 = $('mod-b-target-h4');
            if (h4) h4.textContent = `At Target Rate · ${(monthlyRate * 100).toFixed(0)}% per month`;
            const subhead = $('mod-b-target-header');
            if (subhead) subhead.textContent = `${(monthlyRate * 100).toFixed(0)}% per month — the strategy's income target.`;
        };

        if (!capEl._wired) {
            [capEl, rateEl, thrEl, horEl].forEach(el => el.addEventListener('input', recompute));
            capEl._wired = true;
        }
        recompute();
    }

    function renderModuleBTimeline(container, sim, base) {
        if (!container) return;
        const maxCapital = Math.max(base, ...sim.yearTimelines.map(y => y.yearEndCapital));
        const rows = sim.yearTimelines.map(y => {
            const fillPct = Math.min(100, (y.yearEndCapital / maxCapital) * 100);
            const eventCount = y.events.length;
            const eventNote = eventCount > 0
                ? ` · ${eventCount} scale event${eventCount === 1 ? '' : 's'}`
                : '';
            return `
              <div class="mod-b-row">
                <div class="mod-b-row__label">Year ${y.year}</div>
                <div class="mod-b-row__track" title="Year-end capital ${fmt$0(y.yearEndCapital)}${eventNote}">
                  <div class="mod-b-row__fill" style="width:${fillPct.toFixed(2)}%"></div>
                  <span class="mod-b-marker mod-b-marker--start">base ${fmt$0(base)}</span>
                  <span class="mod-b-marker mod-b-marker--end">→ ${fmt$0(y.distribution)} distributed</span>
                </div>
              </div>`;
        }).join('');
        container.innerHTML = rows;
    }

    // ─────────────────────────────────────────────────────
    // Module C — Capacity counter
    // Reads state.capacity (loaded by data.js). Renders two bands per spec §5.4.1.
    // ─────────────────────────────────────────────────────
    function renderCapacityCounter(state) {
        const fillEl  = $('mod-c-tier-fill');
        const labelEl = $('mod-c-tier-label');
        const updEl   = $('mod-c-counter-updated');
        const ctaWrap = $('indication-cta-wrap');
        if (!fillEl || !labelEl) return;

        const cap = state.capacity || { founding_tier_size: 1000000, founding_tier_indicated: 0, indication_count: 0, last_updated: '—' };
        const tierSize = cap.founding_tier_size || 1000000;
        const indicated = cap.founding_tier_indicated || 0;
        const count = cap.indication_count || 0;
        const ratio = Math.min(1, indicated / tierSize);

        fillEl.style.width = (ratio * 100).toFixed(2) + '%';

        if (indicated >= tierSize) {
            labelEl.innerHTML = `<strong>Founding tier closed</strong> · general allocation opening soon`;
            // Switch CTA copy
            const submitBtn = $('ind-submit');
            if (submitBtn) submitBtn.textContent = 'Join general allocation waitlist';
            const formHeading = $('ind-section-heading');
            if (formHeading) formHeading.textContent = 'Join the General Allocation Waitlist';
        } else {
            labelEl.innerHTML = `<strong>${fmt$0(indicated)}</strong> of $1M indicated · <strong>${count}</strong> indication${count === 1 ? '' : 's'}`;
        }
        if (updEl) updEl.textContent = `Updated ${cap.last_updated || '—'}. Indications are non-binding.`;
    }

    // ─────────────────────────────────────────────────────
    // Module C — Indication-of-Interest form
    // Spec §5.6. Eight fields, two acknowledgments gate submit.
    // ─────────────────────────────────────────────────────
    function renderForm() {
        const form = $('indication-form');
        if (!form || form._wired) return;
        form._wired = true;

        const fName  = $('ind-first');
        const lName  = $('ind-last');
        const email  = $('ind-email');
        const phone  = $('ind-phone');
        const amtEl  = $('ind-amount');
        const amtVal = $('ind-amount-val');
        const ackBind   = $('ind-ack-binding');
        const ackAccred = $('ind-ack-accred');
        const submit = $('ind-submit');
        const errorEl = $('ind-error');
        const thanks  = $('ind-thanks');

        function updateAmountLabel() {
            const amt = parseFloat(amtEl.value);
            const slots = Math.floor(amt / 10000);
            const tierPct = (amt / 1000000) * 100;
            amtVal.innerHTML = `<strong>${fmt$0(amt)}</strong>  ·  ${slots} of 100 founding slot${slots === 1 ? '' : 's'}  ·  ${tierPct.toFixed(0)}% of founding tier`;
        }

        function validateEmail(v) {
            return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
        }

        function validate() {
            const ok =
                (fName.value || '').trim().length > 0 &&
                (lName.value || '').trim().length > 0 &&
                validateEmail((email.value || '').trim()) &&
                ackBind.checked && ackAccred.checked;
            submit.disabled = !ok;
            return ok;
        }

        amtEl.addEventListener('input', updateAmountLabel);
        [fName, lName, email, phone, ackBind, ackAccred].forEach(el =>
            el && el.addEventListener('input', validate));
        [ackBind, ackAccred].forEach(el => el && el.addEventListener('change', validate));

        updateAmountLabel();
        validate();

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (!validate()) return;

            const action = form.getAttribute('action');
            const placeholder = !action || action.includes('__FORMSPREE_INCOME__');

            const amt = parseFloat(amtEl.value);
            const modeRadio = document.querySelector('input[name="ind-mode"]:checked');
            const payload = new FormData();
            payload.append('first_name', fName.value.trim());
            payload.append('last_name',  lName.value.trim());
            payload.append('email',      email.value.trim());
            payload.append('phone',      (phone.value || '').trim());
            payload.append('booking_amount', String(amt));
            payload.append('preferred_mode', modeRadio ? modeRadio.value : 'no-preference');
            payload.append('slots',           String(Math.floor(amt / 10000)));
            payload.append('founding_tier_pct', (amt / 1000000).toFixed(4));
            payload.append('timestamp',       new Date().toISOString());
            payload.append('source',          'income-landing-v1.6');

            // Disable submit during request
            submit.disabled = true;
            errorEl.classList.add('hide');
            errorEl.textContent = '';

            if (placeholder) {
                // Endpoint not yet configured — show a clear error rather than firing a stray POST.
                errorEl.classList.remove('hide');
                errorEl.textContent = 'Form endpoint not yet configured. Email info@ekantikcapital.com directly with your indication.';
                submit.disabled = false;
                return;
            }

            try {
                const res = await fetch(action, {
                    method: 'POST',
                    body: payload,
                    headers: { 'Accept': 'application/json' }
                });
                if (!res.ok) throw new Error('HTTP ' + res.status);
                // Success — replace form with thank-you state
                form.classList.add('hide');
                if (thanks) thanks.classList.remove('hide');
                window.scrollTo({ top: thanks ? thanks.getBoundingClientRect().top + window.scrollY - 80 : 0, behavior: 'smooth' });
            } catch (err) {
                console.error('[Indication form] submit failed:', err);
                errorEl.classList.remove('hide');
                errorEl.textContent = 'Submission failed. Please try again or email info@ekantikcapital.com directly.';
                submit.disabled = false;
            }
        });
    }

    // ─────────────────────────────────────────────────────
    // Init
    // Modules A and B don't depend on live data anymore — they render the
    // target-rate scenario from slider inputs. Only Module C (capacity counter)
    // subscribes to state. Form wiring is also one-shot.
    // ─────────────────────────────────────────────────────
    function init() {
        if (!root.Ekantik || !root.Ekantik.Data) return;
        // Module A and B: render once on init (they're slider-driven from here on)
        renderModuleA();
        renderModuleB();
        // Module C and form: state-dependent + one-shot wiring
        root.Ekantik.Data.onChange(state => { renderCapacityCounter(state); });
        renderForm();
        const s = root.Ekantik.Data.get();
        if (s) renderCapacityCounter(s);
    }

    root.Ekantik = root.Ekantik || {};
    root.Ekantik.Modules = { init, _math: { moduleAMath, moduleBSimulate } };
})(typeof window !== 'undefined' ? window : globalThis);
