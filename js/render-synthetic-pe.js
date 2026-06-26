// =====================================================
// Synthetic PE front door — live engine numbers + the two challenges.
// Self-contained (this page has its own styles, no site data layer).
//   • Cash-flow engine challenge: finish net-positive EVERY MONTH.
//     → shows months-green / total and the current month's running P&L.
//   • Compounding engine challenge: take $5k → $50k as fast as possible.
//     → shows NET PROFIT and its % of a 10× run ($50k), not balance.
// Re-polls every 60s; pauses while the tab is hidden. NOT a forecast.
// =====================================================
(function (root) {
    'use strict';
    const $ = id => document.getElementById(id);

    async function fetchJSON(url) {
        try {
            const r = await fetch(url + (url.includes('?') ? '&' : '?') + 't=' + Date.now(), { cache: 'no-store' });
            if (!r.ok) throw 0;
            const j = await r.json();
            return Array.isArray(j) ? j : [];
        } catch (e) { return null; }
    }
    function net(trades) { return trades.reduce((a, t) => a + (t.dollar_pl || 0), 0); }
    function stats(trades) {
        const n = net(trades);
        const Rs = trades.map(t => (t.risk_dollars > 0 ? (t.dollar_pl || 0) / t.risk_dollars : null)).filter(x => x != null);
        const r = Rs.length ? Rs.reduce((a, v) => a + v, 0) / Rs.length : null;
        return { n: trades.length, net: n, r };
    }
    function monthKey(t) {
        const s = t.entry_time || '';
        if (/^\d{4}-\d{2}/.test(s)) return s.slice(0, 7);              // "2026-02-04 ..." -> "2026-02"
        const d = (t.trade_date || '').split('/');                    // "2/4/2026"
        if (d.length === 3) return d[2] + '-' + ('0' + d[0]).slice(-2);
        return null;
    }
    function monthly(trades) {
        const map = {};
        trades.forEach(t => { const k = monthKey(t); if (k) map[k] = (map[k] || 0) + (t.dollar_pl || 0); });
        const keys = Object.keys(map).sort();
        const positive = keys.filter(k => map[k] > 0).length;
        const current = keys.length ? map[keys[keys.length - 1]] : 0;
        return { total: keys.length, positive: positive, current: current, pct: keys.length ? positive / keys.length * 100 : 0 };
    }
    const fmtSigned = v => (v >= 0 ? '+$' : '−$') + Math.abs(Math.round(v)).toLocaleString();
    const fmtUSD = v => (v < 0 ? '−$' : '$') + Math.abs(Math.round(v)).toLocaleString();
    const fmtR = v => v == null ? '—' : (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2) + 'R';
    const setText = (id, v) => { const e = $(id); if (e) e.textContent = v; };
    const setW = (id, pct) => { const e = $(id); if (e) e.style.width = Math.max(0, Math.min(100, pct)).toFixed(1) + '%'; };

    async function render() {
        const [f, o] = await Promise.all([
            fetchJSON('data/tenx_trades.json'),
            fetchJSON('data/options_trades.json')
        ]);

        // --- Cash-flow engine: stats card + "green every month" challenge ---
        if (f) {
            const s = stats(f);
            setText('sp-cf-trades', String(s.n));
            setText('sp-cf-net', fmtSigned(s.net));
            setText('sp-cf-r', fmtR(s.r));
            const m = monthly(f);
            setText('sp-cf-pct', m.positive + ' / ' + m.total);
            setW('sp-cf-fill', m.pct);
            setText('sp-cf-month', fmtSigned(m.current));
        }

        // --- Compounding engine: stats card + "$5k -> $50k" challenge ---
        // Progress is measured on NET PROFIT toward $50k (not the account balance).
        if (o) {
            const s = stats(o.filter(t => t.outcome !== 'Open'));  // open positions don't count until closed
            setText('sp-co-net', fmtSigned(s.net));
            setText('sp-co-trades', String(s.n));
            setText('sp-co-bal', fmtSigned(s.net));                          // net profit, not balance
            setText('sp-co-pct', (s.net / 50000 * 100).toFixed(1) + '% of a 10× run');
            setW('sp-co-fill', s.net / 50000 * 100);
        }
    }

    function init() {
        render();
        setInterval(() => { if (document.visibilityState !== 'hidden') render(); }, 60000);
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') render(); });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})(typeof window !== 'undefined' ? window : globalThis);
