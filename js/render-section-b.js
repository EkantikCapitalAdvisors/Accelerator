// =====================================================
// Section B — Sustainability. Spec §6.
// Battery table, controls, upload flow, version history.
// =====================================================
(function (root) {
    'use strict';

    function $(id) { return document.getElementById(id); }

    function fmtTime(d) {
        if (!d) return '—';
        const date = (d instanceof Date) ? d : new Date(d);
        return date.toLocaleString('en-US', {
            month: 'short', day: 'numeric',
            hour: '2-digit', minute: '2-digit', hour12: false
        });
    }

    // ─── Failure interpretation note (shown only when passCount < 8) ───
    function renderFailureNote(result) {
        const target = $('battery-failure-note');
        if (!target) return;
        if (!result || !result.meta || result.meta.insufficient) { target.innerHTML = ''; return; }
        if (result.meta.passCount === 8) { target.innerHTML = ''; return; }

        const N = result.meta.sampleSize;
        const byId = id => result.tests.find(t => t.test === id);

        const failing = result.tests.filter(t => !t.pass);
        const failIds = new Set(failing.map(t => t.test));
        const failNames = failing.map(t => t.name).join(', ');

        // Bucket A — sample-size gap: 1 or 2 fail, and 3,4,5,6,8 all pass
        const aTrigger = (failIds.has(1) || failIds.has(2))
            && [3, 4, 5, 6, 8].every(id => !failIds.has(id));
        // Bucket B — fragile edge: 4, 7, or 6 failed
        const bTrigger = failIds.has(4) || failIds.has(7) || failIds.has(6);
        // Bucket C — marginal edge: 3, 5, or 8 failed
        const cTrigger = failIds.has(3) || failIds.has(5) || failIds.has(8);

        let bucket;
        if (aTrigger && !bTrigger) bucket = 'A';
        else if (bTrigger) bucket = 'B';
        else if (cTrigger) bucket = 'C';
        else bucket = 'A';

        // Trades needed to cross p < 0.05 — t scales as √n if mean and SD hold.
        // Use the df-aware critical value rather than the 1.96 large-sample approximation.
        let tradesNeeded = null;
        const t1 = byId(1);
        if (t1 && typeof t1.details === 'string') {
            const m = t1.details.match(/t\s*=\s*(-?\d+\.?\d*)/);
            const stats = root.Ekantik.Battery._stats;
            if (m && stats && typeof stats.tQuantile === 'function') {
                const tStat = Math.abs(parseFloat(m[1]));
                const tCrit = stats.tQuantile(0.975, Math.max(1, N - 1));
                if (tStat > 0 && isFinite(tStat) && isFinite(tCrit)) {
                    const nNeeded = Math.ceil(N * Math.pow(tCrit / tStat, 2));
                    tradesNeeded = Math.max(0, nNeeded - N);
                    // If test 1 is currently failing, "0 additional" contradicts
                    // the failure — show at minimum 1.
                    if (tradesNeeded === 0 && !t1.pass) tradesNeeded = 1;
                }
            }
        }

        const pf        = byId(3) ? byId(3).result : null;
        const rExp      = byId(5) ? byId(5).result : null;
        const pluralS   = failing.length > 1 ? 's' : '';
        const verbS     = failing.length > 1 ? '' : 's';  // subject-verb agreement

        const fmtPF   = pf == null || !isFinite(pf) ? '—' : (pf === Infinity ? '∞' : pf.toFixed(2));
        const fmtRExp = rExp == null || !isFinite(rExp) ? '—' : `${rExp >= 0 ? '+' : ''}${rExp.toFixed(2)}R`;

        const templates = {
            A: `
              <div class="failure-note failure-note--a">
                <h4>Why tests 1 and 2 currently fail.</h4>
                <p>Tests 1 and 2 share the same underlying math: both ask whether the per-trade average profit is statistically distinguishable from zero. With the current sample of <strong>${N}</strong> trades and the observed edge size, approximately <strong>${tradesNeeded == null ? '—' : tradesNeeded}</strong> additional trades are needed to cross the 95% significance threshold.</p>
                <p>The other six tests confirm the edge is real and robust — profit factor <strong>${fmtPF}</strong>, R-expectancy <strong>${fmtRExp}</strong>, outlier-independent after removing the top three winners, and bootstrap-profitable in a strong majority of 10,000 resamples. Tests 1 and 2 are not a red flag about the edge; they are a reminder that statistical certainty requires sample size, and the sample is still accumulating.</p>
                <p class="failure-note__footer">This note will disappear automatically when the battery next passes all eight tests.</p>
              </div>`,
            B: `
              <div class="failure-note failure-note--b">
                <h4>Why this failure pattern matters.</h4>
                <p>The failing test${pluralS} — <strong>${failNames}</strong> — measure${verbS} whether the edge is structural or accidental. Failure here is not a sample-size issue; it is a signal that the current trade set depends on a small number of large winners, a thin margin above breakeven, or a streak profile that will test execution discipline.</p>
                <p>The appropriate response is not more trades; it is a review of the strategy parameters. The operator will document the diagnosis and any rule changes publicly in the Doctrine before the next trade.</p>
              </div>`,
            C: `
              <div class="failure-note failure-note--c">
                <h4>Why this failure pattern matters.</h4>
                <p>The failing test${pluralS} — <strong>${failNames}</strong> — indicate${verbS} the edge exists but is thinner than the sustainability threshold. Profit factor, R-expectancy, or bootstrap probability is in the "marginal" range rather than the "robust" range.</p>
                <p>This is a watch state, not a kill signal. More trades will resolve whether the edge strengthens toward institutional-grade or flattens toward breakeven. The operator is not adjusting the strategy during the current 100-trade commitment.</p>
              </div>`
        };

        target.innerHTML = templates[bucket];
    }

    function renderAll(state) {
        const table = $('battery-table');
        const glossary = $('battery-glossary');
        const banner = $('battery-status-banner');
        const ts = $('battery-last-recalc');
        const ss = $('battery-sample-size');

        if (state.battery) {
            root.Ekantik.BatteryUI.renderTable(table, state.battery);
            root.Ekantik.BatteryUI.renderGlossary(glossary, state.battery);
            root.Ekantik.BatteryUI.renderStatusBanner(banner, state.battery);
            root.Ekantik.BatteryUI.renderEdgeHub($('battery-edge-hub'));
            renderFailureNote(state.battery);
        }
        if (ts) ts.textContent = fmtTime(state.computedAt);
        if (ss) ss.textContent = state.battery ? state.battery.meta.sampleSize : 0;

        // User-upload banner
        const userBanner = $('battery-user-banner');
        if (userBanner) {
            if (state.source === 'user-upload') {
                userBanner.classList.remove('hide');
            } else {
                userBanner.classList.add('hide');
            }
        }
    }

    function wireRecalcButton() {
        const btn = $('btn-recalculate');
        if (!btn) return;
        btn.addEventListener('click', async () => {
            btn.disabled = true;
            const originalText = btn.textContent;
            btn.textContent = 'Recalculating…';
            try { await root.Ekantik.Data.load({ bust: true }); }
            finally {
                btn.disabled = false;
                btn.textContent = originalText;
            }
        });
    }

    function wireResetButton() {
        const btn = $('btn-reset-data');
        if (!btn) return;
        btn.addEventListener('click', () => root.Ekantik.Data.load({ bust: false }));
    }

    function wireUploadFlow() {
        const fileInput = $('upload-file');
        const textarea = $('upload-textarea');
        const runBtn = $('btn-run-upload');
        const previewEl = $('upload-preview');
        if (!runBtn) return;

        function readFile(file) {
            return new Promise((res, rej) => {
                const r = new FileReader();
                r.onload = e => res(e.target.result);
                r.onerror = rej;
                r.readAsText(file);
            });
        }

        const isOptionsMode = () => (root.EKANTIK_CONFIG && root.EKANTIK_CONFIG.instrument === 'options');

        async function parseInput() {
            const file = fileInput && fileInput.files && fileInput.files[0];
            const pasted = textarea ? textarea.value.trim() : '';
            const optionsMode = isOptionsMode();

            let trades = [];
            if (file) {
                const text = await readFile(file);
                if (file.name.toLowerCase().endsWith('.json')) {
                    const json = JSON.parse(text);
                    trades = Array.isArray(json) ? json : [];
                } else if (optionsMode) {
                    trades = root.parseDiscordOptionsText(text);
                } else {
                    trades = root.parseTradovateCSV(text);
                }
            } else if (pasted.length > 0) {
                if (optionsMode) {
                    try {
                        const json = JSON.parse(pasted);
                        if (Array.isArray(json)) trades = json;
                        else trades = root.parseDiscordOptionsText(pasted);
                    } catch (e) {
                        trades = root.parseDiscordOptionsText(pasted);
                    }
                } else {
                    try {
                        const json = JSON.parse(pasted);
                        if (Array.isArray(json)) trades = root.parseDiscordJSON(json);
                    } catch (e) {
                        trades = root.parseDiscordTradeText(pasted);
                    }
                }
            }
            return trades;
        }

        runBtn.addEventListener('click', async () => {
            try {
                const parsed = await parseInput();
                if (!parsed || parsed.length === 0) {
                    const hint = isOptionsMode()
                        ? 'Paste Discord options alerts (ID/Ticker/Type/Strike/Expiry/Entry/...) or upload an options JSON.'
                        : 'Upload a Tradovate CSV or paste Discord alerts.';
                    previewEl.innerHTML = `<p class="muted">No trades detected. ${hint}</p>`;
                    return;
                }
                // Options parser already returns snake_case; futures parser returns camelCase.
                const optionsMode = isOptionsMode();
                const uploaded = optionsMode
                    ? parsed  // already snake_case from parseDiscordOptionsText
                    : parsed.map(t => ({
                        dollar_pl:    t.dollarPL    || 0,
                        risk_dollars: t.riskDollars || 0,
                        is_win:       t.isWin,
                        entry_time:   t.entryTime || t.datetime || '',
                        exit_time:    t.exitTime  || '',
                        direction:    t.direction,
                        entry_price:  t.entryPrice || 0,
                        exit_price:   t.exitPrice  || 0,
                        points_pl:    t.pointsPL   || 0
                    }));

                const first5 = uploaded.slice(0, 5);
                previewEl.innerHTML = `
                  <p class="mono" style="font-size:12px"><strong>${uploaded.length} trades parsed.</strong> First 5 preview:</p>
                  <table class="data-table" style="margin-top:8px">
                    <thead><tr><th>Entry</th><th>Dir</th><th class="num">$ P&L</th><th class="num">Risk $</th></tr></thead>
                    <tbody>
                      ${first5.map(t => `<tr><td>${t.entry_time || '—'}</td><td>${t.direction || '—'}</td>
                          <td class="num">$${(t.dollar_pl).toFixed(0)}</td>
                          <td class="num">$${(t.risk_dollars).toFixed(0)}</td></tr>`).join('')}
                    </tbody>
                  </table>`;

                root.Ekantik.Data.setUserData(uploaded);
            } catch (err) {
                console.error(err);
                previewEl.innerHTML = `<p style="color:var(--fail)">Parse error: ${err.message}</p>`;
            }
        });
    }

    function renderVersionHistory(state) {
        const tbody = $('version-history-body');
        if (!tbody) return;
        const archives = (state.archiveIndex && state.archiveIndex.archives) || [];
        if (archives.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="muted italic">No archived runs yet. Monthly snapshots will appear here.</td></tr>';
            return;
        }
        tbody.innerHTML = archives.map(a => `
          <tr>
            <td>${a.month}</td>
            <td class="num">${a.sampleSize || '—'}</td>
            <td class="num">${a.passCount != null ? a.passCount + ' / 8' : '—'}</td>
            <td><a href="archive.html?m=${encodeURIComponent(a.month)}">View →</a></td>
          </tr>`).join('');
    }

    function init() {
        root.Ekantik.Data.onChange(state => {
            renderAll(state);
            renderVersionHistory(state);
        });
        wireRecalcButton();
        wireResetButton();
        wireUploadFlow();
        const s = root.Ekantik.Data.get();
        if (s.battery) { renderAll(s); renderVersionHistory(s); }
    }

    root.Ekantik = root.Ekantik || {};
    root.Ekantik.SectionB = { init };
})(typeof window !== 'undefined' ? window : globalThis);
