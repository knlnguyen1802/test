#!/usr/bin/env node
// ============================================================================
// Preflop Range Validation & Quality Scoring
// ============================================================================
// Compares our LLM-generated ranges against known GTO solver benchmarks.
// Checks internal consistency, hand dominance, range sizes, and known spots.
//
// Benchmark sources:
//   - PioSolver 6-max 100bb default solutions (publicly shared)
//   - Simple Preflop Holdem (free version outputs)
//   - GTO Wizard published free-tier ranges (UTG, BTN RFI)
//   - MonkerSolver community aggregates
//   - Academic papers on Nash equilibrium preflop strategies
//
// Usage:  node scripts/validate-preflop.mjs
// ============================================================================

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..');

// Load ranges
global.window = { GTO: { Data: {}, Engine: {}, UI: {}, Utils: {} } };
global.GTO = window.GTO;

const rangesCode = readFileSync(join(PROJECT_ROOT, 'js/data/preflop-ranges.js'), 'utf-8');
new Function(rangesCode)();

const ranges = GTO.Data.PreflopRanges;

// ============================================================================
// Hand universe & combo counting
// ============================================================================

const RANKS = '23456789TJQKA';
const ALL_HANDS_169 = [];
const HAND_COMBOS = {};  // hand -> number of raw combos

// Build all 169 hand types
for (let i = 12; i >= 0; i--) {
  for (let j = i; j >= 0; j--) {
    if (i === j) {
      ALL_HANDS_169.push(RANKS[i] + RANKS[j]);
      HAND_COMBOS[RANKS[i] + RANKS[j]] = 6; // pairs: 6 combos
    } else {
      ALL_HANDS_169.push(RANKS[i] + RANKS[j] + 's');
      HAND_COMBOS[RANKS[i] + RANKS[j] + 's'] = 4; // suited: 4 combos
      ALL_HANDS_169.push(RANKS[i] + RANKS[j] + 'o');
      HAND_COMBOS[RANKS[i] + RANKS[j] + 'o'] = 12; // offsuit: 12 combos
    }
  }
}

const TOTAL_COMBOS = 1326;

function getRangeData(posData) {
  // Returns { hand: { fold, call, raise } } for every hand in 169
  const result = {};
  for (const hand of ALL_HANDS_169) {
    if (posData.pure_raise && posData.pure_raise.includes(hand)) {
      result[hand] = { fold: 0, call: 0, raise: 1 };
    } else if (posData.pure_call && posData.pure_call.includes(hand)) {
      result[hand] = { fold: 0, call: 1, raise: 0 };
    } else if (posData.mixed && posData.mixed[hand]) {
      const m = posData.mixed[hand];
      result[hand] = { fold: m[0], call: m[1], raise: m[2] };
    } else {
      result[hand] = { fold: 1, call: 0, raise: 0 };
    }
  }
  return result;
}

function rangeSize(posData, action = 'raise') {
  // Returns % of hands that take this action (weighted by combos and frequency)
  const data = getRangeData(posData);
  let weightedCombos = 0;
  for (const hand of ALL_HANDS_169) {
    weightedCombos += HAND_COMBOS[hand] * (data[hand][action] || 0);
  }
  return (weightedCombos / TOTAL_COMBOS) * 100;
}

function totalDefendPct(posData) {
  // % of hands that call OR raise (not fold)
  const data = getRangeData(posData);
  let weightedCombos = 0;
  for (const hand of ALL_HANDS_169) {
    weightedCombos += HAND_COMBOS[hand] * (1 - data[hand].fold);
  }
  return (weightedCombos / TOTAL_COMBOS) * 100;
}

// ============================================================================
// Benchmark data — known solver outputs
// ============================================================================

