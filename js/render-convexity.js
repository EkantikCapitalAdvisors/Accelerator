// =====================================================
// Convexity Experiment — renderer (Phase 1 scaffold).
//   · Hero status strip (sample / rolling EV / buffer / gate)
//   · §02 KPI strip (WR / PF / R-exp / avg risk)
//   · §08 Buffer-progress widget, revert event log, public trade log
//   · Reads data/options_trades.json (same dataset as /options.html — the
//     SPX-options track is the convex experiment)
// All panels render baseline / "—" when no trades are present.
// =====================================================
(function (root) {
    'use strict';

    const $ = id => document.getElementById(id);
    const TRADES_URL  = 'data/options_trades.json';
    const ROUTINE_URL = 'data/convexity-routine.json';
    const BUFFER_TRADES = 6;

    function fmtSignedUSD(v) {
        if (v == null || !isFinite(v)) return '—';
        return (v >= 0 ? '+$' : '−$') + Math.abs(Math.round(v)).toLocaleString();
    }
    function fmtR(v) {
        if (v == null || !isFinite(v)) return '—';
        return (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2) + 'R';
    }

    async function fetchJSON(url) {
        try { const r = await fetch(url, { cache: 'no-store' }); if (!r.ok) throw 0; return await r.json(); }
        catch (e) { return null; }
    }

    function computeSummary(trades) {
        if (!trades || !trades.length) return { n: 0 };
        const pls = trades.map(t => t.dollar_pl || 0);
        const wins = pls.filter(v => v > 0), losses = pls.filter(v => v <= 0);
        const gp = wins.reduce((a, v) => a + v, 0);
        const gl = Math.abs(losses.reduce((a, v) => a + v, 0));
        const Rs = trades.map(t => (t.risk_dollars > 0 ? (t.dollar_pl || 0) / t.risk_dollars : null)).filter(x => x != null);
        return {
            n: trades.length,
            wr: trades.length ? wins.length / trades.length : 0,
            pf: gl > 0 ? gp / gl : (gp > 0 ? Infinity : 0),
            rexp: Rs.length ? Rs.reduce((a, v) => a + v, 0) / Rs.length : null,
            evAll: trades.length ? pls.reduce((a, v) => a + v, 0) / trades.length : null,
            avgRisk: trades.length ? trades.reduce((a, t) => a + (t.risk_dollars || 0), 0) / trades.length : null,
            cum: pls.reduce((a, v) => a + v, 0)
        };
    }

    function rollingEv(trades, w) {
        if (!trades || !trades.length) return null;
        const sample = trades.length >= w ? trades.slice(-w) : trades;
        return sample.reduce((a, t) => a + (t.dollar_pl || 0), 0) / sample.length;
    }
    function rollingR(trades, w) {
        if (!trades || !trades.length) return null;
        const sample = trades.length >= w ? trades.slice(-w) : trades;
        const rs = sample.map(t => (t.risk_dollars > 0 ? (t.dollar_pl || 0) / t.risk_dollars : null)).filter(x => x != null);
        return rs.length ? rs.reduce((a, v) => a + v, 0) / rs.length : null;
    }

    // Uncorrelated count (per §01.2.1) toward the next double, computed from the
    // most recent contiguous run since the last revert/double event. Phase 1
    // simplification: counts trades since last "double" or "revert" event in the
    // event log (not yet populated), defaulting to last N trades. Refines later.
    function bufferProgress(trades) {
        if (!trades || !trades.length) return { count: 0, size: '1× (base)', event: 'Building…' };
        // Phase-1 stub: just count the last <=6 closed wins as a coarse buffer signal.
        const recent = trades.slice(-BUFFER_TRADES);
        const wins = recent.filter(t => (t.dollar_pl || 0) > 0).length;
        return { count: wins, size: '1× (base)', event: 'Building…' };
    }

    function escapeHtml(s) {
        return String(s || '').replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
    }

    function renderHero(s) {
        if ($('cx-sample')) $('cx-sample').textContent = s.n ? String(s.n) : '—';
        if ($('cx-ev'))     $('cx-ev').textContent     = s.evAll != null ? fmtSignedUSD(s.evAll) : '—';
        if ($('cx-buffer')) $('cx-buffer').textContent = `${s._buf.count} / ${BUFFER_TRADES}`;
        const ev100 = rollingEv(s._trades, 100);
        const active = s.n >= 80;
        const provisional = s.n < 100 && active;
        const fired = ev100 != null && ev100 < 0 && active;
        let label = !active ? 'Armed' : (fired ? 'TRIGGERED' : 'Armed');
        if (provisional) label += ' · provisional';
        if ($('cx-gate')) $('cx-gate').textContent = label;
    }

    function renderKpis(s) {
        if ($('cx-wr'))      $('cx-wr').textContent      = s.n ? (s.wr * 100).toFixed(1) + '%' : '—';
        if ($('cx-pf'))      $('cx-pf').textContent      = s.n ? (isFinite(s.pf) ? s.pf.toFixed(2) : '∞') : '—';
        if ($('cx-rexp'))    $('cx-rexp').textContent    = s.rexp != null ? fmtR(s.rexp) : '—';
        if ($('cx-avgrisk')) $('cx-avgrisk').textContent = s.avgRisk != null ? '$' + Math.round(s.avgRisk).toLocaleString() : '—';
    }

    function renderGate(s) {
        const ev = rollingEv(s._trades, 100);
        const r  = rollingR(s._trades, 100);
        if ($('cx-gate-expression-ev')) $('cx-gate-expression-ev').textContent = ev != null ? fmtSignedUSD(ev) : '—';
        if ($('cx-gate-expression-r'))  $('cx-gate-expression-r').textContent  = r  != null ? fmtR(r) : '—';
        const st = $('cx-gate-expression-state');
        if (st) {
            const active = s.n >= 80;
            const fired = ev != null && ev <= 0 && active;
            const provisional = s.n < 100 && active;
            let label = !active ? 'Arming' : (fired ? 'TRIGGERED' : 'Monitoring');
            if (active && provisional) label += ' · provisional';
            st.textContent = label;
            st.classList.toggle('gates-status__value--fired', fired);
        }
    }

    function renderBuffer(buf) {
        if ($('cx-buf-size'))  $('cx-buf-size').textContent  = buf.size;
        if ($('cx-buf-count')) $('cx-buf-count').textContent = `${buf.count} / ${BUFFER_TRADES}`;
        if ($('cx-buf-fill'))  $('cx-buf-fill').style.width  = (Math.min(buf.count, BUFFER_TRADES) / BUFFER_TRADES * 100) + '%';
        if ($('cx-buf-next'))  $('cx-buf-next').textContent  = 'Six uncorrelated qualified trades earn the next double';
        if ($('cx-buf-event')) $('cx-buf-event').textContent = buf.event;
    }

    function renderTradeLog(trades) {
        const tbody = $('cx-trade-body'); if (!tbody) return;
        if (!trades || !trades.length) {
            tbody.innerHTML = '<tr><td colspan="12" class="muted italic">Pre-launch. Live fills begin 6/30/2026.</td></tr>';
            return;
        }
        tbody.innerHTML = trades.slice().reverse().map(t => {
            const pl = t.dollar_pl || 0;
            const r = t.risk_dollars > 0 ? pl / t.risk_dollars : null;
            const tag = t.attribution
                ? `<span class="trade-tag${t.attribution_breach ? ' trade-tag--breach' : ''}">${escapeHtml(t.attribution)}</span> `
                : '';
            const note = (tag + (t.comment ? escapeHtml(t.comment) : '')).trim();
            return `<tr>
                <td class="mono">${escapeHtml(t.trade_num || '—')}</td>
                <td class="mono" style="font-size:11px">${escapeHtml(t.entry_time || t.trade_date || '—')}</td>
                <td>${escapeHtml(t.ticker || '—')}</td>
                <td class="num mono">${escapeHtml(t.strike || '—')}</td>
                <td>${escapeHtml(t.expiry || '—')}</td>
                <td>${escapeHtml(t.option_type || t.direction || '—')}</td>
                <td class="num mono">${t.entry_price != null ? '$' + t.entry_price : '—'}</td>
                <td class="num mono">${t.exit_price != null ? '$' + t.exit_price : '—'}</td>
                <td class="num mono" style="color:${pl >= 0 ? '#2D5016' : '#DC2626'}">${(pl >= 0 ? '+$' : '−$') + Math.abs(pl)}</td>
                <td>${pl > 0 ? 'Win' : 'Loss'}</td>
                <td class="num mono">${r != null ? fmtR(r) : '—'}</td>
                <td class="trade-note">${note || '—'}</td>
            </tr>`;
        }).join('');
    }

    function renderExtraStats(s, trades) {
        if ($('cx-net')) {
            $('cx-net').textContent = s.n ? fmtSignedUSD(s.cum) : '—';
            $('cx-net').style.color = s.cum >= 0 ? '#C8A951' : '#DC2626';
        }
        if ($('cx-count')) $('cx-count').textContent = s.n ? String(s.n) : '—';
        if ($('cx-wl') && s.n) {
            const w = trades.filter(t => (t.dollar_pl || 0) > 0).length;
            $('cx-wl').textContent = `${w} W / ${s.n - w} L`;
        }
        if (s.n) {
            const best = trades.reduce((a, t) => (t.dollar_pl || 0) > (a.dollar_pl || 0) ? t : a);
            const worst = trades.reduce((a, t) => (t.dollar_pl || 0) < (a.dollar_pl || 0) ? t : a);
            if ($('cx-best'))    { $('cx-best').textContent = fmtSignedUSD(best.dollar_pl); $('cx-best').style.color = '#C8A951'; }
            if ($('cx-best-id')) $('cx-best-id').textContent = `${best.trade_num} · ${best.ticker}`;
            if ($('cx-worst'))    { $('cx-worst').textContent = fmtSignedUSD(worst.dollar_pl); $('cx-worst').style.color = '#DC2626'; }
            if ($('cx-worst-id')) $('cx-worst-id').textContent = `${worst.trade_num} · ${worst.ticker}`;
        }
    }

    let equityChart = null;
    function renderEquity(trades) {
        const cv = $('cx-equity');
        if (!cv || !root.Chart || !trades || !trades.length) return;
        let cum = 0;
        const labels = [], data = [];
        trades.forEach(t => { cum += (t.dollar_pl || 0); labels.push(t.trade_num); data.push(Math.round(cum)); });
        if (equityChart) equityChart.destroy();
        equityChart = new root.Chart(cv, {
            type: 'line',
            data: { labels, datasets: [{
                label: 'Cumulative $', data,
                borderColor: '#C8A951', backgroundColor: 'rgba(200,169,81,0.12)',
                borderWidth: 2.5, fill: true, tension: 0.15,
                pointRadius: 3, pointHoverRadius: 5,
                pointBackgroundColor: data.map(v => v >= 0 ? '#C8A951' : '#DC2626'),
                pointBorderColor: '#1B2A4A'
            }] },
            options: {
                responsive: true, maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { display: false },
                    tooltip: { callbacks: { label: c => 'Running total: ' + (c.parsed.y >= 0 ? '+$' : '−$') + Math.abs(c.parsed.y).toLocaleString() } }
                },
                scales: {
                    x: { ticks: { font: { family: 'JetBrains Mono', size: 10 }, color: '#94A3B8' }, grid: { color: 'rgba(255,255,255,0.06)' } },
                    y: { ticks: { callback: v => '$' + v.toLocaleString(), font: { family: 'JetBrains Mono', size: 10 }, color: '#94A3B8' }, grid: { color: 'rgba(255,255,255,0.06)' } }
                }
            }
        });
    }

    async function init() {
        const trades = (await fetchJSON(TRADES_URL) || []).filter(t => t.outcome !== 'Open');  // open positions excluded until closed
        const s = computeSummary(trades);
        s._trades = trades;
        s._buf = bufferProgress(trades);
        renderHero(s);
        renderKpis(s);
        renderExtraStats(s, trades);
        renderGate(s);
        renderBuffer(s._buf);
        renderEquity(trades);
        renderTradeLog(trades);

        // Reach-out form wiring (mirror the experiment page).
        const form = document.getElementById('reach-form');
        if (form && !form._wired) {
            form._wired = true;
            const submit = $('reach-submit'), errorEl = $('reach-error'), thanks = $('reach-thanks');
            const name = $('reach-name'), email = $('reach-email'), msg = $('reach-msg');
            const validate = () => {
                const ok = name.value.trim() && /.+@.+\..+/.test(email.value) && msg.value.trim().length >= 5;
                submit.disabled = !ok;
            };
            [name, email, msg].forEach(el => el && el.addEventListener('input', validate));
            form.addEventListener('submit', async e => {
                e.preventDefault();
                if (submit.disabled) return;
                try {
                    const res = await fetch(form.action, { method: 'POST', body: new FormData(form), headers: { Accept: 'application/json' } });
                    if (!res.ok) throw new Error('send failed');
                    thanks.classList.remove('hide'); form.querySelectorAll('input,textarea,button').forEach(el => el.disabled = true);
                } catch (e) {
                    errorEl.textContent = 'Could not send. Please retry shortly.';
                    errorEl.classList.remove('hide');
                }
            });
        }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})(typeof window !== 'undefined' ? window : globalThis);
