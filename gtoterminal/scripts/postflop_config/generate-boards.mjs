#!/usr/bin/env node
// ============================================================================
// Generate ~500 representative flop boards for postflop_config/flop-boards.mjs
// ============================================================================
// Strategy:
//   - Unpaired boards: sample every top-card rank (A→4) at varying connectivity
//     levels. Each meaningful rank combo gets both rainbow (r) and two-tone (tt).
//   - Monotone boards: sparser sample since flush texture dominates strategy.
//   - Paired boards: each pair rank with kickers at near/medium/far gaps.
//   - Trips boards: all 13 ranks.
//
// Connectivity for unpaired is captured via (gap1, gap2) where:
//   gap1 = topRank - midRank, gap2 = midRank - lowRank
//
// Label format:
//   Unpaired: {top}{mid}{low}{suit}     e.g. AKQr, A72tt
//   Paired:   {pair}{pair}{kicker}{suit}  e.g. AA8r, KK4r
//   Trips:    {trip}{trip}{trip}{suit}    e.g. AAAsss
//   Monotone: {top}{mid}{low}sss           e.g. AT6sss
// ============================================================================

const RANK_VAL = { '2':2, '3':3, '4':4, '5':5, '6':6, '7':7, '8':8, '9':9, 'T':10, 'J':11, 'Q':12, 'K':13, 'A':14 };

function cardStr(rank, suit) { return rank + suit; }

function makeBoard(ranks, suitPattern) {
  if (suitPattern === 'r')   return [cardStr(ranks[0], 'c'), cardStr(ranks[1], 'd'), cardStr(ranks[2], 'h')];
  if (suitPattern === 'tt')  return [cardStr(ranks[0], 'h'), cardStr(ranks[1], 'h'), cardStr(ranks[2], 'c')];
  if (suitPattern === 'sss') return [cardStr(ranks[0], 's'), cardStr(ranks[1], 's'), cardStr(ranks[2], 's')];
  throw new Error('bad suit: ' + suitPattern);
}

function label(ranks, suitPattern) {
  if (suitPattern === 'sss') return ranks.join('') + 'sss';
  return ranks.join('') + suitPattern;
}

// =========================================================================
// UNPAIRED (~178 combos × 2 = 356 boards)
// =========================================================================
function unpairedPlan() { return {
  'A':[
    ['K',['Q','J','T','9','7','2']],
    ['Q',['J','T','9','5','2']],
    ['J',['T','9','8','4','2']],
    ['T',['9','8','7','3','2']],
    ['9',['8','7','2']],
    ['8',['7','4','2']],
    ['7',['6','3','2']],
    ['6',['5','2']],
    ['5',['4','2']],
    ['4',['3','2']],
    ['3',['2']],
  ],
  'K':[
    ['Q',['J','T','9','6','2']],
    ['J',['T','9','8','4','2']],
    ['T',['9','8','7','3','2']],
    ['9',['8','5','2']],
    ['8',['7','4','2']],
    ['7',['6','3','2']],
    ['6',['5','2']],
    ['5',['4','2']],
    ['4',['3','2']],
    ['3',['2']],
  ],
  'Q':[
    ['J',['T','9','8','5','2']],
    ['T',['9','8','7','4','2']],
    ['9',['8','7','3','2']],
    ['8',['7','5','2']],
    ['7',['6','3','2']],
    ['6',['5','2']],
    ['5',['4','2']],
    ['4',['3','2']],
    ['3',['2']],
  ],
  'J':[
    ['T',['9','8','7','4','2']],
    ['9',['8','7','5','2']],
    ['8',['7','6','3','2']],
    ['7',['6','4','2']],
    ['6',['5','2']],
    ['5',['4','2']],
    ['4',['3','2']],
    ['3',['2']],
  ],
  'T':[
    ['9',['8','7','6','3','2']],
    ['8',['7','6','4','2']],
    ['7',['6','5','2']],
    ['6',['5','3','2']],
    ['5',['4','2']],
    ['4',['3','2']],
    ['3',['2']],
  ],
  '9':[
    ['8',['7','6','5','2']],
    ['7',['6','5','3','2']],
    ['6',['5','4','2']],
    ['5',['4','2']],
    ['4',['3','2']],
    ['3',['2']],
  ],
  '8':[
    ['7',['6','5','3','2']],
    ['6',['5','4','2']],
    ['5',['4','3','2']],
    ['4',['3','2']],
    ['3',['2']],
  ],
  '7':[
    ['6',['5','4','2']],
    ['5',['4','3','2']],
    ['4',['3','2']],
    ['3',['2']],
  ],
  '6':[
    ['5',['4','3','2']],
    ['4',['3','2']],
    ['3',['2']],
  ],
  '5':[
    ['4',['3','2']],
    ['3',['2']],
  ],
  '4':[
    ['3',['2']],
  ],
};}

