// ============================================================================
// Postflop flop-board definitions
// ============================================================================
// Representative flop sample the postflop precompute solver runs each matchup
// against. Split out of scripts/precompute-postflop.mjs so the board sample can
// be edited independently. See BOARD.md for the full texture × height plan.
//
// The sample covers all 8 textures, each at the height points that matter for
// it (see BOARD.md §2/§3). A real flop is generalized to the closest board of
// its texture by anchor rank (top card, or pair rank on paired boards) — the
// matching lives in js/solver/solver-cache.js (findClosestBoard).
//
// Each entry:
//   board:   3-card flop as 2-char strings (rank + suit), e.g. ['Ac','7d','2h']
//   texture: one of the 8 textures (must equal BoardCategories.classify(board))
//   label:   short board id used in output filenames and variable keys
//            (r = rainbow, tt = two-tone, sss = monotone; paired = pair first)
// ============================================================================

export const FLOP_BOARDS = [
  // --- dry_rainbow: unpaired, 3 suits, disconnected (height: A/K/Q/J/low) ---
  { board: ['Ac','7d','2h'], texture: 'dry_rainbow', label: 'A72r' },
  { board: ['Ks','8d','3c'], texture: 'dry_rainbow', label: 'K83r' },
  { board: ['Qh','6c','2d'], texture: 'dry_rainbow', label: 'Q62r' },
  { board: ['Jc','7d','4h'], texture: 'dry_rainbow', label: 'J74r' },
  { board: ['8c','5d','2h'], texture: 'dry_rainbow', label: '852r' },

  // --- dry_twotone: unpaired, 2 of a suit, disconnected (height: A/K/Q/J/low) -
  { board: ['Ah','7h','2c'], texture: 'dry_twotone', label: 'A72tt' },
  { board: ['Kh','9h','2c'], texture: 'dry_twotone', label: 'K92tt' },
  { board: ['Qh','7h','4c'], texture: 'dry_twotone', label: 'Q74tt' },
  { board: ['Jh','8h','3c'], texture: 'dry_twotone', label: 'J83tt' },
  { board: ['8h','5h','2c'], texture: 'dry_twotone', label: '852tt' },

  // --- wet_rainbow: unpaired, 3 suits, connected (height: Q/J/T/low) ---------
  { board: ['Qc','Td','8h'], texture: 'wet_rainbow', label: 'QT8r' },
  { board: ['Jc','9d','7h'], texture: 'wet_rainbow', label: 'J97r' },
  { board: ['Tc','8d','6h'], texture: 'wet_rainbow', label: 'T86r' },
  { board: ['8c','6d','4h'], texture: 'wet_rainbow', label: '864r' },

  // --- wet_twotone: unpaired, 2 of a suit, connected (height: Q/J/T/low) -----
  { board: ['Qh','Th','8c'], texture: 'wet_twotone', label: 'QT8tt' },
  { board: ['Jh','9h','7c'], texture: 'wet_twotone', label: 'J97tt' },
  { board: ['Th','8h','6c'], texture: 'wet_twotone', label: 'T86tt' },
  { board: ['8h','6h','4c'], texture: 'wet_twotone', label: '864tt' },

  // --- monotone: 3 of a suit (height: A/K/low) -------------------------------
  { board: ['As','Ts','6s'], texture: 'monotone', label: 'AT6sss' },
  { board: ['Ks','Ts','4s'], texture: 'monotone', label: 'KT4sss' },
  { board: ['8s','5s','3s'], texture: 'monotone', label: '853sss' },

  // --- paired_dry: paired, disconnected (anchor = pair rank: A/K/9/7) --------
  { board: ['Ac','Ad','8h'], texture: 'paired_dry', label: 'AA8r' },
  { board: ['Kc','Kd','4h'], texture: 'paired_dry', label: 'KK4r' },
  { board: ['9c','9d','2h'], texture: 'paired_dry', label: '992r' },
  { board: ['7c','7d','2h'], texture: 'paired_dry', label: '772r' },

  // --- paired_wet: paired, connected/close (anchor = pair rank: J/T/8/5) -----
  { board: ['Jc','Jd','9h'], texture: 'paired_wet', label: 'JJ9r' },
  { board: ['Tc','Td','8h'], texture: 'paired_wet', label: 'TT8r' },
  { board: ['8c','8d','7h'], texture: 'paired_wet', label: '887r' },
  { board: ['5c','5d','3h'], texture: 'paired_wet', label: '553r' },

  // --- highly_connected: unpaired, very connected (height: A/K/J/T/low) ------
  { board: ['Ac','Kd','Qh'], texture: 'highly_connected', label: 'AKQr' },
  { board: ['Kc','Qd','Th'], texture: 'highly_connected', label: 'KQTr' },
  { board: ['Jc','Td','9h'], texture: 'highly_connected', label: 'JT9r' },
  { board: ['Tc','9d','8h'], texture: 'highly_connected', label: 'T98r' },
  { board: ['7c','6d','5h'], texture: 'highly_connected', label: '765r' },
];
