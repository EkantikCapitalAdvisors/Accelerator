// =====================================================
// Synthetic PE calculator (leverage model) — index (thesis) page.
// The PE machine made literal: borrow (synthetic leverage), split the
// proceeds into an INCOME sleeve (Cash-Flow Engine — monthly yield that
// services the debt) and a COMPOUNDING sleeve (Compounding Engine — run at
// the 10×-in-7-yr pace, ~38.5% CAGR). Income covers the carry; compounding
// builds equity; at payoff you own the de-levered, multiplied portfolio.
// Amortized vs interest-only; Standard vs Max-Personal-Use draw.
// Hypothetical and illustrative. NOT a forecast or advice to borrow.
// =====================================================
(function () {
    'use strict';
    const $ = id => document.getElementById(id);
    if (!$('pe-borrow')) return;

    let mode = 'standard';   // standard | max
    let strat = 'amort';     // amort | io
    const COV_FLOOR = 0.25;  // serviceability floor used to size Max Personal Use

    // Money-weighted IRR (monthly cashflows) annualized, via bisection. Returns null if no sign change.
    function solveIRR(cf) {
        const npv = r => cf.reduce((a, c, i) => a + c / Math.pow(1 + r, i), 0);
        let lo = -0.95, hi = 3.0;
        if (npv(lo) * npv(hi) > 0) return null;
        for (let k = 0; k < 200; k++) { const m = (lo + hi) / 2; if (npv(m) > 0) lo = m; else hi = m; }
        return (Math.pow(1 + (lo + hi) / 2, 12) - 1) * 100;
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
            comp: Math.min(100, Math.max(0, num('pe-comp', 65))),
            reserves: Math.max(0, num('pe-reserves', 6))
        };
    }

    function compute(p) {
        const r = p.rate / 100 / 12, n = Math.round(p.term * 12);
        const invested = Math.max(0, p.borrow - p.pu);
        const comp0 = invested * p.comp / 100;
        const inc0 = invested * (1 - p.comp / 100);
        const pmt = strat === 'amort'
            ? (r > 0 ? p.borrow * r / (1 - Math.pow(1 + r, -n)) : p.borrow / n)
            : p.borrow * r;
        const income = inc0 * p.yield / 100;
        const coverage = pmt > 0 ? income / pmt : 0;
        const oop = Math.max(0, pmt - income);
        const gm = Math.pow(1 + p.cagr / 100, 1 / 12) - 1;
        const reservesDollar = pmt * p.reserves;

        const portAt = m => comp0 * Math.pow(1 + gm, m) + inc0;
        const debtAt = m => {
            if (strat === 'io') return p.borrow; // interest-only: full principal balloons, outstanding through the term
            if (r > 0) return Math.max(0, p.borrow * Math.pow(1 + r, m) - pmt * ((Math.pow(1 + r, m) - 1) / r));
            return Math.max(0, p.borrow - (p.borrow / n) * m);
        };
        const neAt = m => portAt(m) - debtAt(m);

        const series = [];
        for (let m = 0; m <= n; m++) series.push({ m, port: portAt(m), debt: debtAt(m), ne: neAt(m) });

        const totInt = strat === 'amort' ? pmt * n - p.borrow : p.borrow * r * n;
        const wealth = neAt(n);

        function proj(years) {
            const m = Math.round(years * 12);
            const port = portAt(m), debt = debtAt(m), ne = neAt(m);
            const mult = invested > 0 ? port / invested : 0;
            // True levered-equity IRR: money-weighted on the cash actually committed
            // (reserves up front + monthly carry) vs the net equity realized at exit.
            const cf = [-reservesDollar];
            for (let k = 1; k <= m; k++) cf.push(income - pmt);
            cf[m] += ne + reservesDollar;
            return { years, port, debt, ne, mult, irr: solveIRR(cf) };
        }

        return { invested, comp0, inc0, pmt, income, coverage, oop, gm, reservesDollar,
            totInt, totCost: p.borrow + totInt, wealth, n, series, portAt, proj };
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
            return '<tr' + (term ? ' class="hl"' : '') + '><td>' + (term ? '🏆 ' : '') + yr + 'Y</td>' +
                '<td class="gold">' + fmtKx(r.ne) + '</td><td>' + fmtKx(r.port) + '</td>' +
                '<td' + (r.debt <= 1 ? ' class="pos"' : '') + '>' + (r.debt <= 1 ? '$0' : fmtKx(r.debt)) + '</td>' +
                '<td class="pos">' + (r.irr == null ? '—' : r.irr.toFixed(1) + '%') + '</td><td>' + r.mult.toFixed(1) + 'x</td></tr>';
        }).join('');

        // architecture
        $('pe-arch-lev').textContent = fmtUSD(p.borrow) + ' at ' + p.rate + '%' + (p.pu > 0 ? ' · ' + fmtUSD(p.pu) + ' personal use' : '');
        $('pe-arch-inc').textContent = fmtUSD(c.inc0) + ' → ' + fmtUSD(c.income) + '/mo (' + p.yield + '%/mo)';
        $('pe-arch-comp').textContent = fmtUSD(c.comp0) + ' → ' + p.cagr + '% CAGR';

        // guardrails
        const ok = '<span class="ok">✓</span>', no = '<span class="no">✗</span>';
        $('pe-g-cov').innerHTML = (c.coverage >= 1 ? ok : no) + ' Coverage ≥ 1x (' + c.coverage.toFixed(2) + 'x)';
        $('pe-g-oop').innerHTML = (c.oop <= c.income ? ok : no) + ' Out-of-pocket: ' + fmtUSD(c.oop) + '/mo';
        $('pe-g-res').innerHTML = (p.reserves >= 3 ? ok : no) + ' Reserves: ' + p.reserves + 'mo (' + fmtUSD(c.reservesDollar) + ')';

        $('pe-formula').innerHTML =
            '<b>How it computes:</b> you borrow ' + fmtUSD(p.borrow) + ' at ' + p.rate + '% over ' + p.term + ' years and invest ' + fmtUSD(c.invested) +
            ' — split <b style="color:#7E9CC4">' + Math.round(compPct) + '% into the compounding sleeve</b> (grows at ' + p.cagr + '% CAGR) and <b style="color:#6FB77F">' + Math.round(100 - compPct) + '% into the income sleeve</b> (yields ' + p.yield + '%/mo = ' + fmtUSD(c.income) + '/mo). ' +
            'The income services the debt; the shortfall (' + fmtUSD(c.oop) + '/mo out of pocket) is your carry. ' +
            (strat === 'amort' ? 'Amortized: the loan is paid to $0 by the term, so at payoff net equity = the full portfolio.' : 'Interest-only: only interest is paid, so the full principal balloons at the term — a real obligation to refinance or repay from the portfolio, not a free ride.') +
            ' Multiple = portfolio ÷ invested. <b>IRR is the true levered return</b> — money-weighted on the cash you actually commit (reserves up front, monthly carry) versus the net equity realized — so it runs well above the ' + p.cagr + '% asset CAGR because the ' + p.rate + '% borrow cost sits below it. <b>Leverage amplifies in both directions.</b> ' +
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
    ['pe-borrow', 'pe-pu', 'pe-rate', 'pe-term', 'pe-yield', 'pe-cagr', 'pe-comp', 'pe-reserves']
        .forEach(id => { const el = $(id); if (el) el.addEventListener('input', () => { if (id === 'pe-pu' && mode === 'max') mode = 'standard', $('pe-mode-standard').classList.add('on'), $('pe-mode-max').classList.remove('on'); render(); }); });

    render();
})();
