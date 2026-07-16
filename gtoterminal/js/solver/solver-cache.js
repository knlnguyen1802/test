// ============================================================================
// Solver Cache — Pre-computed Postflop Solution Lookup
// ============================================================================
// Fetches per-board JSON files from js/data/flop/<depth>/<matchup>/<board>.json.
// Results are cached in-memory so repeated lookups don't re-fetch.
//
// Usage (async):
//   var cached = await GTO.SolverCache.lookup(board, oopPos, ipPos, depth);
//   if (cached) { /* use cached.actions, cached.strategy, etc. */ }
//   else { /* fall back to live solve */ }
// ============================================================================

window.GTO = window.GTO || {};

GTO.SolverCache = (function() {
  'use strict';

  // In-memory cache: "depth/matchup/board" → solution object
  var _cache = {};

  // -----------------------------------------------------------------------
  // Board texture classification (lightweight, standalone)
  // -----------------------------------------------------------------------

  var RANKS_STR = '23456789TJQKA';
  var SUITS_STR = 'cdhs';

  function cardRank(card) {
    return RANKS_STR.indexOf(card[0]);
  }

  function cardSuit(card) {
    return SUITS_STR.indexOf(card[1]);
  }

  function classifyTexture(boardCards) {
    if (!boardCards || boardCards.length < 3) return 'dry_rainbow';

    var ranks = boardCards.map(cardRank);
    var suits = boardCards.map(cardSuit);

    var suitCounts = {};
    for (var i = 0; i < suits.length; i++) {
      suitCounts[suits[i]] = (suitCounts[suits[i]] || 0) + 1;
    }
    var maxSuit = 0;
    for (var s in suitCounts) {
      if (suitCounts[s] > maxSuit) maxSuit = suitCounts[s];
    }

    var rankCounts = {};
    for (var i = 0; i < ranks.length; i++) {
      rankCounts[ranks[i]] = (rankCounts[ranks[i]] || 0) + 1;
    }
    var isPaired = false;
    for (var r in rankCounts) {
      if (rankCounts[r] >= 2) { isPaired = true; break; }
    }

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
  // Board height anchor
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

  var TEXTURE_FALLBACK = {
    paired_wet: 'paired_dry',
    wet_twotone: 'wet_rainbow',
    dry_twotone: 'dry_rainbow',
    highly_connected: 'wet_rainbow',
    monotone: 'wet_twotone'
  };

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

  var MATCHUP_MAP = {
    'SB_BB': 'SB_BB',
    'BB_SB': 'SB_BB',
    'BTN_BB': 'BTN_BB',
    'BB_BTN': 'BTN_BB',
    'CO_BB': 'CO_BB',
    'BB_CO': 'CO_BB',
    'UTG_BB': 'UTG_BB',
    'BB_UTG': 'UTG_BB',
    'SB_BTN': 'BTN_SB',
    'BTN_SB': 'BTN_SB'
  };

  function findMatchup(oopPos, ipPos) {
    var oop = normalizePosition(oopPos);
    var ip = normalizePosition(ipPos);
    var key = oop + '_' + ip;
    return MATCHUP_MAP[key] || null;
  }

  // -----------------------------------------------------------------------
  // Fetch a per-board flop solution JSON file
  // -----------------------------------------------------------------------

  function fetchFlop(depth, matchup, boardLabel) {
    var url = 'js/data/flop/' + depth + '/' + matchup + '/' + boardLabel + '.json';
    return fetch(url, { cache: 'force-cache' })
      .then(function(r) {
        if (!r.ok) return null;
        return r.json();
      })
      .catch(function() { return null; });
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  return {
    /**
     * Look up a pre-computed flop solution (async).
     *
     * @param {string[]} board  - Flop cards as 2-char strings
     * @param {string} oopPos   - OOP player position
     * @param {string} ipPos    - IP player position
     * @param {string} depth    - 'srp', '3bet', '4bet', '100bb', etc.
     * @returns {Promise<object|null>}
     */
    lookup: function(board, oopPos, ipPos, depth) {
      if (!board || board.length < 3) return Promise.resolve(null);

      var matchupKey = findMatchup(oopPos, ipPos);
      if (!matchupKey) return Promise.resolve(null);

      var texture = classifyTexture(board);
      var closestLabel = findClosestBoard(texture, board);
      if (!closestLabel) return Promise.resolve(null);

      var d = depth || 'srp';
      var cacheKey = d + '/' + matchupKey + '/' + closestLabel;

      // Check in-memory cache
      if (_cache[cacheKey]) return Promise.resolve(_cache[cacheKey]);

      // Fetch from disk
      return fetchFlop(d, matchupKey, closestLabel).then(function(solution) {
        if (!solution || solution.error) return null;

        var result = {
          board: board.join(''),
          matchedBoard: closestLabel,
          texture: texture,
          matchup: matchupKey,
          depth: d,
          exact: false,
          actions: solution.actions,
          player: solution.player,
          strategy: solution.strategy,
          nodes: solution.nodes || null,
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

        _cache[cacheKey] = result;
        return result;
      });
    },

    classifyTexture: classifyTexture,

    findClosestBoard: function(texture, boardCards) {
      return findClosestBoard(texture, boardCards);
    },

    /**
     * Parse strategy string into structured action data.
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
