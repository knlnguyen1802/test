window.GTO = window.GTO || {};
GTO.Engine = GTO.Engine || {};

GTO.Engine.ScenarioGenerator = {
  // Generate a preflop scenario
  preflop: function(config) {
    var format = config.format || 'cash';
    var positions = config.positions || GTO.Data.POSITIONS.slice(0, 5); // exclude BB for RFI
    var stackDepths = config.stackDepths || ['100bb'];
    var actionContexts = config.actionContexts || ['rfi'];

    var position = GTO.Utils.randPick(positions);
    var stackDepth = GTO.Utils.randPick(stackDepths);
    var actionContext = GTO.Utils.randPick(actionContexts);

    // For RFI, BB can't open
    if (actionContext === 'rfi' && position === 'BB') {
      position = GTO.Utils.randPick(positions.filter(function(p) { return p !== 'BB'; }));
    }

    // Pick a hand, weighted toward mixed-frequency hands
    var hand = this._pickWeightedHand(format, stackDepth, actionContext, position);

    // Generate villain position for vs_raise contexts
    var villainPosition = null;
    var positionKey = position;

    if (actionContext === 'vs_raise') {
      // Pick a villain who opened from earlier position
      var posIdx = GTO.Data.POSITIONS.indexOf(position);
      var earlierPositions = GTO.Data.POSITIONS.slice(0, posIdx);
      if (earlierPositions.length === 0) earlierPositions = ['UTG'];
      villainPosition = GTO.Utils.randPick(earlierPositions);
      positionKey = villainPosition + '_' + position;
    } else if (actionContext === 'vs_3bet') {
      // Hero opened, villain 3bet from later position
      var posIdx = GTO.Data.POSITIONS.indexOf(position);
      var laterPositions = GTO.Data.POSITIONS.slice(posIdx + 1);
      if (laterPositions.length === 0) laterPositions = ['BB'];
      villainPosition = GTO.Utils.randPick(laterPositions);
      positionKey = position + '_' + villainPosition;
    } else if (actionContext === 'vs_4bet') {
      // Villain opened from earlier position, hero 3bet, villain 4bets
      // Key format: opener_hero (same as vs_raise)
      var posIdx = GTO.Data.POSITIONS.indexOf(position);
      var earlierPositions = GTO.Data.POSITIONS.slice(0, posIdx);
      if (earlierPositions.length === 0) earlierPositions = ['UTG'];
      villainPosition = GTO.Utils.randPick(earlierPositions);
      positionKey = villainPosition + '_' + position;
    }

    var cards = GTO.Engine.Deck.handToCards(hand);

    // Build ICM context for MTT preflop drills
    var icmContext = null;
    if (format === 'mtt' && GTO.Data.TournamentStructures && GTO.Engine.ICM) {
      var structKey = config.structureKey || '9max_sng';
      var structure = GTO.Data.TournamentStructures.get(structKey);
      var stackBBNum = parseInt(stackDepth) || 25;
      var stage = config.stage || GTO.Data.TournamentStructures.randomStage();
      var heroIdx = Math.floor(Math.random() * structure.players);
      var tableStacks = GTO.Data.TournamentStructures.generateTableStacks({
        players: structure.players, heroIdx: heroIdx,
        heroStackBB: stackBBNum, avgStackBB: stackBBNum, stage: stage
      });
      var buyIn = config.buyIn || 100;
      var dollarPrizes = structure.payouts.map(function(p) { return p * buyIn * structure.players; });
      icmContext = {
        heroIdx: heroIdx, stacks: tableStacks, prizes: dollarPrizes,
        prizePool: buyIn * structure.players, potSize: 2.5,
        heroEquity: GTO.Engine.ICM.calculateEquities(tableStacks, dollarPrizes)[heroIdx],
        bubbleFactor: GTO.Engine.ICM.bubbleFactor(heroIdx, tableStacks, dollarPrizes, 2.5),
        icmPressure: GTO.Engine.ICM.pressure(heroIdx, tableStacks, dollarPrizes),
        pressureLabel: GTO.Engine.ICM.pressureLabel(GTO.Engine.ICM.pressure(heroIdx, tableStacks, dollarPrizes)),
        pressureColor: GTO.Engine.ICM.pressureColor(GTO.Engine.ICM.pressure(heroIdx, tableStacks, dollarPrizes))
      };
    }

    return {
      type: 'preflop',
      format: format,
      hand: hand,
      cards: cards,
      position: position,
      stackDepth: stackDepth,
      actionContext: actionContext,
      villainPosition: villainPosition,
      positionKey: positionKey,
      icmContext: icmContext,
      description: this._describePreflopScenario(actionContext, position, villainPosition, stackDepth)
    };
  },

  // Generate a postflop scenario — solver-backed when possible
  postflop: function(config) {
    var format = config.format || 'cash';
    var spotTypes = config.spotTypes || ['IP_cbet_flop'];
    var spotType = GTO.Utils.randPick(spotTypes);
    var isIP = spotType.indexOf('IP_') === 0;
    var isFacing = spotType.indexOf('facing') >= 0;

    // Detect street
    var street;
    if (spotType.indexOf('flop') >= 0 || spotType.indexOf('cbet') >= 0) {
      street = 'flop';
    } else if (spotType.indexOf('turn') >= 0) {
      street = 'turn';
    } else {
      street = 'river';
    }

    // Check if this spot type has solver coverage (all flop spot types)
    var solverSpotTypes = ['OOP_cbet_flop', 'IP_cbet_flop', 'IP_facing_cbet', 'OOP_facing_cbet'];
    var hasSolverCoverage = solverSpotTypes.indexOf(spotType) >= 0 &&
      GTO.Data.PostflopMatchups && GTO.Data.PostflopBoards;

    var matchup = null;
    var matchupKey = null;
    var depth = null;
    var boardCards, texture, hand, cards, potSize, effectiveStack, position, villainPosition;
    var solverActions = null;
    var dataSource = 'heuristic';

    if (hasSolverCoverage) {
      // --- Solver-backed scenario ---
      // Pick matchup from config or random
      var matchupKeys = config.matchups ||
        (GTO.Data.PostflopMatchups ? Object.keys(GTO.Data.PostflopMatchups) : []);
      if (matchupKeys.length === 0) matchupKeys = ['SB_vs_BB'];
      matchupKey = GTO.Utils.randPick(matchupKeys);
      matchup = GTO.Data.PostflopMatchups[matchupKey];

      // Pick depth from config or random
      var depths = config.depths || ['100bb', '40bb', '25bb', '15bb'];
      depth = GTO.Utils.randPick(depths);
      var depthCfg = GTO.Data.PostflopDepths ? GTO.Data.PostflopDepths[depth] : null;

      // Pick a pre-computed board (guaranteed solver hit)
      var boardDef = GTO.Utils.randPick(GTO.Data.PostflopBoards);
      boardCards = boardDef.board.slice();
      texture = boardDef.texture;

      // Derive positions from matchup
      if (matchup) {
        var isOOP = !isIP;
        position = isOOP ? matchup.oop : matchup.ip;
        villainPosition = isOOP ? matchup.ip : matchup.oop;
      } else {
        position = isIP ? GTO.Utils.randPick(['BTN','CO']) : GTO.Utils.randPick(['BB','SB','UTG']);
      }

      // Pick hand from range filtered by preflop action (multi-street consistency)
      var rangeStr = matchup ? (isIP ? matchup.ipRange : matchup.oopRange) : null;
      var preflopCtx = null;
      var preflopAction = null;
      if (rangeStr && GTO.Engine.RangeFilter && matchupKey) {
        preflopCtx = GTO.Engine.RangeFilter.resolveActionContext(matchupKey);
        if (preflopCtx) {
          var heroSide = isIP ? 'ip' : 'oop';
          preflopAction = preflopCtx[heroSide + 'Action'];
          var heroContext = preflopCtx[heroSide + 'Context'];
          var heroPos = preflopCtx[heroSide + 'Position'];
          var actionRange = GTO.Engine.RangeFilter.buildActionRange(
            format, depth || '100bb', heroContext, heroPos, preflopAction
          );
          hand = GTO.Engine.RangeFilter.pickHandFromFilteredRange(rangeStr, actionRange);
        }
      }
      if (!hand && rangeStr) {
        var rangeHands = rangeStr.split(',').map(function(h) { return h.trim(); }).filter(Boolean);
        hand = GTO.Utils.randPick(rangeHands);
      }
      if (!hand) {
        hand = GTO.Utils.randPick(GTO.Data.ALL_HANDS);
      }
      cards = GTO.Engine.Deck.handToCards(hand);

      // Set pot/stack from depth config
      if (depthCfg) {
        potSize = depthCfg.pot || 6.5;
        effectiveStack = depthCfg.stack || 100;
      } else {
        potSize = 6.5;
        effectiveStack = 100;
      }

      // Try to get solver actions for this spot
      var solutions = GTO.Engine.PostflopLookup ? GTO.Engine.PostflopLookup._getSolutions(depth) : null;
      if (solutions && solutions[matchupKey] && solutions[matchupKey][boardDef.label]) {
        var sol = solutions[matchupKey][boardDef.label];
        var nodeData = GTO.Engine.PostflopLookup._getNodeData(sol, spotType);
        if (nodeData && nodeData.actions) {
          solverActions = GTO.Engine.PostflopLookup._parseActionList(nodeData.actions);
          dataSource = 'solver';
        }
      }
    } else {
      // --- Heuristic fallback (turn/river) ---
      texture = GTO.Utils.randPick(GTO.Data.BoardCategories.TEXTURES);
      hand = GTO.Utils.randPick(GTO.Data.ALL_HANDS);
      cards = GTO.Engine.Deck.handToCards(hand);
      var numBoardCards = street === 'flop' ? 3 : (street === 'turn' ? 4 : 5);
      var result = GTO.Engine.Deck.dealBoardWithTexture(texture, cards, numBoardCards);
      boardCards = result.board;
      potSize = street === 'flop' ? 6.5 : (street === 'turn' ? 12 : 24);
      effectiveStack = 45 + Math.floor(Math.random() * 55);
      position = isIP ? GTO.Utils.randPick(['BTN','CO']) : GTO.Utils.randPick(['BB','SB','UTG']);
    }

    var handStrength = GTO.Engine.HandEvaluator.classify(cards, boardCards);
    var spr = effectiveStack / potSize;

    // Build ICM context for MTT postflop drills
    var icmContext = null;
    if (format === 'mtt' && GTO.Data.TournamentStructures && GTO.Engine.ICM) {
      var structKey = config.structureKey || '9max_sng';
      var structure = GTO.Data.TournamentStructures.get(structKey);
      var heroStackBB = effectiveStack || 25;
      var stage = config.stage || GTO.Data.TournamentStructures.randomStage();
      var heroIdx = Math.floor(Math.random() * structure.players);
      var tableStacks = GTO.Data.TournamentStructures.generateTableStacks({
        players: structure.players, heroIdx: heroIdx,
        heroStackBB: heroStackBB, avgStackBB: heroStackBB, stage: stage
      });
      var buyIn = config.buyIn || 100;
      var dollarPrizes = structure.payouts.map(function(p) { return p * buyIn * structure.players; });
      icmContext = {
        heroIdx: heroIdx, stacks: tableStacks, prizes: dollarPrizes,
        prizePool: buyIn * structure.players, potSize: potSize,
        heroEquity: GTO.Engine.ICM.calculateEquities(tableStacks, dollarPrizes)[heroIdx],
        bubbleFactor: GTO.Engine.ICM.bubbleFactor(heroIdx, tableStacks, dollarPrizes, potSize),
        icmPressure: GTO.Engine.ICM.pressure(heroIdx, tableStacks, dollarPrizes),
        pressureLabel: GTO.Engine.ICM.pressureLabel(GTO.Engine.ICM.pressure(heroIdx, tableStacks, dollarPrizes)),
        pressureColor: GTO.Engine.ICM.pressureColor(GTO.Engine.ICM.pressure(heroIdx, tableStacks, dollarPrizes))
      };
    }

    return {
      type: 'postflop',
      format: format,
      hand: hand,
      cards: cards,
      boardCards: boardCards,
      boardTexture: texture,
      handStrength: handStrength,
      spotType: spotType,
      street: street,
      position: position,
      villainPosition: villainPosition || null,
      isIP: isIP,
      potSize: potSize,
      effectiveStack: effectiveStack,
      spr: spr,
      matchup: matchupKey,
      depth: depth,
      solverActions: solverActions,
      dataSource: dataSource,
      icmContext: icmContext,
      preflopContext: preflopCtx || null,
      preflopAction: preflopAction || null,
      description: this._describePostflopScenario(spotType, texture, street, position, potSize, effectiveStack, matchupKey, depth)
    };
  },

  // Generate a push/fold tournament scenario with ICM context
  tournament: function(config) {
    var stackMin = parseInt(config.stackMin) || 5;
    var stackMax = parseInt(config.stackMax) || 20;
    var positions = config.positions || GTO.Data.POSITIONS;
    var position = GTO.Utils.randPick(positions);
    var stackBB = stackMin + Math.floor(Math.random() * (stackMax - stackMin + 1));
    var hand = GTO.Utils.randPick(GTO.Data.ALL_HANDS);
    var cards = GTO.Engine.Deck.handToCards(hand);
    var stage = config.stage || GTO.Data.TournamentStructures.randomStage();

    // Payout structure from config or default
    var structureKey = config.structureKey || '9max_sng';
    var structure = GTO.Data.TournamentStructures ?
      GTO.Data.TournamentStructures.get(structureKey) : null;

    // Generate table stacks if we have the structures module
    var tableStacks = null;
    var heroIdx = 0;
    var avgStackBB = config.avgStackBB || Math.round(stackBB * (0.8 + Math.random() * 0.8));

    if (GTO.Data.TournamentStructures && structure) {
      var numPlayers = structure.players || 6;
      heroIdx = Math.floor(Math.random() * numPlayers);

      tableStacks = GTO.Data.TournamentStructures.generateTableStacks({
        players: numPlayers,
        heroIdx: heroIdx,
        heroStackBB: stackBB,
        avgStackBB: avgStackBB,
        stage: stage
      });
    }

    // Calculate ICM metrics if available
    var icmEquity = null;
    var bubbleFactor = null;
    var icmPressure = null;

    if (GTO.Engine.ICM && tableStacks && structure) {
      var buyIn = config.buyIn || 100;
      var prizePool = buyIn * structure.players;
      var dollarPrizes = structure.payouts.map(function(p) { return p * prizePool; });
      var equities = GTO.Engine.ICM.calculateEquities(tableStacks, dollarPrizes);
      icmEquity = equities[heroIdx];
      bubbleFactor = GTO.Engine.ICM.bubbleFactor(heroIdx, tableStacks, dollarPrizes, stackBB);
      icmPressure = GTO.Engine.ICM.pressure(heroIdx, tableStacks, dollarPrizes);
    }

    var playersLeft = structure ? structure.players : (15 + Math.floor(Math.random() * 85));

    return {
      type: 'tournament',
      hand: hand,
      cards: cards,
      position: position,
      stackBB: stackBB,
      stage: stage,
      playersLeft: playersLeft,
      tableStacks: tableStacks,
      heroIdx: heroIdx,
      payoutStructure: structure,
      structureKey: structureKey,
      buyIn: config.buyIn || 100,
      avgStackBB: avgStackBB,
      icmEquity: icmEquity,
      bubbleFactor: bubbleFactor,
      icmPressure: icmPressure,
      description: position + ' with ' + stackBB + 'bb - Push or Fold?' +
        (icmPressure !== null ? ' [ICM: ' + GTO.Engine.ICM.pressureLabel(icmPressure) + ']' : '')
    };
  },

  _pickWeightedHand: function(format, stackDepth, actionContext, position) {
    // Weight mixed-frequency hands 3x more than pure hands (more educational)
    var positionKey = position;
    var rangeData = null;

    try {
      var fmtData = GTO.Data.PreflopRanges[format];
      if (!fmtData) fmtData = GTO.Data.PreflopRanges.cash;
      var depthData = fmtData[stackDepth] || fmtData['100bb'] || fmtData[Object.keys(fmtData)[0]];
      if (!depthData) return GTO.Utils.randPick(GTO.Data.ALL_HANDS);
      var ctxData = depthData[actionContext] || depthData.rfi;
      if (!ctxData) return GTO.Utils.randPick(GTO.Data.ALL_HANDS);
      rangeData = ctxData[positionKey];
    } catch(e) {}

    if (!rangeData) return GTO.Utils.randPick(GTO.Data.ALL_HANDS);

    var weighted = [];
    GTO.Data.ALL_HANDS.forEach(function(h) {
      var isMixed = rangeData.mixed && rangeData.mixed[h];
      var isPure = (rangeData.pure_raise && rangeData.pure_raise.indexOf(h) >= 0) ||
                   (rangeData.pure_call && rangeData.pure_call.indexOf(h) >= 0);
      var weight = isMixed ? 3 : (isPure ? 1.5 : 1);
      weighted.push({ item: h, weight: weight });
    });

    return GTO.Utils.weightedPick(weighted);
  },

  _describePreflopScenario: function(ctx, pos, villain, stack) {
    if (ctx === 'rfi') return 'Action folds to you in ' + pos + '. ' + stack + ' effective.';
    if (ctx === 'vs_raise') return villain + ' opens to 2.5bb. Action on you in ' + pos + '. ' + stack + ' effective.';
    if (ctx === 'vs_3bet') return 'You opened from ' + pos + '. ' + villain + ' 3-bets to 8bb. ' + stack + ' effective.';
    if (ctx === 'vs_4bet') return 'You 3-bet from ' + pos + '. Villain 4-bets to 20bb. ' + stack + ' effective.';
    return '';
  },

  _describePostflopScenario: function(spot, texture, street, pos, pot, stack, matchup, depth) {
    var spotLabel = GTO.Data.PostflopSpotLabels ? GTO.Data.PostflopSpotLabels[spot] : spot;
    var desc = spotLabel + ' on ' + street + '.';
    if (matchup) {
      var m = GTO.Data.PostflopMatchups && GTO.Data.PostflopMatchups[matchup];
      desc += ' ' + (m ? m.label : matchup) + '.';
    }
    if (depth) desc += ' ' + depth + '.';
    desc += ' Pot: ' + (typeof pot === 'number' ? pot.toFixed(1) : pot) + 'bb. Stack: ' + stack + 'bb.';
    return desc;
  }
};
