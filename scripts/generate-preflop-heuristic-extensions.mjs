// ============================================================================
// Generate preflop heuristic EXTENSION overlays for MISSING spots.
// ============================================================================
// The base table (preflop-lookup/preflop-ranges.js) only covers heads-up
// natural lines: vs_3bet where the 3bettor acts AFTER the opener (villain>hero),
// and vs_4bet where the 4bettor acts BEFORE the 3bettor (villain<hero). In real
// multiway play a player can face a 3bet/4bet from ANY seat (e.g. UTG opens, CO
// 3bets, BTN cold-faces CO's 3bet). Those are the MISSING ordered pairs.
//
// Keys are hero_villain (hero = the player whose range we store). We assume the
// worst case: villain's cold 3bet/4bet is TIGHT, so hero continues tight.
//
// Two overlays are produced:
//   - solution: preflop play. Raise-or-fold only (no cold-calls).
//   - input:    postflop range input. Adds a strong cold-call range.
//
// Each overlay is a STANDALONE file assigning a DISTINCT global so it never
// clobbers the base table when both load in the browser:
//   solution -> GTO.Data.PreflopRangesHeuristicSolution
//   input    -> GTO.Data.PreflopRangesHeuristicInput
// Overlays contain ONLY the missing keys; base + overlay = full coverage.
//
// Output (source + synced js/data copy):
//   gtoterminal/preflop-lookup/preflop-ranges-heuristic-for-solution.js
//   gtoterminal/preflop-lookup/preflop-ranges-heuristic-for-input.js
//   gtoterminal/js/data/preflop-ranges-heuristic-for-solution.js
//   gtoterminal/js/data/preflop-ranges-heuristic-for-input.js
//
// Usage: node scripts/generate-preflop-heuristic-extensions.mjs
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = process.cwd();
const POSITIONS = ['UTG', 'MP', 'CO', 'BTN', 'SB', 'BB'];
const POS_IDX = new Map(POSITIONS.map((p, i) => [p, i]));
const EXT_SPOTS = ['vs_3bet', 'vs_4bet'];

const BASE_PATH = path.join(ROOT, 'gtoterminal', 'preflop-lookup', 'preflop-ranges.js');
const OUT = {
  solution: [
    path.join(ROOT, 'gtoterminal', 'preflop-lookup', 'preflop-ranges-heuristic-for-solution.js'),
    path.join(ROOT, 'gtoterminal', 'js', 'data', 'preflop-ranges-heuristic-for-solution.js'),
  ],
  input: [
    path.join(ROOT, 'gtoterminal', 'preflop-lookup', 'preflop-ranges-heuristic-for-input.js'),
    path.join(ROOT, 'gtoterminal', 'js', 'data', 'preflop-ranges-heuristic-for-input.js'),
  ],
};

const GLOBAL_NAME = {
  solution: 'GTO.Data.PreflopRangesHeuristicSolution',
  input: 'GTO.Data.PreflopRangesHeuristicInput',
};

// ---------------------------------------------------------------------------
// Load base ranges (browser script -> VM with self-referential window).
// ---------------------------------------------------------------------------
function loadBase() {
  const src = fs.readFileSync(BASE_PATH, 'utf8');
  const g = {};
  const ctx = { window: { GTO: g }, GTO: g, console };
  vm.createContext(ctx);
  vm.runInContext(src, ctx, { filename: BASE_PATH });
  const ranges = (ctx.window.GTO || ctx.GTO)?.Data?.PreflopRanges;
  if (!ranges) throw new Error('Could not load GTO.Data.PreflopRanges from base file');
  return ranges;
}

