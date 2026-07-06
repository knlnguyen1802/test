window.GTO = window.GTO || {};
GTO.Engine = GTO.Engine || {};

GTO.Engine.PostflopDrill = {
  // Return available actions — prefer solver actions when available
  getAvailableActions: function(spotType, scenario) {
    // If scenario has solver actions from the scenario generator, use those
    if (scenario && scenario.solverActions && scenario.solverActions.length > 0) {
      return scenario.solverActions.map(function(a) { return a.key; });
    }

    // Fallback: static action set based on spot type
    if (GTO.Data.isFacingBetSpot && GTO.Data.isFacingBetSpot(spotType)) {
      return ['fold', 'call', 'raise'];
    }
    return ['check', 'bet_33', 'bet_67', 'bet_100'];
  },

  // Return action labels — prefer solver labels when available
  getActionLabels: function(spotType, scenario) {
    if (scenario && scenario.solverActions && scenario.solverActions.length > 0) {
      var labels = {};
      scenario.solverActions.forEach(function(a) {
        labels[a.key] = a.label;
      });
      return labels;
    }

    // Fallback: static labels
    if (GTO.Data.isFacingBetSpot && GTO.Data.isFacingBetSpot(spotType)) {
      return { fold: 'Fold', call: 'Call', raise: 'Raise' };
    }
    return { check: 'Check', bet_33: 'Bet 1/3', bet_67: 'Bet 2/3', bet_100: 'Bet Pot' };
  },

  // Return action hints (keyboard shortcut labels) from solver actions
  getActionHints: function(spotType, scenario) {
    if (scenario && scenario.solverActions && scenario.solverActions.length > 0) {
      var hints = {};
      scenario.solverActions.forEach(function(a) {
        hints[a.key] = a.hint;
      });
      return hints;
    }

    // Fallback: static hints
    if (GTO.Data.isFacingBetSpot && GTO.Data.isFacingBetSpot(spotType)) {
      return { fold: 'F', call: 'C', raise: 'R' };
    }
    return { check: 'X', bet_33: '1', bet_67: '2', bet_100: '3' };
  }
};
