// =====================================================
// Operator Falsifiability — live rendering (Phase 1)
//   · Section 05 gates status strip + Stage-1 criteria counters
//   · Stage-2 rolling-100 EV (Expression Gate)
//   · Stand-down state widget (05.1)
// Reads operator-criteria.json + standdown-state.json (initial/empty
// state ships now; Phase 2-3 populate them). Stage-2 EV computed live
// from the trade feed so the Expression Gate is real from day one.
// =====================================================
(function (root) {
    'use strict';
    function $(id) { return document.getElementById(id); }

    const TIER_LABELS = {
        T0: 'T0 — Normal Operations',
        T1: 'T1 — Logged Breach',
        T2: 'T2 — Conditions Reduced',
        T3: 'T3 — Full Cessation'
    };

    function fmtEV(v) {
        if (v == null || !isFinite(v)) return '—';
        return (v >= 0 ? '+$' : '−$') + Math.abs(Math.round(v));
    }

    // Stage-2: rolling-100 EV from the live trade feed.
    function rollingEv(trades) {
        if (!trades || !trades.length) return null;
        const w = trades.length >= 100 ? trades.slice(-100) : trades;
        return w.reduce((a, t) => a + (t.dollar_pl || t.dollarPL || 0), 0) / w.length;
    }

    function renderExpression(state) {
        const ev = rollingEv((state && state.trades) || []);
        const txt = fmtEV(ev);
        ['gate-expression-ev', 'gate-expression-ev-2'].forEach(id => { const e = $(id); if (e) e.textContent = txt; });
        const st = $('gate-expression-state');
        if (st) {
            const fired = ev != null && ev <= 0 && (state.trades || []).length >= 100;
            st.textContent = fired ? 'TRIGGERED' : 'Monitoring';
            st.classList.toggle('gates-status__value--fired', fired);
        }
    }

    async function fetchJSON(url) {
        try { const r = await fetch(url, { cache: 'no-store' }); if (!r.ok) throw 0; return await r.json(); }
        catch (e) { return null; }
    }

    async function renderCriteria() {
        const c = await fetchJSON('data/operator-criteria.json');
        if (!c) return;
        const a = c.criterion_01_attribution || {};
        const m = c.criterion_02_rule_modification || {};
        const r = c.criterion_03_routine_adherence || {};
        $('c01-tags') && ($('c01-tags').textContent = a.tags_filed_rolling_100 ?? '—');
        $('c01-breaches') && ($('c01-breaches').textContent = a.breaches_rolling_30_trades ?? '—');
        $('c02-unauthorized') && ($('c02-unauthorized').textContent = m.unauthorized_modifications ?? '—');
        $('c02-days') && ($('c02-days').textContent = m.days_since_last_modification ?? '—');
        $('c03-adherence') && ($('c03-adherence').textContent = (r.rolling_30_day_pct != null ? r.rolling_30_day_pct.toFixed(1) + '%' : '—'));
        $('c03-streak') && ($('c03-streak').textContent = (r.current_streak_days != null ? r.current_streak_days + ' days' : '—'));
    }

    async function renderStandDown() {
        const s = await fetchJSON('data/standdown-state.json');
        if (!s) return;
        const tier = s.current_tier || 'T0';
        const label = TIER_LABELS[tier] || tier;

        const tierEl = $('sd-tier');
        if (tierEl) {
            tierEl.textContent = label;
            tierEl.className = 'standdown-widget__tier standdown-widget__tier--' + tier.toLowerCase();
        }
        const fidTier = $('gate-fidelity-tier');
        if (fidTier) fidTier.textContent = label;
        const fidState = $('gate-fidelity-state');
        if (fidState) {
            fidState.textContent = tier === 'T0' ? 'Monitoring' : 'Breach active';
            fidState.classList.toggle('gates-status__value--fired', tier !== 'T0');
        }

        const counter = (s.stage1_counter && s.stage1_counter.qualified_trades_in_current_window) || 0;
        $('sd-counter') && ($('sd-counter').textContent = counter + ' qualified trades');
        const active = (s.active_breach_events || []).length;
        $('sd-active-breaches') && ($('sd-active-breaches').textContent = active);
        $('sd-last-event') && ($('sd-last-event').textContent = s.active_since ? ('Active since ' + s.active_since) : 'None on record');

        // Resumption conditions (only when non-T0)
        const wrap = $('sd-resumption');
        const rows = $('sd-resumption-rows');
        if (wrap && rows) {
            if (tier === 'T0') { wrap.classList.add('hide'); rows.innerHTML = ''; }
            else {
                const rc = s.resumption_conditions || {};
                const items = [];
                if (rc.minimum_size_trades_required) items.push(`Minimum-size trades: ${rc.minimum_size_trades_completed || 0} / ${rc.minimum_size_trades_required}`);
                if (rc.calendar_days_required) items.push(`Calendar gap: ${rc.calendar_days_elapsed || 0} / ${rc.calendar_days_required} days`);
                items.push(`Witness countersignature: ${rc.witness_countersignature_received ? 'received ✓' : 'pending'}`);
                rows.innerHTML = items.map(t => `<div class="standdown-widget__row"><span>${t}</span></div>`).join('');
                wrap.classList.remove('hide');
            }
        }

        // Pending witness reviews from breach events
        const be = await fetchJSON('data/breach-events.json');
        if (be && $('sd-pending-reviews')) {
            $('sd-pending-reviews').textContent = be.filter(e => e.witness_review_status === 'pending').length;
        }
    }

    function init() {
        // Stage 2 binds to the live trade feed
        if (root.Ekantik && root.Ekantik.Data) {
            root.Ekantik.Data.onChange(renderExpression);
            const cur = root.Ekantik.Data.get();
            if (cur) renderExpression(cur);
        }
        // Stage 1 + stand-down read their JSON files (static initial state in Phase 1)
        renderCriteria();
        renderStandDown();
    }

    root.Ekantik = root.Ekantik || {};
    root.Ekantik.Operator = { init };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})(typeof window !== 'undefined' ? window : globalThis);
