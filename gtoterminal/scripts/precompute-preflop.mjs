#!/usr/bin/env node
// ============================================================================
// Preflop Pre-computation Script (v2)
// ============================================================================
// Batch-solves all common preflop spots using the WASM solver in Node.js.
// Generates js/data/preflop-solutions.js with solver-computed GTO ranges.
//
// Key improvements over v1:
//   - Solves CASH only (MTT uses ICM overlay applied at display time)
//   - Sequential solving: RFI → vs_raise → vs_3bet → vs_4bet
//   - Position-specific villain ranges passed between stages
//   - Benchmarks solver output against curated heuristic data
//
// Usage:
//   node scripts/precompute-preflop.mjs                     # all spots
//   node scripts/precompute-preflop.mjs --depth 100bb       # single depth
//   node scripts/precompute-preflop.mjs --context rfi       # single context
//   node scripts/precompute-preflop.mjs --iterations 5000   # more iterations
//
// Performance: ~15ms per spot, ~215 spots → ~4 seconds
// ============================================================================

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..');

// Parse CLI arguments
const args = process.argv.slice(2);
function getArg(name, defaultVal) {
  const idx = args.indexOf('--' + name);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : defaultVal;
}

const MAX_ITERATIONS = parseInt(getArg('iterations', '3000'), 10);
const TARGET_EXPLOIT = parseFloat(getArg('target', '0.005'));
const FILTER_DEPTH = getArg('depth', null);
const FILTER_CONTEXT = getArg('context', null);

// ---------------------------------------------------------------------------
// 169 hand group utilities
// ---------------------------------------------------------------------------

const RANK_CHARS = '23456789TJQKA';
const RANK_MAP = {};
for (let i = 0; i < RANK_CHARS.length; i++) RANK_MAP[RANK_CHARS[i]] = i;

function handNameToIndex(name) {
  const r1 = RANK_MAP[name[0]];
  const r2 = RANK_MAP[name[1]];
  if (r1 === undefined || r2 === undefined) return -1;
  const rankHi = Math.max(r1, r2);
  const rankLo = Math.min(r1, r2);
  if (rankHi === rankLo) {
    const row = 12 - rankHi;
    return row * 13 + row;
  } else if (name.length >= 3 && name[2] === 's') {
    return (12 - rankHi) * 13 + (12 - rankLo);
  } else {
    return (12 - rankLo) * 13 + (12 - rankHi);
  }
}

function indexToHandName(idx) {
  const row = Math.floor(idx / 13);
  const col = idx % 13;
  const r1 = 12 - row;
  const r2 = 12 - col;
  const rankHi = Math.max(r1, r2);
  const rankLo = Math.min(r1, r2);
  if (row === col) return RANK_CHARS[rankHi] + RANK_CHARS[rankLo];
  if (col > row) return RANK_CHARS[rankHi] + RANK_CHARS[rankLo] + 's';
  return RANK_CHARS[rankHi] + RANK_CHARS[rankLo] + 'o';
}

function combosForIndex(idx) {
  const row = Math.floor(idx / 13);
  const col = idx % 13;
  if (row === col) return 6;
  if (col > row) return 4;
  return 12;
}

// Extract a 169-element range array from a solver result
// action: 'raise' or 'call'
function resultToRange(result, action) {
  const range = new Array(169).fill(0);
  if (!result) return range;
  if (action === 'raise') {
    for (const hand of (result.pure_raise || [])) {
      const idx = handNameToIndex(hand);
      if (idx >= 0) range[idx] = 1.0;
    }
    for (const [hand, freqs] of Object.entries(result.mixed || {})) {
      const idx = handNameToIndex(hand);
      if (idx >= 0) range[idx] = freqs[2]; // raise freq
    }
  } else if (action === 'call') {
    for (const hand of (result.pure_call || [])) {
      const idx = handNameToIndex(hand);
      if (idx >= 0) range[idx] = 1.0;
    }
    for (const [hand, freqs] of Object.entries(result.mixed || {})) {
      const idx = handNameToIndex(hand);
      if (idx >= 0) range[idx] = freqs[1]; // call freq
    }
  }
  return range;
}

