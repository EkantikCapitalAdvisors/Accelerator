// =====================================================
// Data loader — single entry point for all render modules
// Spec §11.5
// =====================================================
(function (root) {
    'use strict';

    // Allow the host page to override the data source (e.g., options.html sets
    // window.EKANTIK_CONFIG = { dataSource: 'data/options_trades.json', ... })
    const CONFIG = root.EKANTIK_CONFIG || {};
    const TRADES_URL   = CONFIG.dataSource || 'data/tenx_trades.json';
    const ARCHIVE_URL  = CONFIG.archiveIndex || 'data/archive/index.json';
    const SPY_URL      = CONFIG.spyData || 'data/spy_monthly.json';
    const CAPACITY_URL = CONFIG.capacityData || 'data/capacity.json';
    const SESSION_KEY  = CONFIG.sessionKey || 'eka-accelerator-live';

    const state = {
        trades: null,
        battery: null,       // result of Battery.runTests(trades)
        summary: null,       // Battery.summaryStats(trades)
        archiveIndex: null,
        spyMonthly: null,    // { prices: [{month, close}, ...] }
        capacity: null,      // { founding_tier_size, founding_tier_indicated, indication_count, last_updated }
        computedAt: null,
        source: null         // 'default' | 'user-upload'
    };
    const listeners = [];

    function notify() { for (const fn of listeners) { try { fn(state); } catch (e) { console.error(e); } } }

    async function fetchJSON(url, bust) {
        const q = bust ? (url.includes('?') ? '&' : '?') + 't=' + Date.now() : '';
        const res = await fetch(url + q, { cache: bust ? 'no-store' : 'default' });
        if (!res.ok) throw new Error(`Fetch ${url}: HTTP ${res.status}`);
        return res.json();
    }

    // The Discord auto-importer emits one record per message, so a single
    // trade can land as multiple rows sharing a trade_num (an entry/stop-
    // adjust phantom plus the real P&L record). Collapse to one row per
    // trade_num: prefer the record whose exit_time is empty — that's the
    // authoritative P&L-bearing record the importer writes; the phantom
    // carries a populated exit_time. Singles pass through untouched.
    function dedupeTrades(trades) {
        if (!Array.isArray(trades)) return [];
        const groups = new Map();
        for (const t of trades) {
            const key = t.trade_num || (`${t.entry_time || ''}|${t.dollar_pl || 0}`);
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(t);
        }
        const out = [];
        for (const recs of groups.values()) {
            if (recs.length === 1) { out.push(recs[0]); continue; }
            const authoritative = recs.find(r => !(r.exit_time || r.exitTime)) || recs[recs.length - 1];
            out.push(authoritative);
        }
        return out;
    }

    function computeFromTrades(trades) {
        const clean = dedupeTrades(trades);
        state.trades = clean;
        state.battery = root.Ekantik.Battery.runTests(clean);
        state.summary = root.Ekantik.Battery.summaryStats(clean);
        state.computedAt = new Date();
    }

    async function load(options) {
        options = options || {};
        const bust = !!options.bust;

        // Warm cache from sessionStorage for instant re-render on back-nav
        if (!bust && !state.trades) {
            try {
                const cached = sessionStorage.getItem(SESSION_KEY);
                if (cached) {
                    const obj = JSON.parse(cached);
                    if (obj && Array.isArray(obj.trades)) {
                        computeFromTrades(obj.trades);
                        state.source = 'default';
                        notify();
                    }
                }
            } catch (e) { /* ignore */ }
        }

        // Always fetch fresh trades in the background (or on explicit bust)
        try {
            const [trades, archiveIndex, spyMonthly, capacity] = await Promise.all([
                fetchJSON(TRADES_URL, bust),
                fetchJSON(ARCHIVE_URL, bust).catch(() => ({ archives: [] })),
                fetchJSON(SPY_URL, bust).catch(() => null),
                fetchJSON(CAPACITY_URL, bust).catch(() => null)
            ]);
            computeFromTrades(trades);
            state.archiveIndex = archiveIndex;
            state.spyMonthly = spyMonthly;
            state.capacity = capacity;
            state.source = 'default';
            try { sessionStorage.setItem(SESSION_KEY, JSON.stringify({ trades })); } catch (e) { /* quota */ }
            notify();
        } catch (err) {
            console.error('[Data] load failed:', err);
            if (!state.trades) {
                state.trades = [];
                state.battery = root.Ekantik.Battery.runTests([]);
                state.summary = root.Ekantik.Battery.summaryStats([]);
                state.archiveIndex = { archives: [] };
                state.capacity = null;
                state.source = 'default';
                notify();
            }
        }
        return state;
    }

    // For Section B: run battery on user-uploaded data without replacing default state
    function setUserData(userTrades) {
        const battery = root.Ekantik.Battery.runTests(userTrades);
        const summary = root.Ekantik.Battery.summaryStats(userTrades);
        state.trades = userTrades;
        state.battery = battery;
        state.summary = summary;
        state.source = 'user-upload';
        state.computedAt = new Date();
        notify();
    }

    function onChange(fn) { listeners.push(fn); }
    function get() { return state; }

    root.Ekantik = root.Ekantik || {};
    root.Ekantik.Data = { load, get, onChange, setUserData };
})(typeof window !== 'undefined' ? window : globalThis);