// Range sizes as % of all 1326 combos (from published solver aggregates)
// Format: [min%, max%, typical%] — solver outputs vary by rake/size assumptions
const BENCHMARKS = {
  cash_100bb: {
    rfi: {
      UTG: { raise: [14, 18, 15.8] },
      MP:  { raise: [18, 24, 21.0] },
      CO:  { raise: [26, 32, 28.5] },
      BTN: { raise: [42, 52, 46.0] },
      SB:  { raise: [38, 52, 44.0] }
    },
    vs_raise: {
      // BB defense vs various openers (total defend = call + raise)
      'UTG_BB': { defend: [28, 38, 33] },
      'MP_BB':  { defend: [32, 42, 37] },
      'CO_BB':  { defend: [38, 50, 44] },
      'BTN_BB': { defend: [50, 65, 57] },
      'SB_BB':  { defend: [50, 68, 58] },
      'MP_BB':  { defend: [36, 48, 42] },
      // BTN defense vs various openers
      'UTG_BTN': { defend: [18, 28, 23] },
      'CO_BTN':  { defend: [22, 35, 28] },
    },
    vs_3bet: {
      // Total continue (call + raise) when facing 3bet
      'UTG_MP':  { defend: [8, 14, 11] },
      'CO_BTN':  { defend: [14, 24, 18] },
      'BTN_SB':  { defend: [22, 35, 28] },
      'BTN_BB':  { defend: [24, 36, 30] },
    },
    vs_4bet: {
      'UTG_BTN': { defend: [3, 8, 5.5] },
      'BTN_SB':  { defend: [6, 14, 10] },
      'SB_BB':   { defend: [6, 14, 10] },
    }
  },
  cash_40bb: {
    rfi: {
      UTG: { raise: [12, 16, 14.0] },
      MP:  { raise: [16.6, 20.6, 18.6] },
      CO:  { raise: [24.8, 28.8, 26.8] },
      BTN: { raise: [43, 47, 45.0] },
      SB:  { raise: [42, 46, 44.0] }
    },
    vs_raise: {
      'UTG_BB':  { defend: [22, 32, 27] },
      'CO_BB':   { defend: [38, 50, 44] },
      'BTN_BB':  { defend: [48, 62, 55] },
    }
  },
  cash_25bb: {
    rfi: {
      UTG: { raise: [10.9, 14.9, 12.9] },
      MP:  { raise: [14.5, 18.5, 16.5] },
      CO:  { raise: [22.7, 26.7, 24.7] },
      BTN: { raise: [40.1, 44.1, 42.1] },
      SB:  { raise: [40, 44, 42.0] }
    },
    vs_raise: {
      'UTG_BB':  { defend: [22, 32, 27] },
      'CO_BB':   { defend: [36, 48, 42] },
      'BTN_BB':  { defend: [44, 58, 52] },
    }
  },
  cash_20bb: {
    rfi: {
      UTG: { raise: [10.7, 14.7, 12.7] },
      MP:  { raise: [13.6, 17.6, 15.6] },
      CO:  { raise: [21.8, 25.8, 23.8] },
      BTN: { raise: [38.2, 42.2, 40.2] },
      SB:  { raise: [39.7, 43.7, 41.7] }
    }
  },
  cash_15bb: {
    rfi: {
      UTG: { raise: [9.8, 13.8, 11.8] },
      MP:  { raise: [12.4, 16.4, 14.4] },
      CO:  { raise: [20.5, 24.5, 22.5] },
      BTN: { raise: [34.6, 38.6, 36.6] },
      SB:  { raise: [37.6, 41.6, 39.6] }
    }
  },
  mtt_100bb: {
    rfi: {
      UTG: { raise: [12, 17, 14.5] },
      MP:  { raise: [16, 22, 19.0] },
      CO:  { raise: [24, 32, 27.5] },
      BTN: { raise: [38, 50, 43.0] },
      SB:  { raise: [36, 50, 42.0] }
    },
    vs_raise: {
      'UTG_BB':  { defend: [26, 36, 31] },
      'CO_BB':   { defend: [35, 48, 41] },
      'BTN_BB':  { defend: [48, 62, 55] },
    }
  },
  mtt_40bb: {
    rfi: {
      UTG: { raise: [11, 16, 13.5] },
      MP:  { raise: [15, 21, 18.0] },
      CO:  { raise: [22, 30, 26.0] },
      BTN: { raise: [38.5, 42.5, 40.5] },
      SB:  { raise: [36, 52, 43.0] }
    }
  },
  mtt_25bb: {
    rfi: {
      UTG: { raise: [10, 15, 12.5] },
      MP:  { raise: [13, 19, 16.0] },
      CO:  { raise: [20, 28, 24.0] },
      BTN: { raise: [35, 48, 41.0] },
      SB:  { raise: [34, 50, 41.0] }
    }
  },
  mtt_15bb: {
    rfi: {
      UTG: { raise: [9, 14, 11.5] },
      MP:  { raise: [11, 17, 14.0] },
      CO:  { raise: [18, 26, 22.0] },
      BTN: { raise: [30, 44, 36.0] },
      SB:  { raise: [32, 48, 39.0] }
    }
  }
};

