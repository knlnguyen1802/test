#!/usr/bin/env node
// ============================================================================
// Preflop -> Postflop range bridge
// ============================================================================
// Builds the OOP/IP input ranges for the postflop precompute solver straight
// from the preflop range lookup table (preflop-lookup/preflop-ranges.js),
// keyed by BET LEVEL (srp / 3bet / 4bet).
//
// Model:  matchup key `AGG_CALLER` (first position = aggressor) + bet level.
//   The AGGRESSOR gets its raise range; the CALLER gets its call range. Which
//   preflop table each side is read from is listed explicitly in BET_LEVELS
//   (scripts/postflop_config/matchups.mjs):
//
//     srp : agg open  = rfi[agg]                caller flat = vs_raise[agg_caller].call
//     3bet: agg 3bet  = vs_raise[caller_agg].raise   caller call = vs_3bet[caller_agg].call
//     4bet: agg 4bet  = vs_3bet[agg_caller].raise    caller call = vs_4bet[agg_caller].call
//
//   The two ranges are then placed into OOP / IP by postflop position
//   (POSTFLOP_ORDER: blinds act first postflop, button last) — NOT by who is
//   the aggressor. Every matchup is listed in both directions; the impossible
//   ones (empty lookup) are skipped.
//
// Output: js/data/postflop-input-ranges.json  { cases: { srp, 3bet, 4bet } }
//   Each case maps matchupKey -> { oop, ip }. The postflop precompute script
//   loads cases[<bet level>] directly.
//
// Usage:
//   node scripts/preflop-to-postflop-ranges.mjs
//   node scripts/preflop-to-postflop-ranges.mjs --format cash --stack 100bb
//   node scripts/preflop-to-postflop-ranges.mjs --case 3bet      # one level only
//   node scripts/preflop-to-postflop-ranges.mjs --min-weight 0.05 # drop tiny mixed
// ============================================================================

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createContext, runInContext } from 'node:vm';
import { MATCHUPS, BET_LEVELS, postflopPosition } from './postflop_config/matchups.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..');

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
function getArg(name, def) {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
}
const FORMAT = getArg('format', 'cash');            // preflop table: cash | mtt
const STACK = getArg('stack', '100bb');             // preflop stack depth
const ONLY_CASE = getArg('case', null);             // one bet level, or all
const MIN_WEIGHT = parseFloat(getArg('min-weight', '0.05')); // drop mixed hands below this freq
const OUT_PATH = join(PROJECT_ROOT, 'js', 'data', getArg('out', 'postflop-input-ranges.json'));


// MATCHUPS (aggressor-first keys) and BET_LEVELS (per-level range sources) are
// imported from postflop_config/matchups.mjs.


// ---------------------------------------------------------------------------
// Canonical 13x13 hand order (matches solver-preflop/src/hands.rs layout)
// Used to sort output ranges for readability. Order is not functionally
// significant — the postflop parser splits on commas.
// ---------------------------------------------------------------------------
const RANKS = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'];
const HAND_ORDER = {};
(function buildOrder() {
  let idx = 0;
  for (let i = 0; i < 13; i++) {
    for (let j = 0; j < 13; j++) {
      let hand;
      if (i === j) hand = RANKS[i] + RANKS[i];
      else if (i < j) hand = RANKS[i] + RANKS[j] + 's';
      else hand = RANKS[j] + RANKS[i] + 'o';
      if (!(hand in HAND_ORDER)) HAND_ORDER[hand] = idx++;
    }
  }
})();

function sortHands(set) {
  return [...set].sort((a, b) => (HAND_ORDER[a] ?? 999) - (HAND_ORDER[b] ?? 999));
}

// ---------------------------------------------------------------------------
// Load the preflop range lookup table. It is a browser script that assigns
// `window.GTO.Data.PreflopRanges`; run it in a VM with a self-referential
// `window` so both `window.GTO` and the bare `GTO` references resolve.
// ---------------------------------------------------------------------------
function loadPreflopRanges() {
  const path = join(PROJECT_ROOT, 'preflop-lookup', 'preflop-ranges.js');
  if (!existsSync(path)) throw new Error(`Preflop ranges not found: ${path}`);
  const content = readFileSync(path, 'utf-8');
  const sandbox = {};
  sandbox.window = sandbox;               // window === global, so bare GTO works
  createContext(sandbox);
  runInContext(content, sandbox);
  const ranges = sandbox.GTO?.Data?.PreflopRanges;
  if (!ranges) throw new Error('Could not read GTO.Data.PreflopRanges from lookup file.');
  return ranges;
}

