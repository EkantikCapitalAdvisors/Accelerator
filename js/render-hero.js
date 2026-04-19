// =====================================================
// Hero — stat quartet + trust strip. Spec §4.
// =====================================================
(function (root) {
    'use strict';

    function $(id) { return document.getElementById(id); }

    function fmtPct(v) {
        if (v == null || !isFinite(v)) return '—';
        return (v * 100).toFixed(1) + '%';
    }
    function fmtPF(v) {
        if (v == null || !isFinite(v)) return '—';
        if (v === Infinity) return '∞';
        return v.toFixed(2);
    }
    function fmtR(v) {
        if (v == null || !isFinite(v)) return '—';
        return (v >= 0 ? '+' : '') + v.toFixed(2) + 'R';
    }
    function fmtEV(v) {
        if (v == null || !isFinite(v)) return '—';
        return '$' + v.toFixed(0);
    }

    function renderHero(state) {
        const s = state.summary || {};
        if (!s.n) {
            // No data yet — show em-dashes
            ['hero-stat-1', 'hero-stat-2', 'hero-stat-3', 'hero-stat-4'].forEach(id => {
                const el = $(id); if (el) el.textContent = '—';
            });
            const sample = $('hero-sample-size');
            if (sample) sample.textContent = 'Awaiting first fills.';
            return;
        }
        // Stat 1: Win rate
        $('hero-stat-1') && ($('hero-stat-1').textContent = fmtPct(s.winRate));
        // Stat 2: Profit factor
        $('hero-stat-2') && ($('hero-stat-2').textContent = fmtPF(s.profitFactor));
        // Stat 3: R-Expectancy
        $('hero-stat-3') && ($('hero-stat-3').textContent = fmtR(s.rExpectancy));
        // Stat 4: EV / trade
        $('hero-stat-4') && ($('hero-stat-4').textContent = fmtEV(s.evPerTrade));

        const sample = $('hero-sample-size');
        if (sample) sample.textContent = `Sample: ${s.n} closed trades.`;
    }

    function renderTrustStrip(state) {
        const trades = state.trades || [];
        const KPIs = root.Ekantik.KPIs;

        const lastFill = KPIs.lastFillTimestamp(trades);
        const lfEl = $('trust-last-fill');
        if (lfEl) lfEl.textContent = lastFill ? KPIs.fmtRelativeTime(lastFill) : '—';

        const adh = KPIs.adherenceSummary(trades);
        const adhEl = $('trust-adherence');
        if (adhEl) adhEl.textContent = adh.display;

        const updEl = $('trust-updated');
        if (updEl) updEl.textContent = state.computedAt ? KPIs.fmtClockTime(state.computedAt) : '—';
    }

    function init() {
        root.Ekantik.Data.onChange(state => {
            renderHero(state);
            renderTrustStrip(state);
        });
        // If state already loaded, render immediately
        const s = root.Ekantik.Data.get();
        if (s.summary) { renderHero(s); renderTrustStrip(s); }
    }

    root.Ekantik = root.Ekantik || {};
    root.Ekantik.Hero = { init, renderHero, renderTrustStrip };
})(typeof window !== 'undefined' ? window : globalThis);
