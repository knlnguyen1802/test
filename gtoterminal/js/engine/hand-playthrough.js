window.GTO = window.GTO || {};
GTO.Engine = GTO.Engine || {};

GTO.Engine.HandPlaythrough = {
  _hand: null,

  startHand: function(config) {
    var deck = GTO.Engine.Deck.create();
    GTO.Engine.Deck.shuffle(deck);

    var heroPosition = config.position || GTO.Utils.randPick(GTO.Data.POSITIONS);
    var hand = GTO.Utils.randPick(GTO.Data.ALL_HANDS);
    var cards = GTO.Engine.Deck.handToCards(hand);
    deck = GTO.Engine.Deck.remove(deck, cards);

    // Derive matchup from hero position for solver lookup
    var villainPosition = this._pickVillainPosition(heroPosition);
    var matchupKey = this._resolveMatchup(heroPosition, villainPosition);

    // Derive preflop context from matchup for multi-street consistency
    var preflopContext = null;
    if (GTO.Engine.RangeFilter && matchupKey) {
      preflopContext = GTO.Engine.RangeFilter.resolveActionContext(matchupKey);
    }

    this._hand = {
      id: GTO.Utils.uid(),
      heroPosition: heroPosition,
      villainPosition: villainPosition,
      matchup: matchupKey,
      hand: hand,
      cards: cards,
      deck: deck,
      format: config.format || 'cash',
      stackDepth: config.stackDepth || '100bb',
      effectiveStack: 100, // in bb
      streets: [],
      currentStreet: 'preflop',
      board: [],
      pot: 1.5, // blinds
      scores: [],
      totalEvLoss: 0,
      isComplete: false,
      preflopContext: preflopContext,
      preflopAction: null // set when preflop action is submitted
    };

    if (GTO.UI.Sounds) GTO.UI.Sounds.play('deal');
    return this._hand;
  },

  dealStreet: function() {
    if (!this._hand || this._hand.isComplete) return null;
    var h = this._hand;

    if (h.currentStreet === 'preflop') {
      return { street: 'preflop', board: [] };
    } else if (h.currentStreet === 'flop') {
      var flop = GTO.Engine.Deck.deal(h.deck, 3);
      h.board = h.board.concat(flop);
      return { street: 'flop', board: h.board.slice(), newCards: flop };
    } else if (h.currentStreet === 'turn') {
      var turn = GTO.Engine.Deck.deal(h.deck, 1);
      h.board = h.board.concat(turn);
      return { street: 'turn', board: h.board.slice(), newCards: turn };
    } else if (h.currentStreet === 'river') {
      var river = GTO.Engine.Deck.deal(h.deck, 1);
      h.board = h.board.concat(river);
      return { street: 'river', board: h.board.slice(), newCards: river };
    }
    return null;
  },

  submitStreetAction: function(userAction) {
    if (!this._hand) return null;
    var h = this._hand;

    // Check if ICM adjustment applies (MTT format + ICM enabled)
    var icmEnabled = h.format === 'mtt' && GTO.Engine.ICM &&
      GTO.State && GTO.State.get('icmEnabled') !== false;
    var icmBF = 1.0;
    var icmContext = null;
    if (icmEnabled && GTO.Data.TournamentStructures) {
      // Generate synthetic table context for this hand
      var structure = GTO.Data.TournamentStructures.get(h.structureKey || '9max_sng');
      var stackBB = parseInt(h.stackDepth) || 25;
      var stacks = GTO.Data.TournamentStructures.generateTableStacks({
        players: structure.players, heroIdx: 0,
        heroStackBB: stackBB, avgStackBB: stackBB, stage: 'normal'
      });
      var prizes = GTO.Data.TournamentStructures.getPrizes(h.structureKey || '9max_sng', 100);
      icmBF = GTO.Engine.ICM.bubbleFactor(0, stacks, prizes, h.pot || stackBB);
      icmContext = {
        heroIdx: 0, stacks: stacks, prizes: prizes,
        prizePool: prizes.reduce(function(a, b) { return a + b; }, 0),
        potSize: h.pot || 2.5,
        heroEquity: GTO.Engine.ICM.calculateEquities(stacks, prizes)[0],
        bubbleFactor: icmBF,
        icmPressure: GTO.Engine.ICM.pressure(0, stacks, prizes),
        pressureLabel: GTO.Engine.ICM.pressureLabel(GTO.Engine.ICM.pressure(0, stacks, prizes)),
        pressureColor: GTO.Engine.ICM.pressureColor(GTO.Engine.ICM.pressure(0, stacks, prizes))
      };
    }

    var result;
    if (h.currentStreet === 'preflop') {
      var gtoFreqs = GTO.Data.lookupPreflop(h.format, h.stackDepth, 'rfi', h.heroPosition, h.hand);
      var scoringFreqs = gtoFreqs;
      if (icmEnabled && gtoFreqs && icmBF > 1.0) {
        scoringFreqs = GTO.Engine.ICM.adjustFrequencies(gtoFreqs, icmBF, 'preflop_rfi');
      }
      result = GTO.Engine.Scoring.scorePreflop(scoringFreqs, userAction, { potSize: 2.5 });
      if (icmEnabled) {
        result.rawGtoFreqs = gtoFreqs;
        if (icmContext) GTO.Engine.Scoring.scoreWithICM(result, icmContext, 0.5);
      }
    } else {
      var isIP = this._isHeroIP(h.heroPosition);
      var spotType = this._getSpotType(h.currentStreet, isIP);
      var texture = GTO.Data.BoardCategories.classify(h.board);
      var strength = GTO.Engine.HandEvaluator.classify(h.cards, h.board);
      var spr = h.effectiveStack / h.pot;
      var boardStrCards = h.board.map(function(c) {
        return (c.rank || c.r || '') + (c.suit || c.s || '');
      });
      var lookupResult = GTO.Engine.PostflopLookup ? GTO.Engine.PostflopLookup.lookup({
        spotType: spotType,
        boardTexture: texture,
        handStrength: strength,
        spr: spr,
        boardCards: boardStrCards,
        matchup: h.matchup || null,
        depth: h.stackDepth || null
      }) : { freqs: null, source: 'heuristic' };
      var gtoFreqs = lookupResult.freqs;
      var scoringFreqs = gtoFreqs;
      if (icmEnabled && gtoFreqs && icmBF > 1.0) {
        var icmSpot = (spotType && spotType.indexOf('facing') >= 0) ? 'postflop_facing' : 'postflop_bet';
        scoringFreqs = GTO.Engine.ICM.adjustFrequencies(gtoFreqs, icmBF, icmSpot);
      }

      // Range composition adjustment — nudge frequencies based on preflop sub-range
      if (scoringFreqs && h.preflopContext && h.preflopAction &&
          GTO.Engine.RangeFilter && GTO.Engine.RangeFilter.adjustForComposition) {
        var heroSide = isIP ? 'ip' : 'oop';
        var heroCtx = h.preflopContext[heroSide + 'Context'];
        var heroPos = h.preflopContext[heroSide + 'Position'];
        var heroRange = GTO.Engine.RangeFilter.buildActionRange(
          h.format, h.stackDepth, heroCtx, heroPos, h.preflopAction
        );
        var comp = GTO.Engine.RangeFilter.analyzeComposition(heroRange, h.board);
        if (comp.total > 0) {
          scoringFreqs = GTO.Engine.RangeFilter.adjustForComposition(scoringFreqs, comp, spotType);
        }
      }

      result = GTO.Engine.Scoring.scorePostflop(scoringFreqs, userAction, { potSize: h.pot });
      result.dataSource = lookupResult.source;
      if (icmEnabled) {
        result.rawGtoFreqs = gtoFreqs;
        if (icmContext) GTO.Engine.Scoring.scoreWithICM(result, icmContext, 0.5);
      }
    }

    h.scores.push({ street: h.currentStreet, result: result, action: userAction });
    h.totalEvLoss += (result.evLoss || 0);

    // Store preflop action for multi-street consistency
    if (h.currentStreet === 'preflop') {
      h.preflopAction = userAction;
    }

    if (userAction === 'fold') {
      h.isComplete = true;
      return result;
    }

    // Advance street
    var streets = ['preflop','flop','turn','river'];
    var idx = streets.indexOf(h.currentStreet);
    if (idx < streets.length - 1) {
      h.currentStreet = streets[idx + 1];
      h.pot *= 2; // simplified pot growth
    } else {
      h.isComplete = true;
    }

    return result;
  },

  _isHeroIP: function(position) {
    // In 6-max: BTN, CO are typically IP postflop; UTG, MP, SB, BB are OOP
    // Simplified: BTN and CO are IP
    return position === 'BTN' || position === 'CO';
  },

  _getSpotType: function(street, isIP) {
    var prefix = isIP ? 'IP_' : 'OOP_';
    if (street === 'flop') return prefix + 'cbet_flop';
    if (street === 'turn') return prefix + 'turn_barrel';
    return prefix + 'river_bet';
  },

  _pickVillainPosition: function(heroPosition) {
    // Pick a plausible villain for postflop play based on hero position
    var matchups = GTO.Data.PostflopMatchups;
    if (!matchups) {
      // Fallback: simple IP/OOP pairing
      return heroPosition === 'BTN' ? 'BB' : 'BTN';
    }
    // Find matchups where hero appears
    var candidates = [];
    var keys = Object.keys(matchups);
    for (var i = 0; i < keys.length; i++) {
      var m = matchups[keys[i]];
      if (m.oop === heroPosition || m.ip === heroPosition) {
        candidates.push(m.oop === heroPosition ? m.ip : m.oop);
      }
    }
    return candidates.length > 0 ? GTO.Utils.randPick(candidates) : 'BB';
  },

  _resolveMatchup: function(heroPosition, villainPosition) {
    var matchups = GTO.Data.PostflopMatchups;
    if (!matchups) return null;
    // Try both orderings: hero_vs_villain and villain_vs_hero
    var keys = Object.keys(matchups);
    for (var i = 0; i < keys.length; i++) {
      var m = matchups[keys[i]];
      if ((m.oop === heroPosition && m.ip === villainPosition) ||
          (m.ip === heroPosition && m.oop === villainPosition)) {
        return keys[i];
      }
    }
    return null;
  },

  getHand: function() { return this._hand; },
  isComplete: function() { return this._hand ? this._hand.isComplete : true; }
};
