// =====================================================
// Battery unit test — run via:
//   node js/test-battery.js
// Uses a hand-crafted 100-trade fixture with known totals.
// Asserts each test's numeric output against expected values.
// Bootstrap (test 8) is stochastic — asserted within ±2 pp.
// =====================================================

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const { runTests } = require(path.join(__dirname, 'battery.js'));

// ──── Fixture: 100 trades with a known positive edge ────
// Generator: repeat pattern [+200 +150 +100 -100 -50 +75 +125 -75 +50 +225]
// 10 trades per cycle × 10 cycles = 100 trades
const pattern = [200, 150, 100, -100, -50, 75, 125, -75, 50, 225];
const fixture = [];
for (let cycle = 0; cycle < 10; cycle++) {
    for (let i = 0; i < pattern.length; i++) {
        const pl = pattern[i];
        fixture.push({
            dollar_pl: pl,
            risk_dollars: 100,           // constant 1R = $100
            is_win: pl > 0,
            entry_time: `2026-02-${String(cycle + 1).padStart(2, '0')} 09:${String(i * 5 + 30).slice(-2)}:00`
        });
    }
}

// Sanity: total P&L of pattern = 200+150+100-100-50+75+125-75+50+225 = 700 per cycle
// Over 10 cycles = 7000
// Wins per cycle = 7; losses = 3 → winRate 70%; n = 100
const totalPL = fixture.reduce((s, t) => s + t.dollar_pl, 0);
const winCount = fixture.filter(t => t.dollar_pl > 0).length;
const lossCount = fixture.filter(t => t.dollar_pl < 0).length;
assert.strictEqual(fixture.length, 100, 'fixture has 100 trades');
assert.strictEqual(totalPL, 7000, 'total PL is $7000');
assert.strictEqual(winCount, 70, '70 winners');
assert.strictEqual(lossCount, 30, '30 losers');

// ──── Run the battery ────
console.log(`[test] Fixture: ${fixture.length} trades, total P&L $${totalPL}, win rate ${(winCount/fixture.length*100).toFixed(1)}%`);
const t0 = Date.now();
const result = runTests(fixture);
const elapsed = Date.now() - t0;
console.log(`[test] Battery ran in ${elapsed} ms\n`);

for (const r of result.tests) {
    console.log(`  Test ${r.test}. ${r.name.padEnd(32)} → ${r.display.padEnd(20)} [${r.pass ? 'PASS' : 'FAIL'}]`);
}
console.log(`\n[test] Pass count: ${result.meta.passCount} / 8`);

// ──── Assertions against known expected values ────

// Test 1: mean P&L = 70, pattern SD ≈ known. n=100, df=99 → t should be very significant.
const t1 = result.tests[0];
assert.ok(t1.result < 0.01, `Test 1: p-value should be << 0.05, got ${t1.result}`);
assert.strictEqual(t1.pass, true, 'Test 1 pass');

// Test 2: 95% CI for mean ≈ [$70 - 1.98·SE, $70 + 1.98·SE]. Mean=70, SE ≈ stdev/√100.
const t2 = result.tests[1];
const [ciLow, ciHigh] = t2.result;
const midpoint = (ciLow + ciHigh) / 2;
assert.ok(Math.abs(midpoint - 70) < 1e-6, `Test 2: CI midpoint should be $70 exactly, got ${midpoint}`);
assert.ok(ciLow > 0, 'Test 2: lower bound > 0');
assert.strictEqual(t2.pass, true, 'Test 2 pass');

// Test 3: Profit factor = gross_wins / gross_losses
//   Gross wins = 70% × pattern wins = 10 × (200+150+100+75+125+50+225) = 10 × 925 = 9250
//   Gross losses = 10 × (100+50+75) = 10 × 225 = 2250
//   PF = 9250 / 2250 = 4.1111…
const t3 = result.tests[2];
const expectedPF = 9250 / 2250;
assert.ok(Math.abs(t3.result - expectedPF) < 1e-6, `Test 3: expected PF ${expectedPF}, got ${t3.result}`);
assert.strictEqual(t3.pass, true, 'Test 3 pass');