// Count weighted combos in a result
function countCombos(result, actions) {
  let combos = 0;
  if (!result) return 0;
  if (actions.includes('raise')) {
    for (const hand of (result.pure_raise || [])) {
      const idx = handNameToIndex(hand);
      if (idx >= 0) combos += combosForIndex(idx);
    }
  }
  if (actions.includes('call')) {
    for (const hand of (result.pure_call || [])) {
      const idx = handNameToIndex(hand);
      if (idx >= 0) combos += combosForIndex(idx);
    }
  }
  for (const [hand, freqs] of Object.entries(result.mixed || {})) {
    const idx = handNameToIndex(hand);
    if (idx < 0) continue;
    const c = combosForIndex(idx);
    if (actions.includes('raise')) combos += c * freqs[2];
    if (actions.includes('call')) combos += c * freqs[1];
  }
  return combos;
}

// Count combos in a 169-weight range array
function countRangeCombos(range) {
  let total = 0;
  for (let i = 0; i < 169; i++) {
    total += range[i] * combosForIndex(i);
  }
  return total;
}

// ---------------------------------------------------------------------------
// Spot definitions
// ---------------------------------------------------------------------------

const DEPTHS = ['100bb', '40bb', '25bb', '20bb', '15bb'];
const POSITION_OPPONENTS = { UTG: 5, MP: 4, CO: 3, BTN: 2, SB: 1 };
const RFI_POSITIONS = ['UTG', 'MP', 'CO', 'BTN', 'SB'];

// 15 spots: villain opens, hero 3bets, solve villain's response facing a 3bet
const VS_RAISE_SPOTS = [
  { villain: 'UTG', hero: 'MP' },  // UTG opens → MP 3bets → solve UTG's response
  { villain: 'UTG', hero: 'CO' },  // UTG opens → CO 3bets → solve UTG's response
  { villain: 'UTG', hero: 'BTN' }, // UTG opens → BTN 3bets → solve UTG's response
  { villain: 'UTG', hero: 'SB' },  // UTG opens → SB 3bets → solve UTG's response
  { villain: 'UTG', hero: 'BB' },  // UTG opens → BB 3bets → solve UTG's response
  { villain: 'MP', hero: 'CO' },   // MP opens → CO 3bets → solve MP's response
  { villain: 'MP', hero: 'BTN' },  // MP opens → BTN 3bets → solve MP's response
  { villain: 'MP', hero: 'SB' },   // MP opens → SB 3bets → solve MP's response
  { villain: 'MP', hero: 'BB' },   // MP opens → BB 3bets → solve MP's response
  { villain: 'CO', hero: 'BTN' },  // CO opens → BTN 3bets → solve CO's response
  { villain: 'CO', hero: 'SB' },   // CO opens → SB 3bets → solve CO's response
  { villain: 'CO', hero: 'BB' },   // CO opens → BB 3bets → solve CO's response
  { villain: 'BTN', hero: 'SB' },  // BTN opens → SB 3bets → solve BTN's response
  { villain: 'BTN', hero: 'BB' },  // BTN opens → BB 3bets → solve BTN's response
  { villain: 'SB', hero: 'BB' },   // SB opens → BB 3bets → solve SB's response
];

// 15 spots: hero opened, villain 3bet, solve hero's response (4bet or call)
const VS_3BET_SPOTS = [
  { hero: 'UTG', villain: 'MP' },  // UTG opens → MP 3bets → solve UTG's 4bet/call
  { hero: 'UTG', villain: 'CO' },  // UTG opens → CO 3bets → solve UTG's 4bet/call
  { hero: 'UTG', villain: 'BTN' }, // UTG opens → BTN 3bets → solve UTG's 4bet/call
  { hero: 'UTG', villain: 'SB' },  // UTG opens → SB 3bets → solve UTG's 4bet/call
  { hero: 'UTG', villain: 'BB' },  // UTG opens → BB 3bets → solve UTG's 4bet/call
  { hero: 'MP', villain: 'CO' },   // MP opens → CO 3bets → solve MP's 4bet/call
  { hero: 'MP', villain: 'BTN' },  // MP opens → BTN 3bets → solve MP's 4bet/call
  { hero: 'MP', villain: 'SB' },   // MP opens → SB 3bets → solve MP's 4bet/call
  { hero: 'MP', villain: 'BB' },   // MP opens → BB 3bets → solve MP's 4bet/call
  { hero: 'CO', villain: 'BTN' },  // CO opens → BTN 3bets → solve CO's 4bet/call
  { hero: 'CO', villain: 'SB' },   // CO opens → SB 3bets → solve CO's 4bet/call
  { hero: 'CO', villain: 'BB' },   // CO opens → BB 3bets → solve CO's 4bet/call
  { hero: 'BTN', villain: 'SB' },  // BTN opens → SB 3bets → solve BTN's 4bet/call
  { hero: 'BTN', villain: 'BB' },  // BTN opens → BB 3bets → solve BTN's 4bet/call
  { hero: 'SB', villain: 'BB' },   // SB opens → BB 3bets → solve SB's 4bet/call
];

