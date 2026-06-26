// =====================================================
// HELOC worked example — rendered from the SHARED synthetic-PE engine
// (js/synthetic-pe-engine.js), the same math that powers the calculator above.
// One source of truth: change the preset here and the card follows; the engine
// numbers and the calculator can never silently drift apart.
// Hypothetical and illustrative. NOT a forecast or advice to borrow / take a HELOC.
// =====================================================
(function (root) {
    'use strict';
    const $ = id => document.getElementById(id);
    if (!$('hx-net') || !root.SyntheticPE) return;

    // The HELOC scenario, expressed in the calculator's own terms. Interest-only
    // line; the rest are the calculator's defaults (two-sleeve, 26% / 2%/mo).
    const PRESET = {
        borrow: 80000,   // line drawn against home equity
        pu: 0,           // no personal-use skim in this example
        rate: 8,         // % annual
        term: 7,         // years
        yield: 2,        // income sleeve, %/mo
        cagr: 26,        // compounding sleeve, % CAGR
        comp: 65,        // % of invested into the compounding sleeve
        reserves: 6,     // months of payment held as the reserve
        strat: 'io'      // interest-only — principal balloons at maturity
    };

    const fmtUSD = v => (v < 0 ? '−$' : '$') + Math.abs(Math.round(v)).toLocaleString();
    const roundTo = (v, step) => Math.round(v / step) * step;
    const set = (id, v) => { const e = $(id); if (e) e.textContent = v; };

    const c = root.SyntheticPE.compute(PRESET);
    const port = c.portAt(c.n);          // portfolio at the term
    const mult = c.invested > 0 ? port / c.invested : 0;

    set('hx-term', PRESET.term);
    set('hx-deploy', fmtUSD(PRESET.borrow));
    set('hx-deploy-s', '@ ~' + PRESET.rate + '%, interest-only');

    set('hx-cash', '~' + fmtUSD(roundTo(c.cashAtRisk, 100)));
    set('hx-cash-s', PRESET.reserves + '-mo reserve + uncovered carry');

    set('hx-port', '~' + fmtUSD(roundTo(port, 1000)));
    set('hx-port-s', 'illustrative · ' + mult.toFixed(1) + '× invested');

    set('hx-income', '~' + fmtUSD(c.income) + '/mo');
    set('hx-income-s', 'covers ~' + fmtUSD(c.pmt) + '/mo interest · ' + c.coverage.toFixed(2) + '× coverage');

    set('hx-repay', '−' + fmtUSD(PRESET.borrow));
    set('hx-net', '~' + fmtUSD(roundTo(c.wealth, 1000)));

    set('hx-assump', '~' + PRESET.cagr + '% CAGR compounding sleeve · ~' + PRESET.yield + '%/mo income sleeve');
})(typeof window !== 'undefined' ? window : globalThis);
