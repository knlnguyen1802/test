#!/usr/bin/env node
// ============================================================================
// Preflop -> Postflop range bridge
// ============================================================================
// Reads the solved preflop ranges (js/data/preflop-solutions.js) and derives
// the OOP/IP input ranges used by the postflop precompute solver, so both
// solvers operate on a consistent hand space.
//
// A postflop spot begins exactly when the preflop betting stops (someone
// CALLS). The three 100bb postflop cases each come from a different preflop
// line, so each maps to a different pair of preflop ranges:
//
//   srp  (single-raised pot): opener raises, defender flat-CALLS
//     OOP = opener RFI open range           rfi[opener]        (raise)
//     IP  = defender flat-call range         vs_raise[key]      (call)
//           Fallback (solver 3bets instead of flatting -> empty):
//           strongest CALL_FRAC of the defender's non-fold range.
//
//   3bet (3bet pot): defender 3bets, opener CALLS the 3bet
//     OOP = opener call-vs-3bet range        vs_3bet[key]       (call)
//           Fallback: strongest CALL_FRAC of the opener's OPEN range.
//     IP  = defender 3bet range              vs_raise[key]      (raise)
//
//   4bet (4bet pot): opener 4bets, 3bettor CALLS the 4bet
//     OOP = opener 4bet range                vs_3bet[key]       (raise)
//           Fallback: strongest FOURBET_FRAC of the opener's OPEN range.
//     IP  = 3bettor call-vs-4bet range       vs_4bet[key]       (call)
//           Fallback: strongest CALL_FRAC of the 3bettor's 3bet range.
//
// where key = `{opener}_{defender}` (e.g. SB_BB, BTN_BB, CO_BB, UTG_BB, BTN_SB).
//
// A "call" line is often empty at these depths because the GTO solver prefers
// to raise or fold rather than flat. When a seat derives fewer than MIN_KEEP
// hands, the fallback above fills it (real players do flat), unioned with any
// real hands so nothing is lost. If a seat is STILL short (e.g. the solver never
// produced that 4bet spot at all), it copies the range from the CLOSEST matchup
// by position; only if no donor exists does the postflop built-in default apply.
//
// Output: js/data/postflop-input-ranges.json  { cases: { srp, 3bet, 4bet } }
// The postflop precompute script auto-loads the section matching its --depth
// case (srp/3bet/4bet), falling back to built-in ranges for any empty side.
//
// Usage:
//   node scripts/preflop-to-postflop-ranges.mjs
//   node scripts/preflop-to-postflop-ranges.mjs --format cash --depth 100bb
//   node scripts/preflop-to-postflop-ranges.mjs --case 3bet     # one case only
//   node scripts/preflop-to-postflop-ranges.mjs --threshold 0.5 # mixed cutoff
// ============================================================================

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

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
const FORMAT = getArg('format', 'cash');
const DEPTH = getArg('depth', '100bb');           // preflop source depth
const ONLY_CASE = getArg('case', null);           // build a single case, or all
const THRESHOLD = parseFloat(getArg('threshold', '0.5')); // min freq to include a mixed hand
const CALL_FRAC = parseFloat(getArg('call-frac', '0.35'));    // fallback: strongest fraction that flat-calls
const FOURBET_FRAC = parseFloat(getArg('fourbet-frac', '0.12')); // fallback: strongest fraction that 4bets
const MIN_KEEP = parseInt(getArg('min-keep', '5'), 10);      // below this many hands, apply the fallback proxy
const OUT_PATH = join(PROJECT_ROOT, 'js', 'data', getArg('out', 'postflop-input-ranges.json'));


