// =====================================================
// Options Dashboard ($10k → $100k) — live renderer.
//   · Status strip + progress-to-$100k bar
//   · KPI grid (net, WR, PF, R-exp, EV, magnitudes, streak, avg risk)
//   · Equity curve ($10k base) + monthly P&L (Chart.js)
//   · Every-fill trade log
// Reads data/options_trades.json; re-polls every 60s (pauses when hidden).
// =====================================================
(function (root) {
    'use strict';
    const $ = id => document.getElementById(id);
    const BASE = 10000, TARGET = 100000;
    const NAVY = '#1B2A4A', GOLD = '#C8A951', POS = '#2D5016', NEG = '#DC2626';

    function fmtUSD(v) { return (v == null || !isFinite(v)) ? '$—' : (v < 0 ? '−$' : '$') + Math.abs(Math.round(v)).toLocaleString(); }
    function fmtSigned(v) { return (v == null || !isFinite(v)) ? '—' : (v >= 0 ? '+$' : '−$') + Math.abs(Math.round(v)).toLocaleString(); }
    function fmtR(v) { return (v == null || !isFinite(v)) ? '—' : (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2) + 'R'; }
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

    async function fetchJSON(url) {
        try { const r = await fetch(url + '?t=' + Date.now(), { cache: 'no-store' }); if (!r.ok) throw 0; const j = await r.json(); return Array.isArray(j) ? j : []; }
        catch (e) { return []; }
    }
    function parseTS(raw) {
        if (!raw) return null;
        let m = String(raw).match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
        m = String(raw).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
        if (m) return new Date(+m[3], +m[1] - 1, +m[2]);
        const d = new Date(raw); return isNaN(d.getTime()) ? null : d;
    }

    // ── Window filter (preset chips + custom date range) ──────────────
    // KPIs and the trade log honor the selected window; the equity curve,
    // monthly bars, and race-to-$100k header stay all-time as context.
    let lastTrades = [];        // last fetched closed-fill set, for re-paint without re-fetch
    let currentTf = 'all';
    let customRange = null;     // { from: Date, to: Date } when currentTf === 'custom'

    // Parse an <input type="date"> value ("YYYY-MM-DD") as a LOCAL date.
    // end=true snaps to end-of-day so the "to" bound includes the whole day.
    function parseLocalDate(v, end) {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v || '');
        if (!m) return null;
        return end ? new Date(+m[1], +m[2] - 1, +m[3], 23, 59, 59, 999)
                   : new Date(+m[1], +m[2] - 1, +m[3], 0, 0, 0, 0);
    }

    function filterByTimeframe(trades, tf) {
        if (!tf || tf === 'all' || !trades.length) return trades;
        const tsOf = t => parseTS(t.entry_time || t.trade_date || t.datetime);
        if (tf === 'custom') {
            if (!customRange) return trades;
            return trades.filter(t => { const d = tsOf(t); return d && d >= customRange.from && d <= customRange.to; });
        }
        const latest = trades.reduce((max, t) => { const d = tsOf(t); return d && (!max || d > max) ? d : max; }, null);
        if (!latest) return trades;
        const cutoff = new Date(latest);
        switch (tf) {
            case '7d':  cutoff.setDate(cutoff.getDate() - 7); break;
            case '30d': cutoff.setDate(cutoff.getDate() - 30); break;
            case '90d': cutoff.setDate(cutoff.getDate() - 90); break;
            case 'mtd': cutoff.setDate(1); cutoff.setHours(0, 0, 0, 0); break;
            case 'ytd': cutoff.setMonth(0, 1); cutoff.setHours(0, 0, 0, 0); break;
            default: return trades;
        }
        return trades.filter(t => { const d = tsOf(t); return d && d >= cutoff; });
    }

    function windowLabel(trades) {
        if (!trades.length) return '0 fills in window';
        const ds = trades.map(t => parseTS(t.entry_time || t.trade_date)).filter(Boolean).sort((a, b) => a - b);
        const fmt = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        const span = ds.length && ds[0].getTime() !== ds[ds.length - 1].getTime()
            ? `${fmt(ds[0])} → ${fmt(ds[ds.length - 1])}`
            : (ds.length ? fmt(ds[0]) : '');
        return `${trades.length} fills${span ? ' · ' + span : ''}`;
    }

    function compute(trades) {
        const pls = trades.map(t => t.dollar_pl || 0);
        const wins = trades.filter(t => (t.dollar_pl || 0) > 0);
        const losses = trades.filter(t => (t.dollar_pl || 0) <= 0);
        const gp = wins.reduce((a, t) => a + t.dollar_pl, 0);
        const gl = Math.abs(losses.reduce((a, t) => a + t.dollar_pl, 0));
        const Rs = trades.map(t => (t.risk_dollars > 0 ? (t.dollar_pl || 0) / t.risk_dollars : null)).filter(x => x != null);
        const net = pls.reduce((a, v) => a + v, 0);
        // longest losing streak
        let streak = 0, maxStreak = 0;
        trades.forEach(t => { if ((t.dollar_pl || 0) <= 0) { streak++; maxStreak = Math.max(maxStreak, streak); } else streak = 0; });

        // Max drawdown (deepest peak-to-trough on cumulative realized P&L) + recovery
        let cum = 0, peak = 0, maxDD = 0, troughIdx = -1, peakAtTrough = 0;
        trades.forEach((t, i) => {
            cum += t.dollar_pl || 0;
            if (cum > peak) peak = cum;
            const dd = peak - cum;
            if (dd > maxDD) { maxDD = dd; troughIdx = i; peakAtTrough = peak; }
        });
        let recovery = null;
        if (troughIdx >= 0 && maxDD > 0) {
            let cum2 = 0;
            for (let i = 0; i < trades.length; i++) {
                cum2 += trades[i].dollar_pl || 0;
                if (i > troughIdx && cum2 >= peakAtTrough) { recovery = i - troughIdx; break; }
            }
        }
        const best = trades.length ? trades.reduce((a, t) => (t.dollar_pl || 0) > (a.dollar_pl || 0) ? t : a) : null;
        const worst = trades.length ? trades.reduce((a, t) => (t.dollar_pl || 0) < (a.dollar_pl || 0) ? t : a) : null;

        // R-expectancy and its annualization. Annual R = per-trade R-expectancy
        // extrapolated to a full calendar year at the window's observed cadence.
        // Needs ≥2 dated fills and ≥1 day of span; short windows annualize noisily.
        const rexp = Rs.length ? Rs.reduce((a, v) => a + v, 0) / Rs.length : null;
        const ts = trades.map(t => parseTS(t.entry_time || t.trade_date)).filter(Boolean).sort((a, b) => a - b);
        const span = ts.length >= 2 ? { start: ts[0], end: ts[ts.length - 1] } : null;
        let annualR = null, tradesPerYear = null;
        if (rexp != null && span) {
            const days = Math.max(1, (span.end - span.start) / 86400000);
            tradesPerYear = (trades.length / days) * 365;
            annualR = rexp * tradesPerYear;
        }

        return {
            n: trades.length, net, bal: BASE + net,
            wr: trades.length ? wins.length / trades.length : 0,
            wins: wins.length, losses: losses.length,
            pf: gl > 0 ? gp / gl : (gp > 0 ? Infinity : 0),
            rexp,
            annualR, tradesPerYear,
            ev: trades.length ? net / trades.length : null,
            avgWin: wins.length ? gp / wins.length : null,
            avgLoss: losses.length ? -gl / losses.length : null,
            avgRisk: trades.length ? trades.reduce((a, t) => a + (t.risk_dollars || 0), 0) / trades.length : null,
            maxStreak, best, worst, maxDD, recovery
        };
    }

    function renderHead(s) {
        const pct = Math.max(0, Math.min(100, s.bal / TARGET * 100));
        if ($('od-bal')) $('od-bal').textContent = s.n ? fmtUSD(s.bal) : '—';
        if ($('od-pct')) $('od-pct').textContent = s.n ? pct.toFixed(1) + '%' : '—';
        if ($('od-net')) $('od-net').textContent = s.n ? fmtSigned(s.net) : '—';
        if ($('od-sample')) $('od-sample').textContent = s.n ? String(s.n) : '—';
        if ($('od-progress-fill')) $('od-progress-fill').style.width = pct.toFixed(2) + '%';
        if ($('od-progress-label')) $('od-progress-label').textContent = s.n ? pct.toFixed(1) + '%' : '—';
    }

    function renderKpis(s) {
        const set = (id, v, color) => { const e = $(id); if (e) { e.textContent = v; if (color) e.style.color = color; } };
        set('od-netpl', s.n ? fmtSigned(s.net) : '—', s.net >= 0 ? GOLD : NEG);
        set('od-wr', s.n ? (s.wr * 100).toFixed(1) + '%' : '—');
        if ($('od-wr-sub')) $('od-wr-sub').textContent = s.n ? `${s.wins} W / ${s.losses} L` : '—';
        set('od-pf', s.n ? (isFinite(s.pf) ? s.pf.toFixed(2) : '∞') : '—');
        set('od-rexp', s.rexp != null ? fmtR(s.rexp) : '—');
        set('od-annualr', s.annualR != null ? (s.annualR >= 0 ? '+' : '') + s.annualR.toFixed(0) + 'R' : '—');
        if ($('od-annualr-sub')) $('od-annualr-sub').textContent = s.tradesPerYear != null ? `~${Math.round(s.tradesPerYear)} fills/yr extrapolated` : 'extrapolated from cadence';
        set('od-ev', s.ev != null ? fmtSigned(s.ev) : '—');
        set('od-count', s.n ? String(s.n) : '—');
        if ($('od-wl')) $('od-wl').textContent = s.n ? `${s.wins} W / ${s.losses} L` : '—';
        set('od-avgwin', s.avgWin != null ? fmtSigned(s.avgWin) : '—');
        set('od-avgloss', s.avgLoss != null ? fmtSigned(s.avgLoss) : '—');
        set('od-best', s.best ? fmtSigned(s.best.dollar_pl) : '—');
        if ($('od-best-id') && s.best) $('od-best-id').textContent = `${s.best.trade_num} · ${s.best.ticker}`;
        set('od-worst', s.worst ? fmtSigned(s.worst.dollar_pl) : '—');
        if ($('od-worst-id') && s.worst) $('od-worst-id').textContent = `${s.worst.trade_num} · ${s.worst.ticker}`;
        set('od-dd', s.n ? '−' + fmtUSD(s.maxDD).replace('−', '') : '—');
        if ($('od-dd-sub')) $('od-dd-sub').textContent = s.maxDD > 0 ? `${(s.maxDD / BASE * 100).toFixed(1)}% of $10K working unit` : 'deepest peak-to-trough';
        set('od-recovery', s.recovery != null ? `${s.recovery} trades` : (s.maxDD > 0 ? 'in progress' : '—'));
        set('od-streak', s.n ? s.maxStreak + (s.maxStreak === 1 ? ' trade' : ' trades') : '—');
        set('od-avgrisk', s.avgRisk != null ? fmtUSD(s.avgRisk) : '—');
    }

    const charts = {};
    function destroy(k) { if (charts[k]) { charts[k].destroy(); delete charts[k]; } }

    function renderEquity(trades) {
        const cv = $('od-equity'); if (!cv || !root.Chart) return;
        destroy('eq');
        let cum = 0; const labels = [], data = [];
        trades.forEach(t => { cum += (t.dollar_pl || 0); labels.push(t.trade_num); data.push(Math.round(BASE + cum)); });
        // starting (and ending) month/year, from the first/last fill in sequence
        const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const monYr = t => {
            const it = t && t.entry_time || '';
            if (/^\d{4}-\d{2}/.test(it)) return MO[+it.slice(5, 7) - 1] + ' ' + it.slice(0, 4);
            const d = (t && t.trade_date || '').split('/');
            return d.length === 3 ? MO[+d[0] - 1] + ' ' + d[2] : '';
        };
        if (trades.length) {
            const start = monYr(trades[0]), end = monYr(trades[trades.length - 1]);
            const since = $('od-equity-since'); if (since) since.textContent = start ? ' · since ' + start : '';
            const range = $('od-equity-range');
            if (range) range.textContent = start ? (end && end !== start ? start + ' → ' + end : 'since ' + start) : 'since the first fill';
        }
        charts.eq = new root.Chart(cv, {
            type: 'line',
            data: { labels, datasets: [{
                label: 'Balance', data, borderColor: GOLD, backgroundColor: 'rgba(200,169,81,0.12)',
                borderWidth: 2.5, fill: true, tension: 0.15, pointRadius: 3, pointHoverRadius: 5,
                pointBackgroundColor: GOLD, pointBorderColor: NAVY
            }] },
            options: {
                responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { display: false },
                    tooltip: { callbacks: { label: c => 'Balance: ' + fmtUSD(c.parsed.y) } }
                },
                scales: {
                    x: { ticks: { font: { family: 'JetBrains Mono', size: 10 }, color: '#94A3B8' }, grid: { color: 'rgba(255,255,255,0.06)' } },
                    y: { ticks: { callback: v => '$' + v.toLocaleString(), font: { family: 'JetBrains Mono', size: 10 }, color: '#94A3B8' }, grid: { color: 'rgba(255,255,255,0.06)' } }
                }
            }
        });
    }

    function renderMonthly(trades) {
        const cv = $('od-monthly'); if (!cv || !root.Chart) return;
        destroy('mo');
        const map = new Map();
        trades.forEach(t => {
            const d = parseTS(t.entry_time || t.trade_date); if (!d) return;
            const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
            map.set(key, (map.get(key) || 0) + (t.dollar_pl || 0));
        });
        const keys = Array.from(map.keys()).sort();
        const data = keys.map(k => Math.round(map.get(k)));
        charts.mo = new root.Chart(cv, {
            type: 'bar',
            data: { labels: keys, datasets: [{ label: 'Profit', data, backgroundColor: data.map(v => v >= 0 ? GOLD : NEG) }] },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => fmtSigned(c.parsed.y) } } },
                scales: {
                    x: { ticks: { font: { family: 'JetBrains Mono', size: 10 }, color: '#94A3B8' }, grid: { display: false } },
                    y: { ticks: { callback: v => '$' + v.toLocaleString(), font: { family: 'JetBrains Mono', size: 10 }, color: '#94A3B8' }, grid: { color: 'rgba(255,255,255,0.06)' } }
                }
            }
        });
    }

    function renderTradeLog(trades) {
        const tb = $('od-trade-body'); if (!tb) return;
        if (!trades.length) { tb.innerHTML = '<tr><td colspan="11" class="muted italic">No fills on record yet.</td></tr>'; return; }
        tb.innerHTML = trades.slice().reverse().map(t => {
            const pl = t.dollar_pl || 0;
            const r = t.risk_dollars > 0 ? pl / t.risk_dollars : null;
            return `<tr>
                <td class="mono">${esc(t.trade_num)}</td>
                <td class="mono" style="font-size:11px">${esc(t.entry_time || t.trade_date || '—')}</td>
                <td>${esc(t.ticker || '—')}</td>
                <td class="num mono">${esc(t.strike || '—')}</td>
                <td>${esc(t.expiry || '—')}</td>
                <td>${esc(t.option_type || t.direction || '—')}</td>
                <td class="num mono">${t.entry_price != null ? '$' + t.entry_price : '—'}</td>
                <td class="num mono">${t.exit_price != null ? '$' + t.exit_price : '—'}</td>
                <td class="num mono" style="color:${pl >= 0 ? POS : NEG}">${(pl >= 0 ? '+$' : '−$') + Math.abs(pl)}</td>
                <td>${pl > 0 ? 'Win' : 'Loss'}</td>
                <td class="num mono">${r != null ? fmtR(r) : '—'}</td>
            </tr>`;
        }).join('');
    }

    function downloadCSV() {
        const cols = ['trade_num', 'entry_time', 'ticker', 'strike', 'expiry', 'option_type', 'direction', 'entry_price', 'exit_price', 'dollar_pl', 'risk_dollars', 'outcome'];
        const head = cols.join(',');
        const body = lastTrades.map(t => cols.map(c => JSON.stringify(t[c] ?? '')).join(',')).join('\n');
        const blob = new Blob([head + '\n' + body], { type: 'text/csv' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
        a.download = 'ekantik-options-trades.csv'; a.click();
    }

    // Paint from the last fetched set. Header + charts are all-time; KPIs and
    // the trade log honor the selected window. Called on every fetch and on
    // every window change (no re-fetch needed for the latter).
    function paint() {
        renderHead(compute(lastTrades));          // race-to-$100k progress is cumulative → all-time
        renderEquity(lastTrades);                 // context charts stay all-time
        renderMonthly(lastTrades);
        const windowed = filterByTimeframe(lastTrades, currentTf);
        renderKpis(compute(windowed));
        renderTradeLog(windowed);
        const win = $('od-tf-window'); if (win) win.textContent = windowLabel(windowed);
    }

    async function render() {
        const all = await fetchJSON('data/options_trades.json');
        lastTrades = Array.isArray(all) ? all.filter(t => t.outcome !== 'Open') : [];  // open positions excluded until closed
        paint();
    }

    function setActiveTf(tf) {
        currentTf = tf;
        document.querySelectorAll('.dash-tf-chip').forEach(b => {
            const on = b.dataset.tf === tf;
            b.classList.toggle('dash-tf-chip--active', on);
            b.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
    }

    // Read the two date inputs, build an inclusive local range, re-paint over it.
    // No-ops until both dates are set; swaps the bounds if picked in reverse.
    function applyCustom() {
        const fromEl = $('od-tf-from'), toEl = $('od-tf-to');
        if (!fromEl || !toEl || !fromEl.value || !toEl.value) return;
        let from = parseLocalDate(fromEl.value, false);
        let to   = parseLocalDate(toEl.value, true);
        if (!from || !to) return;
        if (from > to) { const t = from; from = to; to = t; }
        customRange = { from, to };
        setActiveTf('custom');
        try {
            localStorage.setItem('ekantik-odash-tf', 'custom');
            localStorage.setItem('ekantik-odash-custom', JSON.stringify({ from: fromEl.value, to: toEl.value }));
        } catch (e) {}
        paint();
    }

    function wireWindow() {
        // Restore a persisted window (preset or custom range).
        try { const saved = localStorage.getItem('ekantik-odash-tf'); if (saved) currentTf = saved; } catch (e) {}
        if (currentTf === 'custom') {
            try {
                const raw = localStorage.getItem('ekantik-odash-custom');
                if (raw) {
                    const cr = JSON.parse(raw);
                    const f = $('od-tf-from'), t = $('od-tf-to');
                    if (f) f.value = cr.from || '';
                    if (t) t.value = cr.to || '';
                    const from = parseLocalDate(cr.from, false), to = parseLocalDate(cr.to, true);
                    if (from && to) customRange = (from > to) ? { from: to, to: from } : { from, to };
                }
            } catch (e) {}
            if (!customRange) currentTf = 'all';
        }
        setActiveTf(currentTf);
        document.querySelectorAll('.dash-tf-chip').forEach(b => {
            if (b.id === 'od-tf-apply') { b.addEventListener('click', applyCustom); return; }
            b.addEventListener('click', () => {
                customRange = null;
                setActiveTf(b.dataset.tf);
                try { localStorage.setItem('ekantik-odash-tf', currentTf); } catch (e) {}
                paint();
            });
        });
        ['od-tf-from', 'od-tf-to'].forEach(id => {
            const el = $(id);
            if (el) el.addEventListener('change', () => {
                const f = $('od-tf-from'), t = $('od-tf-to');
                if (f && t && f.value && t.value) applyCustom();
            });
        });
    }

    function init() {
        wireWindow();
        const csv = $('od-csv'); if (csv) csv.addEventListener('click', downloadCSV);
        render();
        setInterval(() => { if (document.visibilityState !== 'hidden') render(); }, 60000);
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') render(); });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})(typeof window !== 'undefined' ? window : globalThis);
