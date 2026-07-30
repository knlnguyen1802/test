// ============================================================================
// Postflop Lookup — Solver-backed strategy lookup with heuristic fallback
// ============================================================================
// Central lookup for all postflop strategy queries (Drill, Play, Explore).
// Routes to pre-computed solver solutions when available, falls back to
// heuristic tables for uncovered spots (turn, river).
// ============================================================================

window.GTO = window.GTO || {};
GTO.Engine = GTO.Engine || {};

GTO.Engine.PostflopLookup = {

  // Spot type → solver node key mapping
  // Root node (OOP c-bet) stored directly on solution; child nodes in solution.nodes
  _SPOT_NODE_MAP: {
    'OOP_cbet_flop':   null,               // root — use solution.actions/strategy directly
    'IP_cbet_flop':    'ip_cbet',           // history: [0] — IP after OOP checks
    'IP_facing_cbet':  'ip_facing_cbet',    // history: [1] — IP facing OOP bet
    'OOP_facing_cbet': 'oop_facing_cbet'    // history: [0,1] — OOP facing IP probe
  },

  /**
   * Look up postflop strategy from solver solutions or heuristic fallback.
   *
   * @param {Object} p
   * @param {string}   p.spotType       - e.g. 'OOP_cbet_flop', 'IP_facing_cbet'
   * @param {string}   p.boardTexture   - classified texture (e.g. 'dry_rainbow')
   * @param {string}   p.handStrength   - classified hand strength (for heuristic fallback)
   * @param {number}   p.spr            - stack-to-pot ratio (selects the solved case)
   * @param {string[]} p.boardCards     - actual board cards e.g. ['Ac','7d','2h']
   * @param {string}   p.matchup        - e.g. 'SB_BB' (required for solver lookup)
   * @param {string}   p.case           - e.g. 'srp'/'3bet'/'4bet' (optional, else resolved from SPR)
   * @returns {{ freqs: Object, source: string, solverData: Object|null, actions: Array|null }}
   */
  lookup: function(p) {
    // Check if this spot type has solver coverage
    if (this._SPOT_NODE_MAP.hasOwnProperty(p.spotType) && p.matchup) {
      var caseKey = p.case || this._resolveCase(p.spr);
      var solutions = this._getSolutions(caseKey);

      if (solutions && solutions[p.matchup]) {
        var solution = this._findSolution(solutions[p.matchup], p.boardCards, p.boardTexture);
        if (solution) {
          var nodeData = this._getNodeData(solution, p.spotType);
          if (nodeData && nodeData.strategy && nodeData.strategy.length > 0) {
            var freqs = this._convertToFreqs(nodeData);
            return {
              freqs: freqs,
              source: 'solver',
              solverData: nodeData,
              actions: this._parseActionList(nodeData.actions)
            };
          }
        }
      }
    }

    // Fallback to heuristic
    var hFreqs = null;
    if (GTO.Data._lookupPostflopHeuristic) {
      hFreqs = GTO.Data._lookupPostflopHeuristic(p.spotType, p.boardTexture, p.handStrength, p.spr);
    }
    return { freqs: hFreqs, source: 'heuristic', solverData: null, actions: null };
  },

  // -----------------------------------------------------------------------
  // Get node data for a given spot type from the solution object
  // -----------------------------------------------------------------------
  _getNodeData: function(solution, spotType) {
    var nodeKey = this._SPOT_NODE_MAP[spotType];
    if (nodeKey === null) {
      // Root node — data is on the solution itself
      return solution;
    }
    return solution.nodes && solution.nodes[nodeKey] ? solution.nodes[nodeKey] : null;
  },

  // -----------------------------------------------------------------------
  // Convert solver actions/strategy → scoring frequency object
  // "Check:0/Bet:33" + [0.17, 0.83] → {check: 0.17, bet_33: 0.83}
  // "Fold:0/Call:0/Raise:60" + [0.3, 0.55, 0.15] → {fold: 0.3, call: 0.55, raise: 0.15}
  // -----------------------------------------------------------------------
  _convertToFreqs: function(nodeData) {
    var actionParts = (nodeData.actions || '').split('/');
    var strategy = nodeData.strategy || [];
    var freqs = {};

    for (var i = 0; i < actionParts.length; i++) {
      var key = this._actionToKey(actionParts[i]);
      freqs[key] = strategy[i] || 0;
    }

    return freqs;
  },

  // -----------------------------------------------------------------------
  // Convert a single solver action string to a scoring-compatible key
  // "Check:0" → "check", "Bet:33" → "bet_33", "Allin:50" → "allin",
  // "Fold:0" → "fold", "Call:0" → "call", "Raise:60" → "raise"
  // -----------------------------------------------------------------------
  _actionToKey: function(actionStr) {
    var parts = actionStr.split(':');
    var name = parts[0];
    var amount = parts[1] ? parseInt(parts[1], 10) : 0;

    switch (name) {
      case 'Check': return 'check';
      case 'Fold':  return 'fold';
      case 'Call':  return 'call';
      case 'Raise': return 'raise';
      case 'Allin': return 'allin';
      case 'Bet':
        if (amount <= 40) return 'bet_33';
        if (amount <= 55) return 'bet_50';
        if (amount <= 80) return 'bet_67';
        return 'bet_100';
      default: return name.toLowerCase();
    }
  },

  // -----------------------------------------------------------------------
  // Parse action string into structured list for UI
  // "Check:0/Bet:33" → [{key:'check', label:'Check', hint:'X'}, {key:'bet_33', label:'Bet 33%', hint:'1'}]
  // -----------------------------------------------------------------------
  _parseActionList: function(actionsStr) {
    var parts = (actionsStr || '').split('/');
    var result = [];
    var hintIdx = 0;

    for (var i = 0; i < parts.length; i++) {
      var nameAmount = parts[i].split(':');
      var name = nameAmount[0];
      var amount = nameAmount[1] ? parseInt(nameAmount[1], 10) : 0;
      var key = this._actionToKey(parts[i]);

      var label, hint;
      switch (name) {
        case 'Check': label = 'Check'; hint = 'X'; break;
        case 'Fold':  label = 'Fold';  hint = 'F'; break;
        case 'Call':  label = 'Call';   hint = 'C'; break;
        case 'Raise': label = 'Raise'; hint = 'R'; break;
        case 'Allin': label = 'All-in'; hint = 'A'; break;
        case 'Bet':   label = 'Bet ' + amount + '%'; hint = String(++hintIdx); break;
        default:      label = name; hint = String(++hintIdx); break;
      }

      result.push({ key: key, label: label, hint: hint });
    }

    return result;
  },

  // -----------------------------------------------------------------------
  // SPR → solved case (nearest of srp=16, 3bet=5.4, 4bet=1.7)
  // -----------------------------------------------------------------------
  _resolveCase: function(spr) {
    if (spr === null || spr === undefined) return 'srp';
    if (spr > 10.7) return 'srp';   // midpoint(16, 5.4)
    if (spr > 3.55) return '3bet';  // midpoint(5.4, 1.7)
    return '4bet';
  },

  // -----------------------------------------------------------------------
  // Pre-computed solutions are now per-board JSON files loaded via
  // GTO.SolverCache.lookup (async). Synchronous heuristic remains as fallback.
  // -----------------------------------------------------------------------
  _getSolutions: function() {
    // Pre-computed flop data is loaded on-demand via solver-cache.js.fetch
    // with an in-memory cache. The sync code path always uses heuristic.
    return null;
  },

  // -----------------------------------------------------------------------
  // Find a matching solution for board cards within a matchup's solutions.
  // Tries exact board label match first, then texture-based match.
  // -----------------------------------------------------------------------
  _findSolution: function(matchupSolutions, boardCards, boardTexture) {
    if (!matchupSolutions || !GTO.Data.PostflopBoards) return null;

    // Try exact board match
    if (boardCards && boardCards.length >= 3) {
      var boardStr = boardCards.slice(0, 3).join('').toLowerCase();
      for (var i = 0; i < GTO.Data.PostflopBoards.length; i++) {
        var def = GTO.Data.PostflopBoards[i];
        var defStr = def.board.join('').toLowerCase();
        if (defStr === boardStr) {
          var sol = matchupSolutions[def.label];
          if (sol && !sol.error) return sol;
        }
      }
    }

    // Texture-based match: find any solved board with same texture
    if (boardTexture) {
      for (var i = 0; i < GTO.Data.PostflopBoards.length; i++) {
        var def = GTO.Data.PostflopBoards[i];
        if (def.texture === boardTexture) {
          var sol = matchupSolutions[def.label];
          if (sol && !sol.error) return sol;
        }
      }

      // Fuzzy texture mapping for unlisted textures
      var fuzzyMap = {
        'paired_wet': 'paired_dry',
        'highly_connected': 'wet_rainbow'
      };
      var fallbackTexture = fuzzyMap[boardTexture];
      if (fallbackTexture) {
        for (var i = 0; i < GTO.Data.PostflopBoards.length; i++) {
          var def = GTO.Data.PostflopBoards[i];
          if (def.texture === fallbackTexture) {
            var sol = matchupSolutions[def.label];
            if (sol && !sol.error) return sol;
          }
        }
      }
    }

    // Last resort: return the first non-error solution in this matchup
    var keys = Object.keys(matchupSolutions);
    for (var i = 0; i < keys.length; i++) {
      var sol = matchupSolutions[keys[i]];
      if (sol && !sol.error) return sol;
    }

    return null;
  },

  // -----------------------------------------------------------------------
  // Live WASM solve — on-demand solver for spots without pre-computed data
  // Used for turn/river spots or any heuristic result the user wants upgraded.
  // -----------------------------------------------------------------------
  solveLive: function(p, onResult, onProgress) {
    if (!GTO.Solver || !GTO.Solver.isAvailable()) {
      // Try to init solver if not ready
      if (GTO.Solver && !GTO.Solver.isAvailable()) {
        var self = this;
        GTO.Solver.init().then(function() {
          self.solveLive(p, onResult, onProgress);
        }).catch(function() { onResult(null); });
        return;
      }
      onResult(null);
      return;
    }

    var matchupKey = p.matchup;
    var matchup = GTO.Data.PostflopMatchups ? GTO.Data.PostflopMatchups[matchupKey] : null;
    if (!matchup) { onResult(null); return; }

    var depthCfg = GTO.Data.PostflopDepths ?
      (GTO.Data.PostflopDepths[p.depth] || GTO.Data.PostflopDepths['100bb']) :
      { pot: 100, stack: 450 };

    var self = this;
    var boardCards = p.boardCards;

    // Convert card objects to strings if needed
    if (boardCards && boardCards.length > 0 && typeof boardCards[0] !== 'string') {
      boardCards = boardCards.map(function(c) {
        return (c.rank || c.r || '') + (c.suit || c.s || '');
      });
    }

    GTO.Solver.solveWithCache({
      oopRange: matchup.oopRange,
      ipRange: matchup.ipRange,
      board: boardCards,
      startingPot: depthCfg.pot,
      effectiveStack: depthCfg.stack,
      oopPosition: matchup.oop,
      ipPosition: matchup.ip,
      maxIterations: 200,
      targetExploitability: 0.5,
      onProgress: onProgress || function() {}
    }).then(function(results) {
      // Navigate to correct node based on spot type
      var history = self._spotToHistory(p.spotType);
      if (history && history.length > 0) {
        GTO.Solver.getNodeResults(history).then(function(nodeResults) {
          nodeResults.solveInfo = results.solveInfo;
          onResult(self._convertSolverResult(nodeResults));
        }).catch(function() { onResult(null); });
      } else {
        onResult(self._convertSolverResult(results));
      }
    }).catch(function(e) {
      console.error('[PostflopLookup] Live solve failed:', e);
      onResult(null);
    });
  },

  // -----------------------------------------------------------------------
  // Map spot types to game tree history paths for navigation
  // Works for flop, turn, and river — tree structure is the same per street
  // -----------------------------------------------------------------------
  _spotToHistory: function(spotType) {
    // OOP acts first (root), IP acts second
    // [0] = first action (check), [1] = second action (bet)
    var map = {
      'OOP_cbet_flop': [],       'OOP_turn_barrel': [],       'OOP_river_bet': [],
      'IP_cbet_flop': [0],       'IP_turn_barrel': [0],       'IP_river_bet': [0],
      'IP_facing_cbet': [1],     'IP_facing_turn': [1],       'IP_facing_river': [1],
      'OOP_facing_cbet': [0, 1], 'OOP_facing_turn': [0, 1],   'OOP_facing_river': [0, 1]
    };
    return map[spotType] || [];
  },

  // -----------------------------------------------------------------------
  // Convert live WASM solver result to same format as lookup()
  // -----------------------------------------------------------------------
  _convertSolverResult: function(results) {
    var actionParts = (results.actions || '').split('/');
    var strategy = results.strategy || [];
    var freqs = {};
    for (var i = 0; i < actionParts.length; i++) {
      freqs[this._actionToKey(actionParts[i])] = strategy[i] || 0;
    }
    return {
      freqs: freqs,
      source: 'solver',
      actions: this._parseActionList(results.actions),
      solverData: results
    };
  },

  // -----------------------------------------------------------------------
  // Get a random matchup key that matches the given hero/villain positions
  // -----------------------------------------------------------------------
  resolveMatchup: function(heroPosition, isOOP) {
    var matchups = GTO.Data.PostflopMatchups;
    if (!matchups) return null;

    var candidates = [];
    var keys = Object.keys(matchups);
    for (var i = 0; i < keys.length; i++) {
      var m = matchups[keys[i]];
      if (isOOP && m.oop === heroPosition) candidates.push(keys[i]);
      if (!isOOP && m.ip === heroPosition) candidates.push(keys[i]);
    }

    if (candidates.length === 0) {
      // Default: return any matchup
      return keys.length > 0 ? keys[Math.floor(Math.random() * keys.length)] : null;
    }

    return candidates[Math.floor(Math.random() * candidates.length)];
  }
};
