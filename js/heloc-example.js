// =====================================================
// HELOC worked example — a LIVE, interest-only view of the calculator above.
// It reads the calculator's current inputs on every change and recomputes through
// the SHARED engine (js/synthetic-pe-engine.js), so the example tracks whatever you
// dial into the calculator — borrow, rate, term, yield, CAGR, comp split, reserves,
// personal use. A HELOC is interest-only during the draw (the principal is repaid at
// maturity), so this view is always interest-only, regardless of the calculator's
// amortized/interest-only toggle.
// Hypothetical and illustrative. NOT a forecast or advice to borrow / take a HELOC.
// =====================================================
(function (root) {
    'use strict';
    const $ = id => document.getElementById(id);
    if (!$('hx-net') || !$('pe-borrow') || !root.SyntheticPE) return;

    const fmtUSD = v => (v < 0 ? '−$' : '$') + Math.abs(Math.round(v)).toLocaleString();
    const roundTo = (v, step) => Math.round(v / step) * step;
    const set = (id, v) => { const e = $(id); if (e) e.textContent = v; };

    // Read the calculator's live inputs. The HELOC view forces interest-only.
    function readCalc() {
        const num = (id, d) => { const el = $(id); const v = el ? parseFloat(el.value) : NaN; return isFinite(v) ? v : d; };
        return {
            borrow: Math.max(0, num('pe-borrow', 50000)),
            pu: Math.max(0, num('pe-pu', 0)),
            rate: Math.max(0, num('pe-rate', 8)),
            term: Math.max(1, num('pe-term', 7)),
            yield: Math.max(0, num('pe-yield', 2)),
            cagr: Math.max(0, num('pe-cagr', 26)),
            comp: Math.min(100, Math.max(0, num('pe-comp', 20))),
            reserves: Math.max(0, num('pe-reserves', 6)),
            strat: 'io'   // a HELOC is interest-only during the draw
        };
    }

    function render() {
        const p = readCalc();
        const c = root.SyntheticPE.compute(p);
        const port = c.portAt(c.n);
        const mult = c.invested > 0 ? port / c.invested : 0;

        set('hx-term', p.term);
        set('hx-deploy', fmtUSD(p.borrow));
        set('hx-deploy-s', '@ ~' + p.rate + '%, interest-only');

        set('hx-cash', '~' + fmtUSD(roundTo(c.cashAtRisk, 100)));
        set('hx-cash-s', p.reserves + '-mo reserve + uncovered carry');

        set('hx-port', '~' + fmtUSD(roundTo(port, 1000)));
        set('hx-port-s', 'illustrative · ' + mult.toFixed(1) + '× invested');

        set('hx-income', '~' + fmtUSD(c.income) + '/mo');
        set('hx-income-s', 'covers ~' + fmtUSD(c.pmt) + '/mo interest · ' + c.coverage.toFixed(2) + '× coverage');

        set('hx-repay', '−' + fmtUSD(p.borrow));
        set('hx-net', '~' + fmtUSD(roundTo(c.wealth, 1000)));

        set('hx-assump', '~' + p.cagr + '% CAGR compounding sleeve · ~' + p.yield + '%/mo income sleeve');
    }

    // Re-render whenever any calculator control changes. pe-calculator.js binds its
    // own listeners first (script load order), so by the time ours fire the inputs and
    // toggles (including Max-Personal-Use auto-fill) are already updated in the DOM.
    ['pe-borrow', 'pe-pu', 'pe-rate', 'pe-term', 'pe-yield', 'pe-cagr', 'pe-comp', 'pe-reserves'].forEach(id => {
        const el = $(id);
        if (!el) return;
        el.addEventListener('input', render);
        el.addEventListener('change', render);
    });
    ['pe-mode-standard', 'pe-mode-max', 'pe-strat-io', 'pe-strat-amort'].forEach(id => {
        const el = $(id);
        if (el) el.addEventListener('click', render);
    });

    render();
})(typeof window !== 'undefined' ? window : globalThis);
