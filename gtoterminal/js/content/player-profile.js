window.GTO = window.GTO || {};
GTO.Content = GTO.Content || {};

GTO.Content.PlayerProfile = {
  SKILL_LEVELS: [
    { label: 'Novice',        min: 0,  max: 25, color: '#555' },
    { label: 'Beginner',      min: 25, max: 50, color: '#ff433d' },
    { label: 'Intermediate',  min: 50, max: 70, color: '#ff8c00' },
    { label: 'Advanced',      min: 70, max: 85, color: '#0068ff' },
    { label: 'Expert',        min: 85, max: 100, color: '#4af6c3' }
  ],

  ACHIEVEMENTS: [
    { id: 'first_100',    label: 'Century',        desc: '100 decisions',     threshold: 100,  metric: 'totalDecisions' },
    { id: 'first_500',    label: 'Grinder',        desc: '500 decisions',     threshold: 500,  metric: 'totalDecisions' },
    { id: 'first_1000',   label: 'Veteran',        desc: '1,000 decisions',   threshold: 1000, metric: 'totalDecisions' },
    { id: 'first_5000',   label: 'Elite',          desc: '5,000 decisions',   threshold: 5000, metric: 'totalDecisions' },
    { id: 'acc_70',       label: 'Solid',          desc: '70%+ accuracy',     threshold: 0.70, metric: 'accuracy' },
    { id: 'acc_80',       label: 'Sharp',          desc: '80%+ accuracy',     threshold: 0.80, metric: 'accuracy' },
    { id: 'acc_90',       label: 'Crusher',        desc: '90%+ accuracy',     threshold: 0.90, metric: 'accuracy' },
    { id: 'sessions_10',  label: 'Regular',        desc: '10 sessions',       threshold: 10,   metric: 'sessions' },
    { id: 'sessions_50',  label: 'Dedicated',      desc: '50 sessions',       threshold: 50,   metric: 'sessions' },
    { id: 'reader_5',     label: 'Student',        desc: '5 articles read',   threshold: 5,    metric: 'articlesRead' },
    { id: 'reader_15',    label: 'Scholar',        desc: '15 articles read',  threshold: 15,   metric: 'articlesRead' }
  ],

  compute: function() {
    var analytics = GTO.State.get('analytics') || {};
    var overall = analytics.overall || { total: 0, correct: 0, evLoss: 0 };
    var history = GTO.State.get('history') || [];
    var byPosition = analytics.byPosition || {};

    var totalDecisions = overall.total;
    var overallAccuracy = totalDecisions > 0 ? overall.correct / totalDecisions : 0;
    var totalEvLoss = overall.evLoss || 0;
    var sessionsCompleted = history.length;

    // Favorite position (most decisions)
    var favoritePosition = '--';
    var maxPosDecisions = 0;
    Object.keys(byPosition).forEach(function(pos) {
      if (byPosition[pos].total > maxPosDecisions) {
        maxPosDecisions = byPosition[pos].total;
        favoritePosition = pos;
      }
    });

    // Skill rating
    var skillScore = this._computeSkillScore(overallAccuracy, totalDecisions, totalEvLoss);
    var skillLevel = this._getSkillLevel(skillScore, totalDecisions);

    // Strengths (areas with accuracy > 75% and volume > 15)
    var strengths = this._computeStrengths(analytics);

    // Weaknesses
    var weaknesses = [];
    if (GTO.Training && GTO.Training.WeaknessAnalyzer) {
      weaknesses = GTO.Training.WeaknessAnalyzer.getTopWeaknesses(5);
    }

    // Achievements
    var articlesRead = GTO.Content.Engine ? GTO.Content.Engine.getReadCount() : 0;
    var achievements = this._computeAchievements(totalDecisions, overallAccuracy, sessionsCompleted, articlesRead);

    // Recommended content
    var recommendedContent = [];
    if (GTO.Content.Engine) {
      recommendedContent = GTO.Content.Engine.getRecommendedTopics(3);
    }

    return {
      skillRating: skillLevel,
      totalDecisions: totalDecisions,
      overallAccuracy: overallAccuracy,
      totalEvLoss: totalEvLoss,
      sessionsCompleted: sessionsCompleted,
      favoritePosition: favoritePosition,
      strengths: strengths,
      weaknesses: weaknesses,
      achievements: achievements,
      recommendedContent: recommendedContent
    };
  },

  _computeSkillScore: function(accuracy, volume, evLoss) {
    // Volume factor: log scale, caps around 1000 decisions
    var volumeFactor = volume > 0 ? Math.min(Math.log10(volume) / 3, 1) : 0;

    // EV efficiency: lower EV loss per decision = better
    var evPerDecision = volume > 0 ? Math.abs(evLoss) / volume : 5;
    var evEfficiency = Math.max(0, 1 - (evPerDecision / 3)); // 0bb/decision = perfect, 3bb+ = 0

    var score = (accuracy * 0.5 + volumeFactor * 0.2 + evEfficiency * 0.3) * 100;
    return Math.round(Math.min(100, Math.max(0, score)));
  },

  _getSkillLevel: function(score, totalDecisions) {
    // Need minimum 50 decisions to move past Novice
    if (totalDecisions < 50) {
      return { level: 'Novice', tier: 0, score: score, color: this.SKILL_LEVELS[0].color };
    }

    for (var i = this.SKILL_LEVELS.length - 1; i >= 0; i--) {
      if (score >= this.SKILL_LEVELS[i].min) {
        return {
          level: this.SKILL_LEVELS[i].label,
          tier: i,
          score: score,
          color: this.SKILL_LEVELS[i].color
        };
      }
    }
    return { level: 'Novice', tier: 0, score: score, color: this.SKILL_LEVELS[0].color };
  },

  _computeStrengths: function(analytics) {
    var strengths = [];
    var byPosition = analytics.byPosition || {};
    var bySpotType = analytics.bySpotType || {};

    // Check positions
    Object.keys(byPosition).forEach(function(pos) {
      var d = byPosition[pos];
      if (d.total >= 15) {
        var acc = d.correct / d.total;
        if (acc >= 0.75) {
          strengths.push({
            label: pos + ' play',
            accuracy: acc,
            volume: d.total,
            score: acc * Math.min(d.total, 100)
          });
        }
      }
    });

    // Check spot types
    Object.keys(bySpotType).forEach(function(spot) {
      var d = bySpotType[spot];
      if (d.total >= 15) {
        var acc = d.correct / d.total;
        if (acc >= 0.75) {
          var spotLabel = spot;
          if (GTO.Data.PostflopSpotLabels && GTO.Data.PostflopSpotLabels[spot]) {
            spotLabel = GTO.Data.PostflopSpotLabels[spot];
          }
          strengths.push({
            label: spotLabel,
            accuracy: acc,
            volume: d.total,
            score: acc * Math.min(d.total, 100)
          });
        }
      }
    });

    // Sort by score and return top 3
    strengths.sort(function(a, b) { return b.score - a.score; });
    return strengths.slice(0, 3);
  },

  _computeAchievements: function(totalDecisions, accuracy, sessions, articlesRead) {
    var earned = [];
    var self = this;

    this.ACHIEVEMENTS.forEach(function(ach) {
      var value;
      if (ach.metric === 'totalDecisions') value = totalDecisions;
      else if (ach.metric === 'accuracy') value = accuracy;
      else if (ach.metric === 'sessions') value = sessions;
      else if (ach.metric === 'articlesRead') value = articlesRead;
      else return;

      if (value >= ach.threshold) {
        earned.push({
          id: ach.id,
          label: ach.label,
          desc: ach.desc,
          earned: true
        });
      }
    });

    return earned;
  }
};