// ---------------------------------------------------------------------------
// Derive a WEIGHTED hand map from a preflop entry { pure_raise, pure_call,
// mixed }. mixed[h] = [fold, call, raise]. `take` selects which action:
//   'raise' -> pure_raise (weight 1) + mixed hands weighted by their raise freq
//   'call'  -> pure_call  (weight 1) + mixed hands weighted by their call  freq
// Mixed hands are kept at their actual frequency (so the range mirrors the
// preflop mix — the solver understands `hand:weight`), dropping only those
// below MIN_WEIGHT to avoid near-zero noise.
// ---------------------------------------------------------------------------
function takeSet(entry, take) {
  const map = new Map();
  if (!entry) return map;
  const idx = take === 'raise' ? 2 : 1;
  const pure = take === 'raise' ? (entry.pure_raise || []) : (entry.pure_call || []);
  for (const h of pure) map.set(h, 1.0);
  for (const [h, f] of Object.entries(entry.mixed || {})) {
    const w = f[idx] || 0;
    if (w >= MIN_WEIGHT && !map.has(h)) map.set(h, w);
  }
  return map;
}

// Build a preflop lookup key from a side spec's keyBy and the matchup's seats.
function lookupKey(keyBy, agg, caller) {
  if (keyBy === 'agg') return agg;
  if (keyBy === 'agg_caller') return `${agg}_${caller}`;
  if (keyBy === 'caller_agg') return `${caller}_${agg}`;
  throw new Error(`Unknown keyBy "${keyBy}"`);
}

// Resolve one side (agg or caller) of a level to its weighted hand map.
function sideSet(tables, spec, agg, caller) {
  const table = tables[spec.table] || {};
  return takeSet(table[lookupKey(spec.keyBy, agg, caller)], spec.take);
}

// Serialize a weighted hand map to a solver range string. Full-weight hands are
// bare (`AKs`); partial (mixed) hands carry their weight (`AKo:0.6`).
function fmtRange(map) {
  return sortHands([...map.keys()])
    .map(h => { const w = map.get(h); return w >= 0.995 ? h : `${h}:${Math.round(w * 100) / 100}`; })
    .join(',');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main() {
  const all = loadPreflopRanges();
  const tables = all?.[FORMAT]?.[STACK];
  if (!tables) {
    const avail = Object.keys(all).map(f => `${f}: ${Object.keys(all[f]).join('/')}`).join('; ');
    throw new Error(`No preflop ranges for format="${FORMAT}" stack="${STACK}". Available — ${avail}`);
  }

  const levelKeys = ONLY_CASE ? [ONLY_CASE] : Object.keys(BET_LEVELS);
  for (const lvl of levelKeys) {
    if (!BET_LEVELS[lvl]) throw new Error(`Unknown case "${lvl}". Valid: ${Object.keys(BET_LEVELS).join(', ')}`);
  }

  console.log(`[bridge] Source: preflop-lookup/preflop-ranges.js  ${FORMAT}/${STACK}`);
  console.log(`[bridge] Levels: ${levelKeys.join(', ')} (min mixed weight ${MIN_WEIGHT})`);
  console.log('');

  const cases = {};
  const skipped = [];

  for (const lvl of levelKeys) {
    const spec = BET_LEVELS[lvl];
    const matchups = {};
    console.log(`[bridge] === ${lvl} ===`);

    for (const mkey of MATCHUPS) {
      const [agg, caller] = mkey.split('_');
      const aggSet = sideSet(tables, spec.agg, agg, caller);
      const callSet = sideSet(tables, spec.caller, agg, caller);
      if (aggSet.size === 0 || callSet.size === 0) {
        skipped.push(`${lvl}/${mkey}`);
        continue;                          // impossible / missing spot
      }
      // Place the two ranges into OOP / IP by postflop position (not aggressor).
      const { oop, ip } = postflopPosition(agg, caller);
      const setFor = (pos) => (pos === agg ? aggSet : callSet);
      matchups[mkey] = {
        oop: fmtRange(setFor(oop)),
        ip: fmtRange(setFor(ip)),
      };
      console.log(`[bridge]   ${mkey.padEnd(9)} agg=${agg}(${String(aggSet.size).padStart(2)}) `
        + `caller=${caller}(${String(callSet.size).padStart(2)})  OOP=${oop} IP=${ip}`);
    }

    cases[lvl] = matchups;
    console.log('');
  }

  const output = {
    generated: new Date().toISOString(),
    source: `preflop-lookup/preflop-ranges.js ${FORMAT}/${STACK}`,
    minMixedWeight: MIN_WEIGHT,
    cases,
  };

  writeFileSync(OUT_PATH, JSON.stringify(output, null, 2) + '\n', 'utf-8');
  console.log(`[bridge] Wrote ${OUT_PATH}`);
  if (skipped.length) {
    console.log(`[bridge] Skipped ${skipped.length} matchup/level spots with no lookup data.`);
  }
  console.log(`[bridge] The postflop precompute script loads cases[<bet level>].`);
}

main();