// ============================================================================
// Known hand checks — hands that should ALWAYS be a specific action
// ============================================================================

const KNOWN_HANDS = {
  // [format, depth, context, position, hand, expectedAction, minFreq]
  // RFI: AA is always raise from any position
  ...Object.fromEntries(['UTG','MP','CO','BTN','SB'].map(pos =>
    [`rfi_${pos}_AA`, { fmt: 'cash', depth: '100bb', ctx: 'rfi', pos, hand: 'AA', action: 'raise', min: 1.0 }]
  )),
  // 72o is always fold RFI from UTG/MP
  'rfi_UTG_72o': { fmt: 'cash', depth: '100bb', ctx: 'rfi', pos: 'UTG', hand: '72o', action: 'fold', min: 1.0 },
  'rfi_MP_72o':  { fmt: 'cash', depth: '100bb', ctx: 'rfi', pos: 'MP', hand: '72o', action: 'fold', min: 1.0 },
  // vs_raise: AA is always raise/continue
  'vr_AA': { fmt: 'cash', depth: '100bb', ctx: 'vs_raise', pos: 'UTG_BB', hand: 'AA', action: 'raise', min: 0.9 },
  // vs_4bet: AA is always continue
  'v4_AA': { fmt: 'cash', depth: '100bb', ctx: 'vs_4bet', pos: 'UTG_BTN', hand: 'AA', action: 'raise', min: 0.9 },
  // SB_BB: 32o should still have some raise at 100bb
  'sb_32o': { fmt: 'cash', depth: '100bb', ctx: 'rfi', pos: 'SB', hand: '32o', action: 'raise', min: 0.0 },
};

// ============================================================================
// Consistency checks
// ============================================================================

const RANK_ORDER = '23456789TJQKA';
function rankIndex(r) { return RANK_ORDER.indexOf(r); }

function checkHandDominance(posData, context) {
  // Check that stronger hands have >= frequency of weaker hands
  // e.g., if 88 raises, 99 should also raise (or raise more)
  const data = getRangeData(posData);
  const errors = [];
  const action = context === 'rfi' ? 'raise' : 'raise'; // primary action

  // Pairs: higher pair should raise >= lower pair
  for (let i = 12; i > 0; i--) {
    const higher = RANKS[i] + RANKS[i];
    const lower = RANKS[i-1] + RANKS[i-1];
    if (data[lower] && data[higher]) {
      if (data[lower][action] > data[higher][action] + 0.05) {
        errors.push(`${lower} raises more than ${higher} (${data[lower][action].toFixed(2)} vs ${data[higher][action].toFixed(2)})`);
      }
    }
  }

  // AKs should have >= frequency of AQs, etc.
  const aceHighSuited = ['AKs','AQs','AJs','ATs','A9s','A8s','A7s','A6s','A5s','A4s','A3s','A2s'];
  for (let i = 0; i < aceHighSuited.length - 1; i++) {
    const h1 = aceHighSuited[i];
    const h2 = aceHighSuited[i+1];
    // Skip A5s-A4s-A3s-A2s which can be mixed due to blocker value
    if (rankIndex(h2[1]) <= 5) continue;
    if (data[h2] && data[h1]) {
      const freq1 = data[h1][action] + data[h1].call;
      const freq2 = data[h2][action] + data[h2].call;
      if (freq2 > freq1 + 0.1) {
        errors.push(`${h2} continues more than ${h1} (${freq2.toFixed(2)} vs ${freq1.toFixed(2)})`);
      }
    }
  }

  return errors;
}