// 15 spots: hero opened → villain 3bet → hero 4bet → solve villain's response
// Note: many of these produce empty ranges (hero never 4bets at GTO).
// Only UTG_BTN, UTG_BB, MP_BTN, MP_BB, SB_BB have non-zero 4bet ranges.
const VS_4BET_SPOTS = [
  { villain: 'UTG', hero: 'MP' },  // UTG open → MP 3bet → UTG 4bet → MP faces 4bet
  { villain: 'UTG', hero: 'CO' },  // UTG open → CO 3bet → UTG 4bet → CO faces 4bet
  { villain: 'UTG', hero: 'BTN' }, // UTG open → BTN 3bet → UTG 4bet → BTN faces 4bet  [active]
  { villain: 'UTG', hero: 'SB' },  // UTG open → SB 3bet → UTG 4bet → SB faces 4bet
  { villain: 'UTG', hero: 'BB' },  // UTG open → BB 3bet → UTG 4bet → BB faces 4bet  [active]
  { villain: 'MP', hero: 'CO' },   // MP open → CO 3bet → MP 4bet → CO faces 4bet
  { villain: 'MP', hero: 'BTN' },  // MP open → BTN 3bet → MP 4bet → BTN faces 4bet  [active]
  { villain: 'MP', hero: 'SB' },   // MP open → SB 3bet → MP 4bet → SB faces 4bet
  { villain: 'MP', hero: 'BB' },   // MP open → BB 3bet → MP 4bet → BB faces 4bet  [active]
  { villain: 'CO', hero: 'BTN' },  // CO open → BTN 3bet → CO 4bet → BTN faces 4bet
  { villain: 'CO', hero: 'SB' },   // CO open → SB 3bet → CO 4bet → SB faces 4bet
  { villain: 'CO', hero: 'BB' },   // CO open → BB 3bet → CO 4bet → BB faces 4bet
  { villain: 'BTN', hero: 'SB' },  // BTN open → SB 3bet → BTN 4bet → SB faces 4bet
  { villain: 'BTN', hero: 'BB' },  // BTN open → BB 3bet → BTN 4bet → BB faces 4bet
  { villain: 'SB', hero: 'BB' },   // SB open → BB 3bet → SB 4bet → BB faces 4bet    [active]
];

// ---------------------------------------------------------------------------
// Position-specific payoff overrides
// ---------------------------------------------------------------------------
// Post-flop position order: SB(0) → BB(1) → UTG(2) → MP(3) → CO(4) → BTN(5)
// Higher = more in-position = higher equity realization

const POS_ORDER = { SB: 0, BB: 1, UTG: 2, MP: 3, CO: 4, BTN: 5 };

// Stack depth multiplier for villain fold frequencies (opponents fold less at short stacks)
// Aligned with Rust-side fold_freq_mult to avoid double-penalizing
function stackFoldMult(stack) {
  if (stack >= 60) return 1.0;
  if (stack >= 30) return 0.95;
  if (stack >= 20) return 0.88;
  if (stack >= 15) return 0.80;
  return 0.72;
}

// Stack depth reduces IP advantage (less post-flop play at short stacks)
function stackIpMult(stack) {
  if (stack >= 60) return 1.0;
  if (stack >= 30) return 0.90;
  if (stack >= 20) return 0.78;
  if (stack >= 15) return 0.65;
  return 0.50;
}

