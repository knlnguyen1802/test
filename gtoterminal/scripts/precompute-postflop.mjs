#!/usr/bin/env node
// ============================================================================
// Postflop Pre-computation Script
// ============================================================================
// Batch-solves common postflop spots using the WASM solver in Node.js.
// Each spot is solved in a child process to get fresh WASM memory.
//
// Usage:
//   node scripts/precompute-postflop.mjs                    # all spots (default: srp)
//   node scripts/precompute-postflop.mjs --depth srp        # 100bb single-raised pot (SPR 16)
//   node scripts/precompute-postflop.mjs --depth 3bet       # 100bb 3bet pot (SPR 5.4)
//   node scripts/precompute-postflop.mjs --depth 4bet       # 100bb 4bet pot (SPR 1.7)
//   node scripts/precompute-postflop.mjs --no-turn          # skip turn (and river) extraction
//   node scripts/precompute-postflop.mjs --no-river         # skip river extraction (turn kept)
//   node scripts/precompute-postflop.mjs --iterations 100   # fewer iterations
//   node scripts/precompute-postflop.mjs --matchup SB_vs_BB # single matchup
//   node scripts/precompute-postflop.mjs --board A72r       # single board
//   node scripts/precompute-postflop.mjs --force            # re-solve & overwrite existing
//   node scripts/precompute-postflop.mjs --engine native    # force native binary (host RAM)
//   node scripts/precompute-postflop.mjs --engine wasm      # force in-process WASM (4 GiB cap)
//   node scripts/precompute-postflop.mjs --child <json>     # internal: run single solve
//
// Case configs (pot normalized to 100 in all cases):
//   Preflop-line cases (all 100bb effective, SPR set by the preflop line):
//     srp:   stack=1600 (SPR 16,  single-raised pot)
//     3bet:  stack=540  (SPR 5.4, 3bet pot)
//     4bet:  stack=170  (SPR 1.7, 4bet pot)
//   Legacy stack-depth cases:
//     100bb: stack=450  (SPR ~4.5, deep play, multiple streets)
//     40bb:  stack=175  (SPR ~1.75, shallower, more turn/river jams)
//     25bb:  stack=100  (SPR ~1.0, often 1-2 streets of play)
//     15bb:  stack=50   (SPR ~0.5, flop jam-or-fold territory)
//
// Performance: ~2-5 min per spot (single-threaded WASM). Full batch (~115 spots)
// takes several hours. Use --matchup/--board to solve selectively.
//
// Requirements: Node.js 18+ (WebAssembly + ESM support), ~2GB free RAM
// ============================================================================

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { execSync, fork, spawn } from 'child_process';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';
import { LINE_BET_SIZES, DEPTH_CONFIGS, MATCHUPS, FLOP_BOARDS } from './postflop_config/index.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..');

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

const MAX_ITERATIONS = parseInt(getArg('iterations', '100'), 10);
const TARGET_EXPLOIT_PCT = parseFloat(getArg('target', '1.0'));  // % of pot
const FILTER_MATCHUP = getArg('matchup', null);
const FILTER_BOARD = getArg('board', null);
const IS_CHILD = hasArg('child');
// --force: re-solve and overwrite even when a solution already exists on disk
// (default is an incremental build that skips already-solved spots).
const FORCE = hasArg('force');
// Turn + river extraction are ON by default. Disable with --no-turn / --no-river.
// (River always requires turn, so --no-turn is ignored while river is enabled.)
const EXTRACT_RIVER = !hasArg('no-river');
const EXTRACT_TURN = (!hasArg('no-turn') || EXTRACT_RIVER);
// --builtin-ranges: ignore preflop-derived ranges and use the hardcoded MATCHUPS.
const USE_BUILTIN_RANGES = hasArg('builtin-ranges');

// --engine: which solver engine to use.
//   auto   (default) → native binary if it's built, otherwise WASM fallback
//   native           → force the native binary (no 4 GiB cap; uses host RAM)
//   wasm             → force the in-process WASM child (4 GiB address-space cap)
const ENGINE = getArg('engine', 'auto');
const NATIVE_BIN = join(PROJECT_ROOT, 'solver-native', 'target', 'release',
  process.platform === 'win32' ? 'gto-solver-native.exe' : 'gto-solver-native');
const NATIVE_AVAILABLE = existsSync(NATIVE_BIN);

// ---------------------------------------------------------------------------
// Case configuration — maps a case key to solver pot/stack/tree settings.
// LINE_BET_SIZES and DEPTH_CONFIGS are defined in
// scripts/postflop_config/game-tree.mjs (imported above).
// ---------------------------------------------------------------------------

const DEPTH = getArg('depth', 'srp');
if (!DEPTH_CONFIGS[DEPTH]) {
  console.error(`[precompute] Unknown depth: ${DEPTH}. Valid: ${Object.keys(DEPTH_CONFIGS).join(', ')}`);
  process.exit(1);
}
const DEPTH_CFG = DEPTH_CONFIGS[DEPTH];
const STARTING_POT = DEPTH_CFG.pot;
const EFFECTIVE_STACK = DEPTH_CFG.stack;
// File / variable suffix for this case. 100bb stays unsuffixed for back-compat;
// every other case (incl. srp/3bet/4bet) gets an upper-cased variable suffix.
const FILE_SUFFIX = DEPTH === '100bb' ? '' : `-${DEPTH}`;
const VAR_SUFFIX = DEPTH === '100bb' ? '' : '_' + DEPTH.toUpperCase();

// ---------------------------------------------------------------------------
// Card / Range utilities
// ---------------------------------------------------------------------------
const RANKS = '23456789TJQKA';
const SUITS = 'cdhs';

function cardId(rankChar, suitChar) {
  return 4 * RANKS.indexOf(rankChar) + SUITS.indexOf(suitChar);
}

function indexToCard(idx) {
  return RANKS[Math.floor(idx / 4)] + SUITS[idx % 4];
}

function possibleCards(boardCards) {
  const boardSet = new Set(boardCards.map(c => cardId(c[0], c[1])));
  const cards = [];
  for (let c = 0; c < 52; c++) {
    if (!boardSet.has(c)) cards.push(c);
  }
  return cards;
}

function parseBoard(cards) {
  const board = new Uint8Array(cards.length);
  for (let i = 0; i < cards.length; i++) {
    board[i] = cardId(cards[i][0], cards[i][1]);
  }
  return board;
}

