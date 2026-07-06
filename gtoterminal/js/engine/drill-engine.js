window.GTO = window.GTO || {};
GTO.Engine = GTO.Engine || {};

GTO.Engine.DrillEngine = {
  _session: null,
  _currentScenario: null,
  _drillIndex: 0,
  _onScenario: null,
  _onResult: null,
  _onSessionEnd: null,

  startSession: function(config, callbacks) {
    this._session = {
      id: GTO.Utils.uid(),
      type: config.drillType,
      format: config.format || 'cash',
      config: config,
      startTime: Date.now(),
      decisions: [],
      targetCount: config.count || 50,
      correct: 0,
      totalEvLoss: 0
    };
    this._drillIndex = 0;
    this._onScenario = callbacks.onScenario;
    this._onResult = callbacks.onResult;
    this._onSessionEnd = callbacks.onSessionEnd;

    GTO.State.set('session', this._session);
    this.nextDrill();
  },

  nextDrill: function() {
    if (!this._session) return;
    if (this._drillIndex >= this._session.targetCount && this._session.targetCount > 0) {
      this.endSession();
      return;
    }

    this._drillIndex++;
    var config = this._session.config;
    var scenario;

    if (this._session.type === 'preflop') {
      scenario = GTO.Engine.ScenarioGenerator.preflop(config);
    } else if (this._session.type === 'postflop') {
      scenario = GTO.Engine.ScenarioGenerator.postflop(config);
    } else if (this._session.type === 'tournament') {
      scenario = GTO.Engine.ScenarioGenerator.tournament(config);
    }

    this._currentScenario = scenario;
    GTO.State.set('currentDrill', { scenario: scenario, index: this._drillIndex });

    if (this._onScenario) this._onScenario(scenario, this._drillIndex);
  },

  submitAnswer: function(userAction) {
    if (!this._currentScenario) return null;

    var scenario = this._currentScenario;
    var result;

    if (scenario.type === 'preflop') {
      var gtoFreqs = GTO.Data.lookupPreflop(
        scenario.format, scenario.stackDepth,
        scenario.actionContext, scenario.positionKey || scenario.position,
        scenario.hand
      );

      // ICM adjustment: score against adjusted frequencies when MTT + ICM enabled
      var icmEnabled = scenario.format === 'mtt' && scenario.icmContext &&
        GTO.Engine.ICM && GTO.State.get('icmEnabled') !== false;
      var scoringFreqs = gtoFreqs;
      if (icmEnabled && gtoFreqs && scenario.icmContext.bubbleFactor > 1.0) {
        var spotType = GTO.Engine.ICM.resolveSpotType(scenario);
        scoringFreqs = GTO.Engine.ICM.adjustFrequencies(gtoFreqs, scenario.icmContext.bubbleFactor, spotType);
      }

      result = GTO.Engine.Scoring.scorePreflop(scoringFreqs, userAction, { potSize: 2.5 });
      if (icmEnabled) {
        result.rawGtoFreqs = gtoFreqs;
        GTO.Engine.Scoring.scoreWithICM(result, scenario.icmContext, 0.5);
      }
    } else if (scenario.type === 'postflop') {
      var spr = scenario.effectiveStack && scenario.potSize ? scenario.effectiveStack / scenario.potSize : null;
      var lookupResult = GTO.Engine.PostflopLookup ? GTO.Engine.PostflopLookup.lookup({
        spotType: scenario.spotType,
        boardTexture: scenario.boardTexture,
        handStrength: scenario.handStrength,
        spr: spr,
        boardCards: scenario.boardCards,
        matchup: scenario.matchup || null,
        depth: scenario.depth || null
      }) : { freqs: null, source: 'heuristic' };
      var gtoFreqs = lookupResult.freqs;

      // ICM adjustment for MTT postflop
      var icmEnabled = scenario.format === 'mtt' && scenario.icmContext &&
        GTO.Engine.ICM && GTO.State.get('icmEnabled') !== false;
      var scoringFreqs = gtoFreqs;
      if (icmEnabled && gtoFreqs && scenario.icmContext.bubbleFactor > 1.0) {
        var spotType = GTO.Engine.ICM.resolveSpotType(scenario);
        scoringFreqs = GTO.Engine.ICM.adjustFrequencies(gtoFreqs, scenario.icmContext.bubbleFactor, spotType);
      }

      // Range composition adjustment — nudge frequencies based on preflop sub-range
      if (scoringFreqs && scenario.preflopContext && scenario.preflopAction &&
          GTO.Engine.RangeFilter && GTO.Engine.RangeFilter.adjustForComposition) {
        var isIP = scenario.heroPosition === 'BTN' || scenario.heroPosition === 'CO';
        var side = isIP ? 'ip' : 'oop';
        var heroCtx = scenario.preflopContext[side + 'Context'];
        var heroPos = scenario.preflopContext[side + 'Position'];
        var heroRange = GTO.Engine.RangeFilter.buildActionRange(
          scenario.format || 'cash', scenario.depth || '100bb', heroCtx, heroPos, scenario.preflopAction
        );
        var boardObjs = (scenario.boardCards || []).map(function(c) {
          return typeof c === 'string' ? { rank: c[0], suit: c[1] } : c;
        });
        var comp = GTO.Engine.RangeFilter.analyzeComposition(heroRange, boardObjs);
        if (comp.total > 0) {
          scoringFreqs = GTO.Engine.RangeFilter.adjustForComposition(scoringFreqs, comp, scenario.spotType);
        }
      }

      result = GTO.Engine.Scoring.scorePostflop(scoringFreqs, userAction, { potSize: scenario.potSize || 6.5 });
      result.dataSource = lookupResult.source;
      if (icmEnabled) {
        result.rawGtoFreqs = gtoFreqs;
        GTO.Engine.Scoring.scoreWithICM(result, scenario.icmContext, 0.5);
      }
    } else if (scenario.type === 'tournament') {
      var numPlayers = scenario.payoutStructure ? scenario.payoutStructure.players : 6;
      var lookup = GTO.Data.lookupPushFold(numPlayers, scenario.position, scenario.stackBB, scenario.hand);
      result = GTO.Engine.Scoring.scorePushFold(lookup.inRange, userAction, { stackBB: scenario.stackBB });

      // Overlay ICM metrics if tournament context is available
      if (GTO.Engine.TournamentDrill && scenario.tableStacks) {
        var icmCtx = GTO.Engine.TournamentDrill.getICMContext(scenario);
        if (icmCtx) {
          GTO.Engine.Scoring.scoreWithICM(result, icmCtx, 0.5);
        }
      }
    }

    // Record decision
    var decision = {
      timestamp: Date.now(),
      scenario: {
        type: scenario.type,
        hand: scenario.hand,
        position: scenario.position,
        stackDepth: scenario.stackDepth || scenario.stackBB,
        actionContext: scenario.actionContext || scenario.spotType,
        format: scenario.format
      },
      userAction: userAction,
      result: result,
      drillIndex: this._drillIndex
    };

    this._session.decisions.push(decision);
    if (result.isOptimal) this._session.correct++;
    this._session.totalEvLoss += (result.evLoss || 0);

    // Sound feedback
    if (GTO.UI.Sounds) GTO.UI.Sounds.play(result.isOptimal ? 'correct' : 'incorrect');

    // Track in analytics
    if (GTO.Analytics && GTO.Analytics.Tracker) {
      GTO.Analytics.Tracker.record(decision);
    }

    GTO.State.set('session', this._session);

    if (this._onResult) this._onResult(result, scenario, decision);

    return result;
  },

  endSession: function() {
    if (!this._session) return;
    if (GTO.UI.Sounds) GTO.UI.Sounds.play('complete');
    this._session.endTime = Date.now();
    this._session.totalDrills = this._session.decisions.length;
    this._session.accuracy = this._session.totalDrills > 0 ? this._session.correct / this._session.totalDrills : 0;

    // Save to history
    // Compress decisions for storage (keep essential info)
    var compactDecisions = this._session.decisions.map(function(d) {
      return {
        hand: d.scenario.hand,
        position: d.scenario.position,
        context: d.scenario.actionContext || d.scenario.type,
        userAction: d.userAction,
        bestAction: d.result.bestAction || d.result.correctAction,
        verdict: d.result.verdict,
        evLoss: d.result.evLoss || 0
      };
    });

    var summary = {
      id: this._session.id,
      type: this._session.type,
      format: this._session.format,
      date: this._session.startTime,
      endDate: this._session.endTime,
      totalDrills: this._session.totalDrills,
      accuracy: this._session.accuracy,
      totalEvLoss: this._session.totalEvLoss,
      config: this._session.config,
      decisions: compactDecisions
    };

    var history = GTO.State.get('history') || [];
    history.unshift(summary);
    if (history.length > 200) history = history.slice(0, 200);
    GTO.State.set('history', history);

    if (this._onSessionEnd) this._onSessionEnd(this._session);

    GTO.State.set('session', null);
    GTO.State.set('currentDrill', null);
    this._session = null;
    this._currentScenario = null;
  },

  getSession: function() { return this._session; },
  getCurrentScenario: function() { return this._currentScenario; },
  getProgress: function() {
    if (!this._session) return { current: 0, total: 0, accuracy: 0, evLoss: 0 };
    var total = this._session.decisions.length;
    return {
      current: total,
      total: this._session.targetCount,
      accuracy: total > 0 ? this._session.correct / total : 0,
      evLoss: this._session.totalEvLoss
    };
  },

  isActive: function() { return this._session !== null; }
};
