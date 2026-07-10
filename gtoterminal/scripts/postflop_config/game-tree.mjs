// ============================================================================
// Postflop game-tree configuration
// ============================================================================
// Bet/raise sizing trees and per-case pot/stack settings for the postflop
// precompute solver. Split out of scripts/precompute-postflop.mjs so the game
// tree can be tuned independently of the solver logic.
//
// Preflop-line cases (srp/3bet/4bet) are all 100bb effective; their SPR is
// fixed by the preflop line. Legacy stack-depth cases (100bb) are kept
// alongside for back-compat.
// ============================================================================

// Shared bet/raise tree for the three 100bb preflop-line cases. Sizings are
// identical across cases — only the effective stack (SPR) differs, which is
// what decides how many raise levels fit before players are pot-committed and
// the solver collapses the remaining line to an all-in (via the add/force
// all-in thresholds passed to manager.init()).
//   donk (OOP lead) enabled at 50% on turn & river
//   flop bet 33%/75%, turn bet 33%/75%, river bet 25%/100%
//   raise 60% on every street
export const LINE_BET_SIZES = {
  oopFlopBet: '33%,75%',           oopFlopRaise: '60%',
  oopTurnBet: '33%,75%',           oopTurnRaise: '60%', oopTurnDonk: '50%',
  oopRiverBet: '25%,100%',         oopRiverRaise: '60%', oopRiverDonk: '50%',
  ipFlopBet: '33%,75%',            ipFlopRaise: '60%',
  ipTurnBet: '33%,75%',            ipTurnRaise: '60%',
  ipRiverBet: '25%,100%',          ipRiverRaise: '60%',
};

export const DEPTH_CONFIGS = {
  // --- Preflop-line cases (100bb effective; SPR set by the preflop line) ---
  'srp':  { pot: 100, stack: 1600, donkOption: true, betSizes: LINE_BET_SIZES },
  '3bet': { pot: 100, stack: 540,  donkOption: true, betSizes: LINE_BET_SIZES },
  '4bet': { pot: 100, stack: 170,  donkOption: true, betSizes: LINE_BET_SIZES },
  // --- 100bb baseline case ---
  '100bb': { pot: 100, stack: 450, donkOption: true, betSizes: {
    oopFlopBet: '33%,75%', oopFlopRaise: '50%',
    oopTurnBet: '50%,75%', oopTurnRaise: '50%', oopTurnDonk: '50%',
    oopRiverBet: '67%,100%', oopRiverRaise: '50%', oopRiverDonk: '50%',
    ipFlopBet: '33%,75%', ipFlopRaise: '50%',
    ipTurnBet: '50%,75%', ipTurnRaise: '50%',
    ipRiverBet: '67%,100%', ipRiverRaise: '50%',
  }},
};
