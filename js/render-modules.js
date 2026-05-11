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
    // Strategy assumptions (single source of truth)
    //   ACTIVE_MONTHS_PER_YEAR — strategy trades 10 months, stands down for 2
    //   SCALE_TRIGGER_DOLLARS  — position doubles once cumulative profit hits
    //                             this dollar threshold (built-in, derived from
    //                             execution mechanics; not user-adjustable)
    // ─────────────────────────────────────────────────────
    const ACTIVE_MONTHS_PER_YEAR = 10;
    const SCALE_TRIGGER_DOLLARS  = 5000;
    const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

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
    // Returns a `monthly` breakdown for the year-1 table.
    // ─────────────────────────────────────────────────────
    const FREQ_PERIODS = { monthly: 12, quarterly: 4, 'semi-annual': 2 };
    const FREQ_LABEL   = { monthly: 'Monthly', quarterly: 'Quarterly', 'semi-annual': 'Semi-Annual' };
    const FREQ_PER     = { monthly: 'month',   quarterly: 'quarter',   'semi-annual': 'half-year' };

    function moduleAMath({ capital, monthlyRate, frequency }) {
        const periodsPerYear  = FREQ_PERIODS[frequency] || 4;
        const monthsPerPeriod = 12 / periodsPerYear;
        const annualIncome    = capital * monthlyRate * ACTIVE_MONTHS_PER_YEAR;
        const perPeriodCheck  = annualIncome / periodsPerYear;
        const fiveYearTotal   = annualIncome * 5;

        // Month-by-month breakdown for the table.
        // Distributions land on each period boundary; amount = perPeriodCheck
        // (smoothed across the cycle, including stand-down months).
        const monthly = [];
        let cumPaid = 0;
        for (let m = 1; m <= 12; m++) {
            const isActive = m <= ACTIVE_MONTHS_PER_YEAR;
            const produced = isActive ? capital * monthlyRate : 0;
            const isPeriodEnd = (m % monthsPerPeriod === 0);
            const distribution = isPeriodEnd ? perPeriodCheck : 0;
            cumPaid += distribution;
            monthly.push({ month: m, isActive, produced, distribution, cumPaid });
        }

        return { periodsPerYear, monthsPerPeriod, perPeriodCheck, annualIncome, fiveYearTotal, monthly };
    }

    // ─────────────────────────────────────────────────────
    // Module B — Scale-Then-Distribute engine
    // Input is MONTHLY rate directly. Within each year, capital compounds for
    // ACTIVE_MONTHS_PER_YEAR months at monthlyRate. The other 2 months the
    // strategy is closed — capital sits flat. The position doubles once during
    // the year — at the first month where cumulative profit (cap - base) hits
    // SCALE_TRIGGER_DOLLARS. At year-end: distribute (cap - base), reset capital
    // to base for the next year.
    // Returns a year-1 `monthly` breakdown for the table.
    // ─────────────────────────────────────────────────────
    function moduleBSimulate({ capital: base, monthlyRate, years }) {
        const yearTimelines = [];
        let scaledMonth = null;
        for (let yr = 0; yr < years; yr++) {
            let cap = base;
            let scaledAt = null;
            let annualProfit = 0;
            const monthly = [];
            for (let m = 1; m <= 12; m++) {
                const isActive = m <= ACTIVE_MONTHS_PER_YEAR;
                const startCap = cap;
                if (isActive) cap = cap * (1 + monthlyRate);
                const gain = cap - startCap;
                const profit = cap - base;
                const scaledThisMonth = (scaledAt == null && isActive && profit >= SCALE_TRIGGER_DOLLARS);
                if (scaledThisMonth) scaledAt = m;
                const isYearEnd = (m === ACTIVE_MONTHS_PER_YEAR);
                const distribution = isYearEnd ? (cap - base) : 0;
                // Capture the pre-distribution end-of-month capital for the table.
                const displayCap = cap;
                if (isYearEnd) {
                    // Distribute profit, reset capital to base for the stand-down months
                    annualProfit = cap - base;
                    cap = base;
                }
                monthly.push({
                    month: m,
                    isActive,
                    startCap,
                    endCap: displayCap,
                    gain,
                    profit,
                    scaledThisMonth,
                    distribution
                });
            }
            yearTimelines.push({
                year: yr + 1,
                monthly,
                yearEndCapital: base, // after distribution + reset
                distribution: annualProfit,
                scaledAt
            });
            if (yr === 0) scaledMonth = scaledAt;
        }
        const totalDistribution = yearTimelines.reduce((s, y) => s + y.distribution, 0);
        return {
            yearTimelines,
            totalDistribution,
            scaledMonth,
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

            renderModuleATable(tgt.monthly);
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
        const horEl = $('mod-b-horizon');
        if (!capEl || !rateEl || !horEl) return;

        const recompute = () => {
            const capital = parseFloat(capEl.value);
            const monthlyRate = parseFloat(rateEl.value) / 100;
            const years = parseInt(horEl.value, 10);

            $('mod-b-capital-val').textContent   = fmt$0(capital);
            $('mod-b-rate-val').textContent      = (monthlyRate * 100).toFixed(0) + '%/mo';
            $('mod-b-horizon-val').textContent   = years + (years === 1 ? ' yr' : ' yrs');

            const tgt = moduleBSimulate({ capital, monthlyRate, years });

            const scaleLabel = tgt.scaledMonth != null
                ? `Yes · month ${tgt.scaledMonth}`
                : 'No (profit < $5K)';
            $('mod-b-target-events').textContent     = scaleLabel;
            $('mod-b-target-yearend').textContent    = fmt$0(tgt.yearEndDistribution);
            $('mod-b-target-cumulative').textContent = fmt$0(tgt.totalDistribution);

            const subhead = $('mod-b-target-header');
            if (subhead) subhead.textContent = `${(monthlyRate * 100).toFixed(0)}% per month — the strategy's income target.`;

            // Render year-1 month-by-month table.
            renderModuleBTable(tgt.yearTimelines[0]?.monthly || []);
        };

        if (!capEl._wired) {
            [capEl, rateEl, horEl].forEach(el => el.addEventListener('input', recompute));
            capEl._wired = true;
        }
        recompute();
    }

    // ─────────────────────────────────────────────────────
    // Monthly tables — month-by-month breakdown
    // ─────────────────────────────────────────────────────
    function renderModuleATable(monthly) {
        const tbody = $('mod-a-table-body');
        if (!tbody) return;
        const rows = monthly.map(r => {
            const status = r.isActive
                ? '<span class="mod-table__pill mod-table__pill--active">Active</span>'
                : '<span class="mod-table__pill mod-table__pill--down">Stand-down</span>';
            const dist = r.distribution > 0
                ? `<strong class="mod-table__dist">${fmt$0(r.distribution)}</strong>`
                : '<span class="muted">—</span>';
            return `
              <tr${r.distribution > 0 ? ' class="mod-table__row--dist"' : ''}>
                <td class="mono">${MONTH_NAMES[r.month - 1]}</td>
                <td>${status}</td>
                <td class="num">${r.produced > 0 ? fmt$0(r.produced) : '<span class="muted">—</span>'}</td>
                <td class="num">${dist}</td>
                <td class="num mono">${fmt$0(r.cumPaid)}</td>
              </tr>`;
        }).join('');
        // Totals row
        const totalProduced = monthly.reduce((s, r) => s + r.produced, 0);
        const totalPaid     = monthly.reduce((s, r) => s + r.distribution, 0);
        tbody.innerHTML = rows + `
          <tr class="mod-table__row--total">
            <td class="mono"><strong>Year 1</strong></td>
            <td><span class="muted">${ACTIVE_MONTHS_PER_YEAR} active · 2 stand-down</span></td>
            <td class="num"><strong>${fmt$0(totalProduced)}</strong></td>
            <td class="num"><strong>${fmt$0(totalPaid)}</strong></td>
            <td class="num mono"><strong>${fmt$0(totalPaid)}</strong></td>
          </tr>`;
    }

    function renderModuleBTable(monthly) {
        const tbody = $('mod-b-table-body');
        if (!tbody) return;
        const rows = monthly.map(r => {
            const status = r.isActive
                ? '<span class="mod-table__pill mod-table__pill--active">Active</span>'
                : '<span class="mod-table__pill mod-table__pill--down">Stand-down</span>';
            const gainCell = r.isActive
                ? `<span class="mod-table__gain">+${fmt$0(r.gain)}</span>`
                : '<span class="muted">—</span>';
            const dist = r.distribution > 0
                ? `<strong class="mod-table__dist">${fmt$0(r.distribution)}</strong>`
                : '<span class="muted">—</span>';
            const scaleTag = r.scaledThisMonth
                ? ' <span class="mod-table__scale-tag" title="Cumulative profit crossed $5,000 — position doubles">↑ scale</span>'
                : '';
            const rowClass = r.distribution > 0 ? ' class="mod-table__row--dist"' : '';
            return `
              <tr${rowClass}>
                <td class="mono">${MONTH_NAMES[r.month - 1]}</td>
                <td>${status}</td>
                <td class="num mono">${fmt$0(r.endCap)}</td>
                <td class="num">${gainCell}${scaleTag}</td>
                <td class="num mono">${r.profit > 0 ? fmt$0(r.profit) : '<span class="muted">—</span>'}</td>
                <td class="num">${dist}</td>
              </tr>`;
        }).join('');
        // Peak capital at the moment of distribution (month 10), distribution amount = profit
        const peakCap = monthly[ACTIVE_MONTHS_PER_YEAR - 1]?.endCap || 0;
        const peakProfit = monthly[ACTIVE_MONTHS_PER_YEAR - 1]?.profit || 0;
        tbody.innerHTML = rows + `
          <tr class="mod-table__row--total">
            <td class="mono"><strong>Year 1</strong></td>
            <td><span class="muted">${ACTIVE_MONTHS_PER_YEAR} active · 2 stand-down</span></td>
            <td class="num mono"><strong>${fmt$0(peakCap)}</strong> <span class="muted" style="font-size:11px">(peak)</span></td>
            <td class="num"><strong>+${fmt$0(peakProfit)}</strong></td>
            <td class="num mono"><strong>${fmt$0(peakProfit)}</strong></td>
            <td class="num"><strong>${fmt$0(peakProfit)}</strong></td>
          </tr>`;
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

        const cap = state.capacity || { founding_tier_size: 500000, founding_tier_indicated: 0, indication_count: 0, last_updated: '—' };
        const tierSize = cap.founding_tier_size || 500000;
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
            labelEl.innerHTML = `<strong>${fmt$0(indicated)}</strong> of $500K indicated · <strong>${count}</strong> indication${count === 1 ? '' : 's'}`;
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
            const tierPct = (amt / 500000) * 100;
            amtVal.innerHTML = `<strong>${fmt$0(amt)}</strong>  ·  ${slots} of 50 founding slot${slots === 1 ? '' : 's'}  ·  ${tierPct.toFixed(0)}% of founding tier`;
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
            payload.append('founding_tier_pct', (amt / 500000).toFixed(4));
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