// Compute position-specific overrides for vs_raise (hero facing villain's open)
function vsRaiseOverrides(heroPos, villainPos, stack) {
  const heroOrd = POS_ORDER[heroPos] ?? 2;
  const villainOrd = POS_ORDER[villainPos] ?? 2;
  // IP advantage: hero acts after villain post-flop → better equity realization
  const ipAdv = (heroOrd - villainOrd) / 5.0; // -1.0 to +1.0
  const ipScale = stackIpMult(stack); // Reduced at short stacks

  // Call equity realization: base 0.75, IP bonus up to +0.13, OOP penalty up to -0.13
  const callEq = Math.max(0.55, Math.min(0.92, 0.75 + ipAdv * 0.13 * ipScale));

  // Raise equity realization: base 0.78, smaller position effect
  const raiseEq = Math.max(0.65, Math.min(0.88, 0.78 + ipAdv * 0.06 * ipScale));

  // Villain fold freq: opener folds more to EP 3bets (strong), less to LP 3bets (could be light)
  // Base 0.55, adjusted by hero position, then scaled by stack depth
  const foldAdj = (heroOrd - 2.5) / 5.0 * -0.10;
  const baseFold = 0.55 + foldAdj;
  const villainFold = Math.max(0.20, Math.min(0.65, baseFold * stackFoldMult(stack)));

  return { callEqRealization: callEq, raiseEqRealization: raiseEq, villainFoldFreq: villainFold };
}

// Compute position-specific overrides for vs_3bet (hero opened, villain 3bet)
function vs3BetOverrides(heroPos, villainPos, stack) {
  const heroOrd = POS_ORDER[heroPos] ?? 2;
  const villainOrd = POS_ORDER[villainPos] ?? 2;
  const ipAdv = (heroOrd - villainOrd) / 5.0;
  const ipScale = stackIpMult(stack);

  const callEq = Math.max(0.50, Math.min(0.80, 0.65 + ipAdv * 0.12 * ipScale));
  const raiseEq = Math.max(0.55, Math.min(0.80, 0.65 + ipAdv * 0.08 * ipScale));
  // 3bettor folds more to 4bet from EP (strong range), less from LP
  const foldAdj = (heroOrd - 2.5) / 5.0 * -0.08;
  const baseFold = 0.50 + foldAdj;
  const villainFold = Math.max(0.20, Math.min(0.60, baseFold * stackFoldMult(stack)));

  return { callEqRealization: callEq, raiseEqRealization: raiseEq, villainFoldFreq: villainFold };
}

// Compute position-specific overrides for vs_4bet (hero 3bet, villain 4bet)
function vs4BetOverrides(heroPos, villainPos, stack) {
  const heroOrd = POS_ORDER[heroPos] ?? 2;
  const villainOrd = POS_ORDER[villainPos] ?? 2;
  const ipAdv = (heroOrd - villainOrd) / 5.0;
  const ipScale = stackIpMult(stack);

  const callEq = Math.max(0.55, Math.min(0.80, 0.62 + ipAdv * 0.10 * ipScale));
  const baseFold = 0.30;
  const villainFold = Math.max(0.10, Math.min(0.40, baseFold * stackFoldMult(stack)));

  return { callEqRealization: callEq, villainFoldFreq: villainFold };
}

// ---------------------------------------------------------------------------
// WASM Solver
// ---------------------------------------------------------------------------

let PreflopSolver;

async function loadWasm() {
  const gluePath = join(PROJECT_ROOT, 'js', 'solver', 'preflop-pkg', 'preflop_solver_wasm.js');
  const wasmPath = join(PROJECT_ROOT, 'js', 'solver', 'preflop-pkg', 'preflop_solver_wasm_bg.wasm');
  const wasmBytes = readFileSync(wasmPath);
  const glue = await import(pathToFileURL(gluePath).href);
  glue.initSync({ module: wasmBytes });
  PreflopSolver = glue.PreflopSolver;
  console.log('WASM solver loaded.');
}

function solveSpot(config) {
  const solver = new PreflopSolver();
  const err = solver.setup(JSON.stringify(config));
  if (err) {
    console.error(`  Setup error: ${err}`);
    return null;
  }

  solver.solve(MAX_ITERATIONS, TARGET_EXPLOIT);

  const compact = JSON.parse(solver.get_results_compact());
  const raiseCombos = solver.raise_combos();
  const exploit = solver.exploitability();
  const iters = solver.iterations();

  return {
    pure_raise: compact.pure_raise,
    pure_call: compact.pure_call,
    mixed: compact.mixed,
    meta: {
      iterations: iters,
      exploitability: parseFloat(exploit.toFixed(6)),
      raiseCombos: Math.round(raiseCombos),
    }
  };
}

