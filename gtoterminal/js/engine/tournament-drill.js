// ============================================================================
// Tournament Drill — ICM-aware push/fold and tournament decision support
// ============================================================================
// Provides action availability, labeling, and ICM context generation for
// tournament scenarios. Uses GTO.Engine.ICM and GTO.Data.TournamentStructures.
// ============================================================================

window.GTO = window.GTO || {};
GTO.Engine = GTO.Engine || {};

GTO.Engine.TournamentDrill = {

  // -----------------------------------------------------------------------
  // Available actions based on stack depth
  // -----------------------------------------------------------------------
  getAvailableActions: function(stackBB) {
    if (stackBB <= 15) return ['push', 'fold'];
    return ['fold', 'call', 'raise'];
  },

  // -----------------------------------------------------------------------
  // Action labels for UI buttons
  // -----------------------------------------------------------------------
  getActionLabels: function(stackBB) {
    if (stackBB <= 15) return { push: 'Push All-In', fold: 'Fold' };
    return { fold: 'Fold', call: 'Call', raise: 'Raise' };
  },

  // -----------------------------------------------------------------------
  // Build ICM context for a tournament scenario
  // Requires scenario to have tableStacks, payoutStructure, heroIdx
  // @param {Object} scenario - from ScenarioGenerator.tournament()
  // @returns {Object|null} ICM context for scoring overlay
  // -----------------------------------------------------------------------
  getICMContext: function(scenario) {
    if (!GTO.Engine.ICM) return null;
    if (!scenario.tableStacks || !scenario.payoutStructure) return null;

    var stacks = scenario.tableStacks;
    var payouts = scenario.payoutStructure.payouts;
    var heroIdx = scenario.heroIdx || 0;

    // Convert payout fractions to dollar amounts
    var buyIn = scenario.buyIn || 100;
    var numPlayers = scenario.payoutStructure.players || stacks.length;
    var prizePool = buyIn * numPlayers;
    var dollarPrizes = payouts.map(function(p) { return p * prizePool; });

    // Current equities
    var equities = GTO.Engine.ICM.calculateEquities(stacks, dollarPrizes);

    // Pot size for bubble factor calculation (hero's stack = max risk)
    var potSize = scenario.potSize || scenario.stackBB || stacks[heroIdx];
    var bf = GTO.Engine.ICM.bubbleFactor(heroIdx, stacks, dollarPrizes, potSize);
    var pressure = GTO.Engine.ICM.pressure(heroIdx, stacks, dollarPrizes);

    return {
      heroIdx: heroIdx,
      stacks: stacks,
      prizes: dollarPrizes,
      prizePool: prizePool,
      potSize: potSize,
      heroEquity: equities[heroIdx],
      equities: equities,
      bubbleFactor: bf,
      icmPressure: pressure,
      pressureLabel: GTO.Engine.ICM.pressureLabel(pressure),
      pressureColor: GTO.Engine.ICM.pressureColor(pressure)
    };
  },

  // -----------------------------------------------------------------------
  // Compare push vs fold with ICM
  // @param {Object} scenario - tournament scenario with ICM data
  // @param {number} winProb - estimated probability of winning showdown (0-1)
  // @returns {Object} comparison result
  // -----------------------------------------------------------------------
  comparePushFoldICM: function(scenario, winProb) {
    if (!GTO.Engine.ICM || !scenario.tableStacks || !scenario.payoutStructure) return null;

    var stacks = scenario.tableStacks;
    var heroIdx = scenario.heroIdx || 0;
    var heroStack = stacks[heroIdx];

    var buyIn = scenario.buyIn || 100;
    var numPlayers = scenario.payoutStructure.players || stacks.length;
    var prizePool = buyIn * numPlayers;
    var dollarPrizes = scenario.payoutStructure.payouts.map(function(p) { return p * prizePool; });

    // Estimate blinds from scenario
    var blinds = 1.5; // SB + BB
    var potAfterPush = heroStack + Math.min(heroStack, blinds);

    // Win stacks: hero gains blinds/caller's chips
    var winStacks = stacks.slice();
    winStacks[heroIdx] += blinds;

    // Lose stacks: hero busts
    var loseStacks = stacks.slice();
    loseStacks[heroIdx] = 0;

    winProb = winProb || 0.5;

    return GTO.Engine.ICM.compareOutcomes(heroIdx, stacks, winStacks, loseStacks, winProb, dollarPrizes);
  }
};
