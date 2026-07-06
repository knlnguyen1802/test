window.GTO = window.GTO || {};
GTO.AI = GTO.AI || {};

GTO.AI.PromptBuilder = {
  build: function(scenario, userAction, result) {
    if (scenario.type === 'preflop') return this._buildPreflop(scenario, userAction, result);
    if (scenario.type === 'postflop') return this._buildPostflop(scenario, userAction, result);
    if (scenario.type === 'tournament') return this._buildTournament(scenario, userAction, result);
    return 'Analyze this poker decision.';
  },

  _buildPreflop: function(s, action, r) {
    var parts = [
      'Preflop spot in 6-max ' + s.format + ' game, ' + s.stackDepth + ' effective.',
      'Hero is in ' + s.position + ' with ' + s.hand + '.'
    ];

    if (s.actionContext === 'rfi') parts.push('Action folds to hero.');
    else if (s.actionContext === 'vs_raise') parts.push(s.villainPosition + ' opens to 2.5bb.');
    else if (s.actionContext === 'vs_3bet') parts.push('Hero opened, ' + s.villainPosition + ' 3-bets to 8bb.');
    else if (s.actionContext === 'vs_4bet') parts.push(s.villainPosition + ' opened, hero 3-bet, ' + s.villainPosition + ' 4-bets to 20bb.');

    parts.push('Hero chose to ' + action.toUpperCase() + '.');
    parts.push('GTO frequencies: Fold ' + Math.round((r.gtoFreqs.fold||0)*100) + '%, Call ' + Math.round((r.gtoFreqs.call||0)*100) + '%, Raise ' + Math.round((r.gtoFreqs.raise||0)*100) + '%.');
    parts.push('Verdict: ' + r.verdict.toUpperCase() + '. EV impact: ' + GTO.Utils.formatEV(r.evLoss) + '.');
    parts.push('Explain WHY the GTO strategy is correct here. Cover: hand strength, position, pot odds, villain\'s range, and what this hand achieves in our range.');

    if (r.hasICM) this._addICMContext(parts, s, r);

    return parts.join('\n');
  },

  _buildPostflop: function(s, action, r) {
    var boardStr = s.boardCards.map(function(c) { return c.rank + GTO.Data.SUIT_SYMBOLS[c.suit]; }).join(' ');
    var parts = [
      'Postflop spot: ' + (GTO.Data.PostflopSpotLabels ? GTO.Data.PostflopSpotLabels[s.spotType] : s.spotType),
      'Board: ' + boardStr + ' (Texture: ' + s.boardTexture + ')',
      'Hero has ' + s.hand + ' (' + s.handStrength + ')',
      'Position: ' + s.position + ' (' + (s.isIP ? 'In Position' : 'Out of Position') + ')',
      'Pot: ' + s.potSize + 'bb, Stack: ' + s.effectiveStack + 'bb',
      'Hero chose: ' + action,
      'GTO: ' + Object.keys(r.gtoFreqs).map(function(k) { return k + ' ' + Math.round(r.gtoFreqs[k]*100) + '%'; }).join(', ')
    ];

    if (r.dataSource) {
      parts.push('Data source: ' + r.dataSource + (r.dataSource === 'solver' ? ' (pre-computed GTO solution)' : ' (heuristic approximation)') + '.');
    }
    if (s.matchup) parts.push('Matchup: ' + s.matchup + '.');
    if (s.depth) parts.push('Depth: ' + s.depth + '.');

    parts.push('Explain the optimal strategy considering board texture, range advantage, hand equity, and bet sizing theory.');

    if (r.hasICM) this._addICMContext(parts, s, r);

    return parts.join('\n');
  },

  _buildTournament: function(s, action, r) {
    var parts = [
      'Tournament push/fold spot. ' + s.stackBB + 'bb effective.',
      'Hero in ' + s.position + ' with ' + s.hand + '.',
      'Hero chose to ' + action.toUpperCase() + '.',
      'Nash equilibrium says: ' + r.correctAction.toUpperCase() + '.'
    ];

    // ICM context
    if (s.tableStacks && s.payoutStructure) {
      parts.push('Tournament context: ' + s.stage + ' stage, ' + s.playersLeft + ' players remaining.');
      parts.push('Payout structure: ' + s.payoutStructure.label + ' (' + s.payoutStructure.payouts.length + ' paid spots).');
      var stackStr = s.tableStacks.map(function(st, i) {
        return (i === s.heroIdx ? 'HERO:' : 'P' + (i+1) + ':') + st + 'bb';
      }).join(', ');
      parts.push('Table stacks: ' + stackStr + '.');
    }

    if (r.hasICM) {
      parts.push('ICM pressure: ' + r.pressureLabel + ' (score ' + r.icmPressure + '/100, bubble factor ' + r.bubbleFactor.toFixed(2) + 'x).');
      parts.push('Chip EV: ' + r.chipEV.toFixed(2) + 'bb. Dollar EV: $' + r.icmEV.toFixed(2) + '. ICM tax: $' + (r.icmTax || 0).toFixed(2) + '.');
      parts.push('Explain the push/fold decision considering BOTH chip EV and ICM dollar EV. Discuss how the ICM pressure (' + r.pressureLabel + ') and bubble factor (' + r.bubbleFactor.toFixed(2) + 'x) affect the correct strategy. Compare what chip EV suggests vs what $EV suggests.');
    } else {
      parts.push('Explain the push/fold math: fold equity, pot odds for pushing, hand equity vs calling range, and ICM considerations.');
    }

    return parts.join('\n');
  },

  // Add ICM context to preflop/postflop prompts when format=mtt
  _addICMContext: function(parts, s, r) {
    if (!r.hasICM) return;
    parts.push('');
    parts.push('TOURNAMENT ICM CONTEXT:');
    if (s.icmContext) {
      parts.push('ICM Pressure: ' + r.pressureLabel + ' (' + r.icmPressure + '/100).');
      parts.push('Bubble Factor: ' + r.bubbleFactor.toFixed(2) + 'x.');
      parts.push('Chip EV: ' + r.chipEV.toFixed(2) + 'bb | Dollar EV: $' + r.icmEV.toFixed(2) + ' | ICM Tax: $' + (r.icmTax || 0).toFixed(2));
    }
    parts.push('Consider ICM implications — chip EV vs dollar EV. Higher ICM pressure means tighter calling and wider folding.');
  }
};
