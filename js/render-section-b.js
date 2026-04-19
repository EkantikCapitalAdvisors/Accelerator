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

        async function parseInput() {
            const file = fileInput && fileInput.files && fileInput.files[0];
            const pasted = textarea ? textarea.value.trim() : '';

            let trades = [];
            if (file) {
                const text = await readFile(file);
                if (file.name.toLowerCase().endsWith('.json')) {
                    const json = JSON.parse(text);
                    trades = Array.isArray(json) ? root.parseDiscordJSON(json) : [];
                } else {
                    trades = root.parseTradovateCSV(text);
                }
            } else if (pasted.length > 0) {
                // Try JSON first, else Discord text
                try {
                    const json = JSON.parse(pasted);
                    if (Array.isArray(json)) trades = root.parseDiscordJSON(json);
                } catch (e) {
                    trades = root.parseDiscordTradeText(pasted);
                }
            }
            return trades;
        }

        runBtn.addEventListener('click', async () => {
            try {
                const camelTrades = await parseInput();
                if (!camelTrades || camelTrades.length === 0) {
                    previewEl.innerHTML = '<p class="muted">No trades detected. Upload a Tradovate CSV or paste Discord alerts.</p>';
                    return;
                }
                // Convert to the snake_case shape the battery accepts.
                const uploaded = camelTrades.map(t => ({
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
