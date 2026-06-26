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
        const best = trades.length ? trades.reduce((a, t) => (t.dollar_pl || 0) > (a.dollar_pl || 0) ? t : a) : null;
        const worst = trades.length ? trades.reduce((a, t) => (t.dollar_pl || 0) < (a.dollar_pl || 0) ? t : a) : null;
        return {
            n: trades.length, net, bal: BASE + net,
            wr: trades.length ? wins.length / trades.length : 0,
            wins: wins.length, losses: losses.length,
            pf: gl > 0 ? gp / gl : (gp > 0 ? Infinity : 0),
            rexp: Rs.length ? Rs.reduce((a, v) => a + v, 0) / Rs.length : null,
            ev: trades.length ? net / trades.length : null,
            avgWin: wins.length ? gp / wins.length : null,
            avgLoss: losses.length ? -gl / losses.length : null,
            avgRisk: trades.length ? trades.reduce((a, t) => a + (t.risk_dollars || 0), 0) / trades.length : null,
            maxStreak, best, worst
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
        set('od-ev', s.ev != null ? fmtSigned(s.ev) : '—');
        set('od-count', s.n ? String(s.n) : '—');
        if ($('od-wl')) $('od-wl').textContent = s.n ? `${s.wins} W / ${s.losses} L` : '—';
        set('od-avgwin', s.avgWin != null ? fmtSigned(s.avgWin) : '—');
        set('od-avgloss', s.avgLoss != null ? fmtSigned(s.avgLoss) : '—');
        set('od-best', s.best ? fmtSigned(s.best.dollar_pl) : '—');
        if ($('od-best-id') && s.best) $('od-best-id').textContent = `${s.best.trade_num} · ${s.best.ticker}`;
        set('od-worst', s.worst ? fmtSigned(s.worst.dollar_pl) : '—');
        if ($('od-worst-id') && s.worst) $('od-worst-id').textContent = `${s.worst.trade_num} · ${s.worst.ticker}`;
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

    async function render() {
        const all = await fetchJSON('data/options_trades.json');
        const trades = Array.isArray(all) ? all.filter(t => t.outcome !== 'Open') : all;  // open positions excluded until closed
        const s = compute(trades);
        renderHead(s);
        renderKpis(s);
        renderEquity(trades);
        renderMonthly(trades);
        renderTradeLog(trades);
    }

    function init() {
        render();
        setInterval(() => { if (document.visibilityState !== 'hidden') render(); }, 60000);
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') render(); });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})(typeof window !== 'undefined' ? window : globalThis);