// ---------------------------------------------------------------------------
// Postflop matchup -> preflop actors
//   opener   = position that opened preflop (OOP postflop)
//   defender = position that responded    (IP  postflop)
//   key      = `{opener}_{defender}` — the lookup key in vs_raise/vs_3bet/vs_4bet
// ---------------------------------------------------------------------------
const MATCHUPS = {
  SB_vs_BB:  { opener: 'SB',  defender: 'BB', key: 'SB_BB'  },
  BTN_vs_BB: { opener: 'BTN', defender: 'BB', key: 'BTN_BB' },
  CO_vs_BB:  { opener: 'CO',  defender: 'BB', key: 'CO_BB'  },
  UTG_vs_BB: { opener: 'UTG', defender: 'BB', key: 'UTG_BB' },
  BTN_vs_SB: { opener: 'BTN', defender: 'SB', key: 'BTN_SB' },
  // Cold-caller pairs (opener vs a non-blind caller). These essentially only
  // occur in 3bet/4bet pots — in a single-raised pot the defender 3bets rather
  // than flat-calls, so the srp derived range is empty and the postflop script
  // skips it. All keys exist in the preflop vs_raise/vs_3bet/vs_4bet output.
  UTG_vs_MP:  { opener: 'UTG', defender: 'MP',  key: 'UTG_MP'  },
  UTG_vs_CO:  { opener: 'UTG', defender: 'CO',  key: 'UTG_CO'  },
  UTG_vs_BTN: { opener: 'UTG', defender: 'BTN', key: 'UTG_BTN' },
  UTG_vs_SB:  { opener: 'UTG', defender: 'SB',  key: 'UTG_SB'  },
  MP_vs_CO:   { opener: 'MP',  defender: 'CO',  key: 'MP_CO'   },
  MP_vs_BTN:  { opener: 'MP',  defender: 'BTN', key: 'MP_BTN'  },
  MP_vs_SB:   { opener: 'MP',  defender: 'SB',  key: 'MP_SB'   },
  MP_vs_BB:   { opener: 'MP',  defender: 'BB',  key: 'MP_BB'   },
  CO_vs_BTN:  { opener: 'CO',  defender: 'BTN', key: 'CO_BTN'  },
  CO_vs_SB:   { opener: 'CO',  defender: 'SB',  key: 'CO_SB'   },
};

// ---------------------------------------------------------------------------
// Postflop case -> which preflop range fills each seat.
//   { ctx, key, mode }  — ctx: preflop context; key: 'open'|matchup key;
//                         mode: how to derive the hand set (deriveSet mode)
// deriveSet modes: 'open'/'raise' -> raise portion, 'call' -> flat-call portion.
// ---------------------------------------------------------------------------
const PCT = (f) => Math.round(f * 100);
const CASES = {
  // Single-raised pot: opener opens, defender flat-calls.
  srp: {
    oop: (m) => ({ ctx: 'rfi',      key: m.opener, mode: 'open', label: `${m.opener} open` }),
    ip:  (m) => ({ ctx: 'vs_raise', key: m.key,    mode: 'call', label: `${m.defender} flat-call`,
                   fallback: { ctx: 'vs_raise', key: m.key, mode: 'continue', frac: CALL_FRAC,
                               label: `${m.defender} flat-call (top ${PCT(CALL_FRAC)}% of defend)` } }),
  },
  // 3bet pot: defender 3bets, opener calls the 3bet.
  // The solver rarely flat-calls a 3bet OOP, so the call line is usually empty;
  // the fallback approximates it as the strongest CALL_FRAC of the opener's open.
  '3bet': {
    oop: (m) => ({ ctx: 'vs_3bet',  key: m.key,    mode: 'call', label: `${m.opener} call-vs-3bet`,
                   fallback: { ctx: 'rfi', key: m.opener, mode: 'open', frac: CALL_FRAC,
                               label: `${m.opener} call-vs-3bet (top ${PCT(CALL_FRAC)}% of open)` } }),
    ip:  (m) => ({ ctx: 'vs_raise', key: m.key,    mode: 'open', label: `${m.defender} 3bet` }),
  },
  // 4bet pot: opener 4bets, 3bettor calls the 4bet.
  // The 3bettor rarely flat-calls a 4bet (it jams or folds), so the IP call line
  // is usually empty; the fallback uses the strongest CALL_FRAC of its 3bet range.
  '4bet': {
    oop: (m) => ({ ctx: 'vs_3bet',  key: m.key,    mode: 'open', label: `${m.opener} 4bet`,
                   fallback: { ctx: 'rfi', key: m.opener, mode: 'open', frac: FOURBET_FRAC,
                               label: `${m.opener} 4bet (top ${PCT(FOURBET_FRAC)}% of open)` } }),
    ip:  (m) => ({ ctx: 'vs_4bet',  key: m.key,    mode: 'call', label: `${m.defender} call-vs-4bet`,
                   fallback: { ctx: 'vs_raise', key: m.key, mode: 'open', frac: CALL_FRAC,
                               label: `${m.defender} call-vs-4bet (top ${PCT(CALL_FRAC)}% of 3bet)` } }),
  },
};


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
// Load preflop solutions (browser file assigns window.GTO — extract the JSON)
// ---------------------------------------------------------------------------
function loadPreflopSolutions() {
  const path = join(PROJECT_ROOT, 'js', 'data', 'preflop-solutions.js');
  if (!existsSync(path)) {
    throw new Error(`Preflop solutions not found: ${path}\nRun the preflop precompute first.`);
  }
  const content = readFileSync(path, 'utf-8');
  const match = content.match(/GTO\.Data\.PreflopSolutions\s*=\s*(\{[\s\S]*\});/);
  if (!match) throw new Error('Could not parse GTO.Data.PreflopSolutions from file.');
  return JSON.parse(match[1]);
}

