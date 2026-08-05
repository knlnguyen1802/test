#!/usr/bin/env node
// ============================================================================
// Parallel Postflop Pre-computation Script
// ============================================================================
// Fans postflop board solves out across multiple worker processes so you can
// use all of your machine's cores at once.
//
// How it works:
//   - One worker process per board. The existing precompute-postflop.mjs
//     already solves ALL matchups for a board when given `--board <label>`,
//     so a worker = one board.
//   - The parent keeps up to `--parallel` workers running simultaneously
//     (default 8), i.e. ~8 boards are solved at the same time.
//   - Every worker runs with `--no-index` so workers never race each other
//     writing the shared postflop-solution-index file. Once ALL workers have
//     finished, the parent writes the index exactly once.
//
// Each spot still runs in its own fresh child inside the worker (same as the
// sequential script), so WASM memory is per-process.
//
// Usage:
//   node scripts/precompute-postflop-parallel.mjs                 # 8 boards at once
//   node scripts/precompute-postflop-parallel.mjs --parallel 8    # explicit
//   node scripts/precompute-postflop-parallel.mjs --parallel 16   # more cores
//   node scripts/precompute-postflop-parallel.mjs --depth 3bet    # 3bet pots
//   node scripts/precompute-postflop-parallel.mjs --board A72r    # single board
//   node scripts/precompute-postflop-parallel.mjs --iterations 100
//   node scripts/precompute-postflop-parallel.mjs --force         # re-solve all
//   node scripts/precompute-postflop-parallel.mjs --engine native
//   node scripts/precompute-postflop-parallel.mjs --no-index      # don't write index
//
// All other flags of precompute-postflop.mjs are passed through to the workers
// automatically. Incremental skip logic is preserved: already-solved boards
// are skipped inside each worker unless --force is given.
//
// Memory note: each worker can use up to ~4 GiB (WASM address space). Running
// N boards in parallel therefore needs roughly N × 4 GiB of free RAM.
// ============================================================================

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync, writeFileSync } from 'fs';
import { FLOP_BOARDS, DEPTH_CONFIGS } from './postflop_config/index.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..');
const WORKER_SCRIPT = join(__dirname, 'precompute-postflop.mjs');

// ---------------------------------------------------------------------------
// Parse CLI arguments
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
function getArg(name, defaultVal) {
  const idx = args.indexOf('--' + name);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : defaultVal;
}
function hasArg(name) {
  return args.indexOf('--' + name) >= 0;
}

// Flags this driver consumes itself; everything else is forwarded to workers.
const CONSUMED = new Set(['--parallel', '--board', '--no-index']);

const PARALLEL = Math.max(1, parseInt(getArg('parallel', '8'), 10));
const DEPTH = getArg('depth', 'srp');
const FILTER_BOARD = getArg('board', null);
const NO_INDEX = hasArg('no-index');

// Values the shared index records (parsed here too, so the parent's index
// matches what the workers actually ran with).
const MAX_ITERATIONS = parseInt(getArg('iterations', '100'), 10);
const TARGET_EXPLOIT_PCT = parseFloat(getArg('target', '1.0'));

// Everything the driver doesn't consume → forwarded verbatim to each worker.
const CHILD_PASSTHROUGH = args.filter((a, i) => {
  if (CONSUMED.has(a)) return false;
  if (CONSUMED.has(args[i - 1])) return false; // value belonging to a consumed flag
  return true;
});

// Matchups for the shared index (populated in main(); same case mapping as the
// sequential script). Declared here so writeIndex() can read it.
let MATCHUP_KEYS = [];