function cardPairIndex(c1, c2) {
  if (c1 > c2) { const tmp = c1; c1 = c2; c2 = tmp; }
  return c1 * (101 - c1) / 2 + c2 - 1;
}

function parseRange(text) {
  const range = new Float32Array(1326);
  if (!text || !text.trim()) return range;

  const parts = text.split(',');
  for (const raw of parts) {
    let part = raw.trim();
    if (!part) continue;

    let weight = 1.0;
    const colonIdx = part.indexOf(':');
    if (colonIdx >= 0) {
      weight = parseFloat(part.substring(colonIdx + 1));
      part = part.substring(0, colonIdx);
    }

    const dashIdx = part.indexOf('-');
    if (dashIdx >= 0) {
      const start = part.substring(0, dashIdx);
      const end = part.substring(dashIdx + 1);
      const hands = expandRange(start, end);
      for (const h of hands) setHandWeight(range, h, weight);
      continue;
    }

    setHandWeight(range, part, weight);
  }
  return range;
}

function expandRange(start, end) {
  const hands = [];
  if (start.length === 2 && start[0] === start[1] && end.length === 2 && end[0] === end[1]) {
    const r1 = RANKS.indexOf(start[0]);
    const r2 = RANKS.indexOf(end[0]);
    for (let r = Math.min(r1, r2); r <= Math.max(r1, r2); r++) {
      hands.push(RANKS[r] + RANKS[r]);
    }
  } else if (start.length === 3 && start[2] === 's' && end.length === 3 && end[2] === 's') {
    const high = RANKS.indexOf(start[0]);
    const r1 = RANKS.indexOf(start[1]);
    const r2 = RANKS.indexOf(end[1]);
    for (let r = Math.min(r1, r2); r <= Math.max(r1, r2); r++) {
      hands.push(RANKS[high] + RANKS[r] + 's');
    }
  } else if (start.length === 3 && start[2] === 'o' && end.length === 3 && end[2] === 'o') {
    const high = RANKS.indexOf(start[0]);
    const r1 = RANKS.indexOf(start[1]);
    const r2 = RANKS.indexOf(end[1]);
    for (let r = Math.min(r1, r2); r <= Math.max(r1, r2); r++) {
      hands.push(RANKS[high] + RANKS[r] + 'o');
    }
  }
  return hands;
}

function setHandWeight(range, hand, weight) {
  if (hand.length === 2 && hand[0] === hand[1]) {
    const r = RANKS.indexOf(hand[0]);
    for (let s1 = 0; s1 < 4; s1++)
      for (let s2 = s1 + 1; s2 < 4; s2++)
        range[cardPairIndex(4 * r + s1, 4 * r + s2)] = weight;
  } else if (hand.length === 3 && hand[2] === 's') {
    const r1 = RANKS.indexOf(hand[0]), r2 = RANKS.indexOf(hand[1]);
    for (let s = 0; s < 4; s++)
      range[cardPairIndex(4 * r1 + s, 4 * r2 + s)] = weight;
  } else if (hand.length === 3 && hand[2] === 'o') {
    const r1 = RANKS.indexOf(hand[0]), r2 = RANKS.indexOf(hand[1]);
    for (let s1 = 0; s1 < 4; s1++)
      for (let s2 = 0; s2 < 4; s2++) {
        if (s1 === s2) continue;
        range[cardPairIndex(4 * r1 + s1, 4 * r2 + s2)] = weight;
      }
  } else if (hand.length === 2 && hand[0] !== hand[1]) {
    const r1 = RANKS.indexOf(hand[0]), r2 = RANKS.indexOf(hand[1]);
    for (let s1 = 0; s1 < 4; s1++)
      for (let s2 = 0; s2 < 4; s2++) {
        const c1 = 4 * r1 + s1, c2 = 4 * r2 + s2;
        if (c1 !== c2) range[cardPairIndex(c1, c2)] = weight;
      }
  }
}

// ---------------------------------------------------------------------------
// Position matchup definitions — imported from postflop_config/matchups.mjs.
// MATCHUPS is mutated in place below with preflop-derived range overrides.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Preflop-derived range override
// If js/data/postflop-input-ranges.json exists (produced by
// scripts/preflop-to-postflop-ranges.mjs), use those ranges so the postflop
// solve is consistent with the preflop solution. Pass --builtin-ranges to skip.
// The parent process reads MATCHUPS and passes the range strings to children,
// so only the parent needs the override.
// ---------------------------------------------------------------------------
if (!IS_CHILD && !USE_BUILTIN_RANGES) {
  const rangesPath = join(PROJECT_ROOT, 'js', 'data', 'postflop-input-ranges.json');
  if (existsSync(rangesPath)) {
    try {
      const parsed = JSON.parse(readFileSync(rangesPath, 'utf-8'));
      // Per-case ranges (srp/3bet/4bet) live under parsed.cases[DEPTH]; the
      // legacy single-range format lives under parsed.matchups.
      const overrides = (parsed.cases && parsed.cases[DEPTH]) || parsed.matchups || {};
      let applied = 0;
      let backedUp = 0;
      for (const [key, val] of Object.entries(overrides)) {
        if (!val) continue;
        const builtin = MATCHUPS[key] || {};
        // Keep the built-in default range as backup for any empty derived side
        // (the preflop solver 3bets instead of flatting, so the derived IP
        // flat-call range is often empty — do NOT replace it with 3bet hands).
        const oop = (val.oop && val.oop.trim()) ? val.oop : builtin.oop;
        const ip = (val.ip && val.ip.trim()) ? val.ip : builtin.ip;
        if (!oop || !ip) continue; // nothing derived and no built-in — leave as-is
        if (!val.oop || !val.oop.trim() || !val.ip || !val.ip.trim()) backedUp++;
        MATCHUPS[key] = { oop, ip };
        applied++;
      }
      if (applied > 0) {
        const backupNote = backedUp > 0 ? ` (${backedUp} kept built-in default for an empty side)` : '';
        const caseNote = (parsed.cases && parsed.cases[DEPTH]) ? ` case=${DEPTH}` : '';
        console.log(`[precompute] Using preflop-derived ranges (${parsed.source || 'postflop-input-ranges.json'}${caseNote}) — ${applied} matchups${backupNote}. Use --builtin-ranges to override.`);
      }
    } catch (e) {
      console.log(`[precompute] WARNING: failed to load postflop-input-ranges.json (${e.message}). Using built-in ranges.`);
    }
  }
}

