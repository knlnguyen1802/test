// ============================================================================
// Solver Cache — Pre-computed Postflop Solution Lookup
// ============================================================================
// Checks if a pre-computed solution exists for a given board/range combo.
// Falls back to null so the caller can run a live WASM solve instead.
//
// Usage:
//   var cached = GTO.SolverCache.lookup(board, oopRange, ipRange, matchup);
//   if (cached) { /* use cached.actions, cached.strategy, etc. */ }
//   else { /* fall back to GTO.Solver.solve(...) */ }
//
// The cache maps:  matchup (position pair) + board texture -> pre-computed result
// ============================================================================

window.GTO = window.GTO || {};

GTO.SolverCache = (function() {
  'use strict';

  // -----------------------------------------------------------------------
  // Board texture classification (lightweight, standalone)
  // -----------------------------------------------------------------------

  var RANKS_STR = '23456789TJQKA';
  var SUITS_STR = 'cdhs';

  function cardRank(card) {
    // card is a 2-char string like 'Ah'
    return RANKS_STR.indexOf(card[0]);
  }

  function cardSuit(card) {
    return SUITS_STR.indexOf(card[1]);
  }

  function classifyTexture(boardCards) {
    // boardCards: array of 2-char strings: ['Ah','7d','2c']
    if (!boardCards || boardCards.length < 3) return 'dry_rainbow';

    var ranks = boardCards.map(cardRank);
    var suits = boardCards.map(cardSuit);

    // Suit distribution
    var suitCounts = {};
    for (var i = 0; i < suits.length; i++) {
      suitCounts[suits[i]] = (suitCounts[suits[i]] || 0) + 1;
    }
    var maxSuit = 0;
    for (var s in suitCounts) {
      if (suitCounts[s] > maxSuit) maxSuit = suitCounts[s];
    }

    // Rank distribution (check for pairing)
    var rankCounts = {};
    for (var i = 0; i < ranks.length; i++) {
      rankCounts[ranks[i]] = (rankCounts[ranks[i]] || 0) + 1;
    }
    var isPaired = false;
    for (var r in rankCounts) {
      if (rankCounts[r] >= 2) { isPaired = true; break; }
    }

    // Connectedness: count how many adjacent pairs have gap <= 2
    var unique = [];
    var seen = {};
    for (var i = 0; i < ranks.length; i++) {
      if (!seen[ranks[i]]) { unique.push(ranks[i]); seen[ranks[i]] = true; }
    }
    unique.sort(function(a, b) { return b - a; });

    var connected = 0;
    for (var i = 0; i < unique.length - 1; i++) {
      if (unique[i] - unique[i + 1] <= 2) connected++;
    }
    // Wheel potential
    if (seen[12] && unique.some(function(r) { return r <= 3; })) connected++;

    var isWet = connected >= 2 || (unique.length >= 3 && (unique[0] - unique[unique.length - 1]) <= 4);
    var isHighlyConnected = connected >= 3 ||
      (unique.length >= 3 && (unique[0] - unique[unique.length - 1]) <= 3 && !isPaired);

    if (maxSuit >= 3) return 'monotone';
    if (isHighlyConnected && !isPaired) return 'highly_connected';
    if (isPaired) return isWet ? 'paired_wet' : 'paired_dry';
    var isTwoTone = maxSuit >= 2;
    if (isWet) return isTwoTone ? 'wet_twotone' : 'wet_rainbow';
    return isTwoTone ? 'dry_twotone' : 'dry_rainbow';
  }

  // -----------------------------------------------------------------------
  // Board highness classification
  // -----------------------------------------------------------------------

  function boardHighness(boardCards) {
    var ranks = boardCards.map(cardRank);
    var maxRank = Math.max.apply(null, ranks);
    if (maxRank >= 12) return 'ace_high';   // A
    if (maxRank >= 11) return 'king_high';  // K
    if (maxRank >= 10) return 'queen_high'; // Q
    if (maxRank >= 9)  return 'jack_high';  // J
    if (maxRank >= 8)  return 'ten_high';   // T
    return 'low';
  }

  // -----------------------------------------------------------------------
  // Find the closest pre-computed board for a given texture
  // -----------------------------------------------------------------------

  // Mapping from texture -> representative board labels in our solution set
  var TEXTURE_BOARDS = {
    dry_rainbow:      ['A72r', 'K83r', 'Q62r', '532r'],
    dry_twotone:      ['AT5dd', 'K92hh', 'Q74cc'],
    wet_rainbow:      ['JT9r', 'T87r', '987r', '643r', '754r'],
    wet_twotone:      ['JT8dd', 'T97hh', '876cc'],
    monotone:         ['KT4sss', 'Q73hhh'],
    paired_dry:       ['KK4r', '772r', 'AA8r'],
    paired_wet:       ['KK4r', '772r'],  // reuse paired boards
    highly_connected: ['AKJr', 'KQTr', 'AQJr']
  };

  // Board label -> approximate "height" for matching purposes
  var BOARD_HEIGHT = {
    'A72r': 'ace_high', 'K83r': 'king_high', 'Q62r': 'queen_high', '532r': 'low',
    'AT5dd': 'ace_high', 'K92hh': 'king_high', 'Q74cc': 'queen_high',
    'JT9r': 'jack_high', 'T87r': 'ten_high', '987r': 'ten_high',
    '643r': 'low', '754r': 'low',
    'JT8dd': 'jack_high', 'T97hh': 'ten_high', '876cc': 'low',
    'KT4sss': 'king_high', 'Q73hhh': 'queen_high',
    'KK4r': 'king_high', '772r': 'low', 'AA8r': 'ace_high',
    'AKJr': 'ace_high', 'KQTr': 'king_high', 'AQJr': 'ace_high'
  };

  // Height priority for matching (closer = better)
  var HEIGHT_ORDER = ['ace_high', 'king_high', 'queen_high', 'jack_high', 'ten_high', 'low'];

  function findClosestBoard(texture, boardCards) {
    var candidates = TEXTURE_BOARDS[texture];
    if (!candidates || candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0];

    var height = boardHighness(boardCards);
    var heightIdx = HEIGHT_ORDER.indexOf(height);

    // Score each candidate by distance in height
    var best = candidates[0];
    var bestDist = 999;
    for (var i = 0; i < candidates.length; i++) {
      var candHeight = BOARD_HEIGHT[candidates[i]] || 'low';
      var candIdx = HEIGHT_ORDER.indexOf(candHeight);
      var dist = Math.abs(heightIdx - candIdx);
      if (dist < bestDist) {
        bestDist = dist;
        best = candidates[i];
      }
    }
    return best;
  }

  // -----------------------------------------------------------------------
  // Matchup detection from position strings
  // -----------------------------------------------------------------------

  var POSITION_ALIASES = {
    'sb': 'SB', 'SB': 'SB', 'smallblind': 'SB', 'small_blind': 'SB',
    'bb': 'BB', 'BB': 'BB', 'bigblind': 'BB', 'big_blind': 'BB',
    'btn': 'BTN', 'BTN': 'BTN', 'button': 'BTN', 'bu': 'BTN',
    'co': 'CO', 'CO': 'CO', 'cutoff': 'CO', 'cut_off': 'CO',
    'utg': 'UTG', 'UTG': 'UTG', 'under_the_gun': 'UTG',
    'mp': 'UTG', 'MP': 'UTG', 'lj': 'UTG', 'LJ': 'UTG', 'hj': 'CO', 'HJ': 'CO'
  };

  function normalizePosition(pos) {
    return POSITION_ALIASES[pos] || pos;
  }

  // Map of (oopPos, ipPos) -> matchup key in solutions
  var MATCHUP_MAP = {
    'SB_BB': 'SB_vs_BB',
    'BTN_BB': 'BTN_vs_BB',
    'CO_BB': 'CO_vs_BB',
    'UTG_BB': 'UTG_vs_BB',
    'SB_BTN': 'BTN_vs_SB',   // SB 3-bet pot: SB is OOP
    'BTN_SB': 'BTN_vs_SB'    // alias
  };

  function findMatchup(oopPos, ipPos) {
    var oop = normalizePosition(oopPos);
    var ip = normalizePosition(ipPos);
    var key = oop + '_' + ip;
    return MATCHUP_MAP[key] || null;
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  return {
    /**
     * Look up a pre-computed solution for a postflop spot.
     *
     * @param {string[]} board  - Flop cards as 2-char strings: ['Ah','7d','2c']
     * @param {string} oopPos   - OOP player position: 'SB','BB','UTG','CO','BTN'
     * @param {string} ipPos    - IP player position: 'SB','BB','UTG','CO','BTN'
     * @returns {object|null}   - Pre-computed solution or null if not cached
     *
     * Returned object (when found):
     * {
     *   board: 'Ah7d2c',          // original board string
     *   matchedBoard: 'A72r',     // which pre-computed board was matched
     *   texture: 'dry_rainbow',   // board texture category
     *   matchup: 'SB_vs_BB',      // position matchup key
     *   exact: false,             // whether board was an exact match
     *   actions: 'Check:0/Bet:33/Bet:67',
     *   strategy: [0.45, 0.35, 0.20],  // aggregate frequencies for each action
     *   oopEquity: 0.485,
     *   ipEquity: 0.515,
     *   oopEV: 48.5,
     *   ipEV: 51.5,
     *   exploitability: 0.3,
     *   iterations: 200
     * }
     */
    lookup: function(board, oopPos, ipPos) {
      // Validate inputs
      if (!board || board.length < 3) return null;

      // Check that solutions data is loaded
      if (!GTO.Data || !GTO.Data.PostflopSolutions) return null;

      // Find matching position matchup
      var matchupKey = findMatchup(oopPos, ipPos);
      if (!matchupKey) return null;

      var matchupSolutions = GTO.Data.PostflopSolutions[matchupKey];
      if (!matchupSolutions) return null;

      // Classify the board texture
      var texture = classifyTexture(board);

      // Find the closest pre-computed board for this texture
      var closestLabel = findClosestBoard(texture, board);
      if (!closestLabel) return null;

      // Look up the solution
      var solution = matchupSolutions[closestLabel];
      if (!solution || solution.error) return null;

      // Build result
      return {
        board: board.join(''),
        matchedBoard: closestLabel,
        texture: texture,
        matchup: matchupKey,
        exact: false,  // texture-based match, not exact board match
        actions: solution.actions,
        strategy: solution.strategy,
        oopEquity: solution.oopEquity,
        ipEquity: solution.ipEquity,
        oopEV: solution.oopEV,
        ipEV: solution.ipEV,
        exploitability: solution.exploitability,
        iterations: solution.iterations,
        numActions: solution.numActions,
        oopCombos: solution.oopCombos,
        ipCombos: solution.ipCombos,
      };
    },

    /**
     * Get all available matchups in the cache.
     * @returns {string[]} matchup keys like ['SB_vs_BB', 'BTN_vs_BB', ...]
     */
    getMatchups: function() {
      if (!GTO.Data || !GTO.Data.PostflopSolutions) return [];
      return Object.keys(GTO.Data.PostflopSolutions);
    },

    /**
     * Get all board labels for a given matchup.
     * @param {string} matchupKey
     * @returns {string[]} board labels like ['A72r', 'K83r', ...]
     */
    getBoards: function(matchupKey) {
      if (!GTO.Data || !GTO.Data.PostflopSolutions) return [];
      var matchup = GTO.Data.PostflopSolutions[matchupKey];
      if (!matchup) return [];
      return Object.keys(matchup);
    },

    /**
     * Get a specific pre-computed solution by matchup and board label.
     * @param {string} matchupKey - e.g. 'SB_vs_BB'
     * @param {string} boardLabel - e.g. 'A72r'
     * @returns {object|null}
     */
    getExact: function(matchupKey, boardLabel) {
      if (!GTO.Data || !GTO.Data.PostflopSolutions) return null;
      var matchup = GTO.Data.PostflopSolutions[matchupKey];
      if (!matchup) return null;
      return matchup[boardLabel] || null;
    },

    /**
     * Classify a board's texture (exposed for external use).
     * @param {string[]} boardCards - ['Ah','7d','2c']
     * @returns {string} texture category
     */
    classifyTexture: classifyTexture,

    /**
     * Check if solutions are loaded and available.
     * @returns {boolean}
     */
    isAvailable: function() {
      return !!(GTO.Data && GTO.Data.PostflopSolutions &&
                Object.keys(GTO.Data.PostflopSolutions).length > 0);
    },

    /**
     * Get cache statistics.
     * @returns {object} { matchups, boards, totalSpots }
     */
    stats: function() {
      if (!this.isAvailable()) return { matchups: 0, boards: 0, totalSpots: 0 };
      var matchups = Object.keys(GTO.Data.PostflopSolutions);
      var totalSpots = 0;
      for (var i = 0; i < matchups.length; i++) {
        totalSpots += Object.keys(GTO.Data.PostflopSolutions[matchups[i]]).length;
      }
      return {
        matchups: matchups.length,
        boards: FLOP_BOARDS ? FLOP_BOARDS.length : 0,
        totalSpots: totalSpots
      };
    },

    /**
     * Parse strategy string into structured action data.
     * Input:  actions = "Check:0/Bet:33/Bet:67"
     *         strategy = [0.45, 0.35, 0.20]
     * Output: [{action:'Check', amount:0, freq:0.45}, {action:'Bet', amount:33, freq:0.35}, ...]
     */
    parseStrategy: function(actions, strategy) {
      if (!actions || !strategy) return [];
      var parts = actions.split('/');
      var result = [];
      for (var i = 0; i < parts.length; i++) {
        var split = parts[i].split(':');
        result.push({
          action: split[0],
          amount: parseInt(split[1] || '0', 10),
          freq: strategy[i] || 0,
          pct: Math.round((strategy[i] || 0) * 100)
        });
      }
      return result;
    }
  };
})();
