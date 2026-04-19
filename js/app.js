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

        // Periodic trust-strip time refresh (does NOT refetch data)
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