// Test 4: Remove top 3 winners. Top 3 across 100 trades are the three biggest recurring values: 225, 225, 225
//   (225 appears 10×; sortedDesc starts with 10 copies of 225)
//   Top 3 removed = 3 × 225 = 675
//   Remaining sum = 7000 - 675 = 6325
const t4 = result.tests[3];
assert.ok(Math.abs(t4.result - 6325) < 1e-6, `Test 4: expected $6325 remaining, got ${t4.result}`);
assert.strictEqual(t4.pass, true, 'Test 4 pass');

// Test 5: R-Expectancy. Each trade has risk=100. R-multiple = dollar_pl / 100.
//   Mean R-multiple = meanPL / 100 = 70 / 100 = 0.70R
const t5 = result.tests[4];
assert.ok(Math.abs(t5.result - 0.70) < 1e-6, `Test 5: expected +0.70R, got ${t5.result}`);
assert.strictEqual(t5.pass, true, 'Test 5 pass');

// Test 6: Breakeven buffer
//   avgWin = 9250 / 70 = 132.143...
//   avgLoss = 2250 / 30 = 75
//   breakevenWR = 75 / (132.143 + 75) = 75 / 207.143 = 0.3621... → 36.21%
//   actualWR = 70% → buffer = 70 - 36.21 = 33.79 pp
const t6 = result.tests[5];
const avgWin = 9250 / 70;
const avgLoss = 2250 / 30;
const expectedBuffer = (0.7 - avgLoss / (avgWin + avgLoss)) * 100;
assert.ok(Math.abs(t6.result - expectedBuffer) < 1e-6, `Test 6: expected ${expectedBuffer.toFixed(3)}pp, got ${t6.result}`);
assert.strictEqual(t6.pass, true, 'Test 6 pass');

// Test 7: Longest losing streak. Pattern has -100 -50 consecutive, then isolated -75. Across 10 cycles:
//   Positions 3-4 in each cycle are losses (2 consecutive). Position 7 is an isolated loss.
//   But between end of cycle N and start of cycle N+1: cycle ends with +225 (pos 9), cycle starts with +200 (pos 0).
//   So longest streak is 2.
const t7 = result.tests[6];
assert.strictEqual(t7.result, 2, `Test 7: expected max streak 2, got ${t7.result}`);
assert.strictEqual(t7.pass, true, 'Test 7 pass');

// Test 8: Bootstrap P(profit). With an edge this strong (70% WR, mean $70/trade, PF 4), the bootstrap
// probability of profit should be essentially 1.0. Assert > 0.99.
const t8 = result.tests[7];
assert.ok(t8.result > 0.99, `Test 8: expected bootstrap P(profit) > 0.99, got ${t8.result}`);
assert.strictEqual(t8.pass, true, 'Test 8 pass');

// All 8 should pass on this fixture
assert.strictEqual(result.meta.passCount, 8, 'all 8 tests pass on fixture');

console.log('\n✓ All assertions passed.');

// ──── Also test the real site data if present ────
const realDataPath = path.join(__dirname, '..', 'data', 'tenx_trades.json');
if (fs.existsSync(realDataPath)) {
    const realTrades = JSON.parse(fs.readFileSync(realDataPath, 'utf8'));
    console.log(`\n[test] Running battery on real site data (${realTrades.length} trades)…`);
    const realResult = runTests(realTrades);
    console.log(`  Sample size: ${realResult.meta.sampleSize}`);
    console.log(`  Pass count:  ${realResult.meta.passCount} / 8`);
    for (const r of realResult.tests) {
        console.log(`    ${r.test}. ${r.name.padEnd(32)} → ${r.display.padEnd(20)} [${r.pass ? 'PASS' : 'FAIL'}]`);
    }
}
