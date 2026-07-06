#!/usr/bin/env node
// Helper: calculate range size for a position data object
// Used to calibrate how much to widen

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

global.window = { GTO: { Data: {}, Engine: {}, UI: {}, Utils: {} } };
global.GTO = window.GTO;

const rangesCode = readFileSync(join(__dirname, '..', 'js/data/preflop-ranges.js'), 'utf-8');
new Function(rangesCode)();

const ranges = GTO.Data.PreflopRanges;
const RANKS = '23456789TJQKA';
const ALL_HANDS_169 = [];
const HAND_COMBOS = {};

for (let i = 12; i >= 0; i--) {
  for (let j = i; j >= 0; j--) {
    if (i === j) {
      ALL_HANDS_169.push(RANKS[i] + RANKS[j]);
      HAND_COMBOS[RANKS[i] + RANKS[j]] = 6;
    } else {
      ALL_HANDS_169.push(RANKS[i] + RANKS[j] + 's');
      HAND_COMBOS[RANKS[i] + RANKS[j] + 's'] = 4;
      ALL_HANDS_169.push(RANKS[i] + RANKS[j] + 'o');
      HAND_COMBOS[RANKS[i] + RANKS[j] + 'o'] = 12;
    }
  }
}

function rangeSize(posData, action = 'raise') {
  let w = 0;
  for (const hand of ALL_HANDS_169) {
    let freq = 0;
    if (posData.pure_raise?.includes(hand)) freq = action === 'raise' ? 1 : 0;
    else if (posData.pure_call?.includes(hand)) freq = action === 'call' ? 1 : 0;
    else if (posData.mixed?.[hand]) {
      const m = posData.mixed[hand];
      freq = action === 'raise' ? m[2] : action === 'call' ? m[1] : m[0];
    }
    w += HAND_COMBOS[hand] * freq;
  }
  return (w / 1326) * 100;
}

function totalDefend(posData) {
  let w = 0;
  for (const hand of ALL_HANDS_169) {
    let freq = 0;
    if (posData.pure_raise?.includes(hand)) freq = 1;
    else if (posData.pure_call?.includes(hand)) freq = 1;
    else if (posData.mixed?.[hand]) {
      const m = posData.mixed[hand];
      freq = m[1] + m[2]; // call + raise
    }
    w += HAND_COMBOS[hand] * freq;
  }
  return (w / 1326) * 100;
}

// Print current state for all formats
console.log('=== CURRENT RANGE SIZES ===\n');
for (const fmt of ['cash', 'mtt']) {
  for (const depth of Object.keys(ranges[fmt]).sort((a,b) => parseInt(b)-parseInt(a))) {
    const rfi = ranges[fmt][depth].rfi;
    if (rfi) {
      for (const pos of ['UTG','MP','CO','BTN','SB']) {
        if (rfi[pos]) console.log(`${fmt}_${depth} RFI ${pos}: ${rangeSize(rfi[pos]).toFixed(1)}%`);
      }
    }
    const vr = ranges[fmt][depth].vs_raise;
    if (vr) {
      for (const key of Object.keys(vr)) {
        console.log(`${fmt}_${depth} vs_raise ${key}: defend=${totalDefend(vr[key]).toFixed(1)}%`);
      }
    }
    console.log();
  }
}
