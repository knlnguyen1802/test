#!/usr/bin/env node
// ============================================================================
// Debug: Test postflop child process in isolation (no fork)
// Run: node scripts/_debug_postflop_child.mjs
// ============================================================================

import { readFileSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..');

// ── Step 1: Try loading WASM ──
console.log('Step 1: Loading WASM...');
let GameManager;
try {
  const wasmPath = join(PROJECT_ROOT, 'js', 'solver', 'pkg', 'gto_solver_wasm_bg.wasm');
  const gluePath = join(PROJECT_ROOT, 'js', 'solver', 'pkg', 'gto_solver_wasm.js');
  console.log(`  wasmPath: ${wasmPath}`);
  console.log(`  gluePath: ${gluePath}`);
  console.log(`  gluePath URL: ${pathToFileURL(gluePath).href}`);

  const wasmBytes = readFileSync(wasmPath);
  console.log(`  wasmBytes: ${wasmBytes.length} bytes`);

  const glue = await import(pathToFileURL(gluePath).href);
  console.log(`  glue keys: ${Object.keys(glue).join(', ')}`);

  const wasm = glue.initSync({ module: wasmBytes });
  console.log(`  initSync OK, wasm keys: ${Object.keys(wasm).slice(0, 10).join(', ')}...`);

  GameManager = glue.GameManager;
  console.log(`  GameManager: ${typeof GameManager}`);
} catch (e) {
  console.error('WASM LOAD FAILED:', e.message);
  console.error(e.stack);
  process.exit(1);
}

// ── Step 2: Try creating a GameManager ──
console.log('\nStep 2: Creating GameManager...');
let manager;
try {
  manager = GameManager.new();
  console.log(`  manager: ${typeof manager}, ptr: ${manager.__wbg_ptr}`);
} catch (e) {
  console.error('NEW FAILED:', e.message);
  console.error(e.stack);
  process.exit(1);
}

// ── Step 3: Try init with minimal ranges ──
console.log('\nStep 3: Init with minimal ranges...');

// Simple ranges: just AA
const oopRange = new Float32Array(1326);
// Set AA combos (indices 0-5 are the 6 AA combinations)
for (let i = 0; i < 6; i++) oopRange[i] = 1.0;

const ipRange = new Float32Array(1326);
// Set KK combos (indices 6-11 are the 6 KK combinations)
for (let i = 6; i < 12; i++) ipRange[i] = 1.0;

// Simple board: Ac 7d 2h → card IDs: Ac(rank12='A',suit0='c')=48, 7d(rank5='7',suit1='d')=21, 2h(rank0='2',suit2='h')=2
const board = new Uint8Array([48, 21, 2]);

console.log(`  oopRange: Float32Array(${oopRange.length}), sum=${oopRange.reduce((a,b)=>a+b,0)}`);
console.log(`  ipRange: Float32Array(${ipRange.length}), sum=${ipRange.reduce((a,b)=>a+b,0)}`);
console.log(`  board: [${Array.from(board)}]`);

try {
  const err = manager.init(
    oopRange, ipRange, board,
    100, 450,   // starting_pot, effective_stack
    0, 0, false, // rake_rate, rake_cap, donk_option
    '33%', '60%',                // oop_flop_bet, oop_flop_raise
    '67%', '60%', '',            // oop_turn_bet, oop_turn_raise, oop_turn_donk
    '67%', '60%', '',            // oop_river_bet, oop_river_raise, oop_river_donk
    '33%', '60%',                // ip_flop_bet, ip_flop_raise
    '67%', '60%',                // ip_turn_bet, ip_turn_raise
    '67%', '60%',                // ip_river_bet, ip_river_raise
    1.5, 0.15, 0.1, '', ''       // thresholds, added_lines, removed_lines
  );

  if (err) {
    console.log(`  init returned error: ${err}`);
  } else {
    console.log('  init OK (no error)');
  }
} catch (e) {
  console.error('INIT FAILED:', e.message);
  console.error(e.stack);
  process.exit(1);
}

console.log('\n=== ALL STEPS PASSED ===');
process.exit(0);
