// =====================================================
// Experiment instrumentation (ACC-REPOS-FINAL-V1)
//   · Hero status strip (sample / rolling EV / triggers / gate)
//   · Section 01.2 Trigger Ladder (live state + distance-to-fire)
//   · Section 09 Reach Out form (3 fields, zero financial info)
// =====================================================
(function (root) {
    'use strict';

    function $(id) { return document.getElementById(id); }

    // Buffer thresholds from the locked protocol (Section 01.2).
    // Buffer N runs N ES. The separate trial run (1 ES) banks the first $10K;
    // Buffer 1 (also 1 ES) is where the real challenge begins. Each buffer is
    // "active" while cumulative profit sits in [threshold, nextThreshold).
    const BUFFERS = [
        { id: 'B1', threshold: 10000, es: 1 },
        { id: 'B2', threshold: 20000, es: 2 },
        { id: 'B3', threshold: 30000, es: 3 },
        { id: 'B4', threshold: 40000, es: 4 },
    ];
    const FALSIFIABILITY_BAR = 0; // rolling-100 EV crossing $0 fires the gate
    const TRIAL_RUN_TARGET = 10000; // Phase 0 → Phase 1 once this much P&L is banked

    function fmtUSD(v) {
        if (v == null || !isFinite(v)) return '$—';
        return (v < 0 ? '−$' : '$') + Math.abs(Math.round(v)).toLocaleString();
    }
    function fmtSignedUSD(v) {
        if (v == null || !isFinite(v)) return '—';
        return (v >= 0 ? '+$' : '−$') + Math.abs(Math.round(v)).toLocaleString();
    }

    function cumulativeProfit(trades) {
        return (trades || []).reduce((a, t) => a + (t.dollar_pl || t.dollarPL || 0), 0);
    }
    function rollingEv(trades, window) {
        if (!trades || !trades.length) return null;
        const w = trades.length >= window ? trades.slice(-window) : trades;
        return w.reduce((a, t) => a + (t.dollar_pl || t.dollarPL || 0), 0) / w.length;
    }

    function render(state) {
        const trades = (state && state.trades) || [];
        const n = trades.length;
        const cum = cumulativeProfit(trades);
        const ev100 = rollingEv(trades, 100);
        const evAll = n ? cum / n : null;

        // Current position size: 1 ES through the trial run and Buffer 1, then
        // 2 ES at $20K, 3 ES at $30K, 4 ES at $40K (the cap).
        const posEs = cum >= 40000 ? 4 : cum >= 30000 ? 3 : cum >= 20000 ? 2 : 1;
        // Edge gate is active from 80 trades (provisional until 100), per the
        // operator-falsifiability calibration.
        const gateActive = n >= 80;
        const gateFired = ev100 != null && ev100 < FALSIFIABILITY_BAR && gateActive;
        const gateProvisional = n >= 80 && n < 100;

        // ── Hero status strip ──
        if ($('xp-sample'))   $('xp-sample').textContent   = n ? String(n) : '—';
        if ($('xp-ev'))       $('xp-ev').textContent       = evAll != null ? fmtSignedUSD(evAll) : '—';
        if ($('xp-triggers')) $('xp-triggers').textContent = `${posEs} ES`;
        if ($('xp-gate'))     $('xp-gate').textContent     = gateFired ? 'TRIGGERED' : (gateProvisional ? 'Armed · provisional' : 'Armed');

        // ── Phase indicator — auto-switches on the live balance ──
        // Phase 0 = trial run: bank the first $10,000 of realized P&L at lower
        // stakes. Phase 1 = the real challenge ($10K → $100K) the moment that
        // first $10,000 is banked. Drives off cumulative realized profit so it
        // flips itself with no manual edit.
        const phaseEl = $('xp-phase');
        if (phaseEl) {
            if (cum >= TRIAL_RUN_TARGET) {
                phaseEl.innerHTML = '<strong>Phase 1:</strong> The real challenge &middot; $10K &rarr; $100K';
            } else {
                phaseEl.innerHTML = `<strong>Phase 0:</strong> Trial run &middot; ${fmtUSD(Math.max(0, cum))} of $10K banked`;
            }
        }

        // ── Trigger ladder ──
        const ladder = $('trigger-ladder');
        if (ladder) {
            const setState = (step, cls, html) => {
                if (!step) return;
                const st = step.querySelector('[data-status]');
                step.classList.remove('trigger-step--fired', 'trigger-step--active', 'trigger-step--pending');
                step.classList.add(cls);
                if (st) st.innerHTML = html;
            };
            // Trial run — separate from the ladder, 1 ES, target $10K.
            const trialStep = ladder.querySelector('[data-trigger="TRIAL"]');
            if (trialStep) {
                if (cum >= TRIAL_RUN_TARGET) setState(trialStep, 'trigger-step--fired', 'CLEARED');
                else {
                    const pct = Math.max(0, Math.min(100, (cum / TRIAL_RUN_TARGET) * 100));
                    setState(trialStep, 'trigger-step--active', `ACTIVE &middot; ${fmtUSD(Math.max(0, cum))} of ${fmtUSD(TRIAL_RUN_TARGET)} &middot; ${pct.toFixed(0)}%`);
                }
            }
            // Buffers — active while cumulative profit sits in [threshold, nextThreshold).
            BUFFERS.forEach((b, i) => {
                const step = ladder.querySelector(`[data-trigger="${b.id}"]`);
                if (!step) return;
                const next = (i + 1 < BUFFERS.length) ? BUFFERS[i + 1].threshold : Infinity;
                if (cum >= next) {
                    setState(step, 'trigger-step--fired', 'CLEARED');
                } else if (cum >= b.threshold) {
                    if (isFinite(next)) {
                        const pct = Math.max(0, Math.min(100, ((cum - b.threshold) / (next - b.threshold)) * 100));
                        setState(step, 'trigger-step--active', `ACTIVE &middot; running ${b.es} ES &middot; ${pct.toFixed(0)}% to next`);
                    } else {
                        setState(step, 'trigger-step--active', `ACTIVE &middot; running ${b.es} ES &middot; cap`);
                    }
                } else {
                    setState(step, 'trigger-step--pending', 'PENDING');
                }
            });
        }
    }

    // ── Section 09 Reach Out form (3 fields, zero financial info) ──
    function wireReachForm() {
        const form = $('reach-form');
        if (!form || form._wired) return;
        form._wired = true;
        const name = $('reach-name'), email = $('reach-email'), msg = $('reach-message');
        const submit = $('reach-submit'), errorEl = $('reach-error'), thanks = $('reach-thanks');

        const validEmail = v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
        function validate() {
            const ok = (name.value || '').trim() && validEmail((email.value || '').trim()) && (msg.value || '').trim();
            submit.disabled = !ok;
            return ok;
        }
        [name, email, msg].forEach(el => el && el.addEventListener('input', validate));
        validate();

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (!validate()) return;
            const action = form.getAttribute('action');
            const placeholder = !action || action.includes('__FORMSPREE_ACCELERATOR__');
            const payload = new FormData();
            payload.append('name',    name.value.trim());
            payload.append('email',   email.value.trim());
            payload.append('message', msg.value.trim());
            payload.append('source',  'accelerator-experiment-reachout');
            payload.append('timestamp', new Date().toISOString());
            try {
                if (!placeholder) {
                    const res = await fetch(action, { method: 'POST', body: payload, headers: { Accept: 'application/json' } });
                    if (!res.ok) throw new Error('HTTP ' + res.status);
                }
                form.classList.add('hide');
                if (thanks) thanks.classList.remove('hide');
            } catch (err) {
                if (errorEl) { errorEl.textContent = 'Something went wrong — email info@ekantikcapital.com directly.'; errorEl.classList.remove('hide'); }
            }
        });
    }

    function init() {
        wireReachForm();
        if (root.Ekantik && root.Ekantik.Data) {
            root.Ekantik.Data.onChange(render);
            const cur = root.Ekantik.Data.get();
            if (cur) render(cur);
        }
    }

    root.Ekantik = root.Ekantik || {};
    root.Ekantik.Experiment = { init, render };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})(typeof window !== 'undefined' ? window : globalThis);
