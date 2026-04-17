// =====================================================
// DASHBOARD RENDERING ENGINE — Ekantik Accelerator Strategy
// Standalone tenx-only build
// =====================================================

// State
const state = {
    tenx: { allTrades: [], currentPeriod: 'alltime', selectedWeek: null, kpis: null, snapshots: [], edgePeriod: 'alltime', periodTrades: null }
};

const chartInstances = {};

// ===== FILE UPLOAD HANDLER =====
async function handleTenxCSVUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    showUploadProgress('tenx', `Parsing ${file.name}…`);

    const text = await file.text();
    const newTrades = parseTradovateCSV(text);

    if (newTrades.length === 0) {
        showUploadError('tenx', 'No valid round-trip trades found in CSV.');
        return;
    }

    // Merge with existing trades (dedup by entryTime|exitTime|direction|dollarPL)
    let existingTrades = state.tenx.allTrades;
    if (existingTrades.length === 0) {
        try {
            const lsJson = localStorage.getItem('tenx-trades');
            if (lsJson) existingTrades = JSON.parse(lsJson) || [];
        } catch (e) {}
    }
    if (existingTrades.length === 0) {
        try {
            const dbTrades = await DB.loadTrades('tenx_trades');
            if (dbTrades.length > 0) existingTrades = dbTrades.map(dbRowToTenxTrade);
        } catch (e) {}
    }

    const norm = v => Math.round(parseFloat(v) * 10000) / 10000;
    const existingKeys = new Set(existingTrades.map(t =>
        `${t.entryTime}|${t.exitTime}|${t.direction}|${norm(t.dollarPL)}`
    ));
    const uniqueNew = newTrades.filter(t =>
        !existingKeys.has(`${t.entryTime}|${t.exitTime}|${t.direction}|${norm(t.dollarPL)}`)
    );

    const allTrades = [...existingTrades, ...uniqueNew].sort((a, b) =>
        new Date(a.entryTime || a.exitTime) - new Date(b.entryTime || b.exitTime)
    );

    state.tenx.allTrades = allTrades;

    // Persist to localStorage
    try {
        localStorage.setItem('tenx-trades', JSON.stringify(allTrades));
        localStorage.setItem('tenx-filename', file.name);
        localStorage.setItem('tenx-upload-time', Date.now().toString());
    } catch (e) {
        try { localStorage.removeItem('tenx-trades'); localStorage.setItem('tenx-trades', JSON.stringify(allTrades)); } catch (e2) {}
    }

    // Store raw CSV for export
    try { localStorage.setItem('tenx-raw-csv', text); } catch (e) {}

    // Populate weeks and refresh
    const weeks = getWeeksList(allTrades);
    state.tenx.selectedWeek = weeks[0];
    populateWeekSelector('tenx', weeks);
    setPeriod('tenx', 'alltime');

    // Generate snapshots
    const snapshots = generateWeeklySnapshots(allTrades, 'tenx', TENX_RISK, TENX_PPT, TENX_STARTING_BALANCE);
    state.tenx.snapshots = snapshots;
    try { localStorage.setItem('tenx-snapshots', JSON.stringify(snapshots)); } catch (e) {}

    showUploadSuccess('tenx', `${file.name} — ${allTrades.length} trades (${uniqueNew.length} new)`);
    showExportButton('tenx');

    // Render growth chart
    renderGrowthComparisonFromState('chart-growth-comparison-tenx', 'tenx');

    // Background DB sync
    (async () => {
        try {
            const batchId = `tenx-${Date.now()}`;
            await DB.saveTrades('tenx_trades', uniqueNew.length > 0 ? uniqueNew : allTrades, batchId);
            await DB.saveAllWeeklySnapshots('tenx', snapshots);
            recordSyncTime('tenx');
        } catch (e) {
            console.warn('DB sync failed:', e);
            showUploadWarning('tenx', `${allTrades.length} trades saved locally (DB sync pending)`);
        }
    })();
}

// ===== UPLOAD STATUS HELPERS =====
function showUploadProgress(method, msg) {
    const el = document.getElementById(`upload-status-${method}`);
    if (!el) return;
    el.classList.remove('hidden');
    el.innerHTML = `<div class="bg-blue-900/30 border border-blue-500/50 rounded-lg p-3 flex items-center gap-2"><i class="fas fa-spinner fa-spin text-blue-400"></i><span class="text-blue-300 text-sm font-semibold">${msg}</span></div>`;
}
function showUploadSuccess(method, msg) {
    const el = document.getElementById(`upload-status-${method}`);
    if (!el) return;
    el.classList.remove('hidden');
    el.innerHTML = `<div class="bg-green-900/30 border border-green-500/50 rounded-lg p-3 flex items-center gap-2"><i class="fas fa-check-circle text-green-400"></i><span class="text-green-300 text-sm font-semibold">${msg}</span></div>`;
}
function showUploadError(method, msg) {
    const el = document.getElementById(`upload-status-${method}`);
    if (!el) return;
    el.classList.remove('hidden');
    el.innerHTML = `<div class="bg-red-900/30 border border-red-500/50 rounded-lg p-3 flex items-center gap-2"><i class="fas fa-exclamation-circle text-red-400"></i><span class="text-red-300 text-sm font-semibold">${msg}</span></div>`;
}
function showUploadWarning(method, msg) {
    const el = document.getElementById(`upload-status-${method}`);
    if (!el) return;
    el.classList.remove('hidden');
    el.innerHTML = `<div class="bg-yellow-900/30 border border-yellow-500/50 rounded-lg p-3 flex items-center gap-2"><i class="fas fa-exclamation-triangle text-yellow-400"></i><span class="text-yellow-300 text-sm font-semibold">${msg}</span></div>`;
}

// ===== CLEAR DATA =====
function clearData(method) {
    if (!confirm('Clear all uploaded data? This removes it from this browser only. Database records are preserved.')) return;
    localStorage.removeItem('tenx-trades');
    localStorage.removeItem('tenx-filename');
    localStorage.removeItem('tenx-upload-time');
    localStorage.removeItem('tenx-snapshots');
    localStorage.removeItem('tenx-raw-csv');
    state.tenx.allTrades = [];
    state.tenx.kpis = null;
    state.tenx.snapshots = [];
    location.reload();
}

// ===== GITHUB SYNC SETTINGS =====
function showGitHubSettings() {
    const existing = document.getElementById('gh-settings-panel');
    if (existing) { existing.remove(); return; }
    const panel = document.createElement('div');
    panel.id = 'gh-settings-panel';
    panel.className = 'fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm';
    panel.innerHTML = `
        <div class="bg-[#0d1d35] border border-emerald-400/30 rounded-2xl p-6 max-w-sm w-full shadow-2xl">
            <h3 class="text-white font-bold text-sm mb-3"><i class="fas fa-cog mr-2 text-emerald-400"></i>GitHub Sync Token</h3>
            <p class="text-gray-400 text-xs mb-3">Paste a fine-grained Personal Access Token with Contents read/write access to EkantikCapitalAdvisors/Dashboard.</p>
            <input id="gh-token-input" type="password" value="${DB._token()}" placeholder="github_pat_..." class="w-full bg-[#0a1628] border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-400/60 mb-3">
            <div class="flex gap-2">
                <button onclick="saveGitHubToken()" class="flex-1 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm rounded-lg">Save</button>
                <button onclick="clearGitHubToken()" class="px-3 py-2 bg-red-900/30 hover:bg-red-900/50 text-red-400 font-semibold text-sm rounded-lg">Clear</button>
                <button onclick="document.getElementById('gh-settings-panel').remove()" class="px-3 py-2 bg-gray-700/50 hover:bg-gray-600/50 text-gray-300 text-sm rounded-lg">Close</button>
            </div>
        </div>`;
    document.body.appendChild(panel);
    panel.addEventListener('click', e => { if (e.target === panel) panel.remove(); });
}
function saveGitHubToken() {
    const token = document.getElementById('gh-token-input').value.trim();
    if (token) localStorage.setItem('gh-token', token);
    document.getElementById('gh-settings-panel')?.remove();
    updateGitHubSyncIndicators();
}
function clearGitHubToken() {
    localStorage.removeItem('gh-token');
    document.getElementById('gh-settings-panel')?.remove();
    updateGitHubSyncIndicators();
}
function updateGitHubSyncIndicators() {
    const hasToken = !!DB._token();
    const btn = document.getElementById('gh-sync-btn');
    if (btn) btn.style.opacity = hasToken ? '1' : '0.5';
}

// ===== PERIOD CONTROLS =====
function setPeriod(method, period) {
    state[method].currentPeriod = period;
    // Update period buttons
    document.querySelectorAll('.period-btn').forEach(b => {
        b.classList.remove('active-period');
        b.classList.add('bg-[#0d1d35]', 'text-gray-400', 'border', 'border-gray-700');
    });
    const btn = document.getElementById(`period-${method}-${period}`);
    if (btn) {
        btn.classList.add('active-period');
        btn.classList.remove('bg-[#0d1d35]', 'text-gray-400', 'border', 'border-gray-700');
    }

    // If weekly/monthly, set selected week
    if (period === 'weekly' || period === 'monthly') {
        const sel = document.getElementById(`week-selector-${method}`);
        if (sel && sel.value) state[method].selectedWeek = sel.value;
    }

    refreshDashboard(method);
}

function populateWeekSelector(method, weeks) {
    const sel = document.getElementById(`week-selector-${method}`);
    if (!sel) return;
    sel.innerHTML = '';
    weeks.forEach(w => {
        const opt = document.createElement('option');
        opt.value = w;
        opt.textContent = `Week of ${getWeekRange(w)}`;
        sel.appendChild(opt);
    });
}

function selectWeek(method) {
    const sel = document.getElementById(`week-selector-${method}`);
    if (sel) state[method].selectedWeek = sel.value;
    refreshDashboard(method);
}

function prevPeriod(method) {
    const weeks = getWeeksList(state[method].allTrades);
    const idx = weeks.indexOf(state[method].selectedWeek);
    if (idx < weeks.length - 1) {
        state[method].selectedWeek = weeks[idx + 1];
        const sel = document.getElementById(`week-selector-${method}`);
        if (sel) sel.value = state[method].selectedWeek;
        refreshDashboard(method);
    }
}

function nextPeriod(method) {
    const weeks = getWeeksList(state[method].allTrades);
    const idx = weeks.indexOf(state[method].selectedWeek);
    if (idx > 0) {
        state[method].selectedWeek = weeks[idx - 1];
        const sel = document.getElementById(`week-selector-${method}`);
        if (sel) sel.value = state[method].selectedWeek;
        refreshDashboard(method);
    }
}

function filterByTimeWindow(trades, period) {
    if (period === 'alltime') return trades;
    const days = period === '6months' ? 180 : period === '3months' ? 90 : period === '1month' ? 30 : period === '2weeks' ? 14 : 7;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    return trades.filter(t => {
        const dateStr = t.exitTime || t.datetime || t.date || '';
        if (!dateStr) return true;
        const parts = dateStr.split(' ')[0].split('/');
        if (parts.length < 3) return true;
        const year = parts[2].length === 2 ? '20' + parts[2] : parts[2];
        const tradeDate = new Date(parseInt(year), parseInt(parts[0]) - 1, parseInt(parts[1]));
        return tradeDate >= cutoff;
    });
}

