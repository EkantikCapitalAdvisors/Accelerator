// =====================================================
// Section A — Edge Power. Spec §5.
// Renders the 3-block "Edge stated plainly" row, the Doubling Ladder
// (target vs live), and the 95/5 Portfolio Reshaper with editable sliders.
// =====================================================
(function (root) {
    'use strict';

    function $(id) { return document.getElementById(id); }

    // ─── The Edge stated plainly ───
    function renderEdgeTriplet(state) {
        const s = state.summary;
        if (!s || !s.n) return;
        $('edge-wr') && ($('edge-wr').textContent = (s.winRate * 100).toFixed(1) + '%');
        $('edge-pf') && ($('edge-pf').textContent = s.profitFactor === Infinity ? '∞' : s.profitFactor.toFixed(2));
        $('edge-rexp') && ($('edge-rexp').textContent = (s.rExpectancy != null)
            ? ((s.rExpectancy >= 0 ? '+' : '') + s.rExpectancy.toFixed(2) + 'R')
            : '—');
    }

    // ─── Doubling Ladder ───
    // Target rate: 2.5%/mo. Live rate: geometric mean from actual fills when n ≥ 25.
    const TARGET_MONTHLY = 0.025;
    const MIN_SAMPLE = 25;

    function monthsToMultiple(rate, multiple) {
        if (rate <= 0) return null;
        return Math.log(multiple) / Math.log(1 + rate);
    }

    function parseTS(raw) {
        if (!raw) return null;
        const d = new Date(raw.replace(' ', 'T'));
        return isNaN(d.getTime()) ? null : d;
    }

    function computeLiveRate(rawTrades) {
        if (!Array.isArray(rawTrades) || rawTrades.length < MIN_SAMPLE) {
            return { ok: false, reason: `Need ${MIN_SAMPLE} trades (have ${rawTrades.length}).` };
        }
        const sorted = [...rawTrades].sort((a, b) => {
            const ta = parseTS(a.entry_time || a.entryTime);
            const tb = parseTS(b.entry_time || b.entryTime);
            if (!ta || !tb) return 0;
            return ta - tb;
        });
        const cumPL = sorted.reduce((s, t) => s + (t.dollar_pl || t.dollarPL || 0), 0);
        const start = 10000;
        const end = start + cumPL;
        const ret = cumPL / start;
        const first = parseTS(sorted[0].entry_time || sorted[0].entryTime);
        const last = parseTS(sorted[sorted.length - 1].exit_time || sorted[sorted.length - 1].entry_time);
        if (!first || !last || last <= first) return { ok: false, reason: 'Timing data unavailable.' };
        const monthsElapsed = (last - first) / (1000 * 60 * 60 * 24 * 30.4375);
        if (monthsElapsed < 0.1 || ret <= -1) return { ok: false, reason: 'Not enough calendar time.' };
        const rate = ret <= 0
            ? -(Math.pow(1 - Math.abs(ret), 1 / monthsElapsed) - 1) * -1  // keep sign
            : Math.pow(1 + ret, 1 / monthsElapsed) - 1;
        return { ok: true, rate, ret, monthsElapsed, start, end };
    }

    function renderLadder(state) {
        const tbody = $('ladder-body');
        if (!tbody) return;
        const live = computeLiveRate(state.trades || []);
        const rungs = [
            { from: 10000, to: 20000, doublings: 1 },
            { from: 20000, to: 40000, doublings: 2 },
            { from: 40000, to: 80000, doublings: 3 },
            { from: 80000, to: 160000, doublings: 4 }
        ];
        tbody.innerHTML = rungs.map(r => {
            const tMo = monthsToMultiple(TARGET_MONTHLY, r.to / 10000);
            const lMo = live.ok ? monthsToMultiple(live.rate, r.to / 10000) : null;
            const tDisp = tMo == null ? '—' : `~${tMo.toFixed(1)} mo`;
            const lDisp = lMo == null ? '—' : `~${lMo.toFixed(1)} mo`;
            return `
              <tr>
                <td>$${(r.from/1000).toFixed(0)}K → $${(r.to/1000).toFixed(0)}K</td>
                <td>${r.doublings}</td>
                <td class="ladder__target">${tDisp}</td>
                <td class="ladder__live">${lDisp}</td>
              </tr>`;
        }).join('');

        const rateEl = $('ladder-live-rate');
        if (rateEl) {
            if (live.ok) {
                rateEl.textContent = `${(live.rate * 100).toFixed(2)}% / month`;
            } else {
                rateEl.textContent = live.reason;
            }
        }
    }

    // ─── 95/5 Portfolio Reshaper ───
    function compoundYear10(start, cagr, years) {
        return start * Math.pow(1 + cagr, years);
    }

    function renderReshaper() {
        const startEl = $('reshaper-start');
        const mktEl = $('reshaper-market-cagr');
        const specEl = $('reshaper-spec-cagr');
        const horizonEl = $('reshaper-horizon');
        const allocEl = $('reshaper-alloc');
        if (!startEl || !mktEl || !specEl || !horizonEl || !allocEl) return;

        const recompute = () => {
            const start = parseFloat(startEl.value) * 1000;
            const mCAGR = parseFloat(mktEl.value) / 100;
            const sCAGR = parseFloat(specEl.value) / 100;
            const years = parseFloat(horizonEl.value);
            const alloc = parseFloat(allocEl.value) / 100;

            const mktStart = start * (1 - alloc);
            const specStart = start * alloc;
            const mktEnd = compoundYear10(mktStart, mCAGR, years);
            const specEnd = compoundYear10(specStart, sCAGR, years);
            const total = mktEnd + specEnd;
            const mktShare = total > 0 ? mktEnd / total : 0;
            const specShare = total > 0 ? specEnd / total : 0;

            $('reshaper-start-val').textContent = '$' + start.toLocaleString(undefined, { maximumFractionDigits: 0 });
            $('reshaper-market-cagr-val').textContent = (mCAGR * 100).toFixed(0) + '%';
            $('reshaper-spec-cagr-val').textContent = (sCAGR * 100).toFixed(0) + '%';
            $('reshaper-horizon-val').textContent = years + ' yrs';
            $('reshaper-alloc-val').textContent = (alloc * 100).toFixed(0) + '%';

            $('reshaper-total').textContent = '$' + total.toLocaleString(undefined, { maximumFractionDigits: 0 });
            $('reshaper-market').textContent = '$' + mktEnd.toLocaleString(undefined, { maximumFractionDigits: 0 });
            $('reshaper-spec').textContent = '$' + specEnd.toLocaleString(undefined, { maximumFractionDigits: 0 });
            $('reshaper-market-share').textContent = (mktShare * 100).toFixed(1) + '%';
            $('reshaper-spec-share').textContent = (specShare * 100).toFixed(1) + '%';

            const barMkt = $('reshaper-bar-market');
            const barSpec = $('reshaper-bar-spec');
            if (barMkt && barSpec) {
                barMkt.style.width  = (mktShare * 100) + '%';
                barSpec.style.width = (specShare * 100) + '%';
                barSpec.textContent = specShare > 0.08
                    ? `Speculative ${(specShare*100).toFixed(1)}% of value`
                    : '';
                barMkt.textContent  = mktShare > 0.1
                    ? `Market ${(mktShare*100).toFixed(1)}%`
                    : '';
            }
        };

        [startEl, mktEl, specEl, horizonEl, allocEl].forEach(el =>
            el.addEventListener('input', recompute));
        recompute();
    }

    // ─── Inline equity curve + monthly P&L bars ───
    function renderEquityAndMonthly(state) {
        const trades = state.trades || [];
        if (trades.length === 0) return;
        const eq = document.getElementById('section-a-equity');
        const mo = document.getElementById('section-a-monthly');
        if (eq && root.Ekantik.Charts) root.Ekantik.Charts.equityCurve(eq, trades);
        if (mo && root.Ekantik.Charts) root.Ekantik.Charts.monthlyBars(mo, trades);

        // Running stats below the curve
        const netPL = trades.reduce((s, t) => s + (t.dollar_pl || 0), 0);
        const retPct = (netPL / 10000) * 100;
        const end = 10000 + netPL;

        const netEl = document.getElementById('section-a-net');
        const retEl = document.getElementById('section-a-return');
        const balEl = document.getElementById('section-a-balance');
        if (netEl) netEl.textContent = (netPL >= 0 ? '+' : '−') + '$' + Math.abs(netPL).toLocaleString(undefined, { maximumFractionDigits: 0 });
        if (retEl) retEl.textContent = (retPct >= 0 ? '+' : '') + retPct.toFixed(1) + '%';
        if (balEl) balEl.textContent = '$' + end.toLocaleString(undefined, { maximumFractionDigits: 0 });
    }

    function init() {
        root.Ekantik.Data.onChange(state => {
            renderEdgeTriplet(state);
            renderLadder(state);
            renderEquityAndMonthly(state);
        });
        const s = root.Ekantik.Data.get();
        if (s.summary) { renderEdgeTriplet(s); renderLadder(s); renderEquityAndMonthly(s); }
        renderReshaper();
    }

    root.Ekantik = root.Ekantik || {};
    root.Ekantik.SectionA = { init };
})(typeof window !== 'undefined' ? window : globalThis);
