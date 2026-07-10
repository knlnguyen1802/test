// ============================================================================
// Postflop flop-board definitions
// ============================================================================
// The set of representative flop textures the postflop precompute solver runs
// each matchup against. Split out of scripts/precompute-postflop.mjs so the
// board sample can be edited independently.
//
// Each entry:
//   board:   3-card flop as 2-char strings (rank + suit), e.g. ['Ac','7d','2h']
//   texture: texture classification used for grouping/reporting
//   label:   short board id used in output filenames and variable keys
// ============================================================================

export const FLOP_BOARDS = [
  { board: ['Ac','7d','2h'], texture: 'dry_rainbow',      label: 'A72r' },
  { board: ['Ks','8d','3h'], texture: 'dry_rainbow',      label: 'K83r' },
  { board: ['Qh','6c','2d'], texture: 'dry_rainbow',      label: 'Q62r' },
  { board: ['Ad','Td','5h'], texture: 'dry_twotone',      label: 'AT5dd' },
  { board: ['Kh','9h','2c'], texture: 'dry_twotone',      label: 'K92hh' },
  { board: ['Qc','7c','4d'], texture: 'dry_twotone',      label: 'Q74cc' },
  { board: ['Jc','Td','9h'], texture: 'wet_rainbow',      label: 'JT9r' },
  { board: ['Th','8c','7d'], texture: 'wet_rainbow',      label: 'T87r' },
  { board: ['9s','8c','7d'], texture: 'wet_rainbow',      label: '987r' },
  { board: ['Jd','Td','8h'], texture: 'wet_twotone',      label: 'JT8dd' },
  { board: ['Th','9h','7c'], texture: 'wet_twotone',      label: 'T97hh' },
  { board: ['8c','7c','6d'], texture: 'wet_twotone',      label: '876cc' },
  { board: ['Ks','Ts','4s'], texture: 'monotone',         label: 'KT4sss' },
  { board: ['Qh','7h','3h'], texture: 'monotone',         label: 'Q73hhh' },
  { board: ['Kd','Kh','4c'], texture: 'paired_dry',       label: 'KK4r' },
  { board: ['7c','7d','2h'], texture: 'paired_dry',       label: '772r' },
  { board: ['As','Ah','8c'], texture: 'paired_dry',       label: 'AA8r' },
  { board: ['Ac','Kd','Jh'], texture: 'highly_connected', label: 'AKJr' },
  { board: ['Kh','Qd','Tc'], texture: 'highly_connected', label: 'KQTr' },
  { board: ['As','Qd','Jc'], texture: 'highly_connected', label: 'AQJr' },
  { board: ['5d','3h','2c'], texture: 'dry_rainbow',      label: '532r' },
  { board: ['6c','4d','3h'], texture: 'wet_rainbow',      label: '643r' },
  { board: ['7h','5d','4c'], texture: 'wet_rainbow',      label: '754r' },
];