// ---------------------------------------------------------------------------
// Derive a hand set from a preflop entry { pure_raise, pure_call, mixed }
//   mode 'open'     -> hands that raise (open range)
//   mode 'continue' -> hands that don't fold (call or 3bet)
//   mode 'call'     -> hands that flat-call only
// mixed[h] = [fold, call, raise]
// ---------------------------------------------------------------------------
function deriveSet(entry, mode) {
  const set = new Set();
  if (!entry) return set;
  const pr = entry.pure_raise || [];
  const pc = entry.pure_call || [];
  const mixed = entry.mixed || {};

  if (mode === 'open') {
    pr.forEach(h => set.add(h));
    for (const [h, f] of Object.entries(mixed)) {
      if ((f[2] || 0) >= THRESHOLD) set.add(h); // raise freq
    }
  } else if (mode === 'continue') {
    pr.forEach(h => set.add(h));
    pc.forEach(h => set.add(h));
    for (const [h, f] of Object.entries(mixed)) {
      const nonFold = 1 - (f[0] || 0);
      if (nonFold >= THRESHOLD) set.add(h);
    }
  } else if (mode === 'call') {
    pc.forEach(h => set.add(h));
    for (const [h, f] of Object.entries(mixed)) {
      if ((f[1] || 0) >= THRESHOLD) set.add(h); // call freq
    }
  }
  return set;
}

// ---------------------------------------------------------------------------
// Preflop hand strength (Chen formula) + combo counting.
// Used to keep only the strongest fraction of an open range as a proxy call
// range (see the 3bet case). Chen is a transparent, standard heuristic; exact
// equity ordering is not needed for a rough continuing-range approximation.
// ---------------------------------------------------------------------------
const RANK_VAL = { A: 14, K: 13, Q: 12, J: 11, T: 10, '9': 9, '8': 8, '7': 7, '6': 6, '5': 5, '4': 4, '3': 3, '2': 2 };

function comboCount(hand) {
  if (hand.length === 2) return 6;              // pair
  return hand.endsWith('s') ? 4 : 12;           // suited / offsuit
}

function chenScore(hand) {
  const v1 = RANK_VAL[hand[0]], v2 = RANK_VAL[hand[1]];
  const hi = Math.max(v1, v2), lo = Math.min(v1, v2);
  const base = (v) => (v === 14 ? 10 : v === 13 ? 8 : v === 12 ? 7 : v === 11 ? 6 : v / 2);
  if (hand.length === 2) return Math.max(base(hi) * 2, 5); // pair
  let score = base(hi);
  if (hand.endsWith('s')) score += 2;                      // suited bonus
  const gap = hi - lo - 1;
  if (gap === 1) score -= 1;
  else if (gap === 2) score -= 2;
  else if (gap === 3) score -= 4;
  else if (gap >= 4) score -= 5;
  if (gap <= 1 && hi < 12) score += 1;                     // straight bonus
  return Math.ceil(score);
}

// Keep the strongest `frac` (by combos) of a hand set, ranked by Chen score.
function topByStrength(set, frac) {
  const hands = [...set].sort((a, b) => {
    const d = chenScore(b) - chenScore(a);
    if (d) return d;
    if (RANK_VAL[b[0]] !== RANK_VAL[a[0]]) return RANK_VAL[b[0]] - RANK_VAL[a[0]];
    if (RANK_VAL[b[1]] !== RANK_VAL[a[1]]) return RANK_VAL[b[1]] - RANK_VAL[a[1]];
    return (b.endsWith('s') ? 1 : 0) - (a.endsWith('s') ? 1 : 0);
  });
  const target = hands.reduce((s, h) => s + comboCount(h), 0) * frac;
  const out = new Set();
  let acc = 0;
  for (const h of hands) {
    if (acc >= target) break;
    out.add(h);
    acc += comboCount(h);
  }
  return out;
}

// Resolve one seat's range: derive it from the primary preflop line, and if that
// yields fewer than MIN_KEEP hands, union in a fallback proxy (the strongest
// `frac` of a base range). A seat still short after this is filled later by
// copying the closest matchup's range (see main()).
function resolveSeat(src, depthData, warnings, tag) {
  const entry = depthData?.[src.ctx]?.[src.key];
  if (!entry) warnings.push(`${tag}: missing solved source ${src.ctx}/${src.key}`);
  const set = deriveSet(entry, src.mode);
  let label = src.label;
  if (set.size < MIN_KEEP && src.fallback) {
    const fb = src.fallback;
    const fbEntry = depthData?.[fb.ctx]?.[fb.key];
    if (fbEntry) {
      let fbSet = deriveSet(fbEntry, fb.mode);
      if (fb.frac) fbSet = topByStrength(fbSet, fb.frac);
      const before = set.size;
      fbSet.forEach(h => set.add(h));
      if (set.size > before) label = fb.label;
    }
  }
  return { set, label };
}