// =========================================================================
// MONOTONE (~22 boards) — flush dominates, sparse connectivity
// =========================================================================
function monotonePlan() { return {
  'A':[['K','Q'],['J','8'],['5','2']],
  'K':[['Q','T'],['8','3']],
  'Q':[['J','9'],['6','3']],
  'J':[['T','8'],['5','2']],
  'T':[['9','7'],['4','2']],
  '9':[['8','5'],['3','2']],
  '8':[['7','4']],
  '7':[['6','3']],
  '6':[['5','2']],
  '5':[['4','2']],
  '4':[['3','2']],
};}

// =========================================================================
// PAIRED (~80 boards) — no suit split (pair dominates)
// =========================================================================
function pairedPlan() { return {
  'A':['K','Q','J','T','9','7','4','2'],
  'K':['Q','J','T','9','7','5','2'],
  'Q':['J','T','9','8','5','3','2'],
  'J':['T','9','8','6','4','2'],
  'T':['9','8','7','5','3','2'],
  '9':['8','7','5','3','2'],
  '8':['7','6','4','2'],
  '7':['6','5','4','2'],
  '6':['5','4','3','2'],
  '5':['4','3','2'],
  '4':['3','2'],
  '3':['2','5'],
  '2':['3','6'],
};}

// =========================================================================
// TRIPS (13 boards) — all ranks
// =========================================================================
const TRIPS_RANKS = ['2','3','4','5','6','7','8','9','T','J','Q','K','A'];

// =========================================================================
// GENERATE
// =========================================================================
function generate() {
  const boards = [];

  // --- Unpaired ---
  for (const [top, secondList] of Object.entries(unpairedPlan())) {
    for (const [mid, thirdList] of secondList) {
      for (const low of thirdList) {
        const ranks = [top, mid, low];
        const g1 = RANK_VAL[top] - RANK_VAL[mid];
        const g2 = RANK_VAL[mid] - RANK_VAL[low];
        const base = { topRank: RANK_VAL[top], connSpan: g1+g2, connMaxGap: Math.max(g1,g2), isPaired: false };
        boards.push({ ...base, board: makeBoard(ranks,'r'),  label: label(ranks,'r'),  suitPattern: 'r' });
        boards.push({ ...base, board: makeBoard(ranks,'tt'), label: label(ranks,'tt'), suitPattern: 'tt' });
      }
    }
  }
  const nUR  = boards.filter(b => b.suitPattern==='r'  && !b.isPaired).length;
  const nUTT = boards.filter(b => b.suitPattern==='tt' && !b.isPaired).length;

  // --- Monotone ---
  let nMono = 0;
  for (const [top, pairs] of Object.entries(monotonePlan())) {
    for (const [mid, low] of pairs) {
      const ranks = [top, mid, low];
      const g1 = RANK_VAL[top] - RANK_VAL[mid];
      const g2 = RANK_VAL[mid] - RANK_VAL[low];
      boards.push({ board: makeBoard(ranks,'sss'), label: label(ranks,'sss'),
        topRank: RANK_VAL[top], connSpan: g1+g2, connMaxGap: Math.max(g1,g2),
        suitPattern: 'sss', isPaired: false });
      nMono++;
    }
  }

  // --- Paired ---
  let nPaired = 0;
  for (const [pr, kickers] of Object.entries(pairedPlan())) {
    for (const k of kickers) {
      const pv = RANK_VAL[pr], kv = RANK_VAL[k];
      boards.push({ board: [cardStr(pr,'s'), cardStr(pr,'h'), cardStr(k,'d')],
        label: pr+pr+k+'r', topRank: pv, connSpan: Math.abs(pv-kv), connMaxGap: Math.abs(pv-kv),
        suitPattern: 'r', isPaired: true, pairRank: pv });
      nPaired++;
    }
  }

  // --- Trips ---
  let nTrips = 0;
  for (const r of TRIPS_RANKS) {
    const rv = RANK_VAL[r];
    boards.push({ board: [cardStr(r,'s'), cardStr(r,'h'), cardStr(r,'d')],
      label: r+r+r+'sss', topRank: rv, connSpan: 0, connMaxGap: 0,
      suitPattern: 'sss', isPaired: true, pairRank: rv, isTrips: true });
    nTrips++;
  }

  console.error(`Unpaired rainbow:  ${nUR}`);
  console.error(`Unpaired two-tone: ${nUTT}`);
  console.error(`Monotone:          ${nMono}`);
  console.error(`Paired:            ${nPaired}`);
  console.error(`Trips:             ${nTrips}`);
  console.error(`TOTAL:             ${boards.length}`);

  return boards;
}

