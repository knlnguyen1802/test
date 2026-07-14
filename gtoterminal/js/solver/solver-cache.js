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
  // Board height anchor — the strategically dominant rank of the board.
  // Unpaired boards anchor on the top card; paired boards anchor on the pair
  // rank (e.g. A88 plays by the pair of 8s, so it matches an 88x board, not AAx).
  // Returns a rank index in cardRank() units (2=0 .. A=12). See BOARD.md §2.
  // -----------------------------------------------------------------------

  function anchorRank(boardCards) {
    var ranks = boardCards.map(cardRank);
    var counts = {};
    for (var i = 0; i < ranks.length; i++) counts[ranks[i]] = (counts[ranks[i]] || 0) + 1;
    var pairRank = -1;
    for (var r in counts) {
      if (counts[r] >= 2 && Number(r) > pairRank) pairRank = Number(r);
    }
    return pairRank >= 0 ? pairRank : Math.max.apply(null, ranks);
  }

  // -----------------------------------------------------------------------
  // Find the closest pre-computed board for a given texture
  // -----------------------------------------------------------------------

  // Texture -> solved board labels (must match scripts/postflop_config/
  // flop-boards.mjs). See BOARD.md §3.
  var TEXTURE_BOARDS = {
    dry_rainbow:      ['A72r', 'K83r', 'Q62r', 'J74r', '852r'],
    dry_twotone:      ['A72tt', 'K92tt', 'Q74tt', 'J83tt', '852tt'],
    wet_rainbow:      ['QT8r', 'J97r', 'T86r', '864r'],
    wet_twotone:      ['QT8tt', 'J97tt', 'T86tt', '864tt'],
    monotone:         ['AT6sss', 'KT4sss', '853sss'],
    paired_dry:       ['AA8r', 'KK4r', '992r', '772r'],
    paired_wet:       ['JJ9r', 'TT8r', '887r', '553r'],
    highly_connected: ['AKQr', 'KQTr', 'JT9r', 'T98r', '765r']
  };

  // If a texture somehow has no boards, fall back to the nearest sibling.
  var TEXTURE_FALLBACK = {
    paired_wet: 'paired_dry',
    wet_twotone: 'wet_rainbow',
    dry_twotone: 'dry_rainbow',
    highly_connected: 'wet_rainbow',
    monotone: 'wet_twotone'
  };

  // Board label -> anchor rank (cardRank units: 2=0 .. A=12). Paired boards use
  // the pair rank. Keep in sync with TEXTURE_BOARDS.
  var BOARD_ANCHOR = {
    'A72r': 12, 'K83r': 11, 'Q62r': 10, 'J74r': 9, '852r': 6,
    'A72tt': 12, 'K92tt': 11, 'Q74tt': 10, 'J83tt': 9, '852tt': 6,
    'QT8r': 10, 'J97r': 9, 'T86r': 8, '864r': 6,
    'QT8tt': 10, 'J97tt': 9, 'T86tt': 8, '864tt': 6,
    'AT6sss': 12, 'KT4sss': 11, '853sss': 6,
    'AA8r': 12, 'KK4r': 11, '992r': 7, '772r': 5,
    'JJ9r': 9, 'TT8r': 8, '887r': 6, '553r': 3,
    'AKQr': 12, 'KQTr': 11, 'JT9r': 9, 'T98r': 8, '765r': 5
  };

  function findClosestBoard(texture, boardCards) {
    var candidates = TEXTURE_BOARDS[texture];
    if ((!candidates || candidates.length === 0) && TEXTURE_FALLBACK[texture]) {
      candidates = TEXTURE_BOARDS[TEXTURE_FALLBACK[texture]];
    }
    if (!candidates || candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0];

    var a = anchorRank(boardCards);
    var best = candidates[0];
    var bestDist = 999;
    for (var i = 0; i < candidates.length; i++) {
      var candAnchor = BOARD_ANCHOR[candidates[i]];
      if (candAnchor === undefined) continue;
      var dist = Math.abs(candAnchor - a);
      if (dist < bestDist) { bestDist = dist; best = candidates[i]; }
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
    'SB_BB': 'SB_BB',
    'BB_SB': 'SB_BB',
    'BTN_BB': 'BTN_BB',
    'BB_BTN': 'BTN_BB',
    'CO_BB': 'CO_BB',
    'BB_CO': 'CO_BB',
    'UTG_BB': 'UTG_BB',
    'BB_UTG': 'UTG_BB',
    'SB_BTN': 'BTN_SB',   // SB 3-bet pot: SB is OOP
    'BTN_SB': 'BTN_SB'    // alias
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
     *   matchup: 'SB_BB',         // position matchup key
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
     * @returns {string[]} matchup keys like ['SB_BB', 'BTN_BB', ...]
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
     * @param {string} matchupKey - e.g. 'SB_BB'
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
