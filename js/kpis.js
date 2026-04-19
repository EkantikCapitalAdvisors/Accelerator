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

    root.Ekantik = root.Ekantik || {};
    root.Ekantik.KPIs = { adherenceSummary, lastFillTimestamp, fmtRelativeTime, fmtClockTime };
})(typeof window !== 'undefined' ? window : globalThis);