// ===== EDGE PERIOD CONTROLS =====
function setEdgePeriod(method, period) {
    state[method].edgePeriod = period;
    document.querySelectorAll('.edge-period-btn').forEach(b => {
        b.classList.remove('active-edge-period', 'active-edge-period-emerald');
        b.classList.add('bg-[#0d1d35]', 'text-gray-400', 'border', 'border-gray-700');
    });
    const btn = document.getElementById(`edge-period-${method}-${period}`);
    if (btn) {
        btn.classList.add('active-edge-period-emerald');
        btn.classList.remove('bg-[#0d1d35]', 'text-gray-400', 'border', 'border-gray-700');
    }
    updateEdgeSection(method);
}

function updateEdgeSection(method) {
    const allTrades = state[method].allTrades;
    if (!allTrades || allTrades.length === 0) return;

    const edgePeriod = state[method].edgePeriod || 'alltime';
    const edgeTrades = filterByTimeWindow(allTrades, edgePeriod);
    const edgeK = edgeTrades.length > 0 ? calculateKPIs(edgeTrades, TENX_RISK, TENX_PPT, TENX_STARTING_BALANCE) : null;
    if (!edgeK) return;

    const prefix = 'txfc';
    const setEl = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };

    const labelMap = { alltime: 'All-Time', '1week': 'Last Week', '3months': 'Last 3 Months', '1month': 'Last Month', '2weeks': 'Last 2 Weeks' };
    const labelEl = document.getElementById(`edge-period-label-${method}`);
    if (labelEl) labelEl.textContent = `${labelMap[edgePeriod] || 'All-Time'} · ${edgeTrades.length} trade${edgeTrades.length !== 1 ? 's' : ''}`;

    const evBig = document.getElementById('tenx-ev-hero-big');
    if (evBig) evBig.textContent = `${edgeK.evPlannedR >= 0 ? '+' : ''}${edgeK.evPlannedR.toFixed(1)}%R`;
    const edgeAvgR = edgeK.avgRiskDollars;
    setEl('tenx-ev-hero-sub', edgeAvgR > 0 ? `${fmtDollar(edgeK.evPerTrade)} per trade · 1R = ${fmtDollar(edgeAvgR)}` : `${fmtDollar(edgeK.evPerTrade)} per trade`);
    const actualRisk = document.getElementById('tenx-ev-actual-risk');
    if (actualRisk) actualRisk.innerHTML = edgeAvgR > 0
        ? `<strong>Risk budget:</strong> $500/day · <strong>Avg risk/trade:</strong> $${edgeAvgR.toFixed(0)} (1R)`
        : `<strong>Risk budget:</strong> $500/day (5%)`;

    setColor('tenx-edge-avgwin', fmtDollar(edgeK.avgWinDollar), 1);
    setEl('tenx-edge-avgwin-pts', `+${edgeK.avgWinPts.toFixed(2)} pts`);
    setColor('tenx-edge-avgloss', fmtDollar(edgeK.avgLossDollar), -1);
    setEl('tenx-edge-avgloss-pts', `${edgeK.avgLossPts.toFixed(2)} pts`);
    setEl('tenx-edge-wr', `${edgeK.winRate.toFixed(1)}% (${edgeK.winCount}W / ${edgeK.lossCount}L)`);
    setEl('tenx-edge-explanation', buildEdgeExplanation(edgeK));
    setEl('tenx-detail-grosswins', fmtDollar(edgeK.grossWins));
    setEl('tenx-detail-grosslosses', `-${fmtDollar(edgeK.grossLosses)}`);
    setEl('tenx-detail-wlratio', edgeK.wlRatio === Infinity ? '∞' : edgeK.wlRatio.toFixed(2));
    setEl('tenx-detail-netpts', `${edgeK.netPoints >= 0 ? '+' : ''}${edgeK.netPoints.toFixed(2)}`);

    // Formula elements
    const edgeR = edgeK.evPlannedR;
    const edgeSign = edgeR >= 0 ? '+' : '';
    const winRateDec = edgeK.winRate / 100;
    const lossRateDec = 1 - winRateDec;
    const avgWinR = TENX_RISK > 0 ? edgeK.avgWinDollar / TENX_RISK : 0;
    const avgLossR = TENX_RISK > 0 ? Math.abs(edgeK.avgLossDollar) / TENX_RISK : 0;

    setEl(`${prefix}-win-rate`, `${edgeK.winRate.toFixed(1)}%`);
    setEl(`${prefix}-ev-result`, `${edgeSign}${edgeR.toFixed(1)}%R`);
    setEl(`${prefix}-formula-line1`, `EV = (${(winRateDec * 100).toFixed(0)}% × ${avgWinR.toFixed(2)}R) − (${(lossRateDec * 100).toFixed(0)}% × ${avgLossR.toFixed(2)}R)`);
    setEl(`${prefix}-formula-line2`, `EV = ${(winRateDec * avgWinR).toFixed(3)}R − ${(lossRateDec * avgLossR).toFixed(3)}R`);
    setEl(`${prefix}-formula-result`, `EV = ${edgeSign}${(edgeR / 100).toFixed(3)}R per trade (${edgeSign}${edgeR.toFixed(1)}%R)`);
}

// ===== TOGGLE SECTIONS =====
function toggleDetailedDashboard(method) {
    const panel = document.getElementById(`detailed-dashboard-${method}`);
    const icon = document.getElementById(`icon-details-${method}`);
    if (!panel) return;
    const isHidden = panel.classList.contains('hidden');
    panel.classList.toggle('hidden');
    if (icon) {
        icon.classList.toggle('fa-chevron-down', !isHidden);
        icon.classList.toggle('fa-chevron-up', isHidden);
    }
    if (isHidden) {
        panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
        setTimeout(() => {
            Object.keys(chartInstances).forEach(key => {
                try { chartInstances[key].resize(); } catch(e) {}
            });
        }, 300);
    }
}

function toggleEdgeSection() {
    const panel = document.getElementById('edge-theory-section');
    const icon = document.getElementById('icon-edge-theory');
    if (!panel) return;
    const isHidden = panel.classList.contains('hidden');
    panel.classList.toggle('hidden');
    if (icon) {
        icon.classList.toggle('fa-chevron-down', !isHidden);
        icon.classList.toggle('fa-chevron-up', isHidden);
    }
    if (isHidden) {
        panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
        setTimeout(() => {
            Object.keys(chartInstances).forEach(key => {
                try { chartInstances[key].resize(); } catch(e) {}
            });
        }, 300);
    }
}

// ===== MAIN REFRESH =====
function refreshDashboard(method) {
    const allTrades = state[method].allTrades;
    if (!allTrades || allTrades.length === 0) return;
    resetTradeLogFilter(method);

    const period = state[method].currentPeriod;
    const selectedWeek = state[method].selectedWeek;
    let trades;

    if (period === 'weekly') {
        trades = filterByWeek(allTrades, selectedWeek);
    } else if (period === 'monthly') {
        trades = filterByMonth(allTrades, selectedWeek);
    } else if (period === '1week' || period === '3months' || period === '6months') {
        trades = filterByTimeWindow(allTrades, period);
    } else {
        trades = allTrades;
    }

    if (trades.length === 0) {
        trades = allTrades;
        state[method].currentPeriod = 'alltime';
        document.querySelectorAll('.period-btn').forEach(b => {
            b.classList.remove('active-period');
            b.classList.add('bg-[#0d1d35]', 'text-gray-400', 'border', 'border-gray-700');
        });
        const btn = document.getElementById(`period-${method}-alltime`);
        if (btn) {
            btn.classList.add('active-period');
            btn.classList.remove('bg-[#0d1d35]', 'text-gray-400', 'border', 'border-gray-700');
        }
    }

    state[method].periodTrades = trades;

    const kpis = calculateKPIs(trades, TENX_RISK, TENX_PPT, TENX_STARTING_BALANCE);
    state[method].kpis = kpis;
    const allTimeKPIs = calculateKPIs(allTrades, TENX_RISK, TENX_PPT, TENX_STARTING_BALANCE);

    const rangeEl = document.getElementById(`period-range-${method}`);
    if (rangeEl) {
        if (period === 'weekly') rangeEl.textContent = getWeekRange(selectedWeek);
        else if (period === 'monthly') {
            const parts = selectedWeek ? selectedWeek.split('/') : [];
            const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
            if (parts.length >= 3) {
                const m = parseInt(parts[0]) - 1;
                const y = parts[2].length === 2 ? '20' + parts[2] : parts[2];
                rangeEl.textContent = `${monthNames[m]} ${y} · ${trades.length} trades`;
            }
        } else if (period === 'alltime') {
            rangeEl.textContent = `All-Time · ${trades.length} trades`;
        } else {
            const label = { '1week': 'Last 7 days', '3months': 'Last 3 months', '6months': 'Last 6 months' }[period] || period;
            rangeEl.textContent = `${label} · ${trades.length} trades`;
        }
    }

    renderTenx(kpis, trades, allTimeKPIs, allTrades);
}

