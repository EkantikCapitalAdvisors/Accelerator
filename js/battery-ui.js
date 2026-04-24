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
            question: 'Could this just be luck?',
            lead: 'Every streak of winning trades has two possible explanations: skill, or the particular way randomness happened to shake out this time. The p-value puts a number on the second one.',
            analogy: 'Think of a coin you suspect is weighted. You flip it 20 times and get 13 heads. Is the coin biased? Maybe — but a fair coin produces 13+ heads about 13% of the time. That\'s not rare enough to be sure. Flip it 200 times and get 130 heads, and a fair coin produces that less than 1 in 1,000 times. <em>Now</em> you\'re confident the coin is biased.',
            passExample: '<strong>100 trades, 65% win rate, winners slightly larger than losers.</strong> Computed <span class="mono">p = 0.001</span>. Less than a 1-in-1,000 chance this came from a coin flip. Edge is almost certainly real.',
            failExample: '<strong>50 trades, 52% win rate, thin edge.</strong> Computed <span class="mono">p = 0.40</span>. Forty percent of the time, random guessing would produce results this good. Nothing proven.',
            why: 'Your strategy might have an edge. Or you might just have gotten lucky. This test is the first firewall.',
            measures: 'How likely the observed edge came from random chance alone, via a one-sample t-test against a null of zero mean P&L per trade.',
            matters: 'If the edge can plausibly be explained by luck, no further testing is informative. This is the foundation.',
            formula: 't = mean / (SD / √n) ; p = 2·(1 − T_CDF(|t|, n−1))',
            rationale: 'p < 0.05 is the long-standing convention for "statistically significant" — the observed mean has less than a 5% chance of arising under the null.'
        },
        {
            id: 2, short: '95% CI',
            name: 'Confidence Interval (95%)',
            threshold: 'lower bound > $0',
            question: 'How reliable is the per-trade profit number?',
            lead: 'Every statistic from a sample has an error bar. The confidence interval is that error bar made explicit. The question is not just "is the average positive?" — it\'s "is the whole plausible range positive?"',
            analogy: 'If a pollster tells you Candidate A is leading with 52% support, that\'s meaningless without the margin of error. If the margin is ±1 point (51–53%), Candidate A is definitely ahead. If the margin is ±5 points (47–57%), the race is a toss-up. Same point estimate, completely different implication.',
            passExample: '<strong>Average profit $150/trade, 95% CI = [$80, $220].</strong> Even in the worst plausible replay, the strategy is profitable. Lower bound is well above zero.',
            failExample: '<strong>Average profit $150/trade, 95% CI = [−$40, $340].</strong> In a meaningful chunk of alternate replays this strategy actually <em>loses</em> money. You can\'t tell which universe you\'re in.',
            why: 'A strategy that <em>might</em> be profitable is not a strategy. It\'s a hope. This test demands the whole distribution be positive.',
            measures: 'The range within which the true per-trade expectancy is expected to lie, 19 times out of 20, given the sample.',
            matters: 'If the whole interval is above zero, the edge is robust to sampling variance — the sample is not close to being profitable by accident.',
            formula: 'mean ± t_crit · SE,  SE = SD / √n',
            rationale: 'Lower bound > 0 is a stricter requirement than significance: not only is the mean unlikely to be zero, we can claim with 95% confidence it is positive.'
        },
        {
            id: 3, short: 'PF',
            name: 'Profit Factor',
            threshold: '> 1.50',
            question: 'For every $1 you lose, how many $ do you make?',
            lead: 'A retail business that brings in $1.05 for every $1 of costs is a bad business — one bad month and it loses money. A business that brings in $2.50 for every $1 of costs is a real business. Trading systems work the same way. Profit factor is that ratio.',
            analogy: 'The critical thing this test reveals is whether the strategy engineers <em>asymmetry</em>: losers capped small, winners allowed to run. Without asymmetry, a strategy is betting on win-rate alone — which collapses the moment market conditions shift.',
            passExample: '<strong>Won $24,700 across winners, lost $10,000 across losers.</strong> Profit factor <span class="mono">2.47</span>. For every dollar risked on a bad trade, the strategy extracts $2.47 on good ones.',
            failExample: '<strong>Won $11,000, lost $10,000.</strong> Profit factor <span class="mono">1.10</span>. Technically profitable, but the margin is razor-thin. One bad week erases the whole edge.',
            why: 'This test tells you whether the strategy is a business or a gambling habit with better PR.',
            measures: 'Dollars earned on winning trades per dollar lost on losing trades.',
            matters: 'A profit factor above 1.50 is considered institutional-grade; above 2.00 is rare.',
            formula: 'Σ wins / |Σ losses|',
            rationale: '1.50 is a conservative institutional threshold; anything lower leaves too little margin for regime changes.'
        },
        {
            id: 4, short: 'Top-3',
            name: 'Outlier Independence',
            threshold: '> $0 after removing top 3 winners',
            question: 'Does the edge survive without the three biggest wins?',
            lead: 'Every impressive track record can be investigated one way: remove the biggest few winners and see what\'s left. A real edge produces profit consistently; remove the top outliers and the strategy is still making money, just less of it. A fake edge depends on a handful of miracles; remove them and the strategy is actually a loser.',
            analogy: 'Imagine a poker player with a $50,000 bankroll who claims to be a winning player. You ask how the $50K was built. If the answer is "one $48,000 hand plus a lot of small wins and losses netting $2,000," they\'re not a winning player — they got lucky once. A winning player\'s bankroll is built from many hands, each contributing.',
            passExample: '<strong>$30K profit from 80 trades. Remove the three biggest wins: <span class="mono">$22K</span> remains.</strong> Still profitable. The edge shows up across the sample, not in a few trades.',
            failExample: '<strong>$30K profit from 80 trades. Remove the three biggest wins: <span class="mono">−$4K</span>.</strong> Without those three trades, the strategy lost money. The edge is a story about luck, not skill.',
            why: 'Lucky once is a story. Lucky across eighty trades is a system.',
            measures: 'Whether the sample is still profitable after the three largest winning trades are removed.',
            matters: 'An edge that depends on two or three lottery wins is not a repeatable edge — it is a lucky sample. Real edges are distributed.',
            formula: 'Σ ( P&L − top 3 wins ) > 0',
            rationale: '"Remove the big wins" is the single strongest heuristic for separating distributed edges from survivorship-biased ones.'
        },
        {
            id: 5, short: 'R-exp',
            name: 'R-Expectancy',
            threshold: '> +0.20R',
            question: 'How much do you earn per unit of risk?',
            lead: 'R-expectancy is the unit-free efficiency rating of an edge. It strips away trade size and dollar amounts and asks the pure question: per unit of risk deployed, how much is returned?',
            analogy: 'A strategy risking $500 per trade with an average profit of $100 per trade has an R-expectancy of 0.20R. Scale it up to $5,000 risk and it still has 0.20R expectancy ($1,000 profit). The number tells you whether the edge is <em>efficient enough</em> to deserve the capital you\'re pointing at it.',
            passExample: '<strong>Risk $500/trade, average profit $200/trade.</strong> R-expectancy <span class="mono">+0.40R</span>. Every dollar of risk produces forty cents of profit on average. Scaling is meaningful.',
            failExample: '<strong>Risk $500/trade, average profit $40/trade.</strong> R-expectancy <span class="mono">+0.08R</span>. Real edge — but only 8 cents per dollar risked. Not worth the deployment, and fragile under any friction (slippage, taxes, fees).',
            why: 'Some strategies are profitable but barely so. This test refuses to dress up a thin edge as a business.',
            measures: 'Average expected profit per unit of risk deployed (mean of P&L ÷ stop-distance per trade).',
            matters: 'R-expectancy normalizes across trade sizes and is how professional desks compare strategies.',
            formula: 'mean( dollarPL_i / riskDollars_i )',
            rationale: '+0.20R per trade is the conventional threshold where a strategy is producing meaningful expectancy after costs.'
        },
        {
            id: 6, short: 'Buffer',
            name: 'Breakeven Buffer',
            threshold: '> 10 percentage points',
            question: 'How far above the break-even win rate are you?',
            lead: 'Every strategy has a minimum win rate below which it stops making money. If your winners average $100 and your losers average $100, you need to win 50% to break even. If winners are $200 and losers are $100, you need only 33.4% to break even. The buffer is how far your <em>actual</em> win rate sits above that floor.',
            analogy: 'A thin buffer means the strategy is fragile: any regime shift that compresses win rate by a few points wipes out the edge entirely. A thick buffer means the strategy survives changes in market conditions — because even a meaningfully degraded win rate still clears the break-even floor.',
            passExample: '<strong>Win rate 65%, break-even win rate 50%.</strong> Buffer <span class="mono">15 pp</span>. Conditions could deteriorate meaningfully and the strategy would still be profitable.',
            failExample: '<strong>Win rate 54%, break-even 50%.</strong> Buffer <span class="mono">4 pp</span>. A small regime change — a bit more chop, a bit more slippage — and the strategy goes to zero expected value.',
            why: 'Markets change. This test asks whether your edge survives the change — or requires the present regime to persist forever.',
            measures: 'How many percentage points above the breakeven win rate the sample\'s actual win rate sits.',
            matters: 'The bigger this cushion, the more the edge can survive a regime that compresses win rate.',
            formula: 'actual WR − avgLoss / (avgWin + avgLoss)',
            rationale: '10 pp is the point at which a strategy stops being vulnerable to a bad month flipping its expectancy negative.'
        },
        {
            id: 7, short: 'Streak',
            name: 'Streak Resilience',
            threshold: '≤ 4 consecutive losses',
            question: 'How many losses in a row before the operator breaks?',
            lead: 'A strategy that\'s profitable in the long run but routinely delivers ten consecutive losses will not survive contact with a real operator. The math might work over 500 trades; the psychology will break by loss number six.',
            analogy: 'This is where active trading systems and passive exposure diverge sharply. Active systems with stops and selectivity produce short streaks; passive exposure — which rides every drawdown to the bottom — regularly produces 6–8 consecutive losing days even in bull markets.',
            passExample: '<strong>Longest losing streak: <span class="mono">3</span> consecutive losses.</strong> Painful but survivable. Most operators can absorb three losses and stay disciplined.',
            failExample: '<strong>Longest streak: <span class="mono">8</span> consecutive losses.</strong> Most real traders tilt, over-size, or quit by loss 5. A mathematically profitable strategy the human can\'t execute produces zero returns.',
            why: 'An edge that can\'t be executed is not an edge. This test is the battery\'s concession to the human being at the keyboard.',
            measures: 'The longest observed run of back-to-back losing trades in the sample.',
            matters: 'Streaks are statistically expected even for real edges — but long streaks break operators before they break the math.',
            formula: 'max( run of consecutive dollarPL < 0 )',
            rationale: '≤ 4 keeps drawdown-driven operator decisions in the rational zone; above that, discipline erodes.'
        },
        {
            id: 8, short: 'Bootstrap',
            name: 'Bootstrap P(profit)',
            threshold: '> 85%',
            question: 'Does the edge hold if the trades had happened in a different order?',
            lead: 'This is the most robust test in the battery, and the hardest to game. It takes every trade you made — same wins, same losses, identical distribution — and asks what would have happened if they\'d arrived in a different sequence.',
            analogy: 'A genuine edge is order-independent. Reshuffle the trades and you still end profitable, because the profit comes from the distribution of outcomes, not their timing. A <em>fragile</em> edge — one that only works because a big win arrived early and funded the later losses — falls apart under reshuffling. This test catches sequence-dependent flukes every other test can miss.',
            passExample: '<strong>10,000 reshuffles, <span class="mono">97%</span> end profitable.</strong> The edge is structural. Whatever order the trades arrived in, the distribution produces profit. This is what a real edge looks like.',
            failExample: '<strong>10,000 reshuffles, <span class="mono">62%</span> end profitable.</strong> In 38% of alternate universes — same exact trades — the strategy lost money. What you observed was lucky sequencing, not structural edge.',
            why: 'Every other test can be fooled by a strategy that got lucky at just the right moment. This one cannot.',
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
                  <blockquote class="glossary__question">${def.question}</blockquote>
                  <p class="glossary__lead">${def.lead}</p>
                  <p>${def.analogy}</p>
                  <div class="glossary__examples">
                    <div class="glossary__example glossary__example--pass">
                      <span class="glossary__example-tag">Pass &middot; Real edge</span>
                      ${def.passExample}
                    </div>
                    <div class="glossary__example glossary__example--fail">
                      <span class="glossary__example-tag">Fail &middot; Fragile or fake</span>
                      ${def.failExample}
                    </div>
                  </div>
                  <div class="glossary__threshold">
                    <span class="glossary__threshold-label">Threshold</span>
                    <span class="glossary__threshold-val">${def.threshold}</span>
                    <span class="glossary__threshold-note">${def.rationale}</span>
                  </div>
                  <p>${resultLine}</p>
                  ${details ? `<div class="glossary__calc"><strong>Calculation on current sample:</strong><br>${details}</div>` : ''}
                  <details class="glossary__detail-nested"><summary>How it's computed</summary>
                    <p>${def.measures}</p>
                    <p><strong>Formula.</strong> <span class="glossary__formula">${def.formula}</span></p>
                  </details>
                  <p class="glossary__why">&ldquo;${def.why}&rdquo;</p>
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

    // ─── Hub-and-spoke overview graphic ───
    // Single-sentence summaries that answer "what does this test validate?" in layman terms.
    // Kept separate from the richer glossary so they can function as a visual TOC.
    const ONE_LINERS = {
        1: 'Rules out pure luck as the explanation.',
        2: 'Profitable even in the worst plausible replay.',
        3: 'Winners dwarf losers by a comfortable margin.',
        4: 'The edge survives without its three biggest wins.',
        5: 'Every dollar of risk returns meaningful profit.',
        6: 'Enough cushion above breakeven to survive a regime shift.',
        7: 'Losing streaks short enough to keep discipline intact.',
        8: 'Wins in almost every reshuffle of its own trades.'
    };

    // Angular positions for 8 satellites starting at top, going clockwise.
    // Values are {x%, y%} with container-relative percentages (center at 50,50).
    const SPOKE_POS = [
        { x: 50,    y: 12    },   // 0°   — top
        { x: 76.87, y: 23.13 },   // 45°  — top-right
        { x: 88,    y: 50    },   // 90°  — right
        { x: 76.87, y: 76.87 },   // 135° — bottom-right
        { x: 50,    y: 88    },   // 180° — bottom
        { x: 23.13, y: 76.87 },   // 225° — bottom-left
        { x: 12,    y: 50    },   // 270° — left
        { x: 23.13, y: 23.13 }    // 315° — top-left
    ];

    function renderEdgeHub(targetEl) {
        if (!targetEl) return;
        const lines = SPOKE_POS.map(p =>
            `<line x1="50" y1="50" x2="${p.x}" y2="${p.y}" stroke="rgba(200,169,81,0.32)" stroke-width="0.25"/>`
        ).join('');
        const satellites = TEST_DEFS.map((def, i) => {
            const p = SPOKE_POS[i];
            return `
              <a class="edge-hub__sat" href="#glossary-t${def.id}"
                 style="top:${p.y}%; left:${p.x}%;"
                 data-goto="t${def.id}">
                <span class="edge-hub__sat-num">${String(def.id).padStart(2, '0')}</span>
                <span class="edge-hub__sat-name">${def.name.replace(/\s+\(.*\)\s*$/, '')}</span>
                <span class="edge-hub__sat-desc">${ONE_LINERS[def.id]}</span>
              </a>`;
        }).join('');

        targetEl.innerHTML = `
          <figure class="edge-hub" aria-label="Eight attributes of a sustainable trading edge">
            <svg class="edge-hub__svg" viewBox="0 0 100 100" aria-hidden="true" preserveAspectRatio="none">
              ${lines}
            </svg>
            <div class="edge-hub__center">
              <span class="edge-hub__center-eyebrow">The Eight Attributes of</span>
              <span class="edge-hub__center-title">A Sustainable Edge</span>
            </div>
            ${satellites}
          </figure>`;

        // Clicking a satellite scroll-snaps to its glossary card and opens it.
        targetEl.querySelectorAll('[data-goto]').forEach(a => {
            a.addEventListener('click', (e) => {
                const id = a.getAttribute('data-goto');
                const el = document.getElementById('glossary-' + id);
                if (el) {
                    e.preventDefault();
                    if (el.tagName === 'DETAILS') el.open = true;
                    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            });
        });
    }

    root.Ekantik = root.Ekantik || {};
    root.Ekantik.BatteryUI = { renderTable, renderGlossary, renderStatusBanner, renderEdgeHub, TEST_DEFS };
})(typeof window !== 'undefined' ? window : globalThis);
