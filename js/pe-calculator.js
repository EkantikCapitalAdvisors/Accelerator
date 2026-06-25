// =====================================================
// Synthetic PE calculator — index (thesis) page.
// Hypothetical, illustrative model of the two-engine machine:
//   • Cash-Flow Engine: realized cash = trades × expectancy(R) × risk,
//     with risk scaling on the buffer ladder (risk × capital/working-capital).
//   • Compounding Engine: a routed slice of that cash compounds at an annual
//     multiple (monthly), capped at 16× of contributed capital (design intent).
// Profit = kept cash + compounder equity; ending capital = working + profit.
// Freedom point = first month realized monthly cash ≥ obligations.
// Self-contained; the page has its own styles. NOT a forecast.
// =====================================================
(function () {
    'use strict';
    const $ = id => document.getElementById(id);
    if (!$('pc-cap0')) return;

    const INPUTS = ['pc-cap0', 'pc-trades', 'pc-R', 'pc-risk', 'pc-route', 'pc-mult', 'pc-months', 'pc-oblig'];
    const LADDER_CAP = 2; // cash-flow engine scales at most 2× base position (conservative buffer ladder)
    const ENV_MAX = 5;    // compounder bounded at 5× contributed (realistic envelope; design cap is 16×)

    const fmt0 = v => (v < 0 ? '−$' : '$') + Math.abs(Math.round(v)).toLocaleString();
    const fmtK = v => {
        const a = Math.abs(v);
        if (a >= 1000) return (v < 0 ? '−$' : '$') + (a / 1000).toFixed(a >= 10000 ? 0 : 1) + 'k';
        return fmt0(v);
    };
    function moLabel(m) {
        if (m == null) return 'Beyond horizon';
        const yr = m / 12;
        const tail = yr < 1 ? (m + ' mo') : (yr.toFixed(m % 12 ? 1 : 0) + ' yr');
        return 'Month ' + m + ' · ' + tail;
    }

    function readVals() {
        return {
            cap0: +$('pc-cap0').value, trades: +$('pc-trades').value, R: +$('pc-R').value,
            risk: +$('pc-risk').value, route: +$('pc-route').value / 100, mult: +$('pc-mult').value,
            months: +$('pc-months').value, oblig: +$('pc-oblig').value
        };
    }

    function simulate(p) {
        const g = Math.pow(p.mult, 1 / 12); // monthly compounding factor
        let freeCash = 0, comp = 0, contributed = 0, profit = 0, cfTotal = 0;
        let m100 = null, mFree = null;
        const series = [{ m: 0, capital: p.cap0 }];
        for (let m = 1; m <= p.months; m++) {
            const capital = p.cap0 + profit;
            const buffer = Math.min(LADDER_CAP, Math.max(1, Math.floor(capital / p.cap0))); // buffer ladder, capped
            const risk = p.risk * buffer;
            const cashMonth = p.trades * p.R * risk;          // realized cash this month
            cfTotal += cashMonth;
            const toComp = cashMonth * p.route;
            const keep = cashMonth * (1 - p.route);
            comp = comp * g + toComp;                         // grow, then add contribution
            contributed += toComp;
            const ceil = ENV_MAX * contributed;               // realistic envelope cap
            if (contributed > 0 && comp > ceil) comp = ceil;
            freeCash += keep;
            profit = freeCash + comp;
            if (m100 === null && profit >= 100000) m100 = m;
            if (mFree === null && p.oblig > 0 && cashMonth >= p.oblig) mFree = m;
            series.push({ m: m, capital: p.cap0 + profit });
        }
        return {
            series: series, profit: profit, ending: p.cap0 + profit, cfTotal: cfTotal,
            comp: comp, contributed: contributed, multiple: (p.cap0 + profit) / p.cap0,
            m100: m100, mFree: mFree
        };
    }

    function drawChart(r) {
        const W = 480, H = 150, pad = 8;
        const caps = r.series.map(s => s.capital);
        const max = Math.max.apply(null, caps), min = Math.min.apply(null, caps);
        const n = r.series.length;
        const x = i => pad + (W - 2 * pad) * (i / (n - 1));
        const y = v => (H - pad) - (H - 2 * pad) * ((v - min) / ((max - min) || 1));
        let line = 'M' + x(0).toFixed(1) + ',' + y(caps[0]).toFixed(1);
        for (let i = 1; i < n; i++) line += ' L' + x(i).toFixed(1) + ',' + y(caps[i]).toFixed(1);
        const area = line + ' L' + x(n - 1).toFixed(1) + ',' + (H - pad) + ' L' + x(0).toFixed(1) + ',' + (H - pad) + ' Z';
        const marker = (m, color) => (m == null ? '' :
            '<line x1="' + x(m).toFixed(1) + '" y1="' + pad + '" x2="' + x(m).toFixed(1) + '" y2="' + (H - pad) +
            '" stroke="' + color + '" stroke-width="1" stroke-dasharray="3 3" opacity="0.75"/>');
        const svg = $('pc-chart');
        svg.innerHTML =
            '<defs><linearGradient id="pcFill" x1="0" y1="0" x2="0" y2="1">' +
            '<stop offset="0%" stop-color="#C8A951" stop-opacity="0.28"/>' +
            '<stop offset="100%" stop-color="#C8A951" stop-opacity="0"/></linearGradient></defs>' +
            '<path d="' + area + '" fill="url(#pcFill)"/>' +
            '<path d="' + line + '" fill="none" stroke="#C8A951" stroke-width="2"/>' +
            marker(r.m100, '#E0BE63') + marker(r.mFree, '#6FB77F');
    }

    function render() {
        const p = readVals();

        // sync input value labels
        $('pc-cap0-v').textContent = fmt0(p.cap0);
        $('pc-trades-v').textContent = p.trades + ' / mo';
        $('pc-R-v').textContent = '+' + p.R.toFixed(2) + 'R';
        $('pc-risk-v').textContent = fmt0(p.risk);
        $('pc-route-v').textContent = Math.round(p.route * 100) + '%';
        $('pc-mult-v').textContent = p.mult.toFixed(2) + '× / yr';
        $('pc-months-v').textContent = p.months + ' mo';
        $('pc-oblig-v').textContent = fmt0(p.oblig) + ' / mo';

        const r = simulate(p);

        $('pc-horizon-label').textContent = p.months + ' mo';
        $('pc-ending').textContent = fmt0(r.ending);
        $('pc-multiple').textContent = r.multiple.toFixed(1) + '×';
        $('pc-profit').textContent = fmt0(r.profit);
        $('pc-cf').textContent = fmtK(r.cfTotal);
        $('pc-co').textContent = fmtK(r.comp);
        $('pc-co-mult').textContent = r.contributed > 0 ? '(' + (r.comp / r.contributed).toFixed(1) + '× contrib.)' : '';
        $('pc-100k').textContent = r.m100 ? moLabel(r.m100) : 'Beyond horizon';
        $('pc-freedom').textContent = p.oblig === 0 ? 'n/a' : (r.mFree ? moLabel(r.mFree) : 'Beyond horizon');

        drawChart(r);

        $('pc-formula').innerHTML =
            '<b>How it computes (month by month):</b> monthly cash = trades × expectancy(R) × risk × buffer, where the ' +
            'cash-flow engine steps up the buffer ladder one notch per working-unit of capital gained — <b>capped at 2× the base position</b>, ' +
            'a deliberately conservative ceiling (the live edge is pre-asymptotic and is not assumed to scale without limit). ' +
            'A ' + Math.round(p.route * 100) + '% slice feeds the compounding engine, which grows at ' + p.mult.toFixed(2) +
            '× per year (compounded monthly) and is <b>bounded at 5× of contributed capital</b> — the realistic envelope, well below the 16× design cap. ' +
            'Profit = kept cash + compounder equity; ending capital = working capital + profit. ' +
            'The <b style="color:#6FB77F">freedom point</b> is the first month realized monthly cash ≥ your obligations; ' +
            'the <b style="color:#E0BE63">$100k marker</b> is the first month cumulative profit ≥ $100,000. ' +
            '<b>All figures are hypothetical and illustrative</b> — they assume the stated parameters hold every month, ' +
            'which live markets will not. Not a forecast, projection of returns, or promise of any outcome.';
    }

    INPUTS.forEach(id => { const el = $(id); if (el) el.addEventListener('input', render); });
    render();
})();
