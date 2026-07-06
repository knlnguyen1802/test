window.GTO = window.GTO || {};
GTO.Analytics = GTO.Analytics || {};

GTO.Analytics.Aggregator = {
  getAccuracyByPosition: function() {
    var data = GTO.State.get('analytics.byPosition') || {};
    var result = [];
    GTO.Data.POSITIONS.forEach(function(pos) {
      var d = data[pos] || { total: 0, correct: 0, evLoss: 0 };
      result.push({
        position: pos,
        total: d.total,
        accuracy: d.total > 0 ? d.correct / d.total : 0,
        evLoss: d.evLoss
      });
    });
    return result;
  },

  getAccuracyByStackDepth: function() {
    var data = GTO.State.get('analytics.byStackDepth') || {};
    var result = [];
    Object.keys(data).forEach(function(depth) {
      var d = data[depth];
      result.push({
        stackDepth: depth,
        total: d.total,
        accuracy: d.total > 0 ? d.correct / d.total : 0,
        evLoss: d.evLoss
      });
    });
    return result.sort(function(a,b) { return parseInt(b.stackDepth) - parseInt(a.stackDepth); });
  },

  getAccuracyBySpotType: function() {
    var data = GTO.State.get('analytics.bySpotType') || {};
    var result = [];
    Object.keys(data).forEach(function(spot) {
      var d = data[spot];
      result.push({
        spotType: spot,
        total: d.total,
        accuracy: d.total > 0 ? d.correct / d.total : 0,
        evLoss: d.evLoss
      });
    });
    return result.sort(function(a,b) { return a.accuracy - b.accuracy; }); // worst first
  },

  getOverallAccuracy: function() {
    var o = GTO.State.get('analytics.overall') || { total: 0, correct: 0 };
    return o.total > 0 ? o.correct / o.total : 0;
  },

  getSessionHistory: function(limit) {
    var history = GTO.State.get('history') || [];
    return history.slice(0, limit || 20);
  }
};