// ---------------------------------------------------------------------------
// Heuristic range builders. All mixed tuples are [fold, call, raise] and sum
// to 1. No hand appears in more than one bucket. Facing a TIGHT cold bet, so
// hero is tight; slightly wider from later seats, more committed at short stacks.
// ---------------------------------------------------------------------------
function vs3betSolution(hero, bb) {
  // 4bet-or-fold, no cold-calls.
  if (bb <= 20) {
    return { pure_raise: ['AA', 'KK', 'QQ', 'AKs', 'AKo'], mixed: { JJ: [0.4, 0, 0.6] } };
  }
  const late = POS_IDX.get(hero) >= 3; // BTN/SB/BB
  const mixed = {
    QQ: [0.15, 0, 0.85],
    AKo: [0.35, 0, 0.65],
    JJ: [0.75, 0, 0.25],
    A5s: [0.85, 0, 0.15], // blocker bluff
  };
  if (late) mixed.KQs = [0.9, 0, 0.1]; // tiny extra bluff from late seats
  return { pure_raise: ['AA', 'KK', 'AKs'], mixed };
}

function vs3betInput(hero, bb) {
  // Adds a strong cold-call range for postflop solving.
  if (bb <= 20) {
    return {
      pure_raise: ['AA', 'KK', 'QQ', 'AKs', 'AKo'],
      pure_call: ['JJ', 'TT', 'AQs'],
      mixed: {},
    };
  }
  const late = POS_IDX.get(hero) >= 3; // BTN/SB/BB can flat wider
  const pure_call = ['QQ', 'JJ', 'AQs'];
  if (late) pure_call.push('TT', 'AJs', 'KQs');
  return {
    pure_raise: ['AA', 'KK', 'AKs'],
    pure_call,
    mixed: {
      AKo: [0.2, 0.5, 0.3],
      99: [0.5, 0.5, 0],
    },
  };
}

function vs4betSolution(hero, bb) {
  // 5bet-shove-or-fold, very tight.
  if (bb <= 25) {
    return {
      pure_raise: ['AA', 'KK', 'AKs'],
      mixed: { QQ: [0.3, 0, 0.7], AKo: [0.4, 0, 0.6], JJ: [0.7, 0, 0.3] },
    };
  }
  return {
    pure_raise: ['AA'],
    mixed: {
      KK: [0.1, 0, 0.9],
      AKs: [0.55, 0, 0.45],
      AKo: [0.75, 0, 0.25],
      QQ: [0.85, 0, 0.15],
    },
  };
}

function vs4betInput(hero, bb) {
  if (bb <= 25) {
    return {
      pure_raise: ['AA', 'KK', 'AKs'],
      pure_call: ['QQ', 'AKo'],
      mixed: { JJ: [0.5, 0.5, 0] },
    };
  }
  return {
    pure_raise: ['AA', 'AKs'],
    pure_call: ['KK', 'QQ'],
    mixed: {
      AKo: [0.3, 0.4, 0.3],
      JJ: [0.6, 0.4, 0],
    },
  };
}

function buildEntry(variant, spot, hero, bb) {
  if (spot === 'vs_3bet') return variant === 'solution' ? vs3betSolution(hero, bb) : vs3betInput(hero, bb);
  return variant === 'solution' ? vs4betSolution(hero, bb) : vs4betInput(hero, bb);
}

// ---------------------------------------------------------------------------
// Determine missing keys and build overlay object per variant.
// ---------------------------------------------------------------------------
function allOrderedPairs() {
  const keys = [];
  for (const hero of POSITIONS) {
    for (const villain of POSITIONS) {
      if (hero !== villain) keys.push(`${hero}_${villain}`);
    }
  }
  return keys;
}

function buildOverlay(base, variant) {
  const overlay = {};
  const counts = {};
  for (const fmt of Object.keys(base)) {
    for (const depth of Object.keys(base[fmt])) {
      const node = base[fmt][depth];
      const bb = parseInt(depth, 10);
      for (const spot of EXT_SPOTS) {
        if (!node[spot] || typeof node[spot] !== 'object') continue;
        const existing = new Set(Object.keys(node[spot]));
        const missing = allOrderedPairs().filter((k) => !existing.has(k));
        if (missing.length === 0) continue;
        for (const key of missing) {
          const hero = key.slice(0, key.indexOf('_'));
          const entry = buildEntry(variant, spot, hero, bb);
          overlay[fmt] = overlay[fmt] || {};
          overlay[fmt][depth] = overlay[fmt][depth] || {};
          overlay[fmt][depth][spot] = overlay[fmt][depth][spot] || {};
          overlay[fmt][depth][spot][key] = entry;
        }
        counts[`${fmt}/${depth}/${spot}`] = missing.length;
      }
    }
  }
  return { overlay, counts };
}

