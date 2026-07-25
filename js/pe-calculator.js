// =====================================================
// Synthetic PE calculator (leverage model) — index (thesis) page.
// The PE machine made literal: borrow (synthetic leverage), split the
// proceeds into an INCOME sleeve (Cash-Flow Engine — monthly yield that
// services the debt) and a COMPOUNDING sleeve (Compounding Engine — run at
// the ~26% CAGR design pace, ≈10× over a decade). Income covers the carry; compounding
// builds equity; at payoff you own the de-levered, multiplied portfolio.
// Amortized vs interest-only; Standard vs Max-Personal-Use draw.
// Hypothetical and illustrative. NOT a forecast or advice to borrow.
// =====================================================
(function (root) {
    'use strict';
    const $ = id => document.getElementById(id);
    if (!$('pe-borrow')) return;

    let mode = 'standard';   // standard | max
    let strat = 'amort';     // amort | io
    const COV_FLOOR = 0.25;  // serviceability floor used to size Max Personal Use

    // All leverage math lives in the shared engine (js/synthetic-pe-engine.js) so the
    // calculator and the HELOC worked example can never drift apart.
    const compute = p => root.SyntheticPE.compute(Object.assign({}, p, { strat: strat }));

    // Ekantik's fee for structuring and running this leverage arrangement is
    // negotiated individually per participant and is not published on this page.
    // The IRR column below is net of an industry-standard program-fee assumption
    // (see the fine print under the Projections table) so the figure reflects a
    // real cost of capital rather than a gross, unrealistic number. It stacks on
    // top of whatever one-time HELOC cost the visitor enters above — a separate
    // cost, paid to their own lender.
    const PROGRAM_MGMT_PCT = 2;    // annual, % of invested capital, deducted monthly
    const PROGRAM_CARRY_PCT = 20;  // contingent on reaching the goal (full term)
    function programFeeIRR(p, yr) {
        const pp = Object.assign({}, p, { mgmtPct: PROGRAM_MGMT_PCT, carryPct: PROGRAM_CARRY_PCT });
        return compute(pp).proj(yr).irr;
    }
    function fmtIRR(irr) {
        return irr == null ? '—' : Math.round(irr) + '%';
    }

    const fmtUSD = v => (v < 0 ? '−$' : '$') + Math.abs(Math.round(v)).toLocaleString();
    const fmtK = v => { const a = Math.abs(v); return a >= 1000 ? (v < 0 ? '−$' : '$') + (a / 1000).toFixed(a >= 100000 ? 0 : 0) + 'k' : fmtUSD(v); };
    const fmtKx = v => { const a = Math.abs(v); return a >= 1000 ? (v < 0 ? '−$' : '$') + (a / 1000).toFixed(a >= 10000 ? 0 : 1) + 'k' : fmtUSD(v); };

    function readVals() {
        const num = (id, d) => { const v = parseFloat($(id).value); return isFinite(v) ? v : d; };
        return {
            borrow: Math.max(0, num('pe-borrow', 50000)),
            pu: Math.max(0, num('pe-pu', 0)),
            rate: Math.max(0, num('pe-rate', 8)),
            term: Math.max(1, num('pe-term', 7)),
            yield: Math.max(0, num('pe-yield', 2)),
            cagr: Math.max(0, num('pe-cagr', 26)),
            comp: Math.min(100, Math.max(0, num('pe-comp', 20))),
            reserves: Math.max(0, num('pe-reserves', 6)),
            fees: Math.max(0, num('pe-fees', 0))
        };
    }


    function maxPersonalUse(p) {
        // largest draw that keeps coverage ≥ floor (coverage falls linearly with pu; pmt is pu-independent)
        const r = p.rate / 100 / 12, n = Math.round(p.term * 12);
        const pmt = strat === 'amort' ? (r > 0 ? p.borrow * r / (1 - Math.pow(1 + r, -n)) : p.borrow / n) : p.borrow * r;
        const incFrac = (1 - p.comp / 100) * p.yield / 100;
        if (incFrac <= 0) return 0;
        const minInvested = COV_FLOOR * pmt / incFrac;
        return Math.max(0, Math.round((p.borrow - minInvested) / 2500) * 2500);
    }

    function lineChart(c) {
        const W = 560, H = 230, padL = 8, padR = 8, padT = 12, padB = 22, n = c.n;
        const maxY = Math.max.apply(null, c.series.map(s => s.port)) || 1;
        const x = m => padL + (W - padL - padR) * (m / n);
        const y = v => (H - padB) - (H - padT - padB) * (Math.max(0, v) / maxY);
        const path = (key, close) => {
            let d = 'M' + x(0).toFixed(1) + ',' + y(c.series[0][key]).toFixed(1);
            for (let i = 1; i < c.series.length; i++) d += ' L' + x(c.series[i].m).toFixed(1) + ',' + y(c.series[i][key]).toFixed(1);
            if (close) d += ' L' + x(n).toFixed(1) + ',' + (H - padB) + ' L' + x(0).toFixed(1) + ',' + (H - padB) + ' Z';
            return d;
        };
        // year gridlines
        let grid = '';
        for (let yr = 0; yr * 12 <= n; yr++) {
            const xi = x(yr * 12);
            grid += '<line x1="' + xi.toFixed(1) + '" y1="' + padT + '" x2="' + xi.toFixed(1) + '" y2="' + (H - padB) + '" stroke="rgba(148,163,184,0.07)" stroke-width="1"/>' +
                '<text x="' + xi.toFixed(1) + '" y="' + (H - 7) + '" text-anchor="middle" font-family="JetBrains Mono,monospace" font-size="8.5" fill="#6B7A93">Yr ' + yr + '</text>';
        }
        $('pe-chart').innerHTML =
            '<defs><linearGradient id="peNe" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#6FB77F" stop-opacity="0.20"/><stop offset="100%" stop-color="#6FB77F" stop-opacity="0"/></linearGradient></defs>' +
            grid +
            '<path d="' + path('ne', true) + '" fill="url(#peNe)"/>' +
            '<path d="' + path('port', false) + '" fill="none" stroke="#5B7BB4" stroke-width="2"/>' +
            '<path d="' + path('ne', false) + '" fill="none" stroke="#6FB77F" stroke-width="2"/>' +
            '<path d="' + path('debt', false) + '" fill="none" stroke="#D98A8A" stroke-width="1.6" stroke-dasharray="5 4"/>';
    }

    function render() {
        const p = readVals();
        if (mode === 'max') { const mpu = maxPersonalUse(p); if (mpu !== p.pu) { $('pe-pu').value = mpu; p.pu = mpu; } }

        const c = compute(p);

        // headline cards
        $('pe-borrowed').textContent = fmtUSD(p.borrow);
        $('pe-invested').textContent = fmtUSD(c.invested);
        $('pe-pmt').textContent = fmtUSD(c.pmt);
        $('pe-income').textContent = fmtUSD(c.income);
        $('pe-coverage').textContent = c.coverage.toFixed(1) + 'x';
        $('pe-oop').textContent = fmtUSD(c.oop);
        $('pe-card-cov').classList.toggle('warn', c.coverage < 1);

        // payoff summary
        $('pe-interest').textContent = fmtUSD(c.totInt);
        $('pe-cost').textContent = fmtUSD(c.totCost);
        $('pe-payoff').textContent = strat === 'amort' ? (p.term + 'y 0m') : (p.term + 'y (term)');
        $('pe-wealth').textContent = fmtKx(c.wealth);
        const compPct = c.invested > 0 ? c.comp0 / c.invested * 100 : 0;
        // payoff-summary breakdown is THREE-way over total committed (compounding / income / reserve)
        const total3 = c.comp0 + c.inc0 + c.reservesDollar;
        const cP = total3 > 0 ? c.comp0 / total3 * 100 : 0;
        const iP = total3 > 0 ? c.inc0 / total3 * 100 : 0;
        const rP = total3 > 0 ? c.reservesDollar / total3 * 100 : 0;
        $('pe-split-comp').style.width = cP + '%';
        $('pe-split-inc').style.width = iP + '%';
        if ($('pe-split-res')) $('pe-split-res').style.width = rP + '%';
        $('pe-split-comp-l').textContent = fmtUSD(c.comp0) + ' (' + Math.round(cP) + '%)';
        $('pe-split-inc-l').textContent = fmtUSD(c.inc0) + ' (' + Math.round(iP) + '%)';
        if ($('pe-split-res-l')) $('pe-split-res-l').textContent = fmtUSD(c.reservesDollar) + ' (' + Math.round(rP) + '%)';

        // derived (config)
        $('pe-netinvested').textContent = fmtUSD(c.invested);
        $('pe-alloc').textContent = Math.round(compPct) + '% comp / ' + Math.round(100 - compPct) + '% inc';
        $('pe-sleeve-comp').style.width = compPct + '%';
        $('pe-sleeve-inc').style.width = (100 - compPct) + '%';

        // chart
        lineChart(c);

        // projections
        const yrs = Array.from(new Set([3, 5, p.term].filter(v => v <= p.term))).sort((a, b) => a - b);
        if (yrs[yrs.length - 1] !== p.term) yrs.push(p.term);
        $('pe-proj-body').innerHTML = yrs.map(yr => {
            const r = c.proj(yr), term = (yr === p.term);
            const irrCell = fmtIRR(programFeeIRR(p, yr));
            return '<tr' + (term ? ' class="hl"' : '') + '><td>' + (term ? '🏆 ' : '') + yr + 'Y</td>' +
                '<td class="gold">' + fmtKx(r.ne) + '</td><td>' + fmtKx(r.port) + '</td>' +
                '<td' + (r.debt <= 1 ? ' class="pos"' : '') + '>' + (r.debt <= 1 ? '$0' : fmtKx(r.debt)) + '</td>' +
                '<td class="pos">' + irrCell + '</td><td>' + r.mult.toFixed(1) + 'x</td></tr>';
        }).join('');

        // vs-traditional comparison table — Target IRR row, live from this same engine
        // so it can never drift from what the calculator above actually shows.
        if ($('vt-irr-synth')) {
            const goalIrr = programFeeIRR(p, p.term);
            $('vt-irr-synth').textContent = goalIrr == null ? '—' : '~' + Math.round(goalIrr) + '%*';
        }

        // architecture
        $('pe-arch-lev').textContent = fmtUSD(p.borrow) + ' at ' + p.rate + '%' + (p.pu > 0 ? ' · ' + fmtUSD(p.pu) + ' personal use' : '');
        $('pe-arch-inc').textContent = fmtUSD(c.inc0) + ' → ' + fmtUSD(c.income) + '/mo (' + p.yield + '%/mo)';
        $('pe-arch-comp').textContent = fmtUSD(c.comp0) + ' → ' + p.cagr + '% CAGR';

        // guardrails
        const ok = '<span class="ok">✓</span>', no = '<span class="no">✗</span>';
        $('pe-g-cov').innerHTML = (c.coverage >= 1 ? ok : no) + ' Coverage ≥ 1x (' + c.coverage.toFixed(2) + 'x)';
        $('pe-g-oop').innerHTML = (c.oop <= c.income ? ok : no) + ' Out-of-pocket: ' + fmtUSD(c.oop) + '/mo';
        $('pe-g-res').innerHTML = (p.reserves >= 3 ? ok : no) + ' Reserves: ' + p.reserves + 'mo (' + fmtUSD(c.reservesDollar) + ')';
        if ($('pe-g-fees')) {
            $('pe-g-fees').innerHTML = '◦ Fees: ' + fmtUSD(c.feesDollar) + ' one-time' +
                (c.feesDollar > 0 ? ' (sunk — lowers IRR, not returned at exit)' : ' (closing costs — add your lender\'s real number ↑)');
        }

        $('pe-formula').innerHTML =
            '<b>How it computes:</b> you borrow ' + fmtUSD(p.borrow) + ' at ' + p.rate + '% over ' + p.term + ' years and invest ' + fmtUSD(c.invested) +
            ' — split <b style="color:#7E9CC4">' + Math.round(compPct) + '% into the compounding sleeve</b> (grows at ' + p.cagr + '% CAGR) and <b style="color:#6FB77F">' + Math.round(100 - compPct) + '% into the income sleeve</b> (yields ' + p.yield + '%/mo = ' + fmtUSD(c.income) + '/mo). ' +
            'The income services the debt; the shortfall (' + fmtUSD(c.oop) + '/mo out of pocket) is your carry. ' +
            (strat === 'amort' ? 'Amortized: the loan is paid to $0 by the term, so at payoff net equity = the full portfolio.' : 'Interest-only: only interest is paid, so the full principal balloons at the term — a real obligation to refinance or repay from the portfolio, not a free ride.') +
            ' Multiple = portfolio ÷ invested. <b>IRR is the true levered return</b> — money-weighted on the cash you actually commit (' + (c.feesDollar > 0 ? 'fees + reserves up front, monthly carry' : 'reserves up front, monthly carry') + ') versus the net equity realized. That committed-cash base is small when coverage is near 1× — often just the reserve (and any fees) — which is what pushes IRR well above the ' + p.cagr + '% asset CAGR, not the rate spread alone. ' +
            '<b>This is also why dragging the compounding allocation up can lower IRR, not raise it:</b> more into the compounding sleeve means less into the income sleeve that funds the loan payment, so more of that payment shifts to your own pocket every month — coverage here is ' + c.coverage.toFixed(2) + 'x' + (c.oop > 0 ? ' (' + fmtUSD(c.oop) + '/mo out of pocket)' : '') + '. A bigger, longer-held cash commitment lowers the rate of return on that cash even as the portfolio it buys grows larger — IRR is a rate on your money, not a score for the deal\'s size. <b>Leverage amplifies in both directions.</b> ' +
            (c.feesDollar > 0
                ? 'The ' + fmtUSD(c.feesDollar) + ' one-time fee above is subtracted at drawdown and never returned, so it lowers IRR directly — a larger share of a smaller committed-cash base. '
                : 'No one-time fees are assumed here; a HELOC\'s real closing costs would subtract from the committed-cash base and lower IRR — add them above to see the effect. ') +
            '<b>The reality these smooth lines omit:</b> real returns arrive with volatility, not as a curve. A ' + p.cagr + '% CAGR sustained for ' + p.term + ' years is an aspirational, unproven assumption; the compounding engine has no live record yet. With leverage, an ordinary drawdown can trigger a margin call or forced deleveraging and can wipe the equity — loss beyond the capital invested is possible. Hypothetical and illustrative; not a forecast, projection, or advice to borrow or trade.';
    }

    function bindToggle(aId, bId, set) {
        const a = $(aId), b = $(bId);
        a.addEventListener('click', () => { set(a, b); render(); });
        b.addEventListener('click', () => { set(b, a); render(); });
    }
    bindToggle('pe-mode-standard', 'pe-mode-max', (on, off) => {
        on.classList.add('on'); off.classList.remove('on');
        mode = (on.id === 'pe-mode-max') ? 'max' : 'standard';
        if (mode === 'standard') $('pe-pu').value = 0;
    });
    bindToggle('pe-strat-io', 'pe-strat-amort', (on, off) => {
        on.classList.add('on'); off.classList.remove('on');
        strat = (on.id === 'pe-strat-io') ? 'io' : 'amort';
    });
    ['pe-borrow', 'pe-pu', 'pe-rate', 'pe-term', 'pe-yield', 'pe-cagr', 'pe-comp', 'pe-reserves', 'pe-fees']
        .forEach(id => {
            const el = $(id); if (!el) return;
            const onEdit = () => {
                if (id === 'pe-pu' && mode === 'max') {
                    mode = 'standard';
                    $('pe-mode-standard').classList.add('on');
                    $('pe-mode-max').classList.remove('on');
                }
                render();
            };
            // listen for both: 'input' (live typing/spinner) and 'change' (commit/blur) for robustness
            el.addEventListener('input', onEdit);
            el.addEventListener('change', onEdit);
        });

    render();
})(typeof window !== 'undefined' ? window : globalThis);
