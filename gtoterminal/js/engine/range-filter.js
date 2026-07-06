// ============================================================================
// Range Filter — Preflop-to-Postflop Range Consistency
// ============================================================================
// Extracts raising/calling sub-ranges from PreflopRanges data so that
// postflop scenarios only use hands consistent with the preflop action taken.
// ============================================================================

window.GTO = window.GTO || {};
GTO.Engine = GTO.Engine || {};

GTO.Engine.RangeFilter = {

  // -------------------------------------------------------------------------
  // resolveActionContext(matchupKey)
  // Maps a PostflopMatchup key to the preflop action context for each side.
  // In all our matchups, OOP is the raiser (RFI) and IP is the defender.
  // -------------------------------------------------------------------------
  resolveActionContext: function(matchupKey) {
    var matchup = GTO.Data.PostflopMatchups && GTO.Data.PostflopMatchups[matchupKey];
    if (!matchup) return null;

    var oopPos = matchup.oop; // e.g., 'SB', 'BTN', 'CO', 'UTG'
    var ipPos = matchup.ip;   // e.g., 'BB', 'SB'

    // OOP is always the raiser (RFI from their position)
    // IP is defending vs raise (keyed as RAISER_DEFENDER in PreflopRanges)
    var ipKey = oopPos + '_' + ipPos; // e.g., 'BTN_BB', 'SB_BB', 'UTG_BB'

    return {
      oopAction: 'raise',
      oopContext: 'rfi',
      oopPosition: oopPos,
      ipAction: 'call',
      ipContext: 'vs_raise',
      ipPosition: ipKey
    };
  },

  // -------------------------------------------------------------------------
  // buildActionRange(format, stackDepth, actionContext, position, action)
  // Returns { hand: frequency } for hands that take the given action.
  // action = 'raise', 'call', or 'fold'
  // -------------------------------------------------------------------------
  buildActionRange: function(format, stackDepth, actionContext, position, action) {
    var result = {};

    if (!GTO.Data.PreflopRanges) return result;

    var formatData = GTO.Data.PreflopRanges[format];
    if (!formatData) formatData = GTO.Data.PreflopRanges['cash'];
    if (!formatData) return result;

    var depthData = formatData[stackDepth];
    if (!depthData) {
      // Fallback to closest depth
      var depths = Object.keys(formatData);
      if (depths.length > 0) depthData = formatData[depths[0]];
    }
    if (!depthData) return result;

    var contextData = depthData[actionContext];
    if (!contextData) return result;

    var posData = contextData[position];
    if (!posData) return result;

    var actionIdx = action === 'fold' ? 0 : action === 'call' ? 1 : 2; // [fold, call, raise]

    // Pure raise hands
    if (posData.pure_raise) {
      for (var i = 0; i < posData.pure_raise.length; i++) {
        var h = posData.pure_raise[i];
        if (action === 'raise') result[h] = 1.0;
      }
    }

    // Pure call hands
    if (posData.pure_call) {
      for (var j = 0; j < posData.pure_call.length; j++) {
        var c = posData.pure_call[j];
        if (action === 'call') result[c] = 1.0;
      }
    }

    // Mixed hands
    if (posData.mixed) {
      var hands = Object.keys(posData.mixed);
      for (var k = 0; k < hands.length; k++) {
        var mh = hands[k];
        var freqs = posData.mixed[mh];
        var freq = freqs[actionIdx];
        if (freq > 0) {
          result[mh] = freq;
        }
      }
    }

    return result;
  },

  // -------------------------------------------------------------------------
  // buildActionRangeList(format, stackDepth, actionContext, position, action)
  // Returns array of hand strings that take the given action (freq > 0).
  // -------------------------------------------------------------------------
  buildActionRangeList: function(format, stackDepth, actionContext, position, action) {
    var range = this.buildActionRange(format, stackDepth, actionContext, position, action);
    return Object.keys(range);
  },

  // -------------------------------------------------------------------------
  // filterMatchupRange(matchupRangeStr, actionRange)
  // Returns comma-separated string of hands in both matchup range AND action range.
  // -------------------------------------------------------------------------
  filterMatchupRange: function(matchupRangeStr, actionRange) {
    if (!matchupRangeStr || !actionRange) return matchupRangeStr;

    var hands = matchupRangeStr.split(',').map(function(h) { return h.trim(); }).filter(Boolean);
    var filtered = [];
    for (var i = 0; i < hands.length; i++) {
      if (actionRange[hands[i]]) {
        filtered.push(hands[i]);
      }
    }
    return filtered.join(',');
  },

  // -------------------------------------------------------------------------
  // getWeightedMatchupRange(matchupRangeStr, actionRange)
  // Returns { hand: weight } for hands in both ranges, preserving mixed freqs.
  // -------------------------------------------------------------------------
  getWeightedMatchupRange: function(matchupRangeStr, actionRange) {
    if (!matchupRangeStr || !actionRange) return {};

    var hands = matchupRangeStr.split(',').map(function(h) { return h.trim(); }).filter(Boolean);
    var result = {};
    for (var i = 0; i < hands.length; i++) {
      if (actionRange[hands[i]]) {
        result[hands[i]] = actionRange[hands[i]];
      }
    }
    return result;
  },

  // -------------------------------------------------------------------------
  // pickHandFromFilteredRange(matchupRangeStr, actionRange)
  // Weighted random pick from intersection. Higher action freq = more likely.
  // Falls back to full range if intersection < 30% of matchup range.
  // -------------------------------------------------------------------------
  pickHandFromFilteredRange: function(matchupRangeStr, actionRange) {
    if (!matchupRangeStr || !actionRange) return null;

    var allHands = matchupRangeStr.split(',').map(function(h) { return h.trim(); }).filter(Boolean);
    if (allHands.length === 0) return null;

    // Build weighted candidates from intersection
    var candidates = [];
    var totalWeight = 0;
    for (var i = 0; i < allHands.length; i++) {
      var w = actionRange[allHands[i]];
      if (w && w > 0) {
        candidates.push({ hand: allHands[i], weight: w });
        totalWeight += w;
      }
    }

    // Fallback: if intersection < 30% of matchup range, use full range
    if (candidates.length < allHands.length * 0.3) {
      return allHands[Math.floor(Math.random() * allHands.length)];
    }

    // Weighted random selection
    var roll = Math.random() * totalWeight;
    var cumulative = 0;
    for (var j = 0; j < candidates.length; j++) {
      cumulative += candidates[j].weight;
      if (roll <= cumulative) return candidates[j].hand;
    }

    return candidates[candidates.length - 1].hand;
  },

  // -------------------------------------------------------------------------
  // getRangeSize(actionRange)
  // Returns combo-weighted size of a range (suited=4, offsuit=12, pair=6).
  // -------------------------------------------------------------------------
  getRangeSize: function(actionRange) {
    if (!actionRange || !GTO.Data.COMBOS) return 0;
    var total = 0;
    var hands = Object.keys(actionRange);
    for (var i = 0; i < hands.length; i++) {
      var combos = GTO.Data.COMBOS[hands[i]] || 4;
      total += combos * actionRange[hands[i]];
    }
    return Math.round(total);
  },

  // -------------------------------------------------------------------------
  // STRENGTH_BUCKETS — maps 18 hand strength categories to 6 display buckets
  // -------------------------------------------------------------------------
  STRENGTH_BUCKETS: {
    full_house: 'monsters', flush: 'monsters', straight: 'monsters',
    set: 'monsters', trips: 'monsters', two_pair: 'monsters',
    overpair: 'strong', top_pair_strong: 'strong',
    top_pair_weak: 'medium', second_pair: 'medium',
    combo_draw: 'draws', oesd_or_fd: 'draws', gutshot: 'draws',
    underpair: 'weak', weak_pair: 'weak', weak_draw: 'weak',
    air: 'air', overcards: 'air'
  },

  // -------------------------------------------------------------------------
  // analyzeComposition(actionRange, boardCards)
  // Classifies each hand in range against a board and returns bucketed %s.
  // boardCards = array of card objects [{rank, suit}, ...]
  // -------------------------------------------------------------------------
  analyzeComposition: function(actionRange, boardCards) {
    var result = { monsters: 0, strong: 0, medium: 0, draws: 0, weak: 0, air: 0, total: 0 };
    if (!actionRange || !boardCards || boardCards.length < 3) return result;
    if (!GTO.Data.BoardCategories || !GTO.Data.BoardCategories.classifyHandStrength) return result;

    var hands = Object.keys(actionRange);
    if (hands.length === 0) return result;

    var boardRanks = {};
    var boardSuits = {};
    for (var b = 0; b < boardCards.length; b++) {
      var bc = boardCards[b];
      var bKey = (typeof bc === 'string') ? bc : (bc.rank + bc.suit);
      boardRanks[bKey] = true;
    }

    // Find the dominant flush-draw suit on board (for suited hand sampling)
    var suitCount = {};
    for (var s = 0; s < boardCards.length; s++) {
      var bs = (typeof boardCards[s] === 'string') ? boardCards[s][1] : boardCards[s].suit;
      suitCount[bs] = (suitCount[bs] || 0) + 1;
    }
    var flushDrawSuit = null;
    var allSuits = GTO.Data.SUITS || ['s','h','d','c'];
    for (var fs = 0; fs < allSuits.length; fs++) {
      if ((suitCount[allSuits[fs]] || 0) >= 2) { flushDrawSuit = allSuits[fs]; break; }
    }

    var totalWeight = 0;
    var buckets = this.STRENGTH_BUCKETS;

    for (var i = 0; i < hands.length; i++) {
      var hand = hands[i];
      var freq = actionRange[hand];
      var combos = (GTO.Data.COMBOS && GTO.Data.COMBOS[hand]) || 4;
      var weight = combos * freq;

      // Generate representative card objects for classification
      var r1 = hand[0];
      var r2 = hand[1];
      var isSuited = hand.length === 3 && hand[2] === 's';
      var isPair = hand.length === 2;

      var samples = [];
      if (isSuited) {
        // Sample with flush-draw suit and without
        var suit1 = flushDrawSuit || 's';
        var suit2 = (suit1 === 's') ? 'h' : 's';
        samples.push([{ rank: r1, suit: suit1 }, { rank: r2, suit: suit1 }]);
        samples.push([{ rank: r1, suit: suit2 }, { rank: r2, suit: suit2 }]);
      } else if (isPair) {
        // One sample is enough for pairs (rank-based classification)
        samples.push([{ rank: r1, suit: 's' }, { rank: r2, suit: 'h' }]);
      } else {
        // Offsuit — one sample
        samples.push([{ rank: r1, suit: 's' }, { rank: r2, suit: 'h' }]);
      }

      // Average classification across samples
      var sampleBuckets = {};
      var validSamples = 0;
      for (var si = 0; si < samples.length; si++) {
        var cards = samples[si];
        // Skip if cards conflict with board
        var conflict = false;
        for (var ci = 0; ci < cards.length; ci++) {
          var cKey = cards[ci].rank + cards[ci].suit;
          if (boardRanks[cKey]) { conflict = true; break; }
        }
        if (conflict) continue;

        var strength = GTO.Data.BoardCategories.classifyHandStrength(cards, boardCards);
        var bucket = buckets[strength] || 'air';
        sampleBuckets[bucket] = (sampleBuckets[bucket] || 0) + 1;
        validSamples++;
      }

      if (validSamples === 0) continue;

      // Distribute weight across observed buckets
      var bucketKeys = Object.keys(sampleBuckets);
      for (var bi = 0; bi < bucketKeys.length; bi++) {
        var bk = bucketKeys[bi];
        result[bk] += weight * (sampleBuckets[bk] / validSamples);
      }
      totalWeight += weight;
    }

    // Normalize to percentages
    if (totalWeight > 0) {
      result.monsters /= totalWeight;
      result.strong /= totalWeight;
      result.medium /= totalWeight;
      result.draws /= totalWeight;
      result.weak /= totalWeight;
      result.air /= totalWeight;
    }
    result.total = Math.round(totalWeight);
    return result;
  },

  // -------------------------------------------------------------------------
  // adjustForComposition(baseFreqs, composition, spotType)
  // Nudges GTO frequencies based on range composition. Small adjustments only.
  // spotType: string containing 'facing' for facing-bet spots, else betting spot.
  // -------------------------------------------------------------------------
  adjustForComposition: function(baseFreqs, composition, spotType) {
    if (!baseFreqs || !composition || composition.total === 0) return baseFreqs;

    var adjusted = {};
    var keys = Object.keys(baseFreqs);
    for (var i = 0; i < keys.length; i++) {
      adjusted[keys[i]] = baseFreqs[keys[i]];
    }

    var rangeStrength = composition.monsters + composition.strong;
    var rangeDraws = composition.draws;
    var rangeAir = composition.air + composition.weak;
    var isFacing = spotType && spotType.indexOf('facing') >= 0;

    if (isFacing) {
      // Facing a bet: fold / call / raise
      var shift = 0;
      if (rangeStrength > 0.35) {
        // Strong range → less folding, more calling/raising
        shift = Math.min((rangeStrength - 0.35) * 0.15, 0.08);
        adjusted.fold = Math.max(0, (adjusted.fold || 0) - shift);
        adjusted.call = (adjusted.call || 0) + shift * 0.7;
        if (adjusted.raise !== undefined) adjusted.raise += shift * 0.3;
        else adjusted.call += shift * 0.3;
      } else if (rangeAir > 0.40) {
        // Weak range → more folding
        shift = Math.min((rangeAir - 0.40) * 0.12, 0.07);
        adjusted.fold = (adjusted.fold || 0) + shift;
        adjusted.call = Math.max(0, (adjusted.call || 0) - shift);
      }
      if (rangeDraws > 0.30) {
        // Draw-heavy → slight increase in calling
        var drawShift = Math.min((rangeDraws - 0.30) * 0.10, 0.05);
        adjusted.fold = Math.max(0, (adjusted.fold || 0) - drawShift);
        adjusted.call = (adjusted.call || 0) + drawShift;
      }
    } else {
      // Betting spot: check / bet_33 / bet_67 / bet_100
      var betKeys = [];
      var checkKey = null;
      for (var k = 0; k < keys.length; k++) {
        if (keys[k] === 'check') checkKey = keys[k];
        else betKeys.push(keys[k]);
      }
      if (!checkKey || betKeys.length === 0) return adjusted;

      var shift = 0;
      if (rangeStrength > 0.35) {
        // Value-heavy range → bet more
        shift = Math.min((rangeStrength - 0.35) * 0.15, 0.10);
        adjusted[checkKey] = Math.max(0, adjusted[checkKey] - shift);
        // Distribute to bet sizes proportionally
        var totalBet = 0;
        for (var bk = 0; bk < betKeys.length; bk++) totalBet += adjusted[betKeys[bk]] || 0;
        if (totalBet > 0) {
          for (var bk2 = 0; bk2 < betKeys.length; bk2++) {
            adjusted[betKeys[bk2]] += shift * ((adjusted[betKeys[bk2]] || 0) / totalBet);
          }
        } else {
          adjusted[betKeys[0]] = (adjusted[betKeys[0]] || 0) + shift;
        }
      } else if (rangeAir > 0.40) {
        // Air-heavy range → check more to protect checking range
        shift = Math.min((rangeAir - 0.40) * 0.15, 0.10);
        adjusted[checkKey] = (adjusted[checkKey] || 0) + shift;
        var totalBet2 = 0;
        for (var bk3 = 0; bk3 < betKeys.length; bk3++) totalBet2 += adjusted[betKeys[bk3]] || 0;
        if (totalBet2 > 0) {
          for (var bk4 = 0; bk4 < betKeys.length; bk4++) {
            adjusted[betKeys[bk4]] = Math.max(0, adjusted[betKeys[bk4]] - shift * ((adjusted[betKeys[bk4]] || 0) / totalBet2));
          }
        }
      }
      if (rangeDraws > 0.30 && rangeStrength <= 0.35) {
        // Draw-heavy → slight increase in betting (semi-bluffs)
        var drawShift = Math.min((rangeDraws - 0.30) * 0.10, 0.05);
        adjusted[checkKey] = Math.max(0, (adjusted[checkKey] || 0) - drawShift);
        if (betKeys.length > 0) adjusted[betKeys[0]] = (adjusted[betKeys[0]] || 0) + drawShift;
      }
    }

    // Normalize to sum to 1
    var sum = 0;
    var adjKeys = Object.keys(adjusted);
    for (var n = 0; n < adjKeys.length; n++) {
      adjusted[adjKeys[n]] = Math.max(0, adjusted[adjKeys[n]]);
      sum += adjusted[adjKeys[n]];
    }
    if (sum > 0 && Math.abs(sum - 1) > 0.001) {
      for (var m = 0; m < adjKeys.length; m++) {
        adjusted[adjKeys[m]] /= sum;
      }
    }

    return adjusted;
  }
};