// ===== MAIN RENDER FUNCTION =====
function renderTenx(k, trades, allK, allTrades) {
    // Live Update Banner
    const tradeCountEl = document.getElementById('tenx-live-trade-count');
    if (tradeCountEl) tradeCountEl.textContent = `${allTrades.length} trades (All-Time)`;
    const lastUpdEl = document.getElementById('tenx-live-last-updated');
    if (lastUpdEl) {
        const uploadTime = parseInt(localStorage.getItem('tenx-upload-time') || '0');
        if (uploadTime > 0) {
            lastUpdEl.textContent = new Date(uploadTime).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
        } else {
            lastUpdEl.textContent = getLastTradeDate(allTrades) || '—';
        }
    }

    // Hero Stats
    setColor('tenx-hero-pnl', fmtDollar(k.netPL), k.netPL);
    const pnlSub = document.getElementById('tenx-hero-pnl-sub');
    if (pnlSub) pnlSub.textContent = `${k.totalTrades} trade${k.totalTrades !== 1 ? 's' : ''}`;

    setColor('tenx-hero-return', fmtPct(k.returnPct), k.returnPct);

    setColor('tenx-hero-ev', `${fmtPct(k.evPlannedR)}R`, k.evPlannedR);
    const evSub = document.getElementById('tenx-hero-ev-sub');
    if (evSub) {
        const avgR = k.avgRiskDollars;
        evSub.textContent = avgR > 0 ? `${fmtDollar(k.evPerTrade)}/trade · 1R = ${fmtDollar(avgR)}` : `${fmtDollar(k.evPerTrade)}/trade`;
    }

    // Update the avg risk badge in info section
    const avgRiskBadge = document.getElementById('tenx-avg-risk-badge');
    if (avgRiskBadge && k.avgRiskDollars > 0) {
        avgRiskBadge.textContent = `1R = $${k.avgRiskDollars.toFixed(0)} avg risk/trade`;
        avgRiskBadge.classList.remove('hidden');
    }

    const wrEl = document.getElementById('tenx-hero-wr');
    if (wrEl) wrEl.textContent = `${k.winRate.toFixed(1)}%`;
    const wrSub = document.getElementById('tenx-hero-wr-sub');
    if (wrSub) wrSub.textContent = `${k.winCount}W / ${k.lossCount}L`;

    const pfEl = document.getElementById('tenx-hero-pf');
    if (pfEl) pfEl.textContent = k.profitFactor === Infinity ? '∞' : k.profitFactor.toFixed(2);
    const pfSub = document.getElementById('tenx-hero-pf-sub');
    if (pfSub) pfSub.textContent = `${fmtDollar(k.grossWins)} / ${fmtDollar(k.grossLosses)}`;

    setColor('tenx-hero-dd', `-${fmtDollar(k.maxDD)}`, k.maxDD > 0 ? -1 : 0);
    const ddSub = document.getElementById('tenx-hero-dd-sub');
    if (ddSub) ddSub.textContent = `-${k.maxDDPct.toFixed(2)}%`;

    // NET MES PTS (7th card)
    const ptsEl = document.getElementById('tenx-hero-mespts');
    if (ptsEl) {
        ptsEl.textContent = `${k.netPoints >= 0 ? '+' : ''}${k.netPoints.toFixed(2)}`;
        ptsEl.className = ptsEl.className.replace(/text-(green|red|gray)-\d+/g, '') + (k.netPoints >= 0 ? ' text-green-400' : ' text-red-400');
    }
    const ptsSub = document.getElementById('tenx-hero-mespts-sub');
    if (ptsSub) ptsSub.textContent = `avg W: +${k.avgWinPts.toFixed(1)} / avg L: ${k.avgLossPts.toFixed(1)}`;

    // Edge section
    const evBig = document.getElementById('tenx-ev-hero-big');
    if (evBig) evBig.textContent = `${k.evPlannedR >= 0 ? '+' : ''}${k.evPlannedR.toFixed(1)}%R`;
    const evHeroSub = document.getElementById('tenx-ev-hero-sub');
    const mainAvgR = k.avgRiskDollars;
    if (evHeroSub) evHeroSub.textContent = mainAvgR > 0 ? `${fmtDollar(k.evPerTrade)} per trade · 1R = ${fmtDollar(mainAvgR)}` : `${fmtDollar(k.evPerTrade)} per trade ($500/day risk)`;
    const actualRisk = document.getElementById('tenx-ev-actual-risk');
    if (actualRisk) actualRisk.innerHTML = mainAvgR > 0
        ? `<strong>Risk budget:</strong> $500/day · <strong>Avg risk/trade:</strong> $${mainAvgR.toFixed(0)} (1R)`
        : `<strong>Risk budget:</strong> $500/day (5%)`;

    setColor('tenx-edge-avgwin', fmtDollar(k.avgWinDollar), 1);
    const awPts = document.getElementById('tenx-edge-avgwin-pts');
    if (awPts) awPts.textContent = `+${k.avgWinPts.toFixed(2)} pts`;
    setColor('tenx-edge-avgloss', fmtDollar(k.avgLossDollar), -1);
    const alPts = document.getElementById('tenx-edge-avgloss-pts');
    if (alPts) alPts.textContent = `${k.avgLossPts.toFixed(2)} pts`;
    const wrEdge = document.getElementById('tenx-edge-wr');
    if (wrEdge) wrEdge.textContent = `${k.winRate.toFixed(1)}% (${k.winCount}W / ${k.lossCount}L)`;
    const explEl = document.getElementById('tenx-edge-explanation');
    if (explEl) explEl.textContent = buildEdgeExplanation(k);

    const gwEl = document.getElementById('tenx-detail-grosswins');
    if (gwEl) gwEl.textContent = fmtDollar(k.grossWins);
    const glEl = document.getElementById('tenx-detail-grosslosses');
    if (glEl) glEl.textContent = `-${fmtDollar(k.grossLosses)}`;
    const wlrEl = document.getElementById('tenx-detail-wlratio');
    if (wlrEl) wlrEl.textContent = k.wlRatio === Infinity ? '∞' : k.wlRatio.toFixed(2);
    const npEl = document.getElementById('tenx-detail-netpts');
    if (npEl) npEl.textContent = `${k.netPoints >= 0 ? '+' : ''}${k.netPoints.toFixed(2)}`;

    // Charts — emerald accent
    renderEquityCurve('chart-equity-tenx', k.equityCurve, k.drawdownCurve, '#34d399');
    renderDailyPL('chart-daily-tenx', k.dailyPL, k.tradingDays);
    renderPLDistribution('chart-pldist-tenx', k.plDistribution, '#34d399');
    renderWeeklyTrend('chart-weekly-trend-tenx', allK.weeklyPL, 'tenx');

    // Monthly Summary
    renderMonthlySummary('monthly-summary-tenx', allTrades, TENX_RISK, TENX_PPT, TENX_STARTING_BALANCE);

    // Trade Log
    renderTenxTradeLog('tenx-trades-body', trades);
    const tcEl = document.getElementById('tenx-trade-count');
    if (tcEl) tcEl.textContent = `${trades.length} trades`;

    // Inception Summary
    renderInceptionSummary('tenx', allK);

    // Edge Trend
    renderEdgeTrendByWeek('chart-edge-trend-tenx', allTrades, TENX_RISK, TENX_PPT, 'tenx', allK.evPlannedR);

    // Food Chain
    renderFoodChain('tenx', k, allK, allTrades);

    // Growth Comparison
    renderGrowthComparisonFromState('chart-growth-comparison-tenx', 'tenx');

    // Evidence Gates, Gain Metrics & Adherence Scorecard
    renderEvidenceGates(allK);
    renderGainMetrics(allTrades, allK);
    renderAdherenceScorecard(allTrades, allK);
}

