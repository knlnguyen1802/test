// GTOTerminal — Preflop Solver Cache
// Reads pre-computed preflop solutions from GTO.Data.PreflopSolutions.
// Falls back to GTO.Data.PreflopRanges if no solver solutions exist.
//
// Lookup: GTO.PreflopSolverCache.lookup(format, depth, context, positionKey)
// Returns: { pure_raise, pure_call, mixed, meta? } or null

window.GTO = window.GTO || {};

GTO.PreflopSolverCache = {

  isAvailable: function() {
    return !!(GTO.Data && (GTO.Data.PreflopSolutions || GTO.Data.PreflopRanges));
  },

  // Look up a pre-computed solution.
  // format: 'cash' or 'mtt'
  // depth: '100bb', '40bb', '25bb', '20bb', '15bb'
  // context: 'rfi', 'vs_raise', 'vs_3bet', 'vs_4bet'
  // positionKey: 'UTG', 'MP', 'CO_BTN', etc.
  lookup: function(format, depth, context, positionKey) {
    // Try solver solutions first
    if (GTO.Data.PreflopSolutions) {
      var sol = this._resolve(GTO.Data.PreflopSolutions, format, depth, context, positionKey);
      if (sol) {
        sol._source = 'solver';
        return sol;
      }
    }

    // Fall back to curated ranges
    if (GTO.Data.PreflopRanges) {
      var curated = this._resolve(GTO.Data.PreflopRanges, format, depth, context, positionKey);
      if (curated) {
        curated._source = 'curated';
        return curated;
      }
    }

    return null;
  },

  // Navigate the data structure with depth fallback and format fallback (mtt → cash)
  _resolve: function(data, format, depth, context, positionKey) {
    var fmtData = data[format];
    if (!fmtData && format === 'mtt') fmtData = data['cash'];
    if (!fmtData) return null;

    // Try exact depth, then fallback to nearest
    var depthData = fmtData[depth];
    if (!depthData) {
      depthData = this._nearestDepth(fmtData, depth);
      if (!depthData) return null;
    }

    var contextData = depthData[context];
    if (!contextData) return null;

    // Try exact position key
    if (positionKey && contextData[positionKey]) {
      return contextData[positionKey];
    }

    // For RFI, position key is just the position name (UTG, MP, etc.)
    // For vs_raise etc., it's formatted as 'HERO_VILLAIN' (e.g., 'UTG_BTN')
    return positionKey ? contextData[positionKey] : null;
  },

  // Find nearest available depth
  _nearestDepth: function(fmtData, targetDepth) {
    var targetBB = parseInt(targetDepth);
    if (isNaN(targetBB)) return null;

    var available = Object.keys(fmtData);
    var best = null;
    var bestDiff = Infinity;

    for (var i = 0; i < available.length; i++) {
      var bb = parseInt(available[i]);
      if (isNaN(bb)) continue;
      var diff = Math.abs(bb - targetBB);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = available[i];
      }
    }

    return best ? fmtData[best] : null;
  },

  // Store a live solver result into the session cache
  store: function(format, depth, context, positionKey, result) {
    if (!GTO.Data.PreflopSolutions) {
      GTO.Data.PreflopSolutions = {};
    }
    var sol = GTO.Data.PreflopSolutions;

    if (!sol[format]) sol[format] = {};
    if (!sol[format][depth]) sol[format][depth] = {};
    if (!sol[format][depth][context]) sol[format][depth][context] = {};

    sol[format][depth][context][positionKey] = result;
  },

  // Convert full results {hand: {fold,call,raise}} to compact {pure_raise, pure_call, mixed}
  toCompact: function(results) {
    var pure_raise = [];
    var pure_call = [];
    var mixed = {};

    var hands = Object.keys(results);
    for (var i = 0; i < hands.length; i++) {
      var h = hands[i];
      var r = results[h];
      if (r.raise >= 0.95) {
        pure_raise.push(h);
      } else if (r.call >= 0.95) {
        pure_call.push(h);
      } else if (r.fold < 0.95) {
        mixed[h] = [
          Math.round(r.fold * 100) / 100,
          Math.round(r.call * 100) / 100,
          Math.round(r.raise * 100) / 100
        ];
      }
    }

    return { pure_raise: pure_raise, pure_call: pure_call, mixed: mixed };
  }
};
