// =====================================================
// Section C — Validation. Spec §7.
// Discord feed, public trade log, roadmap, Formspree interest capture.
// =====================================================
(function (root) {
    'use strict';

    function $(id) { return document.getElementById(id); }
    function escapeHTML(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

    function formatPrice(v) { return v ? Number(v).toFixed(2) : '—'; }
    function formatDateTime(raw) {
        if (!raw) return '—';
        const d = new Date(raw.replace(' ', 'T'));
        if (isNaN(d.getTime())) return raw;
        return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
    }

    function sortDesc(trades) {
        return [...trades].sort((a, b) => {
            const ta = new Date((a.exit_time || a.entry_time || '').replace(' ', 'T'));
            const tb = new Date((b.exit_time || b.entry_time || '').replace(' ', 'T'));
            return tb - ta;
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
            const side = (dir.toLowerCase().startsWith('s') || dir.toLowerCase() === 'short') ? 'Short' : 'Long';
            const pl = t.dollar_pl || 0;
            const sign = pl >= 0 ? '+' : '−';
            const pts = t.points_pl != null ? t.points_pl.toFixed(1) : '—';
            return `
              <div class="discord-msg">
                <div class="discord-msg__header">
                  <span>${escapeHTML(t.trade_num || 'F—')} &middot; ES</span>
                  <span>${formatDateTime(t.entry_time)}</span>
                </div>
                <div class="discord-msg__body">
                  ${side} @ ${formatPrice(t.entry_price)}
                  ${t.stop_price ? ` &nbsp;·&nbsp; stop ${formatPrice(t.stop_price)}` : ''}
                  &nbsp;·&nbsp; <strong style="color:${pl>=0?'var(--pass)':'var(--fail)'}">${sign}${Math.abs(pts)} pts / ${sign}$${Math.abs(pl).toFixed(0)}</strong>
                </div>
              </div>`;
        }).join('');
    }

    // ─── Public trade log — last 25 trades, spec §7.2 columns ───
    function renderTradeLog(state) {
        const tbody = $('trade-log-body');
        if (!tbody) return;
        const trades = sortDesc(state.trades || []).slice(0, 25);
        if (trades.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" class="muted italic">Awaiting first fills.</td></tr>';
            return;
        }
        tbody.innerHTML = trades.map(t => {
            const dir = (t.direction || '').toLowerCase();
            const side = dir.startsWith('s') || dir === 'short' ? 'Short' : 'Long';
            const r = (t.risk_dollars && t.risk_dollars > 0) ? (t.dollar_pl / t.risk_dollars) : null;
            const rDisp = r == null ? '—' : ((r >= 0 ? '+' : '') + r.toFixed(2) + 'R');
            const result = t.dollar_pl >= 0 ? 'Win' : 'Loss';
            return `
              <tr>
                <td>${formatDateTime(t.entry_time)}</td>
                <td>${side}</td>
                <td class="num">${formatPrice(t.entry_price)}</td>
                <td class="num">${t.exit_price ? formatPrice(t.exit_price) : (t.dollar_pl != null ? '—' : '—')}</td>
                <td class="num">${t.points_pl != null ? t.points_pl.toFixed(1) : '—'}</td>
                <td class="num" style="color:${t.dollar_pl>=0?'var(--pass)':'var(--fail)'};font-weight:500">
                    ${t.dollar_pl >= 0 ? '+' : '−'}$${Math.abs(t.dollar_pl||0).toFixed(0)}
                </td>
                <td><span class="pill ${t.dollar_pl>=0?'pill--pass':'pill--fail'}">${result}</span></td>
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
            const header = ['entry_time','exit_time','direction','entry_price','exit_price','stop_price','contracts','points_pl','dollar_pl','risk_points','risk_dollars','is_win','product'];
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
            a.download = `ekantik-trade-log-${new Date().toISOString().slice(0,10)}.csv`;
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