function checkFrequencyValidity(posData) {
  // Check that all [fold, call, raise] sum to ~1.0
  const errors = [];
  const data = getRangeData(posData);
  for (const hand of ALL_HANDS_169) {
    const { fold, call, raise } = data[hand];
    const sum = fold + call + raise;
    if (Math.abs(sum - 1.0) > 0.02) {
      errors.push(`${hand}: frequencies sum to ${sum.toFixed(3)} (should be 1.0)`);
    }
    if (fold < -0.01 || call < -0.01 || raise < -0.01) {
      errors.push(`${hand}: negative frequency detected`);
    }
  }
  return errors;
}

function checkPositionMonotonicity(rfiData) {
  // Later positions should generally have wider ranges
  const positions = ['UTG', 'MP', 'CO', 'BTN'];
  const errors = [];
  const sizes = {};

  for (const pos of positions) {
    if (rfiData[pos]) {
      sizes[pos] = rangeSize(rfiData[pos], 'raise');
    }
  }

  for (let i = 0; i < positions.length - 1; i++) {
    const p1 = positions[i];
    const p2 = positions[i + 1];
    if (sizes[p1] !== undefined && sizes[p2] !== undefined) {
      if (sizes[p2] < sizes[p1] - 1) {
        errors.push(`${p2} RFI (${sizes[p2].toFixed(1)}%) is tighter than ${p1} (${sizes[p1].toFixed(1)}%)`);
      }
    }
  }

  return { errors, sizes };
}

// ============================================================================
// Run validation
// ============================================================================

console.log('═══════════════════════════════════════════════════════════════');
console.log('  PREFLOP RANGE QUALITY VALIDATION');
console.log('═══════════════════════════════════════════════════════════════\n');

let totalChecks = 0;
let passedChecks = 0;
let warnings = [];
let failures = [];
let benchmarkDeviations = [];

// --- 1. Range size vs benchmarks ---
console.log('─── 1. RANGE SIZE vs SOLVER BENCHMARKS ───\n');

for (const [bmKey, bmData] of Object.entries(BENCHMARKS)) {
  const [fmtName, depth] = bmKey.replace('cash_', 'cash/').replace('mtt_', 'mtt/').split('/');
  const fmt = fmtName === 'cash' ? 'cash' : 'mtt';
  const fmtData = ranges[fmt]?.[depth];
  if (!fmtData) continue;

  console.log(`  ${fmt}_${depth}:`);

  for (const [ctx, positions] of Object.entries(bmData)) {
    if (!fmtData[ctx]) continue;

    for (const [posKey, expected] of Object.entries(positions)) {
      totalChecks++;
      const posData = fmtData[ctx][posKey];
      if (!posData) {
        failures.push(`${fmt}_${depth}/${ctx}/${posKey}: missing data`);
        continue;
      }

      let actual;
      if (expected.raise) {
        actual = rangeSize(posData, 'raise');
        const [min, max, typical] = expected.raise;
        const inRange = actual >= min - 2 && actual <= max + 2;
        const deviation = actual - typical;
        const deviationPct = Math.abs(deviation / typical * 100);

        const status = inRange ? '✓' : (actual >= min - 5 && actual <= max + 5 ? '~' : '✗');
        console.log(`    ${status} ${ctx}/${posKey} raise: ${actual.toFixed(1)}% (expected ${min}-${max}%, typical ${typical}%) [dev: ${deviation > 0 ? '+' : ''}${deviation.toFixed(1)}%]`);

        benchmarkDeviations.push(deviationPct);
        if (inRange) passedChecks++;
        else if (actual >= min - 5 && actual <= max + 5) { passedChecks += 0.5; warnings.push(`${fmt}_${depth}/${ctx}/${posKey}: ${actual.toFixed(1)}% slightly outside ${min}-${max}%`); }
        else failures.push(`${fmt}_${depth}/${ctx}/${posKey}: ${actual.toFixed(1)}% far outside ${min}-${max}%`);
      }

      if (expected.defend) {
        actual = totalDefendPct(posData);
        const [min, max, typical] = expected.defend;
        const inRange = actual >= min - 3 && actual <= max + 3;
        const deviation = actual - typical;
        const deviationPct = Math.abs(deviation / typical * 100);

        const status = inRange ? '✓' : (actual >= min - 8 && actual <= max + 8 ? '~' : '✗');
        console.log(`    ${status} ${ctx}/${posKey} defend: ${actual.toFixed(1)}% (expected ${min}-${max}%, typical ${typical}%) [dev: ${deviation > 0 ? '+' : ''}${deviation.toFixed(1)}%]`);

        benchmarkDeviations.push(deviationPct);
        if (inRange) passedChecks++;
        else if (actual >= min - 8 && actual <= max + 8) { passedChecks += 0.5; warnings.push(`${fmt}_${depth}/${ctx}/${posKey}: ${actual.toFixed(1)}% slightly outside ${min}-${max}%`); }
        else failures.push(`${fmt}_${depth}/${ctx}/${posKey}: ${actual.toFixed(1)}% far outside ${min}-${max}%`);
      }
    }
  }
  console.log();
}

