// GTOTerminal — Solver API
// Main-thread interface to the WASM solver running in a Web Worker
// Usage: GTO.Solver.solve({ oopRange, ipRange, board, pot, stack }) → Promise<results>

window.GTO = window.GTO || {};

GTO.Solver = {
  _worker: null,
  _ready: false,
  _pending: {},
  _msgId: 0,
  _onProgress: null,

  // Initialize the solver worker
  init: function() {
    if (this._worker) return Promise.resolve();

    var self = this;
    return new Promise(function(resolve, reject) {
      try {
        self._worker = new Worker('js/solver/solver-worker.js', { type: 'module' });
        self._worker.onmessage = function(e) {
          self._handleMessage(e.data);
        };
        self._worker.onerror = function(e) {
          console.error('[Solver] Worker error:', e);
          reject(e);
        };

        // Wait for init confirmation
        self._pending['init'] = { resolve: function() {
          self._ready = true;
          resolve();
        }, reject: reject };

        self._worker.postMessage({ type: 'init' });
      } catch(e) {
        reject(e);
      }
    });
  },

  // Check if solver is available (WASM loaded)
  isAvailable: function() {
    return this._ready;
  },

  // Solve a postflop spot
  // config: { oopRange, ipRange, board, startingPot, effectiveStack, betSizes?, onProgress? }
  // Returns Promise with { iterations, exploitability, actions, strategy }
  solve: function(config) {
    var self = this;

    // Convert ranges if they're text format
    var oopRange = config.oopRange;
    var ipRange = config.ipRange;
    if (typeof oopRange === 'string') oopRange = this.parseRange(oopRange);
    if (typeof ipRange === 'string') ipRange = this.parseRange(ipRange);

    // Convert board cards to solver format (card_id = 4 * rank + suit)
    var board = config.board;
    if (board && board.length > 0 && typeof board[0] === 'string') {
      board = this.parseBoard(board);
    }

    this._onProgress = config.onProgress || null;

    return this._send('setup', {
      oopRange: oopRange,
      ipRange: ipRange,
      board: board,
      startingPot: config.startingPot || 100,
      effectiveStack: config.effectiveStack || 450,
      rakeRate: config.rakeRate || 0,
      rakeCap: config.rakeCap || 0,
      oopFlopBet: config.oopFlopBet || '33%,67%',
      oopFlopRaise: config.oopFlopRaise || '60%',
      oopTurnBet: config.oopTurnBet || '33%,67%',
      oopTurnRaise: config.oopTurnRaise || '60%',
      oopRiverBet: config.oopRiverBet || '33%,67%,100%',
      oopRiverRaise: config.oopRiverRaise || '60%',
      ipFlopBet: config.ipFlopBet || '33%,67%',
      ipFlopRaise: config.ipFlopRaise || '60%',
      ipTurnBet: config.ipTurnBet || '33%,67%',
      ipTurnRaise: config.ipTurnRaise || '60%',
      ipRiverBet: config.ipRiverBet || '33%,67%,100%',
      ipRiverRaise: config.ipRiverRaise || '60%'
    }).then(function(setupResult) {
      if (!setupResult.success) throw new Error(setupResult.error);

      return self._send('allocate', { compress: true });
    }).then(function() {
      return self._send('solve', {
        maxIterations: config.maxIterations || 200,
        targetExploitability: config.targetExploitability || 0.5,
        startingPot: config.startingPot || 100
      });
    }).then(function(solveResult) {
      // Get root node results
      return self._send('getResults', { history: [] }).then(function(r) {
        r.solveInfo = solveResult;
        return r;
      });
    });
  },

  // Navigate to a specific node and get results
  getNodeResults: function(history) {
    return this._send('getResults', { history: history });
  },

  // Parse text range to Float32Array(1326)
  // Format: "AA,KK:0.5,AKs,QQ-TT" (PioSolver compatible)
  parseRange: function(text) {
    var range = new Float32Array(1326);
    if (!text || !text.trim()) return range;

    var RANKS = '23456789TJQKA';
    var parts = text.split(',');

    for (var p = 0; p < parts.length; p++) {
      var part = parts[p].trim();
      if (!part) continue;

      // Check for weight
      var weight = 1.0;
      var colonIdx = part.indexOf(':');
      if (colonIdx >= 0) {
        weight = parseFloat(part.substring(colonIdx + 1));
        part = part.substring(0, colonIdx);
      }

      // Check for range (QQ-TT)
      var dashIdx = part.indexOf('-');
      if (dashIdx >= 0) {
        var start = part.substring(0, dashIdx);
        var end = part.substring(dashIdx + 1);
        var hands = this._expandRange(start, end, RANKS);
        for (var h = 0; h < hands.length; h++) {
          this._setHandWeight(range, hands[h], weight, RANKS);
        }
        continue;
      }

      // Single hand
      this._setHandWeight(range, part, weight, RANKS);
    }

    return range;
  },

  // Parse board cards: ['Ah','7d','2c'] → Uint8Array
  parseBoard: function(cards) {
    var RANKS = '23456789TJQKA';
    var SUITS = 'cdhs';
    var board = new Uint8Array(cards.length);
    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      var rank = RANKS.indexOf(card[0]);
      var suit = SUITS.indexOf(card[1]);
      board[i] = 4 * rank + suit;
    }
    return board;
  },

  _expandRange: function(start, end, RANKS) {
    var hands = [];
    // Handle pair ranges: QQ-TT
    if (start.length === 2 && start[0] === start[1] && end.length === 2 && end[0] === end[1]) {
      var r1 = RANKS.indexOf(start[0]);
      var r2 = RANKS.indexOf(end[0]);
      var lo = Math.min(r1, r2);
      var hi = Math.max(r1, r2);
      for (var r = lo; r <= hi; r++) {
        hands.push(RANKS[r] + RANKS[r]);
      }
    }
    // Handle suited ranges: AKs-ATs
    else if (start.length === 3 && start[2] === 's' && end.length === 3 && end[2] === 's') {
      var high = RANKS.indexOf(start[0]);
      var r1 = RANKS.indexOf(start[1]);
      var r2 = RANKS.indexOf(end[1]);
      var lo = Math.min(r1, r2);
      var hi = Math.max(r1, r2);
      for (var r = lo; r <= hi; r++) {
        hands.push(RANKS[high] + RANKS[r] + 's');
      }
    }
    // Handle offsuit ranges: AKo-ATo
    else if (start.length === 3 && start[2] === 'o' && end.length === 3 && end[2] === 'o') {
      var high = RANKS.indexOf(start[0]);
      var r1 = RANKS.indexOf(start[1]);
      var r2 = RANKS.indexOf(end[1]);
      var lo = Math.min(r1, r2);
      var hi = Math.max(r1, r2);
      for (var r = lo; r <= hi; r++) {
        hands.push(RANKS[high] + RANKS[r] + 'o');
      }
    }
    return hands;
  },

  _setHandWeight: function(range, hand, weight, RANKS) {
    var SUITS = [0, 1, 2, 3]; // c, d, h, s

    if (hand.length === 2) {
      // Pair: AA, KK
      var r = RANKS.indexOf(hand[0]);
      for (var s1 = 0; s1 < 4; s1++) {
        for (var s2 = s1 + 1; s2 < 4; s2++) {
          var c1 = 4 * r + s1;
          var c2 = 4 * r + s2;
          var idx = this._cardPairIndex(c1, c2);
          range[idx] = weight;
        }
      }
    } else if (hand.length === 3 && hand[2] === 's') {
      // Suited: AKs
      var r1 = RANKS.indexOf(hand[0]);
      var r2 = RANKS.indexOf(hand[1]);
      for (var s = 0; s < 4; s++) {
        var c1 = 4 * r1 + s;
        var c2 = 4 * r2 + s;
        var idx = this._cardPairIndex(c1, c2);
        range[idx] = weight;
      }
    } else if (hand.length === 3 && hand[2] === 'o') {
      // Offsuit: AKo
      var r1 = RANKS.indexOf(hand[0]);
      var r2 = RANKS.indexOf(hand[1]);
      for (var s1 = 0; s1 < 4; s1++) {
        for (var s2 = 0; s2 < 4; s2++) {
          if (s1 === s2) continue;
          var c1 = 4 * r1 + s1;
          var c2 = 4 * r2 + s2;
          var idx = this._cardPairIndex(c1, c2);
          range[idx] = weight;
        }
      }
    } else if (hand.length === 4) {
      // Specific combo: AhKs
      var r1 = RANKS.indexOf(hand[0]);
      var s1 = 'cdhs'.indexOf(hand[1]);
      var r2 = RANKS.indexOf(hand[2]);
      var s2 = 'cdhs'.indexOf(hand[3]);
      var c1 = 4 * r1 + s1;
      var c2 = 4 * r2 + s2;
      var idx = this._cardPairIndex(c1, c2);
      range[idx] = weight;
    } else if (hand.length === 2 && hand[0] !== hand[1]) {
      // Unpaired no suit indicator — treat as both suited and offsuit
      var r1 = RANKS.indexOf(hand[0]);
      var r2 = RANKS.indexOf(hand[1]);
      for (var s1 = 0; s1 < 4; s1++) {
        for (var s2 = 0; s2 < 4; s2++) {
          var c1 = 4 * r1 + s1;
          var c2 = 4 * r2 + s2;
          if (c1 !== c2) {
            var idx = this._cardPairIndex(c1, c2);
            range[idx] = weight;
          }
        }
      }
    }
  },

  // Card pair index: matches postflop-solver's Range index formula
  _cardPairIndex: function(c1, c2) {
    if (c1 > c2) { var tmp = c1; c1 = c2; c2 = tmp; }
    return c1 * (101 - c1) / 2 + c2 - 1;
  },

  _send: function(type, data) {
    var self = this;
    return new Promise(function(resolve, reject) {
      self._pending[type] = { resolve: resolve, reject: reject };
      self._worker.postMessage({ type: type, data: data,
        maxIterations: data && data.maxIterations,
        targetExploitability: data && data.targetExploitability,
        startingPot: data && data.startingPot,
        compress: data && data.compress,
        history: data && data.history
      });
    });
  },

  // Solve with cache: checks pre-computed solutions first, falls back to live WASM solve.
  // config: same as solve(), plus optional oopPosition and ipPosition for cache lookup.
  // Returns Promise with results (cached results include a `cached: true` flag).
  solveWithCache: function(config) {
    var self = this;

    // Try cache lookup first
    if (GTO.SolverCache && GTO.SolverCache.isAvailable() && config.oopPosition && config.ipPosition) {
      var board = config.board;
      // Ensure board is in string format for cache lookup
      if (board && board.length > 0 && typeof board[0] !== 'string') {
        // Convert Uint8Array back to string format
        var RANKS = '23456789TJQKA';
        var SUITS = 'cdhs';
        board = [];
        for (var i = 0; i < config.board.length; i++) {
          var id = config.board[i];
          board.push(RANKS[Math.floor(id / 4)] + SUITS[id % 4]);
        }
      }

      var cached = GTO.SolverCache.lookup(board, config.oopPosition, config.ipPosition);
      if (cached) {
        console.log('[Solver] Cache hit:', cached.matchup, cached.matchedBoard, '(texture:', cached.texture + ')');

        // Format cached result to match live solve output structure
        var parsed = GTO.SolverCache.parseStrategy(cached.actions, cached.strategy);
        return Promise.resolve({
          type: 'getResults',
          cached: true,
          matchedBoard: cached.matchedBoard,
          texture: cached.texture,
          matchup: cached.matchup,
          actions: cached.actions,
          player: 'oop',  // OOP acts first at root
          numActions: cached.numActions,
          strategy: cached.strategy,
          parsedStrategy: parsed,
          oopEquity: cached.oopEquity,
          ipEquity: cached.ipEquity,
          oopEV: cached.oopEV,
          ipEV: cached.ipEV,
          solveInfo: {
            type: 'solve',
            success: true,
            iterations: cached.iterations,
            exploitability: cached.exploitability,
            cached: true
          }
        });
      }
    }

    // No cache hit — fall back to live WASM solve
    console.log('[Solver] Cache miss, running live solve...');
    return this.solve(config);
  },

  _handleMessage: function(msg) {
    if (msg.type === 'progress') {
      if (this._onProgress) {
        this._onProgress(msg);
      }
      return;
    }

    var pending = this._pending[msg.type];
    if (pending) {
      delete this._pending[msg.type];
      pending.resolve(msg);
    }
  }
};