// ---------------------------------------------------------------------------
// Worker pool
// ---------------------------------------------------------------------------
function runWorker(board) {
  return new Promise((resolve) => {
    const childArgs = ['--board', board.label, ...CHILD_PASSTHROUGH, '--no-index'];
    const child = spawn(process.execPath, [WORKER_SCRIPT, ...childArgs], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const prefix = `[${board.label}]`;
    let stdout = '';
    let stderr = '';
    let lineBuf = '';

    child.stdout.on('data', (d) => {
      stdout += d.toString();
      lineBuf += d.toString();
      let idx;
      while ((idx = lineBuf.indexOf('\n')) >= 0) {
        const line = lineBuf.slice(0, idx);
        lineBuf = lineBuf.slice(idx + 1);
        if (line.trim()) console.log(`${prefix} ${line}`);
      }
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString();
      process.stderr.write(`${prefix} ${d}`);
    });

    child.on('error', (e) => {
      resolve({ board, code: -1, stdout, stderr, spawnError: e.message });
    });
    child.on('close', (code) => {
      if (lineBuf.trim()) console.log(`${prefix} ${lineBuf.trim()}`);
      resolve({ board, code, stdout, stderr, spawnError: null });
    });
  });
}

// ---------------------------------------------------------------------------
// Shared index (mirrors precompute-postflop.mjs) — written once by the parent.
// ---------------------------------------------------------------------------
function writeIndex() {
  const FILE_SUFFIX = DEPTH === '100bb' ? '' : `-${DEPTH}`;
  const VAR_SUFFIX = DEPTH === '100bb' ? '' : '_' + DEPTH.toUpperCase();
  const cfg = DEPTH_CONFIGS[DEPTH];
  const indexData = {
    depth: DEPTH,
    matchups: MATCHUP_KEYS,
    boards: FLOP_BOARDS.map(b => ({ label: b.label, board: b.board.join(''), texture: b.texture })),
    settings: {
      pot: cfg.pot,
      stack: cfg.stack,
      maxIterations: MAX_ITERATIONS,
      targetExploitability: TARGET_EXPLOIT_PCT,
      betSizes: cfg.betSizes,
    },
    generated: new Date().toISOString(),
  };
  const indexPath = join(PROJECT_ROOT, 'js', 'data', `postflop-solution-index${FILE_SUFFIX}.js`);
  const indexContent = `// Pre-computed Postflop Solutions — Index/Metadata (${DEPTH})\n// Auto-generated by scripts/precompute-postflop.mjs\n\nwindow.GTO = window.GTO || {};\nGTO.Data = GTO.Data || {};\n\nGTO.Data.PostflopSolutionIndex${VAR_SUFFIX} = ${JSON.stringify(indexData, null, 2)};\n`;
  writeFileSync(indexPath, indexContent, 'utf-8');
  console.log(`[parallel] Index: ${indexPath}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  if (!DEPTH_CONFIGS[DEPTH]) {
    console.error(`[parallel] Unknown depth: ${DEPTH}. Valid: ${Object.keys(DEPTH_CONFIGS).join(', ')}`);
    process.exit(1);
  }

  // Matchups for the index (same case mapping as the sequential script).
  const RANGE_CASE = DEPTH === '100bb' ? 'srp' : DEPTH;
  try {
    const parsed = JSON.parse(
      readFileSync(join(PROJECT_ROOT, 'js', 'data', 'postflop-input-ranges.json'), 'utf-8')
    );
    MATCHUP_KEYS = Object.keys((parsed.cases && parsed.cases[RANGE_CASE]) || {});
  } catch (e) {
    console.warn(`[parallel] Could not load ranges for index (${e.message}); index may be incomplete.`);
  }

  const boards = FILTER_BOARD
    ? FLOP_BOARDS.filter(b => b.label === FILTER_BOARD)
    : FLOP_BOARDS;
  if (boards.length === 0) {
    console.error(`[parallel] No board with label '${FILTER_BOARD}' in FLOP_BOARDS.`);
    process.exit(1);
  }

  const queue = [...boards];
  const concurrency = Math.min(PARALLEL, queue.length);
  const start = Date.now();

  console.log(`[parallel] Depth: ${DEPTH}`);
  console.log(`[parallel] Boards to solve: ${queue.length} (${concurrency} at a time, ~${Math.ceil(queue.length / concurrency)} waves)`);
  console.log(`[parallel] Worker cmd: node scripts/precompute-postflop.mjs --board <label> --no-index ${CHILD_PASSTHROUGH.join(' ')}`);
  console.log('');

  let solved = 0;
  let skipped = 0;
  let spotErrors = 0;
  let workerFailures = 0;

  const worker = async () => {
    while (queue.length) {
      const board = queue.shift();
      const res = await runWorker(board);
      const summary = res.stdout.match(/Done\.\s+(\d+) solved,\s+(\d+) skipped,\s+(\d+) errors\./);
      if (res.code !== 0) {
        workerFailures++;
        const detail = res.spawnError ? ` (${res.spawnError})` : '';
        console.log(`[parallel] ${board.label} — worker process exited ${res.code}${detail}`);
        const tail = (res.stderr || res.stdout).trim().split('\n').slice(-5).join(' | ');
        if (tail) console.log(`[parallel] ${board.label} — last output: ${tail}`);
      } else if (summary) {
        solved += parseInt(summary[1], 10);
        skipped += parseInt(summary[2], 10);
        spotErrors += parseInt(summary[3], 10);
      } else {
        console.log(`[parallel] ${board.label} — worker finished without a summary line (check output above)`);
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, worker));

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\n[parallel] Done in ${elapsed}s. ${solved} solved, ${skipped} skipped, ${spotErrors} spot errors, ${workerFailures} worker failures.`);

  if (!NO_INDEX) writeIndex();
}

main().catch((e) => {
  console.error('[parallel] Fatal error:', e);
  process.exit(1);
});