// ===== Q0 EVIDENCE GATES =====
function renderEvidenceGates(allK) {
    if (!allK) return;

    const gates = [
        { id: 'trades', value: allK.totalTrades, target: 25, format: v => `${v}/25`, pct: v => Math.min(100, (v / 25) * 100), pass: v => v >= 25 },
        { id: 'return', value: allK.returnPct, target: 30, format: v => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`, pct: v => Math.min(100, Math.max(0, (v / 30) * 100)), pass: v => v >= 30 },
        { id: 'wr', value: allK.winRate, target: 60, format: v => `${v.toFixed(1)}%`, pct: v => Math.min(100, (v / 60) * 100), pass: v => v >= 60 },
        { id: 'ev', value: allK.evPerTrade, target: 0, format: v => `${v >= 0 ? '+' : ''}$${Math.abs(v).toFixed(0)}`, pct: v => v > 0 ? 100 : Math.max(0, 50 + (v / (TENX_RISK * 0.1)) * 50), pass: v => v > 0 },
        { id: 'pf', value: allK.profitFactor, target: 1.5, format: v => v === Infinity ? '∞' : v.toFixed(2), pct: v => Math.min(100, (v / 1.5) * 100), pass: v => v >= 1.5 },
        { id: 'dd', value: allK.maxDDPct, target: 25, format: v => `-${v.toFixed(1)}%`, pct: v => Math.min(100, Math.max(0, ((25 - v) / 25) * 100)), pass: v => v < 25 }
    ];

    const insufficientData = allK.totalTrades < 5;
    let allPassed = true;

    gates.forEach(g => {
        const valEl = document.getElementById(`gate-${g.id}-value`);
        const barEl = document.getElementById(`gate-${g.id}-bar`);
        const cardEl = document.getElementById(`gate-${g.id}`);
        if (!valEl || !barEl || !cardEl) return;

        if (insufficientData && g.id !== 'trades') {
            // Grey — insufficient data
            valEl.textContent = '—';
            valEl.className = 'text-xl font-bold text-gray-500';
            barEl.style.width = '0%';
            barEl.className = 'h-full rounded-full bg-gray-600 transition-all duration-700';
            cardEl.className = 'bg-[#0a1628]/60 border border-gray-700/30 rounded-xl p-3 text-center';
            allPassed = false;
            return;
        }

        const passed = g.pass(g.value);
        const pct = g.pct(g.value);

        valEl.textContent = g.format(g.value);

        if (passed) {
            valEl.className = 'text-xl font-bold text-green-400';
            barEl.className = 'h-full rounded-full bg-green-500 transition-all duration-700';
            cardEl.className = 'bg-green-900/10 border border-green-500/30 rounded-xl p-3 text-center';
        } else if (pct > 60) {
            valEl.className = 'text-xl font-bold text-amber-400';
            barEl.className = 'h-full rounded-full bg-amber-500 transition-all duration-700';
            cardEl.className = 'bg-amber-900/10 border border-amber-500/20 rounded-xl p-3 text-center';
            allPassed = false;
        } else {
            valEl.className = 'text-xl font-bold text-red-400';
            barEl.className = 'h-full rounded-full bg-red-500 transition-all duration-700';
            cardEl.className = 'bg-red-900/10 border border-red-500/20 rounded-xl p-3 text-center';
            allPassed = false;
        }

        barEl.style.width = `${Math.max(0, Math.min(100, pct)).toFixed(0)}%`;
    });

    // Validation banner
    const banner = document.getElementById('gates-validated-banner');
    if (banner) banner.classList.toggle('hidden', !allPassed || insufficientData);
}

// ===== GAIN-NOT-GAP METRICS =====
function renderGainMetrics(allTrades, allK) {
    if (!allK || !allTrades || allTrades.length === 0) return;

    const setGain = (id, pctId, value) => {
        const el = document.getElementById(id);
        const pctEl = document.getElementById(pctId);
        if (el) {
            el.textContent = `${value >= 0 ? '+' : '-'}$${Math.abs(value).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
            el.className = `text-${id === 'gain-inception' ? '2xl' : 'lg'} font-bold ${value >= 0 ? 'text-green-400' : 'text-red-400'} mt-1`;
        }
        if (pctEl) {
            const pct = (value / TENX_STARTING_BALANCE * 100);
            pctEl.textContent = `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}% since start`;
        }
    };

    // Gain since inception (all trades)
    setGain('gain-inception', 'gain-inception-pct', allK.netPL);

    // Gain this month
    const now = new Date();
    const monthTrades = allTrades.filter(t => {
        const d = t.date ? normalizeDate(t.date) : '';
        if (!d) return false;
        const parts = d.split('/');
        return parseInt(parts[0]) === (now.getMonth() + 1) && parseInt(parts[2]) === now.getFullYear();
    });
    const monthPL = monthTrades.reduce((s, t) => s + t.dollarPL, 0);
    const mEl = document.getElementById('gain-month');
    const mPctEl = document.getElementById('gain-month-pct');
    if (mEl) {
        mEl.textContent = `${monthPL >= 0 ? '+' : '-'}$${Math.abs(monthPL).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
        mEl.className = `text-lg font-bold ${monthPL >= 0 ? 'text-green-400' : 'text-red-400'} mt-1`;
    }
    if (mPctEl) mPctEl.textContent = `${monthTrades.length} trades this month`;

    // Gain this week
    const dayOfWeek = now.getDay();
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((dayOfWeek + 6) % 7));
    monday.setHours(0, 0, 0, 0);
    const weekTrades = allTrades.filter(t => {
        const d = t.date ? normalizeDate(t.date) : '';
        if (!d) return false;
        const parts = d.split('/');
        const td = new Date(parseInt(parts[2]), parseInt(parts[0]) - 1, parseInt(parts[1]));
        return td >= monday;
    });
    const weekPL = weekTrades.reduce((s, t) => s + t.dollarPL, 0);
    const wEl = document.getElementById('gain-week');
    const wPctEl = document.getElementById('gain-week-pct');
    if (wEl) {
        wEl.textContent = `${weekPL >= 0 ? '+' : '-'}$${Math.abs(weekPL).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
        wEl.className = `text-lg font-bold ${weekPL >= 0 ? 'text-green-400' : 'text-red-400'} mt-1`;
    }
    if (wPctEl) wPctEl.textContent = `${weekTrades.length} trades this week`;
}

// ===== ADHERENCE SCORECARD =====
function renderAdherenceScorecard(allTrades, allK) {
    const el = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };

    // Trades completed — from actual parsed data
    const totalTrades = allK ? allK.totalTrades : 0;
    el('adherence-trades-done', totalTrades.toString());

    // SPEC-M adherence % — requires manual entry or separate data source
    // For now, check localStorage for manually-set values
    const specm = localStorage.getItem('tenx-adherence-specm');
    if (specm) el('adherence-specm', specm);

    // Risk limit adherence % — calculate from trades that stayed within 1R
    if (allTrades && allTrades.length > 0 && allK) {
        const avgRisk = allK.avgRiskDollars || TENX_RISK;
        // A trade "adheres" if its loss didn't exceed 1.5x the average risk
        const threshold = avgRisk * 1.5;
        const adherent = allTrades.filter(t => {
            const pl = typeof t.dollarPL === 'number' ? t.dollarPL : 0;
            return pl >= 0 || Math.abs(pl) <= threshold;
        }).length;
        const riskPct = totalTrades > 0 ? Math.round((adherent / totalTrades) * 100) : 0;
        el('adherence-risk', `${riskPct}%`);
    }

    // Process streak — consecutive trading days with all trades within risk limits
    if (allTrades && allTrades.length > 0) {
        const byDate = {};
        for (const t of allTrades) {
            const d = normalizeDate(t.date);
            if (!byDate[d]) byDate[d] = [];
            byDate[d].push(t);
        }
        const avgRisk = allK ? (allK.avgRiskDollars || TENX_RISK) : TENX_RISK;
        const threshold = avgRisk * 1.5;
        const dates = Object.keys(byDate).sort((a, b) => {
            const pa = a.split('/'), pb = b.split('/');
            return new Date(pa[2], pa[0]-1, pa[1]) - new Date(pb[2], pb[0]-1, pb[1]);
        });
        let streak = 0;
        for (let i = dates.length - 1; i >= 0; i--) {
            const dayTrades = byDate[dates[i]];
            const allWithin = dayTrades.every(t => {
                const pl = typeof t.dollarPL === 'number' ? t.dollarPL : 0;
                return pl >= 0 || Math.abs(pl) <= threshold;
            });
            if (allWithin) streak++;
            else break;
        }
        el('adherence-streak', `${streak} days`);
    }
}

// ===== HELPER: GET LAST TRADE DATE =====
function getLastTradeDate(trades) {
    if (!trades || trades.length === 0) return null;
    let maxTime = 0;
    for (const t of trades) {
        const dateStr = t.exitTime || t.datetime || '';
        if (!dateStr) continue;
        try { const d = new Date(dateStr); if (d.getTime() > maxTime) maxTime = d.getTime(); } catch(e) {}
    }
    if (maxTime === 0) return null;
    return new Date(maxTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ===== FORMATTING HELPERS =====
function fmtDollar(v) { return `$${Math.abs(v).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`; }
function fmtPct(v) { return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`; }

function setColor(elId, text, value) {
    const el = document.getElementById(elId);
    if (!el) return;
    el.textContent = text;
    if (value > 0) el.className = el.className.replace(/text-(green|red|white|gray)-\d+/g, '') + ' text-green-400';
    else if (value < 0) el.className = el.className.replace(/text-(green|red|white|gray)-\d+/g, '') + ' text-red-400';
    else el.className = el.className.replace(/text-(green|red|white|gray)-\d+/g, '') + ' text-gray-400';
}

function buildEdgeExplanation(k) {
    if (k.winCount === 0) return `No winning trades yet. ${k.totalTrades} trade${k.totalTrades !== 1 ? 's' : ''} taken. EV is ${k.evPlannedR.toFixed(1)}%R.`;
    if (k.lossCount === 0) return `Perfect win rate — ${k.winCount} trade${k.winCount !== 1 ? 's' : ''}, all winners. EV is +${k.evPlannedR.toFixed(1)}%R.`;
    if (k.totalTrades < 3) return `Only ${k.totalTrades} trade${k.totalTrades !== 1 ? 's' : ''} — too small. Current EV: ${k.evPlannedR >= 0 ? '+' : ''}${k.evPlannedR.toFixed(1)}%R.`;
    const winBigger = k.wlRatio > 1;
    const sub50 = k.winRate < 50;
    if (k.evPlannedR < 0) return `Current EV is ${k.evPlannedR.toFixed(1)}%R per trade. Risk management is key to recovery.`;
    if (winBigger && sub50) return `Wins are ${((k.wlRatio - 1) * 100).toFixed(0)}% bigger than losses — even with sub-50% win rate, math is positive. Edge: +${k.evPlannedR.toFixed(1)}%R.`;
    if (winBigger) return `${k.winRate.toFixed(0)}% win rate with wins ${((k.wlRatio - 1) * 100).toFixed(0)}% larger than losses. Edge: +${k.evPlannedR.toFixed(1)}%R.`;
    return `${k.winRate.toFixed(0)}% win rate with +${k.evPlannedR.toFixed(1)}%R edge per trade.`;
}

// ===== CHART RENDERERS =====
function renderEquityCurve(containerId, equityCurve, drawdownCurve, color) {
    const container = document.getElementById(containerId);
    if (!container || equityCurve.length === 0) return;
    if (chartInstances[containerId]) chartInstances[containerId].dispose();
    const chart = echarts.init(container, 'dark');
    chartInstances[containerId] = chart;

    const labels = equityCurve.map((_, i) => `T${i + 1}`);
    const balanceData = equityCurve.map(p => p.balance);
    const ddData = drawdownCurve.map(p => p.dd);
    const minBalance = Math.min(...balanceData);
    const maxBalance = Math.max(...balanceData);
    const balanceRange = maxBalance - minBalance;
    const yMin = Math.max(0, minBalance - balanceRange * 0.1);
    const yMax = maxBalance + balanceRange * 0.1;
    const minDD = Math.min(...ddData, 0);
    const ddAxisMin = minDD * 2.5;

    chart.setOption({
        backgroundColor: 'transparent',
        tooltip: { trigger: 'axis', backgroundColor: '#0d1d35', borderColor: color, textStyle: { color: '#fff', fontSize: 11 },
            formatter: params => {
                const eq = params.find(p => p.seriesName === 'Balance');
                const dd = params.find(p => p.seriesName === 'Drawdown');
                let html = `<strong>${eq ? eq.name : ''}</strong>`;
                if (eq) html += `<br/>Balance: <span style="color:${color};font-weight:bold">$${eq.value.toLocaleString()}</span>`;
                if (dd && dd.value < 0) html += `<br/>Drawdown: <span style="color:#ef4444;font-weight:bold">$${dd.value.toFixed(2)}</span>`;
                return html;
            }
        },
        legend: { show: false },
        grid: { left: 55, right: 15, top: 15, bottom: 25 },
        xAxis: { type: 'category', data: labels, axisLabel: { show: false }, axisLine: { lineStyle: { color: '#333' } } },
        yAxis: [
            { type: 'value', min: yMin, max: yMax, axisLabel: { color: '#888', fontSize: 10, formatter: val => `$${val.toLocaleString()}` }, splitLine: { lineStyle: { color: '#1a2a40' } }, axisLine: { show: false } },
            { type: 'value', min: ddAxisMin, max: 0, axisLabel: { show: false }, splitLine: { show: false }, axisLine: { show: false } }
        ],
        series: [
            { name: 'Balance', type: 'line', data: balanceData, lineStyle: { color, width: 2 }, itemStyle: { color },
              areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: color + '40' }, { offset: 1, color: color + '05' }] } }, symbol: 'none', smooth: true },
            { name: 'Drawdown', type: 'bar', yAxisIndex: 1, data: ddData, itemStyle: { color: '#ef444440' }, barWidth: '60%' }
        ]
    });
    window.addEventListener('resize', () => chart.resize());
}

function renderDailyPL(containerId, dailyPL, tradingDays) {
    const container = document.getElementById(containerId);
    if (!container || tradingDays.length === 0) return;
    if (chartInstances[containerId]) chartInstances[containerId].dispose();
    const chart = echarts.init(container, 'dark');
    chartInstances[containerId] = chart;
    const values = tradingDays.map(d => dailyPL[d].pl);
    const labels = tradingDays.map(d => { const p = d.split('/'); return `${p[0]}/${p[1]}`; });
    chart.setOption({
        backgroundColor: 'transparent',
        tooltip: { trigger: 'axis', backgroundColor: '#0d1d35', borderColor: '#34d399', textStyle: { color: '#fff', fontSize: 11 },
            formatter: params => `${params[0].axisValue}<br/>P&L: <strong style="color:${params[0].value >= 0 ? '#4ade80' : '#f87171'}">$${params[0].value.toFixed(2)}</strong>` },
        grid: { left: 50, right: 15, top: 15, bottom: 30 },
        xAxis: { type: 'category', data: labels, axisLabel: { color: '#888', fontSize: 10, rotate: 30 }, axisLine: { lineStyle: { color: '#333' } } },
        yAxis: { type: 'value', axisLabel: { color: '#888', fontSize: 10, formatter: '${value}' }, splitLine: { lineStyle: { color: '#1a2a40' } }, axisLine: { show: false } },
        series: [{ type: 'bar', data: values.map(v => ({ value: v, itemStyle: { color: v >= 0 ? '#4ade80' : '#f87171', borderRadius: v >= 0 ? [4, 4, 0, 0] : [0, 0, 4, 4] } })), barWidth: '50%' }]
    });
    window.addEventListener('resize', () => chart.resize());
}

function renderPLDistribution(containerId, plData, color) {
    const container = document.getElementById(containerId);
    if (!container || !plData || plData.length === 0) return;
    if (chartInstances[containerId]) chartInstances[containerId].dispose();
    const chart = echarts.init(container, 'dark');
    chartInstances[containerId] = chart;
    const min = Math.min(...plData), max = Math.max(...plData);
    const bucketSize = Math.max(Math.ceil((max - min) / 12), 10);
    const bucketStart = Math.floor(min / bucketSize) * bucketSize;
    const buckets = {};
    for (let b = bucketStart; b <= max + bucketSize; b += bucketSize) buckets[b] = 0;
    plData.forEach(v => { const b = Math.floor(v / bucketSize) * bucketSize; if (buckets[b] !== undefined) buckets[b]++; else buckets[b] = 1; });
    const labels = Object.keys(buckets).map(k => `$${parseInt(k)}`);
    const values = Object.values(buckets);
    const keys = Object.keys(buckets).map(k => parseInt(k));
    chart.setOption({
        backgroundColor: 'transparent',
        tooltip: { trigger: 'axis', backgroundColor: '#0d1d35', borderColor: color, textStyle: { color: '#fff', fontSize: 11 },
            formatter: params => { const idx = params[0].dataIndex; return `$${keys[idx]} to $${keys[idx] + bucketSize}<br/><strong>${params[0].value}</strong> trades`; } },
        grid: { left: 40, right: 15, top: 15, bottom: 35 },
        xAxis: { type: 'category', data: labels, axisLabel: { color: '#888', fontSize: 9, rotate: 45 }, axisLine: { lineStyle: { color: '#333' } } },
        yAxis: { type: 'value', axisLabel: { color: '#888', fontSize: 10 }, splitLine: { lineStyle: { color: '#1a2a40' } }, axisLine: { show: false } },
        series: [{ type: 'bar', data: values.map((v, i) => ({ value: v, itemStyle: { color: keys[i] >= 0 ? '#4ade80' : '#f87171', borderRadius: [3, 3, 0, 0] } })), barWidth: '70%' }]
    });
    window.addEventListener('resize', () => chart.resize());
}

function renderWeeklyTrend(containerId, weeklyPL, method) {
    const container = document.getElementById(containerId);
    if (!container || !weeklyPL) return;
    if (chartInstances[containerId]) chartInstances[containerId].dispose();
    const chart = echarts.init(container, 'dark');
    chartInstances[containerId] = chart;
    const weeks = Object.keys(weeklyPL).sort((a, b) => parseWeekKey(a) - parseWeekKey(b));
    const color = '#34d399';
    let cumPL = 0;
    const cumData = weeks.map(wk => { cumPL += weeklyPL[wk].pl; return cumPL; });
    const labels = weeks.map(wk => { const p = wk.split('/'); return `${p[0]}/${p[1]}`; });
    chart.setOption({
        backgroundColor: 'transparent',
        tooltip: { trigger: 'axis', backgroundColor: '#0d1d35', borderColor: color, textStyle: { color: '#fff', fontSize: 11 },
            formatter: params => {
                let r = `<strong>Week of ${getWeekRange(weeks[params[0].dataIndex])}</strong><br/>`;
                params.forEach(p => { if (p.seriesName === 'Weekly P&L') r += `Weekly: <span style="color:${p.value >= 0 ? '#4ade80' : '#f87171'};font-weight:bold">$${p.value.toFixed(2)}</span><br/>`; else r += `Cumulative: <span style="color:${color};font-weight:bold">$${p.value.toFixed(2)}</span>`; });
                return r;
            } },
        legend: { data: ['Weekly P&L', 'Cumulative'], textStyle: { color: '#888', fontSize: 10 }, top: 0, right: 0 },
        grid: { left: 55, right: 55, top: 30, bottom: 30 },
        xAxis: { type: 'category', data: labels, axisLabel: { color: '#888', fontSize: 10 }, axisLine: { lineStyle: { color: '#333' } } },
        yAxis: [
            { type: 'value', name: 'Weekly', nameTextStyle: { color: '#666', fontSize: 9 }, axisLabel: { color: '#888', fontSize: 10, formatter: '${value}' }, splitLine: { lineStyle: { color: '#1a2a40' } }, axisLine: { show: false } },
            { type: 'value', name: 'Cumul.', nameTextStyle: { color: '#666', fontSize: 9 }, axisLabel: { color: '#888', fontSize: 10, formatter: '${value}' }, splitLine: { show: false }, axisLine: { show: false } }
        ],
        series: [
            { name: 'Weekly P&L', type: 'bar', data: weeks.map(wk => ({ value: weeklyPL[wk].pl, itemStyle: { color: weeklyPL[wk].pl >= 0 ? '#4ade80' : '#f87171', borderRadius: weeklyPL[wk].pl >= 0 ? [3, 3, 0, 0] : [0, 0, 3, 3] } })), barWidth: '40%' },
            { name: 'Cumulative', type: 'line', yAxisIndex: 1, data: cumData, lineStyle: { color, width: 2 }, itemStyle: { color },
              areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: color + '30' }, { offset: 1, color: color + '05' }] } }, smooth: true, symbol: 'circle', symbolSize: 6 }
        ]
    });
    window.addEventListener('resize', () => chart.resize());
}

function renderEdgeTrendByWeek(containerId, allTrades, riskBudget, ppt, method, allTimeEV) {
    const container = document.getElementById(containerId);
    if (!container || !allTrades || allTrades.length === 0) return;
    if (chartInstances[containerId]) chartInstances[containerId].dispose();
    const chart = echarts.init(container, 'dark');
    chartInstances[containerId] = chart;
    const accentColor = '#34d399';
    const weeklyGroups = {};
    allTrades.forEach(t => { const wk = getWeekKey(t.date); if (!weeklyGroups[wk]) weeklyGroups[wk] = []; weeklyGroups[wk].push(t); });
    const weeks = Object.keys(weeklyGroups).sort((a, b) => parseWeekKey(a) - parseWeekKey(b));
    if (weeks.length < 1) return;
    const weeklyEV = weeks.map(wk => { const k = calculateKPIs(weeklyGroups[wk], riskBudget, ppt); return k ? k.evPlannedR : 0; });
    let cumTrades = [];
    const cumulativeEV = weeks.map(wk => { cumTrades = cumTrades.concat(weeklyGroups[wk]); const k = calculateKPIs(cumTrades, riskBudget, ppt); return k ? k.evPlannedR : 0; });
    const tradeCounts = weeks.map(wk => weeklyGroups[wk].length);
    const labels = weeks.map(wk => { const p = wk.split('/'); return `${p[0]}/${p[1]}`; });
    chart.setOption({
        backgroundColor: 'transparent',
        tooltip: { trigger: 'axis', backgroundColor: '#0d1d35', borderColor: accentColor, textStyle: { color: '#fff', fontSize: 11 },
            formatter: params => {
                const idx = params[0].dataIndex;
                let r = `<strong>Week of ${getWeekRange(weeks[idx])}</strong><br/><span style="color:#999">Trades: ${tradeCounts[idx]}</span><br/>`;
                params.forEach(p => { if (p.seriesName === 'Weekly Edge') { const c = p.value >= 0 ? '#4ade80' : '#f87171'; r += `Weekly EV: <span style="color:${c};font-weight:bold">${p.value >= 0 ? '+' : ''}${p.value.toFixed(1)}%R</span><br/>`; } else if (p.seriesName === 'Cumulative Edge') { r += `Cumulative EV: <span style="color:${accentColor};font-weight:bold">${p.value >= 0 ? '+' : ''}${p.value.toFixed(1)}%R</span>`; } });
                return r;
            } },
        legend: { data: ['Weekly Edge', 'Cumulative Edge', 'All-Time EV'], textStyle: { color: '#888', fontSize: 10 }, top: 0, right: 0 },
        grid: { left: 55, right: 55, top: 35, bottom: 30 },
        xAxis: { type: 'category', data: labels, axisLabel: { color: '#888', fontSize: 10, rotate: weeks.length > 10 ? 30 : 0 }, axisLine: { lineStyle: { color: '#333' } } },
        yAxis: [
            { type: 'value', name: 'Weekly %R', nameTextStyle: { color: '#666', fontSize: 9 }, axisLabel: { color: '#888', fontSize: 10, formatter: '{value}%' }, splitLine: { lineStyle: { color: '#1a2a40' } }, axisLine: { show: false } },
            { type: 'value', name: 'Cumul. %R', nameTextStyle: { color: '#666', fontSize: 9 }, axisLabel: { color: '#888', fontSize: 10, formatter: '{value}%' }, splitLine: { show: false }, axisLine: { show: false } }
        ],
        series: [
            { name: 'Weekly Edge', type: 'bar', data: weeklyEV.map(v => ({ value: parseFloat(v.toFixed(1)), itemStyle: { color: v >= 0 ? '#4ade80' : '#f87171', borderRadius: v >= 0 ? [3, 3, 0, 0] : [0, 0, 3, 3] } })), barWidth: '45%' },
            { name: 'Cumulative Edge', type: 'line', yAxisIndex: 1, data: cumulativeEV.map(v => parseFloat(v.toFixed(1))), lineStyle: { color: accentColor, width: 2 }, itemStyle: { color: accentColor },
              areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: accentColor + '30' }, { offset: 1, color: accentColor + '05' }] } }, smooth: true, symbol: 'circle', symbolSize: 6 },
            { name: 'All-Time EV', type: 'line', yAxisIndex: 0, data: weeks.map(() => parseFloat(allTimeEV.toFixed(1))), lineStyle: { color: '#fff', width: 1.5, type: 'dashed' }, itemStyle: { color: '#fff' }, symbol: 'none', silent: true }
        ]
    });
    window.addEventListener('resize', () => chart.resize());
    const noteEl = document.getElementById(`edge-trend-${method}-note`);
    if (noteEl) {
        const avgWT = (allTrades.length / weeks.length).toFixed(1);
        const posW = weeklyEV.filter(v => v > 0).length;
        noteEl.textContent = `${weeks.length} weeks · ${posW} positive (${(posW / weeks.length * 100).toFixed(0)}%) · avg ${avgWT} trades/week · dashed = all-time EV (${allTimeEV >= 0 ? '+' : ''}${allTimeEV.toFixed(1)}%R)`;
    }
}

// ===== MONTHLY SUMMARY TABLE =====
function renderMonthlySummary(containerId, allTrades, riskBudget, ppt, startingBalance) {
    const container = document.getElementById(containerId);
    if (!container || !allTrades || allTrades.length === 0) return;
    const monthlyData = {};
    allTrades.forEach(t => { const mk = getMonthKey(t.date); if (!monthlyData[mk]) monthlyData[mk] = []; monthlyData[mk].push(t); });
    const months = Object.keys(monthlyData).sort();
    let cumPL = 0;
    let html = `<table class="w-full text-xs"><thead><tr>
        <th class="text-left text-gray-400 font-bold px-2 py-2 border-b border-gray-700/30">Month</th>
        <th class="text-right text-gray-400 font-bold px-2 py-2 border-b border-gray-700/30">Trades</th>
        <th class="text-right text-gray-400 font-bold px-2 py-2 border-b border-gray-700/30">W/L</th>
        <th class="text-right text-gray-400 font-bold px-2 py-2 border-b border-gray-700/30">Win%</th>
        <th class="text-right text-gray-400 font-bold px-2 py-2 border-b border-gray-700/30">P&L</th>
        <th class="text-right text-gray-400 font-bold px-2 py-2 border-b border-gray-700/30">Return</th>
        <th class="text-right text-gray-400 font-bold px-2 py-2 border-b border-gray-700/30">EV(%R)</th>
        <th class="text-right text-gray-400 font-bold px-2 py-2 border-b border-gray-700/30">PF</th>
        <th class="text-right text-gray-400 font-bold px-2 py-2 border-b border-gray-700/30">Cumulative</th>
    </tr></thead><tbody>`;
    for (const mk of months) {
        const mK = calculateKPIs(monthlyData[mk], riskBudget, ppt, startingBalance);
        cumPL += mK.netPL;
        const parts = mk.split('/');
        const monthName = new Date(parseInt(parts[1]), parseInt(parts[0]) - 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
        const plC = mK.netPL >= 0 ? 'text-green-400' : 'text-red-400';
        const cumC = cumPL >= 0 ? 'text-green-400' : 'text-red-400';
        html += `<tr class="hover:bg-emerald-500/5 transition-colors">
            <td class="text-white font-semibold px-2 py-2.5 border-b border-gray-700/20">${monthName}</td>
            <td class="text-gray-300 text-right px-2 py-2.5 border-b border-gray-700/20">${mK.totalTrades}</td>
            <td class="text-gray-300 text-right px-2 py-2.5 border-b border-gray-700/20"><span class="text-green-400">${mK.winCount}</span>/<span class="text-red-400">${mK.lossCount}</span></td>
            <td class="text-gray-300 text-right px-2 py-2.5 border-b border-gray-700/20">${mK.winRate.toFixed(0)}%</td>
            <td class="${plC} font-semibold text-right px-2 py-2.5 border-b border-gray-700/20">${mK.netPL >= 0 ? '+' : ''}$${mK.netPL.toFixed(2)}</td>
            <td class="${plC} text-right px-2 py-2.5 border-b border-gray-700/20">${fmtPct(mK.returnPct)}</td>
            <td class="text-right px-2 py-2.5 border-b border-gray-700/20" style="color:${mK.evPlannedR >= 0 ? '#4ade80' : '#f87171'}">${mK.evPlannedR >= 0 ? '+' : ''}${mK.evPlannedR.toFixed(1)}%</td>
            <td class="text-gray-300 text-right px-2 py-2.5 border-b border-gray-700/20">${mK.profitFactor === Infinity ? '∞' : mK.profitFactor.toFixed(2)}</td>
            <td class="${cumC} font-semibold text-right px-2 py-2.5 border-b border-gray-700/20">${cumPL >= 0 ? '+' : ''}$${cumPL.toFixed(2)}</td>
        </tr>`;
    }
    html += '</tbody></table>';
    container.innerHTML = html;
}

// ===== INCEPTION SUMMARY =====
function renderInceptionSummary(method, allK) {
    const container = document.getElementById(`inception-${method}`);
    if (!container || !allK) return;
    const weeks = Object.keys(allK.weeklyPL).sort();
    const bestWeek = weeks.reduce((best, wk) => allK.weeklyPL[wk].pl > (allK.weeklyPL[best]?.pl || -Infinity) ? wk : best, weeks[0]);
    const worstWeek = weeks.reduce((worst, wk) => allK.weeklyPL[wk].pl < (allK.weeklyPL[worst]?.pl || Infinity) ? wk : worst, weeks[0]);
    container.innerHTML = `
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div class="bg-green-900/10 border border-green-500/20 rounded-lg p-3 text-center">
                <p class="text-[10px] text-green-400 font-bold">TOTAL P&L</p>
                <p class="text-lg font-bold ${allK.netPL >= 0 ? 'text-green-400' : 'text-red-400'}">${allK.netPL >= 0 ? '+' : ''}${fmtDollar(allK.netPL)}</p>
                <p class="text-[10px] text-gray-500">${fmtPct(allK.returnPct)} return</p>
            </div>
            <div class="bg-emerald-900/10 border border-emerald-500/20 rounded-lg p-3 text-center">
                <p class="text-[10px] text-emerald-400 font-bold">TOTAL TRADES</p>
                <p class="text-lg font-bold text-white">${allK.totalTrades}</p>
                <p class="text-[10px] text-gray-500">${weeks.length} weeks</p>
            </div>
            <div class="bg-green-900/10 border border-green-500/20 rounded-lg p-3 text-center">
                <p class="text-[10px] text-green-400 font-bold">BEST WEEK</p>
                <p class="text-lg font-bold text-green-400">+${fmtDollar(allK.weeklyPL[bestWeek]?.pl || 0)}</p>
                <p class="text-[10px] text-gray-500">${getWeekRange(bestWeek)}</p>
            </div>
            <div class="bg-red-900/10 border border-red-500/20 rounded-lg p-3 text-center">
                <p class="text-[10px] text-red-400 font-bold">WORST WEEK</p>
                <p class="text-lg font-bold text-red-400">${fmtDollar(allK.weeklyPL[worstWeek]?.pl || 0)}</p>
                <p class="text-[10px] text-gray-500">${getWeekRange(worstWeek)}</p>
            </div>
        </div>`;
}

// ===== GROWTH COMPARISON CHART =====
function computeAnnualRFromAllTrades(method) {
    const trades = state[method].allTrades;
    if (!trades || trades.length === 0) return 0;
    const kpis = calculateKPIs(trades, TENX_RISK, TENX_PPT, TENX_STARTING_BALANCE);
    if (!kpis || kpis.totalTrades < 1) return 0;
    const evR = kpis.evPlannedR / 100;
    const tradingDays = kpis.tradingDays.length || 1;
    return evR * (kpis.totalTrades / tradingDays) * 21 * 12;
}

function monteCarloMaxDD(method, { simulations = 5000, percentile = 95 } = {}) {
    const trades = state[method].allTrades;
    if (!trades || trades.length < 5) return null;
    const kpis = calculateKPIs(trades, TENX_RISK, TENX_PPT, TENX_STARTING_BALANCE);
    if (!kpis || kpis.totalTrades < 5) return null;
    const outcomesR = trades.map(t => t.dollarPL / TENX_RISK);
    const tradesPerYear = Math.round((kpis.totalTrades / (kpis.tradingDays.length || 1)) * 252);
    let seed = 42;
    const rand = () => { seed = (seed * 1664525 + 1013904223) & 0xFFFFFFFF; return (seed >>> 0) / 0xFFFFFFFF; };
    const maxDDs = [];
    for (let sim = 0; sim < simulations; sim++) {
        let cumR = 0, peakR = 0, maxDDR = 0;
        for (let t = 0; t < tradesPerYear; t++) {
            cumR += outcomesR[Math.floor(rand() * outcomesR.length)];
            if (cumR > peakR) peakR = cumR;
            const dd = peakR - cumR;
            if (dd > maxDDR) maxDDR = dd;
        }
        maxDDs.push(maxDDR);
    }
    maxDDs.sort((a, b) => a - b);
    const ddR = maxDDs[Math.floor(simulations * (percentile / 100))];
    return { percentile, simulations, tradesPerYear, sampleSize: outcomesR.length, ddR, ddPct: (ddR * TENX_RISK / TENX_STARTING_BALANCE) * 100, ddDollars: ddR * TENX_RISK };
}

function renderGrowthComparisonFromState(containerId, suffix) {
    renderGrowthComparison(containerId, suffix);
}

function renderGrowthComparison(containerId, suffix) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const setT = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };
    const setH = (id, val) => { const e = document.getElementById(id); if (e) e.innerHTML = val; };
    const trades = state.tenx.allTrades;
    const startBalance = TENX_STARTING_BALANCE;

    const chartKey = `growth-${suffix}`;
    if (chartInstances[chartKey]) chartInstances[chartKey].dispose();
    const chart = echarts.init(container);
    chartInstances[chartKey] = chart;

    if (!trades || trades.length === 0) {
        chart.setOption({ backgroundColor: 'transparent', graphic: [{ type: 'text', left: 'center', top: 'middle', style: { text: 'Upload trade data to see performance', fill: '#6b7280', fontSize: 13 } }] });
        return;
    }

    const sorted = [...trades].sort((a, b) => new Date(a.exitTime || a.datetime) - new Date(b.exitTime || b.datetime));
    const fmtDate = (dt) => new Date(dt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
    const parseMs = (dt) => new Date(dt).getTime();
    const firstMs = parseMs(sorted[0].exitTime || sorted[0].datetime);

    const equityLabels = ['Start'];
    const equityValues = [startBalance];
    const tradeLabels = ['—'];

    let balance = startBalance;
    sorted.forEach(t => {
        balance = parseFloat((balance + t.dollarPL).toFixed(2));
        equityLabels.push(fmtDate(t.exitTime || t.datetime));
        equityValues.push(balance);
        tradeLabels.push(`${t.direction || ''} ${t.dollarPL >= 0 ? '+' : ''}$${t.dollarPL.toFixed(0)}`);
    });

    const spyDailyRate = Math.pow(1.146, 1 / 365) - 1;
    const spyValues = equityValues.map((_, i) => {
        if (i === 0) return startBalance;
        const tradeMs = parseMs(sorted[i - 1].exitTime || sorted[i - 1].datetime);
        return parseFloat((startBalance * Math.pow(1 + spyDailyRate, (tradeMs - firstMs) / 86400000)).toFixed(2));
    });

    const finalBalance = equityValues[equityValues.length - 1];
    const finalSpy = spyValues[spyValues.length - 1];
    const returnPct = ((finalBalance - startBalance) / startBalance * 100);
    const spyReturnPct = ((finalSpy - startBalance) / startBalance * 100);
    const fmtBal = (v) => `$${v.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;

    setH(`growth-spy-${suffix}`, `$10K → ${fmtBal(finalSpy)} <span style="color:#9ca3af;font-size:9px;">(+${spyReturnPct.toFixed(1)}%)</span>`);
    setH(`growth-tenx-${suffix}`, `$10K → ${fmtBal(finalBalance)} <span style="${returnPct >= 0 ? 'color:#34d399' : 'color:#f87171'};font-size:9px;">(${returnPct >= 0 ? '+' : ''}${returnPct.toFixed(1)}%)</span>`);

    const ratioEl = document.getElementById(`growth-ratio-${suffix}`);
    if (ratioEl) {
        if (finalSpy > 0 && finalBalance !== startBalance) {
            ratioEl.textContent = finalBalance >= finalSpy ? `×${(finalBalance / finalSpy).toFixed(1)} vs S&P 500 same period` : 'tracking below S&P 500 so far';
        } else ratioEl.textContent = 'vs S&P 500 same period';
    }

    const mc = monteCarloMaxDD('tenx');
    if (mc) setH(`growth-dd-tenx-${suffix}`, `<i class="fas fa-dice mr-0.5"></i>Est. Max DD: <strong>${mc.ddPct.toFixed(1)}%</strong> <span style="color:#6b7280;font-size:8px;">(Monte Carlo 95th %ile · ${mc.simulations.toLocaleString()} sims · ${mc.sampleSize} trades)</span>`);

    setH(`growth-subtitle-${suffix}`, `Actual realized P&L on <strong style="color:#34d399;">$10,000</strong> account · <strong style="color:#34d399;">${trades.length} trades</strong> · ${fmtDate(sorted[0].exitTime || sorted[0].datetime)} to ${fmtDate(sorted[sorted.length - 1].exitTime || sorted[sorted.length - 1].datetime)}`);

    const allVals = [...equityValues, ...spyValues];
    const pad = (Math.max(...allVals) - Math.min(...allVals)) * 0.1 || startBalance * 0.05;
    const yMin = Math.floor((Math.min(...allVals) - pad) / 100) * 100;
    const yMax = Math.ceil((Math.max(...allVals) + pad) / 100) * 100;

    chart.setOption({
        backgroundColor: 'transparent',
        tooltip: { trigger: 'axis', backgroundColor: 'rgba(10, 22, 40, 0.95)', borderColor: 'rgba(52, 211, 153, 0.3)', textStyle: { color: '#fff', fontSize: 11 },
            formatter: function(params) {
                const i = params[0].dataIndex;
                let html = `<div style="font-weight:bold;margin-bottom:4px;">${equityLabels[i]}${tradeLabels[i] !== '—' ? ' · ' + tradeLabels[i] : ''}</div>`;
                params.forEach(p => { const diff = p.data - startBalance; html += `<div style="display:flex;justify-content:space-between;gap:16px;"><span>${p.marker} ${p.seriesName}</span><span style="font-weight:bold;">${fmtBal(p.data)} <span style="color:#9ca3af;font-size:9px;">${diff >= 0 ? '+' : ''}$${Math.abs(diff).toFixed(0)}</span></span></div>`; });
                return html;
            } },
        legend: { data: ['S&P 500 (same period)', 'Ekantik Accelerator (actual)'], top: 0, textStyle: { color: '#9ca3af', fontSize: 10 }, itemWidth: 12, itemHeight: 8 },
        grid: { top: 35, right: 20, bottom: 40, left: 75 },
        xAxis: { type: 'category', data: equityLabels, axisLine: { lineStyle: { color: '#374151' } }, axisTick: { show: false },
            axisLabel: { color: '#6b7280', fontSize: 9, interval: Math.max(0, Math.floor(equityLabels.length / 6) - 1), rotate: equityLabels.length > 10 ? 30 : 0 } },
        yAxis: { type: 'value', min: yMin, max: yMax, axisLine: { show: false }, axisTick: { show: false },
            splitLine: { lineStyle: { color: '#1f2937', type: 'dashed' } },
            axisLabel: { color: '#6b7280', fontSize: 9, formatter: (v) => `$${v >= 1000 ? (v / 1000).toFixed(1) + 'K' : v}` } },
        series: [
            { name: 'S&P 500 (same period)', type: 'line', data: spyValues, smooth: true, symbol: 'none', lineStyle: { color: '#6b7280', width: 1.5, type: 'dashed' } },
            { name: 'Ekantik Accelerator (actual)', type: 'line', data: equityValues, smooth: false, symbol: 'circle', symbolSize: 5,
              lineStyle: { color: '#34d399', width: 2.5 }, itemStyle: { color: '#34d399' },
              areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: 'rgba(52, 211, 153, 0.15)' }, { offset: 1, color: 'rgba(52, 211, 153, 0.01)' }]) },
              markLine: { silent: true, data: [{ yAxis: startBalance }], lineStyle: { color: '#374151', type: 'dashed', width: 1 }, label: { formatter: '$10K', color: '#6b7280', fontSize: 9, position: 'start' }, symbol: 'none' } }
        ]
    });
    window.addEventListener('resize', () => chart.resize());
}