// ---------------------------------------------------------------------------
// Serialize overlay -> pretty JS assigning the distinct global.
// ---------------------------------------------------------------------------
function fmtArr(arr) {
  return `[${arr.map((h) => `'${h}'`).join(',')}]`;
}

function fmtEntry(entry, indent) {
  const pad = ' '.repeat(indent);
  const inner = ' '.repeat(indent + 2);
  const parts = [];
  if (entry.pure_raise && entry.pure_raise.length) parts.push(`${inner}pure_raise: ${fmtArr(entry.pure_raise)}`);
  if (entry.pure_call && entry.pure_call.length) parts.push(`${inner}pure_call: ${fmtArr(entry.pure_call)}`);
  if (entry.mixed && Object.keys(entry.mixed).length) {
    const mpad = ' '.repeat(indent + 4);
    const mlines = Object.entries(entry.mixed)
      .map(([h, t]) => `${mpad}'${h}': [${t.join(', ')}]`)
      .join(',\n');
    parts.push(`${inner}mixed: {\n${mlines}\n${inner}}`);
  }
  return `{\n${parts.join(',\n')}\n${pad}}`;
}

function serialize(overlay, variant) {
  const globalName = GLOBAL_NAME[variant];
  const header = [
    'window.GTO = window.GTO || {};',
    'GTO.Data = GTO.Data || {};',
    '',
    `// Preflop heuristic EXTENSION overlay (${variant}) — MISSING multiway spots only.`,
    '// Keys are hero_villain. Merge ON TOP of GTO.Data.PreflopRanges (base).',
    variant === 'solution'
      ? '// Raise-or-fold only (no cold-calls). Assumes hero faces a TIGHT cold 3bet/4bet.'
      : '// Includes a strong cold-call range for postflop range input.',
    '// Generated by scripts/generate-preflop-heuristic-extensions.mjs — review/tune as needed.',
    '',
    `${globalName} = {`,
  ];

  const lines = [header.join('\n')];
  const fmts = Object.keys(overlay);
  fmts.forEach((fmt, fi) => {
    lines.push(`  ${fmt}: {`);
    const depths = Object.keys(overlay[fmt]);
    depths.forEach((depth, di) => {
      lines.push(`    '${depth}': {`);
      const spots = Object.keys(overlay[fmt][depth]);
      spots.forEach((spot, si) => {
        lines.push(`      ${spot}: {`);
        const keys = Object.keys(overlay[fmt][depth][spot]);
        keys.forEach((key, ki) => {
          const entryStr = fmtEntry(overlay[fmt][depth][spot][key], 8);
          lines.push(`        ${key}: ${entryStr}${ki < keys.length - 1 ? ',' : ''}`);
        });
        lines.push(`      }${si < spots.length - 1 ? ',' : ''}`);
      });
      lines.push(`    }${di < depths.length - 1 ? ',' : ''}`);
    });
    lines.push(`  }${fi < fmts.length - 1 ? ',' : ''}`);
  });
  lines.push('};');
  lines.push('');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main() {
  const base = loadBase();
  for (const variant of ['solution', 'input']) {
    const { overlay, counts } = buildOverlay(base, variant);
    const text = serialize(overlay, variant);
    for (const out of OUT[variant]) fs.writeFileSync(out, text);
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    console.log(`[${variant}] wrote ${OUT[variant].length} files, ${total} missing keys across ${Object.keys(counts).length} spot/depth groups`);
  }
}

main();