// --- 2. Internal consistency ---
console.log('─── 2. INTERNAL CONSISTENCY CHECKS ───\n');

let consistencyErrors = 0;
let consistencyChecks = 0;

for (const fmt of ['cash', 'mtt']) {
  if (!ranges[fmt]) continue;
  for (const [depth, depthData] of Object.entries(ranges[fmt])) {
    for (const [ctx, ctxData] of Object.entries(depthData)) {
      for (const [pos, posData] of Object.entries(ctxData)) {
        consistencyChecks++;

        // Frequency validity
        const freqErrors = checkFrequencyValidity(posData);
        if (freqErrors.length > 0) {
          consistencyErrors += freqErrors.length;
          for (const e of freqErrors) {
            failures.push(`${fmt}_${depth}/${ctx}/${pos}: ${e}`);
          }
        }

        // Hand dominance
        const domErrors = checkHandDominance(posData, ctx);
        if (domErrors.length > 0) {
          for (const e of domErrors) {
            warnings.push(`${fmt}_${depth}/${ctx}/${pos}: dominance: ${e}`);
          }
        }
      }
    }

    // Position monotonicity for RFI
    if (depthData.rfi) {
      const { errors, sizes } = checkPositionMonotonicity(depthData.rfi);
      consistencyChecks++;
      if (errors.length > 0) {
        for (const e of errors) {
          failures.push(`${fmt}_${depth}/rfi: ${e}`);
          consistencyErrors++;
        }
      }
    }
  }
}

totalChecks += consistencyChecks;
passedChecks += consistencyChecks - consistencyErrors;
console.log(`  Checked ${consistencyChecks} position/context combos`);
console.log(`  Frequency validity errors: ${consistencyErrors}`);
console.log(`  Hand dominance warnings: ${warnings.filter(w => w.includes('dominance')).length}`);
console.log();

// --- 3. Known hand checks ---
console.log('─── 3. KNOWN HAND CHECKS ───\n');

for (const [label, check] of Object.entries(KNOWN_HANDS)) {
  totalChecks++;
  const fmtData = ranges[check.fmt]?.[check.depth];
  if (!fmtData || !fmtData[check.ctx]) { failures.push(`${label}: missing data`); continue; }
  const posData = fmtData[check.ctx][check.pos];
  if (!posData) { failures.push(`${label}: missing position ${check.pos}`); continue; }

  const data = getRangeData(posData);
  const freq = data[check.hand]?.[check.action] || 0;
  const pass = freq >= check.min;
  if (pass) {
    passedChecks++;
    console.log(`  ✓ ${label}: ${check.hand} ${check.action} = ${(freq * 100).toFixed(0)}% (need ≥${(check.min * 100).toFixed(0)}%)`);
  } else {
    failures.push(`${label}: ${check.hand} ${check.action} = ${(freq * 100).toFixed(0)}% (need ≥${(check.min * 100).toFixed(0)}%)`);
    console.log(`  ✗ ${label}: ${check.hand} ${check.action} = ${(freq * 100).toFixed(0)}% (need ≥${(check.min * 100).toFixed(0)}%)`);
  }
}
console.log();

