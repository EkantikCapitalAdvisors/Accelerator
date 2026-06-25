// =====================================================
// Synthetic PE front door — live engine numbers.
// Self-contained (this page has its own styles, no site data layer).
// Fetches both trade journals, populates the two engine stat blocks and
// the "$100k proof point" progress bars (cumulative profit / $100k, kept
// separate per engine). Re-polls every 60s; pauses while the tab is hidden.
// =====================================================
(function (root) {
    'use strict';
    const $ = id => document.getElementById(id);
    const TARGET = 100000;

    async function fetchJSON(url) {
        try {
            const r = await fetch(url + (url.includes('?') ? '&' : '?') + 't=' + Date.now(), { cache: 'no-store' });
            if (!r.ok) throw 0;
            const j = await r.json();
            return Array.isArray(j) ? j : [];
        } catch (e) { return null; }
    }
    function stats(trades) {
        const net = trades.reduce((a, t) => a + (t.dollar_pl || 0), 0);
        const Rs = trades.map(t => (t.risk_dollars > 0 ? (t.dollar_pl || 0) / t.risk_dollars : null)).filter(x => x != null);
        const r = Rs.length ? Rs.reduce((a, v) => a + v, 0) / Rs.length : null;
        return { n: trades.length, net, r };
    }
    function fmtSigned(v) { return (v >= 0 ? '+$' : '−$') + Math.abs(Math.round(v)).toLocaleString(); }
    function fmtR(v) { return v == null ? '—' : (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2) + 'R'; }

    function setText(id, v) { const e = $(id); if (e) e.textContent = v; }
    function setBar(pctId, fillId, net) {
        const pct = Math.max(0, Math.min(100, net / TARGET * 100));
        setText(pctId, pct.toFixed(1) + '%');
        const f = $(fillId); if (f) f.style.width = Math.max(pct, 0).toFixed(1) + '%';
    }

    async function render() {
        const [f, o] = await Promise.all([
            fetchJSON('data/tenx_trades.json'),
            fetchJSON('data/options_trades.json')
        ]);
        if (f) {
            const s = stats(f);
            setText('sp-cf-trades', String(s.n));
            setText('sp-cf-net', fmtSigned(s.net));
            setText('sp-cf-r', fmtR(s.r));
            setBar('sp-cf-pct', 'sp-cf-fill', s.net);
        }
        if (o) {
            const s = stats(o);
            setText('sp-co-net', fmtSigned(s.net));
            setText('sp-co-trades', String(s.n));
            setBar('sp-co-pct', 'sp-co-fill', s.net);
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
