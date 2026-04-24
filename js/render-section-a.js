// =====================================================
// Section A — Edge Power. Spec §5.
// Renders the 3-block "Edge stated plainly" row, the Doubling Ladder
// (target vs live), and the 95/5 Portfolio Reshaper with editable sliders.
// =====================================================
(function (root) {
    'use strict';

    function $(id) { return document.getElementById(id); }

    // ─── The Edge stated plainly ───
    function renderEdgeTriplet(state) {
        const s = state.summary;
        if (!s || !s.n) return;
        $('edge-wr') && ($('edge-wr').textContent = (s.winRate * 100).toFixed(1) + '%');
        $('edge-pf') && ($('edge-pf').textContent = s.profitFactor === Infinity ? '∞' : s.profitFactor.toFixed(2));
        $('edge-rexp') && ($('edge-rexp').textContent = (s.rExpectancy != null)
            ? ((s.rExpectancy >= 0 ? '+' : '') + s.rExpectancy.toFixed(2) + 'R')
            : '—');
    }

    // ─── Doubling Ladder ───
    // Target rate: 2.5%/mo. Live rate: geometric mean from actual fills.
    // Computed once n ≥ MIN_SAMPLE (3); displayed as "provisional" until
    // n ≥ PROVISIONAL_CUTOFF (25), which is the spec's confidence threshold.
    const TARGET_MONTHLY = 0.025;
    const MIN_SAMPLE = 3;
    const PROVISIONAL_CUTOFF = 25;

    function monthsToMultiple(rate, multiple) {
        if (rate <= 0) return null;
        return Math.log(multiple) / Math.log(1 + rate);
    }

    function parseTime(str) {
        const m = (str || '').match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i);
        if (!m) return { h: 0, min: 0, s: 0 };
        let h = parseInt(m[1]);
        const min = parseInt(m[2]);
        const s = m[3] ? parseInt(m[3]) : 0;
        const ampm = (m[4] || '').toUpperCase();
        if (ampm === 'PM' && h < 12) h += 12;
        if (ampm === 'AM' && h === 12) h = 0;
        return { h, min, s };
    }

    function parseTS(raw) {
        if (!raw) return null;
        // ISO-date prefix: "2026-02-04 09:40:15" or "2026-04-10 8:54 AM"
        let m = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](.+))?$/);
        if (m) {
            const yr = parseInt(m[1]), mo = parseInt(m[2]), day = parseInt(m[3]);
            const { h, min, s } = parseTime(m[4]);
            const d = new Date(yr, mo - 1, day, h, min, s);
            return isNaN(d.getTime()) ? null : d;
        }
        // US slash: "2/18/2026 08:39" or "4/13/2026 8:33 AM"
        m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(.+))?$/);
        if (m) {
            const mo = parseInt(m[1]), day = parseInt(m[2]), yr = parseInt(m[3]);
            const { h, min, s } = parseTime(m[4]);
            const d = new Date(yr, mo - 1, day, h, min, s);
            return isNaN(d.getTime()) ? null : d;
        }
        const d = new Date(raw);
        return isNaN(d.getTime()) ? null : d;
    }

    function computeLiveRate(rawTrades) {
        const n = Array.isArray(rawTrades) ? rawTrades.length : 0;
        if (n < MIN_SAMPLE) {
            return { ok: false, reason: `Need ${MIN_SAMPLE} trades (have ${n}).`, n };
        }
        // Keep only trades with parseable timestamps so first/last of the sort are always valid.
        // P&L from trades with missing timestamps still counts toward cumPL — we just don't
        // use their timestamps to define the calendar window.
        const withTS = rawTrades
            .map(t => ({ t, ts: parseTS(t.entry_time || t.entryTime) }))
            .filter(x => x.ts != null);
        if (withTS.length < MIN_SAMPLE) {
            return { ok: false, reason: `Need ${MIN_SAMPLE} dated trades (have ${withTS.length}).`, n };
        }
        withTS.sort((a, b) => a.ts - b.ts);

        // Total P&L uses every trade (timestamped or not).
        const cumPL = rawTrades.reduce((s, t) => s + (t.dollar_pl || t.dollarPL || 0), 0);
        const start = 10000;
        const end = start + cumPL;
        const ret = cumPL / start;
        const first = withTS[0].ts;
        const lastRow = withTS[withTS.length - 1].t;
        const last = parseTS(lastRow.exit_time || lastRow.entry_time || lastRow.entryTime) || withTS[withTS.length - 1].ts;
        if (!first || !last || last <= first) return { ok: false, reason: 'Not enough calendar time.', n };
        const monthsElapsed = (last - first) / (1000 * 60 * 60 * 24 * 30.4375);
        if (monthsElapsed < 0.1 || ret <= -1) return { ok: false, reason: 'Not enough calendar time.', n };
        const rate = ret <= 0
            ? -(Math.pow(1 - Math.abs(ret), 1 / monthsElapsed) - 1) * -1  // keep sign
            : Math.pow(1 + ret, 1 / monthsElapsed) - 1;
        const provisional = n < PROVISIONAL_CUTOFF;
        return { ok: true, rate, ret, monthsElapsed, start, end, n, provisional };
    }

    function renderLadder(state) {
        const tbody = $('ladder-body');
        if (!tbody) return;
        const live = computeLiveRate(state.trades || []);
        const rungs = [
            { from: 10000, to: 20000, doublings: 1 },
            { from: 20000, to: 40000, doublings: 2 },
            { from: 40000, to: 80000, doublings: 3 },
            { from: 80000, to: 160000, doublings: 4 }
        ];
        tbody.innerHTML = rungs.map(r => {
            const tMo = monthsToMultiple(TARGET_MONTHLY, r.to / 10000);
            const lMo = live.ok ? monthsToMultiple(live.rate, r.to / 10000) : null;
            const tDisp = tMo == null ? '—' : `~${tMo.toFixed(1)} mo`;
            const lDisp = lMo == null ? '—' : `~${lMo.toFixed(1)} mo`;
            return `
              <tr>
                <td>$${(r.from/1000).toFixed(0)}K → $${(r.to/1000).toFixed(0)}K</td>
                <td>${r.doublings}</td>
                <td class="ladder__target">${tDisp}</td>
                <td class="ladder__live">${lDisp}</td>
              </tr>`;
        }).join('');

        const rateEl = $('ladder-live-rate');
        if (rateEl) {
            if (live.ok) {
                const ratePart = `${(live.rate * 100).toFixed(2)}% / month`;
                if (live.provisional) {
                    rateEl.innerHTML = `${ratePart} <span class="muted" style="font-weight:400">— provisional (n=${live.n}, firms up at ${PROVISIONAL_CUTOFF})</span>`;
                } else {
                    rateEl.textContent = ratePart;
                }
            } else {
                rateEl.textContent = live.reason;
            }
        }
    }

    // ─── 95/5 Portfolio Reshaper ───
    function compoundYear10(start, cagr, years) {
        return start * Math.pow(1 + cagr, years);
    }

    function renderReshaper() {
        const startEl = $('reshaper-start');
        const mktEl = $('reshaper-market-cagr');
        const specEl = $('reshaper-spec-cagr');
        const horizonEl = $('reshaper-horizon');
        const allocEl = $('reshaper-alloc');
        if (!startEl || !mktEl || !specEl || !horizonEl || !allocEl) return;

        const recompute = () => {
            const start = parseFloat(startEl.value) * 1000;
            const mCAGR = parseFloat(mktEl.value) / 100;
            const sCAGR = parseFloat(specEl.value) / 100;
            const years = parseFloat(horizonEl.value);
            const alloc = parseFloat(allocEl.value) / 100;

            const mktStart = start * (1 - alloc);
            const specStart = start * alloc;
            const mktEnd = compoundYear10(mktStart, mCAGR, years);
            const specEnd = compoundYear10(specStart, sCAGR, years);
            const total = mktEnd + specEnd;
            const mktShare = total > 0 ? mktEnd / total : 0;
            const specShare = total > 0 ? specEnd / total : 0;

            $('reshaper-start-val').textContent = '$' + start.toLocaleString(undefined, { maximumFractionDigits: 0 });
            $('reshaper-market-cagr-val').textContent = (mCAGR * 100).toFixed(0) + '%';
            $('reshaper-spec-cagr-val').textContent = (sCAGR * 100).toFixed(0) + '%';
            $('reshaper-horizon-val').textContent = years + ' yrs';
            $('reshaper-alloc-val').textContent = (alloc * 100).toFixed(0) + '%';

            $('reshaper-total').textContent = '$' + total.toLocaleString(undefined, { maximumFractionDigits: 0 });
            $('reshaper-market').textContent = '$' + mktEnd.toLocaleString(undefined, { maximumFractionDigits: 0 });
            $('reshaper-spec').textContent = '$' + specEnd.toLocaleString(undefined, { maximumFractionDigits: 0 });
            $('reshaper-market-share').textContent = (mktShare * 100).toFixed(1) + '%';
            $('reshaper-spec-share').textContent = (specShare * 100).toFixed(1) + '%';

            const barMkt = $('reshaper-bar-market');
            const barSpec = $('reshaper-bar-spec');
            if (barMkt && barSpec) {
                barMkt.style.width  = (mktShare * 100) + '%';
                barSpec.style.width = (specShare * 100) + '%';
                barSpec.textContent = specShare > 0.08
                    ? `Speculative ${(specShare*100).toFixed(1)}% of value`
                    : '';
                barMkt.textContent  = mktShare > 0.1
                    ? `Market ${(mktShare*100).toFixed(1)}%`
                    : '';
            }
        };

        [startEl, mktEl, specEl, horizonEl, allocEl].forEach(el =>
            el.addEventListener('input', recompute));
        recompute();
    }

    // ─── Inline equity curve + monthly P&L bars ───
    function renderEquityAndMonthly(state) {
        const trades = state.trades || [];
        if (trades.length === 0) return;
        const eq = document.getElementById('section-a-equity');
        const mo = document.getElementById('section-a-monthly');
        if (eq && root.Ekantik.Charts) root.Ekantik.Charts.equityCurve(eq, trades, state.spyMonthly);
        if (mo && root.Ekantik.Charts) root.Ekantik.Charts.monthlyBars(mo, trades);

        // Running stats below the curve
        const netPL = trades.reduce((s, t) => s + (t.dollar_pl || 0), 0);
        const retPct = (netPL / 10000) * 100;
        const end = 10000 + netPL;

        const netEl = document.getElementById('section-a-net');
        const retEl = document.getElementById('section-a-return');
        const balEl = document.getElementById('section-a-balance');
        if (netEl) netEl.textContent = (netPL >= 0 ? '+' : '−') + '$' + Math.abs(netPL).toLocaleString(undefined, { maximumFractionDigits: 0 });
        if (retEl) retEl.textContent = (retPct >= 0 ? '+' : '') + retPct.toFixed(1) + '%';
        if (balEl) balEl.textContent = '$' + end.toLocaleString(undefined, { maximumFractionDigits: 0 });
    }

    function init() {
        root.Ekantik.Data.onChange(state => {
            renderEdgeTriplet(state);
            renderLadder(state);
            renderEquityAndMonthly(state);
        });
        const s = root.Ekantik.Data.get();
        if (s.summary) { renderEdgeTriplet(s); renderLadder(s); renderEquityAndMonthly(s); }
        renderReshaper();
    }

    root.Ekantik = root.Ekantik || {};
    root.Ekantik.SectionA = { init };
})(typeof window !== 'undefined' ? window : globalThis);
