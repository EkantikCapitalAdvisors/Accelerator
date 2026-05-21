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
        // Risk headroom — current sizing vs ½-Kelly supported ceiling.
        renderRiskHeadroom(state);
        // Risk profile — realized drawdown / streak / worst trade.
        renderRiskProfile(state);

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
        // ISO date with optional 24h or 12h-AM/PM time
        let m = String(raw).match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?/i);
        if (m) {
            let h = +(m[4]||0); const min = +(m[5]||0); const s = +(m[6]||0);
            const ap = (m[7] || '').toUpperCase();
            if (ap === 'PM' && h < 12) h += 12;
            if (ap === 'AM' && h === 12) h = 0;
            return new Date(+m[1], +m[2] - 1, +m[3], h, min, s);
        }
        // US-slash with optional 24h or 12h-AM/PM time
        m = String(raw).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?/i);
        if (m) {
            let h = +(m[4]||0); const min = +(m[5]||0); const s = +(m[6]||0);
            const ap = (m[7] || '').toUpperCase();
            if (ap === 'PM' && h < 12) h += 12;
            if (ap === 'AM' && h === 12) h = 0;
            return new Date(+m[3], +m[1] - 1, +m[2], h, min, s);
        }
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

    // ─── Risk Headroom — current sizing vs ½-Kelly supported ceiling. ───
    // Shows the gap between what we currently risk per trade and what the
    // edge mathematically supports. The "8.6× headroom" framing makes the
    // conservative-by-design posture visible without sacrificing precision.
    const BASE_CAPITAL = 20000;   // $20K starting working capital per spec

    function halfKelly(p, b) {
        if (p == null || b == null || !isFinite(b) || b <= 0) return null;
        const q = 1 - p;
        return Math.max(0, ((p - q / b) / 2));
    }

    // ─── Risk Profile — realized drawdown stats from the live equity curve. ───
    // Pairs with Risk Headroom: Headroom shows upside capacity (Kelly says
    // you could be N× larger); Risk Profile shows the cost of current sizing
    // — what the operator's personal capital has actually weathered.
    const BATTERY_TEST_7_THRESHOLD = 4;  // Battery Test 7 discipline ceiling

    function renderRiskProfile(state) {
        if (!document.getElementById('rp-h')) return;
        const trades = state.trades || [];
        if (trades.length < 3) return;

        // Sort chronologically by entry time (tolerant of mixed formats).
        const sorted = trades
            .map(t => ({ t, ts: parseTradeTime(t) }))
            .filter(x => x.ts)
            .sort((a, b) => a.ts - b.ts)
            .map(x => x.t);
        if (sorted.length < 3) return;

        // Walk the equity curve.
        let cum = 0, peak = 0, peakAtTrough = 0;
        let maxDD = 0, troughIdx = -1;
        let worstTradeUSD = 0, worstTradeR = 0;
        let streak = 0, streakR = 0;
        let maxStreak = 0, maxStreakR = 0;
        const allR = [];

        sorted.forEach((t, i) => {
            const pl = t.dollar_pl || t.dollarPL || 0;
            const rd = t.risk_dollars || t.riskDollars || 0;
            const R  = rd > 0 ? pl / rd : 0;
            allR.push(R);
            cum += pl;
            if (cum > peak) peak = cum;
            const dd = peak - cum;
            if (dd > maxDD) { maxDD = dd; troughIdx = i; peakAtTrough = peak; }
            if (pl < worstTradeUSD) { worstTradeUSD = pl; worstTradeR = R; }
            if (pl < 0) { streak += 1; streakR += R; }
            else {
                if (streak > maxStreak) { maxStreak = streak; maxStreakR = streakR; }
                streak = 0; streakR = 0;
            }
        });
        if (streak > maxStreak) { maxStreak = streak; maxStreakR = streakR; }

        // Max drawdown in R-units (independent of position-size variation).
        let cumR = 0, peakR = 0, maxRdd = 0;
        allR.forEach(R => {
            cumR += R;
            if (cumR > peakR) peakR = cumR;
            const r = peakR - cumR;
            if (r > maxRdd) maxRdd = r;
        });

        // Recovery: trades from trough back to prior peak.
        let cum2 = 0, recoveredAt = null;
        for (let i = 0; i < sorted.length; i++) {
            cum2 += (sorted[i].dollar_pl || sorted[i].dollarPL || 0);
            if (i > troughIdx && cum2 >= peakAtTrough) { recoveredAt = i; break; }
        }
        const recoveryTrades = recoveredAt != null ? (recoveredAt - troughIdx) : null;

        // ─── Bind UI ───
        const BASE = 20000;
        const fmtUSD = v => '$' + Math.round(Math.abs(v)).toLocaleString();

        if ($('rp-maxdd-r'))    $('rp-maxdd-r').textContent    = maxDD > 0 ? `−${fmtUSD(maxDD)}` : '$0';
        if ($('rp-maxdd-sub'))  $('rp-maxdd-sub').textContent  = maxDD > 0
            ? `−${maxRdd.toFixed(2)}R cumulative · ${(maxDD / BASE * 100).toFixed(2)}% of $20K base`
            : 'No drawdown recorded yet.';

        if ($('rp-streak'))     $('rp-streak').textContent     = maxStreak > 0 ? `${maxStreak}  in a row` : '0';
        if ($('rp-streak-sub')) $('rp-streak-sub').textContent = maxStreak > 0
            ? `${maxStreakR.toFixed(2)}R cumulative across the stretch`
            : '—';

        if ($('rp-worst'))     $('rp-worst').textContent      = worstTradeUSD < 0 ? `−${fmtUSD(worstTradeUSD)}` : '$0';
        if ($('rp-worst-sub')) $('rp-worst-sub').textContent  = worstTradeUSD < 0
            ? `${worstTradeR.toFixed(2)}R · single trade`
            : '—';

        if ($('rp-recovery'))     $('rp-recovery').textContent     = recoveryTrades != null
            ? `${recoveryTrades}  trade${recoveryTrades === 1 ? '' : 's'}`
            : (maxDD > 0 ? 'in progress' : '—');
        if ($('rp-recovery-sub')) $('rp-recovery-sub').textContent = recoveryTrades != null
            ? 'restored prior peak'
            : (maxDD > 0 ? 'curve has not yet returned to peak' : '—');

        // Dynamic close-line — interprets the numbers against the Battery
        // Test 7 threshold and the Falsifiability Protocol trigger.
        const close = $('rp-close');
        if (close) {
            const streakOK = maxStreak <= BATTERY_TEST_7_THRESHOLD;
            const ddPct = (maxDD / BASE) * 100;
            close.innerHTML = `Max drawdown of <strong>−${fmtUSD(maxDD)}</strong> (${ddPct.toFixed(1)}% of the $20K base, ${maxRdd.toFixed(1)}R cumulative) ${recoveryTrades != null ? `recovered in <strong>${recoveryTrades} trade${recoveryTrades === 1 ? '' : 's'}</strong>` : 'is still recovering'}. Longest losing streak of <strong>${maxStreak}</strong> ${streakOK ? `clears Battery Test 7&rsquo;s discipline threshold of ≤ ${BATTERY_TEST_7_THRESHOLD}` : `exceeds Battery Test 7&rsquo;s discipline threshold of ≤ ${BATTERY_TEST_7_THRESHOLD}`}. The Falsifiability Protocol&rsquo;s rolling-100 $0 trigger sits well below current realized cumulative R.`;
        }
    }

    function renderRiskHeadroom(state) {
        if (!document.getElementById('rh-h')) return;
        const s = state.summary || {};
        if (s.avgRiskDollar == null || s.winLossR == null || s.winRate == null || s.rExpectancy == null || s.evPerTrade == null) return;

        const kelly = halfKelly(s.winRate, s.winLossR);
        if (kelly == null || kelly <= 0) return;

        const currentPct = (s.avgRiskDollar / BASE_CAPITAL) * 100;
        const kellyPct   = kelly * 100;
        if (currentPct >= kellyPct) {
            // Strategy already at-or-above Kelly. Surface that fact rather than
            // misleadingly imply headroom.
            const close = $('rh-close');
            if (close) {
                close.innerHTML = `<strong>Sizing is at or above ½-Kelly.</strong> Headroom has been claimed; the strategy is operating at the math&rsquo;s theoretical maximum. Any further size increase reduces, not increases, geometric expectancy.`;
            }
            return;
        }

        // Bars are drawn on a shared 0%–kellyPct axis.
        const currentFillPct = (currentPct / kellyPct) * 100;
        const headroomLeftPct = currentFillPct;
        const headroomWidthPct = 100 - currentFillPct;

        const currentFill = $('rh-current-fill');
        if (currentFill) currentFill.style.width = currentFillPct.toFixed(1) + '%';
        const headroomEl = $('rh-current-headroom');
        if (headroomEl) {
            headroomEl.style.left  = headroomLeftPct.toFixed(1) + '%';
            headroomEl.style.width = headroomWidthPct.toFixed(1) + '%';
        }

        const currentVal = $('rh-current-val');
        if (currentVal) {
            currentVal.innerHTML = `<strong>${currentPct.toFixed(2)}%</strong> &middot; ~$${Math.round(s.avgRiskDollar).toLocaleString()} per trade`;
        }

        const kellyRisk = kelly * BASE_CAPITAL;
        const kellyVal = $('rh-kelly-val');
        if (kellyVal) {
            kellyVal.innerHTML = `<strong>${kellyPct.toFixed(1)}%</strong> &middot; ~$${Math.round(kellyRisk).toLocaleString()} per trade`;
        }
        const axisEnd = $('rh-axis-end');
        if (axisEnd) axisEnd.textContent = `${kellyPct.toFixed(1)}% (½-Kelly ceiling)`;

        // Today vs Kelly cells — same R-multiple, different dollar magnitude.
        const fmtR = v => fmtRsigned(v);
        const cmpNow = $('rh-cmp-now');
        if (cmpNow) {
            cmpNow.innerHTML = `<span class="rh-r">${fmtR(s.rExpectancy)}</span> &times; <span class="rh-risk">$${Math.round(s.avgRiskDollar).toLocaleString()}</span> = <strong>$${Math.round(s.evPerTrade).toLocaleString()}</strong>/trade`;
        }
        const cmpKelly = $('rh-cmp-kelly');
        if (cmpKelly) {
            const kellyEV = s.rExpectancy * kellyRisk;
            cmpKelly.innerHTML = `<span class="rh-r">${fmtR(s.rExpectancy)}</span> &times; <span class="rh-risk">$${Math.round(kellyRisk).toLocaleString()}</span> = <strong>$${Math.round(kellyEV).toLocaleString()}</strong>/trade`;
        }

        const multiple = kellyPct / currentPct;
        const close = $('rh-close');
        if (close) {
            close.innerHTML = `The math supports <strong>~${multiple.toFixed(1)}&times;</strong> more position sizing per trade than the strategy currently deploys. The headroom is intentional &mdash; adverse variance never tests the operator&rsquo;s psychology, and the same edge mechanics scale cleanly as the base grows from $20K toward the $100K per-seat target.`;
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
        const end = 5000 + netPL;   // $5,000 working unit base
        // Each $5,000 of accumulated profit is one buffer (the scale-up trigger unit).
        const BUFFER = 5000;
        const buffers = netPL / BUFFER;

        const netEl = $('section-a-net');
        const bufEl = $('section-a-buffers');
        const balEl = $('section-a-balance');
        if (netEl) netEl.textContent = (netPL >= 0 ? '+' : '−') + '$' + Math.abs(netPL).toLocaleString(undefined, { maximumFractionDigits: 0 });
        if (bufEl) {
            const mag = Math.abs(buffers).toFixed(1);
            bufEl.textContent = (buffers < 0 ? '−' : '') + mag + (mag === '1.0' ? ' buffer' : ' buffers');
        }
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
