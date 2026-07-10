#!/usr/bin/env node
// ============================================================================
// solve-unsolved.mjs — resilient driver for precompute-postflop
// ============================================================================
// Runs the postflop solve ONE BOARD AT A TIME, each in a fresh child process.
// Because precompute-postflop saves to disk after every spot and skips
// already-solved spots, this gives you:
//   • crash resilience — if one board crashes (OOM, panic, etc.), the driver
//     logs it and moves on; every board finished before it is already on disk.
//   • resumability — re-run any time; solved boards are skipped, only the
//     remaining (unsolved) boards are attempted.
//
// A board counts as "solved" when every matchup has a stored solution WITH
// flop nodes — plus turn lines and river lines when turn/river extraction is
// enabled. So a flop-only (incomplete) board is treated as UNSOLVED and gets
// re-solved, filling in / overriding the missing turn+river data.
//
// Usage (run from the gtoterminal dir):
//   node solve-unsolved.mjs                       # depth srp, native engine
//   node solve-unsolved.mjs --depth 3bet
//   node solve-unsolved.mjs --iterations 500 --target 0.5
//   node solve-unsolved.mjs --engine wasm         # force WASM engine
//   node solve-unsolved.mjs --no-river            # skip river (keep turn)
//   node solve-unsolved.mjs --no-turn --no-river  # flop only
//   node solve-unsolved.mjs --matchup SB_vs_BB    # only this matchup (cached per board)
//   node solve-unsolved.mjs --list                # just list solved/unsolved
//
// Turn + river extraction are ON by default.
// Runs are cached: already-solved boards are skipped (no --force needed). Adding
// a new matchup marks the boards that lack it as unsolved; use --matchup to fill
// just that matchup board-by-board without re-solving the others.
// ============================================================================

import { readFileSync, existsSync } from 'fs';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
function getArg(name, def) {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : def;
}
function hasArg(name) {
  return args.indexOf('--' + name) >= 0;
}

const DEPTH = getArg('depth', 'srp');
const ITERATIONS = getArg('iterations', '500');
const TARGET = getArg('target', '0.5');
const ENGINE = getArg('engine', 'native');
// Turn + river default ON; disable with --no-turn / --no-river (river forces turn).
const EXTRACT_RIVER = !hasArg('no-river');
const EXTRACT_TURN = !hasArg('no-turn') || EXTRACT_RIVER;
const LIST_ONLY = hasArg('list');
const MATCHUP_FILTER = getArg('matchup', null);

const PRECOMPUTE = join(__dirname, 'scripts', 'precompute-postflop.mjs');

// ---------------------------------------------------------------------------
// Board labels — read straight from precompute-postflop.mjs (single source of
// truth) so this driver never drifts out of sync with the board list.
// ---------------------------------------------------------------------------
function loadBoardLabels() {
  const src = readFileSync(PRECOMPUTE, 'utf-8');
  const m = src.match(/const FLOP_BOARDS\s*=\s*\[([\s\S]*?)\];/);
  if (!m) {
    console.error('[driver] Could not locate FLOP_BOARDS in precompute-postflop.mjs');
    process.exit(1);
  }
  const labels = [];
  const re = /label:\s*'([^']+)'/g;
  let mm;
  while ((mm = re.exec(m[1])) !== null) labels.push(mm[1]);
  return labels;
}

// ---------------------------------------------------------------------------
// Existing solutions — determine which boards are already fully solved.
// ---------------------------------------------------------------------------
function fileSuffix(depth) {
  return depth === '100bb' ? '' : `-${depth}`;
}

// River is stored per (depth, matchup, board) under js/data/river/<depth>/,
// matching precompute-postflop's writeRiverBoard(). The presence of the file
// means that board's river was extracted (same check precompute's skip guard
// uses), so the driver must look here rather than in a monolithic river file.
function riverBoardPath(mk, label) {
  return join(__dirname, 'js', 'data', 'river', DEPTH, mk, `${label}.json`);
}

// Generic loader for the flop / turn / river solution files of a depth.
//   kind: 'flop' | 'turn' | 'river'
function loadDataFile(kind) {
  const infix = kind === 'flop' ? '' : `-${kind}`;
  const p = join(__dirname, 'js', 'data', `postflop-solutions${infix}${fileSuffix(DEPTH)}.js`);
  if (!existsSync(p)) return {};
  const varRe =
    kind === 'turn'
      ? /GTO\.Data\.PostflopSolutionsTurn[A-Za-z0-9_]*\s*=\s*(\{[\s\S]*\});/
      : kind === 'river'
      ? /GTO\.Data\.PostflopSolutionsRiver[A-Za-z0-9_]*\s*=\s*(\{[\s\S]*\});/
      : /GTO\.Data\.PostflopSolutions(?:_[A-Za-z0-9]+)?\s*=\s*(\{[\s\S]*\});/;
  try {
    const content = readFileSync(p, 'utf-8');
    const m = content.match(varRe);
    return m ? JSON.parse(m[1]) : {};
  } catch (e) {
    console.error(`[driver] Warning: could not parse ${kind} solutions (${e.message}). Treating as empty.`);
    return {};
  }
}

