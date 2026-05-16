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

        // R-multiple asymmetry strip
        const fmtRsigned = v => v == null ? '—' : (v >= 0 ? '+' : '') + v.toFixed(2) + 'R';
        if ($('r-asym-win'))  $('r-asym-win').textContent  = fmtRsigned(s.avgRwin);
        if ($('r-asym-loss')) $('r-asym-loss').textContent = fmtRsigned(s.avgRloss);
        if ($('r-asym-ratio')) {
            $('r-asym-ratio').textContent = (s.winLossR != null && isFinite(s.winLossR))
                ? s.winLossR.toFixed(2) + ' : 1'
                : '—';
        }
        if ($('r-asym-win-sub')  && s.avgRwin  != null && s.avgRiskDollar != null) {
            $('r-asym-win-sub').textContent  = `≈ $${Math.round(s.avgRwin  * s.avgRiskDollar).toLocaleString()} per winning trade`;
        }
        if ($('r-asym-loss-sub') && s.avgRloss != null && s.avgRiskDollar != null) {
            $('r-asym-loss-sub').textContent = `≈ $${Math.round(s.avgRloss * s.avgRiskDollar).toLocaleString()} per losing trade`;
        }

        // Annualized trajectory — linear extrapolation from live cadence.
        renderAnnualProjection(state);

        // Dynamic narrative — present asymmetry as a structural fact. No
        // fictional backtest baseline (there is no backtest; live fills are
        // the entire sample). The R-ratio is the load-bearing number.
        const lede = $('r-asym-lede');
        if (lede && s.winLossR != null && s.rExpectancy != null && s.winRate != null) {
            const wrPct = (s.winRate * 100).toFixed(1);
            lede.innerHTML = `The average winner outpaces the average loser by <strong>${s.winLossR.toFixed(2)}:1</strong> in R-units. That ratio &mdash; not the win rate alone &mdash; is what drives R-expectancy. At a ${wrPct}% win rate, the strategy is currently producing <strong>${fmtRsigned(s.rExpectancy)}</strong> per trade because losses are being cut at a smaller R than wins are being held. Win rate and R-multiple are independent dials; the page shows both because both matter.`;
        }
    }

    // Threshold above which we drop 'pending statistical confirmation'.
    // Mirrors the early-stability bar surfaced in the Gauntlet section.
    const CONFIRMATION_TRADE_THRESHOLD = 100;

    function parseTradeTime(t) {
        const raw = t.entry_time || t.entryTime || t.exit_time || t.exitTime;
        if (!raw) return null;
        // Tolerate the same formats KPIs._parseTS handles
        let m = String(raw).match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
        if (m) return new Date(+m[1], +m[2] - 1, +m[3], +(m[4]||0), +(m[5]||0), +(m[6]||0));
        m = String(raw).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
        if (m) return new Date(+m[3], +m[1] - 1, +m[2]);
        const d = new Date(raw);
        return isNaN(d.getTime()) ? null : d;
    }

    function renderAnnualProjection(state) {
        const trades  = state.trades || [];
        const s       = state.summary || {};
        const tradesEl = $('annual-trades');
        const rEl      = $('annual-r');
        const plEl     = $('annual-pl');
        const headline = $('annual-proj-headline');
        const trSub    = $('annual-trades-sub');
        const rSub     = $('annual-r-sub');
        const plSub    = $('annual-pl-sub');
        if (!tradesEl && !headline) return;

        const n = trades.length;
        const times = trades.map(parseTradeTime).filter(Boolean).sort((a,b) => a - b);
        if (n < 3 || times.length < 2) {
            [tradesEl, rEl, plEl].forEach(el => el && (el.textContent = '—'));
            if (headline) headline.textContent = 'Need a longer live sample before extrapolation is meaningful.';
            return;
        }

        const daysElapsed = (times[times.length - 1] - times[0]) / (1000 * 60 * 60 * 24);
        if (daysElapsed < 7) {
            [tradesEl, rEl, plEl].forEach(el => el && (el.textContent = '—'));
            if (headline) headline.textContent = 'Need at least one week of calendar time before extrapolating annual cadence.';
            return;
        }

        const tradesPerYear = (n / daysElapsed) * 365;
        const annualR  = (s.rExpectancy != null) ? tradesPerYear * s.rExpectancy : null;
        const annualPL = (s.evPerTrade  != null) ? tradesPerYear * s.evPerTrade  : null;
        const annualPctOnBase = annualPL != null ? (annualPL / 20000) * 100 : null;

        if (tradesEl) tradesEl.textContent = '~' + Math.round(tradesPerYear);
        if (rEl)      rEl.textContent      = annualR  != null ? '~' + (annualR >= 0 ? '+' : '') + annualR.toFixed(0) + 'R' : '—';
        if (plEl)     plEl.textContent     = annualPL != null ? (annualPL >= 0 ? '+$' : '-$') + Math.abs(Math.round(annualPL)).toLocaleString() : '—';

        if (trSub) trSub.textContent = `${n} closed trades over ${Math.round(daysElapsed)} days → annualized`;
        if (rSub && s.rExpectancy != null && annualR != null) {
            rSub.textContent = `${(s.rExpectancy >= 0 ? '+' : '')}${s.rExpectancy.toFixed(2)}R/trade × ~${Math.round(tradesPerYear)} trades`;
        }
        if (plSub && s.evPerTrade != null && annualPctOnBase != null) {
            plSub.textContent = `$${s.evPerTrade.toFixed(0)}/trade × ~${Math.round(tradesPerYear)} trades · ${annualPctOnBase.toFixed(0)}% on $20K base, fixed risk`;
        }

        // Headline — defensible single-line read.
        if (headline) {
            const rTxt = annualR != null
                ? `~${(annualR >= 0 ? '+' : '')}${annualR.toFixed(0)}R annualized`
                : '';
            const plTxt = annualPL != null
                ? `≈ $${Math.round(annualPL).toLocaleString()} on a fixed $20K base`
                : '';
            const tail = n >= CONFIRMATION_TRADE_THRESHOLD
                ? 'Sample has crossed the early-stability threshold; trajectory is statistically supported.'
                : `Pending statistical confirmation at the ~${CONFIRMATION_TRADE_THRESHOLD}-trade and 8-test thresholds.`;
            const rExpTxt = s.rExpectancy != null ? `tracking ${fmtRsigned(s.rExpectancy)}/trade` : 'in progress';
            headline.innerHTML = `<strong>Live edge through ${n} trades is ${rExpTxt}, ${rTxt} at current cadence${plTxt ? ' ' + plTxt : ''}.</strong> ${tail}`;
        }
    }

    // Reusable formatter (R-asymmetry block also imports this name).
    function fmtRsigned(v) { return v == null ? '—' : (v >= 0 ? '+' : '') + v.toFixed(2) + 'R'; }

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
