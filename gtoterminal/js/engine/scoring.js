window.GTO = window.GTO || {};
GTO.Engine = GTO.Engine || {};

GTO.Engine.Scoring = {
  // Score a preflop decision
  // gtoFreqs: { fold: 0.5, call: 0.3, raise: 0.2 }
  // userAction: 'fold' | 'call' | 'raise'
  // context: { potSize } (optional, defaults to 2.5bb for open raise)
  scorePreflop: function(gtoFreqs, userAction, context) {
    if (!gtoFreqs) {
      gtoFreqs = { fold: 0.5, call: 0.25, raise: 0.25 };
    }

    var potSize = (context && context.potSize) || 2.5;
    var userFreq = gtoFreqs[userAction] || 0;

    // Find the highest frequency action
    var actions = ['fold','call','raise'];
    var bestAction = actions[0];
    var bestFreq = 0;
    actions.forEach(function(a) {
      if ((gtoFreqs[a] || 0) > bestFreq) { bestFreq = gtoFreqs[a] || 0; bestAction = a; }
    });

    var isOptimal = userAction === bestAction;
    var isPure = bestFreq >= 0.95;

    // Pot-relative EV loss in bb
    // Formula: -potSize * (bestFreq - userFreq) * scaleFactor
    // scaleFactor increases penalty for larger frequency gaps
    var evLoss = 0;
    if (!isOptimal) {
      var freqGap = bestFreq - userFreq;
      var scaleFactor;
      if (userFreq >= 0.3) {
        scaleFactor = 0.15; // Acceptable mixed-spot play
      } else if (userFreq >= 0.1) {
        scaleFactor = 0.35; // Suboptimal
      } else if (userFreq > 0) {
        scaleFactor = 0.55; // Bad play, low frequency
      } else {
        scaleFactor = isPure ? 0.85 : 0.65; // Not in the strategy at all
      }
      evLoss = -(potSize * freqGap * scaleFactor);
    }

    // Verdict
    var verdict;
    if (userFreq >= 0.9) verdict = 'optimal';
    else if (userFreq >= 0.3) verdict = 'acceptable';
    else if (userFreq >= 0.1) verdict = 'suboptimal';
    else verdict = 'mistake';

    return {
      verdict: verdict,
      evLoss: evLoss,
      isOptimal: isOptimal,
      userAction: userAction,
      userFreq: userFreq,
      bestAction: bestAction,
      bestFreq: bestFreq,
      gtoFreqs: gtoFreqs,
      isPure: isPure
    };
  },

  // Score a postflop decision
  // context: { potSize } (optional, defaults to 6.5bb)
  scorePostflop: function(gtoFreqs, userAction, context) {
    if (!gtoFreqs) {
      gtoFreqs = { check: 0.5, bet_33: 0.2, bet_67: 0.2, bet_100: 0.1 };
    }

    var potSize = (context && context.potSize) || 6.5;
    var userFreq = gtoFreqs[userAction] || 0;
    var actions = Object.keys(gtoFreqs);
    var bestAction = actions[0];
    var bestFreq = 0;
    actions.forEach(function(a) {
      if (gtoFreqs[a] > bestFreq) { bestFreq = gtoFreqs[a]; bestAction = a; }
    });

    var isOptimal = userAction === bestAction;

    // Pot-relative EV loss in bb
    var evLoss = 0;
    if (!isOptimal) {
      var freqGap = bestFreq - userFreq;
      var scaleFactor;
      if (userFreq >= 0.25) {
        scaleFactor = 0.15;
      } else if (userFreq >= 0.1) {
        scaleFactor = 0.35;
      } else if (userFreq > 0) {
        scaleFactor = 0.50;
      } else {
        scaleFactor = 0.70;
      }
      evLoss = -(potSize * freqGap * scaleFactor);
    }

    var verdict;
    if (userFreq >= 0.8) verdict = 'optimal';
    else if (userFreq >= 0.25) verdict = 'acceptable';
    else if (userFreq >= 0.1) verdict = 'suboptimal';
    else verdict = 'mistake';

    return {
      verdict: verdict, evLoss: evLoss, isOptimal: isOptimal,
      userAction: userAction, userFreq: userFreq,
      bestAction: bestAction, bestFreq: bestFreq,
      gtoFreqs: gtoFreqs
    };
  },

  // Score push/fold decision
  // context: { stackBB } (optional, scales EV loss by stack size)
  scorePushFold: function(shouldPush, userAction, context) {
    var correct = (shouldPush && userAction === 'push') || (!shouldPush && userAction === 'fold');
    var stackBB = (context && context.stackBB) || 10;

    // EV loss scales with stack — wrong shove at 20bb is worse than at 5bb
    // But also, marginal spots at low stacks are less costly
    var evLoss = 0;
    if (!correct) {
      evLoss = -(0.5 * stackBB / 10); // ~0.5bb at 10bb, ~1.0bb at 20bb, ~0.25bb at 5bb
    }

    return {
      verdict: correct ? 'optimal' : 'mistake',
      evLoss: evLoss,
      isOptimal: correct,
      userAction: userAction,
      correctAction: shouldPush ? 'push' : 'fold'
    };
  },

  // Get verdict CSS class
  getVerdictClass: function(verdict) {
    var classes = { optimal: 'verdict-optimal', acceptable: 'verdict-acceptable', suboptimal: 'verdict-mistake', mistake: 'verdict-mistake', unknown: '' };
    return classes[verdict] || '';
  },

  // Get verdict icon
  getVerdictIcon: function(verdict) {
    var icons = { optimal: '+', acceptable: '~', suboptimal: '-', mistake: 'X', unknown: '?' };
    return icons[verdict] || '?';
  },

  // Get verdict label
  getVerdictLabel: function(verdict) {
    var labels = { optimal: 'OPTIMAL', acceptable: 'ACCEPTABLE', suboptimal: 'SUBOPTIMAL', mistake: 'MISTAKE', unknown: 'UNKNOWN' };
    return labels[verdict] || 'UNKNOWN';
  },

  // -----------------------------------------------------------------------
  // Overlay ICM metrics onto an existing scoring result
  // @param {Object} baseResult - from scorePreflop/scorePostflop/scorePushFold
  // @param {Object} icmContext - from TournamentDrill.getICMContext()
  // @param {number} winProb - estimated win probability (0-1, default 0.5)
  // @returns {Object} baseResult with added ICM fields
  // -----------------------------------------------------------------------
  scoreWithICM: function(baseResult, icmContext, winProb) {
    if (!baseResult || !icmContext || !GTO.Engine.ICM) return baseResult;

    winProb = winProb || 0.5;
    var stacks = icmContext.stacks;
    var heroIdx = icmContext.heroIdx;
    var prizes = icmContext.prizes;
    var potSize = icmContext.potSize;

    // Build win/lose stack scenarios
    var winStacks = stacks.slice();
    winStacks[heroIdx] += potSize;
    var loseStacks = stacks.slice();
    loseStacks[heroIdx] = Math.max(0, stacks[heroIdx] - potSize);

    var comparison = GTO.Engine.ICM.compareOutcomes(heroIdx, stacks, winStacks, loseStacks, winProb, prizes);

    // Add ICM fields to result
    baseResult.chipEV = baseResult.evLoss || 0;
    baseResult.icmEV = comparison.dollarEV;
    baseResult.icmTax = comparison.icmTax;
    baseResult.bubbleFactor = icmContext.bubbleFactor;
    baseResult.icmPressure = icmContext.icmPressure;
    baseResult.pressureLabel = icmContext.pressureLabel;
    baseResult.pressureColor = icmContext.pressureColor;
    baseResult.heroEquity = icmContext.heroEquity;
    baseResult.prizePool = icmContext.prizePool;
    baseResult.hasICM = true;

    return baseResult;
  }
};
