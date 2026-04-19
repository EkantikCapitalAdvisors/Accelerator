// =====================================================
// Data loader — single entry point for all render modules
// Spec §11.5
// =====================================================
(function (root) {
    'use strict';

    const TRADES_URL  = 'data/tenx_trades.json';
    const ARCHIVE_URL = 'data/archive/index.json';
    const SESSION_KEY = 'eka-10x-live';

    const state = {
        trades: null,
        battery: null,       // result of Battery.runTests(trades)
        summary: null,       // Battery.summaryStats(trades)
        archiveIndex: null,
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

    function computeFromTrades(trades) {
        state.trades = trades;
        state.battery = root.Ekantik.Battery.runTests(trades);
        state.summary = root.Ekantik.Battery.summaryStats(trades);
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
            const [trades, archiveIndex] = await Promise.all([
                fetchJSON(TRADES_URL, bust),
                fetchJSON(ARCHIVE_URL, bust).catch(() => ({ archives: [] }))
            ]);
            computeFromTrades(trades);
            state.archiveIndex = archiveIndex;
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