// The set of matchups a board must contain to count as solved. Rather than
// trusting only what's already in the file (which would hide a newly-added
// matchup), use the matchups precompute will actually solve for this depth: the
// non-empty entries in postflop-input-ranges.json, unioned with whatever is
// already on disk. A --matchup run narrows this to just that matchup, so a new
// matchup can be filled board-by-board (cached) without touching the others.
function loadExpectedRangeMatchups() {
  const p = join(__dirname, 'js', 'data', 'postflop-input-ranges.json');
  if (!existsSync(p)) return null;
  try {
    const parsed = JSON.parse(readFileSync(p, 'utf-8'));
    const section = parsed.cases ? parsed.cases[DEPTH] : parsed.matchups;
    if (!section) return null;
    return Object.entries(section)
      .filter(([, v]) => v && String(v.oop || '').trim() && String(v.ip || '').trim())
      .map(([k]) => k);
  } catch (e) {
    console.error(`[driver] Warning: could not parse input ranges (${e.message}). Using on-disk matchups.`);
    return null;
  }
}

function expectedMatchups(flop) {
  if (MATCHUP_FILTER) return [MATCHUP_FILTER];
  const fileKeys = Object.keys(flop);
  const rangeKeys = loadExpectedRangeMatchups();
  if (!rangeKeys || rangeKeys.length === 0) return fileKeys;
  return Array.from(new Set([...fileKeys, ...rangeKeys]));
}

// A board is "solved" only when every EXPECTED matchup has:
//   • flop nodes, AND
//   • turn lines (when turn extraction is enabled), AND
//   • river lines (when river extraction is enabled).
// This makes flop-only (incomplete) boards, and boards missing a newly-added
// matchup, count as UNSOLVED so they are (re)solved and their data filled in.
function boardSolved(flop, turn, label, expected) {
  if (!expected || expected.length === 0) return false;
  return expected.every((mk) => {
    const entry = flop[mk] && flop[mk][label];
    if (!entry || entry.error || !entry.nodes) return false;
    if (EXTRACT_TURN) {
      const t = turn[mk] && turn[mk][label];
      if (!t || !t.lines || Object.keys(t.lines).length === 0) return false;
    }
    if (EXTRACT_RIVER) {
      // River lives in a per-board file (js/data/river/<depth>/<mk>/<label>.json),
      // exactly like precompute's own skip guard checks it.
      if (!existsSync(riverBoardPath(mk, label))) return false;
    }
    return true;
  });
}

// ---------------------------------------------------------------------------
// Run precompute for a single board (fresh process, inherited stdio).
// ---------------------------------------------------------------------------
function solveBoard(label) {
  const childArgs = [
    PRECOMPUTE,
    '--depth', DEPTH,
    '--board', label,
    '--iterations', ITERATIONS,
    '--target', TARGET,
    '--engine', ENGINE,
  ];
  if (MATCHUP_FILTER) childArgs.push('--matchup', MATCHUP_FILTER);
  if (!EXTRACT_TURN) childArgs.push('--no-turn');
  if (!EXTRACT_RIVER) childArgs.push('--no-river');

  const res = spawnSync(process.execPath, childArgs, {
    cwd: __dirname,
    stdio: 'inherit',
    env: process.env,
  });
  return res.status === 0 && !res.error;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const labels = loadBoardLabels();
const flopSols = loadDataFile('flop');
const turnSols = EXTRACT_TURN ? loadDataFile('turn') : {};

const expected = expectedMatchups(flopSols);

const unsolved = labels.filter((l) => !boardSolved(flopSols, turnSols, l, expected));
const solved = labels.filter((l) => boardSolved(flopSols, turnSols, l, expected));

console.log(`[driver] Depth: ${DEPTH} | Engine: ${ENGINE} | iterations: ${ITERATIONS} | target: ${TARGET}%`);
console.log(`[driver] Extraction: flop${EXTRACT_TURN ? ' + turn' : ''}${EXTRACT_RIVER ? ' + river' : ''}`);
console.log(`[driver] Matchups required per board: ${expected.length}${MATCHUP_FILTER ? ` (filter: ${MATCHUP_FILTER})` : ''}`);
console.log(`[driver] Boards: ${labels.length} total, ${solved.length} solved, ${unsolved.length} unsolved`);
if (solved.length) console.log(`[driver] Solved:   ${solved.join(', ')}`);
if (unsolved.length) console.log(`[driver] Unsolved: ${unsolved.join(', ')}`);

if (LIST_ONLY) process.exit(0);
if (unsolved.length === 0) {
  console.log('[driver] Nothing to do — all boards solved.');
  process.exit(0);
}

const failures = [];
let done = 0;
for (const label of unsolved) {
  done++;
  console.log(`\n[driver] ===== [${done}/${unsolved.length}] Solving board ${label} =====`);
  const ok = solveBoard(label);
  if (ok) {
    console.log(`[driver] Board ${label} finished (saved to disk).`);
  } else {
    console.error(`[driver] Board ${label} FAILED — continuing with the rest. Re-run later to retry.`);
    failures.push(label);
  }
}

console.log(`\n[driver] Complete. ${unsolved.length - failures.length}/${unsolved.length} boards finished.`);
if (failures.length) {
  console.error(`[driver] Failed boards (retry by re-running this script): ${failures.join(', ')}`);
  process.exit(1);
}