// ===== FOOD CHAIN =====
function renderFoodChain(method, k, allK, allTrades) {
    const prefix = 'txfc';
    const containerId = 'foodchain-tenx';
    const container = document.getElementById(containerId);
    if (!container || !allK || allK.totalTrades < 1) { if (container) container.classList.add('hidden'); return; }
    container.classList.remove('hidden');

    const accentColor = '#34d399';
    const edgeR = allK.evPlannedR;
    const winRate = allK.winRate;
    const avgWin = allK.avgWinDollar;
    const avgLoss = Math.abs(allK.avgLossDollar);
    const rr = avgLoss > 0 ? avgWin / avgLoss : 0;
    const tradingDays = allK.tradingDays.length || 1;
    const tradesPerMonth = (allK.totalTrades / tradingDays) * 21;
    const evR = edgeR / 100;
    const annualR = evR * tradesPerMonth * 12;
    const edgeSign = edgeR >= 0 ? '+' : '';
    const el = (id) => document.getElementById(id);
    const setEl = (id, val) => { const e = el(id); if (e) e.textContent = val; };
    const setHTML = (id, val) => { const e = el(id); if (e) e.innerHTML = val; };

    setEl(`${prefix}-period-label`, '(All-Time)');
    const lastTradeDate = getLastTradeDate(allTrades) || 'latest upload';

    // Food chain table
    renderFoodChainTable(prefix, method, edgeR, tradesPerMonth, annualR, 'All-Time', accentColor, winRate, rr);

    // Summary callout
    setHTML(`${prefix}-summary-text`,
        `<strong style="color:${accentColor}">Ekantik Accelerator (MES/ES)</strong> · All-Time: ` +
        `<strong>${edgeSign}${edgeR.toFixed(1)}%R</strong> edge/trade × ` +
        `<strong>${Math.round(tradesPerMonth)}</strong> trades/mo × 12 = ` +
        `<strong style="color:${accentColor}">≈${annualR.toFixed(0)} R/year</strong>`);

    // Formula elements
    const winRateDec = winRate / 100;
    const lossRateDec = 1 - winRateDec;
    const avgWinR = TENX_RISK > 0 ? avgWin / TENX_RISK : 0;
    const avgLossR = TENX_RISK > 0 ? avgLoss / TENX_RISK : 0;
    setEl(`${prefix}-win-rate`, `${winRate.toFixed(1)}%`);
    setEl(`${prefix}-ev-result`, `${edgeSign}${edgeR.toFixed(1)}%R`);
    setEl(`${prefix}-formula-line1`, `EV = (${(winRateDec * 100).toFixed(0)}% × ${avgWinR.toFixed(2)}R) − (${(lossRateDec * 100).toFixed(0)}% × ${avgLossR.toFixed(2)}R)`);
    setEl(`${prefix}-formula-line2`, `EV = ${(winRateDec * avgWinR).toFixed(3)}R − ${(lossRateDec * avgLossR).toFixed(3)}R`);
    setEl(`${prefix}-formula-result`, `EV = ${edgeSign}${(edgeR / 100).toFixed(3)}R per trade (${edgeSign}${edgeR.toFixed(1)}%R)`);

    if (edgeR > 0) {
        setEl(`${prefix}-why-magnitude`, `Your ${edgeSign}${edgeR.toFixed(1)}%R edge is ${(edgeR / 5.26).toFixed(1)}× a casino's roulette edge.`);
    } else {
        setEl(`${prefix}-why-magnitude`, `Edge is ${edgeSign}${edgeR.toFixed(1)}%R — focus on risk:reward and consistency.`);
    }
    setEl(`${prefix}-why-frequency`, `E[Profit] ≈ ${evR.toFixed(3)}R × (${Math.round(tradesPerMonth)} × 12) ≈ ${annualR.toFixed(0)} R`);

    renderFoodChainChart(`${prefix}-position-chart`, allK, method);
}

