// ============================================================================
// Postflop precompute configuration — grouped entry point
// ============================================================================
// Single import surface for the postflop precompute solver's tunable inputs:
//   - game tree   (LINE_BET_SIZES, DEPTH_CONFIGS)  → game-tree.mjs
//   - matchups    (MATCHUPS)                       → matchups.mjs
//   - flop boards (FLOP_BOARDS)                    → flop-boards.mjs
//
// Import individual names, or the grouped `postflop_config` object:
//   import { MATCHUPS, FLOP_BOARDS, DEPTH_CONFIGS } from './postflop_config/index.mjs';
//   import { postflop_config } from './postflop_config/index.mjs';
// ============================================================================

import { LINE_BET_SIZES, DEPTH_CONFIGS } from './game-tree.mjs';
import { MATCHUPS } from './matchups.mjs';
import { FLOP_BOARDS } from './flop-boards.mjs';

export { LINE_BET_SIZES, DEPTH_CONFIGS, MATCHUPS, FLOP_BOARDS };

export const postflop_config = {
  LINE_BET_SIZES,
  DEPTH_CONFIGS,
  MATCHUPS,
  FLOP_BOARDS,
};
