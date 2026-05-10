// =====================================================
// KPIs — minimal adapter for the trust-strip line
// Full R1–R4 engine stays in js/parser.js (consumed by /methodology and /admin).
// This module exposes just the summary needed for the public trust strip.
// =====================================================
(function (root) {
    'use strict';

    // Converts snake_case records → camelCase shape that computeSetupQuality expects.
    function toCamel(t) {
        return {
            tradeNum:    t.trade_num || t.tradeNum || '',
            datetime:    t.entry_time || t.datetime || '',
            entryTime:   t.entry_time || t.entryTime || '',
            exitTime:    t.exit_time  || t.exitTime  || '',
            direction:   t.direction,
            entryPrice:  t.entry_price  || t.entryPrice  || 0,
            exitPrice:   t.exit_price   || t.exitPrice   || 0,
            stopPrice:   t.stop_price   || t.stopPrice   || 0,
            contracts:   t.contracts    || 1,
            pointsPL:    t.points_pl    || t.pointsPL    || 0,
            dollarPL:    t.dollar_pl    != null ? t.dollar_pl    : (t.dollarPL    || 0),
            riskPoints:  t.risk_points  || t.riskPoints  || 0,
            riskDollars: t.risk_dollars || t.riskDollars || 0,
            isWin:       t.is_win != null ? t.is_win : !!t.isWin,
            date:        t.trade_date || t.date || '',
            product:     t.product  || 'ES',
            ppt:         t.ppt      || 50
        };
    }

    function adherenceSummary(rawTrades) {
        if (!Array.isArray(rawTrades) || rawTrades.length === 0) {
            return { pct: null, valid: 0, total: 0, display: '—' };
        }
        if (typeof root.computeSetupQuality !== 'function') {
            // parser.js not loaded — fail gracefully
            return { pct: null, valid: 0, total: 0, display: '—' };
        }

        const trades = rawTrades.map(toCamel);
        const result = root.computeSetupQuality(trades);
        if (!result || result.setupQualityPct == null) {
            return { pct: null, valid: 0, total: 0, display: 'Tracking' };
        }
        return {
            pct: result.setupQualityPct,
            valid: result.validCount,
            total: result.totalCount,
            display: `${Math.round(result.setupQualityPct)}%`
        };
    }

    function lastFillTimestamp(rawTrades) {
        if (!Array.isArray(rawTrades) || rawTrades.length === 0) return null;
        let maxMs = 0;
        for (const t of rawTrades) {
            const raw = t.exit_time || t.entry_time || t.exitTime || t.entryTime || '';
            if (!raw) continue;
            const d = new Date(raw.replace(' ', 'T'));
            const ms = d.getTime();
            if (!isNaN(ms) && ms > maxMs) maxMs = ms;
        }
        return maxMs === 0 ? null : new Date(maxMs);
    }

    function fmtRelativeTime(date) {
        if (!date) return '—';
        const now = Date.now();
        const diffS = Math.floor((now - date.getTime()) / 1000);
        if (diffS < 60)       return `${diffS}s ago`;
        if (diffS < 3600)     return `${Math.floor(diffS / 60)}m ago`;
        if (diffS < 86400)    return `${Math.floor(diffS / 3600)}h ago`;
        if (diffS < 86400 * 7) return `${Math.floor(diffS / 86400)}d ago`;
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }

    function fmtClockTime(date) {
        return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    }

    // ─── Live monthly rate (geometric mean from Discord-published trades) ───
    // Single source of truth consumed by Section A (Doubling Ladder, retired) and
    // by Modules A and B on the Cashflow page. Returns { ok, rate, annualized, n,
    // provisional, reason? }. `rate` is monthly. Sample-size policy: ≥3 trades to
    // compute, <25 = provisional.
    const LIVE_MIN_SAMPLE = 3;
    const LIVE_PROVISIONAL_CUTOFF = 25;

    function _parseTime(str) {
        const m = (str || '').match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i);
        if (!m) return { h: 0, min: 0, s: 0 };
        let h = parseInt(m[1]); const min = parseInt(m[2]); const s = m[3] ? parseInt(m[3]) : 0;
        const ap = (m[4] || '').toUpperCase();
        if (ap === 'PM' && h < 12) h += 12;
        if (ap === 'AM' && h === 12) h = 0;
        return { h, min, s };
    }
    function _parseTS(raw) {
        if (!raw) return null;
        let m = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](.+))?$/);
        if (m) {
            const yr = +m[1], mo = +m[2], day = +m[3];
            const { h, min, s } = _parseTime(m[4]);
            const d = new Date(yr, mo - 1, day, h, min, s);
            return isNaN(d.getTime()) ? null : d;
        }
        m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(.+))?$/);
        if (m) {
            const mo = +m[1], day = +m[2], yr = +m[3];
            const { h, min, s } = _parseTime(m[4]);
            const d = new Date(yr, mo - 1, day, h, min, s);
            return isNaN(d.getTime()) ? null : d;
        }
        const d = new Date(raw);
        return isNaN(d.getTime()) ? null : d;
    }

    function liveMonthlyRate(rawTrades) {
        const n = Array.isArray(rawTrades) ? rawTrades.length : 0;
        if (n < LIVE_MIN_SAMPLE) return { ok: false, n, reason: `Need ${LIVE_MIN_SAMPLE} trades (have ${n}).` };
        const withTS = rawTrades
            .map(t => ({ t, ts: _parseTS(t.entry_time || t.entryTime) }))
            .filter(x => x.ts != null);
        if (withTS.length < LIVE_MIN_SAMPLE) return { ok: false, n, reason: `Need ${LIVE_MIN_SAMPLE} dated trades (have ${withTS.length}).` };
        withTS.sort((a, b) => a.ts - b.ts);

        const cumPL = rawTrades.reduce((s, t) => s + (t.dollar_pl || t.dollarPL || 0), 0);
        const start = 10000;
        const ret = cumPL / start;
        const first = withTS[0].ts;
        const lastRow = withTS[withTS.length - 1].t;
        const last = _parseTS(lastRow.exit_time || lastRow.entry_time || lastRow.entryTime) || withTS[withTS.length - 1].ts;
        if (!first || !last || last <= first) return { ok: false, n, reason: 'Not enough calendar time.' };
        const monthsElapsed = (last - first) / (1000 * 60 * 60 * 24 * 30.4375);
        if (monthsElapsed < 0.1 || ret <= -1) return { ok: false, n, reason: 'Not enough calendar time.' };
        const rate = ret <= 0
            ? -(Math.pow(1 - Math.abs(ret), 1 / monthsElapsed) - 1)
            : Math.pow(1 + ret, 1 / monthsElapsed) - 1;
        const annualized = Math.pow(1 + rate, 12) - 1;
        return {
            ok: true,
            rate,
            annualized,
            n,
            monthsElapsed,
            provisional: n < LIVE_PROVISIONAL_CUTOFF
        };
    }

    root.Ekantik = root.Ekantik || {};
    root.Ekantik.KPIs = {
        adherenceSummary,
        lastFillTimestamp,
        fmtRelativeTime,
        fmtClockTime,
        liveMonthlyRate
    };
})(typeof window !== 'undefined' ? window : globalThis);
