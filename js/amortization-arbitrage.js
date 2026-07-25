// =====================================================
// Amortization arbitrage — the arithmetic underneath synthetic PE.
//
//   • An amortizing loan charges interest on the OUTSTANDING balance, and
//     that balance shrinks with every payment. So the true cost, spread over
//     the full amount you borrowed, lands far below the stated APR.
//   • A principal-protected base compounds on the FULL amount for the whole
//     term and never gives a year back.
//   • The gap between the melting side and the growing side is the trade.
//
// Renders it three ways: the headline rates, a year-by-year ledger (honest
// about the years you are behind), and what the SAME average return is worth
// when it arrives in swings instead of smoothly.
// Illustrative arithmetic only — not a forecast.
// =====================================================
(function (root) {
    'use strict';
    const $ = id => document.getElementById(id);

    // ± percentage points around the growth rate for the "same average,
    // delivered in swings" counterfactual. 20 keeps the down year negative
    // for every realistic protected-base assumption.
    const SWING = 20;

    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
    function num(id, lo, hi, dflt) {
        const el = $(id); if (!el) return dflt;
        const v = parseFloat(el.value);
        return isFinite(v) ? clamp(v, lo, hi) : dflt;
    }

    const fmtUSD = v => (v < 0 ? '−$' : '$') + Math.abs(Math.round(v)).toLocaleString();
    const fmtSigned = v => (v >= 0 ? '+$' : '−$') + Math.abs(Math.round(v)).toLocaleString();
    const fmtPct = (v, d) => (v < 0 ? '−' : '') + Math.abs(v).toFixed(d == null ? 2 : d) + '%';

    // ── Math ───────────────────────────────────────────────────────────
    // Level-payment amortization, month by month. Interest is charged on the
    // balance that is actually outstanding — the entire point of the section.
    function amortize(P, aprPct, yrs) {
        const i = aprPct / 100 / 12, n = Math.round(yrs * 12);
        const pmt = i === 0 ? P / n : P * i / (1 - Math.pow(1 + i, -n));
        const rows = [];
        let bal = P, totalInterest = 0, balSum = 0;
        for (let y = 1; y <= yrs; y++) {
            let yearInterest = 0;
            for (let k = 0; k < 12; k++) {
                balSum += bal;
                const int = bal * i;
                yearInterest += int;
                bal = bal - (pmt - int);
            }
            if (bal < 0.005) bal = 0;                 // kill float dust at maturity
            totalInterest += yearInterest;
            rows.push({ year: y, endBal: bal, interest: yearInterest });
        }
        return { pmt: pmt, rows: rows, totalInterest: totalInterest, avgBalance: balSum / n };
    }

    function build() {
        const P   = num('aa-amt', 500, 10000000, 100000);
        const apr = num('aa-apr', 0, 40, 6);
        const yrs = Math.round(num('aa-yrs', 1, 40, 10));
        const g   = num('aa-growth', 0, 30, 4);

        const loan = amortize(P, apr, yrs);

        // The protected base earns on the full borrowed amount every year —
        // including the last one, when the loan is nearly gone.
        let base = P, cum = 0, crossover = null, breakeven = null;
        const ledger = loan.rows.map(r => {
            const gain = base * (g / 100);
            base += gain;
            cum += gain - r.interest;
            if (crossover === null && gain > r.interest) crossover = r.year;
            if (breakeven === null && cum >= 0) breakeven = r.year;
            return {
                year: r.year, endBal: r.endBal, interest: r.interest,
                gain: gain, base: base, net: gain - r.interest, cum: cum
            };
        });

        const growth = base - P;
        const net = growth - loan.totalInterest;

        // Same arithmetic average, delivered in swings. The geometric drag is
        // what "protected" actually buys — and it is worth real money.
        const up = g + SWING, dn = g - SWING;
        let vol = P;
        for (let y = 0; y < yrs; y++) vol *= 1 + (y % 2 === 0 ? up : dn) / 100;

        return {
            P: P, apr: apr, yrs: yrs, g: g,
            loan: loan, ledger: ledger,
            base: base, growth: growth, net: net,
            crossover: crossover, breakeven: breakeven,
            effective: loan.totalInterest / yrs / P * 100,
            up: up, dn: dn, vol: vol, volGrowth: vol - P,
            volNet: (vol - P) - loan.totalInterest,
            swingCost: base - vol
        };
    }

    // ── Render ─────────────────────────────────────────────────────────
    const set = (id, v) => { const e = $(id); if (e) e.textContent = v; };

    function renderHeadline(m) {
        set('aa-stated', fmtPct(m.apr));
        set('aa-effective', fmtPct(m.effective));
        set('aa-earns', fmtPct(m.g));
        set('aa-effective-note', 'per year on the full ' + fmtUSD(m.P) +
            ' — the balance amortizes away beneath you');
        set('aa-earns-note', 'on the full ' + fmtUSD(m.P) + ', every year, never reset');

        set('aa-pmt', fmtUSD(m.loan.pmt));
        set('aa-pmt-note', Math.round(m.yrs * 12) + ' level payments');
        set('aa-interest', fmtUSD(m.loan.totalInterest));
        set('aa-interest-note', 'over ' + m.yrs + ' years');
        set('aa-growth-val', fmtUSD(m.growth));
        set('aa-growth-note', fmtUSD(m.P) + ' → ' + fmtUSD(m.base));
        set('aa-net', fmtSigned(m.net));
        set('aa-net-note', m.net >= 0 ? 'you come out ahead' : 'you come out behind');
        const netEl = $('aa-net');
        if (netEl) netEl.style.color = m.net >= 0 ? 'var(--green)' : 'var(--red)';

        // The line that does the work: you never actually held the full amount.
        set('aa-avgbal', fmtUSD(m.loan.avgBalance));
        set('aa-avgbal-note', 'you borrowed ' + fmtUSD(m.P) + ' — but this is the balance you were ' +
            'actually charged on, averaged across the term');

        const v = $('aa-verdict');
        if (v) {
            v.className = 'aa-verdict ' + (m.net >= 0 ? 'good' : 'bad');
            v.innerHTML = m.net >= 0
                ? 'A <b>' + fmtPct(m.apr) + '</b> amortizing loan costs you <b>' + fmtUSD(m.loan.totalInterest) +
                  '</b> in interest over ' + m.yrs + ' years. The same dollars, protected and compounding at <b>' +
                  fmtPct(m.g) + '</b>, earn <b>' + fmtUSD(m.growth) + '</b>. You finish <b style="color:var(--green)">' +
                  fmtSigned(m.net) + '</b> ahead — the loan is gone, and you still own the base free and clear.'
                : 'At <b>' + fmtPct(m.apr) + '</b> this debt is too expensive for a <b>' + fmtPct(m.g) +
                  '</b> protected base: you would finish <b style="color:var(--red)">' + fmtSigned(m.net) +
                  '</b> behind. Expensive debt is not a leverage opportunity — it is a liability to retire first. ' +
                  '<b>The arbitrage only exists when the carry is cheap.</b>';
        }

        const c = $('aa-crossover');
        if (c) {
            c.innerHTML = m.crossover === null
                ? 'At these settings the yearly growth never overtakes the yearly interest — the gap never opens.'
                : 'In year <b>' + m.crossover + '</b> the growth you earn overtakes the interest you pay. ' +
                  (m.breakeven === null
                      ? 'Cumulatively you are still behind when the loan retires.'
                      : 'You are cumulatively <b>behind until year ' + m.breakeven + '</b> — that is the price of admission, ' +
                        'and it is exactly why the base has to survive the wait.');
        }
    }

    function renderLedger(m) {
        const tb = $('aa-ledger-body'); if (!tb) return;
        tb.innerHTML = m.ledger.map(r => {
            const cross = r.year === m.crossover;
            const col = r.cum >= 0 ? 'var(--green)' : 'var(--red)';
            return '<tr' + (cross ? ' class="cross"' : '') + '>' +
                '<td>' + r.year + (cross ? ' <span style="color:var(--green)">◂ crossover</span>' : '') + '</td>' +
                '<td style="color:var(--red)">' + fmtUSD(r.endBal) + '</td>' +
                '<td style="color:var(--red)">' + fmtUSD(r.interest) + '</td>' +
                '<td style="color:var(--gold-bright)">' + fmtUSD(r.base) + '</td>' +
                '<td style="color:var(--green)">' + fmtUSD(r.gain) + '</td>' +
                '<td style="color:' + col + '">' + fmtSigned(r.cum) + '</td>' +
                '</tr>';
        }).join('');
    }

    // Paired bars per year: what you pay (red, shrinking) against what you
    // earn (green, growing). You are meant to see them cross.
    function renderChart(m) {
        const host = $('aa-chart'); if (!host) return;
        // T leaves room for the legend AND the crossover caption on separate lines.
        const W = 920, H = 320, L = 76, R = 24, T = 58, B = 48;
        const pw = W - L - R, ph = H - T - B, y0 = T + ph;
        const n = m.ledger.length;
        const max = Math.max(1, ...m.ledger.map(r => Math.max(r.interest, r.gain)));
        const gw = pw / n, bw = Math.max(2.5, Math.min(15, gw * 0.34));
        const yOf = v => y0 - (v / max) * ph;
        const step = n <= 15 ? 1 : (n <= 24 ? 2 : 5);

        let s = '<svg viewBox="0 0 ' + W + ' ' + H + '" xmlns="http://www.w3.org/2000/svg" ' +
            'style="width:100%;height:auto" role="img" aria-label="Year by year, the interest charged on the ' +
            'shrinking loan balance falls while the growth earned on the protected base rises; in year ' +
            (m.crossover || '—') + ' the growth overtakes the interest and the gap widens for the rest of the term.">';

        // gridlines
        [0, 0.5, 1].forEach(f => {
            const y = y0 - f * ph;
            s += '<line x1="' + L + '" y1="' + y.toFixed(1) + '" x2="' + (W - R) + '" y2="' + y.toFixed(1) +
                 '" stroke="rgba(148,163,184,' + (f === 0 ? '0.25' : '0.10') + ')" stroke-width="1"/>' +
                 '<text x="' + (L - 10) + '" y="' + (y + 3.5).toFixed(1) + '" text-anchor="end" ' +
                 'font-family="\'JetBrains Mono\',monospace" font-size="9.5" fill="#6B7A93">' +
                 fmtUSD(max * f) + '</text>';
        });

        // crossover marker, drawn under the bars. The caption flips to the left
        // of the line once the crossover sits in the right half, so it never
        // runs off the edge on long amortizations.
        if (m.crossover) {
            const cx = L + (m.crossover - 0.5) * gw;
            const right = cx > L + pw * 0.55;
            s += '<line x1="' + cx.toFixed(1) + '" y1="' + (T - 12) + '" x2="' + cx.toFixed(1) + '" y2="' + y0 +
                 '" stroke="rgba(111,183,127,0.5)" stroke-width="1" stroke-dasharray="3 4"/>' +
                 '<text x="' + (right ? cx - 6 : cx + 6).toFixed(1) + '" y="' + (T - 18) + '" ' +
                 (right ? 'text-anchor="end" ' : '') +
                 'font-family="\'JetBrains Mono\',monospace" font-size="10" fill="#6FB77F">' +
                 'growth overtakes interest · year ' + m.crossover + '</text>';
        }

        // bars
        m.ledger.forEach((r, idx) => {
            const cx = L + (idx + 0.5) * gw;
            const xi = cx - bw - 1, xg = cx + 1;
            const hi = Math.max(0.6, y0 - yOf(r.interest)), hg = Math.max(0.6, y0 - yOf(r.gain));
            s += '<rect x="' + xi.toFixed(1) + '" y="' + (y0 - hi).toFixed(1) + '" width="' + bw.toFixed(1) +
                 '" height="' + hi.toFixed(1) + '" fill="#D98A8A" opacity="0.85" rx="1"/>';
            s += '<rect x="' + xg.toFixed(1) + '" y="' + (y0 - hg).toFixed(1) + '" width="' + bw.toFixed(1) +
                 '" height="' + hg.toFixed(1) + '" fill="#6FB77F" opacity="0.9" rx="1"/>';
            if (r.year === 1 || r.year === n || r.year % step === 0) {
                s += '<text x="' + cx.toFixed(1) + '" y="' + (y0 + 16) + '" text-anchor="middle" ' +
                     'font-family="\'JetBrains Mono\',monospace" font-size="9.5" fill="#6B7A93">' + r.year + '</text>';
            }
        });

        // legend + axis title
        s += '<rect x="' + L + '" y="14" width="9" height="9" fill="#D98A8A" rx="1"/>' +
             '<text x="' + (L + 15) + '" y="22.5" font-family="\'JetBrains Mono\',monospace" font-size="10.5" ' +
             'fill="#D98A8A">interest you pay that year</text>' +
             '<rect x="' + (L + 210) + '" y="14" width="9" height="9" fill="#6FB77F" rx="1"/>' +
             '<text x="' + (L + 225) + '" y="22.5" font-family="\'JetBrains Mono\',monospace" font-size="10.5" ' +
             'fill="#6FB77F">growth you earn that year</text>' +
             '<text x="' + (L + pw / 2) + '" y="' + (H - 8) + '" text-anchor="middle" ' +
             'font-family="\'JetBrains Mono\',monospace" font-size="10" fill="#6B7A93">YEAR →</text>';

        s += '</svg>';
        host.innerHTML = s;
    }

    function renderSafety(m) {
        set('aa-safe-prot', fmtSigned(m.net));
        set('aa-safe-prot-note', fmtPct(m.g) + ' every year · ends ' + fmtUSD(m.base) +
            ' · interest paid ' + fmtUSD(m.loan.totalInterest));
        set('aa-safe-vol', fmtSigned(m.volNet));
        set('aa-safe-vol-note', fmtPct(m.up, 0) + ' / ' + fmtPct(m.dn, 0) + ' alternating — same ' +
            fmtPct(m.g) + ' average · ends ' + fmtUSD(m.vol) + ' · same interest paid');

        const p = $('aa-safe-punch');
        if (p) {
            p.innerHTML = 'Identical average return. A <b style="color:var(--gold-bright)">' +
                fmtUSD(Math.abs(m.swingCost)) + '</b> swing in the outcome — ' +
                (m.net >= 0 && m.volNet < 0
                    ? 'one finishes <b style="color:var(--green)">' + fmtSigned(m.net) +
                      '</b> ahead, the other <b style="color:var(--red)">' + fmtSigned(m.volNet) + '</b> behind. '
                    : 'the smooth path finishes <b style="color:var(--green)">' + fmtUSD(Math.abs(m.swingCost)) +
                      '</b> richer. ') +
                'The <b>only</b> difference is the path. A year that gives back has to be climbed twice — once to ' +
                'recover, again to grow — while the loan payment arrives on schedule either way. ' +
                '<b style="color:var(--gold-bright)">That is what &ldquo;protected&rdquo; buys.</b>';
        }
    }

    function renderAll() {
        const m = build();
        renderHeadline(m);
        renderLedger(m);
        renderChart(m);
        renderSafety(m);
    }

    function init() {
        if (!$('aa-amt')) return;                       // section not on this page

        ['aa-amt', 'aa-apr', 'aa-yrs', 'aa-growth'].forEach(id => {
            const el = $(id);
            if (el) { el.addEventListener('input', renderAll); el.addEventListener('change', renderAll); }
        });

        document.querySelectorAll('.aa-preset').forEach(b => {
            b.addEventListener('click', () => {
                if ($('aa-amt')) $('aa-amt').value = b.dataset.amt;
                if ($('aa-apr')) $('aa-apr').value = b.dataset.apr;
                if ($('aa-yrs')) $('aa-yrs').value = b.dataset.yrs;
                document.querySelectorAll('.aa-preset').forEach(o => o.classList.toggle('on', o === b));
                renderAll();
            });
        });

        renderAll();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})(typeof window !== 'undefined' ? window : globalThis);