// ---------------------------------------------------------------------------
// Board definitions — imported from postflop_config/flop-boards.mjs (FLOP_BOARDS)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Bet sizing: from depth config (varies by stack depth)
// This keeps the game tree small enough for practical batch solving.
// The check/bet frequencies still provide actionable GTO insight.
// ---------------------------------------------------------------------------
const BET_SIZES = DEPTH_CFG.betSizes;

// ---------------------------------------------------------------------------
// Child process mode: solve a single spot
// ---------------------------------------------------------------------------
if (IS_CHILD) {
  try {
  const config = JSON.parse(getArg('child', '{}'));

  const wasmPath = join(PROJECT_ROOT, 'js', 'solver', 'pkg', 'gto_solver_wasm_bg.wasm');
  const gluePath = join(PROJECT_ROOT, 'js', 'solver', 'pkg', 'gto_solver_wasm.js');
  const wasmBytes = readFileSync(wasmPath);
  const glue = await import(pathToFileURL(gluePath).href);
  glue.initSync({ module: wasmBytes });
  const { GameManager } = glue;

  const oopRange = parseRange(config.oopRange);
  const ipRange = parseRange(config.ipRange);
  const board = parseBoard(config.board);

  const manager = GameManager.new();
  const err = manager.init(
    oopRange, ipRange, board,
    STARTING_POT, EFFECTIVE_STACK,
    0, 0, DEPTH_CFG.donkOption || false,
    BET_SIZES.oopFlopBet, BET_SIZES.oopFlopRaise,
    BET_SIZES.oopTurnBet, BET_SIZES.oopTurnRaise, BET_SIZES.oopTurnDonk,
    BET_SIZES.oopRiverBet, BET_SIZES.oopRiverRaise, BET_SIZES.oopRiverDonk,
    BET_SIZES.ipFlopBet, BET_SIZES.ipFlopRaise,
    BET_SIZES.ipTurnBet, BET_SIZES.ipTurnRaise,
    BET_SIZES.ipRiverBet, BET_SIZES.ipRiverRaise,
    1.5, 0.15, 0.1, '', ''
  );

  if (err) {
    console.log(JSON.stringify({ error: err }));
    process.exit(0);
  }

  // Guard against WASM out-of-memory. wasm32 linear memory caps at 4 GiB, and
  // allocate_memory() aborts with an unrecoverable `unreachable` trap if the
  // tree doesn't fit. Check the required size first (compressed) and bail out
  // with a clear, catchable error instead of crashing the child process.
  const WASM_MEM_LIMIT = 3.6 * 1024 * 1024 * 1024; // ~3.6 GiB safe ceiling
  const memBytes = Number(manager.memory_usage(true));
  if (memBytes > WASM_MEM_LIMIT) {
    console.log(JSON.stringify({
      error: 'tree-too-large',
      message: `Tree needs ${(memBytes / 1024 / 1024 / 1024).toFixed(2)} GiB `
        + `(> ${(WASM_MEM_LIMIT / 1024 / 1024 / 1024).toFixed(1)} GiB wasm32 limit). `
        + `Reduce bet sizes for this case (fewer river sizes / drop donk or raise).`,
      memoryGiB: memBytes / 1024 / 1024 / 1024,
    }));
    process.exit(0);
  }

  manager.allocate_memory(true);

  const target = STARTING_POT * TARGET_EXPLOIT_PCT / 100;
  let iteration = 0;
  let exploit = manager.exploitability();

  while (iteration < MAX_ITERATIONS && exploit > target) {
    const batchSize = iteration < 20 ? 1 : 10;
    for (let i = 0; i < batchSize && iteration < MAX_ITERATIONS; i++) {
      manager.solve_step(iteration);
      iteration++;
    }
    exploit = manager.exploitability();
  }

  manager.finalize();

  const results = manager.get_results();
  const actions = manager.actions();
  const player = manager.current_player();
  const numActions = manager.num_actions();
  const oopCards = manager.private_cards(0);
  const ipCards = manager.private_cards(1);

  const oopLen = oopCards.length;
  const ipLen = ipCards.length;

  let offset = 0;
  const oopPot = results[offset++];
  const ipPot = results[offset++];
  const isEmptyFlag = results[offset++];

  const oopWeights = Array.from(results.slice(offset, offset + oopLen));
  offset += oopLen;
  const ipWeights = Array.from(results.slice(offset, offset + ipLen));
  offset += ipLen;

  // Skip normalized weights
  offset += oopLen + ipLen;

  let avgEquity = [0, 0];
  let avgEV = [0, 0];

  if (isEmptyFlag === 0) {
    const oopEquity = Array.from(results.slice(offset, offset + oopLen));
    offset += oopLen;
    const ipEquity = Array.from(results.slice(offset, offset + ipLen));
    offset += ipLen;
    const oopEV = Array.from(results.slice(offset, offset + oopLen));
    offset += oopLen;
    const ipEV = Array.from(results.slice(offset, offset + ipLen));
    offset += ipLen;

    // Skip EQR
    offset += oopLen + ipLen;

    for (let p = 0; p < 2; p++) {
      const eq = p === 0 ? oopEquity : ipEquity;
      const ev = p === 0 ? oopEV : ipEV;
      const w = p === 0 ? oopWeights : ipWeights;
      const len = p === 0 ? oopLen : ipLen;
      let wSum = 0, eqSum = 0, evSum = 0;
      for (let i = 0; i < len; i++) {
        wSum += w[i]; eqSum += eq[i] * w[i]; evSum += ev[i] * w[i];
      }
      if (wSum > 0) {
        avgEquity[p] = Math.round(eqSum / wSum * 1000) / 1000;
        avgEV[p] = Math.round(evSum / wSum * 100) / 100;
      }
    }
  }

  // Strategy
  let aggregateStrategy = null;
  if (player !== 'terminal' && player !== 'chance') {
    const activeLen = player === 'oop' ? oopLen : ipLen;
    const activeWeights = player === 'oop' ? oopWeights : ipWeights;
    const strategyLen = numActions * activeLen;
    const strategy = Array.from(results.slice(offset, offset + strategyLen));

    aggregateStrategy = [];
    let totalWeight = 0;
    for (let c = 0; c < activeLen; c++) totalWeight += activeWeights[c];
    for (let a = 0; a < numActions; a++) {
      let sum = 0;
      for (let c = 0; c < activeLen; c++) {
        sum += strategy[a * activeLen + c] * activeWeights[c];
      }
      aggregateStrategy.push(totalWeight > 0 ? Math.round(sum / totalWeight * 1000) / 1000 : 0);
    }
  }

  // -------------------------------------------------------------------------
  // Extract child game tree nodes (IP cbet, IP facing cbet, OOP facing probe)
  // The solver has already computed the full tree — we just need to navigate it.
  // -------------------------------------------------------------------------
  function extractNodeStrategy(history) {
    try {
      manager.apply_history(new Uint32Array(history));
      const nodeResults = manager.get_results();
      const nodeActions = manager.actions();
      const nodePlayer = manager.current_player();
      const nodeNumActions = manager.num_actions();

      if (nodePlayer === 'terminal' || nodePlayer === 'chance') return null;

      // Parse packed results array (same format as root)
      let off = 0;
      off++; // oopPot
      off++; // ipPot
      const nodeIsEmpty = nodeResults[off++];

      const nodeOopW = Array.from(nodeResults.slice(off, off + oopLen));
      off += oopLen;
      const nodeIpW = Array.from(nodeResults.slice(off, off + ipLen));
      off += ipLen;

      // Skip normalized weights
      off += oopLen + ipLen;

      if (nodeIsEmpty === 0) {
        off += oopLen; // oop equity
        off += ipLen;  // ip equity
        off += oopLen; // oop EV
        off += ipLen;  // ip EV
        off += oopLen; // oop EQR
        off += ipLen;  // ip EQR
      }

      // Extract aggregate strategy
      const activeLen = nodePlayer === 'oop' ? oopLen : ipLen;
      const activeW = nodePlayer === 'oop' ? nodeOopW : nodeIpW;
      const stratLen = nodeNumActions * activeLen;
      const strat = Array.from(nodeResults.slice(off, off + stratLen));

      const agg = [];
      let totalW = 0;
      for (let c = 0; c < activeLen; c++) totalW += activeW[c];
      for (let a = 0; a < nodeNumActions; a++) {
        let sum = 0;
        for (let c = 0; c < activeLen; c++) {
          sum += strat[a * activeLen + c] * activeW[c];
        }
        agg.push(totalW > 0 ? Math.round(sum / totalW * 1000) / 1000 : 0);
      }

      return { actions: nodeActions, player: nodePlayer, numActions: nodeNumActions, strategy: agg };
    } catch (e) {
      return null;
    }
  }

  // --- Semantic action selectors (mirror of the native `Sel` resolver) ---
  // Resolve a node's child index by inspecting its live action labels instead of
  // assuming fixed indices, so extraction survives all-in insertion / bet-size
  // merging at low SPR (3bet / 4bet pots).
  function parseActionLabels(actionsStr) {
    return (actionsStr || '').split('/').map(tok => {
      const [label, amt] = tok.split(':');
      return { label, amt: parseFloat(amt) || 0 };
    });
  }

  // Aggressive first actions are `Bet`; if a size was forced all-in the tree has
  // `Allin` instead, so we fall back to it. When only one bet size survives,
  // BetSmall and BetLarge collapse to the same node (honest: no distinct size).
  function resolveSel(acts, sel) {
    const posOf = (l) => { const i = acts.findIndex(a => a.label === l); return i < 0 ? null : i; };
    const allin = () => posOf('Allin');
    const bets = acts
      .map((a, i) => ({ i, label: a.label, amt: a.amt }))
      .filter(a => a.label === 'Bet')
      .sort((a, b) => a.amt - b.amt);
    switch (sel) {
      case 'Check': return posOf('Check');
      case 'Call':  return posOf('Call');
      case 'BetSmall':
        return bets.length ? bets[0].i : allin();
      case 'BetLarge':
        if (bets.length >= 2) return bets[bets.length - 1].i;
        if (bets.length === 1) {
          const ai = allin();
          return (ai != null && acts[ai].amt > bets[0].amt) ? ai : bets[0].i;
        }
        return allin();
      case 'Raise': {
        const r = posOf('Raise');
        return r != null ? r : allin();
      }
      default: return null;
    }
  }

  // Walk selectors from a base history, reading each node's live actions to
  // resolve the next concrete index. Returns the full history array or null.
  function resolvePath(baseHistory, sels) {
    const hist = [...baseHistory];
    for (const sel of sels) {
      let player, actionsStr;
      try {
        manager.apply_history(new Uint32Array(hist));
        player = manager.current_player();
        if (player === 'terminal' || player === 'chance') return null;
        actionsStr = manager.actions();
      } catch (_) { return null; }
      const idx = resolveSel(parseActionLabels(actionsStr), sel);
      if (idx == null) return null;
      hist.push(idx);
    }
    return hist;
  }

  const nodes = {};

  // Address each flop node by action selectors (label-resolved), not fixed
  // indices, so extraction stays correct when the tree changes shape at low SPR.
  //   *_cbet       → small bet (villain's first sizing)
  //   *_cbet_large → large bet (villain's second sizing)
  //   *_facing_raise_* → hero bet, villain raised (split by hero's bet size)
  for (const [key, sels] of [
    ['ip_cbet',                ['Check']],
    ['ip_facing_cbet',         ['BetSmall']],
    ['ip_facing_cbet_large',   ['BetLarge']],
    ['oop_facing_cbet',        ['Check', 'BetSmall']],
    ['oop_facing_cbet_large',  ['Check', 'BetLarge']],
    ['oop_facing_raise_small', ['BetSmall', 'Raise']],
    ['oop_facing_raise_large', ['BetLarge', 'Raise']],
    ['ip_facing_raise_small',  ['Check', 'BetSmall', 'Raise']],
    ['ip_facing_raise_large',  ['Check', 'BetLarge', 'Raise']],
  ]) {
    const hist = resolvePath([], sels);
    if (!hist) continue;
    const n = extractNodeStrategy(hist);
    if (n) nodes[key] = n;
  }

  // -------------------------------------------------------------------------
  // Multi-street extraction helpers
  // -------------------------------------------------------------------------

  // Extract 10 decision nodes at a given tree position:
  //   [0] OOP first to act       [1] IP after OOP check
  //   [2] IP facing OOP bet SMALL   [3] OOP facing IP probe SMALL
  //   [4] OOP facing raise (bet small)   [5] OOP facing raise (bet large)
  //   [6] IP facing check-raise (bet small) [7] IP facing check-raise (bet large)
  //   [8] IP facing OOP bet LARGE   [9] OOP facing IP probe LARGE
  function extractStreetNodes(baseHistory) {
    const oop = extractNodeStrategy(baseHistory);
    if (!oop) return null;
    // Address each decision node by action selectors relative to baseHistory.
    const get = (sels) => {
      const hist = resolvePath(baseHistory, sels);
      return hist ? extractNodeStrategy(hist) : null;
    };
    const ip = get(['Check']);
    const ipFB = get(['BetSmall']);
    const oopFP = get(['Check', 'BetSmall']);
    const oopFRSmall = get(['BetSmall', 'Raise']);
    const oopFRLarge = get(['BetLarge', 'Raise']);
    const ipFRSmall = get(['Check', 'BetSmall', 'Raise']);
    const ipFRLarge = get(['Check', 'BetLarge', 'Raise']);
    const ipFBLarge = get(['BetLarge']);
    const oopFPLarge = get(['Check', 'BetLarge']);
    return {
      strategies: [
        oop.strategy,
        ip ? ip.strategy : null,
        ipFB ? ipFB.strategy : null,
        oopFP ? oopFP.strategy : null,
        oopFRSmall ? oopFRSmall.strategy : null,
        oopFRLarge ? oopFRLarge.strategy : null,
        ipFRSmall ? ipFRSmall.strategy : null,
        ipFRLarge ? ipFRLarge.strategy : null,
        ipFBLarge ? ipFBLarge.strategy : null,
        oopFPLarge ? oopFPLarge.strategy : null,
      ],
      actions: [
        oop.actions,
        ip ? ip.actions : null,
        ipFB ? ipFB.actions : null,
        oopFP ? oopFP.actions : null,
        oopFRSmall ? oopFRSmall.actions : null,
        oopFRLarge ? oopFRLarge.actions : null,
        ipFRSmall ? ipFRSmall.actions : null,
        ipFRLarge ? ipFRLarge.actions : null,
        ipFBLarge ? ipFBLarge.actions : null,
        oopFPLarge ? oopFPLarge.actions : null,
      ],
    };
  }

  // Action sequences (as semantic selectors) that lead to the next street's
  // chance node (no fold; both players close the action). Selectors are resolved
  // against each node's live actions, so lines survive tree reshaping at low SPR.
  //   first to act (no bet live): Check / BetSmall / BetLarge
  //   facing a bet/raise:         Call / Raise
  // Any line that doesn't resolve (a collapsed size, or a raise that isn't
  // offered) yields null from resolvePath and is skipped.
  const ACTION_LINES = {
    check_check:           ['Check', 'Check'],
    bet_small_call:        ['BetSmall', 'Call'],
    bet_large_call:        ['BetLarge', 'Call'],
    xbet_small_call:       ['Check', 'BetSmall', 'Call'],
    xbet_large_call:       ['Check', 'BetLarge', 'Call'],
    bet_small_raise_call:  ['BetSmall', 'Raise', 'Call'],
    bet_large_raise_call:  ['BetLarge', 'Raise', 'Call'],
    xbet_small_raise_call: ['Check', 'BetSmall', 'Raise', 'Call'],
    xbet_large_raise_call: ['Check', 'BetLarge', 'Raise', 'Call'],
  };

  // Helper: verify a history reaches a chance node and return possible card count
  function chanceAt(hist, expectedLen) {
    try { manager.apply_history(new Uint32Array(hist)); } catch (_) { return false; }
    return manager.current_player() === 'chance' && manager.num_actions() === expectedLen;
  }

  // -------------------------------------------------------------------------
  // Turn + River extraction
  // -------------------------------------------------------------------------
  let turn_nodes = null;
  let river_nodes = null;

  if (EXTRACT_TURN) {
    turn_nodes = {};
    if (EXTRACT_RIVER) river_nodes = {};
    const possible = possibleCards(config.board);
    const DBG_TURN = !!process.env.DEBUG_TURN;

    for (const [flopLineName, flopSels] of Object.entries(ACTION_LINES)) {
      const flopHist = resolvePath([], flopSels);
      if (DBG_TURN) {
        let na = -1, cp = '(unresolved)';
        if (flopHist) {
          try { manager.apply_history(new Uint32Array(flopHist)); cp = manager.current_player(); na = manager.num_actions(); } catch (_) { cp = '(throw)'; }
        }
        try {
          writeFileSync(
            join(PROJECT_ROOT, 'debug-turn.log'),
            `[dbgturn] board=${config.board.join('')} line=${flopLineName} resolved=${!!flopHist} player=${cp} numActions=${na} expected=${possible.length}\n`,
            { flag: 'a' }
          );
        } catch (_) {}
      }
      if (!flopHist) continue;
      if (!chanceAt(flopHist, possible.length)) continue;

      let turnActions = null;
      const turnCards = {};
      const riverPerTurnCard = {};

      for (let i = 0; i < possible.length; i++) {
        const turnHist = [...flopHist, i];
        const turnCardStr = indexToCard(possible[i]);

        // ── Turn strategies ──
        const turnResult = extractStreetNodes(turnHist);
        if (!turnResult) continue;
        turnCards[turnCardStr] = turnResult.strategies;
        if (!turnActions) turnActions = turnResult.actions;

        // ── River strategies (per turn action line → chance → each river card) ──
        if (EXTRACT_RIVER) {
          const possibleRiver = possibleCards([...config.board, turnCardStr]);
          const riverForCard = {};

          for (const [turnLineName, turnSels] of Object.entries(ACTION_LINES)) {
            const riverChanceHist = resolvePath(turnHist, turnSels);
            if (!riverChanceHist) continue;
            if (!chanceAt(riverChanceHist, possibleRiver.length)) continue;

            let riverActions = null;
            const riverCards = {};

            for (let j = 0; j < possibleRiver.length; j++) {
              const riverHist = [...riverChanceHist, j];
              const riverResult = extractStreetNodes(riverHist);
              if (!riverResult) continue;
              riverCards[indexToCard(possibleRiver[j])] = riverResult.strategies;
              if (!riverActions) riverActions = riverResult.actions;
            }

            if (Object.keys(riverCards).length > 0) {
              riverForCard[turnLineName] = { actions: riverActions, cards: riverCards };
            }
          }

          if (Object.keys(riverForCard).length > 0) {
            riverPerTurnCard[turnCardStr] = riverForCard;
          }
        }
      }

      if (Object.keys(turnCards).length > 0) {
        turn_nodes[flopLineName] = { actions: turnActions, cards: turnCards };
      }
      if (EXTRACT_RIVER && Object.keys(riverPerTurnCard).length > 0) {
        river_nodes[flopLineName] = riverPerTurnCard;
      }
    }

    if (Object.keys(turn_nodes).length === 0) turn_nodes = null;
    if (EXTRACT_RIVER && Object.keys(river_nodes).length === 0) river_nodes = null;
  }

  console.log(JSON.stringify({
    iterations: iteration,
    exploitability: Math.round(exploit * 1000) / 1000,
    actions: actions,
    player: player,
    numActions: numActions,
    strategy: aggregateStrategy,
    oopEquity: avgEquity[0],
    ipEquity: avgEquity[1],
    oopEV: avgEV[0],
    ipEV: avgEV[1],
    oopCombos: oopLen,
    ipCombos: ipLen,
    nodes: nodes,
    turn_nodes: turn_nodes,
    river_nodes: river_nodes,
  }));

  process.exit(0);

  } catch (e) {
    // Emit full error to stderr for diagnostics, and a JSON error to stdout for the parent
    console.error(JSON.stringify({
      error: 'child-crash',
      message: e.message,
      stack: e.stack ? e.stack.split('\n').slice(0, 15).join('\n') : '',
    }));
    console.log(JSON.stringify({
      error: `child crash: ${e.message}`,
    }));
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Parent process: orchestrate child processes for each spot
// ---------------------------------------------------------------------------

// Dispatch a spot to the configured engine. Native by default when built
// (no 4 GiB cap, uses host RAM); WASM otherwise. WASM stays as a full backup.
function runSolve(matchupKey, matchup, flopDef) {
  const wantNative = ENGINE === 'native' || (ENGINE === 'auto' && NATIVE_AVAILABLE);
  if (wantNative) {
    if (!NATIVE_AVAILABLE) {
      return Promise.resolve({
        error: 'native-binary-missing',
        message: `Native engine requested but binary not found at ${NATIVE_BIN}. `
          + `Build it: cargo build --release --manifest-path solver-native/Cargo.toml`,
      });
    }
    return solveInNativeProcess(matchup, flopDef);
  }
  return solveInChildProcess(matchupKey, matchup, flopDef);
}

// Solve a spot with the native binary. Sends the full config as JSON on stdin
// and parses the single JSON result line from stdout (same shape as the WASM
// child produces), so downstream handling is identical.
function solveInNativeProcess(matchup, flopDef) {
  return new Promise((resolve) => {
    const nativeConfig = {
      oopRange: matchup.oop,
      ipRange: matchup.ip,
      board: flopDef.board,
      pot: STARTING_POT,
      stack: EFFECTIVE_STACK,
      donkOption: DEPTH_CFG.donkOption || false,
      betSizes: BET_SIZES,
      iterations: MAX_ITERATIONS,
      target: TARGET_EXPLOIT_PCT,
      extractTurn: EXTRACT_TURN,
      extractRiver: EXTRACT_RIVER,
    };

    const child = spawn(NATIVE_BIN, [], { stdio: ['pipe', 'pipe', 'pipe'] });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    const timeoutMs = parseInt(process.env.SOLVE_TIMEOUT) || 3600000; // 1 hour per spot
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      resolve({ error: `timeout (${Math.round(timeoutMs / 60000)} min)` });
    }, timeoutMs);

    child.on('error', (e) => {
      clearTimeout(timeout);
      resolve({ error: `native spawn error: ${e.message}` });
    });

    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        const lastErr = stderr.trim().split('\n').slice(-10).join(' | ');
        resolve({ error: `native exit code ${code}: ${lastErr}` });
        return;
      }
      try {
        const lines = stdout.trim().split('\n');
        const jsonLine = lines.filter(l => l.startsWith('{')).pop();
        if (!jsonLine) {
          resolve({ error: `no JSON output. stdout: ${stdout.slice(0, 200)}` });
          return;
        }
        resolve(JSON.parse(jsonLine));
      } catch (e) {
        resolve({ error: `parse error: ${e.message}. stdout: ${stdout.slice(0, 200)}` });
      }
    });

    child.stdin.write(JSON.stringify(nativeConfig));
    child.stdin.end();
  });
}

