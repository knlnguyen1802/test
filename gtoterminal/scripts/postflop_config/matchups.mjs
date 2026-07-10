// ============================================================================
// Postflop position-matchup definitions
// ============================================================================
// Built-in OOP/IP preflop ranges for each position matchup, used as the input
// hand space for the postflop precompute solver. Split out of
// scripts/precompute-postflop.mjs for easier maintenance.
//
// These are the built-in DEFAULTS. At runtime the precompute script overrides
// them with preflop-derived ranges from js/data/postflop-input-ranges.json
// (unless --builtin-ranges is passed), keeping any built-in side that the
// derived data leaves empty.
//
// Cold-caller pairs (opener vs a non-blind caller) are DERIVE-ONLY: ranges are
// left empty and filled from the preflop bridge for the 3bet/4bet cases. In a
// single-raised pot the defender 3bets rather than flat-calls, so the srp range
// stays empty and main() skips the spot.
// ============================================================================

export const MATCHUPS = {
  SB_vs_BB: {
    oop: 'AA,KK,QQ,JJ,TT,99,88,77,66,55,' +
         'AKs,AQs,AJs,ATs,A9s,A8s,A7s,A6s,A5s,A4s,A3s,A2s,' +
         'AKo,AQo,AJo,ATo,A9o,' +
         'KQs,KJs,KTs,K9s,K8s,K7s,K6s,K5s,' +
         'KQo,KJo,KTo,' +
         'QJs,QTs,Q9s,Q8s,Q7s,' +
         'QJo,QTo,' +
         'JTs,J9s,J8s,J7s,' +
         'JTo,' +
         'T9s,T8s,T7s,' +
         '98s,97s,96s,' +
         '87s,86s,85s,' +
         '76s,75s,74s,' +
         '65s,64s,63s,' +
         '54s,53s,' +
         '43s',
    ip:  'AA,KK,QQ,JJ,TT,99,88,77,66,55,44,33,22,' +
         'AKs,AQs,AJs,ATs,A9s,A8s,A7s,A6s,A5s,A4s,A3s,A2s,' +
         'AKo,AQo,AJo,ATo,A9o,A8o,A7o,' +
         'KQs,KJs,KTs,K9s,K8s,K7s,K6s,K5s,K4s,' +
         'KQo,KJo,KTo,K9o,' +
         'QJs,QTs,Q9s,Q8s,Q7s,Q6s,' +
         'QJo,QTo,Q9o,' +
         'JTs,J9s,J8s,J7s,J6s,' +
         'JTo,J9o,' +
         'T9s,T8s,T7s,T6s,' +
         'T9o,' +
         '98s,97s,96s,95s,' +
         '87s,86s,85s,84s,' +
         '76s,75s,74s,' +
         '65s,64s,63s,' +
         '54s,53s,52s,' +
         '43s,42s,32s'
  },
  BTN_vs_BB: {
    oop: 'AA,KK,QQ,JJ,TT,99,88,77,66,55,44,' +
         'AKs,AQs,AJs,ATs,A9s,A8s,A7s,A6s,A5s,A4s,A3s,A2s,' +
         'AKo,AQo,AJo,ATo,A9o,' +
         'KQs,KJs,KTs,K9s,K8s,K7s,K6s,K5s,' +
         'KQo,KJo,KTo,' +
         'QJs,QTs,Q9s,Q8s,Q7s,' +
         'QJo,QTo,' +
         'JTs,J9s,J8s,' +
         'JTo,' +
         'T9s,T8s,T7s,' +
         '98s,97s,' +
         '87s,86s,' +
         '76s,75s,' +
         '65s,64s,' +
         '54s,53s,' +
         '43s',
    ip:  'AA,KK,QQ,JJ,TT,99,88,77,66,55,44,33,22,' +
         'AKs,AQs,AJs,ATs,A9s,A8s,A7s,A6s,A5s,A4s,A3s,A2s,' +
         'AKo,AQo,AJo,ATo,A9o,' +
         'KQs,KJs,KTs,K9s,K8s,K7s,K6s,K5s,' +
         'KQo,KJo,KTo,K9o,' +
         'QJs,QTs,Q9s,Q8s,Q7s,' +
         'QJo,QTo,Q9o,' +
         'JTs,J9s,J8s,J7s,' +
         'JTo,J9o,' +
         'T9s,T8s,T7s,' +
         'T9o,' +
         '98s,97s,96s,' +
         '87s,86s,85s,' +
         '76s,75s,74s,' +
         '65s,64s,' +
         '54s,53s,' +
         '43s'
  },
  CO_vs_BB: {
    oop: 'AA,KK,QQ,JJ,TT,99,88,77,66,' +
         'AKs,AQs,AJs,ATs,A9s,A8s,A7s,A5s,A4s,' +
         'AKo,AQo,AJo,ATo,' +
         'KQs,KJs,KTs,K9s,K8s,' +
         'KQo,KJo,' +
         'QJs,QTs,Q9s,Q8s,' +
         'QJo,' +
         'JTs,J9s,J8s,' +
         'T9s,T8s,' +
         '98s,97s,' +
         '87s,86s,' +
         '76s,75s,' +
         '65s,64s,' +
         '54s',
    ip:  'AA,KK,QQ,JJ,TT,99,88,77,66,55,44,' +
         'AKs,AQs,AJs,ATs,A9s,A8s,A7s,A5s,A4s,A3s,' +
         'AKo,AQo,AJo,ATo,' +
         'KQs,KJs,KTs,K9s,K8s,K7s,' +
         'KQo,KJo,KTo,' +
         'QJs,QTs,Q9s,Q8s,Q7s,' +
         'QJo,QTo,' +
         'JTs,J9s,J8s,' +
         'JTo,' +
         'T9s,T8s,T7s,' +
         '98s,97s,' +
         '87s,86s,' +
         '76s,75s,' +
         '65s,64s,' +
         '54s,53s'
  },
  UTG_vs_BB: {
    oop: 'AA,KK,QQ,JJ,TT,99,88,77,' +
         'AKs,AQs,AJs,ATs,A9s,A5s,' +
         'AKo,AQo,AJo,' +
         'KQs,KJs,KTs,' +
         'QJs,QTs,' +
         'JTs,T9s,' +
         '98s,87s,76s,65s',
    ip:  'AA,KK,QQ,JJ,TT,99,88,77,66,55,44,33,22,' +
         'AKs,AQs,AJs,ATs,A9s,A8s,A7s,A5s,A4s,A3s,' +
         'AKo,AQo,AJo,ATo,' +
         'KQs,KJs,KTs,K9s,K8s,K7s,' +
         'KQo,KJo,KTo,' +
         'QJs,QTs,Q9s,Q8s,' +
         'QJo,QTo,' +
         'JTs,J9s,J8s,' +
         'JTo,' +
         'T9s,T8s,' +
         '98s,97s,' +
         '87s,86s,' +
         '76s,75s,' +
         '65s,64s,' +
         '54s'
  },
  BTN_vs_SB: {
    oop: 'AA,KK,QQ,JJ,TT,99,88,77,' +
         'AKs,AQs,AJs,ATs,A9s,A8s,A7s,' +
         'A5s,A4s,A3s,A2s,' +
         'AKo,AQo,AJo,ATo,' +
         'KQs,KJs,KTs,K9s,' +
         'KQo,KJo,' +
         'QJs,QTs,Q9s,' +
         'JTs,J9s,' +
         'T9s,98s,' +
         '87s,76s,65s',
    ip:  'AA,KK,QQ,JJ,TT,99,88,77,66,' +
         'AKs,AQs,AJs,ATs,A9s,A8s,' +
         'A5s,A4s,' +
         'AKo,AQo,AJo,ATo,' +
         'KQs,KJs,KTs,K9s,' +
         'KQo,KJo,' +
         'QJs,QTs,Q9s,' +
         'QJo,' +
         'JTs,J9s,' +
         'T9s,T8s,' +
         '98s,97s,' +
         '87s,86s,' +
         '76s,65s,54s'
  },
  // Cold-caller pairs (opener vs a non-blind caller). DERIVE-ONLY: ranges are
  // left empty and filled from the preflop bridge (postflop-input-ranges.json)
  // for the 3bet/4bet cases. In a single-raised pot the defender 3bets rather
  // than flat-calls, so the srp range stays empty and main() skips the spot.
  UTG_vs_MP:  { oop: '', ip: '' },
  UTG_vs_CO:  { oop: '', ip: '' },
  UTG_vs_BTN: { oop: '', ip: '' },
  UTG_vs_SB:  { oop: '', ip: '' },
  MP_vs_CO:   { oop: '', ip: '' },
  MP_vs_BTN:  { oop: '', ip: '' },
  MP_vs_SB:   { oop: '', ip: '' },
  MP_vs_BB:   { oop: '', ip: '' },
  CO_vs_BTN:  { oop: '', ip: '' },
  CO_vs_SB:   { oop: '', ip: '' },
};
