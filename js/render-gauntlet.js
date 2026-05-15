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

        // Gate 01
        const g1 = data.gate01 || {};
        const target = Number(g1.target) || 6000;
        const value  = Number(g1.value) || 0;
        const pct    = g1.percent != null ? Number(g1.percent) : Math.max(0, Math.min(100, (value / target) * 100));
        const fill   = $('gate-01-fill');
        if (fill) {
            fill.style.width = pct.toFixed(1) + '%';
            const bar = fill.parentElement;
            if (bar && bar.setAttribute) bar.setAttribute('aria-valuenow', pct.toFixed(0));
        }
        const v1 = $('gate-01-value');
        if (v1) v1.textContent = `${fmtUSD(value)} of ${fmtUSD(target)} (${pct.toFixed(0)}%)`;
        const s1 = $('gate-01-state');
        if (s1) s1.textContent = stateLabel(g1.state);
        applyStateClass($('gate-01'), g1.state);

        // Gate 02
        const g2 = data.gate02 || {};
        const v2 = $('gate-02-value');
        if (v2) v2.textContent = (g2.participants != null) ? g2.participants : '—';
        const s2 = $('gate-02-state');
        if (s2) s2.textContent = stateLabel(g2.state) + (g2.bandStatus === 'within_band' ? ' · within band' : '');
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

    function init() {
        if (!$('gauntlet')) return;
        load();
    }

    root.Ekantik = root.Ekantik || {};
    root.Ekantik.Gauntlet = { init, load, render };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})(typeof window !== 'undefined' ? window : globalThis);
