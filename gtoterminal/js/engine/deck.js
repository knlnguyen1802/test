window.GTO = window.GTO || {};
GTO.Engine = GTO.Engine || {};

GTO.Engine.Deck = {
  // Create a fresh 52-card deck
  create: function() {
    var deck = [];
    var ranks = GTO.Data.RANKS;
    var suits = GTO.Data.SUITS;
    for (var i = 0; i < ranks.length; i++) {
      for (var j = 0; j < suits.length; j++) {
        deck.push({ rank: ranks[i], suit: suits[j] });
      }
    }
    return deck;
  },

  // Shuffle deck in place
  shuffle: function(deck) {
    for (var i = deck.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var temp = deck[i];
      deck[i] = deck[j];
      deck[j] = temp;
    }
    return deck;
  },

  // Deal n cards from top of deck
  deal: function(deck, n) {
    return deck.splice(0, n);
  },

  // Remove specific cards from deck (for dealing known cards)
  remove: function(deck, cards) {
    return deck.filter(function(d) {
      return !cards.some(function(c) { return c.rank === d.rank && c.suit === d.suit; });
    });
  },

  // Convert canonical hand string to 2 card objects
  // e.g., 'AKs' -> [{rank:'A', suit:'s'}, {rank:'K', suit:'s'}]
  // Picks random suits that match the suited/offsuit/pair constraint
  handToCards: function(handStr) {
    var r1 = handStr[0];
    var r2 = handStr[1];
    var allSuits = GTO.Data.SUITS;

    if (handStr.length === 2) {
      // Pair - pick 2 different random suits
      var suits = GTO.Utils.shuffle(allSuits.slice());
      return [{ rank: r1, suit: suits[0] }, { rank: r2, suit: suits[1] }];
    } else if (handStr[2] === 's') {
      // Suited - same random suit
      var suit = GTO.Utils.randPick(allSuits);
      return [{ rank: r1, suit: suit }, { rank: r2, suit: suit }];
    } else {
      // Offsuit - different random suits
      var s1 = GTO.Utils.randPick(allSuits);
      var s2;
      do { s2 = GTO.Utils.randPick(allSuits); } while (s2 === s1);
      return [{ rank: r1, suit: s1 }, { rank: r2, suit: s2 }];
    }
  },

  // Get card display string (e.g., "A♠")
  cardToString: function(card) {
    return card.rank + GTO.Data.SUIT_SYMBOLS[card.suit];
  },

  // Get suit color class
  suitColor: function(suit) {
    return (suit === 'h' || suit === 'd') ? 'red' : 'black';
  },

  // Get suit CSS class
  suitClass: function(suit) {
    return 'suit-' + suit;
  },

  // Generate a random flop from remaining deck
  dealFlop: function(deck) {
    return this.deal(deck, 3);
  },

  // Generate a specific board texture by trying random boards
  dealBoardWithTexture: function(targetTexture, excludeCards, numCards) {
    numCards = numCards || 3;
    var maxAttempts = 200;
    for (var i = 0; i < maxAttempts; i++) {
      var deck = this.create();
      deck = this.remove(deck, excludeCards || []);
      this.shuffle(deck);
      var board = this.deal(deck, numCards);
      var texture = GTO.Data.BoardCategories.classify(board);
      if (texture === targetTexture) return { board: board, deck: deck };
    }
    // Fallback: return whatever we got
    var deck = this.create();
    deck = this.remove(deck, excludeCards || []);
    this.shuffle(deck);
    var board = this.deal(deck, numCards);
    return { board: board, deck: deck };
  }
};
