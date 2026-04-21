// =====================================================
// Charts — thin helpers over Chart.js (loaded via CDN in index.html).
// Used for: Section A inline equity curve + monthly bars.
// =====================================================
(function (root) {
    'use strict';

    const instances = {};
    const STARTING_BALANCE = 10000;

    function parseTime(str) {
        const m = (str || '').match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i);
        if (!m) return { h: 0, min: 0, s: 0 };
        let h = parseInt(m[1]);
        const min = parseInt(m[2]);
        const s = m[3] ? parseInt(m[3]) : 0;
        const ampm = (m[4] || '').toUpperCase();
        if (ampm === 'PM' && h < 12) h += 12;
        if (ampm === 'AM' && h === 12) h = 0;
        return { h, min, s };
    }

    function parseTS(raw) {
        if (!raw) return null;
        // ISO date prefix: "2026-02-04 ..." — parse date + time portions separately.
        let m = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](.+))?$/);
        if (m) {
            const yr = parseInt(m[1]), mo = parseInt(m[2]), day = parseInt(m[3]);
            const { h, min, s } = parseTime(m[4]);
            const d = new Date(yr, mo - 1, day, h, min, s);
            return isNaN(d.getTime()) ? null : d;
        }
        // US slash: "2/18/2026 08:39" or "4/13/2026 8:33 AM"
        m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(.+))?$/);
        if (m) {
            const mo = parseInt(m[1]), day = parseInt(m[2]), yr = parseInt(m[3]);
            const { h, min, s } = parseTime(m[4]);
            const d = new Date(yr, mo - 1, day, h, min, s);
            return isNaN(d.getTime()) ? null : d;
        }
        const d = new Date(raw);
        return isNaN(d.getTime()) ? null : d;
    }

    function sortChronological(trades) {
        return [...trades].sort((a, b) => {
            const ta = parseTS(a.entry_time || a.entryTime);
            const tb = parseTS(b.entry_time || b.entryTime);
            if (!ta || !tb) return 0;
            return ta - tb;
        });
    }

    // ── Interpolate SPY close at an arbitrary date ──
    // monthlyData = { prices: [{month: "YYYY-MM", close: N}, ...] }
    function interpolateSpyAt(monthlyData, date) {
        if (!monthlyData || !Array.isArray(monthlyData.prices) || !date) return null;
        const pts = monthlyData.prices
            .map(p => {
                // Treat each entry as mid-month (day 15) for smoother interpolation.
                const [y, m] = p.month.split('-').map(Number);
                return { t: new Date(y, m - 1, 15).getTime(), v: p.close };
            })
            .filter(p => !isNaN(p.t) && typeof p.v === 'number')
            .sort((a, b) => a.t - b.t);
        if (pts.length === 0) return null;
        const ms = date.getTime();
        if (ms <= pts[0].t) return pts[0].v;
        if (ms >= pts[pts.length - 1].t) return pts[pts.length - 1].v;
        for (let i = 0; i < pts.length - 1; i++) {
            if (ms >= pts[i].t && ms <= pts[i + 1].t) {
                const frac = (ms - pts[i].t) / (pts[i + 1].t - pts[i].t);
                return pts[i].v + frac * (pts[i + 1].v - pts[i].v);
            }
        }
        return null;
    }

    // ── Inline equity curve (Section A) — month-labelled x-axis + S&P overlay ──
    function equityCurve(canvas, trades, spyMonthly) {
        if (!canvas || !root.Chart) return;
        const key = canvas.id || 'equity';
        if (instances[key]) instances[key].destroy();

        const sorted = sortChronological(trades);
        const labels = [];
        const fullLabels = [];
        const strategyData = [];
        const dates = [];
        let cum = STARTING_BALANCE;
        let lastMonthLabel = '';
        sorted.forEach((t, i) => {
            const ts = parseTS(t.entry_time || t.entryTime || t.datetime);
            cum += (t.dollar_pl != null ? t.dollar_pl : (t.dollarPL || 0));
            dates.push(ts);
            strategyData.push(cum);
            if (ts) {
                const monthLabel = ts.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
                // Only label the x-axis at month boundaries; leave the rest blank so the chart
                // reads as a timeline rather than a dense text blob.
                labels.push(monthLabel !== lastMonthLabel ? monthLabel : '');
                lastMonthLabel = monthLabel;
                fullLabels.push(ts.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }));
            } else {
                labels.push('');
                fullLabels.push('Trade ' + (i + 1));
            }
        });

        // Build S&P overlay if monthly data is available AND we have at least one real timestamp.
        const firstDate = dates.find(d => d != null);
        let spyData = null;
        if (spyMonthly && firstDate) {
            const baseSpy = interpolateSpyAt(spyMonthly, firstDate);
            if (baseSpy) {
                spyData = dates.map(d => {
                    if (!d) return null;
                    const sp = interpolateSpyAt(spyMonthly, d);
                    return sp ? Math.round(STARTING_BALANCE * (sp / baseSpy)) : null;
                });
            }
        }

        const datasets = [{
            label: 'Strategy',
            data: strategyData,
            borderColor: '#C8A951',
            backgroundColor: 'rgba(200, 169, 81, 0.12)',
            fill: true,
            tension: 0.25,
            pointRadius: 0,
            pointHoverRadius: 4,
            borderWidth: 2
        }];
        if (spyData) {
            datasets.push({
                label: 'S&P 500 (buy-and-hold)',
                data: spyData,
                borderColor: '#1B2A4A',
                backgroundColor: 'rgba(27, 42, 74, 0.04)',
                fill: false,
                tension: 0.2,
                pointRadius: 0,
                pointHoverRadius: 4,
                borderWidth: 2,
                borderDash: [4, 3]
            });
        }

        const allValues = [...strategyData, ...(spyData || []).filter(v => v != null), STARTING_BALANCE];
        const peak = Math.max(...allValues);
        const low  = Math.min(...allValues);

        instances[key] = new root.Chart(canvas, {
            type: 'line',
            data: { labels, datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: {
                        display: true,
                        position: 'bottom',
                        align: 'start',
                        labels: {
                            color: '#1A1A1A',
                            font: { size: 12, family: "'DM Sans', sans-serif" },
                            usePointStyle: true,
                            pointStyle: 'line',
                            boxWidth: 24
                        }
                    },
                    tooltip: {
                        callbacks: {
                            title: items => fullLabels[items[0].dataIndex] || '',
                            label: ctx => `${ctx.dataset.label}: $${Number(ctx.parsed.y).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: {
                            color: '#6B6B6B',
                            font: { size: 11, family: "'DM Sans', sans-serif" },
                            maxRotation: 0,
                            autoSkip: false
                        }
                    },
                    y: {
                        grid: { color: '#E5E0D0' },
                        ticks: {
                            color: '#6B6B6B',
                            font: { size: 11, family: "'JetBrains Mono', monospace" },
                            maxTicksLimit: 5,
                            callback: (v) => '$' + Number(v).toLocaleString()
                        },
                        min: Math.floor(low / 1000) * 1000,
                        max: Math.ceil(peak / 1000) * 1000
                    }
                }
            }
        });
    }

    // ── Monthly P&L bars (Section A, below ladder) ──
    function monthlyBars(canvas, trades) {
        if (!canvas || !root.Chart) return;
        const key = canvas.id || 'monthly';
        if (instances[key]) instances[key].destroy();

        // Group by YYYY-MM
        const buckets = {};
        for (const t of trades) {
            const ts = parseTS(t.entry_time || t.entryTime);
            if (!ts) continue;
            const k = `${ts.getFullYear()}-${String(ts.getMonth() + 1).padStart(2, '0')}`;
            buckets[k] = (buckets[k] || 0) + (t.dollar_pl != null ? t.dollar_pl : (t.dollarPL || 0));
        }
        const keys = Object.keys(buckets).sort();
        const data = keys.map(k => buckets[k]);
        const labels = keys.map(k => {
            const [y, m] = k.split('-');
            return new Date(parseInt(y), parseInt(m) - 1, 1)
                .toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
        });

        instances[key] = new root.Chart(canvas, {
            type: 'bar',
            data: {
                labels,
                datasets: [{
                    label: 'Net P&L',
                    data,
                    backgroundColor: data.map(v => v >= 0 ? '#2E7D32' : '#C62828'),
                    borderWidth: 0,
                    borderRadius: 4,
                    maxBarThickness: 72
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: ctx => {
                                const v = ctx.parsed.y;
                                return `Net: ${v >= 0 ? '+' : '−'}$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: { color: '#6B6B6B', font: { size: 11, family: "'DM Sans', sans-serif" } }
                    },
                    y: {
                        grid: { color: '#E5E0D0' },
                        ticks: {
                            color: '#6B6B6B',
                            font: { size: 11, family: "'JetBrains Mono', monospace" },
                            maxTicksLimit: 5,
                            callback: v => (v >= 0 ? '+' : '−') + '$' + Math.abs(v).toLocaleString()
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
    root.Ekantik.Charts = { equityCurve, monthlyBars, destroyAll };
})(typeof window !== 'undefined' ? window : globalThis);