// Preflop seat order used to measure how "close" two matchups are, so a spot the
// solver never reached can borrow the range of the nearest similar matchup.
const SEAT_ORDER = ['UTG', 'MP', 'CO', 'BTN', 'SB', 'BB'];
const seatRank = (p) => { const i = SEAT_ORDER.indexOf(p); return i < 0 ? 99 : i; };
const matchupDistance = (a, b) =>
  Math.abs(seatRank(a.opener) - seatRank(b.opener)) +
  Math.abs(seatRank(a.defender) - seatRank(b.defender));

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main() {
  const solutions = loadPreflopSolutions();
  const depthData = solutions?.[FORMAT]?.[DEPTH];
  if (!depthData) {
    throw new Error(`No preflop data for format="${FORMAT}" depth="${DEPTH}". ` +
      `Available formats: ${Object.keys(solutions).join(', ')}`);
  }

  const caseKeys = ONLY_CASE ? [ONLY_CASE] : Object.keys(CASES);
  for (const c of caseKeys) {
    if (!CASES[c]) throw new Error(`Unknown case "${c}". Valid: ${Object.keys(CASES).join(', ')}`);
  }

  console.log(`[bridge] Source: preflop-solutions.js  ${FORMAT}/${DEPTH}`);
  console.log(`[bridge] Cases: ${caseKeys.join(', ')} (mixed threshold ${THRESHOLD})`);
  console.log('');

  const cases = {};
  const warnings = [];

  for (const caseKey of caseKeys) {
    const spec = CASES[caseKey];
    const matchups = {};
    console.log(`[bridge] === ${caseKey} ===`);

    // Phase 1 — derive each seat from preflop data (+ fraction-proxy fallback).
    const seats = {};
    for (const [postKey, m] of Object.entries(MATCHUPS)) {
      seats[postKey] = {
        m,
        oop: resolveSeat(spec.oop(m), depthData, warnings, `${caseKey}/${postKey} OOP`),
        ip:  resolveSeat(spec.ip(m),  depthData, warnings, `${caseKey}/${postKey} IP`),
      };
    }

    // Phase 2 — any seat still below MIN_KEEP copies the closest matchup's range.
    // Donors are snapshotted before copying so copies never become donors.
    for (const seat of ['oop', 'ip']) {
      const donors = Object.entries(seats)
        .filter(([, r]) => r[seat].set.size >= MIN_KEEP)
        .map(([key, r]) => ({ key, m: r.m, set: r[seat].set }));
      if (donors.length === 0) continue;
      for (const r of Object.values(seats)) {
        if (r[seat].set.size >= MIN_KEEP) continue;
        let best = null, bestDist = Infinity;
        for (const d of donors) {
          const dist = matchupDistance(r.m, d.m);
          if (dist < bestDist) { bestDist = dist; best = d; }
        }
        r[seat] = { set: new Set(best.set), label: `copied from ${best.key} (dist ${bestDist})` };
      }
    }

    // Phase 3 — emit; warn only for a seat no donor could fill.
    for (const [postKey, r] of Object.entries(seats)) {
      const { oop, ip } = r;
      if (oop.set.size < MIN_KEEP) warnings.push(`${caseKey}/${postKey} OOP: only ${oop.set.size} hands (${oop.label}) — postflop keeps built-in default`);
      if (ip.set.size < MIN_KEEP) warnings.push(`${caseKey}/${postKey} IP: only ${ip.set.size} hands (${ip.label}) — postflop keeps built-in default`);

      matchups[postKey] = {
        oop: sortHands(oop.set).join(','),
        ip: sortHands(ip.set).join(','),
      };

      console.log(`[bridge]   ${postKey.padEnd(10)} OOP=${String(oop.set.size).padStart(2)} (${oop.label}), ` +
        `IP=${String(ip.set.size).padStart(2)} (${ip.label})`);
    }

    cases[caseKey] = matchups;
    console.log('');
  }

  const output = {
    generated: new Date().toISOString(),
    source: `preflop-solutions.js ${FORMAT}/${DEPTH}`,
    mixedThreshold: THRESHOLD,
    cases,
  };

  writeFileSync(OUT_PATH, JSON.stringify(output, null, 2) + '\n', 'utf-8');

  if (warnings.length) {
    console.log('[bridge] Warnings:');
    warnings.forEach(w => console.log(`  - ${w}`));
    console.log('');
  }
  console.log(`[bridge] Wrote ${OUT_PATH}`);
  console.log(`[bridge] The postflop precompute script auto-loads cases[--depth].`);
  console.log(`[bridge] To ignore these ranges and use built-in defaults: --builtin-ranges`);
}

main();

