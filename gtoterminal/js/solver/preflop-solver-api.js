// GTOTerminal — Preflop Solver API
// Main-thread interface to the preflop WASM solver running in a Web Worker.
// Usage: GTO.PreflopSolver.solve({ stackDepth, actionContext, numOpponents }) → Promise<results>

window.GTO = window.GTO || {};

GTO.PreflopSolver = {
  _worker: null,
  _ready: false,
  _pending: null,
  _onProgress: null,

  // Position → number of opponents remaining to act
  POSITION_OPPONENTS: {
    UTG: 5, MP: 4, CO: 3, BTN: 2, SB: 1, BB: 0
  },

  // Initialize the solver worker
  init: function() {
    if (this._worker) return Promise.resolve();

    var self = this;
    return new Promise(function(resolve, reject) {
      try {
        self._worker = new Worker('js/solver/preflop-solver-worker.js', { type: 'module' });
        self._worker.onmessage = function(e) {
          self._handleMessage(e.data);
        };
        self._worker.onerror = function(e) {
          console.error('[PreflopSolver] Worker error:', e);
          reject(e);
        };

        self._pending = { resolve: resolve, reject: reject, type: 'init' };
        self._worker.postMessage({ type: 'init' });
      } catch(e) {
        reject(e);
      }
    });
  },

  isAvailable: function() {
    return this._ready;
  },

  // Solve a preflop spot.
  // config: {
  //   stackDepth: 100,             // Effective stack in BB
  //   actionContext: 'rfi',         // 'rfi', 'vs_raise', 'vs_3bet', 'vs_4bet'
  //   numOpponents: 2,             // Opponents yet to act (optional, derived from position)
  //   position: 'BTN',             // Hero position (optional, used to derive numOpponents)
  //   villainRange: [...],          // 169 weights (optional)
  //   icmBubbleFactor: 1.0,        // ICM factor (optional)
  //   maxIterations: 3000,         // Max solve iterations (optional)
  //   targetExploitability: 0.005, // Target convergence (optional)
  //   onProgress: fn               // Progress callback (optional)
  // }
  // Returns Promise with {
  //   results: { "AA": {fold, call, raise}, ... },
  //   compact: { pure_raise: [...], pure_call: [...], mixed: {...} },
  //   raiseCombos, iterations, exploitability
  // }
  solve: function(config) {
    var self = this;

    // Ensure initialized
    var initPromise = this._ready ? Promise.resolve() : this.init();

    return initPromise.then(function() {
      return new Promise(function(resolve, reject) {
        // Derive numOpponents from position if not provided
        var solverConfig = {
          stackDepth: config.stackDepth || 100,
          actionContext: config.actionContext || 'rfi'
        };

        if (config.numOpponents !== undefined) {
          solverConfig.numOpponents = config.numOpponents;
        } else if (config.position && self.POSITION_OPPONENTS[config.position] !== undefined) {
          solverConfig.numOpponents = self.POSITION_OPPONENTS[config.position];
        }

        if (config.villainRange) solverConfig.villainRange = config.villainRange;
        if (config.icmBubbleFactor) solverConfig.icmBubbleFactor = config.icmBubbleFactor;

        self._onProgress = config.onProgress || null;
        self._pending = { resolve: resolve, reject: reject, type: 'solve' };

        self._worker.postMessage({
          type: 'solve',
          config: solverConfig,
          maxIterations: config.maxIterations || 3000,
          targetExploitability: config.targetExploitability || 0.005
        });
      });
    }).then(function(msg) {
      if (!msg.success) throw new Error(msg.error);

      // Parse JSON strings from WASM
      var results = typeof msg.results === 'string' ? JSON.parse(msg.results) : msg.results;
      var compact = typeof msg.compact === 'string' ? JSON.parse(msg.compact) : msg.compact;

      return {
        results: results,
        compact: compact,
        raiseCombos: msg.raiseCombos,
        iterations: msg.iterations,
        exploitability: msg.exploitability
      };
    });
  },

  // Solve with cache: checks pre-computed solutions first, falls back to live solver.
  solveWithCache: function(config) {
    // Try cache first
    if (GTO.PreflopSolverCache && GTO.PreflopSolverCache.isAvailable()) {
      var cached = GTO.PreflopSolverCache.lookup(
        config.format || 'cash',
        config.stackDepth || '100bb',
        config.actionContext || 'rfi',
        config.positionKey || ''
      );

      if (cached) {
        console.log('[PreflopSolver] Cache hit:', config.actionContext, config.positionKey);
        return Promise.resolve({
          results: cached.results || {},
          compact: cached,
          raiseCombos: cached.raiseCombos || 0,
          iterations: cached.meta ? cached.meta.iterations : 0,
          exploitability: cached.meta ? cached.meta.exploitability : 0,
          cached: true
        });
      }
    }

    // No cache — live solve
    console.log('[PreflopSolver] Cache miss, running live solve...');
    return this.solve(config);
  },

  // Convert solver results to the format expected by lookupPreflop.
  // Input: compact format { pure_raise: [...], pure_call: [...], mixed: {...} }
  // Output: same format as PreflopRanges position data
  toRangeFormat: function(compact) {
    return {
      pure_raise: compact.pure_raise || [],
      pure_call: compact.pure_call || [],
      mixed: compact.mixed || {}
    };
  },

  // Convert solver results to the hand matrix format {hand: {fold, call, raise}}
  toMatrixFormat: function(results) {
    var matrix = {};
    var hands = Object.keys(results);
    for (var i = 0; i < hands.length; i++) {
      var h = hands[i];
      var r = results[h];
      matrix[h] = {
        fold: r.fold || 0,
        call: r.call || 0,
        raise: r.raise || 0
      };
    }
    return matrix;
  },

  _handleMessage: function(msg) {
    if (msg.type === 'progress') {
      if (this._onProgress) {
        this._onProgress(msg);
      }
      return;
    }

    if (msg.type === 'init') {
      this._ready = true;
    }

    if (this._pending && this._pending.type === msg.type) {
      var pending = this._pending;
      this._pending = null;
      pending.resolve(msg);
    }
  }
};