function renderFoodChainTable(prefix, method, edgeR, tradesPerMonth, annualR, periodLabel, accentColor, winRate, rr) {
    const tbody = document.getElementById(`${prefix}-table-body`);
    if (!tbody) return;
    const edgeSign = edgeR >= 0 ? '+' : '';
    const userKelly = (rr > 0 && winRate > 0) ? ((winRate / 100) - ((1 - winRate / 100) / rr)) * 100 : 0;
    const benchmarks = [
        { name: 'Casino – American Roulette', edge: '+5.26%', trades: '≥2,400', annualR: 1500, annualRLabel: '≈1,500 R', kelly: '2.7%', isYou: false },
        { name: 'High-Frequency Market-Making', edge: '+0.017%', trades: '≈100,000+', annualR: 26, annualRLabel: '≈26 R', kelly: '~0.01%', isYou: false },
        { name: 'Stat-Arb Pairs / Baskets', edge: '+0.5–2%', trades: '200–500', annualR: 42, annualRLabel: '≈42 R', kelly: '3–8%', isYou: false },
        { name: 'Trend-Following CTAs', edge: '+0.5–1%', trades: '10–30', annualR: 56, annualRLabel: '≈56 R', kelly: '5–15%', isYou: false },
        { name: 'Retail Day-Trader (median)', edge: 'negative', trades: '500+', annualR: -30, annualRLabel: '−30 R', kelly: '0%', isYou: false },
        { name: 'Ekantik Accelerator Strategy', edge: `${edgeSign}${edgeR.toFixed(1)}%R`, trades: `≈${Math.round(tradesPerMonth)}`, annualR, annualRLabel: `≈${annualR.toFixed(0)} R`, kelly: userKelly > 0 ? `${userKelly.toFixed(1)}%` : 'N/A', isYou: true, periodLabel }
    ];
    benchmarks.sort((a, b) => b.annualR - a.annualR);
    let html = '';
    benchmarks.forEach(b => {
        if (b.isYou) {
            html += `<tr style="border: 2px solid ${accentColor}99; background: ${accentColor}14;">
                <td style="color: ${accentColor}" class="font-bold px-3 py-2.5 border-b border-gray-700/20"><i class="fas fa-rocket mr-1"></i>${b.name} <span class="text-[10px] font-normal" style="color: #9ca3af">(${b.periodLabel})</span></td>
                <td style="color: ${accentColor}" class="font-bold text-right px-3 py-2.5 border-b border-gray-700/20">${b.edge}</td>
                <td style="color: ${accentColor}" class="font-bold text-right px-3 py-2.5 border-b border-gray-700/20">${b.trades}</td>
                <td style="color: ${accentColor}" class="font-bold text-right px-3 py-2.5 border-b border-gray-700/20">${b.annualRLabel}</td>
                <td style="color: ${accentColor}" class="font-bold text-right px-3 py-2.5 border-b border-gray-700/20">${b.kelly}</td></tr>`;
        } else {
            const ec = b.annualR >= 0 ? '#4ade80' : '#f87171';
            const ac = b.annualR >= 0 ? '#d1d5db' : '#f87171';
            html += `<tr class="hover:bg-white/5"><td class="px-3 py-2 border-b border-gray-700/20" style="color: #d1d5db">${b.name}</td><td class="text-right px-3 py-2 border-b border-gray-700/20" style="color: ${ec}">${b.edge}</td><td class="text-right px-3 py-2 border-b border-gray-700/20" style="color: #9ca3af">${b.trades}</td><td class="text-right px-3 py-2 border-b border-gray-700/20" style="color: ${ac}">${b.annualRLabel}</td><td class="text-right px-3 py-2 border-b border-gray-700/20" style="color: #9ca3af">${b.kelly}</td></tr>`;
        }
    });
    tbody.innerHTML = html;
}