function solveInChildProcess(matchupKey, matchup, flopDef) {
  return new Promise((resolve) => {
    const config = {
      oopRange: matchup.oop,
      ipRange: matchup.ip,
      board: flopDef.board,
    };

    const configStr = JSON.stringify(config);
    const childArgs = [
      '--child', configStr,
      '--iterations', String(MAX_ITERATIONS),
      '--target', String(TARGET_EXPLOIT_PCT),
      '--depth', DEPTH,
    ];
    if (!EXTRACT_TURN) childArgs.push('--no-turn');
    if (!EXTRACT_RIVER) childArgs.push('--no-river');

    const child = fork(__filename, childArgs, {
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      execArgv: ['--max-old-space-size=4096'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => { stdout += data.toString(); });
    child.stderr.on('data', (data) => { stderr += data.toString(); });

    const timeoutMs = parseInt(process.env.SOLVE_TIMEOUT) || 3600000; // 1 hour per spot
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      resolve({ error: `timeout (${Math.round(timeoutMs/60000)} min)` });
    }, timeoutMs);

    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        const lastErr = stderr.trim().split('\n').slice(-10).join(' | ');
        const rawStderr = stderr.trim().slice(0, 500);
        resolve({ error: `exit code ${code}: ${lastErr}`, _stderr: rawStderr });
        return;
      }
      try {
        // Find the last line that looks like JSON
        const lines = stdout.trim().split('\n');
        const jsonLine = lines.filter(l => l.startsWith('{')).pop();
        if (!jsonLine) {
          resolve({ error: `no JSON output. stdout: ${stdout.slice(0, 200)}` });
          return;
        }
        const result = JSON.parse(jsonLine);
        resolve(result);
      } catch (e) {
        resolve({ error: `parse error: ${e.message}. stdout: ${stdout.slice(0, 200)}` });
      }
    });
  });
}

