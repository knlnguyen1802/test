// ============================================================================
// Postflop position-matchup metadata (positions only — NO hardcoded ranges)
// ============================================================================
// Input hand ranges are NOT stored here. They are derived from the preflop
// lookup table (preflop-lookup/preflop-ranges.js) by
// scripts/preflop-to-postflop-ranges.mjs, which writes
// js/data/postflop-input-ranges.json keyed by BET LEVEL (srp / 3bet / 4bet).
//
// A matchup key is `AGG_CALLER`: the FIRST position is the AGGRESSOR (the last
// raiser), the SECOND is the CALLER. Every pairing is listed in BOTH directions
// (e.g. SB_BB and BB_SB) so the aggressor is explicit in the key — nothing is
// computed. A given key only carries data at the levels where that spot exists;
// impossible ones (e.g. BB as the aggressor in a single-raised pot) resolve to
// an empty lookup and are skipped by the bridge.
//
// Which seat is OOP / IP postflop does NOT depend on the aggressor. It follows
// the postflop action order (POSTFLOP_ORDER): blinds act first postflop, button
// last. E.g. BTN vs BB — postflop the BB is OOP and the BTN is IP. Use
// postflopPosition() to resolve it.
// ============================================================================

// Postflop action order — the earlier a seat is here, the sooner it acts
// postflop, i.e. the more out of position it is. (SB acts first, BTN last.)
export const POSTFLOP_ORDER = ['SB', 'BB', 'UTG', 'MP', 'CO', 'BTN'];

// Resolve which of two seats is OOP (acts first postflop) vs IP (acts last).
export function postflopPosition(a, b) {
  const ia = POSTFLOP_ORDER.indexOf(a);
  const ib = POSTFLOP_ORDER.indexOf(b);
  return ia <= ib ? { oop: a, ip: b } : { oop: b, ip: a };
}

// For each bet level, where the AGGRESSOR's raise range and the CALLER's call
// range live in the preflop lookup. Given a matchup key `AGG_CALLER` split into
// [agg, caller], `keyBy` builds the lookup key:
//   'agg'        → agg                (rfi is keyed by a single seat)
//   'agg_caller' → `${agg}_${caller}`
//   'caller_agg' → `${caller}_${agg}`
// The preflop tables are now keyed HERO_VILLAIN (hero = the seat whose range is
// stored, i.e. the one facing the action). So the key is whichever seat is the
// hero at that decision:
//   srp  caller flats vs agg's open   -> hero=caller  -> vs_raise[caller_agg]
//   3bet agg 3bets vs caller's open   -> hero=agg     -> vs_raise[agg_caller]
//   3bet caller calls agg's 3bet      -> hero=caller  -> vs_3bet[caller_agg]
//   4bet agg 4bets vs caller's 3bet   -> hero=agg     -> vs_3bet[agg_caller]
//   4bet caller calls agg's 4bet      -> hero=caller  -> vs_4bet[caller_agg]
export const BET_LEVELS = {
  srp: {
    agg:    { table: 'rfi',      keyBy: 'agg',        take: 'raise' },
    caller: { table: 'vs_raise', keyBy: 'caller_agg', take: 'call'  },
  },
  '3bet': {
    agg:    { table: 'vs_raise', keyBy: 'agg_caller', take: 'raise' },
    caller: { table: 'vs_3bet',  keyBy: 'caller_agg', take: 'call'  },
  },
  '4bet': {
    agg:    { table: 'vs_3bet',  keyBy: 'agg_caller', take: 'raise' },
    caller: { table: 'vs_4bet',  keyBy: 'caller_agg', take: 'call'  },
  },
};

// All matchups, aggressor-first, listed in BOTH directions. The bridge derives
// ranges for every (level, matchup) pair and skips those with no lookup data,
// so e.g. BB_SB only produces a 3bet spot and SB_BB only srp / 4bet.
export const MATCHUPS = [
  'SB_BB',   'BB_SB',
  'BTN_BB',  'BB_BTN',
  'CO_BB',   'BB_CO',
  'UTG_BB',  'BB_UTG',
  'MP_BB',   'BB_MP',
  'BTN_SB',  'SB_BTN',
  'CO_SB',   'SB_CO',
  'MP_SB',   'SB_MP',
  'UTG_SB',  'SB_UTG',
  'CO_BTN',  'BTN_CO',
  'MP_BTN',  'BTN_MP',
  'UTG_BTN', 'BTN_UTG',
  'MP_CO',   'CO_MP',
  'UTG_CO',  'CO_UTG',
  'UTG_MP',  'MP_UTG',
];