function renderFoodChainChart(containerId, k, method) {
    const container = document.getElementById(containerId);
    if (!container) return;
    if (chartInstances[containerId]) { chartInstances[containerId].dispose(); delete chartInstances[containerId]; }
    const chart = echarts.init(container);
    chartInstances[containerId] = chart;
    const edgeR = k.evPlannedR;
    const accentColor = '#34d399';
    const benchmarks = [
        { name: 'Retail Day-Trader', edge: -2.5, color: '#ef4444' },
        { name: 'HFT Market-Making', edge: 0.017, color: '#6b7280' },
        { name: 'Stat-Arb', edge: 1.25, color: '#6b7280' },
        { name: 'Trend-Following CTAs', edge: 0.75, color: '#6b7280' },
        { name: 'Casino Roulette', edge: 5.26, color: '#9ca3af' },
        { name: 'Ekantik Accelerator', edge: edgeR, color: accentColor }
    ];
    benchmarks.sort((a, b) => a.edge - b.edge);
    chart.setOption({
        backgroundColor: 'transparent',
        tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: params => `<strong>${params[0].name}</strong><br/>Edge: ${params[0].value >= 0 ? '+' : ''}${params[0].value.toFixed(2)}%R`, backgroundColor: '#1a2744', borderColor: 'rgba(52,211,153,0.3)', textStyle: { color: '#e5e7eb', fontSize: 11 } },
        grid: { left: '2%', right: '12%', top: '8%', bottom: '5%', containLabel: true },
        xAxis: { type: 'value', axisLine: { lineStyle: { color: 'rgba(255,255,255,0.1)' } }, axisLabel: { color: '#9ca3af', fontSize: 10, formatter: v => `${v >= 0 ? '+' : ''}${v}%` }, splitLine: { lineStyle: { color: 'rgba(255,255,255,0.04)' } } },
        yAxis: { type: 'category', data: benchmarks.map(b => b.name), axisLine: { show: false }, axisTick: { show: false },
            axisLabel: { color: '#d1d5db', fontSize: 10, formatter: name => name.includes('Ekantik') ? `{highlight|${name}}` : name, rich: { highlight: { color: accentColor, fontWeight: 'bold', fontSize: 11 } } } },
        series: [{ type: 'bar', data: benchmarks.map(b => ({ value: b.edge, itemStyle: { color: b.color, borderRadius: b.edge >= 0 ? [0, 4, 4, 0] : [4, 0, 0, 4], ...(b.name.includes('Ekantik') ? { shadowColor: accentColor + '60', shadowBlur: 12 } : {}) } })), barWidth: '55%',
            label: { show: true, position: 'right', color: '#d1d5db', fontSize: 10, formatter: p => `${p.value >= 0 ? '+' : ''}${p.value.toFixed(p.value === Math.round(p.value) ? 0 : 2)}%` } }]
    });
    window.addEventListener('resize', () => chart.resize());
}

