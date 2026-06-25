// =====================================================
// The Race to $100k — futures vs options leaderboard (landing page).
// Both strategies start at $10,000; balance = $10k + cumulative realized
// P&L. Fetches both trade journals, renders the two race cards, marks the
// leader, and re-polls every 60s so the standings update without a reload.
// =====================================================
(function (root) {
    'use strict';
    const $ = id => document.getElementById(id);
    const BASE = 10000, TARGET = 100000;

    async function fetchJSON(url) {
        try {
            const r = await fetch(url + (url.includes('?') ? '&' : '?') + 't=' + Date.now(), { cache: 'no-store' });
            if (!r.ok) throw 0;
            const j = await r.json();
            return Array.isArray(j) ? j : [];
        } catch (e) { return []; }
    }
    function net(trades) { return (trades || []).reduce((a, t) => a + (t.dollar_pl || t.dollarPL || 0), 0); }
    function fmtUSD(v) { return (v < 0 ? '−$' : '$') + Math.abs(Math.round(v)).toLocaleString(); }
    function fmtSigned(v) { return (v >= 0 ? '+$' : '−$') + Math.abs(Math.round(v)).toLocaleString(); }

    function setCard(prefix, trades, leading) {
        const n = trades.length, nt = net(trades), bal = BASE + nt;
        const pct = Math.max(0, Math.min(100, bal / TARGET * 100));
        if ($(prefix + '-bal')) $(prefix + '-bal').textContent = fmtUSD(bal);
        if ($(prefix + '-pct')) $(prefix + '-pct').textContent = pct.toFixed(1) + '%';
        if ($(prefix + '-net')) $(prefix + '-net').textContent = fmtSigned(nt);
        if ($(prefix + '-n')) $(prefix + '-n').textContent = String(n);
        if ($(prefix + '-fill')) $(prefix + '-fill').style.width = pct.toFixed(1) + '%';
        const badge = $(prefix + '-badge');
        if (badge) {
            badge.textContent = leading ? '◆ Leading' : '';
            badge.style.display = leading ? 'inline-block' : 'none';
        }
        return bal;
    }

    async function render() {
        const [f, o] = await Promise.all([
            fetchJSON('data/tenx_trades.json'),
            fetchJSON('data/options_trades.json')
        ]);
        const fbal = BASE + net(f), obal = BASE + net(o);
        const fLead = fbal >= obal;
        setCard('race-futures', f, fLead);
        setCard('race-options', o, !fLead);
        const gap = Math.abs(fbal - obal);
        const gapEl = $('race-gap');
        if (gapEl) {
            gapEl.innerHTML = gap === 0
                ? 'Dead even.'
                : (fLead ? 'Futures' : 'Options') + ' leads by ' + fmtUSD(gap) + '.';
        }
    }

    function init() {
        if (!$('race')) return;
        render();
        setInterval(() => { if (document.visibilityState !== 'hidden') render(); }, 60000);
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') render(); });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})(typeof window !== 'undefined' ? window : globalThis);