function formatBoards(boards) {
  const lines = [];
  lines.push('// ============================================================================');
  lines.push('// Postflop flop-board definitions — ~500 representative boards');
  lines.push('// ============================================================================');
  lines.push('// Generated by scripts/postflop_config/generate-boards.mjs');
  lines.push('//');
  lines.push('// Three-axis matching replaces the old 8-texture hard classification:');
  lines.push('//   1. Height (topCard rank or pair rank)');
  lines.push('//   2. Suit pattern (r=rainbow, tt=two-tone, sss=monotone)');
  lines.push('//   3. Connectivity (connSpan + connMaxGap)');
  lines.push('//');
  lines.push('// Lookup: find nearest board by weighted 3D distance.');
  lines.push('//');
  lines.push('// Each entry:');
  lines.push('//   board:      3-card flop as 2-char strings ["As","7d","2h"]');
  lines.push('//   label:      unique board id used in output filenames / variable keys');
  lines.push('//   topRank:    anchor rank (0=2 .. 12=A)');
  lines.push('//   connSpan:   total rank span (top - bottom), 0..12');
  lines.push('//   connMaxGap: largest gap between consecutive sorted ranks');
  lines.push('//   suitPattern:"r"|"tt"|"sss"');
  lines.push('//   isPaired:   boolean');
  lines.push('//   pairRank:   if paired, the pair rank (0=2 .. 12=A)');
  lines.push('//   isTrips:    boolean (optional, only for trips)');
  lines.push('// ============================================================================');
  lines.push('');
  lines.push('export const FLOP_BOARDS = [');

  // Group by category for readability
  const categories = [
    { name: 'UNPAIRED RAINBOW', filter: b => !b.isPaired && b.suitPattern === 'r' },
    { name: 'UNPAIRED TWO-TONE', filter: b => !b.isPaired && b.suitPattern === 'tt' },
    { name: 'MONOTONE', filter: b => !b.isPaired && b.suitPattern === 'sss' },
    { name: 'PAIRED', filter: b => b.isPaired && !b.isTrips },
    { name: 'TRIPS', filter: b => b.isTrips },
  ];

  for (const cat of categories) {
    const items = boards.filter(cat.filter);
    if (items.length === 0) continue;
    lines.push('');
    lines.push(`  // ---- ${cat.name} (${items.length} boards) ----`);
    lines.push('');

    // Sub-group by topRank for readability
    const byTop = {};
    for (const b of items) {
      const t = b.topRank;
      if (!byTop[t]) byTop[t] = [];
      byTop[t].push(b);
    }
    const sortedTops = Object.keys(byTop).map(Number).sort((a,b) => b - a);
    const RANK_NAMES = { 14:'A', 13:'K', 12:'Q', 11:'J', 10:'T', 9:'9', 8:'8', 7:'7', 6:'6', 5:'5', 4:'4', 3:'3', 2:'2' };

    for (const top of sortedTops) {
      const group = byTop[top];
      // Sort within group: by connSpan then connMaxGap
      group.sort((a, b) => a.connSpan - b.connSpan || a.connMaxGap - b.connMaxGap);

      for (const b of group) {
        const boardStr = JSON.stringify(b.board);
        const fields = [
          `board: ${boardStr}`,
          `label: '${b.label}'`,
          `topRank: ${b.topRank}`,
          `connSpan: ${b.connSpan}`,
          `connMaxGap: ${b.connMaxGap}`,
          `suitPattern: '${b.suitPattern}'`,
          `isPaired: ${b.isPaired}`,
        ];
        if (b.pairRank !== undefined) fields.push(`pairRank: ${b.pairRank}`);
        if (b.isTrips) fields.push(`isTrips: true`);
        lines.push(`  { ${fields.join(', ')} },`);
      }
    }
  }

  lines.push('');
  lines.push('];');
  return lines.join('\n');
}

// Run
const boards = generate();
console.log(formatBoards(boards));
