// =====================================================
// Ekantik 10x — app init. Glues modules together.
// =====================================================
(function (root) {
    'use strict';

    function init() {
        if (!root.Ekantik || !root.Ekantik.Battery || !root.Ekantik.Data) {
            console.error('[app] Ekantik globals missing — script load order wrong.');
            return;
        }

        // Mobile nav toggle
        const toggle = document.getElementById('nav-toggle');
        const links = document.getElementById('nav-links');
        if (toggle && links) {
            toggle.addEventListener('click', () => links.classList.toggle('nav__links--open'));
        }

        // Wire section modules
        if (root.Ekantik.Hero)     root.Ekantik.Hero.init();
        if (root.Ekantik.SectionA) root.Ekantik.SectionA.init();
        if (root.Ekantik.SectionB) root.Ekantik.SectionB.init();
        if (root.Ekantik.SectionC) root.Ekantik.SectionC.init();

        // Kick off first load
        root.Ekantik.Data.load();

        // ── Live polling — re-fetch the trade journal on an interval so the whole
        // page updates dynamically without a reload. Every panel (EV formula, hero
        // stats, trigger ladder, phase chip, breach panel, equity arc) subscribes to
        // Data.onChange, so one refresh re-renders them all. load() always busts the
        // trades fetch but leaves the slow-changing files cached, so it's cheap.
        // Paused while the tab is hidden; refreshes immediately on re-focus.
        const POLL_MS = 60000;
        let polling = false;
        async function refresh() {
            if (polling || document.visibilityState === 'hidden') return;
            polling = true;
            try { await root.Ekantik.Data.load(); }
            catch (e) { /* transient network error — the next tick retries */ }
            finally { polling = false; }
        }
        setInterval(refresh, POLL_MS);
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') refresh();
        });

        // Periodic trust-strip time refresh (updates the "Xm ago" between fetches)
        setInterval(() => {
            const state = root.Ekantik.Data.get();
            if (state && state.trades && root.Ekantik.Hero) {
                root.Ekantik.Hero.renderTrustStrip(state);
            }
        }, 60000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})(typeof window !== 'undefined' ? window : globalThis);
