// =====================================================
// Accelerator Modules — A (Quarterly Income), B (Scale-Then-Distribute),
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
    const BASE_FOR_OPERATOR_PCT  = 20000;  // operator's % of capital is measured against the $20K starting base

    // ─────────────────────────────────────────────────────
    // Risk Tolerance Selector — shared between Mode A and Mode B
    // The investor's risk-per-trade choice (% of working capital) is THE
    // primary lever. Monthly rate is *derived* from it × live edge cadence,
    // not set independently. Five tier chips + custom slider.
    // ─────────────────────────────────────────────────────
    const RISK_TIERS = {
        operator:     { name: 'Operator',     pct: null,  /* live: avgRisk/$20K base */ },
        conservative: { name: 'Conservative', pct: 2.0  },
        moderate:     { name: 'Moderate',     pct: 5.0  },
        halfkelly:    { name: '½-Kelly',      pct: null,  /* live: halfKelly × 100 */ },
        custom:       { name: 'Custom',       pct: 5.0    /* slider-driven */ },
    };

    const RiskSelector = (function () {
        let currentTier = 'operator';
        let customPct = 5.0;
        const subscribers = [];
        let liveAnchors = { operatorPct: 1.6, halfKellyPct: 14.0, rExpectancy: 0.26, tradesPerMonth: 21 };

        function activeTier() { return currentTier; }

        function pctFor(tier) {
            if (tier === 'operator')     return liveAnchors.operatorPct;
            if (tier === 'halfkelly')    return liveAnchors.halfKellyPct;
            if (tier === 'conservative') return RISK_TIERS.conservative.pct;
            if (tier === 'moderate')     return RISK_TIERS.moderate.pct;
            if (tier === 'custom')       return customPct;
            return 5.0;
        }

        function currentPct() { return pctFor(currentTier); }

        function deriveMonthlyRate() {
            const r = liveAnchors.rExpectancy || 0;
            const tpm = liveAnchors.tradesPerMonth || 0;
            const riskFrac = currentPct() / 100;
            return r * tpm * riskFrac;  // monthly return as decimal (e.g., 0.05 for 5%/mo)
        }

        function notify() {
            subscribers.forEach(cb => { try { cb(); } catch (e) { console && console.error && console.error(e); } });
        }

        function updateLiveAnchors(state) {
            const s = (state && state.summary) || {};
            const trades = (state && state.trades) || [];
            if (s.avgRiskDollar != null) {
                liveAnchors.operatorPct = (s.avgRiskDollar / BASE_FOR_OPERATOR_PCT) * 100;
            }
            if (s.winRate != null && s.winLossR != null && s.winLossR > 0) {
                const p = s.winRate, q = 1 - p, b = s.winLossR;
                const halfKelly = Math.max(0, (p - q / b) / 2);
                liveAnchors.halfKellyPct = halfKelly * 100;
            }
            if (s.rExpectancy != null) liveAnchors.rExpectancy = s.rExpectancy;
            // Trades per month — derive from live trade cadence (matches render-edges)
            const times = trades.map(parseAnyTime).filter(Boolean).sort((a,b) => a - b);
            if (times.length >= 2) {
                const days = (times[times.length - 1] - times[0]) / 86400000;
                if (days >= 7) liveAnchors.tradesPerMonth = (trades.length / days) * 30.4375;
            }
            paintReadout();
            notify();
        }

        function paintReadout() {
            const opEl  = document.getElementById('rts-chip-operator');
            const hkEl  = document.getElementById('rts-chip-halfkelly');
            const cuEl  = document.getElementById('rts-chip-custom');
            if (opEl) opEl.textContent = '~' + liveAnchors.operatorPct.toFixed(1) + '%';
            if (hkEl) hkEl.textContent = '~' + liveAnchors.halfKellyPct.toFixed(1) + '%';
            if (cuEl) cuEl.textContent = customPct.toFixed(1);

            const pctEl = document.getElementById('rts-pct');
            const derEl = document.getElementById('rts-derived');
            const monthlyRatePct = (deriveMonthlyRate() * 100);
            if (pctEl) pctEl.textContent = currentPct().toFixed(2);
            if (derEl) derEl.textContent = `~${monthlyRatePct.toFixed(1)}% monthly @ live edge`;

            // Active chip styling
            document.querySelectorAll('.risk-tier-chip').forEach(b => {
                b.classList.toggle('risk-tier-chip--active', b.dataset.tier === currentTier);
                b.setAttribute('aria-pressed', b.dataset.tier === currentTier ? 'true' : 'false');
            });

            // Show/hide custom slider row
            const customRow = document.getElementById('rts-custom-row');
            if (customRow) customRow.classList.toggle('is-active', currentTier === 'custom');
        }

        function setTier(tier) {
            if (!RISK_TIERS[tier]) return;
            currentTier = tier;
            paintReadout();
            notify();
        }

        function setCustomPct(p) {
            customPct = Math.max(0.5, Math.min(20, Number(p) || 5));
            const v = document.getElementById('rts-custom-val');
            if (v) v.textContent = customPct.toFixed(1);
            if (currentTier === 'custom') { paintReadout(); notify(); }
            else paintReadout();
        }

        function onChange(cb) { if (typeof cb === 'function') subscribers.push(cb); }

        function init() {
            // Chip clicks
            document.querySelectorAll('.risk-tier-chip').forEach(btn => {
                btn.addEventListener('click', () => setTier(btn.dataset.tier));
            });
            // Custom slider
            const slider = document.getElementById('rts-custom-slider');
            if (slider) {
                slider.addEventListener('input', () => setCustomPct(parseFloat(slider.value)));
                customPct = parseFloat(slider.value) || 5;
            }
            // Live data subscription
            if (root.Ekantik && root.Ekantik.Data) {
                root.Ekantik.Data.onChange(updateLiveAnchors);
                const cur = root.Ekantik.Data.get();
                if (cur) updateLiveAnchors(cur);
            } else {
                paintReadout();
            }
        }

        return {
            init,
            activeTier,
            currentPct,
            deriveMonthlyRate,
            liveAnchors: () => liveAnchors,
            onChange,
        };
    })();

    // Time-parse helper used for cadence inference (matches render-section-a.js's parseTradeTime).
    function parseAnyTime(t) {
        const raw = t.entry_time || t.entryTime || t.exit_time || t.exitTime;
        if (!raw) return null;
        // ISO date with optional 24h or 12h-AM/PM time
        let m = String(raw).match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?/i);
        if (m) {
            let h = +(m[4]||0); const min = +(m[5]||0); const s = +(m[6]||0);
            const ap = (m[7] || '').toUpperCase();
            if (ap === 'PM' && h < 12) h += 12;
            if (ap === 'AM' && h === 12) h = 0;
            return new Date(+m[1], +m[2] - 1, +m[3], h, min, s);
        }
        // US-slash date with optional 24h or 12h-AM/PM time
        m = String(raw).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?/i);
        if (m) {
            let h = +(m[4]||0); const min = +(m[5]||0); const s = +(m[6]||0);
            const ap = (m[7] || '').toUpperCase();
            if (ap === 'PM' && h < 12) h += 12;
            if (ap === 'AM' && h === 12) h = 0;
            return new Date(+m[3], +m[1] - 1, +m[2], h, min, s);
        }
        const d = new Date(raw); return isNaN(d.getTime()) ? null : d;
    }

    // Compute realized drawdown stats (in R-units, position-size-agnostic).
    // Returns { maxDdR, worstTradeR } — to be scaled by the user's chosen
    // risk-per-trade $ to project at-your-sizing drawdown.
    function computeRealizedRiskProfile(trades) {
        if (!Array.isArray(trades) || trades.length === 0) return { maxDdR: 0, worstTradeR: 0 };
        const sorted = trades.map(t => ({ t, ts: parseAnyTime(t) }))
                             .filter(x => x.ts)
                             .sort((a,b) => a.ts - b.ts)
                             .map(x => x.t);
        let cumR = 0, peakR = 0, maxDdR = 0;
        let worstTradeR = 0;
        sorted.forEach(t => {
            const rd = t.risk_dollars || t.riskDollars || 0;
            const pl = t.dollar_pl || t.dollarPL || 0;
            const R  = rd > 0 ? pl / rd : 0;
            cumR += R;
            if (cumR > peakR) peakR = cumR;
            const dd = peakR - cumR;
            if (dd > maxDdR) maxDdR = dd;
            if (R < worstTradeR) worstTradeR = R;
        });
        return { maxDdR, worstTradeR };
    }

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
    // LINEAR-PER-POSITION model (not geometric):
    //   monthly_gain = base × monthlyRate × positionMultiplier
    // Each scale-up DOUBLES the position multiplier (1x → 2x → 4x → 8x → 16x).
    // A scale-up triggers when cumulative profit crosses the next $5K milestone,
    // BOUNDED by the user-chosen `maxScaleUps` (0 to 4).
    // At month ACTIVE_MONTHS_PER_YEAR (10): distribute (cap - base), reset to base.
    // ─────────────────────────────────────────────────────
    function moduleBSimulate({ capital: base, monthlyRate, maxScaleUps, years }) {
        const yearTimelines = [];
        for (let yr = 0; yr < years; yr++) {
            let cap = base;
            let positionMultiplier = 1;
            let scaleUpsApplied = 0;
            const scaleEvents = []; // { month, newMultiplier }
            const monthly = [];
            let annualProfit = 0;
            for (let m = 1; m <= 12; m++) {
                const isActive = m <= ACTIVE_MONTHS_PER_YEAR;
                const positionAtStart = positionMultiplier;
                const gain = isActive ? (base * monthlyRate * positionAtStart) : 0;
                cap = cap + gain;
                const profit = cap - base;

                // Trigger scale-ups at every $5K cumulative profit milestone, up to maxScaleUps.
                let scaledThisMonth = false;
                while (scaleUpsApplied < maxScaleUps && profit >= (scaleUpsApplied + 1) * SCALE_TRIGGER_DOLLARS) {
                    positionMultiplier *= 2;
                    scaleUpsApplied++;
                    scaledThisMonth = true;
                    scaleEvents.push({ month: m, newMultiplier: positionMultiplier });
                }

                const isYearEnd = (m === ACTIVE_MONTHS_PER_YEAR);
                const distribution = isYearEnd ? profit : 0;
                const displayCap = cap;
                if (isYearEnd) {
                    annualProfit = profit;
                    cap = base; // reset for stand-down months
                }

                monthly.push({
                    month: m,
                    isActive,
                    positionAtStart,
                    positionAtEnd: positionMultiplier,
                    endCap: displayCap,
                    gain,
                    profit,             // cum profit at end of month (0 in stand-down — cap was reset)
                    scaledThisMonth,
                    distribution
                });
            }
            yearTimelines.push({
                year: yr + 1,
                monthly,
                yearEndCapital: base,
                distribution: annualProfit,
                scaleUpsApplied,
                scaleEvents,
                finalMultiplier: positionMultiplier
            });
        }
        const totalDistribution = yearTimelines.reduce((s, y) => s + y.distribution, 0);
        const y1 = yearTimelines[0] || {};
        return {
            yearTimelines,
            totalDistribution,
            yearEndDistribution: y1.distribution || 0,
            scaleUpsApplied: y1.scaleUpsApplied || 0,
            finalMultiplier: y1.finalMultiplier || 1,
            scaleEvents: y1.scaleEvents || [],
            monthlyRate,
            activeMonths: ACTIVE_MONTHS_PER_YEAR
        };
    }

    // ─────────────────────────────────────────────────────
    // Module A — Render (driven by Risk Tolerance Selector + live edge)
    // Monthly rate is no longer an input; it's *derived* from the investor's
    // risk-per-trade selection × live R-expectancy × live trades-per-month.
    // ─────────────────────────────────────────────────────
    function renderModuleA(state) {
        const capEl = $('mod-a-capital');
        if (!capEl) return;

        const recompute = () => {
            const capital     = parseFloat(capEl.value);
            const monthlyRate = RiskSelector.deriveMonthlyRate();   // decimal, e.g. 0.05
            const riskPct     = RiskSelector.currentPct();          // % of capital
            const freqRadio   = document.querySelector('input[name="mod-a-freq"]:checked');
            const frequency   = freqRadio ? freqRadio.value : 'quarterly';

            const tgt = moduleAMath({ capital, monthlyRate, frequency });
            $('mod-a-capital-val').textContent = fmt$0(capital);
            $('mod-a-rate-val').textContent    = (monthlyRate * 100).toFixed(2) + '% /mo';

            $('mod-a-target-period').textContent = fmt$0(tgt.perPeriodCheck);
            $('mod-a-target-annual').textContent = fmt$0(tgt.annualIncome);
            $('mod-a-target-5y').textContent     = fmt$0(tgt.fiveYearTotal);

            const perWord = FREQ_PER[frequency];
            const perLabelEl = $('mod-a-per-label');
            if (perLabelEl) perLabelEl.textContent = `Per-${perWord} check`;

            // Paired downside — drawdown scaled to investor's chosen risk-per-trade.
            const dpRoot = state && state.trades ? state : (root.Ekantik && root.Ekantik.Data ? root.Ekantik.Data.get() : { trades: [] });
            const realized = computeRealizedRiskProfile(dpRoot.trades || []);
            const riskDollarPerTrade = capital * (riskPct / 100);
            const ddMax   = realized.maxDdR     * riskDollarPerTrade;
            const ddTrade = realized.worstTradeR * riskDollarPerTrade;  // negative
            const ddPct   = capital > 0 ? (ddMax / capital) * 100 : 0;

            const fmtNeg = v => v ? '−' + fmt$0(Math.abs(v)) : '$0';
            const ddMaxEl   = $('mod-a-dd-max');   if (ddMaxEl)   ddMaxEl.textContent   = fmtNeg(ddMax);
            const ddTrEl    = $('mod-a-dd-trade'); if (ddTrEl)    ddTrEl.textContent    = fmtNeg(ddTrade);
            const ddPctEl   = $('mod-a-dd-pct');   if (ddPctEl)   ddPctEl.textContent   = ddPct ? '−' + ddPct.toFixed(2) + '%' : '0%';

            renderModuleATable(tgt.monthly);
        };

        if (!capEl._wired) {
            capEl.addEventListener('input', recompute);
            document.querySelectorAll('input[name="mod-a-freq"]').forEach(r => r.addEventListener('change', recompute));
            RiskSelector.onChange(recompute);
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
    function renderModuleB(state) {
        const capEl = $('mod-b-capital');
        const horEl = $('mod-b-horizon');
        if (!capEl || !horEl) return;

        const recompute = () => {
            const capital     = parseFloat(capEl.value);
            const monthlyRate = RiskSelector.deriveMonthlyRate();
            const riskPct     = RiskSelector.currentPct();
            const years       = parseInt(horEl.value, 10);
            const scaleRadio  = document.querySelector('input[name="mod-b-scaleups"]:checked');
            const maxScaleUps = scaleRadio ? parseInt(scaleRadio.value, 10) : 0;

            $('mod-b-capital-val').textContent = fmt$0(capital);
            $('mod-b-rate-val').textContent    = (monthlyRate * 100).toFixed(2) + '% /mo';
            $('mod-b-horizon-val').textContent = years + (years === 1 ? ' yr' : ' yrs');

            const tgt = moduleBSimulate({ capital, monthlyRate, maxScaleUps, years });

            const multiTrace = ['1x'];
            tgt.scaleEvents.forEach(ev => multiTrace.push(`${ev.newMultiplier}x`));
            const scaleLabel = tgt.scaleUpsApplied === 0
                ? '0 (compound off · position stays 1x)'
                : `${tgt.scaleUpsApplied} (${multiTrace.join(' → ')})`;
            $('mod-b-target-events').textContent     = scaleLabel;
            $('mod-b-target-yearend').textContent    = fmt$0(tgt.yearEndDistribution);
            $('mod-b-target-cumulative').textContent = fmt$0(tgt.totalDistribution);

            // Paired downside — drawdown scaled to investor's chosen risk × compound multiplier
            const dpRoot = state && state.trades ? state : (root.Ekantik && root.Ekantik.Data ? root.Ekantik.Data.get() : { trades: [] });
            const realized = computeRealizedRiskProfile(dpRoot.trades || []);
            const riskDollarPerTrade = capital * (riskPct / 100);
            // Compound milestones amplify both upside and drawdown by the *final* position multiplier.
            const compoundMult = tgt.finalMultiplier || 1;
            const ddMax   = realized.maxDdR      * riskDollarPerTrade * compoundMult;
            const ddTrade = realized.worstTradeR * riskDollarPerTrade * compoundMult;
            const ddPct   = capital > 0 ? (ddMax / capital) * 100 : 0;
            const fmtNeg  = v => v ? '−' + fmt$0(Math.abs(v)) : '$0';
            const ddMaxEl = $('mod-b-dd-max');   if (ddMaxEl) ddMaxEl.textContent = fmtNeg(ddMax);
            const ddTrEl  = $('mod-b-dd-trade'); if (ddTrEl)  ddTrEl.textContent  = fmtNeg(ddTrade);
            const ddPctEl = $('mod-b-dd-pct');   if (ddPctEl) ddPctEl.textContent = ddPct ? '−' + ddPct.toFixed(2) + '%' : '0%';

            renderModuleBTable(tgt.yearTimelines[0]?.monthly || []);
        };

        if (!capEl._wired) {
            [capEl, horEl].forEach(el => el.addEventListener('input', recompute));
            document.querySelectorAll('input[name="mod-b-scaleups"]').forEach(r => r.addEventListener('change', recompute));
            RiskSelector.onChange(recompute);
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
            // Position column: e.g. "2x" (during the month), or "1x ↑ 2x" if a scale-up triggered at end-of-month.
            const posCell = r.scaledThisMonth
                ? `<span class="mod-table__pos">${r.positionAtStart}x</span> <span class="mod-table__scale-tag" title="Cumulative profit hit the next $5,000 milestone — position doubles for next month">↑ ${r.positionAtEnd}x</span>`
                : `<span class="mod-table__pos">${r.positionAtStart}x</span>`;
            const gainCell = r.isActive
                ? `<span class="mod-table__gain">+${fmt$0(r.gain)}</span>`
                : '<span class="muted">—</span>';
            const dist = r.distribution > 0
                ? `<strong class="mod-table__dist">${fmt$0(r.distribution)}</strong>`
                : '<span class="muted">—</span>';
            const rowClass = r.distribution > 0 ? ' class="mod-table__row--dist"' : '';
            return `
              <tr${rowClass}>
                <td class="mono">${MONTH_NAMES[r.month - 1]}</td>
                <td>${status}</td>
                <td class="num">${posCell}</td>
                <td class="num mono">${fmt$0(r.endCap)}</td>
                <td class="num">${gainCell}</td>
                <td class="num mono">${r.profit > 0 ? fmt$0(r.profit) : '<span class="muted">—</span>'}</td>
                <td class="num">${dist}</td>
              </tr>`;
        }).join('');
        // Peak capital + profit at month 10 (just before distribution + reset)
        const peakCap = monthly[ACTIVE_MONTHS_PER_YEAR - 1]?.endCap || 0;
        const peakProfit = monthly[ACTIVE_MONTHS_PER_YEAR - 1]?.profit || 0;
        const finalMult = monthly[ACTIVE_MONTHS_PER_YEAR - 1]?.positionAtEnd || 1;
        tbody.innerHTML = rows + `
          <tr class="mod-table__row--total">
            <td class="mono"><strong>Year 1</strong></td>
            <td><span class="muted">${ACTIVE_MONTHS_PER_YEAR} active · 2 stand-down</span></td>
            <td class="num"><strong>${finalMult}x</strong> <span class="muted" style="font-size:11px">(year-end)</span></td>
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
        const amtEl     = $('ind-amount');
        const amtVal    = $('ind-amount-val');
        const familyCap = $('ind-family-capital');
        const ackBind   = $('ind-ack-binding');
        const ackManaged = $('ind-ack-managed');
        const ackAccred = $('ind-ack-accred');
        const submit    = $('ind-submit');
        const errorEl   = $('ind-error');
        const thanks    = $('ind-thanks');

        // 15 managed-account seats. Start at $20K working capital;
        // $100K is the per-seat scaling target as the edge holds.
        const SEAT_MIN    = 20000;     // hard floor — enforced at slider + validate()
        const SEAT_TARGET = 100000;    // scaling target per seat
        const SEATS       = 15;

        function updateAmountLabel() {
            const amt = parseFloat(amtEl.value);
            // Seats consumed = amt / target (rounded up, min 1). The target — not the floor —
            // is the unit that defines a "full seat" of the cap.
            const seatShare = Math.max(1, Math.ceil(amt / SEAT_TARGET));
            const capPct = (seatShare / SEATS) * 100;
            const scaleNote = amt < SEAT_TARGET
                ? ` &middot; starting commitment &middot; scales toward $${(SEAT_TARGET).toLocaleString()}`
                : '';
            amtVal.innerHTML = `<strong>${fmt$0(amt)}</strong>  &middot;  ${seatShare} of ${SEATS} managed-account seat${seatShare === 1 ? '' : 's'} &middot; ${capPct.toFixed(0)}% of capacity${scaleNote}`;
        }

        function validateEmail(v) {
            return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
        }

        function validate() {
            const amt = parseFloat(amtEl.value);
            const ok =
                (fName.value || '').trim().length > 0 &&
                (lName.value || '').trim().length > 0 &&
                validateEmail((email.value || '').trim()) &&
                amt >= SEAT_MIN &&
                familyCap && familyCap.value &&
                ackBind.checked && ackManaged && ackManaged.checked && ackAccred.checked;
            submit.disabled = !ok;
            return ok;
        }

        amtEl.addEventListener('input', () => { updateAmountLabel(); validate(); });
        [fName, lName, email, phone, ackBind, ackManaged, ackAccred].forEach(el =>
            el && el.addEventListener('input', validate));
        [ackBind, ackManaged, ackAccred].forEach(el => el && el.addEventListener('change', validate));
        familyCap && familyCap.addEventListener('change', validate);

        updateAmountLabel();
        validate();

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (!validate()) return;

            const action = form.getAttribute('action');
            const placeholder = !action || action.includes('__FORMSPREE_ACCELERATOR__');

            const amt = parseFloat(amtEl.value);
            const modeRadio = document.querySelector('input[name="ind-mode"]:checked');
            const payload = new FormData();
            payload.append('first_name', fName.value.trim());
            payload.append('last_name',  lName.value.trim());
            payload.append('email',      email.value.trim());
            payload.append('phone',      (phone.value || '').trim());
            payload.append('booking_amount', String(amt));
            payload.append('preferred_mode', modeRadio ? modeRadio.value : 'no-preference');
            payload.append('family_capital', familyCap ? familyCap.value : '');
            payload.append('seat_share',     String(Math.max(1, Math.round(amt / SEAT_MIN))));
            payload.append('capacity_pct',   ((Math.max(1, Math.round(amt / SEAT_MIN)) / SEATS)).toFixed(4));
            payload.append('timestamp',       new Date().toISOString());
            payload.append('source',          'accelerator-landing-v1.6');

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
        // Risk Tolerance Selector — must init BEFORE modules so they can subscribe.
        RiskSelector.init();
        // Module A and B: render once on init; recomputes are driven by capital
        // slider, frequency/scale-up radios, and RiskSelector.onChange.
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