// ===== TRADE LOG =====
function renderTenxTradeLog(tbodyId, trades) {
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;
    tbody.innerHTML = trades.map((t, i) => {
        const dirLabel = t.direction === 'Short' ? 'S' : 'L';
        const dirColor = t.direction === 'Short' ? 'text-red-400' : 'text-emerald-400';
        const plColor = t.dollarPL > 0 ? 'text-green-400' : t.dollarPL < 0 ? 'text-red-400' : 'text-gray-400';
        const badge = t.isWin ? '<span class="bg-green-500/20 text-green-400 px-1.5 py-0.5 rounded text-[10px] font-bold">W</span>' : '<span class="bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded text-[10px] font-bold">L</span>';
        return `<tr class="hover:bg-emerald-500/5 transition-colors">
            <td class="text-gray-300 text-[11px]">${t.entryTime || ''}</td>
            <td class="text-gray-500 text-[11px]">${i + 1}</td>
            <td class="${dirColor} text-[11px] font-semibold">${dirLabel}</td>
            <td class="text-gray-300 text-[11px]">${t.entryPrice.toFixed(2)}</td>
            <td class="text-gray-400 text-[11px]">${t.stopPrice ? t.stopPrice.toFixed(2) : '—'}</td>
            <td class="text-gray-400 text-[11px]">${t.contracts || 1}</td>
            <td class="${plColor} text-[11px]">${t.pointsPL >= 0 ? '+' : ''}${t.pointsPL.toFixed(2)}</td>
            <td class="text-gray-400 text-[11px]">${t.riskPoints ? t.riskPoints.toFixed(1) : '—'}</td>
            <td class="${plColor} text-[11px] font-semibold">${t.dollarPL >= 0 ? '+' : ''}$${t.dollarPL.toFixed(2)}</td>
            <td>${badge}</td>
        </tr>`;
    }).join('');
}

// ===== TRADE LOG FILTER + SORT =====
const tradeLogState = { tenx: { filter: 'all', sortCol: null, sortDir: 1 } };

function filterTradeLog(method, filter) {
    tradeLogState[method].filter = filter;
    ['all', 'win', 'loss', 'long', 'short'].forEach(f => {
        const btn = document.getElementById(`${method}-filter-${f}`);
        if (!btn) return;
        btn.className = f === filter
            ? 'trade-filter-btn trade-filter-active-emerald px-2.5 py-1 rounded text-[10px] border border-transparent'
            : 'trade-filter-btn px-2.5 py-1 rounded text-[10px] font-semibold bg-[#0d1d35] text-gray-400 border border-gray-700';
    });
    _rerenderTradeLog(method);
}

function sortTradeLog(method, col) {
    const s = tradeLogState[method];
    if (s.sortCol === col) s.sortDir *= -1;
    else { s.sortCol = col; s.sortDir = -1; }
    ['pts','pl'].forEach(c => { const el = document.getElementById(`${method}-sort-${c}`); if (el) el.className = ''; });
    const indicator = document.getElementById(`${method}-sort-${col}`);
    if (indicator) indicator.className = s.sortDir === 1 ? 'sort-asc' : 'sort-desc';
    _rerenderTradeLog(method);
}

function _rerenderTradeLog(method) {
    const s = tradeLogState[method];
    const allTrades = state[method]?.periodTrades || state[method]?.allTrades || [];
    let filtered = allTrades;
    switch (s.filter) {
        case 'win': filtered = allTrades.filter(t => t.isWin); break;
        case 'loss': filtered = allTrades.filter(t => !t.isWin); break;
        case 'long': filtered = allTrades.filter(t => { const d = (t.direction || '').toLowerCase(); return !d.includes('sell') && !d.includes('short'); }); break;
        case 'short': filtered = allTrades.filter(t => { const d = (t.direction || '').toLowerCase(); return d.includes('sell') || d.includes('short'); }); break;
    }
    let sorted = filtered;
    if (s.sortCol) {
        sorted = [...filtered].sort((a, b) => {
            let va, vb;
            switch (s.sortCol) {
                case 'pts': va = a.pointsPL ?? 0; vb = b.pointsPL ?? 0; break;
                case 'pl': va = a.dollarPL ?? 0; vb = b.dollarPL ?? 0; break;
                default: return 0;
            }
            return (va - vb) * s.sortDir;
        });
    }
    const label = document.getElementById(`${method}-filter-label`);
    if (label) label.textContent = filtered.length !== allTrades.length ? `${sorted.length} of ${allTrades.length} trades` : (s.sortCol ? `${sorted.length} trades` : '');
    renderTenxTradeLog('tenx-trades-body', sorted);
}

function resetTradeLogFilter(method) {
    tradeLogState[method] = { filter: 'all', sortCol: null, sortDir: 1 };
    ['all','win','loss','long','short'].forEach(f => {
        const btn = document.getElementById(`${method}-filter-${f}`);
        if (!btn) return;
        btn.className = f === 'all'
            ? 'trade-filter-btn trade-filter-active-emerald px-2.5 py-1 rounded text-[10px] border border-transparent'
            : 'trade-filter-btn px-2.5 py-1 rounded text-[10px] font-semibold bg-[#0d1d35] text-gray-400 border border-gray-700';
    });
    ['pts','pl'].forEach(c => { const el = document.getElementById(`${method}-sort-${c}`); if (el) el.className = ''; });
    const label = document.getElementById(`${method}-filter-label`);
    if (label) label.textContent = '';
}

// ===== EXPORT =====
function showExportButton(method) {
    const btn = document.getElementById(`export-btn-${method}`);
    if (btn) btn.classList.remove('hidden');
}

function exportTenxData() {
    const rawCSV = localStorage.getItem('tenx-raw-csv');
    if (rawCSV) { downloadFile(rawCSV, 'tenx_orders.csv', 'text/csv'); return; }
    const trades = state.tenx.allTrades;
    if (!trades || trades.length === 0) { alert('No data to export.'); return; }
    downloadFile(JSON.stringify(trades, null, 2), 'tenx_trades.json', 'application/json');
}

function downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// ===== SYNC STATUS =====
function recordSyncTime(method) {
    const ts = Date.now();
    try { localStorage.setItem(`${method}-sync-time`, ts.toString()); } catch(e) {}
    updateSyncStatus(method, ts);
}

function updateSyncStatus(method, ts) {
    const stored = ts || parseInt(localStorage.getItem(`${method}-sync-time`) || '0');
    const el = document.getElementById(`sync-status-${method}`);
    const textEl = document.getElementById(`sync-status-${method}-text`);
    if (!el || !textEl || !stored) return;
    function fmt(ms) {
        const secs = Math.floor((Date.now() - ms) / 1000);
        if (secs < 60) return 'just now';
        if (secs < 3600) return `${Math.floor(secs/60)} min ago`;
        if (secs < 86400) return `${Math.floor(secs/3600)}h ago`;
        return new Date(ms).toLocaleDateString();
    }
    el.classList.remove('hidden');
    textEl.textContent = `Synced to GitHub ${fmt(stored)}`;
    clearInterval(el._syncInterval);
    el._syncInterval = setInterval(() => { textEl.textContent = `Synced to GitHub ${fmt(stored)}`; }, 60000);
}

// ===== SKELETON LOADERS =====
function showSkeletonKPIs() {
    ['tenx-hero-pnl','tenx-hero-return','tenx-hero-ev','tenx-hero-wr','tenx-hero-pf','tenx-hero-dd','tenx-hero-mespts'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = '<span class="skeleton skeleton-text-lg">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span>';
    });
}

// ===== INITIALIZATION =====
document.addEventListener('DOMContentLoaded', async function () {
    updateGitHubSyncIndicators();
    updateSyncStatus('tenx');
    showSkeletonKPIs();

    // Admin param check
    if (new URLSearchParams(window.location.search).has('admin')) {
        document.querySelectorAll('.admin-only').forEach(el => el.style.display = '');
    }

    // Load tenx trades
    let loaded = false;
    const savedTenx = localStorage.getItem('tenx-trades');
    if (savedTenx) {
        try {
            state.tenx.allTrades = JSON.parse(savedTenx);
            const weeks = getWeeksList(state.tenx.allTrades);
            state.tenx.selectedWeek = weeks[0];
            populateWeekSelector('tenx', weeks);
            refreshDashboard('tenx');
            loaded = true;
            showExportButton('tenx');
        } catch (e) { console.error('Error loading tenx data:', e); }
    }

    // Background DB sync
    if (loaded && state.tenx.allTrades.length > 0) {
        (async () => {
            try {
                const lsTrades = state.tenx.allTrades;
                const dbRows = await DB.loadTrades('tenx_trades');
                const norm = v => Math.round(parseFloat(v) * 10000) / 10000;
                const dbKeys = new Set(dbRows.map(r => `${r.entry_time}|${r.exit_time}|${r.direction}|${norm(r.dollar_pl)}`));
                const needsSync = lsTrades.filter(t => !dbKeys.has(`${t.entryTime}|${t.exitTime}|${t.direction}|${norm(t.dollarPL)}`));
                if (needsSync.length > 0) {
                    await DB.saveTrades('tenx_trades', needsSync, `tenx-sync-${Date.now()}`);
                    recordSyncTime('tenx');
                }
            } catch (e) { console.warn('[DB sync] tenx background sync failed:', e); }
        })();
    }

    if (!loaded) {
        try {
            const dbTrades = await DB.loadTrades('tenx_trades');
            if (dbTrades.length > 0) {
                const seenKeys = new Set();
                const unique = dbTrades.filter(row => {
                    const key = `${row.entry_time}|${row.direction}|${row.dollar_pl}`;
                    if (seenKeys.has(key)) return false;
                    seenKeys.add(key); return true;
                });
                state.tenx.allTrades = unique.map(dbRowToTenxTrade);
                const weeks = getWeeksList(state.tenx.allTrades);
                state.tenx.selectedWeek = weeks[0];
                populateWeekSelector('tenx', weeks);
                refreshDashboard('tenx');
                loaded = true;
                showUploadSuccess('tenx', `${state.tenx.allTrades.length} trades loaded from database`);
                showExportButton('tenx');
            }
        } catch (e) { console.error('Error loading tenx from DB:', e); }
    }

    // Load snapshots
    const trySnaps = (key) => {
        const saved = localStorage.getItem(key);
        if (saved) try { const p = JSON.parse(saved); if (Array.isArray(p) && p.length > 0) return p; } catch(e) {}
        return null;
    };
    const tenxSnaps = trySnaps('tenx-snapshots');
    if (tenxSnaps) state.tenx.snapshots = tenxSnaps;
    else try { state.tenx.snapshots = await DB.loadWeeklySnapshots('tenx'); } catch(e) {}

    if (state.tenx.snapshots.length === 0 && state.tenx.allTrades.length > 0) {
        state.tenx.snapshots = generateWeeklySnapshots(state.tenx.allTrades, 'tenx', TENX_RISK, TENX_PPT, TENX_STARTING_BALANCE);
        localStorage.setItem('tenx-snapshots', JSON.stringify(state.tenx.snapshots));
    }

    // Render growth chart
    if (state.tenx.allTrades.length > 0) {
        renderGrowthComparisonFromState('chart-growth-comparison-tenx', 'tenx');
    }
});
