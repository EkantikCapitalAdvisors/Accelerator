// =====================================================
// §1.2 Where Edges Exist — data bindings (Rebuild Spec §4.2, §5.1)
// Populates the EV-formula display, the Ekantik row in the landscape
// table, and the live "last_update" timestamp. Bound to the same
// Discord trade feed every other live panel reads from.
// =====================================================
(function (root) {
    'use strict';

    // Operator config — surfaced in the EV display.
    // Per Rebuild Spec §5.1, these are static operator parameters.
    const DAILY_RISK_PCT = 1.5;  // % of working capital risked per day
    const RISK_BUDGET    = 300;  // $ risk budget per day
    const ES_POINT_VALUE = 50;   // ES = $50/pt, MES = $5/pt

    function bind(name, value) {
        document.querySelectorAll(`[data-bind="${name}"]`).forEach(el => {
            el.textContent = value;
        });
    }

    function fmtPct(v, dp = 1)  { return (v == null || !isFinite(v)) ? '—' : (v * 100).toFixed(dp) + '%'; }
    function fmtNum(v, dp = 0)  { return (v == null || !isFinite(v)) ? '—' : Number(v).toFixed(dp); }
    function fmtInt(v)          { return (v == null || !isFinite(v)) ? '—' : Math.round(v).toLocaleString(); }
    function fmtUSD(v)          { return (v == null || !isFinite(v)) ? '—' : Math.round(v).toLocaleString(); }
    function fmtSignedR(v)      { return (v == null || !isFinite(v)) ? '—' : (v >= 0 ? '+' : '') + v.toFixed(2) + 'R'; }
    function fmtSignedPts(v)    { return (v == null || !isFinite(v)) ? '—' : (v >= 0 ? '+' : '') + v.toFixed(2); }

    function parseTradeTime(t) {
        const raw = t.entry_time || t.entryTime || t.exit_time || t.exitTime;
        if (!raw) return null;
        let m = String(raw).match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
        if (m) return new Date(+m[1], +m[2] - 1, +m[3], +(m[4]||0), +(m[5]||0), +(m[6]||0));
        m = String(raw).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
        if (m) return new Date(+m[3], +m[1] - 1, +m[2]);
        const d = new Date(raw);
        return isNaN(d.getTime()) ? null : d;
    }

    // Half-Kelly per Rebuild Spec §5.1: (p − q/b) / 2
    // where p=win rate, q=1-p, b=avg_win/|avg_loss| (in same units).
    function halfKelly(p, b) {
        if (p == null || b == null || !isFinite(b) || b <= 0) return null;
        const q = 1 - p;
        return Math.max(0, ((p - q / b) / 2));
    }

    function render(state) {
        const trades = state.trades || [];
        const s      = state.summary || {};
        const n      = trades.length;
        if (!n) return;

        // ─── Aggregates from raw trades ───
        const wins   = trades.filter(t => (t.dollar_pl || 0) > 0);
        const losses = trades.filter(t => (t.dollar_pl || 0) < 0);
        const winsWithPts   = wins.filter(t => t.points_pl != null);
        const lossesWithPts = losses.filter(t => t.points_pl != null);
        const winsWithUSD   = wins.filter(t => t.dollar_pl != null);
        const lossesWithUSD = losses.filter(t => t.dollar_pl != null);

        const avgWinPts  = winsWithPts.length   ? winsWithPts.reduce((a,t) => a + t.points_pl, 0) / winsWithPts.length : null;
        const avgLossPts = lossesWithPts.length ? lossesWithPts.reduce((a,t) => a + t.points_pl, 0) / lossesWithPts.length : null;
        const avgWinUSD  = winsWithUSD.length   ? winsWithUSD.reduce((a,t) => a + t.dollar_pl, 0) / winsWithUSD.length : null;
        const avgLossUSD = lossesWithUSD.length ? lossesWithUSD.reduce((a,t) => a + t.dollar_pl, 0) / lossesWithUSD.length : null;

        const winRate  = s.winRate;          // 0..1
        const lossRate = winRate != null ? 1 - winRate : null;
        const edgeR    = s.rExpectancy;      // R-units
        const edgeUSD  = s.evPerTrade;       // $
        const wlRatio  = s.winLossR;         // |avg R win| / |avg R loss|

        // Weighted contributions
        const weightedWin  = (winRate  != null && avgWinPts  != null) ? winRate  * avgWinPts            : null;
        const weightedLoss = (lossRate != null && avgLossPts != null) ? lossRate * Math.abs(avgLossPts) : null;
        const edgePts      = (weightedWin != null && weightedLoss != null) ? (weightedWin - weightedLoss) : null;

        // ─── Bind EV equation panel ───
        bind('win_rate_pct',    fmtPct(winRate, 1));
        bind('win_rate_short',  fmtPct(winRate, 1).replace('%', ''));
        bind('loss_rate_short', fmtPct(lossRate, 1).replace('%', ''));
        bind('wins',            String(wins.length));
        bind('losses',          String(losses.length));
        bind('avg_win_pts',     avgWinPts  != null ? '+' + avgWinPts.toFixed(2) + ' pts'  : '—');
        bind('avg_loss_pts',    avgLossPts != null ? avgLossPts.toFixed(2) + ' pts' : '—');
        bind('avg_win_pts_short',  avgWinPts  != null ? avgWinPts.toFixed(2) : '—');
        bind('avg_loss_pts_short', avgLossPts != null ? Math.abs(avgLossPts).toFixed(2) : '—');
        bind('avg_win_usd',     avgWinUSD  != null ? fmtUSD(avgWinUSD)  : '—');
        bind('avg_loss_usd',    avgLossUSD != null ? fmtUSD(Math.abs(avgLossUSD)) : '—');
        bind('weighted_win',    fmtSignedPts(weightedWin));
        bind('weighted_loss',   fmtSignedPts(weightedLoss));
        bind('edge_pts',        fmtSignedPts(edgePts));
        bind('edge_R',          edgeR != null ? edgeR.toFixed(2) : '—');
        bind('edge_R_short',    edgeR != null ? edgeR.toFixed(2) : '—');
        bind('edge_usd',        edgeUSD != null ? fmtUSD(edgeUSD) : '—');
        bind('edge_usd_short',  edgeUSD != null ? fmtUSD(edgeUSD) : '—');
        bind('daily_risk_pct',  String(DAILY_RISK_PCT));
        bind('trade_count',     String(n));
        bind('risk_budget',     String(RISK_BUDGET));
        bind('wl_ratio',        wlRatio != null && isFinite(wlRatio) ? wlRatio.toFixed(2) : '—');

        // ─── Ekantik row in the landscape table ───
        // trades/mo + annual R extrapolated from live cadence
        const times = trades.map(parseTradeTime).filter(Boolean).sort((a,b) => a - b);
        let tradesPerMo = null, annualR = null;
        if (times.length >= 2) {
            const daysElapsed = (times[times.length - 1] - times[0]) / 86400000;
            if (daysElapsed >= 7) {
                tradesPerMo = (n / daysElapsed) * 30.4375;
                if (edgeR != null) annualR = (n / daysElapsed) * 365 * edgeR;
            }
        }
        bind('trades_per_mo', tradesPerMo != null ? Math.round(tradesPerMo).toString() : '—');
        bind('annual_R',      annualR    != null ? Math.round(annualR).toString()    : '—');

        // ½ Kelly from live win-rate + W/L ratio
        const hk = halfKelly(winRate, wlRatio);
        bind('half_kelly', hk != null ? (hk * 100).toFixed(1) : '—');

        // Update Ekantik's data-annual-r attribute so the table sort reflects live cadence.
        const ekantikRow = document.querySelector('.landscape tr[data-ekantik]');
        if (ekantikRow) ekantikRow.setAttribute('data-annual-r', annualR != null ? annualR.toFixed(1) : '0');

        // Sort the landscape tbody by Annual R, descending. Stable: ties preserve doc order.
        const tbody = document.querySelector('.landscape tbody');
        if (tbody) {
            const rows = Array.from(tbody.querySelectorAll('tr'));
            rows
                .map((r, i) => ({ r, i, v: parseFloat(r.getAttribute('data-annual-r') || '0') }))
                .sort((a, b) => (b.v - a.v) || (a.i - b.i))
                .forEach(({ r }) => tbody.appendChild(r));
        }

        // Last update stamp
        if (times.length) {
            const last = times[times.length - 1];
            bind('last_update', last.toLocaleDateString(undefined, { year:'numeric', month:'short', day:'numeric' }));
        }
    }

    function init() {
        if (!document.getElementById('edges')) return;
        if (!root.Ekantik || !root.Ekantik.Data) return;
        root.Ekantik.Data.onChange(render);
        const cur = root.Ekantik.Data.get();
        if (cur && cur.summary) render(cur);
    }

    root.Ekantik = root.Ekantik || {};
    root.Ekantik.Edges = { init, render };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})(typeof window !== 'undefined' ? window : globalThis);
