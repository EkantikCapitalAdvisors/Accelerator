// =====================================================
// Battery UI — renders the 8-test table and glossary.
// Pure DOM. Takes the result of Battery.runTests() and writes
// into target elements. Spec §6.2 and §6.3.
// =====================================================
(function (root) {
    'use strict';

    const TEST_DEFS = [
        {
            id: 1, short: 'p-value',
            name: 'Statistical Significance',
            threshold: 'p < 0.05',
            measures: 'How likely the observed edge came from random chance alone, via a one-sample t-test against a null of zero mean P&L per trade.',
            matters: 'If the edge can plausibly be explained by luck, no further testing is informative. This is the foundation.',
            formula: 't = mean / (SD / √n) ; p = 2·(1 − T_CDF(|t|, n−1))',
            rationale: 'p < 0.05 is the long-standing convention for "statistically significant" — the observed mean has less than a 5% chance of arising under the null.'
        },
        {
            id: 2, short: '95% CI',
            name: 'Confidence Interval (95%)',
            threshold: 'lower bound > $0',
            measures: 'The range within which the true per-trade expectancy is expected to lie, 19 times out of 20, given the sample.',
            matters: 'If the whole interval is above zero, the edge is robust to sampling variance — the sample is not close to being profitable by accident.',
            formula: 'mean ± t_crit · SE,  SE = SD / √n',
            rationale: 'Lower bound > 0 is a stricter requirement than significance: not only is the mean unlikely to be zero, we can claim with 95% confidence it is positive.'
        },
        {
            id: 3, short: 'PF',
            name: 'Profit Factor',
            threshold: '> 1.50',
            measures: 'Dollars earned on winning trades per dollar lost on losing trades.',
            matters: 'A profit factor above 1.50 is considered institutional-grade across futures strategies; above 2.00 is rare.',
            formula: 'Σ wins / |Σ losses|',
            rationale: '1.50 is a conservative institutional threshold; anything lower leaves too little margin for regime changes.'
        },
        {
            id: 4, short: 'Top-3',
            name: 'Outlier Independence',
            threshold: '> $0 after removing top 3 winners',
            measures: 'Whether the sample is still profitable after the three largest winning trades are removed.',
            matters: 'An edge that depends on two or three lottery wins is not a repeatable edge — it is a lucky sample. Real edges are distributed.',
            formula: 'Σ ( P&L − top 3 wins ) > 0',
            rationale: '"Remove the big wins" is the single strongest heuristic for separating distributed edges from survivorship-biased ones.'
        },
        {
            id: 5, short: 'R-exp',
            name: 'R-Expectancy',
            threshold: '> +0.20R',
            measures: 'Average expected profit per unit of risk deployed (mean of P&L / stop-distance per trade).',
            matters: 'R-expectancy normalizes across trade sizes and is how professional desks compare strategies.',
            formula: 'mean( dollarPL_i / riskDollars_i )',
            rationale: '+0.20R per trade is the conventional threshold where a strategy is producing meaningful expectancy after costs.'
        },
        {
            id: 6, short: 'Buffer',
            name: 'Breakeven Buffer',
            threshold: '> 10 percentage points',
            measures: 'How many percentage points above the breakeven win rate the sample\'s actual win rate currently sits.',
            matters: 'The bigger this cushion, the more the edge can survive a regime that compresses win rate.',
            formula: 'actual WR − avgLoss / (avgWin + avgLoss)',
            rationale: '10 pp is the point at which a strategy stops being vulnerable to a bad month flipping its expectancy negative.'
        },
        {
            id: 7, short: 'Streak',
            name: 'Streak Resilience',
            threshold: '≤ 4 consecutive losses',
            measures: 'The longest observed run of back-to-back losing trades in the sample.',
            matters: 'Streaks are statistically expected even for real edges — but long streaks break operators before they break the math.',
            formula: 'max( run of consecutive dollarPL < 0 )',
            rationale: '≤ 4 keeps drawdown-driven operator decisions in the rational zone; above that, discipline erodes.'
        },
        {
            id: 8, short: 'Bootstrap',
            name: 'Bootstrap P(profit)',
            threshold: '> 85%',
            measures: 'Probability the strategy is profitable across 10,000 random reorderings of its own trade sequence (sampling with replacement).',
            matters: 'The single most robust sustainability test — it stresses the edge against every plausible permutation of its own history.',
            formula: 'P( Σ resample > 0 )   over 10,000 resamples with replacement',
            rationale: '85%+ means the strategy is profitable in the overwhelming majority of alternative histories — not just the specific one that actually occurred.'
        }
    ];

    function pill(pass, isInsufficient) {
        if (isInsufficient) return '<span class="pill pill--neutral">Pending</span>';
        return `<span class="pill ${pass ? 'pill--pass' : 'pill--fail'}">${pass ? 'Pass' : 'Fail'}</span>`;
    }

    function renderTable(targetEl, battery) {
        if (!targetEl) return;
        const insufficient = battery.meta && battery.meta.insufficient;

        const rows = TEST_DEFS.map(def => {
            const r = battery.tests.find(t => t.test === def.id);
            const result = r ? r.display : '—';
            return `
              <tr>
                <td>
                  <button type="button" class="data-table__test-name" data-goto="t${def.id}">
                    ${def.id}. ${def.name}
                  </button>
                </td>
                <td class="num">${result}</td>
                <td class="num muted">${def.threshold}</td>
                <td>${pill(r ? r.pass : false, insufficient)}</td>
              </tr>`;
        }).join('');

        targetEl.innerHTML = `
          <div class="data-table__wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Test</th>
                  <th class="num">Current Result</th>
                  <th class="num">Threshold</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          </div>`;

        targetEl.querySelectorAll('[data-goto]').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.getAttribute('data-goto');
                const el = document.getElementById('glossary-' + id);
                if (!el) return;
                if (el.tagName === 'DETAILS') el.open = true;
                el.scrollIntoView({ behavior: 'smooth', block: 'start' });
            });
        });
    }

    function renderGlossary(targetEl, battery) {
        if (!targetEl) return;
        const insufficient = battery.meta && battery.meta.insufficient;

        targetEl.innerHTML = TEST_DEFS.map(def => {
            const r = battery.tests.find(t => t.test === def.id);
            const resultLine = insufficient
                ? '<em>Awaiting first fills.</em>'
                : `<strong>Current value:</strong> ${r.display} &middot; ${pill(r.pass, false)}`;
            const details = r && r.details ? r.details : '';
            return `
              <details class="glossary__card" id="glossary-t${def.id}">
                <summary class="glossary__summary">${def.id}. ${def.name}</summary>
                <div class="glossary__body">
                  <p><strong>What it measures.</strong> ${def.measures}</p>
                  <p><strong>Why it matters for sustainability.</strong> ${def.matters}</p>
                  <p><strong>Formula.</strong> <span class="glossary__formula">${def.formula}</span></p>
                  <p><strong>Threshold: ${def.threshold}.</strong> ${def.rationale}</p>
                  <p>${resultLine}</p>
                  ${details ? `<div class="glossary__calc"><strong>Calculation on current sample:</strong><br>${details}</div>` : ''}
                </div>
              </details>`;
        }).join('');
    }

    function renderStatusBanner(targetEl, battery) {
        if (!targetEl) return;
        if (battery.meta && battery.meta.insufficient) {
            targetEl.innerHTML = `<span class="mono muted">Awaiting first fills — sample size ${battery.meta.sampleSize || 0}.</span>`;
            return;
        }
        const { passCount, sampleSize } = battery.meta;
        const msg = passCount === 8
            ? `<strong style="color:var(--pass)">Edge validated</strong> — all 8 tests pass on a sample of ${sampleSize} trades.`
            : `${passCount} of 8 tests pass on a sample of ${sampleSize} trades.`;
        targetEl.innerHTML = msg;
    }

    root.Ekantik = root.Ekantik || {};
    root.Ekantik.BatteryUI = { renderTable, renderGlossary, renderStatusBanner, TEST_DEFS };
})(typeof window !== 'undefined' ? window : globalThis);