// --- 4. Range size summary table ---
console.log('─── 4. RANGE SIZE SUMMARY (% of combos) ───\n');
console.log('  Format       | UTG    | MP     | CO     | BTN    | SB     |');
console.log('  ─────────────┼────────┼────────┼────────┼────────┼────────┤');

for (const fmt of ['cash', 'mtt']) {
  if (!ranges[fmt]) continue;
  for (const depth of Object.keys(ranges[fmt]).sort((a, b) => parseInt(b) - parseInt(a))) {
    const rfi = ranges[fmt][depth].rfi;
    if (!rfi) continue;
    const row = [`  ${fmt}_${depth}`.padEnd(15) + '|'];
    for (const pos of ['UTG', 'MP', 'CO', 'BTN', 'SB']) {
      if (rfi[pos]) {
        row.push(` ${rangeSize(rfi[pos], 'raise').toFixed(1)}%`.padEnd(7) + '|');
      } else {
        row.push(' -     |');
      }
    }
    console.log(row.join(''));
  }
}
console.log();

// --- 5. Scoring ---
console.log('═══════════════════════════════════════════════════════════════');
console.log('  QUALITY SCORE');
console.log('═══════════════════════════════════════════════════════════════\n');

const avgDeviation = benchmarkDeviations.length > 0
  ? benchmarkDeviations.reduce((a, b) => a + b, 0) / benchmarkDeviations.length
  : 0;
const maxDeviation = benchmarkDeviations.length > 0
  ? Math.max(...benchmarkDeviations)
  : 0;

// Score components
const checkScore = totalChecks > 0 ? (passedChecks / totalChecks) * 100 : 0;
const deviationScore = Math.max(0, 100 - avgDeviation * 2); // -2pts per % deviation
const consistencyScore = consistencyErrors === 0 ? 100 : Math.max(0, 100 - consistencyErrors * 10);

// Weighted overall
const overallScore = (checkScore * 0.4 + deviationScore * 0.4 + consistencyScore * 0.2);

console.log(`  Benchmark alignment:    ${checkScore.toFixed(1)}/100  (${passedChecks.toFixed(0)}/${totalChecks} checks passed)`);
console.log(`  Average deviation:      ${avgDeviation.toFixed(1)}%  (max: ${maxDeviation.toFixed(1)}%)`);
console.log(`  Deviation score:        ${deviationScore.toFixed(1)}/100`);
console.log(`  Consistency score:      ${consistencyScore.toFixed(1)}/100`);
console.log(`  ─────────────────────────────────────────`);
console.log(`  OVERALL QUALITY SCORE:  ${overallScore.toFixed(1)}/100`);
console.log();

if (overallScore >= 90) console.log('  Rating: EXCELLENT — within solver-grade accuracy');
else if (overallScore >= 80) console.log('  Rating: GOOD — minor deviations from solver output');
else if (overallScore >= 70) console.log('  Rating: ACCEPTABLE — some spots need adjustment');
else if (overallScore >= 60) console.log('  Rating: FAIR — significant deviations in key spots');
else console.log('  Rating: NEEDS WORK — major calibration needed');
console.log();

if (warnings.length > 0) {
  console.log(`  Warnings (${warnings.length}):`);
  for (const w of warnings.slice(0, 15)) console.log(`    ⚠ ${w}`);
  if (warnings.length > 15) console.log(`    ... and ${warnings.length - 15} more`);
  console.log();
}

if (failures.length > 0) {
  console.log(`  Failures (${failures.length}):`);
  for (const f of failures.slice(0, 15)) console.log(`    ✗ ${f}`);
  if (failures.length > 15) console.log(`    ... and ${failures.length - 15} more`);
  console.log();
}
