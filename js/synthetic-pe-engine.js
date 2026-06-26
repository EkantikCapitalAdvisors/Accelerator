// =====================================================
// Synthetic PE engine — pure leverage math, NO DOM.
// Single source of truth shared by:
//   • the index calculator        (js/pe-calculator.js)
//   • the HELOC worked example     (js/heloc-example.js)
// Borrow → split the proceeds into a COMPOUNDING sleeve (run at a target CAGR)
// and an INCOME sleeve (monthly yield that services the debt), held up by a
// reserve. Amortized | interest-only. The income covers the carry; the
// compounding builds equity; at payoff you own the de-levered, multiplied
// portfolio. Hypothetical and illustrative. NOT a forecast or advice to borrow.
// =====================================================
(function (root) {
    'use strict';

    // Money-weighted IRR (monthly cashflows) annualized, via bisection. null if no sign change.
    function solveIRR(cf) {
        const npv = r => cf.reduce((a, c, i) => a + c / Math.pow(1 + r, i), 0);
        let lo = -0.95, hi = 3.0;
        if (npv(lo) * npv(hi) > 0) return null;
        for (let k = 0; k < 200; k++) { const m = (lo + hi) / 2; if (npv(m) > 0) lo = m; else hi = m; }
        return (Math.pow(1 + (lo + hi) / 2, 12) - 1) * 100;
    }

    // p: { borrow, pu, rate, term, yield, cagr, comp, reserves, strat:'amort'|'io' }
    //   borrow   — principal drawn (the HELOC / synthetic line)
    //   pu       — personal-use draw skimmed off the top (not invested)
    //   rate     — annual borrow rate, %
    //   term     — years
    //   yield    — income-sleeve monthly yield, %/mo
    //   cagr     — compounding-sleeve annual CAGR, %
    //   comp     — % of invested capital into the compounding sleeve (rest is income)
    //   reserves — months of payment held aside as the reserve
    //   strat    — 'amort' (pay to $0 by term) | 'io' (interest-only, principal balloons)
    function compute(p) {
        const strat = p.strat === 'io' ? 'io' : 'amort';
        const r = p.rate / 100 / 12, n = Math.round(p.term * 12);
        const invested = Math.max(0, p.borrow - (p.pu || 0));
        const comp0 = invested * p.comp / 100;
        const inc0 = invested * (1 - p.comp / 100);
        const pmt = strat === 'amort'
            ? (r > 0 ? p.borrow * r / (1 - Math.pow(1 + r, -n)) : p.borrow / n)
            : p.borrow * r;
        const income = inc0 * p.yield / 100;
        const coverage = pmt > 0 ? income / pmt : 0;
        const oop = Math.max(0, pmt - income);
        const gm = Math.pow(1 + p.cagr / 100, 1 / 12) - 1;
        const reservesDollar = pmt * (p.reserves || 0);

        const portAt = m => comp0 * Math.pow(1 + gm, m) + inc0;
        const debtAt = m => {
            if (strat === 'io') return p.borrow; // interest-only: full principal outstanding through the term
            if (r > 0) return Math.max(0, p.borrow * Math.pow(1 + r, m) - pmt * ((Math.pow(1 + r, m) - 1) / r));
            return Math.max(0, p.borrow - (p.borrow / n) * m);
        };
        const neAt = m => portAt(m) - debtAt(m);

        const series = [];
        for (let m = 0; m <= n; m++) series.push({ m, port: portAt(m), debt: debtAt(m), ne: neAt(m) });

        const totInt = strat === 'amort' ? pmt * n - p.borrow : p.borrow * r * n;
        // Out-of-pocket cash actually committed: the reserve up front + any monthly
        // shortfall the income doesn't cover, summed across the term ("cash at risk").
        const cashAtRisk = reservesDollar + oop * n;
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

        return { invested, comp0, inc0, pmt, income, coverage, oop, gm, reservesDollar, cashAtRisk,
            totInt, totCost: p.borrow + totInt, wealth, n, series, portAt, debtAt, neAt, proj };
    }

    root.SyntheticPE = { compute, solveIRR };
})(typeof window !== 'undefined' ? window : globalThis);
