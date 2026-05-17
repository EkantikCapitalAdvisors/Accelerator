// =====================================================
// Section 06 — Qualifying Gauntlet (Dev Spec §3.6)
// Loads /data/gauntlet.json and renders both gates + activation banner.
// =====================================================
(function (root) {
    'use strict';

    function $(id) { return document.getElementById(id); }
    function fmtUSD(n) {
        if (n == null || !isFinite(n)) return '—';
        return '$' + Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 });
    }

    function stateLabel(state) {
        switch (state) {
            case 'in_progress': return 'In progress';
            case 'passed': return 'Passed';
            case 'failed': return 'Deferred';
            case 'pending': return 'Pending';
            default: return '—';
        }
    }

    function applyStateClass(el, state) {
        if (!el) return;
        el.classList.remove('is-pending', 'is-in-progress', 'is-passed', 'is-failed');
        if (state === 'in_progress') el.classList.add('is-in-progress');
        else if (state === 'passed') el.classList.add('is-passed');
        else if (state === 'failed') el.classList.add('is-failed');
        else el.classList.add('is-pending');
    }

    function render(data) {
        if (!data) return;

        // Gate 01 — Tradeify challenge
        const g1 = data.gate01 || {};
        const target = Number(g1.target) || 6000;
        const value  = Number(g1.value) || 0;
        const pct    = g1.percent != null ? Number(g1.percent) : Math.max(0, Math.min(100, (value / target) * 100));
        const fill   = $('gate-01-fill');
        if (fill) {
            fill.style.width = (g1.state === 'pending' ? 0 : pct).toFixed(1) + '%';
            const bar = fill.parentElement;
            if (bar && bar.setAttribute) bar.setAttribute('aria-valuenow', (g1.state === 'pending' ? 0 : pct).toFixed(0));
        }
        const v1 = $('gate-01-value');
        if (v1) {
            if (g1.state === 'pending') v1.textContent = `Awaiting start · target ${fmtUSD(target)}`;
            else if (g1.state === 'passed') v1.textContent = `Passed · ${fmtUSD(value)} of ${fmtUSD(target)}`;
            else v1.textContent = `${fmtUSD(value)} of ${fmtUSD(target)} (${pct.toFixed(0)}%)`;
        }
        const s1 = $('gate-01-state');
        if (s1) s1.textContent = stateLabel(g1.state) + (g1.note && g1.state === 'pending' ? ' · ' + g1.note : '');
        applyStateClass($('gate-01'), g1.state);

        // Gate 02 — Mirror participants
        const g2 = data.gate02 || {};
        const v2 = $('gate-02-value');
        if (v2) v2.textContent = (g2.participants != null) ? g2.participants : '—';
        const s2 = $('gate-02-state');
        if (s2) {
            let txt = stateLabel(g2.state);
            if (g2.state === 'in_progress' && g2.bandStatus === 'within_band') txt += ' · within band';
            if (g2.state === 'pending' && g2.note) txt += ' · ' + g2.note;
            s2.textContent = txt;
        }
        applyStateClass($('gate-02'), g2.state);

        // Updated stamp
        const upd = $('gauntlet-updated');
        if (upd && data.updatedAt) {
            const d = new Date(data.updatedAt);
            if (!isNaN(d)) upd.textContent = d.toLocaleDateString(undefined, { year:'numeric', month:'short', day:'numeric' });
            else upd.textContent = data.updatedAt;
        }
    }

    async function load() {
        try {
            const res = await fetch('data/gauntlet.json', { cache: 'no-store' });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const data = await res.json();
            render(data);
        } catch (err) {
            // Soft-fail — leave placeholders; do not break the page.
            const upd = $('gauntlet-updated');
            if (upd) upd.textContent = 'unavailable';
            const s1 = $('gate-01-state'); if (s1) s1.textContent = '—';
            const s2 = $('gate-02-state'); if (s2) s2.textContent = '—';
            const v1 = $('gate-01-value'); if (v1) v1.textContent = '—';
            // Surface in console for ops, not the user
            console && console.warn && console.warn('[gauntlet] load failed:', err);
        }
    }

    // ─── Early-stability threshold tracker ───
    // Bound to the live trade summary. Threshold = 100 qualified trades AND
    // rolling-100 realized expectancy ≥ +$50/trade. Mirrors Article III §1
    // of the locked Falsifiability Protocol.
    const THRESH_SAMPLE = 100;
    const THRESH_EV     = 50;

    function rollingExpectancy(trades, window) {
        if (!Array.isArray(trades) || trades.length === 0) return null;
        const sample = trades.length >= window ? trades.slice(-window) : trades;
        const sum = sample.reduce((acc, t) => acc + (t.dollar_pl || t.dollarPL || 0), 0);
        return sum / sample.length;
    }

    function fmtEV(v) {
        if (v == null || !isFinite(v)) return '—';
        return (v >= 0 ? '+$' : '-$') + Math.abs(Math.round(v));
    }

    function renderThreshold(state) {
        const trades = (state && state.trades) || [];
        const n = trades.length;
        const ev = rollingExpectancy(trades, THRESH_SAMPLE);

        const samplePct = Math.max(0, Math.min(100, (n / THRESH_SAMPLE) * 100));
        const evPct     = ev == null ? 0 : Math.max(0, Math.min(100, (ev / THRESH_EV) * 100));

        const sf = $('thresh-sample-fill'); if (sf) sf.style.width = samplePct.toFixed(1) + '%';
        const ef = $('thresh-ev-fill');     if (ef) ef.style.width = evPct.toFixed(1) + '%';

        const sv = $('thresh-sample-val'); if (sv) sv.textContent = String(n);
        const ev_el = $('thresh-ev-val');  if (ev_el) ev_el.textContent = fmtEV(ev) + ' per trade';

        // a11y
        const sBar = sf && sf.parentElement; if (sBar) sBar.setAttribute('aria-valuenow', samplePct.toFixed(0));
        const eBar = ef && ef.parentElement; if (eBar) eBar.setAttribute('aria-valuenow', evPct.toFixed(0));

        const st = $('thresh-status');
        if (st) {
            const sampleOK = n >= THRESH_SAMPLE;
            const evOK     = ev != null && ev >= THRESH_EV;
            if (sampleOK && evOK) {
                st.innerHTML = '<strong>Threshold met.</strong> Gauntlet is eligible to open. The operator will activate Gate 01 (Tradeify challenge) and post the start date to the Discord journal.';
                st.className = 'threshold-tracker__status is-met';
            } else {
                const need = [];
                if (!sampleOK) need.push(`${THRESH_SAMPLE - n} more closed qualified trades`);
                if (!evOK)     need.push(`rolling expectancy ≥ +$${THRESH_EV}/trade (currently ${fmtEV(ev)})`);
                st.innerHTML = `<strong>Threshold pending.</strong> Needs ${need.join(' &nbsp;·&nbsp; ')}.`;
                st.className = 'threshold-tracker__status';
            }
        }
    }

    function init() {
        if (!$('gauntlet')) return;
        load();

        // Subscribe to the live trade feed for the threshold tracker.
        if (root.Ekantik && root.Ekantik.Data) {
            root.Ekantik.Data.onChange(renderThreshold);
            const cur = root.Ekantik.Data.get();
            if (cur) renderThreshold(cur);
        }
    }

    root.Ekantik = root.Ekantik || {};
    root.Ekantik.Gauntlet = { init, load, render };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})(typeof window !== 'undefined' ? window : globalThis);
