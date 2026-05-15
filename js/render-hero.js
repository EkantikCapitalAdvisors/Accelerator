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
        const DISCLOSURE = 'Pre-asymptotic at this sample. Past performance does not indicate future results.';
        if (!s.n) {
            // No data yet — show em-dashes
            ['hero-stat-1', 'hero-stat-2', 'hero-stat-3', 'hero-stat-4'].forEach(id => {
                const el = $(id); if (el) el.textContent = '—';
            });
            const sample = $('hero-sample-size');
            if (sample) sample.textContent = 'Live, from Discord fills · awaiting first fills. ' + DISCLOSURE;
            return;
        }
        // Mirror the Edge section exactly — same 4 cards, same captions.
        $('hero-stat-1') && ($('hero-stat-1').textContent = fmtPct(s.winRate));
        $('hero-stat-1-cap') && ($('hero-stat-1-cap').textContent = `Live · ${s.n} closed trades`);

        $('hero-stat-2') && ($('hero-stat-2').textContent = fmtPF(s.profitFactor));

        $('hero-stat-3') && ($('hero-stat-3').textContent = fmtR(s.rExpectancy));
        if ($('hero-stat-3-cap') && s.evPerTrade != null) {
            $('hero-stat-3-cap').textContent = `$${s.evPerTrade.toFixed(0)} per trade · live realized`;
        }

        $('hero-stat-4') && ($('hero-stat-4').textContent = fmtEV(s.avgRiskDollar));
        if ($('hero-stat-4-cap') && s.avgRiskDollar != null) {
            $('hero-stat-4-cap').textContent = `1R ≈ $${Math.round(s.avgRiskDollar).toLocaleString()} · live realized`;
        }

        const sample = $('hero-sample-size');
        if (sample) sample.textContent = `Live, from Discord fills · ${s.n} closed trades. ` + DISCLOSURE;
    }

    function renderTrustStrip(state) {
        const trades = state.trades || [];
        const KPIs = root.Ekantik.KPIs;

        const lastFill = KPIs.lastFillTimestamp(trades);
        const lfEl = $('trust-last-fill');
        if (lfEl) lfEl.textContent = lastFill ? KPIs.fmtRelativeTime(lastFill) : '—';

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
