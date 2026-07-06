window.GTO = window.GTO || {};
GTO.Analytics = GTO.Analytics || {};

GTO.Analytics.Tracker = {
  record: function(decision) {
    var analytics = GTO.State.get('analytics') || { byPosition: {}, byStackDepth: {}, bySpotType: {}, byActionContext: {}, overall: { total: 0, correct: 0, evLoss: 0 } };
    var s = decision.scenario;
    var r = decision.result;

    // Update overall
    analytics.overall.total++;
    if (r.isOptimal) analytics.overall.correct++;
    analytics.overall.evLoss += (r.evLoss || 0);

    // Update by position
    var pos = s.position;
    if (!analytics.byPosition[pos]) analytics.byPosition[pos] = { total: 0, correct: 0, evLoss: 0 };
    analytics.byPosition[pos].total++;
    if (r.isOptimal) analytics.byPosition[pos].correct++;
    analytics.byPosition[pos].evLoss += (r.evLoss || 0);

    // Update by stack depth
    var depth = String(s.stackDepth || 'unknown');
    if (!analytics.byStackDepth[depth]) analytics.byStackDepth[depth] = { total: 0, correct: 0, evLoss: 0 };
    analytics.byStackDepth[depth].total++;
    if (r.isOptimal) analytics.byStackDepth[depth].correct++;
    analytics.byStackDepth[depth].evLoss += (r.evLoss || 0);

    // Update by spot type / action context
    var ctx = s.actionContext || s.type;
    if (!analytics.bySpotType[ctx]) analytics.bySpotType[ctx] = { total: 0, correct: 0, evLoss: 0 };
    analytics.bySpotType[ctx].total++;
    if (r.isOptimal) analytics.bySpotType[ctx].correct++;
    analytics.bySpotType[ctx].evLoss += (r.evLoss || 0);

    GTO.State.set('analytics', analytics);
  },

  getOverall: function() {
    var a = GTO.State.get('analytics');
    return a ? a.overall : { total: 0, correct: 0, evLoss: 0 };
  },

  reset: function() {
    GTO.State.set('analytics', { byPosition: {}, byStackDepth: {}, bySpotType: {}, byActionContext: {}, overall: { total: 0, correct: 0, evLoss: 0 } });
  }
};
