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
    // Module A — Quarterly Income engine
    // periods_per_year = { Monthly: 12, Quarterly: 4, Semi-Annual: 2 }
    // Profits strip each period; base capital is constant; SIMPLE division (no
    // within-year compounding) because cash exits at each period boundary.
    // ─────────────────────────────────────────────────────
    const FREQ_PERIODS = { monthly: 12, quarterly: 4, 'semi-annual': 2 };
    const FREQ_LABEL   = { monthly: 'Monthly', quarterly: 'Quarterly', 'semi-annual': 'Semi-Annual' };
    const FREQ_PER     = { monthly: 'month',   quarterly: 'quarter',   'semi-annual': 'half-year' };

    function moduleAMath({ capital, annualizedRate, frequency }) {
        const periodsPerYear = FREQ_PERIODS[frequency] || 4;
        const perPeriodRate  = annualizedRate / periodsPerYear;
        const perPeriodCheck = capital * perPeriodRate;
        const annualIncome   = perPeriodCheck * periodsPerYear;
        const fiveYearTotal  = annualIncome * 5;
        return { periodsPerYear, perPeriodRate, perPeriodCheck, annualIncome, fiveYearTotal };
    }

    // ─────────────────────────────────────────────────────
    // Module B — Scale-Then-Distribute engine
    // Within a year: capital compounds at the monthly rate derived from the
    // annualized input. At each `threshold` × N crossing, log a scale event.
    // At year-end: distribute (capital - base), reset capital to base.
    // ─────────────────────────────────────────────────────
    function moduleBSimulate({ capital: base, annualizedRate, threshold, years }) {
        const monthlyRate = Math.pow(1 + annualizedRate, 1/12) - 1;
        const yearTimelines = [];
        for (let yr = 0; yr < years; yr++) {
            let cap = base;
            let prevTier = 0;
            const events = [];
            for (let m = 1; m <= 12; m++) {
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
            // Capital resets to base at the top of the next iteration (structural — see §1.1, §4.6).
        }
        const totalDistribution = yearTimelines.reduce((s, y) => s + y.distribution, 0);
        const perYearEvents = yearTimelines.map(y => y.events.length);
        return {
            yearTimelines,
            totalDistribution,
            scaleEventsPerYear: perYearEvents[0] || 0,
            yearEndDistribution: yearTimelines[0]?.distribution || 0,
            monthlyRate
        };
    }

    // ─────────────────────────────────────────────────────
    // Live-rate adapter — pulls from Ekantik.KPIs.liveMonthlyRate.
    // Returns a normalized object the modules render against.
    // ─────────────────────────────────────────────────────
    function getLiveRate(state) {
        const result = root.Ekantik.KPIs.liveMonthlyRate(state.trades || []);
        if (!result.ok) return { ok: false, n: result.n || 0, reason: result.reason };
        return {
            ok: true,
            monthly: result.rate,
            annualized: result.annualized,
            n: result.n,
            provisional: result.provisional
        };
    }

    function fmtLiveHeader(live) {
        if (!live.ok) return `<span class="muted">Live rate unavailable — ${escapeHTML(live.reason || 'sample too small')}.</span>`;
        const monthlyDisp    = (live.monthly * 100).toFixed(2) + '%/mo';
        const annualizedDisp = '~' + Math.round(live.annualized * 100) + '% annualized';
        const sampleDisp     = `N=${live.n}`;
        const prov = live.provisional ? ' <span class="muted">(provisional · firms up at N=25)</span>' : '';
        return `<strong class="mono">${monthlyDisp}</strong> · ${annualizedDisp} · ${sampleDisp}${prov}`;
    }

    // ─────────────────────────────────────────────────────
    // Module A — Render
    // ─────────────────────────────────────────────────────
    function renderModuleA(state) {
        const capEl  = $('mod-a-capital');
        const rateEl = $('mod-a-rate');
        if (!capEl || !rateEl) return;

        const live = getLiveRate(state);
        const liveHeader = $('mod-a-live-header');
        if (liveHeader) liveHeader.innerHTML = fmtLiveHeader(live);

        const recompute = () => {
            const capital = parseFloat(capEl.value);
            const rateAnnual = parseFloat(rateEl.value) / 100;
            const freqRadio = document.querySelector('input[name="mod-a-freq"]:checked');
            const frequency = freqRadio ? freqRadio.value : 'quarterly';

            const tgt = moduleAMath({ capital, annualizedRate: rateAnnual, frequency });
            $('mod-a-capital-val').textContent = fmt$0(capital);
            $('mod-a-rate-val').textContent    = (rateAnnual * 100).toFixed(0) + '%';

            $('mod-a-target-period').textContent = fmt$0(tgt.perPeriodCheck);
            $('mod-a-target-annual').textContent = fmt$0(tgt.annualIncome);
            $('mod-a-target-5y').textContent     = fmt$0(tgt.fiveYearTotal);

            const periodLabel = FREQ_LABEL[frequency];
            const perWord = FREQ_PER[frequency];
            const perLabelEl = $('mod-a-per-label');
            if (perLabelEl) perLabelEl.textContent = `Per-${perWord} check`;

            // Live column
            if (live.ok) {
                const liveCalc = moduleAMath({ capital, annualizedRate: live.annualized, frequency });
                $('mod-a-live-period').textContent = fmt$0(liveCalc.perPeriodCheck);
                $('mod-a-live-annual').textContent = fmt$0(liveCalc.annualIncome);
                $('mod-a-live-5y').textContent     = fmt$0(liveCalc.fiveYearTotal);
                if (live.provisional) {
                    ['mod-a-live-period','mod-a-live-annual','mod-a-live-5y'].forEach(id => {
                        const el = $(id); if (el) el.classList.add('mod-out--provisional');
                    });
                }
            } else {
                ['mod-a-live-period','mod-a-live-annual','mod-a-live-5y'].forEach(id => {
                    const el = $(id); if (el) el.textContent = '—';
                });
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
    // Module B — Render
    // Timeline visualization: one row per year, month axis 0–12, scale-event
    // markers at the month they cross the threshold, year-end distribution
    // marker at right.
    // ─────────────────────────────────────────────────────
    function renderModuleB(state) {
        const capEl = $('mod-b-capital');
        const rateEl = $('mod-b-rate');
        const thrEl = $('mod-b-threshold');
        const horEl = $('mod-b-horizon');
        if (!capEl || !rateEl || !thrEl || !horEl) return;

        const live = getLiveRate(state);
        const liveHeader = $('mod-b-live-header');
        if (liveHeader) liveHeader.innerHTML = fmtLiveHeader(live);

        const recompute = () => {
            const capital = parseFloat(capEl.value);
            const rateAnnual = parseFloat(rateEl.value) / 100;
            const threshold = parseFloat(thrEl.value) / 100;
            const years = parseInt(horEl.value, 10);

            $('mod-b-capital-val').textContent   = fmt$0(capital);
            $('mod-b-rate-val').textContent      = (rateAnnual * 100).toFixed(0) + '%';
            $('mod-b-threshold-val').textContent = (threshold * 100).toFixed(0) + '%';
            $('mod-b-horizon-val').textContent   = years + (years === 1 ? ' yr' : ' yrs');

            const tgt = moduleBSimulate({ capital, annualizedRate: rateAnnual, threshold, years });
            renderModuleBTimeline($('mod-b-timeline-target'), tgt, capital);

            $('mod-b-target-events').textContent     = String(tgt.scaleEventsPerYear);
            $('mod-b-target-yearend').textContent    = fmt$0(tgt.yearEndDistribution);
            $('mod-b-target-cumulative').textContent = fmt$0(tgt.totalDistribution);

            if (live.ok) {
                const liveSim = moduleBSimulate({ capital, annualizedRate: live.annualized, threshold, years });
                renderModuleBTimeline($('mod-b-timeline-live'), liveSim, capital);
                $('mod-b-live-events').textContent     = String(liveSim.scaleEventsPerYear);
                $('mod-b-live-yearend').textContent    = fmt$0(liveSim.yearEndDistribution);
                $('mod-b-live-cumulative').textContent = fmt$0(liveSim.totalDistribution);
                if (live.provisional) {
                    ['mod-b-live-events','mod-b-live-yearend','mod-b-live-cumulative'].forEach(id => {
                        const el = $(id); if (el) el.classList.add('mod-out--provisional');
                    });
                }
            } else {
                const liveTl = $('mod-b-timeline-live');
                if (liveTl) liveTl.innerHTML = '<p class="muted italic" style="font-size:13px;padding:12px">Live rate unavailable.</p>';
                ['mod-b-live-events','mod-b-live-yearend','mod-b-live-cumulative'].forEach(id => {
                    const el = $(id); if (el) el.textContent = '—';
                });
            }
        };

        if (!capEl._wired) {
            [capEl, rateEl, thrEl, horEl].forEach(el => el.addEventListener('input', recompute));
            capEl._wired = true;
        }
        recompute();
    }

    function renderModuleBTimeline(container, sim, base) {
        if (!container) return;
        // Capture the largest year-end capital so each year's bar is scaled consistently.
        const maxCapital = Math.max(base, ...sim.yearTimelines.map(y => y.yearEndCapital));
        const rows = sim.yearTimelines.map(y => {
            const events = y.events.map(ev => {
                const pct = (ev.month / 12) * 100;
                return `<span class="mod-b-marker mod-b-marker--scale" style="left:${pct.toFixed(2)}%" title="Month ${ev.month}: ${ev.multiple.toFixed(1)}× · ${fmt$0(ev.capital)}"><em>${ev.multiple.toFixed(1)}×</em></span>`;
            }).join('');
            const fillPct = Math.min(100, (y.yearEndCapital / maxCapital) * 100);
            return `
              <div class="mod-b-row">
                <div class="mod-b-row__label">Year ${y.year}</div>
                <div class="mod-b-row__track">
                  <div class="mod-b-row__fill" style="width:${fillPct.toFixed(2)}%"></div>
                  <span class="mod-b-marker mod-b-marker--start" style="left:0%" title="Base ${fmt$0(base)}">base</span>
                  ${events}
                  <span class="mod-b-marker mod-b-marker--end" style="left:100%" title="Year-end distribution ${fmt$0(y.distribution)}">→ ${fmt$0(y.distribution)}</span>
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
    // ─────────────────────────────────────────────────────
    function init() {
        if (!root.Ekantik || !root.Ekantik.Data) return;
        root.Ekantik.Data.onChange(state => {
            renderModuleA(state);
            renderModuleB(state);
            renderCapacityCounter(state);
        });
        renderForm();
        // First render if data already present
        const s = root.Ekantik.Data.get();
        if (s && s.trades) {
            renderModuleA(s);
            renderModuleB(s);
            renderCapacityCounter(s);
        }
    }

    root.Ekantik = root.Ekantik || {};
    root.Ekantik.Modules = { init, _math: { moduleAMath, moduleBSimulate } };
})(typeof window !== 'undefined' ? window : globalThis);
