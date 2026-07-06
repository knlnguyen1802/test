window.GTO = window.GTO || {};
GTO.Training = GTO.Training || {};

GTO.Training.PlanEngine = {
  createPlan: function(templateId, config) {
    var template = GTO.Training.PlanTemplates.find(function(t) { return t.id === templateId; });
    if (!template) return null;

    var plan = {
      id: GTO.Utils.uid(),
      templateId: templateId,
      name: config.name || template.name,
      targetEvent: config.targetEvent || null,
      format: config.format || template.format,
      created: Date.now(),
      sessionsPerWeek: template.sessionsPerWeek,
      focusAreas: template.focusAreas,
      sessions: [],
      currentDay: 0,
      completedSessions: 0,
      totalSessions: 0
    };

    // Generate sessions
    if (templateId === 'leak_plugger') {
      plan.sessions = this._generateLeakPluggerSessions();
    } else {
      var weeks = config.weeks || 4;
      for (var w = 0; w < weeks; w++) {
        template.sessions.forEach(function(s, i) {
          plan.sessions.push({
            day: w * 7 + s.day,
            status: 'pending',
            drills: JSON.parse(JSON.stringify(s.drills)),
            completedDrills: 0
          });
        });
      }
    }
    plan.totalSessions = plan.sessions.length;

    // Save
    var plans = GTO.State.get('trainingPlans') || [];
    plans.push(plan);
    GTO.State.set('trainingPlans', plans);
    GTO.State.set('activePlan', plan.id);

    return plan;
  },

  _generateLeakPluggerSessions: function() {
    var weaknesses = GTO.Training.WeaknessAnalyzer.getTopWeaknesses(5);
    var sessions = [];

    for (var day = 1; day <= 5; day++) {
      var drills = [];
      weaknesses.forEach(function(w) {
        drills.push({
          type: w.dimension === 'position' ? 'preflop' : 'postflop',
          subtype: w.key,
          count: 20
        });
      });
      if (drills.length === 0) drills.push({ type: 'preflop', subtype: 'rfi', count: 30 });
      sessions.push({ day: day, status: 'pending', drills: drills, completedDrills: 0 });
    }
    return sessions;
  },

  getActivePlan: function() {
    var planId = GTO.State.get('activePlan');
    if (!planId) return null;
    var plans = GTO.State.get('trainingPlans') || [];
    return plans.find(function(p) { return p.id === planId; }) || null;
  },

  getTodaysDrills: function() {
    var plan = this.getActivePlan();
    if (!plan) return [];
    var nextSession = plan.sessions.find(function(s) { return s.status === 'pending'; });
    return nextSession ? nextSession.drills : [];
  },

  completeSession: function(sessionIndex) {
    var plan = this.getActivePlan();
    if (!plan || !plan.sessions[sessionIndex]) return;
    plan.sessions[sessionIndex].status = 'completed';
    plan.completedSessions++;
    this._savePlan(plan);
  },

  getProgress: function() {
    var plan = this.getActivePlan();
    if (!plan) return { percent: 0, completed: 0, total: 0 };
    return {
      percent: plan.totalSessions > 0 ? plan.completedSessions / plan.totalSessions : 0,
      completed: plan.completedSessions,
      total: plan.totalSessions
    };
  },

  _savePlan: function(plan) {
    var plans = GTO.State.get('trainingPlans') || [];
    var idx = plans.findIndex(function(p) { return p.id === plan.id; });
    if (idx >= 0) plans[idx] = plan;
    GTO.State.set('trainingPlans', plans);
  },

  deletePlan: function(planId) {
    var plans = GTO.State.get('trainingPlans') || [];
    plans = plans.filter(function(p) { return p.id !== planId; });
    GTO.State.set('trainingPlans', plans);
    if (GTO.State.get('activePlan') === planId) GTO.State.set('activePlan', null);
  }
};