// ---------------------------------------------------------------------------
// Load curated data for benchmarking
// ---------------------------------------------------------------------------

function loadCuratedData() {
  try {
    const filePath = join(PROJECT_ROOT, 'js', 'data', 'preflop-ranges.js');
    const content = readFileSync(filePath, 'utf-8');
    // Create minimal globals expected by the file
    const fakeWindow = {};
    fakeWindow.GTO = { Data: {} };
    const fn = new Function('window', 'GTO', content + '\nreturn GTO.Data;');
    const data = fn(fakeWindow, fakeWindow.GTO);
    return data.PreflopRanges || null;
  } catch (e) {
    console.log('  (Could not load curated data for benchmark: ' + e.message + ')');
    return null;
  }
}

function getCuratedCombos(curated, depth, context, posKey) {
  if (!curated) return null;
  try {
    const entry = curated.cash && curated.cash[depth] && curated.cash[depth][context] && curated.cash[depth][context][posKey];
    if (!entry) return null;
    const actions = context === 'rfi' ? ['raise'] : ['raise', 'call'];
    return countCombos(entry, actions);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Generate all spots (sequential: RFI → vs_raise → vs_3bet → vs_4bet)
// ---------------------------------------------------------------------------

async function generateAll() {
  await loadWasm();

  const curated = loadCuratedData();
  if (curated) {
    console.log('Curated data loaded for benchmarking.\n');
  }

  const solutions = {};
  let totalSpots = 0;
  let solvedSpots = 0;
  const benchmarks = [];

  for (const depth of DEPTHS) {
    if (FILTER_DEPTH && depth !== FILTER_DEPTH) continue;
    solutions[depth] = {};
    const stackBB = parseInt(depth);

    console.log(`\n--- ${depth} (${stackBB}bb) ---`);

    // ===== STAGE 1: RFI =====
    if (!FILTER_CONTEXT || FILTER_CONTEXT === 'rfi') {
      solutions[depth].rfi = {};
      for (const pos of RFI_POSITIONS) {
        totalSpots++;
        const config = {
          stackDepth: stackBB,
          actionContext: 'rfi',
          numOpponents: POSITION_OPPONENTS[pos],
        };

        const label = `RFI ${pos}`;
        process.stdout.write(`  ${label}...`);
        const result = solveSpot(config);
        if (result) {
          solutions[depth].rfi[pos] = result;
          solvedSpots++;
          const raisePct = (result.meta.raiseCombos / 1326 * 100).toFixed(1);
          const curatedC = getCuratedCombos(curated, depth, 'rfi', pos);
          const curatedStr = curatedC !== null ? ` (curated: ${Math.round(curatedC)} / ${(curatedC/1326*100).toFixed(1)}%)` : '';
          console.log(` ${result.meta.raiseCombos} combos / ${raisePct}%${curatedStr}`);
          benchmarks.push({ spot: `${depth} ${label}`, solver: result.meta.raiseCombos, curated: curatedC ? Math.round(curatedC) : '—' });
        } else {
          console.log(' FAILED');
        }
      }
    }

    // ===== STAGE 2: vs_raise (villain range = villain's RFI range) =====
    if (!FILTER_CONTEXT || FILTER_CONTEXT === 'vs_raise') {
      solutions[depth].vs_raise = {};
      for (const spot of VS_RAISE_SPOTS) {
        totalSpots++;
        const posKey = spot.villain + '_' + spot.hero;

        // Get villain's opening range from RFI results
        const villainRfi = solutions[depth].rfi ? solutions[depth].rfi[spot.villain] : null;
        const villainRange = villainRfi ? resultToRange(villainRfi, 'raise') : null;

        // Position-specific overrides for equity realization and villain fold freq
        const overrides = vsRaiseOverrides(spot.hero, spot.villain, stackBB);
        const config = {
          stackDepth: stackBB,
          actionContext: 'vs_raise',
          callEqRealization: overrides.callEqRealization,
          raiseEqRealization: overrides.raiseEqRealization,
          villainFoldFreq: overrides.villainFoldFreq,
        };
        if (villainRange) config.villainRange = villainRange;

        const label = `vs_raise ${posKey}`;
        process.stdout.write(`  ${label}...`);
        const result = solveSpot(config);
        if (result) {
          solutions[depth].vs_raise[posKey] = result;
          solvedSpots++;
          const actionCombos = countCombos(result, ['raise', 'call']);
          const raiseCombos = countCombos(result, ['raise']);
          const callCombos = countCombos(result, ['call']);
          const rangeStr = villainRange ? `(vs ${Math.round(countRangeCombos(villainRange))} villain combos)` : '(vs full range)';
          console.log(` R:${Math.round(raiseCombos)} C:${Math.round(callCombos)} total:${Math.round(actionCombos)} ${rangeStr} [ceq:${overrides.callEqRealization.toFixed(2)} vf:${overrides.villainFoldFreq.toFixed(2)}]`);
        } else {
          console.log(' FAILED');
        }
      }
    }

    // ===== STAGE 3: vs_3bet (villain range = villain's 3bet range from vs_raise) =====
    if (!FILTER_CONTEXT || FILTER_CONTEXT === 'vs_3bet') {
      solutions[depth].vs_3bet = {};
      for (const spot of VS_3BET_SPOTS) {
        totalSpots++;
        const posKey = spot.hero + '_' + spot.villain;

        // Villain 3bet hero's open. Villain's range = their 3bet portion from vs_raise.
        // vs_raise key for this: villain opened = hero (the original opener), hero reacted = villain (the 3bettor)
        // vs_raise posKey = opener_reactor = spot.hero + '_' + spot.villain
        const vsRaiseKey = spot.hero + '_' + spot.villain;
        const vsRaiseResult = solutions[depth].vs_raise ? solutions[depth].vs_raise[vsRaiseKey] : null;
        const villainRange = vsRaiseResult ? resultToRange(vsRaiseResult, 'raise') : null;

        // Skip if villain has no 3bet range
        const villain3betCombos = villainRange ? countRangeCombos(villainRange) : 0;
        if (villainRange && villain3betCombos < 1) {
          console.log(`  vs_3bet ${posKey}... SKIPPED (villain has 0 3bet combos)`);
          continue;
        }

        // Position-specific overrides
        const overrides = vs3BetOverrides(spot.hero, spot.villain, stackBB);
        const config = {
          stackDepth: stackBB,
          actionContext: 'vs_3bet',
          callEqRealization: overrides.callEqRealization,
          raiseEqRealization: overrides.raiseEqRealization,
          villainFoldFreq: overrides.villainFoldFreq,
        };
        if (villainRange) config.villainRange = villainRange;

        const label = `vs_3bet ${posKey}`;
        process.stdout.write(`  ${label}...`);
        const result = solveSpot(config);
        if (result) {
          solutions[depth].vs_3bet[posKey] = result;
          solvedSpots++;
          const raiseCombos = countCombos(result, ['raise']);
          const callCombos = countCombos(result, ['call']);
          const rangeStr = villainRange ? `(vs ${Math.round(countRangeCombos(villainRange))} villain combos)` : '(vs full range)';
          console.log(` 4bet:${Math.round(raiseCombos)} Call:${Math.round(callCombos)} ${rangeStr}`);
        } else {
          console.log(' FAILED');
        }
      }
    }

    // ===== STAGE 4: vs_4bet (villain range = villain's 4bet range from vs_3bet) =====
    if (!FILTER_CONTEXT || FILTER_CONTEXT === 'vs_4bet') {
      solutions[depth].vs_4bet = {};
      for (const spot of VS_4BET_SPOTS) {
        totalSpots++;
        const posKey = spot.villain + '_' + spot.hero;

        // Villain 4bet after hero 3bet. Villain's range = their 4bet (raise) from vs_3bet.
        // vs_3bet key: hero=villain(opener), villain=hero(3bettor)
        // vs_3bet posKey = opener_3bettor = spot.villain + '_' + spot.hero
        const vs3betKey = spot.villain + '_' + spot.hero;
        const vs3betResult = solutions[depth].vs_3bet ? solutions[depth].vs_3bet[vs3betKey] : null;
        const villainRange = vs3betResult ? resultToRange(vs3betResult, 'raise') : null;

        // Skip spots where villain has no 4bet range (dependency chain produced 0 combos)
        const villainCombos = villainRange ? countRangeCombos(villainRange) : 0;
        if (villainRange && villainCombos < 1) {
          console.log(`  vs_4bet ${posKey}... SKIPPED (villain has 0 4bet combos)`);
          continue;
        }

        // Position-specific overrides
        const overrides = vs4BetOverrides(spot.hero, spot.villain, stackBB);
        const config = {
          stackDepth: stackBB,
          actionContext: 'vs_4bet',
          callEqRealization: overrides.callEqRealization,
          villainFoldFreq: overrides.villainFoldFreq,
        };
        if (villainRange) config.villainRange = villainRange;

        const label = `vs_4bet ${posKey}`;
        process.stdout.write(`  ${label}...`);
        const result = solveSpot(config);
        if (result) {
          solutions[depth].vs_4bet[posKey] = result;
          solvedSpots++;
          const raiseCombos = countCombos(result, ['raise']);
          const callCombos = countCombos(result, ['call']);
          const rangeStr = villainRange ? `(vs ${Math.round(countRangeCombos(villainRange))} villain combos)` : '(vs full range)';
          console.log(` 5bet:${Math.round(raiseCombos)} Call:${Math.round(callCombos)} ${rangeStr}`);
        } else {
          console.log(' FAILED');
        }
      }
    }
  }

  // Print benchmark comparison
  if (benchmarks.length > 0) {
    console.log('\n=== RFI Benchmark: Solver vs Curated ===');
    console.log('Spot                     Solver    Curated    Delta');
    console.log('─'.repeat(55));
    for (const b of benchmarks) {
      const solver = String(b.solver).padStart(6);
      const curated = String(b.curated).padStart(8);
      let delta = '';
      if (typeof b.curated === 'number') {
        const d = b.solver - b.curated;
        delta = (d >= 0 ? '+' : '') + d;
      }
      console.log(`${b.spot.padEnd(24)} ${solver}    ${curated}    ${delta}`);
    }
  }

  return { solutions, totalSpots, solvedSpots };
}

// ---------------------------------------------------------------------------
// Write output file
// ---------------------------------------------------------------------------

function writeOutput(solutions, stats) {
  const outPath = join(PROJECT_ROOT, 'js', 'data', 'preflop-solutions.js');

  // Write under both 'cash' and 'mtt' keys (identical — ICM overlay applied at display time)
  const fullSolutions = {
    cash: solutions,
    mtt: solutions,
  };

  let js = `// GTOTerminal — Pre-computed Preflop Solver Solutions (v2)
// Generated: ${new Date().toISOString()}
// Spots: ${stats.solvedSpots}/${stats.totalSpots}
// Solver: CFR+ WASM, ${MAX_ITERATIONS} max iterations, ${TARGET_EXPLOIT} target exploitability
// Note: Cash-only solver output. MTT = same data with ICM overlay applied at display time.
//
// Format: GTO.Data.PreflopSolutions[format][depth][context][positionKey]
// Each entry: { pure_raise, pure_call, mixed, meta }

window.GTO = window.GTO || {};
GTO.Data = GTO.Data || {};

GTO.Data.PreflopSolutions = `;

  js += JSON.stringify(fullSolutions, null, 2);
  js += ';\n';

  writeFileSync(outPath, js, 'utf-8');
  console.log(`\nWritten to: ${outPath}`);
  console.log(`File size: ${(Buffer.byteLength(js) / 1024).toFixed(1)} KB`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('=== Preflop Pre-computation (v2) ===');
  console.log(`Max iterations: ${MAX_ITERATIONS}`);
  console.log(`Target exploitability: ${TARGET_EXPLOIT}`);
  console.log('Solving: CASH only (MTT = cash + ICM overlay)');
  console.log('Mode: Sequential (RFI → vs_raise → vs_3bet → vs_4bet with villain ranges)');
  if (FILTER_DEPTH) console.log(`Filter depth: ${FILTER_DEPTH}`);
  if (FILTER_CONTEXT) console.log(`Filter context: ${FILTER_CONTEXT}`);

  const start = Date.now();
  const { solutions, totalSpots, solvedSpots } = await generateAll();
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  console.log(`\n=== Complete: ${solvedSpots}/${totalSpots} spots in ${elapsed}s ===`);
  writeOutput(solutions, { totalSpots, solvedSpots });
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
