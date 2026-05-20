// =====================================================
// Public Experiment Dashboard (DASH-EXP-V1, public variant)
// Drives experiment.html — trigger ladder, next-trigger forecast,
// cumulative trajectory (+ trigger markers, gate line, floor case),
// monthly breakdown, contract-count history, and the full trade table.
// Reads the same data/tenx_trades.json the accelerator page uses.
// No auth. No separate feed.
// =====================================================
(function (root) {
    'use strict';

    function $(id) { return document.getElementById(id); }

    const BUFFERS = [
        { id: 'B1', threshold: 5000,  contractsAfter: 2 },
        { id: 'B2', threshold: 10000, contractsAfter: 3 },
        { id: 'B3', threshold: 15000, contractsAfter: 4 },
        { id: 'B4', threshold: 20000, contractsAfter: 4 },
    ];
    const NAVY = '#1B2A4A', GOLD = '#C8A951', SLATE = '#64748B', POS = '#2D5016', NEG = '#DC2626';
    const charts = {};

    // ─── helpers ───
    function fmtUSD(v) { return (v == null || !isFinite(v)) ? '$—' : (v < 0 ? '−$' : '$') + Math.abs(Math.round(v)).toLocaleString(); }
    function fmtSigned(v) { return (v == null || !isFinite(v)) ? '—' : (v >= 0 ? '+$' : '−$') + Math.abs(Math.round(v)).toLocaleString(); }
    function fmtR(v) { return (v == null || !isFinite(v)) ? '—' : (v >= 0 ? '+' : '') + v.toFixed(2) + 'R'; }

    function parseTS(raw) {
        if (!raw) return null;
        let m = String(raw).match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?/i);
        if (m) { let h=+(m[4]||0); const ap=(m[7]||'').toUpperCase(); if(ap==='PM'&&h<12)h+=12; if(ap==='AM'&&h===12)h=0; return new Date(+m[1],+m[2]-1,+m[3],h,+(m[5]||0),+(m[6]||0)); }
        m = String(raw).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?/i);
        if (m) { let h=+(m[4]||0); const ap=(m[7]||'').toUpperCase(); if(ap==='PM'&&h<12)h+=12; if(ap==='AM'&&h===12)h=0; return new Date(+m[3],+m[1]-1,+m[2],h,+(m[5]||0),+(m[6]||0)); }
        const d = new Date(raw); return isNaN(d.getTime()) ? null : d;
    }

    // Dedup by trade_num (auto-importer emits one record per Discord message;
    // keep the first occurrence carrying P&L), then sort chronologically.
    function cleanTrades(trades) {
        const byNum = new Map();
        (trades || []).forEach(t => {
            const k = t.trade_num || JSON.stringify(t);
            if (!byNum.has(k)) byNum.set(k, t);
            else {
                // prefer the record with non-zero dollar_pl
                const ex = byNum.get(k);
                if ((ex.dollar_pl || 0) === 0 && (t.dollar_pl || 0) !== 0) byNum.set(k, t);
            }
        });
        const arr = Array.from(byNum.values());
        arr.forEach(t => { t._ts = parseTS(t.entry_time || t.entryTime || t.exit_time); });
        arr.sort((a, b) => (a._ts && b._ts) ? a._ts - b._ts : 0);
        return arr;
    }

    function durationStr(t) {
        const a = parseTS(t.entry_time || t.entryTime);
        const b = parseTS(t.exit_time || t.exitTime);
        if (!a || !b || b <= a) return '—';
        const s = Math.round((b - a) / 1000);
        if (s < 60) return s + 's';
        if (s < 3600) return Math.floor(s/60) + 'm ' + (s%60) + 's';
        return Math.floor(s/3600) + 'h ' + Math.floor((s%3600)/60) + 'm';
    }

    // ─── status strip ───
    function renderStatus(clean) {
        const n = clean.length;
        const cum = clean.reduce((a,t)=>a+(t.dollar_pl||0),0);
        const evAll = n ? cum/n : null;
        const fired = BUFFERS.filter(b => cum >= b.threshold).length;
        const w100 = n >= 100 ? clean.slice(-100) : clean;
        const ev100 = w100.length ? w100.reduce((a,t)=>a+(t.dollar_pl||0),0)/w100.length : null;
        const gateFired = ev100 != null && ev100 < 0 && n >= 100;
        $('xp-sample') && ($('xp-sample').textContent = n || '—');
        $('xp-cum') && ($('xp-cum').textContent = fmtSigned(cum));
        $('xp-ev') && ($('xp-ev').textContent = fmtSigned(evAll));
        $('xp-triggers') && ($('xp-triggers').textContent = `${fired} / 4`);
        $('xp-gate') && ($('xp-gate').textContent = gateFired ? 'TRIGGERED' : 'Armed');
        return { n, cum, fired };
    }

    // ─── trigger ladder ───
    function renderLadder(cum) {
        const ladder = $('trigger-ladder'); if (!ladder) return;
        const activeIdx = BUFFERS.findIndex(b => cum < b.threshold);
        BUFFERS.forEach((b, i) => {
            const step = ladder.querySelector(`[data-trigger="${b.id}"]`); if (!step) return;
            const st = step.querySelector('[data-status]');
            step.classList.remove('trigger-step--fired','trigger-step--active','trigger-step--pending');
            if (cum >= b.threshold) { step.classList.add('trigger-step--fired'); st && (st.textContent='FIRED'); }
            else if (i === activeIdx) {
                step.classList.add('trigger-step--active');
                const pct = Math.max(0,Math.min(100,(cum/b.threshold)*100));
                st && (st.innerHTML = `ACTIVE &middot; ${fmtUSD(cum)} of ${fmtUSD(b.threshold)} &middot; ${pct.toFixed(0)}%`);
            } else { step.classList.add('trigger-step--pending'); st && (st.textContent='PENDING'); }
        });
    }

    // ─── next-trigger forecast ───
    function renderForecast(clean, cum) {
        const el = $('forecast-body'); if (!el) return;
        const next = BUFFERS.find(b => cum < b.threshold);
        if (!next) { el.innerHTML = '<strong>All triggers fired · Position locked at 4 ES · Protocol cycle complete pending next-cycle evaluation.</strong>'; return; }
        const distance = next.threshold - cum;
        // trailing monthly average
        const byMonth = monthlySeries(clean);
        const recent = byMonth.slice(-3);
        const monthlyAvg = recent.length ? recent.reduce((a,m)=>a+m.profit,0)/recent.length : null;
        let proj = '';
        if (monthlyAvg && monthlyAvg > 0) {
            const months = Math.ceil(distance / monthlyAvg);
            const d = new Date(); d.setMonth(d.getMonth() + months);
            proj = ` At the current monthly cadence of <strong>${fmtUSD(monthlyAvg)}</strong>, projected to fire <strong>~${d.toLocaleDateString(undefined,{month:'long',year:'numeric'})}</strong>.`;
        } else {
            proj = ' Projection requires ≥1 month of positive cadence data.';
        }
        el.innerHTML = `<strong>Next trigger · ${next.id}.</strong> Fires at <strong>${fmtUSD(next.threshold)}</strong> cumulative profit. Currently <strong>${fmtUSD(distance)}</strong> away.${proj}`;
    }

    // ─── monthly series ───
    function monthlySeries(clean) {
        const map = new Map();
        clean.forEach(t => {
            if (!t._ts) return;
            const key = t._ts.getFullYear() + '-' + String(t._ts.getMonth()+1).padStart(2,'0');
            const e = map.get(key) || { month: key, profit: 0, count: 0 };
            e.profit += (t.dollar_pl||0); e.count += 1; map.set(key, e);
        });
        return Array.from(map.values()).sort((a,b)=>a.month<b.month?-1:1);
    }

    // ─── charts ───
    function destroy(k){ if(charts[k]){ charts[k].destroy(); delete charts[k]; } }

    function renderTrajectory(clean, showFloor) {
        const cv = $('chart-trajectory'); if (!cv || !root.Chart) return;
        destroy('traj');
        let cum = 0; const labels = [], data = [], floor = [];
        const baseEv = clean.length ? (clean.reduce((a,t)=>a+(t.dollar_pl||0),0)/clean.length) : 0;
        // floor case: linear at base-contract EV (use median per-trade as proxy for 1-ES base)
        clean.forEach((t,i) => {
            cum += (t.dollar_pl||0);
            labels.push(t.trade_num || ('#'+(i+1)));
            data.push(Math.round(cum));
            floor.push(Math.round(baseEv * (i+1) * 0.5)); // floor ≈ half the realized cadence (1 ES, no scaling)
        });
        // trigger fire markers
        const fireAnno = {};
        let running = 0, b = 0;
        clean.forEach((t,i) => {
            running += (t.dollar_pl||0);
            while (b < BUFFERS.length && running >= BUFFERS[b].threshold) {
                fireAnno[i] = BUFFERS[b].id; b++;
            }
        });
        const ds = [{ label:'Cumulative ($)', data, borderColor:NAVY, backgroundColor:'rgba(27,42,74,0.06)', borderWidth:2, fill:true, tension:0.15, pointRadius: labels.map((_,i)=>fireAnno[i]?5:0), pointBackgroundColor:GOLD, pointBorderColor:GOLD }];
        if (showFloor) ds.push({ label:'Floor case (1 ES)', data:floor, borderColor:SLATE, borderDash:[6,4], borderWidth:1.5, fill:false, pointRadius:0, tension:0.1 });
        charts.traj = new root.Chart(cv, {
            type:'line',
            data:{ labels, datasets: ds },
            options:{ responsive:true, maintainAspectRatio:false,
                plugins:{ legend:{ display:true, labels:{ font:{family:'DM Sans'} } },
                    tooltip:{ callbacks:{ afterBody:(items)=>{ const i=items[0].dataIndex; return fireAnno[i]?['▲ '+fireAnno[i]+' fired here']:[]; } } } },
                scales:{ x:{ ticks:{ maxTicksLimit:12, font:{family:'JetBrains Mono', size:10} } },
                    y:{ ticks:{ callback:v=>'$'+v.toLocaleString(), font:{family:'JetBrains Mono', size:10} } } } }
        });
    }

    function renderMonthly(clean) {
        const cv = $('chart-monthly'); if (!cv || !root.Chart) return;
        destroy('mo');
        const series = monthlySeries(clean);
        const labels = series.map(m => m.month);
        const data = series.map(m => Math.round(m.profit));
        charts.mo = new root.Chart(cv, {
            type:'bar',
            data:{ labels, datasets:[{ label:'Realized profit ($)', data, backgroundColor: data.map(v=>v>=0?NAVY:NEG) }] },
            options:{ responsive:true, maintainAspectRatio:false,
                plugins:{ legend:{display:false},
                    tooltip:{ callbacks:{ label:(it)=>{ const m=series[it.dataIndex]; return [`Profit: ${fmtSigned(m.profit)}`, `Trades: ${m.count}`]; } } } },
                scales:{ x:{ ticks:{ font:{family:'JetBrains Mono', size:10} } },
                    y:{ ticks:{ callback:v=>'$'+v.toLocaleString(), font:{family:'JetBrains Mono', size:10} } } } }
        });
    }

    function renderContracts(clean) {
        const cv = $('chart-contracts'); if (!cv || !root.Chart) return;
        destroy('ct');
        let cum = 0, contracts = 1; const labels = [], data = [];
        clean.forEach((t,i) => {
            cum += (t.dollar_pl||0);
            const fired = BUFFERS.filter(b => cum >= b.threshold).length;
            contracts = 1 + Math.min(fired, 3); // base 1 ES, +1 per buffer up to 4
            labels.push(t.trade_num || ('#'+(i+1)));
            data.push(contracts);
        });
        charts.ct = new root.Chart(cv, {
            type:'line',
            data:{ labels, datasets:[{ label:'ES contracts (ceiling)', data, borderColor:NAVY, borderWidth:2, stepped:true, pointRadius:0, fill:false }] },
            options:{ responsive:true, maintainAspectRatio:false,
                plugins:{ legend:{display:false} },
                scales:{ x:{ ticks:{ maxTicksLimit:12, font:{family:'JetBrains Mono', size:10} } },
                    y:{ min:0, max:5, ticks:{ stepSize:1, font:{family:'JetBrains Mono', size:10} } } } }
        });
    }

    // ─── trade table ───
    let sortKey = 'time', sortDir = 1, cleanCache = [];
    function renderTable(clean) {
        cleanCache = clean;
        const tbody = $('dash-trade-body'); if (!tbody) return;
        const accessor = {
            trade_num: t => t.trade_num || '', time: t => t._ts ? t._ts.getTime() : 0,
            dir: t => t.direction || '', entry: t => t.entry_price || 0,
            pts: t => t.points_pl || 0, pl: t => t.dollar_pl || 0,
            r: t => (t.risk_dollars ? (t.dollar_pl||0)/t.risk_dollars : 0),
            size: t => t.position_size || '', dur: t => t.exit_time || ''
        };
        const rows = clean.slice().sort((a,b) => {
            const av = accessor[sortKey](a), bv = accessor[sortKey](b);
            if (av < bv) return -1*sortDir; if (av > bv) return 1*sortDir; return 0;
        });
        tbody.innerHTML = rows.map(t => {
            const pl = t.dollar_pl || 0; const r = t.risk_dollars ? pl/t.risk_dollars : null;
            return `<tr>
                <td class="mono">${t.trade_num||'—'}</td>
                <td class="mono" style="font-size:11px">${t.entry_time||'—'}</td>
                <td>${t.direction||'—'}</td>
                <td class="num mono">${t.entry_price||'—'}</td>
                <td class="num mono">${t.points_pl!=null?(t.points_pl>0?'+':'')+t.points_pl:'—'}</td>
                <td class="num mono" style="color:${pl>=0?POS:NEG}">${fmtSigned(pl)}</td>
                <td class="num mono">${fmtR(r)}</td>
                <td>${t.position_size||'—'}</td>
                <td class="mono" style="font-size:11px">${durationStr(t)}</td>
            </tr>`;
        }).join('');
    }
    function wireSort() {
        document.querySelectorAll('#dash-trade-table th[data-sort]').forEach(th => {
            th.style.cursor = 'pointer';
            th.addEventListener('click', () => {
                const k = th.dataset.sort;
                if (k === sortKey) sortDir *= -1; else { sortKey = k; sortDir = 1; }
                renderTable(cleanCache);
            });
        });
    }
    function downloadCSV() {
        const cols = ['trade_num','entry_time','exit_time','direction','entry_price','points_pl','dollar_pl','risk_dollars','position_size','product'];
        const head = cols.join(',');
        const body = cleanCache.map(t => cols.map(c => JSON.stringify(t[c] ?? '')).join(',')).join('\n');
        const blob = new Blob([head+'\n'+body], { type:'text/csv' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
        a.download = 'ekantik-experiment-trades.csv'; a.click();
    }

    function renderAll(state) {
        const clean = cleanTrades((state && state.trades) || []);
        if (!clean.length) return;
        const { cum } = renderStatus(clean);
        renderLadder(cum);
        renderForecast(clean, cum);
        renderTrajectory(clean, $('floor-toggle') && $('floor-toggle').checked);
        renderMonthly(clean);
        renderContracts(clean);
        renderTable(clean);
    }

    function init() {
        // nav toggle
        const tog = $('nav-toggle'), lk = $('nav-links');
        if (tog && lk) tog.addEventListener('click', () => lk.classList.toggle('nav__links--open'));
        // floor toggle (persist)
        const floor = $('floor-toggle');
        if (floor) {
            try { floor.checked = localStorage.getItem('ekantik-floor') === '1'; } catch(e){}
            floor.addEventListener('change', () => {
                try { localStorage.setItem('ekantik-floor', floor.checked ? '1':'0'); } catch(e){}
                renderTrajectory(cleanCache, floor.checked);
            });
        }
        wireSort();
        const csv = $('dash-csv'); if (csv) csv.addEventListener('click', downloadCSV);

        if (root.Ekantik && root.Ekantik.Data) {
            root.Ekantik.Data.onChange(renderAll);
            root.Ekantik.Data.load();
        }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})(typeof window !== 'undefined' ? window : globalThis);
