// =====================================================
// 8-TEST SUSTAINABILITY BATTERY
// Ekantik 10x — Redesign v3, spec Part 6 + Appendix A
// Pure engine. No DOM, no fetch. UMD for browser + Node.
// =====================================================
(function (root) {
    'use strict';

    // ───────── Basic stats ─────────
    function sum(arr)  { let s = 0; for (const x of arr) s += x; return s; }
    function mean(arr) { return arr.length ? sum(arr) / arr.length : 0; }
    function stdDev(arr) {
        if (arr.length < 2) return 0;
        const m = mean(arr);
        let sq = 0;
        for (const x of arr) sq += (x - m) * (x - m);
        return Math.sqrt(sq / (arr.length - 1));
    }

    // ───────── Special functions ─────────
    // Gauss error function — Abramowitz & Stegun 7.1.26
    function erf(x) {
        const sign = x < 0 ? -1 : 1;
        x = Math.abs(x);
        const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741,
              a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
        const t = 1.0 / (1.0 + p * x);
        const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
        return sign * y;
    }
    function normalCDF(z) { return 0.5 * (1 + erf(z / Math.SQRT2)); }

    // Acklam's inverse normal CDF
    function normalQuantile(p) {
        if (p <= 0 || p >= 1) return p <= 0 ? -Infinity : Infinity;
        const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687,
                    138.3577518672690, -30.66479806614716, 2.506628277459239];
        const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866,
                    66.80131188771972, -13.28068155288572];
        const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838,
                   -2.549732539343734, 4.374664141464968, 2.938163982698783];
        const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996,
                   3.754408661907416];
        const plow = 0.02425, phigh = 1 - plow;
        let q, r;
        if (p < plow) {
            q = Math.sqrt(-2 * Math.log(p));
            return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
                   ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
        }
        if (p <= phigh) {
            q = p - 0.5; r = q * q;
            return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
                   (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
        }
        q = Math.sqrt(-2 * Math.log(1 - p));
        return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
                ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    }

    // Lanczos log-gamma
    function logGamma(x) {
        const c = [76.18009172947146, -86.50532032941677, 24.01409824083091,
                   -1.231739572450155, 0.001208650973866179, -0.000005395239384953];
        let y = x, tmp = x + 5.5;
        tmp -= (x + 0.5) * Math.log(tmp);
        let ser = 1.000000000190015;
        for (let j = 0; j < 6; j++) ser += c[j] / ++y;
        return -tmp + Math.log(2.5066282746310005 * ser / x);
    }

    // Continued fraction for the incomplete beta
    function betaCF(x, a, b) {
        const FPMIN = 1e-30, MAXIT = 200, EPS = 3e-9;
        const qab = a + b, qap = a + 1, qam = a - 1;
        let c = 1, d = 1 - qab * x / qap;
        if (Math.abs(d) < FPMIN) d = FPMIN;
        d = 1 / d;
        let h = d;
        for (let m = 1; m <= MAXIT; m++) {
            const m2 = 2 * m;
            let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
            d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
            c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
            d = 1 / d; h *= d * c;
            aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
            d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
            c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
            d = 1 / d;
            const del = d * c;
            h *= del;
            if (Math.abs(del - 1) < EPS) break;
        }
        return h;
    }

    // Regularized incomplete beta I_x(a, b)
    function incompleteBeta(x, a, b) {
        if (x <= 0) return 0;
        if (x >= 1) return 1;
        const lb = logGamma(a + b) - logGamma(a) - logGamma(b)
                 + a * Math.log(x) + b * Math.log(1 - x);
        const front = Math.exp(lb);
        if (x < (a + 1) / (a + b + 2)) return front * betaCF(x, a, b) / a;
        return 1 - front * betaCF(1 - x, b, a) / b;
    }

    // Student's t CDF (two-tailed-safe for all df ≥ 1)
    function tCDF(t, df) {
        if (df >= 400) return normalCDF(t);
        const x = df / (df + t * t);
        const ib = incompleteBeta(x, df / 2, 0.5);
        return t > 0 ? 1 - 0.5 * ib : 0.5 * ib;
    }

    // Student's t PDF (Stirling via logGamma)
    function tPDF(t, df) {
        const logCoeff = logGamma((df + 1) / 2)
                       - 0.5 * Math.log(df * Math.PI)
                       - logGamma(df / 2);
        const logKernel = -((df + 1) / 2) * Math.log(1 + t * t / df);
        return Math.exp(logCoeff + logKernel);
    }

    // Student's t quantile via Newton refinement of normal estimate
    function tQuantile(p, df) {
        if (df >= 400) return normalQuantile(p);
        let t = normalQuantile(p);
        for (let i = 0; i < 40; i++) {
            const pdf = tPDF(t, df);
            if (pdf < 1e-14) break;
            const delta = (tCDF(t, df) - p) / pdf;
            t -= delta;
            if (Math.abs(delta) < 1e-9) break;
        }
        return t;
    }

    // ───────── Field normalizer ─────────
    // tenx_trades.json uses snake_case; Tradovate parser output uses camelCase.
    // Accept both, standardize internally.
    function normalize(rawTrades) {
        if (!Array.isArray(rawTrades)) return [];
        const out = [];
        for (const t of rawTrades) {
            const dollarPL = t.dollarPL != null ? t.dollarPL : t.dollar_pl;
            if (typeof dollarPL !== 'number' || isNaN(dollarPL)) continue;
            const riskDollars = t.riskDollars != null ? t.riskDollars : t.risk_dollars;
            const isWin = t.isWin != null ? t.isWin : (t.is_win != null ? t.is_win : dollarPL > 0);
            out.push({ dollarPL, riskDollars: typeof riskDollars === 'number' ? riskDollars : 0, isWin });
        }
        return out;
    }

    // ───────── Test runner ─────────
    function runTests(rawTrades, opts) {
        opts = opts || {};
        const B = opts.bootstrapSize || 10000;
        const trades = normalize(rawTrades);
        const n = trades.length;

        const TEST_META = [
            { test: 1, name: 'Statistical Significance', threshold: 'p < 0.05' },
            { test: 2, name: 'Confidence Interval (95%)', threshold: 'lower > $0' },
            { test: 3, name: 'Profit Factor', threshold: '> 1.50' },
            { test: 4, name: 'Outlier Independence', threshold: '> $0 after top-3 removed' },
            { test: 5, name: 'R-Expectancy', threshold: '> +0.20R' },
            { test: 6, name: 'Breakeven Buffer', threshold: '> 10 pp' },
            { test: 7, name: 'Streak Resilience', threshold: '≤ 4 consecutive losses' },
            { test: 8, name: 'Bootstrap P(profit)', threshold: '> 85%' }
        ];

        if (n < 2) {
            return {
                meta: { sampleSize: n, computedAt: new Date().toISOString(), insufficient: true, passCount: 0, failCount: 0 },
                tests: TEST_META.map(m => Object.assign({}, m, { result: null, pass: false, display: '—', details: 'Awaiting first fills.' }))
            };
        }

        const pls = trades.map(t => t.dollarPL);
        const plMean = mean(pls);
        const plSD = stdDev(pls);
        const SE = plSD / Math.sqrt(n);

        // ── Test 1: one-sample t-test vs. 0
        let t1;
        if (plSD < 1e-9) {
            t1 = { result: plMean > 0 ? 0 : 1, pass: plMean > 0,
                   display: plMean > 0 ? 'p < 0.0001' : 'p = 1.0000',
                   details: `All ${n} trades identical P&L.` };
        } else {
            const tstat = plMean / SE;
            const p = 2 * (1 - tCDF(Math.abs(tstat), n - 1));
            t1 = {
                result: p, pass: p < 0.05,
                display: p < 0.0001 ? 'p < 0.0001' : `p = ${p.toFixed(4)}`,
                details: `t = ${tstat.toFixed(3)}, df = ${n - 1}, two-sided.`
            };
        }

        // ── Test 2: 95% CI for mean P&L per trade
        const tCrit = tQuantile(0.975, n - 1);
        const ciLow = plMean - tCrit * SE;
        const ciHigh = plMean + tCrit * SE;
        const t2 = {
            result: [ciLow, ciHigh], pass: ciLow > 0,
            display: `[$${ciLow.toFixed(0)}, $${ciHigh.toFixed(0)}]`,
            details: `mean = $${plMean.toFixed(2)}, SE = $${SE.toFixed(2)}, t-crit = ${tCrit.toFixed(3)}.`
        };

        // ── Test 3: profit factor
        let grossW = 0, grossL = 0;
        for (const x of pls) { if (x > 0) grossW += x; else if (x < 0) grossL += -x; }
        const pf = grossL === 0 ? Infinity : grossW / grossL;
        const t3 = {
            result: pf, pass: pf > 1.5,
            display: pf === Infinity ? '∞' : pf.toFixed(2),
            details: `gross wins $${grossW.toFixed(0)} ÷ gross losses $${grossL.toFixed(0)}.`
        };

        // ── Test 4: outlier independence (remove top 3 winners)
        const sortedDesc = [...pls].sort((a, b) => b - a);
        const trimmed = sortedDesc.slice(3);
        const remaining = sum(trimmed);
        const removed = sortedDesc.slice(0, 3);
        const t4 = {
            result: remaining, pass: remaining > 0,
            display: `$${remaining.toFixed(0)}`,
            details: `Removed top 3: $${removed.map(v => v.toFixed(0)).join(', $')}. Remaining ${trimmed.length} trades sum to $${remaining.toFixed(0)}.`
        };

        // ── Test 5: R-expectancy
        const withRisk = trades.filter(t => t.riskDollars > 0);
        let rExp = 0;
        if (withRisk.length > 0) {
            rExp = mean(withRisk.map(t => t.dollarPL / t.riskDollars));
        }
        const t5 = {
            result: rExp, pass: rExp > 0.20,
            display: `${rExp >= 0 ? '+' : ''}${rExp.toFixed(2)}R`,
            details: `${withRisk.length} of ${n} trades had a known stop; mean R-multiple of those.`
        };

        // ── Test 6: breakeven buffer
        const wins = pls.filter(x => x > 0);
        const losses = pls.filter(x => x < 0);
        const avgWin = wins.length ? mean(wins) : 0;
        const avgLoss = losses.length ? Math.abs(mean(losses)) : 0;
        const denom = avgWin + avgLoss;
        const breakevenWR = denom > 0 ? avgLoss / denom : 1;
        const actualWR = wins.length / n;
        const bufferPP = (actualWR - breakevenWR) * 100;
        const t6 = {
            result: bufferPP, pass: bufferPP > 10,
            display: `${bufferPP >= 0 ? '+' : ''}${bufferPP.toFixed(1)} pp`,
            details: `actual WR ${(actualWR * 100).toFixed(1)}% − breakeven WR ${(breakevenWR * 100).toFixed(1)}%.`
        };

        // ── Test 7: longest losing streak
        let maxStreak = 0, cur = 0;
        for (const x of pls) { if (x < 0) { cur++; if (cur > maxStreak) maxStreak = cur; } else cur = 0; }
        const t7 = {
            result: maxStreak, pass: maxStreak <= 4,
            display: `${maxStreak} consecutive`,
            details: `Longest run of losing trades observed in the sample.`
        };

        // ── Test 8: bootstrap P(profit)
        let profitable = 0;
        for (let i = 0; i < B; i++) {
            let s = 0;
            for (let j = 0; j < n; j++) s += pls[(Math.random() * n) | 0];
            if (s > 0) profitable++;
        }
        const pProfit = profitable / B;
        const t8 = {
            result: pProfit, pass: pProfit > 0.85,
            display: `${(pProfit * 100).toFixed(1)}%`,
            details: `${B.toLocaleString()} resamples with replacement; ${profitable.toLocaleString()} ended profitable.`
        };

        const results = [t1, t2, t3, t4, t5, t6, t7, t8].map((r, i) =>
            Object.assign({}, TEST_META[i], r));

        const passCount = results.filter(r => r.pass).length;
        return {
            meta: {
                sampleSize: n,
                computedAt: new Date().toISOString(),
                passCount,
                failCount: 8 - passCount,
                allPassed: passCount === 8,
                bootstrapSize: B
            },
            tests: results
        };
    }

    // ───────── Hero summary stats ─────────
    // Not a "test" — lives here so hero and battery share one source of truth.
    function summaryStats(rawTrades) {
        const trades = normalize(rawTrades);
        const n = trades.length;
        if (n === 0) return { n: 0, winRate: null, profitFactor: null, rExpectancy: null, evPerTrade: null };

        const pls = trades.map(t => t.dollarPL);
        const wins = pls.filter(x => x > 0);
        let grossW = 0, grossL = 0;
        for (const x of pls) { if (x > 0) grossW += x; else if (x < 0) grossL += -x; }

        const winRate = wins.length / n;
        const profitFactor = grossL === 0 ? Infinity : grossW / grossL;
        const evPerTrade = sum(pls) / n;

        const withRisk = trades.filter(t => t.riskDollars > 0);
        const rExpectancy = withRisk.length ? mean(withRisk.map(t => t.dollarPL / t.riskDollars)) : null;

        return { n, winRate, profitFactor, evPerTrade, rExpectancy };
    }

    // ───────── UMD export ─────────
    const api = {
        runTests, summaryStats,
        // Expose helpers so test-battery.js and charts can reuse them:
        _stats: { mean, stdDev, tCDF, tQuantile, normalCDF, normalQuantile }
    };
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    } else {
        root.Ekantik = root.Ekantik || {};
        root.Ekantik.Battery = api;
    }
})(typeof window !== 'undefined' ? window : global);
