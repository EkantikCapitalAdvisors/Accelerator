// =====================================================
// Synthetic PE calculator (exhaustive) — index (thesis) page.
// Hypothetical, illustrative model of the full machine:
//   • Working unit (deployed) sits against a risk-capital RESERVE (held back).
//   • Cash-flow engine: monthly cash = trades × expectancy(R) × risk × buffer,
//     where the buffer ladder steps up with (working unit + reserves), capped at 3×.
//   • Each month's realized cash splits THREE ways: compound / rebuild reserves /
//     CASH TO USE (drawable income).
//   • Compounder grows at an annual multiple (monthly), bounded at 4× contributed.
// Outputs: capital in the machine, reserves, compounder, cash drawn, total value
// created, time to $100k, freedom point — plus a stacked-capital chart, a cash-draw
// chart, and a live allocation bar. NOT a forecast.
// =====================================================
(function () {
    'use strict';
    const $ = id => document.getElementById(id);
    if (!$('pc-W')) return;

    const INPUTS = ['pc-W', 'pc-res', 'pc-trades', 'pc-R', 'pc-risk', 'pc-comp', 'pc-resbuild', 'pc-mult', 'pc-months', 'pc-oblig'];
    const LADDER_CAP = 3; // cash-flow buffer ladder caps at 3× base position
    const ENV_MAX = 4;    // compounder bounded at 4× contributed (realistic envelope; 16× is design cap)

    const fmt0 = v => (v < 0 ? '−$' : '$') + Math.abs(Math.round(v)).toLocaleString();
    const fmtK = v => {
        const a = Math.abs(v);
        if (a >= 1000) return (v < 0 ? '−$' : '$') + (a / 1000).toFixed(a >= 10000 ? 0 : 1) + 'k';
        return fmt0(v);
    };
    function moLabel(m) {
        if (m == null) return 'Beyond horizon';
        const yr = m / 12;
        return 'Month ' + m + ' · ' + (yr < 1 ? (m + ' mo') : (yr.toFixed(m % 12 ? 1 : 0) + ' yr'));
    }

    function readVals() {
        const pComp = +$('pc-comp').value / 100;
        const pResRaw = +$('pc-resbuild').value / 100;
        const pRes = Math.min(pResRaw, 1 - pComp);   // never over-allocate
        return {
            W: +$('pc-W').value, res: +$('pc-res').value,
            trades: +$('pc-trades').value, R: +$('pc-R').value, risk: +$('pc-risk').value,
            pComp: pComp, pRes: pRes, pUse: Math.max(0, 1 - pComp - pRes),
            mult: +$('pc-mult').value, months: +$('pc-months').value, oblig: +$('pc-oblig').value
        };
    }

    function simulate(p) {
        const g = Math.pow(p.mult, 1 / 12);
        let reserves = p.res * p.W, comp = 0, contrib = 0, cashUsed = 0;
        const C0 = p.W + reserves;
        let m100 = null, mFree = null, maxBuffer = 1, lastUse = 0;
        const series = [{ W: p.W, reserves: reserves, comp: 0, cashUsed: 0 }];
        for (let m = 1; m <= p.months; m++) {
            const buffer = Math.min(LADDER_CAP, Math.max(1, Math.floor((p.W + reserves) / p.W)));
            if (buffer > maxBuffer) maxBuffer = buffer;
            const cash = p.trades * p.R * p.risk * buffer;
            const toComp = cash * p.pComp, toRes = cash * p.pRes, toUse = cash * p.pUse;
            comp = comp * g + toComp; contrib += toComp;
            const ceil = ENV_MAX * contrib; if (contrib > 0 && comp > ceil) comp = ceil;
            reserves += toRes; cashUsed += toUse; lastUse = toUse;
            const C = p.W + reserves + comp;
            const profit = (C - C0) + cashUsed;
            if (m100 === null && profit >= 100000) m100 = m;
            if (mFree === null && p.oblig > 0 && toUse >= p.oblig) mFree = m;
            series.push({ W: p.W, reserves: reserves, comp: comp, cashUsed: cashUsed });
        }
        const C = p.W + reserves + comp;
        return {
            series: series, committed: C0, ending: C, reserves: reserves, comp: comp,
            contrib: contrib, cashUsed: cashUsed, profit: (C - C0) + cashUsed,
            multiple: C / C0, m100: m100, mFree: mFree, maxBuffer: maxBuffer, monthlyUse: lastUse
        };
    }

    // --- chart helpers ---
    function band(series, lo, hi, x, y) {
        const n = series.length;
        let d = 'M' + x(0).toFixed(1) + ',' + y(hi(series[0])).toFixed(1);
        for (let i = 1; i < n; i++) d += ' L' + x(i).toFixed(1) + ',' + y(hi(series[i])).toFixed(1);
        for (let i = n - 1; i >= 0; i--) d += ' L' + x(i).toFixed(1) + ',' + y(lo(series[i])).toFixed(1);
        return d + ' Z';
    }
    function drawStack(r) {
        const W = 480, H = 150, pad = 8, n = r.series.length;
        const maxY = Math.max.apply(null, r.series.map(s => s.W + s.reserves + s.comp)) || 1;
        const x = i => pad + (W - 2 * pad) * (i / (n - 1));
        const y = v => (H - pad) - (H - 2 * pad) * (v / maxY);
        const lvl0 = () => 0, lvlW = s => s.W, lvlR = s => s.W + s.reserves, lvlC = s => s.W + s.reserves + s.comp;
        const topLine = 'M' + x(0).toFixed(1) + ',' + y(lvlC(r.series[0])).toFixed(1) +
            r.series.map((s, i) => ' L' + x(i).toFixed(1) + ',' + y(lvlC(s)).toFixed(1)).join('');
        $('pc-chart-stack').innerHTML =
            '<path d="' + band(r.series, lvl0, lvlW, x, y) + '" fill="#3E4F6E" opacity="0.85"/>' +
            '<path d="' + band(r.series, lvlW, lvlR, x, y) + '" fill="#7E9CC4" opacity="0.65"/>' +
            '<path d="' + band(r.series, lvlR, lvlC, x, y) + '" fill="#C8A951" opacity="0.55"/>' +
            '<path d="' + topLine + '" fill="none" stroke="#E0BE63" stroke-width="1.5"/>';
    }
    function drawCash(r) {
        const W = 480, H = 110, pad = 8, n = r.series.length;
        const vals = r.series.map(s => s.cashUsed);
        const maxY = Math.max.apply(null, vals) || 1;
        const x = i => pad + (W - 2 * pad) * (i / (n - 1));
        const y = v => (H - pad) - (H - 2 * pad) * (v / maxY);
        let line = 'M' + x(0).toFixed(1) + ',' + y(vals[0]).toFixed(1);
        for (let i = 1; i < n; i++) line += ' L' + x(i).toFixed(1) + ',' + y(vals[i]).toFixed(1);
        const area = line + ' L' + x(n - 1).toFixed(1) + ',' + (H - pad) + ' L' + x(0).toFixed(1) + ',' + (H - pad) + ' Z';
        const marker = (m, color) => (m == null ? '' :
            '<line x1="' + x(m).toFixed(1) + '" y1="' + pad + '" x2="' + x(m).toFixed(1) + '" y2="' + (H - pad) +
            '" stroke="' + color + '" stroke-width="1" stroke-dasharray="3 3" opacity="0.75"/>');
        $('pc-chart-cash').innerHTML =
            '<defs><linearGradient id="pcCash" x1="0" y1="0" x2="0" y2="1">' +
            '<stop offset="0%" stop-color="#6FB77F" stop-opacity="0.30"/>' +
            '<stop offset="100%" stop-color="#6FB77F" stop-opacity="0"/></linearGradient></defs>' +
            '<path d="' + area + '" fill="url(#pcCash)"/>' +
            '<path d="' + line + '" fill="none" stroke="#6FB77F" stroke-width="2"/>' +
            marker(r.m100, '#E0BE63') + marker(r.mFree, '#6FB77F');
    }

    function render() {
        const p = readVals();
        const committed = p.W * (1 + p.res);

        // input labels
        $('pc-W-v').textContent = fmt0(p.W);
        $('pc-res-v').textContent = p.res.toFixed(1) + '× · ' + fmt0(p.res * p.W);
        $('pc-committed-v').textContent = 'Total committed: ' + fmt0(committed);
        $('pc-trades-v').textContent = p.trades + ' / mo';
        $('pc-R-v').textContent = '+' + p.R.toFixed(2) + 'R';
        $('pc-risk-v').textContent = fmt0(p.risk);
        $('pc-comp-v').textContent = Math.round(p.pComp * 100) + '%';
        $('pc-resbuild-v').textContent = Math.round(p.pRes * 100) + '%';
        $('pc-mult-v').textContent = p.mult.toFixed(2) + '× / yr';
        $('pc-months-v').textContent = p.months + ' mo';
        $('pc-oblig-v').textContent = fmt0(p.oblig) + ' / mo';

        // allocation bar + legend
        const cP = Math.round(p.pComp * 100), rP = Math.round(p.pRes * 100), uP = Math.round(p.pUse * 100);
        $('pc-bar-comp').style.width = (p.pComp * 100) + '%';
        $('pc-bar-res').style.width = (p.pRes * 100) + '%';
        $('pc-bar-use').style.width = (p.pUse * 100) + '%';
        $('pc-lg-comp').textContent = cP + '%';
        $('pc-lg-res').textContent = rP + '%';
        $('pc-lg-use').textContent = uP + '%';

        const r = simulate(p);

        $('pc-horizon-label').textContent = p.months + ' mo';
        $('pc-ending').textContent = fmt0(r.ending);
        $('pc-multiple').textContent = r.multiple.toFixed(1) + '×';
        $('pc-drawn-head').textContent = fmt0(r.cashUsed);
        $('pc-res-out').textContent = fmtK(r.reserves);
        $('pc-co').textContent = fmtK(r.comp);
        $('pc-co-mult').textContent = r.contrib > 0 ? '(' + (r.comp / r.contrib).toFixed(1) + '×)' : '';
        $('pc-drawn').textContent = fmtK(r.cashUsed);
        $('pc-tvc').textContent = fmtK(r.profit);
        $('pc-100k').textContent = r.m100 ? moLabel(r.m100) : 'Beyond horizon';
        $('pc-freedom').textContent = p.oblig === 0 ? 'n/a' : (r.mFree ? moLabel(r.mFree) : 'Beyond horizon');
        $('pc-buffer-note').textContent = '· buffer tops out at ' + r.maxBuffer + ' ES';

        drawStack(r);
        drawCash(r);

        $('pc-formula').innerHTML =
            '<b>How it computes (month by month):</b> a fixed <b>working unit</b> sits against a <b>risk-capital reserve</b>. ' +
            'Monthly cash = trades × expectancy(R) × risk × buffer, where the buffer ladder steps up one rung per working-unit of (unit + reserves) ' +
            'and is <b>capped at 3×</b> — deliberately conservative, since the live edge is pre-asymptotic and not assumed to scale without limit. ' +
            'Each month that cash splits three ways: <b style="color:#E0BE63">' + cP + '% compounded</b> ' +
            '(growing at ' + p.mult.toFixed(2) + '× / yr, bounded at 4× of contributed), <b style="color:#7E9CC4">' + rP + '% rebuilding reserves</b> ' +
            '(which unlock higher buffer rungs), and <b style="color:#6FB77F">' + uP + '% drawn as cash to use</b>. ' +
            'Capital in the machine = working unit + reserves + compounder; total value created = that growth + cash already drawn. ' +
            'The <b style="color:#6FB77F">freedom point</b> is the first month cash-to-use ≥ your obligations; the <b style="color:#E0BE63">$100k marker</b> is the first month total value ≥ $100,000. ' +
            '<b>All figures are hypothetical and illustrative</b> — they assume the stated parameters hold every month, which live markets will not. Not a forecast or promise of any outcome.';
    }

    INPUTS.forEach(id => { const el = $(id); if (el) el.addEventListener('input', render); });
    render();
})();
