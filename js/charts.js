// =====================================================
// Charts — thin helpers for the equity curve modal.
// Uses Chart.js (loaded via CDN in index.html).
// =====================================================
(function (root) {
    'use strict';

    const instances = {};

    function equityCurve(canvas, trades) {
        if (!canvas || !root.Chart) return;
        if (instances.equity) instances.equity.destroy();

        const sorted = [...trades].sort((a, b) => {
            const ta = (a.exit_time || a.entry_time || '').replace(' ', 'T');
            const tb = (b.exit_time || b.entry_time || '').replace(' ', 'T');
            return new Date(ta) - new Date(tb);
        });

        const labels = [];
        const data = [];
        let cum = 10000;
        sorted.forEach((t, i) => {
            cum += (t.dollar_pl || 0);
            labels.push('T' + (i + 1));
            data.push(cum);
        });

        instances.equity = new root.Chart(canvas, {
            type: 'line',
            data: {
                labels,
                datasets: [{
                    label: 'Account balance',
                    data,
                    borderColor: '#C8A951',
                    backgroundColor: 'rgba(200, 169, 81, 0.12)',
                    fill: true,
                    tension: 0.2,
                    pointRadius: 0,
                    borderWidth: 2
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => `Balance: $${ctx.parsed.y.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                        }
                    }
                },
                scales: {
                    x: { grid: { display: false }, ticks: { color: '#6B6B6B', maxTicksLimit: 8 } },
                    y: {
                        grid: { color: '#E5E0D0' },
                        ticks: {
                            color: '#6B6B6B',
                            callback: (v) => '$' + Number(v).toLocaleString()
                        }
                    }
                }
            }
        });
    }

    function destroyAll() {
        Object.keys(instances).forEach(k => { try { instances[k].destroy(); } catch (e) {} });
    }

    root.Ekantik = root.Ekantik || {};
    root.Ekantik.Charts = { equityCurve, destroyAll };
})(typeof window !== 'undefined' ? window : globalThis);