async function main() {
  // Load existing solutions (incremental build)
  const suffix = FILE_SUFFIX;
  const outputPath = join(PROJECT_ROOT, 'js', 'data', `postflop-solutions${suffix}.js`);
  let existingSolutions = {};
  if (existsSync(outputPath)) {
    try {
      const content = readFileSync(outputPath, 'utf-8');
      const match = content.match(/GTO\.Data\.PostflopSolutions[A-Za-z0-9_]*\s*=\s*(\{[\s\S]*\});/);
      if (match) existingSolutions = JSON.parse(match[1]);
    } catch (e) {
      // Fresh start
    }
  }

  // Turn solutions — separate file
  const turnOutputPath = join(PROJECT_ROOT, 'js', 'data', `postflop-solutions-turn${suffix}.js`);
  let existingTurnSolutions = {};
  if (EXTRACT_TURN && existsSync(turnOutputPath)) {
    try {
      const content = readFileSync(turnOutputPath, 'utf-8');
      const match = content.match(/GTO\.Data\.PostflopSolutionsTurn[A-Za-z0-9_]*\s*=\s*(\{[\s\S]*\});/);
      if (match) existingTurnSolutions = JSON.parse(match[1]);
    } catch (e) {
      // Fresh start
    }
  }

  // River solutions — one file per (depth, matchup, board) under js/data/river/.
  // Lazy-loaded per board by the client, so the huge per-class river data never
  // needs to be resident in RAM all at once (only the current board is loaded).
  const riverRoot = join(PROJECT_ROOT, 'js', 'data', 'river', DEPTH);
  const riverBoardPath = (mk, lbl) => join(riverRoot, mk, `${lbl}.json`);
  const writeRiverBoard = (mk, lbl, entry) => {
    mkdirSync(join(riverRoot, mk), { recursive: true });
    writeFileSync(riverBoardPath(mk, lbl), JSON.stringify(entry), 'utf-8');
  };

  const solutions = { ...existingSolutions };
  const turnSolutions = { ...existingTurnSolutions };
  const matchupKeys = FILTER_MATCHUP
    ? [FILTER_MATCHUP]
    : Object.keys(MATCHUPS);
  const boards = FILTER_BOARD
    ? FLOP_BOARDS.filter(b => b.label === FILTER_BOARD)
    : FLOP_BOARDS;

  const totalSpots = matchupKeys.length * boards.length;
  let spotNum = 0;
  let errors = 0;
  let skipped = 0;

  console.log(`[precompute] Depth: ${DEPTH} (pot=${STARTING_POT}, stack=${EFFECTIVE_STACK}, SPR=${(EFFECTIVE_STACK/STARTING_POT).toFixed(1)})`);
  console.log(`[precompute] Solving ${totalSpots} spots (${matchupKeys.length} matchups x ${boards.length} boards)`);
  console.log(`[precompute] Max iterations: ${MAX_ITERATIONS}, Target exploitability: ${TARGET_EXPLOIT_PCT}% pot`);
  console.log(`[precompute] Bet sizes: flop ${BET_SIZES.ipFlopBet}, turn ${BET_SIZES.ipTurnBet}, river ${BET_SIZES.ipRiverBet}, raises ${BET_SIZES.ipFlopRaise}`);
  console.log(`[precompute] Output: postflop-solutions${suffix}.js`);
  if (EXTRACT_TURN) console.log(`[precompute] Turn output: postflop-solutions-turn${suffix}.js`);
  if (EXTRACT_RIVER) console.log(`[precompute] River output: js/data/river/${DEPTH}/<matchup>/<board>.json`);
  const engineLabel = (ENGINE === 'native' || (ENGINE === 'auto' && NATIVE_AVAILABLE))
    ? (NATIVE_AVAILABLE ? 'native (host RAM, no 4 GiB cap)' : 'native REQUESTED but binary missing')
    : 'wasm (in-process, 4 GiB cap)';
  console.log(`[precompute] Engine: ${engineLabel}`);
  console.log(`[precompute] Results are saved to disk after each spot`);
  console.log('');

  for (const matchupKey of matchupKeys) {
    if (!MATCHUPS[matchupKey]) {
      console.log(`[precompute] Unknown matchup: ${matchupKey}`);
      continue;
    }
    const matchup = MATCHUPS[matchupKey];
    // Derive-only matchups (cold-caller pairs) ship with empty built-in ranges;
    // the preflop bridge fills them for 3bet/4bet but leaves srp empty (the
    // defender 3bets rather than flats). Skip a matchup that has no usable range
    // for either seat instead of feeding the solver an empty range.
    if (!matchup.oop || !matchup.oop.trim() || !matchup.ip || !matchup.ip.trim()) {
      skipped += boards.length;
      console.log(`[precompute] ${matchupKey} — no ranges for case '${DEPTH}' `
        + `(derive-only; run scripts/preflop-to-postflop-ranges.mjs, or use a 3bet/4bet case). Skipping.`);
      continue;
    }
    if (!solutions[matchupKey]) solutions[matchupKey] = {};
    if (EXTRACT_TURN && !turnSolutions[matchupKey]) turnSolutions[matchupKey] = {};

    for (const flopDef of boards) {
      spotNum++;
      const key = flopDef.label;

      // Skip if already solved with nodes (incremental build). --force re-solves.
      const existing = solutions[matchupKey][key];
      const existingTurn = EXTRACT_TURN ? (turnSolutions[matchupKey] || {})[key] : null;
      const hasFlopNodes = existing && !existing.error && existing.nodes;
      const hasTurnNodes = !EXTRACT_TURN || (existingTurn && existingTurn.lines);
      const hasRiverNodes = !EXTRACT_RIVER || existsSync(riverBoardPath(matchupKey, key));
      if (!FORCE && hasFlopNodes && hasTurnNodes && hasRiverNodes && !FILTER_BOARD && !FILTER_MATCHUP) {
        skipped++;
        const turnInfo = existingTurn ? `, turn_lines=${Object.keys(existingTurn.lines || {}).length}` : '';
        console.log(`[precompute] [${spotNum}/${totalSpots}] ${matchupKey}/${key} — already solved (${Object.keys(existing.nodes).length + 1} nodes${turnInfo}), skipping`);
        continue;
      }

      const startTime = Date.now();
      console.log(`[precompute] [${spotNum}/${totalSpots}] ${matchupKey}/${key} — solving...`);

      const result = await runSolve(matchupKey, matchup, flopDef);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

      if (result.error) {
        const detail = result.message ? `: ${result.message}` : '';
        console.log(`  ERROR: ${result.error}${detail} (${elapsed}s)`);
        errors++;
        solutions[matchupKey][key] = { error: result.error };
      } else {
        const nodeCount = result.nodes ? Object.keys(result.nodes).length : 0;
        const turnLineCount = result.turn_nodes ? Object.keys(result.turn_nodes).length : 0;
        const riverLineCount = result.river_nodes ? Object.keys(result.river_nodes).length : 0;
        const turnInfo = turnLineCount > 0 ? `, turn_lines=${turnLineCount}` : '';
        const riverInfo = riverLineCount > 0 ? `, river_lines=${riverLineCount}` : '';
        console.log(`  OK: ${result.iterations} iter, exploit=${result.exploitability}, actions=${result.actions}, nodes=${nodeCount + 1}${turnInfo}${riverInfo} (${elapsed}s)`);
        const entry = {
          board: flopDef.board.join(''),
          texture: flopDef.texture,
          actions: result.actions,
          player: result.player,
          numActions: result.numActions,
          strategy: result.strategy,
          oopEquity: result.oopEquity,
          ipEquity: result.ipEquity,
          oopEV: result.oopEV,
          ipEV: result.ipEV,
          exploitability: result.exploitability,
          iterations: result.iterations,
          oopCombos: result.oopCombos,
          ipCombos: result.ipCombos,
        };
        if (result.nodes && Object.keys(result.nodes).length > 0) {
          entry.nodes = result.nodes;
        }
        solutions[matchupKey][key] = entry;

        // Store turn data separately
        if (EXTRACT_TURN && result.turn_nodes) {
          turnSolutions[matchupKey][key] = {
            board: flopDef.board.join(''),
            texture: flopDef.texture,
            lines: result.turn_nodes,
          };
        }
        // Store river data separately (per-board-per-matchup file)
        if (EXTRACT_RIVER && result.river_nodes) {
          writeRiverBoard(matchupKey, key, {
            board: flopDef.board.join(''),
            texture: flopDef.texture,
            lines: result.river_nodes,
          });
        }
      }

      // Save after each spot (incremental)
      writeSolutions(solutions, outputPath, totalSpots, errors, skipped);
      if (EXTRACT_TURN) {
        writeTurnSolutions(turnSolutions, turnOutputPath, totalSpots, errors, skipped);
      }
    }
  }

  console.log(`\n[precompute] Done. ${totalSpots - errors - skipped} solved, ${skipped} skipped, ${errors} errors.`);
  console.log(`[precompute] Output: ${outputPath}`);

  // Write index (per-depth)
  const indexData = {
    depth: DEPTH,
    matchups: Object.keys(MATCHUPS),
    boards: FLOP_BOARDS.map(b => ({ label: b.label, board: b.board.join(''), texture: b.texture })),
    settings: { pot: STARTING_POT, stack: EFFECTIVE_STACK, maxIterations: MAX_ITERATIONS, targetExploitability: TARGET_EXPLOIT_PCT, betSizes: BET_SIZES },
    generated: new Date().toISOString()
  };
  const indexPath = join(PROJECT_ROOT, 'js', 'data', `postflop-solution-index${suffix}.js`);
  const varSuffix = VAR_SUFFIX;
  const indexContent = `// Pre-computed Postflop Solutions — Index/Metadata (${DEPTH})\n// Auto-generated by scripts/precompute-postflop.mjs\n\nwindow.GTO = window.GTO || {};\nGTO.Data = GTO.Data || {};\n\nGTO.Data.PostflopSolutionIndex${varSuffix} = ${JSON.stringify(indexData, null, 2)};\n`;
  writeFileSync(indexPath, indexContent, 'utf-8');
  console.log(`[precompute] Index: ${indexPath}`);
}

