// ============================================================================
// ICM Calculator — Independent Chip Model (Malmuth-Harville)
// ============================================================================
// Converts chip stacks into real-money equity using recursive finish
// probabilities. Used across all tabs when format=MTT.
//
// Key insight: In tournaments, chips have diminishing marginal value.
// Losing chips hurts more than gaining chips helps. This "ICM tax"
// means optimal play is tighter than chip-EV suggests, especially
// near the bubble or pay jumps.
// ============================================================================

window.GTO = window.GTO || {};
GTO.Engine = GTO.Engine || {};

GTO.Engine.ICM = {

  // -----------------------------------------------------------------------
  // Calculate ICM equity for all players
  // @param {number[]} stacks - chip stacks (any unit, just consistent)
  // @param {number[]} prizes - prize amounts [1st, 2nd, 3rd, ...]
  // @returns {number[]} equity in $ for each player
  // -----------------------------------------------------------------------
  calculateEquities: function(stacks, prizes) {
    var n = stacks.length;
    if (n === 0 || prizes.length === 0) return [];

    var totalChips = 0;
    for (var i = 0; i < n; i++) totalChips += stacks[i];
    if (totalChips === 0) return new Array(n).fill(0);

    var numPrizes = Math.min(prizes.length, n);
    var allActive = (1 << n) - 1; // bitmask: all players active
    var memo = {};
    var equities = [];

    for (var p = 0; p < n; p++) {
      if (stacks[p] <= 0) {
        equities.push(0);
        continue;
      }
      var probs = this._finishProbs(p, allActive, stacks, totalChips, numPrizes, memo);
      var eq = 0;
      for (var k = 0; k < numPrizes; k++) {
        eq += probs[k] * prizes[k];
      }
      equities.push(eq);
    }

    return equities;
  },

  // -----------------------------------------------------------------------
  // Bubble factor for a specific player given a pot size
  // Compares equity lost (lose pot) vs equity gained (win pot)
  // @param {number} playerIdx - hero index
  // @param {number[]} stacks - current chip stacks
  // @param {number[]} prizes - prize amounts
  // @param {number} potSize - chips at risk
  // @returns {number} bubble factor (1.0 = no pressure, 2.0+ = heavy)
  // -----------------------------------------------------------------------
  bubbleFactor: function(playerIdx, stacks, prizes, potSize) {
    if (!stacks || stacks.length < 2 || !prizes || prizes.length === 0) return 1.0;
    if (potSize <= 0) return 1.0;

    var currentEquities = this.calculateEquities(stacks, prizes);
    var currentEq = currentEquities[playerIdx];

    // Simulate winning the pot
    var winStacks = stacks.slice();
    winStacks[playerIdx] += potSize;
    var winEquities = this.calculateEquities(winStacks, prizes);
    var eqGained = winEquities[playerIdx] - currentEq;

    // Simulate losing the pot
    var loseStacks = stacks.slice();
    loseStacks[playerIdx] = Math.max(0, loseStacks[playerIdx] - potSize);
    var loseEquities = this.calculateEquities(loseStacks, prizes);
    var eqLost = currentEq - loseEquities[playerIdx];

    if (eqGained <= 0) return 99.0; // extreme pressure — can't gain equity
    return Math.max(1.0, eqLost / eqGained);
  },

  // -----------------------------------------------------------------------
  // ICM pressure: 0-100 score for display
  // Based on bubble factor, stack-to-average, and proximity to pay jumps
  // @param {number} playerIdx
  // @param {number[]} stacks
  // @param {number[]} prizes
  // @returns {number} pressure 0-100
  // -----------------------------------------------------------------------
  pressure: function(playerIdx, stacks, prizes) {
    if (!stacks || stacks.length < 2 || !prizes || prizes.length === 0) return 0;

    var n = stacks.length;
    var totalChips = 0;
    for (var i = 0; i < n; i++) totalChips += stacks[i];
    var avgStack = totalChips / n;
    var heroStack = stacks[playerIdx];

    // Component 1: Bubble factor (0-50 points)
    // Use hero's stack as approximate pot size for a typical all-in
    var bf = this.bubbleFactor(playerIdx, stacks, prizes, heroStack);
    var bfScore = Math.min(50, (bf - 1.0) * 25);

    // Component 2: Proximity to bubble (0-30 points)
    // More players vs fewer paid spots = more bubble pressure
    var paidSpots = prizes.length;
    var playersLeft = 0;
    for (var i = 0; i < n; i++) { if (stacks[i] > 0) playersLeft++; }
    var bubbleProximity = 0;
    if (playersLeft > paidSpots) {
      // Distance to bubble: how many need to bust before money
      var toBust = playersLeft - paidSpots;
      bubbleProximity = Math.max(0, 30 - (toBust - 1) * 10);
    } else {
      // Already in the money — pressure from pay jumps
      bubbleProximity = 15; // moderate pressure from pay jumps
    }

    // Component 3: Stack vulnerability (0-20 points)
    // Short stacks feel more ICM pressure
    var stackRatio = heroStack / avgStack;
    var stackScore = 0;
    if (stackRatio < 0.5) stackScore = 20;
    else if (stackRatio < 0.75) stackScore = 15;
    else if (stackRatio < 1.0) stackScore = 10;
    else if (stackRatio < 1.5) stackScore = 5;
    else stackScore = 0; // big stack, less pressure

    return Math.round(Math.min(100, Math.max(0, bfScore + bubbleProximity + stackScore)));
  },

  // -----------------------------------------------------------------------
  // Compare two outcomes: $EV change of action vs fold
  // @param {number} heroIdx
  // @param {number[]} currentStacks
  // @param {number[]} winStacks - stacks if hero wins
  // @param {number[]} loseStacks - stacks if hero loses
  // @param {number} winProb - probability of winning (0-1)
  // @param {number[]} prizes
  // @returns {{ chipEV, dollarEV, icmTax, currentEquity, winEquity, loseEquity }}
  // -----------------------------------------------------------------------
  compareOutcomes: function(heroIdx, currentStacks, winStacks, loseStacks, winProb, prizes) {
    var currentEquities = this.calculateEquities(currentStacks, prizes);
    var winEquities = this.calculateEquities(winStacks, prizes);
    var loseEquities = this.calculateEquities(loseStacks, prizes);

    var currentEq = currentEquities[heroIdx];
    var winEq = winEquities[heroIdx];
    var loseEq = loseEquities[heroIdx];

    // Dollar EV of taking action
    var dollarEV = (winProb * winEq) + ((1 - winProb) * loseEq) - currentEq;

    // Chip EV (linear model — what cEV would say)
    var chipWin = winStacks[heroIdx] - currentStacks[heroIdx];
    var chipLoss = currentStacks[heroIdx] - loseStacks[heroIdx];
    var chipEV = (winProb * chipWin) - ((1 - winProb) * chipLoss);

    // ICM tax: how much $EV is lost vs what chip EV suggests
    // Normalize chip EV to dollar scale for comparison
    var totalPrizes = 0;
    for (var i = 0; i < prizes.length; i++) totalPrizes += prizes[i];
    var totalChips = 0;
    for (var i = 0; i < currentStacks.length; i++) totalChips += currentStacks[i];
    var chipToDollar = totalChips > 0 ? totalPrizes / totalChips : 1;
    var chipEVDollars = chipEV * chipToDollar;
    var icmTax = chipEVDollars - dollarEV;

    return {
      chipEV: chipEV,
      chipEVDollars: chipEVDollars,
      dollarEV: dollarEV,
      icmTax: icmTax,
      currentEquity: currentEq,
      winEquity: winEq,
      loseEquity: loseEq
    };
  },

  // -----------------------------------------------------------------------
  // Internal: Malmuth-Harville recursive finish probabilities
  //
  // P(player finishes in position k) using recursive conditional probability.
  // For 1st place: P(1st) = stack / totalChips
  // For kth place: Sum over all possible (k-1)th finishers j:
  //   P(player finishes k | j finished k-1) × P(j finishes k-1)
  //   where after removing j, stacks are renormalized.
  //
  // Memoization key: (playerIdx, activeMask, position)
  // -----------------------------------------------------------------------
  _finishProbs: function(playerIdx, activeMask, stacks, totalChips, numPrizes, memo) {
    var probs = [];
    for (var pos = 0; pos < numPrizes; pos++) {
      probs.push(this._finishProbAt(playerIdx, pos, activeMask, stacks, totalChips, memo));
    }
    return probs;
  },

  _finishProbAt: function(playerIdx, position, activeMask, stacks, totalChips, memo) {
    // Memo key: player|position|activeMask
    var key = playerIdx + '|' + position + '|' + activeMask;
    if (memo[key] !== undefined) return memo[key];

    var n = stacks.length;

    // Base case: 1st place — probability proportional to stack
    if (position === 0) {
      var activeChips = 0;
      for (var i = 0; i < n; i++) {
        if (activeMask & (1 << i)) activeChips += stacks[i];
      }
      var prob = activeChips > 0 ? stacks[playerIdx] / activeChips : 0;
      memo[key] = prob;
      return prob;
    }

    // Recursive case: for each possible player j who could finish in
    // position (position-1) or earlier, calculate conditional probability
    // Actually, Malmuth-Harville for position k:
    // P(i finishes k) = Σ_j P(j finishes 1st) × P(i finishes k | j out, among remaining)
    // where j != i and j is active

    var prob = 0;
    var activeChips = 0;
    for (var i = 0; i < n; i++) {
      if (activeMask & (1 << i)) activeChips += stacks[i];
    }

    for (var j = 0; j < n; j++) {
      if (j === playerIdx) continue;
      if (!(activeMask & (1 << j))) continue;
      if (stacks[j] <= 0) continue;

      // P(j finishes 1st among active) = stacks[j] / activeChips
      var pJFirst = activeChips > 0 ? stacks[j] / activeChips : 0;

      // Remove j from active set, calculate P(i finishes position-1) in remaining field
      var newMask = activeMask & ~(1 << j);
      var newTotalChips = activeChips - stacks[j];

      var pINext = this._finishProbAt(playerIdx, position - 1, newMask, stacks, newTotalChips, memo);

      prob += pJFirst * pINext;
    }

    memo[key] = prob;
    return prob;
  },

  // -----------------------------------------------------------------------
  // Adjust GTO frequencies for ICM pressure
  //
  // Core ICM principle: calling/continuing costs more under ICM pressure.
  // Bubble factor > 1.0 means each chip lost hurts more than each chip gained.
  //
  // @param {Object} gtoFreqs    - raw frequencies e.g. {fold:0.3, call:0.4, raise:0.3}
  // @param {number} bubbleFactor - BF from ICM (1.0 = no adjustment, 2.0 = heavy)
  // @param {string} spotType    - 'preflop_rfi'|'preflop_call'|'preflop_3bet'|
  //                                'postflop_bet'|'postflop_facing'|'pushfold'
  // @returns {Object} adjusted frequencies (same keys, sums to ~1.0)
  // -----------------------------------------------------------------------
  adjustFrequencies: function(gtoFreqs, bubbleFactor, spotType) {
    if (!gtoFreqs || !bubbleFactor || bubbleFactor <= 1.0) return gtoFreqs;

    var adjusted = {};
    var keys = Object.keys(gtoFreqs);
    var bf = bubbleFactor;

    // Classify each action as aggressive, passive, or fold
    var passiveTotal = 0, aggressiveTotal = 0, foldKey = null;
    var passiveKeys = [], aggressiveKeys = [];

    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (k === 'fold') {
        foldKey = k;
      } else if (k === 'call' || k === 'check') {
        passiveKeys.push(k);
        passiveTotal += gtoFreqs[k];
      } else {
        // raise, bet_33, bet_67, bet_100, allin, push, etc.
        aggressiveKeys.push(k);
        aggressiveTotal += gtoFreqs[k];
      }
    }

    // No fold action present (e.g., check/bet spot) — lighter adjustment
    if (foldKey === null) {
      // Shift probability from aggressive to passive (less bluffing under ICM)
      var bluffReduction = Math.min(0.15, (bf - 1.0) * 0.10);
      var removedFromAggressive = 0;

      for (var i = 0; i < aggressiveKeys.length; i++) {
        var k = aggressiveKeys[i];
        var reduction = gtoFreqs[k] * bluffReduction;
        adjusted[k] = Math.max(0, gtoFreqs[k] - reduction);
        removedFromAggressive += gtoFreqs[k] - adjusted[k];
      }

      // Distribute removed mass to passive actions
      for (var i = 0; i < passiveKeys.length; i++) {
        var k = passiveKeys[i];
        var share = passiveTotal > 0 ? gtoFreqs[k] / passiveTotal : 1 / passiveKeys.length;
        adjusted[k] = gtoFreqs[k] + removedFromAggressive * share;
      }

      return adjusted;
    }

    // Has fold action — tighten calls and raises, redistribute to fold
    var callFactor, raiseFactor;

    if (spotType === 'pushfold') {
      // Push/fold: calling ranges tighten dramatically, push tightens moderately
      callFactor = 1.0 / bf;         // Direct BF adjustment
      raiseFactor = 1.0 / Math.sqrt(bf); // Push = aggressor, less affected
    } else if (spotType === 'preflop_call' || spotType === 'postflop_facing') {
      // Facing a bet: calling is most affected by ICM
      callFactor = 1.0 / bf;
      raiseFactor = 1.0 / (bf * 0.85); // Raising even tighter than calling when facing
    } else {
      // Opening/betting: moderate tightening
      callFactor = 1.0 / Math.pow(bf, 0.7);
      raiseFactor = 1.0 / Math.pow(bf, 0.5);
    }

    var removedMass = 0;

    // Adjust passive actions (call)
    for (var i = 0; i < passiveKeys.length; i++) {
      var k = passiveKeys[i];
      adjusted[k] = gtoFreqs[k] * callFactor;
      removedMass += gtoFreqs[k] - adjusted[k];
    }

    // Adjust aggressive actions (raise, bet, push)
    for (var i = 0; i < aggressiveKeys.length; i++) {
      var k = aggressiveKeys[i];
      adjusted[k] = gtoFreqs[k] * raiseFactor;
      removedMass += gtoFreqs[k] - adjusted[k];
    }

    // Add removed mass to fold
    adjusted[foldKey] = (gtoFreqs[foldKey] || 0) + removedMass;

    // Ensure nothing negative and renormalize
    var total = 0;
    for (var i = 0; i < keys.length; i++) {
      adjusted[keys[i]] = Math.max(0, adjusted[keys[i]] || 0);
      total += adjusted[keys[i]];
    }
    if (total > 0 && Math.abs(total - 1.0) > 0.001) {
      for (var i = 0; i < keys.length; i++) {
        adjusted[keys[i]] /= total;
      }
    }

    return adjusted;
  },

  // -----------------------------------------------------------------------
  // Determine the ICM spot type from scenario context
  // -----------------------------------------------------------------------
  resolveSpotType: function(scenario) {
    if (scenario.type === 'tournament') return 'pushfold';
    if (scenario.type === 'preflop') {
      var ctx = scenario.actionContext || 'rfi';
      if (ctx === 'rfi') return 'preflop_rfi';
      if (ctx === 'vs_raise') return 'preflop_call';
      if (ctx === 'vs_3bet') return 'preflop_call';
      if (ctx === 'vs_4bet') return 'preflop_call';
      return 'preflop_rfi';
    }
    if (scenario.type === 'postflop') {
      var spot = scenario.spotType || '';
      if (spot.indexOf('facing') >= 0) return 'postflop_facing';
      return 'postflop_bet';
    }
    return 'preflop_rfi';
  },

  // -----------------------------------------------------------------------
  // Utility: get pressure label from score
  // -----------------------------------------------------------------------
  pressureLabel: function(score) {
    if (score >= 70) return 'EXTREME';
    if (score >= 50) return 'HIGH';
    if (score >= 30) return 'MODERATE';
    if (score >= 10) return 'LOW';
    return 'MINIMAL';
  },

  // -----------------------------------------------------------------------
  // Utility: get pressure color class
  // -----------------------------------------------------------------------
  pressureColor: function(score) {
    if (score >= 70) return 'pressure-extreme';
    if (score >= 50) return 'pressure-high';
    if (score >= 30) return 'pressure-moderate';
    return 'pressure-low';
  }
};
