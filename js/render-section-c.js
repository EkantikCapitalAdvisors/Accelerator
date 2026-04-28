// =====================================================
// Section C — Validation. Spec §7.
// Discord feed, public trade log, roadmap, Formspree interest capture.
// =====================================================
(function (root) {
    'use strict';

    function $(id) { return document.getElementById(id); }
    function escapeHTML(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
    function isOptionsTrade(t) { return !!(t && t.option_type); }

    function formatPrice(v) { return v ? Number(v).toFixed(2) : '—'; }
    function formatDateTime(raw) {
        if (!raw) return '—';
        const d = new Date(raw.replace(' ', 'T'));
        if (isNaN(d.getTime())) return raw;
        return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
    }

    function parseTradeTS(t) {
        const raw = t.exit_time || t.entry_time || t.datetime || '';
        if (!raw) return null;
        // ISO-date prefix: "2026-02-04 09:40:15" or "2026-04-10 8:54 AM"
        let m = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](.+))?$/);
        if (m) {
            const yr = +m[1], mo = +m[2], day = +m[3];
            const tm = (m[4] || '').match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i);
            let h = 0, min = 0, s = 0;
            if (tm) {
                h = +tm[1]; min = +tm[2]; s = tm[3] ? +tm[3] : 0;
                const ap = (tm[4] || '').toUpperCase();
                if (ap === 'PM' && h < 12) h += 12;
                if (ap === 'AM' && h === 12) h = 0;
            }
            const d = new Date(yr, mo - 1, day, h, min, s);
            return isNaN(d.getTime()) ? null : d;
        }
        m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(.+))?$/);
        if (m) {
            const mo = +m[1], day = +m[2], yr = +m[3];
            const tm = (m[4] || '').match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i);
            let h = 0, min = 0, s = 0;
            if (tm) {
                h = +tm[1]; min = +tm[2]; s = tm[3] ? +tm[3] : 0;
                const ap = (tm[4] || '').toUpperCase();
                if (ap === 'PM' && h < 12) h += 12;
                if (ap === 'AM' && h === 12) h = 0;
            }
            const d = new Date(yr, mo - 1, day, h, min, s);
            return isNaN(d.getTime()) ? null : d;
        }
        const d = new Date(raw);
        return isNaN(d.getTime()) ? null : d;
    }

    function sortDesc(trades) {
        return [...trades].sort((a, b) => {
            const ta = parseTradeTS(a); const tb = parseTradeTS(b);
            if (ta && tb) return tb - ta;
            return 0;
        });
    }

    // ─── Day-range filter state (one shared global; both sections re-render on change) ───
    // Windows expressed in days; null = "All"
    const FILTER_OPTIONS = [
        { key: '7',   label: '7D',  days: 7 },
        { key: '30',  label: '30D', days: 30 },
        { key: '90',  label: '90D', days: 90 },
        { key: 'all', label: 'All', days: null }
    ];
    let activeFilterKey = 'all';

    function applyDayFilter(trades) {
        const opt = FILTER_OPTIONS.find(o => o.key === activeFilterKey);
        if (!opt || opt.days == null) return trades;
        const cutoff = Date.now() - opt.days * 24 * 60 * 60 * 1000;
        return trades.filter(t => {
            const d = parseTradeTS(t);
            return d && d.getTime() >= cutoff;
        });
    }

    // ─── Discord card — last 5 trades styled as alert messages ───
    function renderDiscordCard(state) {
        const el = $('discord-feed');
        if (!el) return;
        const trades = state.trades || [];
        const recent = sortDesc(trades).slice(0, 5);
        if (recent.length === 0) {
            el.innerHTML = '<p class="muted italic">Awaiting first fills.</p>';
            return;
        }
        el.innerHTML = recent.map(t => {
            const dir = t.direction || '—';
            const pl = t.dollar_pl || 0;
            const sign = pl >= 0 ? '+' : '−';
            let header, body;

            if (isOptionsTrade(t)) {
                const strikeStr = t.strike != null ? String(t.strike) : '—';
                header = `${escapeHTML(t.trade_num || 'O—')} &middot; ${escapeHTML(t.ticker || '—')} ${escapeHTML(t.option_type || '')} ${strikeStr}${t.expiry ? ' ' + escapeHTML(t.expiry) : ''}`;
                body = `${escapeHTML(dir)} @ ${formatPrice(t.entry_price)}${t.stop_price ? ` &nbsp;·&nbsp; stop ${formatPrice(t.stop_price)}` : ''} &nbsp;·&nbsp; <strong style="color:${pl>=0?'var(--pass)':'var(--fail)'}">${sign}$${Math.abs(pl).toFixed(0)}</strong>`;
            } else {
                const side = (dir.toLowerCase().startsWith('s') || dir.toLowerCase() === 'short') ? 'Short' : 'Long';
                const pts = t.points_pl != null ? t.points_pl.toFixed(1) : '—';
                header = `${escapeHTML(t.trade_num || 'F—')} &middot; ES`;
                body = `${side} @ ${formatPrice(t.entry_price)}${t.stop_price ? ` &nbsp;·&nbsp; stop ${formatPrice(t.stop_price)}` : ''} &nbsp;·&nbsp; <strong style="color:${pl>=0?'var(--pass)':'var(--fail)'}">${sign}${Math.abs(pts)} pts / ${sign}$${Math.abs(pl).toFixed(0)}</strong>`;
            }
            return `
              <div class="discord-msg">
                <div class="discord-msg__header">
                  <span>${header}</span>
                  <span>${formatDateTime(t.entry_time)}</span>
                </div>
                <div class="discord-msg__body">${body}</div>
              </div>`;
        }).join('');
    }

    // ─── Public trade log — full log with day-range filter ───
    // Columns auto-adapt based on whether trades are futures (pts/exit) or
    // options (ticker/type/strike/expiry).
    function renderFilterPills() {
        const wrap = $('trade-log-filter');
        if (!wrap) return;
        wrap.innerHTML = FILTER_OPTIONS.map(o =>
            `<button type="button" class="filter-pill${activeFilterKey === o.key ? ' filter-pill--active' : ''}" data-filter="${o.key}">${o.label}</button>`
        ).join('');
        wrap.querySelectorAll('[data-filter]').forEach(btn => {
            btn.addEventListener('click', () => {
                activeFilterKey = btn.getAttribute('data-filter');
                const state = root.Ekantik.Data.get();
                renderTradeLog(state);
            });
        });
    }

    function renderTradeLog(state) {
        const tbody = $('trade-log-body');
        const thead = document.querySelector('#trade-log-body')?.closest('table')?.querySelector('thead');
        const countEl = $('trade-log-count');
        if (!tbody) return;
        const allTrades = state.trades || [];
        const optionsMode = allTrades.length > 0 && isOptionsTrade(allTrades[0]);
        const filtered = applyDayFilter(allTrades);
        const trades = sortDesc(filtered);

        if (countEl) {
            countEl.textContent = `Showing ${trades.length} of ${allTrades.length} closed trade${allTrades.length === 1 ? '' : 's'}`;
        }
        renderFilterPills();

        // Swap column headers to match the mode
        if (thead) {
            thead.innerHTML = optionsMode ? `
                <tr>
                  <th>ID</th>
                  <th>Date/Time</th>
                  <th>Ticker</th>
                  <th>Type</th>
                  <th class="num">Strike</th>
                  <th>Expiry</th>
                  <th class="num">Entry</th>
                  <th class="num">$ P&L</th>
                  <th>Result</th>
                  <th class="num">R</th>
                </tr>` : `
                <tr>
                  <th>ID</th>
                  <th>Date/Time</th>
                  <th>Dir</th>
                  <th class="num">Entry</th>
                  <th class="num">Exit</th>
                  <th class="num">Pts</th>
                  <th class="num">$ P&L</th>
                  <th>Result</th>
                  <th class="num">R</th>
                </tr>`;
        }

        if (trades.length === 0) {
            const colspan = optionsMode ? 10 : 9;
            tbody.innerHTML = `<tr><td colspan="${colspan}" class="muted italic">Awaiting first fills.</td></tr>`;
            return;
        }
        tbody.innerHTML = trades.map(t => {
            const r = (t.risk_dollars && t.risk_dollars > 0) ? (t.dollar_pl / t.risk_dollars) : null;
            const rDisp = r == null ? '—' : ((r >= 0 ? '+' : '') + r.toFixed(2) + 'R');
            const result = t.dollar_pl >= 0 ? 'Win' : 'Loss';
            const sizeLabel = (() => {
                const ps = t.position_size;
                if (!ps || ps === 'full') return '';
                if (ps === 'half')    return { glyph: '½', title: 'Half position' };
                if (ps === 'third')   return { glyph: '⅓', title: 'Third position' };
                if (ps === 'quarter') return { glyph: '¼', title: 'Quarter position' };
                // MES count form (e.g., "5 MES") — show the count compactly.
                if (t.mes_count) return { glyph: `${t.mes_count}M`, title: `${t.mes_count} MES contracts (≡ ${(t.mes_count / 10).toFixed(2)} ES)` };
                return { glyph: ps, title: ps };
            })();
            const sizeMark = sizeLabel
                ? ` <span title="${escapeHTML(sizeLabel.title)}" style="color:var(--gold);font-weight:500;font-size:0.9em">${escapeHTML(sizeLabel.glyph)}</span>`
                : '';
            const idCell = `<td class="mono" style="font-weight:600;color:var(--navy)">${escapeHTML(t.trade_num || '—')}${sizeMark}</td>`;
            const plCell = `
                <td class="num" style="color:${t.dollar_pl>=0?'var(--pass)':'var(--fail)'};font-weight:500">
                    ${t.dollar_pl >= 0 ? '+' : '−'}$${Math.abs(t.dollar_pl||0).toFixed(0)}
                </td>`;
            const resultCell = `<td><span class="pill ${t.dollar_pl>=0?'pill--pass':'pill--fail'}">${result}</span></td>`;
            if (optionsMode) {
                return `
                  <tr>
                    ${idCell}
                    <td>${formatDateTime(t.entry_time)}</td>
                    <td>${escapeHTML(t.ticker || '—')}</td>
                    <td>${escapeHTML(t.option_type || '—')}</td>
                    <td class="num">${t.strike != null ? t.strike : '—'}</td>
                    <td>${escapeHTML(t.expiry || '—')}</td>
                    <td class="num">${formatPrice(t.entry_price)}</td>
                    ${plCell}
                    ${resultCell}
                    <td class="num">${rDisp}</td>
                  </tr>`;
            }
            const dir = (t.direction || '').toLowerCase();
            const side = dir.startsWith('s') || dir === 'short' ? 'Short' : 'Long';
            return `
              <tr>
                ${idCell}
                <td>${formatDateTime(t.entry_time)}</td>
                <td>${side}</td>
                <td class="num">${formatPrice(t.entry_price)}</td>
                <td class="num">${t.exit_price ? formatPrice(t.exit_price) : '—'}</td>
                <td class="num">${t.points_pl != null ? t.points_pl.toFixed(1) : '—'}</td>
                ${plCell}
                ${resultCell}
                <td class="num">${rDisp}</td>
              </tr>`;
        }).join('');
    }

    // ─── CSV export of full trade log ───
    function wireCSVDownload(state) {
        const btn = $('btn-download-csv');
        if (!btn) return;
        btn.addEventListener('click', () => {
            const trades = sortDesc(root.Ekantik.Data.get().trades || []);
            if (trades.length === 0) return;
            const optionsMode = isOptionsTrade(trades[0]);
            const header = optionsMode
                ? ['entry_time','trade_num','ticker','option_type','strike','expiry','direction','entry_price','stop_price','dollar_pl','risk_dollars','is_win','notes']
                : ['entry_time','exit_time','direction','entry_price','exit_price','stop_price','contracts','points_pl','dollar_pl','risk_points','risk_dollars','is_win','product'];
            const rows = trades.map(t => header.map(h => {
                const v = t[h];
                if (v == null) return '';
                if (typeof v === 'string' && v.includes(',')) return `"${v.replace(/"/g,'""')}"`;
                return v;
            }).join(','));
            const csv = [header.join(','), ...rows].join('\n');
            const blob = new Blob([csv], { type: 'text/csv' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `ekantik-${optionsMode ? 'options' : 'futures'}-log-${new Date().toISOString().slice(0,10)}.csv`;
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        });
    }

    // ─── Formspree handler ───
    function wireInterestForm() {
        const form = $('interest-form');
        const confirm = $('interest-confirm');
        if (!form) return;
        form.addEventListener('submit', async (e) => {
            const action = form.getAttribute('action');
            // If endpoint is still a placeholder, prevent default and show a warning in place.
            if (!action || action.includes('__FORMSPREE_ID__')) {
                e.preventDefault();
                if (confirm) {
                    confirm.textContent = 'Form endpoint not configured yet. Set the Formspree ID before launch.';
                    confirm.style.color = 'var(--fail)';
                    confirm.classList.remove('hide');
                }
                return;
            }
            // Default submission is fine; show optimistic confirmation.
            if (confirm) {
                confirm.textContent = "Got it. We'll reach out when rails open.";
                confirm.style.color = 'var(--pass)';
                confirm.classList.remove('hide');
            }
        });
    }

    function init() {
        root.Ekantik.Data.onChange(state => {
            renderDiscordCard(state);
            renderTradeLog(state);
        });
        wireCSVDownload();
        wireInterestForm();
        const s = root.Ekantik.Data.get();
        if (s.trades) { renderDiscordCard(s); renderTradeLog(s); }
    }

    root.Ekantik = root.Ekantik || {};
    root.Ekantik.SectionC = { init };
})(typeof window !== 'undefined' ? window : globalThis);
