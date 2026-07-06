window.GTO = window.GTO || {};
GTO.UI = GTO.UI || {};

GTO.UI.BoardDisplay = {
  // Render a single card as HTML
  renderCard: function(card, size) {
    size = size || '';
    var suitClass = 'suit-' + card.suit;
    var sizeClass = size ? 'card-' + size : '';
    var symbol = GTO.Data.SUIT_SYMBOLS[card.suit];

    return '<div class="playing-card ' + suitClass + ' ' + sizeClass + '">' +
      '<span class="card-rank">' + card.rank + '</span>' +
      '<span class="card-suit">' + symbol + '</span>' +
    '</div>';
  },

  // Render hole cards into a container
  renderHoleCards: function(containerId, cards) {
    var container = document.getElementById(containerId);
    if (!container || !cards) return;
    var html = '<div class="card-container">';
    cards.forEach(function(c) { html += GTO.UI.BoardDisplay.renderCard(c, 'large'); });
    html += '</div>';
    container.innerHTML = html;
  },

  // Render board cards
  renderBoard: function(containerId, boardCards) {
    var container = document.getElementById(containerId);
    if (!container) return;
    var html = '<div class="board-cards">';
    if (boardCards) {
      boardCards.forEach(function(c) { html += GTO.UI.BoardDisplay.renderCard(c); });
    }
    // Add placeholder slots for missing cards
    var remaining = 5 - (boardCards ? boardCards.length : 0);
    for (var i = 0; i < remaining; i++) {
      html += '<div class="playing-card card-facedown"></div>';
    }
    html += '</div>';
    container.innerHTML = html;
  }
};
