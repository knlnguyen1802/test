window.GTO = window.GTO || {};
GTO.Engine = GTO.Engine || {};

GTO.Engine.PreflopDrill = {
  getAvailableActions: function(actionContext) {
    if (actionContext === 'rfi') return ['fold', 'raise'];
    return ['fold', 'call', 'raise'];
  },

  getActionLabels: function(actionContext) {
    if (actionContext === 'rfi') return { fold: 'Fold', raise: 'Open Raise' };
    if (actionContext === 'vs_raise') return { fold: 'Fold', call: 'Call', raise: '3-Bet' };
    if (actionContext === 'vs_3bet') return { fold: 'Fold', call: 'Call', raise: '4-Bet' };
    if (actionContext === 'vs_4bet') return { fold: 'Fold', call: 'Call', raise: '5-Bet' };
    return { fold: 'Fold', call: 'Call', raise: 'Raise' };
  },

  getRangeForScenario: function(scenario) {
    var rangeData = {};
    var posKey = scenario.positionKey || scenario.position;
    GTO.Data.ALL_HANDS.forEach(function(hand) {
      var freqs = GTO.Data.lookupPreflop(
        scenario.format, scenario.stackDepth,
        scenario.actionContext, posKey, hand
      );
      rangeData[hand] = freqs || { fold: 1, call: 0, raise: 0 };
    });
    return rangeData;
  }
};
