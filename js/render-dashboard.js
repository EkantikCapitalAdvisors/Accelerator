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

    // Buffer N runs N ES. A separate trial run (1 ES) banks the first $10K;
    // Buffer 1 (also 1 ES) starts the real challenge. Each buffer is active
    // while cumulative profit sits in [threshold, nextThreshold).
    const BUFFERS = [
        { id: 'B1', threshold: 10000, es: 1 },
        { id: 'B2', threshold: 20000, es: 2 },
        { id: 'B3', threshold: 30000, es: 3 },
        { id: 'B4', threshold: 40000, es: 4 },
    ];
    const TRIAL_TARGET = 10000;
    // 1 ES through the trial + Buffer 1, then 2/3/4 ES at $20K/$30K/$40K.
    function currentEs(cum) { return cum >= 40000 ? 4 : cum >= 30000 ? 3 : cum >= 20000 ? 2 : 1; }
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
        $('xp-triggers') && ($('xp-triggers').textContent = `${currentEs(cum)} ES`);
        $('xp-gate') && ($('xp-gate').textContent = gateFired ? 'TRIGGERED' : 'Armed');
        return { n, cum, fired };
    }

    // ─── trigger ladder ───
    function renderLadder(cum) {
        const ladder = $('trigger-ladder'); if (!ladder) return;
        const setState = (step, cls, html) => {
            if (!step) return;
            const st = step.querySelector('[data-status]');
            step.classList.remove('trigger-step--fired','trigger-step--active','trigger-step--pending');
            step.classList.add(cls);
            if (st) st.innerHTML = html;
        };
        // Trial run — separate, 1 ES, target $10K.
        const trialStep = ladder.querySelector('[data-trigger="TRIAL"]');
        if (trialStep) {
            if (cum >= TRIAL_TARGET) setState(trialStep, 'trigger-step--fired', 'CLEARED');
            else {
                const pct = Math.max(0, Math.min(100, (cum / TRIAL_TARGET) * 100));
                setState(trialStep, 'trigger-step--active', `ACTIVE &middot; ${fmtUSD(Math.max(0, cum))} of ${fmtUSD(TRIAL_TARGET)} &middot; ${pct.toFixed(0)}%`);
            }
        }
        // Buffers — active while cumulative profit sits in [threshold, nextThreshold).
        BUFFERS.forEach((b, i) => {
            const step = ladder.querySelector(`[data-trigger="${b.id}"]`); if (!step) return;
            const next = (i + 1 < BUFFERS.length) ? BUFFERS[i + 1].threshold : Infinity;
            if (cum >= next) setState(step, 'trigger-step--fired', 'CLEARED');
            else if (cum >= b.threshold) {
                if (isFinite(next)) {
                    const pct = Math.max(0, Math.min(100, ((cum - b.threshold) / (next - b.threshold)) * 100));
                    setState(step, 'trigger-step--active', `ACTIVE &middot; running ${b.es} ES &middot; ${pct.toFixed(0)}% to next`);
                } else {
                    setState(step, 'trigger-step--active', `ACTIVE &middot; running ${b.es} ES &middot; cap`);
                }
            } else setState(step, 'trigger-step--pending', 'PENDING');
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
        let cum = 0; const labels = [], data = [], floor = [], fullLabels = [];
        const baseEv = clean.length ? (clean.reduce((a,t)=>a+(t.dollar_pl||0),0)/clean.length) : 0;
        clean.forEach((t,i) => {
            cum += (t.dollar_pl||0);
            const d = parseTS(t.entry_time || t.entryTime || t.trade_date);
            const tn = t.trade_num || ('#'+(i+1));
            const dateStr = d ? d.toLocaleDateString('en-US', { month:'short', day:'numeric' }) : '';
            // Multi-line tick label: trade ID on top, date below. Chart.js auto-skips
            // so only a representative subset renders — both lines remain visible.
            labels.push([tn, dateStr]);
            data.push(Math.round(cum));
            floor.push(Math.round(baseEv * (i+1) * 0.5));
            fullLabels.push(d ? `${tn} · ${d.toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' })}` : tn);
        });
        const ds = [{ label:'Cumulative ($)', data, borderColor:NAVY, backgroundColor:'rgba(27,42,74,0.06)', borderWidth:2, fill:true, tension:0.15, pointRadius:0 }];
        if (showFloor) ds.push({ label:'Floor case', data:floor, borderColor:SLATE, borderDash:[6,4], borderWidth:1.5, fill:false, pointRadius:0, tension:0.1 });
        charts.traj = new root.Chart(cv, {
            type:'line',
            data:{ labels, datasets: ds },
            options:{ responsive:true, maintainAspectRatio:false,
                interaction:{ mode:'index', intersect:false },
                plugins:{ legend:{ display:true, labels:{ font:{family:'DM Sans'} } },
                    tooltip:{ callbacks:{
                        title: items => fullLabels[items[0].dataIndex] || ''
                    } } },
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
        let cum = 0, contracts = 1; const labels = [], data = [], fullLabels = [];
        clean.forEach((t,i) => {
            cum += (t.dollar_pl||0);
            contracts = currentEs(cum);
            const d = parseTS(t.entry_time || t.entryTime || t.trade_date);
            const tn = t.trade_num || ('#'+(i+1));
            const dateStr = d ? d.toLocaleDateString('en-US', { month:'short', day:'numeric' }) : '';
            labels.push([tn, dateStr]);
            data.push(contracts);
            fullLabels.push(d ? `${tn} · ${d.toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' })}` : tn);
        });
        charts.ct = new root.Chart(cv, {
            type:'line',
            data:{ labels, datasets:[{ label:'ES contracts (ceiling)', data, borderColor:NAVY, borderWidth:2, stepped:true, pointRadius:0, fill:false }] },
            options:{ responsive:true, maintainAspectRatio:false,
                interaction:{ mode:'index', intersect:false },
                plugins:{ legend:{display:false},
                    tooltip:{ callbacks:{ title: items => fullLabels[items[0].dataIndex] || '' } } },
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
        const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
        tbody.innerHTML = rows.map(t => {
            const pl = t.dollar_pl || 0; const r = t.risk_dollars ? pl/t.risk_dollars : null;
            const tag = t.attribution
                ? `<span class="trade-tag${t.attribution_breach ? ' trade-tag--breach' : ''}">${esc(t.attribution)}</span> `
                : '';
            const note = (tag + (t.comment ? esc(t.comment) : '')).trim();
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
                <td class="trade-note">${note||'—'}</td>
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
        a.download = 'ekantik-challenge-trades.csv'; a.click();
    }

    // ──────────────────────────────────────────────────────────────
    // Timeframe filter + KPI grid
    // ──────────────────────────────────────────────────────────────
    let currentTf = 'all';

    function filterByTimeframe(trades, tf) {
        if (!tf || tf === 'all' || !trades.length) return trades;
        const tsOf = t => parseTS(t.entry_time || t.entryTime || t.trade_date || t.datetime);
        const latest = trades.reduce((max, t) => { const d = tsOf(t); return d && (!max || d > max) ? d : max; }, null);
        if (!latest) return trades;
        const cutoff = new Date(latest);
        switch (tf) {
            case '7d':  cutoff.setDate(cutoff.getDate() - 7); break;
            case '30d': cutoff.setDate(cutoff.getDate() - 30); break;
            case '90d': cutoff.setDate(cutoff.getDate() - 90); break;
            case 'mtd': cutoff.setDate(1); cutoff.setHours(0,0,0,0); break;
            case 'ytd': cutoff.setMonth(0, 1); cutoff.setHours(0,0,0,0); break;
            default: return trades;
        }
        return trades.filter(t => { const d = tsOf(t); return d && d >= cutoff; });
    }

    function computeKpis(trades) {
        const n = trades.length;
        if (!n) return null;
        const pls   = trades.map(t => t.dollar_pl || 0);
        const risks = trades.map(t => t.risk_dollars || 0);
        const Rs    = trades.map(t => (t.risk_dollars > 0 ? (t.dollar_pl || 0) / t.risk_dollars : null)).filter(v => v != null);
        const wins   = pls.filter(v => v > 0);
        const losses = pls.filter(v => v <= 0);
        const gp = wins.reduce((a, v) => a + v, 0);
        const gl = Math.abs(losses.reduce((a, v) => a + v, 0));
        const net = pls.reduce((a, v) => a + v, 0);

        // Max drawdown + recovery
        let cum = 0, peak = 0, maxDD = 0, troughIdx = -1, peakAtTrough = 0;
        trades.forEach((t, i) => {
            cum += t.dollar_pl || 0;
            if (cum > peak) peak = cum;
            const dd = peak - cum;
            if (dd > maxDD) { maxDD = dd; troughIdx = i; peakAtTrough = peak; }
        });
        let recovery = null;
        if (troughIdx >= 0 && maxDD > 0) {
            let cum2 = 0;
            for (let i = 0; i < trades.length; i++) {
                cum2 += trades[i].dollar_pl || 0;
                if (i > troughIdx && cum2 >= peakAtTrough) { recovery = i - troughIdx; break; }
            }
        }

        // Longest losing streak
        let streak = 0, maxStreak = 0;
        pls.forEach(v => { if (v <= 0) { streak++; if (streak > maxStreak) maxStreak = streak; } else streak = 0; });

        // Window span
        const ts = trades.map(t => parseTS(t.entry_time || t.entryTime || t.trade_date)).filter(Boolean).sort((a,b) => a - b);
        const span = ts.length >= 2 ? { start: ts[0], end: ts[ts.length-1] } : null;

        // Annual R — R-expectancy extrapolated to a full calendar year at the
        // window's observed trade cadence. Needs ≥2 trades and ≥1 day of span;
        // very-short windows produce noisy annualizations and should be read
        // with that in mind.
        const rexp = Rs.length ? Rs.reduce((a, v) => a + v, 0) / Rs.length : null;
        let annualR = null, tradesPerYear = null;
        if (rexp != null && span) {
            const days = Math.max(1, (span.end - span.start) / 86400000);
            tradesPerYear = (n / days) * 365;
            annualR = rexp * tradesPerYear;
        }

        return {
            n, wins: wins.length, losses: losses.length,
            winRate: wins.length / n,
            net, gp, gl,
            pf: gl > 0 ? gp / gl : (gp > 0 ? Infinity : 0),
            avgWin: wins.length ? gp / wins.length : 0,
            avgLoss: losses.length ? -gl / losses.length : 0,
            bestTrade: pls.reduce((m, v) => Math.max(m, v), 0),
            worstTrade: pls.reduce((m, v) => Math.min(m, v), 0),
            rexp,
            annualR, tradesPerYear,
            tradesPerMonth: tradesPerYear != null ? tradesPerYear / 12 : null,
            evPerTrade: net / n,
            avgRisk: risks.length ? risks.reduce((a, v) => a + v, 0) / risks.length : 0,
            maxDD, recovery, maxStreak,
            span
        };
    }

    function renderKpis(k) {
        const $set = (id, v) => { const e = $(id); if (e) e.textContent = v; };
        if (!k) {
            ['kpi-wr','kpi-pf','kpi-rexp','kpi-annualr','kpi-tpm','kpi-ev','kpi-avgwin','kpi-avgloss','kpi-best','kpi-worst','kpi-dd','kpi-recovery','kpi-streak','kpi-avgrisk'].forEach(id => $set(id, '—'));
            $set('dash-tf-window', '0 trades in window');
            return;
        }
        const dateStr = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        const winStr = k.span ? `${k.n} trades · ${dateStr(k.span.start)} → ${dateStr(k.span.end)}` : `${k.n} trades`;
        $set('dash-tf-window', winStr);

        $set('kpi-wr',     (k.winRate * 100).toFixed(1) + '%');
        $set('kpi-wr-sub', `${k.wins} W · ${k.losses} L`);
        $set('kpi-pf',     isFinite(k.pf) ? k.pf.toFixed(2) : '∞');
        $set('kpi-rexp',   fmtR(k.rexp));
        $set('kpi-annualr', k.annualR != null ? (k.annualR >= 0 ? '+' : '') + k.annualR.toFixed(0) + 'R' : '—');
        $set('kpi-annualr-sub', k.tradesPerYear != null ? `~${Math.round(k.tradesPerYear)} trades/yr extrapolated` : 'extrapolated from cadence');
        $set('kpi-tpm', k.tradesPerMonth != null ? k.tradesPerMonth.toFixed(1) : '—');
        $set('kpi-tpm-sub', k.tradesPerYear != null ? `~${Math.round(k.tradesPerYear)} trades/yr extrapolated` : 'avg cadence in window');
        $set('kpi-ev',     fmtSigned(k.evPerTrade));
        $set('kpi-ev-sub', `net ${fmtSigned(k.net)} over window`);

        $set('kpi-avgwin', fmtSigned(k.avgWin));
        $set('kpi-avgwin-sub', `${k.wins} winning trades`);
        $set('kpi-avgloss', fmtSigned(k.avgLoss));
        $set('kpi-avgloss-sub', `${k.losses} losing trades`);
        $set('kpi-best', fmtSigned(k.bestTrade));
        $set('kpi-worst', fmtSigned(k.worstTrade));

        $set('kpi-dd', '−' + fmtUSD(k.maxDD).replace('−','').replace('$','$'));
        $set('kpi-dd-sub', k.maxDD > 0 ? `${(k.maxDD / 10000 * 100).toFixed(1)}% of $10K working unit` : '—');
        $set('kpi-recovery', k.recovery != null ? `${k.recovery} trades` : (k.maxDD > 0 ? 'in progress' : '—'));
        $set('kpi-streak', k.maxStreak + ' in a row');
        $set('kpi-avgrisk', fmtUSD(k.avgRisk));
    }

    function setActiveTf(tf) {
        currentTf = tf;
        document.querySelectorAll('.dash-tf-chip').forEach(b => {
            const on = b.dataset.tf === tf;
            b.classList.toggle('dash-tf-chip--active', on);
            b.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
    }

    function renderAll(state) {
        const all = cleanTrades((state && state.trades) || []);
        if (!all.length) return;
        const { cum } = renderStatus(all);
        renderLadder(cum);
        renderForecast(all, cum);
        renderTrajectory(all, $('floor-toggle') && $('floor-toggle').checked);
        renderMonthly(all);
        renderContracts(all);

        // KPIs and trade table filter by timeframe; charts/ladder/forecast stay all-time.
        const windowed = filterByTimeframe(all, currentTf);
        renderKpis(computeKpis(windowed));
        renderTable(windowed);
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

        // Timeframe selector — re-render KPIs + trade table on click.
        // Persist the chosen window in localStorage.
        try { const saved = localStorage.getItem('ekantik-dash-tf'); if (saved) currentTf = saved; } catch (e) {}
        setActiveTf(currentTf);
        document.querySelectorAll('.dash-tf-chip').forEach(b => {
            b.addEventListener('click', () => {
                setActiveTf(b.dataset.tf);
                try { localStorage.setItem('ekantik-dash-tf', currentTf); } catch (e) {}
                if (root.Ekantik && root.Ekantik.Data) {
                    const cur = root.Ekantik.Data.get();
                    if (cur) renderAll(cur);
                }
            });
        });

        if (root.Ekantik && root.Ekantik.Data) {
            root.Ekantik.Data.onChange(renderAll);
            root.Ekantik.Data.load();

            // Live polling so the dashboard updates dynamically without a reload
            // (load() busts only the trades fetch; paused while the tab is hidden).
            let polling = false;
            async function refresh() {
                if (polling || document.visibilityState === 'hidden') return;
                polling = true;
                try { await root.Ekantik.Data.load(); } catch (e) { /* retry next tick */ }
                finally { polling = false; }
            }
            setInterval(refresh, 60000);
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'visible') refresh();
            });
        }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})(typeof window !== 'undefined' ? window : globalThis);
