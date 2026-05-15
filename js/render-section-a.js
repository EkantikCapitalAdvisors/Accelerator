// =====================================================
// Section A — The Edge.
// Renders edge triplet (WR / PF / R-Exp), inline equity curve, and monthly P&L bars.
// Doubling Ladder and 5% Reshaper were removed in the Accelerator repositioning
// (they sold uncapped compounding, which directly contradicts the capacity cap).
// =====================================================
(function (root) {
    'use strict';

    function $(id) { return document.getElementById(id); }

    function renderEdgeTriplet(state) {
        const s = state.summary;
        if (!s || !s.n) return;
        $('edge-wr')     && ($('edge-wr').textContent = (s.winRate * 100).toFixed(1) + '%');
        $('edge-pf')     && ($('edge-pf').textContent = s.profitFactor === Infinity ? '∞' : s.profitFactor.toFixed(2));
        $('edge-rexp')   && ($('edge-rexp').textContent = (s.rExpectancy != null)
            ? ((s.rExpectancy >= 0 ? '+' : '') + s.rExpectancy.toFixed(2) + 'R')
            : '—');
        $('edge-wr-cap') && ($('edge-wr-cap').textContent = `Live · ${s.n} closed trades`);
        if ($('edge-rexp-cap') && s.evPerTrade != null) {
            $('edge-rexp-cap').textContent = `$${s.evPerTrade.toFixed(0)} per trade · live realized`;
        }
        if ($('edge-avgrisk')) {
            $('edge-avgrisk').textContent = (s.avgRiskDollar != null)
                ? '$' + Math.round(s.avgRiskDollar).toLocaleString()
                : '—';
        }
        if ($('edge-avgrisk-cap') && s.avgRiskDollar != null) {
            $('edge-avgrisk-cap').textContent = `1R ≈ $${Math.round(s.avgRiskDollar).toLocaleString()} · live realized`;
        }
    }

    function renderEquityAndMonthly(state) {
        const trades = state.trades || [];
        if (trades.length === 0) return;
        const eq = $('section-a-equity');
        const mo = $('section-a-monthly');
        if (eq && root.Ekantik.Charts) root.Ekantik.Charts.equityCurve(eq, trades, state.spyMonthly);
        if (mo && root.Ekantik.Charts) root.Ekantik.Charts.monthlyBars(mo, trades);

        const netPL = trades.reduce((s, t) => s + (t.dollar_pl || 0), 0);
        const retPct = (netPL / 20000) * 100;
        const end = 20000 + netPL;

        const netEl = $('section-a-net');
        const retEl = $('section-a-return');
        const balEl = $('section-a-balance');
        if (netEl) netEl.textContent = (netPL >= 0 ? '+' : '−') + '$' + Math.abs(netPL).toLocaleString(undefined, { maximumFractionDigits: 0 });
        if (retEl) retEl.textContent = (retPct >= 0 ? '+' : '') + retPct.toFixed(1) + '%';
        if (balEl) balEl.textContent = '$' + end.toLocaleString(undefined, { maximumFractionDigits: 0 });
    }

    function init() {
        root.Ekantik.Data.onChange(state => {
            renderEdgeTriplet(state);
            renderEquityAndMonthly(state);
        });
        const s = root.Ekantik.Data.get();
        if (s.summary) { renderEdgeTriplet(s); renderEquityAndMonthly(s); }
    }

    root.Ekantik = root.Ekantik || {};
    root.Ekantik.SectionA = { init };
})(typeof window !== 'undefined' ? window : globalThis);
