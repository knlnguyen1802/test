window.GTO = window.GTO || {};
GTO.Training = GTO.Training || {};

GTO.Training.WeaknessAnalyzer = {
  analyze: function() {
    var analytics = GTO.State.get('analytics') || {};
    var weaknesses = [];

    // Analyze by position
    var byPos = analytics.byPosition || {};
    Object.keys(byPos).forEach(function(pos) {
      var d = byPos[pos];
      if (d.total >= 10) {
        var accuracy = d.correct / d.total;
        var evPerDecision = d.evLoss / d.total;
        weaknesses.push({
          category: pos + ' overall',
          dimension: 'position',
          key: pos,
          accuracy: accuracy,
          evLoss: d.evLoss,
          evPerDecision: evPerDecision,
          volume: d.total,
          impact: d.total * Math.abs(evPerDecision),
          priority: accuracy < 0.6 ? 'critical' : (accuracy < 0.7 ? 'high' : (accuracy < 0.8 ? 'medium' : 'low'))
        });
      }
    });

    // Analyze by spot type
    var bySpot = analytics.bySpotType || {};
    Object.keys(bySpot).forEach(function(spot) {
      var d = bySpot[spot];
      if (d.total >= 10) {
        var accuracy = d.correct / d.total;
        var evPerDecision = d.evLoss / d.total;
        weaknesses.push({
          category: spot,
          dimension: 'spotType',
          key: spot,
          accuracy: accuracy,
          evLoss: d.evLoss,
          evPerDecision: evPerDecision,
          volume: d.total,
          impact: d.total * Math.abs(evPerDecision),
          priority: accuracy < 0.6 ? 'critical' : (accuracy < 0.7 ? 'high' : (accuracy < 0.8 ? 'medium' : 'low'))
        });
      }
    });

    // Sort by impact (highest first)
    weaknesses.sort(function(a, b) { return b.impact - a.impact; });

    return weaknesses.slice(0, 10);
  },

  getTopWeaknesses: function(n) {
    return this.analyze().filter(function(w) { return w.priority !== 'low'; }).slice(0, n || 5);
  },

  suggestFocusAreas: function() {
    var weaknesses = this.getTopWeaknesses(3);
    var areas = [];
    weaknesses.forEach(function(w) {
      if (w.dimension === 'position') areas.push({ type: 'preflop', filter: { positions: [w.key] } });
      else if (w.dimension === 'spotType') areas.push({ type: w.key.indexOf('preflop') >= 0 ? 'preflop' : 'postflop', filter: { spotTypes: [w.key] } });
    });
    return areas;
  }
};
