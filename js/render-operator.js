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

    // Size-neutral companion: rolling-100 R-expectancy (profit per $1 risked).
    // Both win and risk scale with position size, so this reads the edge cleanly
    // through buffer scaling — it does not move when 1 ES becomes 2/3/4 ES.
    function rollingR(trades) {
        if (!trades || !trades.length) return null;
        const w = trades.length >= 100 ? trades.slice(-100) : trades;
        const rs = w.map(t => {
            const pl = t.dollar_pl || t.dollarPL || 0;
            const rd = t.risk_dollars || t.riskDollars || 0;
            return rd > 0 ? pl / rd : null;
        }).filter(v => v != null);
        if (!rs.length) return null;
        return rs.reduce((a, v) => a + v, 0) / rs.length;
    }

    function fmtR(v) {
        if (v == null || !isFinite(v)) return '—';
        return (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2) + 'R';
    }

    // Gate activation: it can fire from GATE_ACTIVE_MIN (SE only ~12% wider than
    // at 100), and is labelled "provisional" until it reaches the locked-protocol
    // binding sample of GATE_BINDING_MIN.
    const GATE_ACTIVE_MIN = 80;
    const GATE_BINDING_MIN = 100;

    function renderExpression(state) {
        const trades = (state && state.trades) || [];
        const n = trades.length;
        const ev = rollingEv(trades);
        const txt = fmtEV(ev);
        ['gate-expression-ev', 'gate-expression-ev-2'].forEach(id => { const e = $(id); if (e) e.textContent = txt; });
        const rTxt = fmtR(rollingR(trades));
        ['gate-expression-r', 'gate-expression-r-2'].forEach(id => { const e = $(id); if (e) e.textContent = rTxt; });
        const st = $('gate-expression-state');
        if (st) {
            const active = n >= GATE_ACTIVE_MIN;
            const fired = ev != null && ev <= 0 && active;
            const provisional = n < GATE_BINDING_MIN;
            let label = !active ? 'Arming' : (fired ? 'TRIGGERED' : 'Monitoring');
            if (active && provisional) label += ' · provisional';
            st.textContent = label;
            st.classList.toggle('gates-status__value--fired', fired);
        }
    }

    async function fetchJSON(url) {
        try { const r = await fetch(url, { cache: 'no-store' }); if (!r.ok) throw 0; return await r.json(); }
        catch (e) { return null; }
    }

    // Criterion 01 goes live once a launch date is set; until then the static
    // baseline (clean) shows, because the legacy trades predate per-trade tagging.
    let attributionActiveSince = null;

    function tagOf(t) { return (t.attribution || '').toUpperCase(); }
    function inAttributionScope(t, since) {
        const raw = t.exit_time || t.exitTime || t.entry_time || t.entryTime;
        if (!raw) return false;
        const d = new Date(raw);
        return !isNaN(d.getTime()) && d >= since;
    }

    // H2/H3 are operator attributions; H1 (or a hand-typed H1 flagged at parse
    // time) is never valid per-trade — it is the Expression Gate's verdict.
    function recomputeCriterion01() {
        if (!attributionActiveSince) return;          // not yet active → keep baseline
        const since = new Date(attributionActiveSince);
        if (isNaN(since.getTime())) return;
        const st = (root.Ekantik && root.Ekantik.Data) ? root.Ekantik.Data.get() : null;
        const trades = (st && st.trades) || [];
        const scope = trades.filter(t => inAttributionScope(t, since));
        const last100 = scope.slice(-100);
        const last30  = scope.slice(-30);
        const valid   = t => tagOf(t) === 'H2' || tagOf(t) === 'H3';
        const isH1    = t => tagOf(t) === 'H1' || t.attribution_breach === true;
        const missing = t => !t.attribution;
        const tagsFiled  = last100.filter(valid).length;
        const breaches30 = last30.filter(t => missing(t) || isH1(t)).length;
        $('c01-tags') && ($('c01-tags').textContent = String(tagsFiled));
        $('c01-breaches') && ($('c01-breaches').textContent = String(breaches30));
    }

    // Criterion 03 — daily routine adherence, computed from data/daily-routine.json
    // over a rolling 30-trading-day (weekday) window once routine_active_since is set.
    let routineActiveSince = null;
    async function recomputeCriterion03() {
        if (!routineActiveSince) return;                       // not yet active → keep baseline
        const since = new Date(routineActiveSince);
        if (isNaN(since.getTime())) return;
        const routine = await fetchJSON('data/daily-routine.json');
        if (!routine || !routine.length) return;
        const scope = routine.filter(x => { const d = new Date(x.date); return !isNaN(d.getTime()) && d >= since; });
        if (!scope.length) return;
        const byDate = {}; scope.forEach(x => { byDate[x.date] = x; });
        // Rolling 30 weekdays ending at the latest logged date (holidays count as misses).
        const dates = scope.map(x => x.date).sort();
        const cur = new Date(dates[dates.length - 1] + 'T00:00:00Z');
        const wk = [];
        while (wk.length < 30) {
            const dow = cur.getUTCDay();
            if (dow !== 0 && dow !== 6) wk.push(cur.toISOString().slice(0, 10));
            cur.setUTCDate(cur.getUTCDate() - 1);
        }
        const complete = wk.filter(d => byDate[d] && byDate[d].complete).length;
        const pct = (complete / wk.length) * 100;
        const sorted = scope.slice().sort((a, b) => (a.date < b.date ? 1 : -1));
        let streak = 0; for (const r of sorted) { if (r.complete) streak++; else break; }
        $('c03-adherence') && ($('c03-adherence').textContent = pct.toFixed(1) + '%');
        $('c03-streak') && ($('c03-streak').textContent = streak + ' days');
    }

    async function renderCriteria() {
        const c = await fetchJSON('data/operator-criteria.json');
        if (!c) return;
        const a = c.criterion_01_attribution || {};
        const m = c.criterion_02_rule_modification || {};
        const r = c.criterion_03_routine_adherence || {};
        attributionActiveSince = a.attribution_active_since || null;
        routineActiveSince = r.routine_active_since || null;
        $('c01-tags') && ($('c01-tags').textContent = a.tags_filed_rolling_100 ?? '—');
        $('c01-breaches') && ($('c01-breaches').textContent = a.breaches_rolling_30_trades ?? '—');
        $('c02-unauthorized') && ($('c02-unauthorized').textContent = m.unauthorized_modifications ?? '—');
        $('c02-days') && ($('c02-days').textContent = m.days_since_last_modification ?? '—');
        $('c03-adherence') && ($('c03-adherence').textContent = (r.rolling_30_day_pct != null ? r.rolling_30_day_pct.toFixed(1) + '%' : '—'));
        $('c03-streak') && ($('c03-streak').textContent = (r.current_streak_days != null ? r.current_streak_days + ' days' : '—'));
        recomputeCriterion01();   // overrides c01 from the live feed once active
        recomputeCriterion03();   // overrides c03 from daily-routine.json once active
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
        // Stage 2 + live Criterion 01 bind to the live trade feed
        if (root.Ekantik && root.Ekantik.Data) {
            root.Ekantik.Data.onChange(renderExpression);
            root.Ekantik.Data.onChange(recomputeCriterion01);
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