function writeSolutions(solutions, outputPath, totalSpots, errors, skipped) {
  const varSuffix = VAR_SUFFIX;
  const header = `// ============================================================================
// Pre-computed Postflop Solutions (${DEPTH})
// ============================================================================
// Auto-generated by scripts/precompute-postflop.mjs
// Generated: ${new Date().toISOString()}
// Depth: ${DEPTH} (pot=${STARTING_POT}, stack=${EFFECTIVE_STACK}, SPR=${(EFFECTIVE_STACK/STARTING_POT).toFixed(1)})
// Spots: ${totalSpots - errors - skipped} solved
// Settings: ${MAX_ITERATIONS} max iterations, ${TARGET_EXPLOIT_PCT}% target exploitability
// Bet sizes: flop ${BET_SIZES.ipFlopBet}, turn ${BET_SIZES.ipTurnBet}, river ${BET_SIZES.ipRiverBet}
// ============================================================================

window.GTO = window.GTO || {};
GTO.Data = GTO.Data || {};

GTO.Data.PostflopSolutions${varSuffix} = `;

  const json = JSON.stringify(solutions, null, 2);
  writeFileSync(outputPath, header + json + ';\n', 'utf-8');
}

function writeTurnSolutions(turnSolutions, outputPath, totalSpots, errors, skipped) {
  const varSuffix = VAR_SUFFIX;
  const header = `// ============================================================================
// Pre-computed Turn Solutions (${DEPTH})
// ============================================================================
// Auto-generated by scripts/precompute-postflop.mjs --turn
// Generated: ${new Date().toISOString()}
// Depth: ${DEPTH} (pot=${STARTING_POT}, stack=${EFFECTIVE_STACK})
// Spots: ${totalSpots - errors - skipped} solved
//
// Structure: { matchup → board → lines → { actions, cards } }
// Flop lines (each reaches the turn): check_check, bet_small/large_call,
//   xbet_small/large_call, and their *_raise_call variants (bet→raise→call).
// Per card: { s: [10 decision strategies], bc: [10 per-class maps] }
//   s  — range-averaged strategy per decision:
//   bc — per-hand-class strategy map (class → freqs) for the same decision
//   [0] OOP first to act on turn
//   [1] IP after OOP check
//   [2] IP facing OOP bet SMALL (Fold/Call/Raise)
//   [3] OOP facing IP probe SMALL (check → IP bet → OOP decides)
//   [4] OOP facing raise after betting small   ([1,2])
//   [5] OOP facing raise after betting large   ([2,2])
//   [6] IP facing check-raise after betting small ([0,1,2])
//   [7] IP facing check-raise after betting large ([0,2,2])
//   [8] IP facing OOP bet LARGE   ([2])
//   [9] OOP facing IP probe LARGE ([0,2])
// ============================================================================

window.GTO = window.GTO || {};
GTO.Data = GTO.Data || {};

GTO.Data.PostflopSolutionsTurn${varSuffix} = `;

  const json = JSON.stringify(turnSolutions, null, 2);
  writeFileSync(outputPath, header + json + ';\n', 'utf-8');
}

main().catch(err => {
  console.error('[precompute] Fatal error:', err);
  process.exit(1);
});
