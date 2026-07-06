window.GTO = window.GTO || {};
GTO.UI = GTO.UI || {};

GTO.UI.HandMatrix = {
  // Read live CSS custom properties so theme changes take effect instantly
  _colors: function() {
    var cs = getComputedStyle(document.documentElement);
    var rr = cs.getPropertyValue('--range-raise').trim() || '74, 246, 195';
    var rc = cs.getPropertyValue('--range-call').trim() || '0, 104, 255';
    return {
      raise: 'rgba(' + rr + ', 0.5)',
      call: 'rgba(' + rc + ', 0.5)',
      fold: '#1a1a1a'
    };
  },

  // Update matrix with range data — now renders multi-color gradient cells
  updateMatrix: function(matrixId, rangeData, highlightAction, activeHand) {
    try {
      var table = document.getElementById(matrixId);
      if (!table) return;
      var colors = this._colors();

      var cells = table.querySelectorAll('td[data-hand]');
      cells.forEach(function(cell) {
        var hand = cell.getAttribute('data-hand');
        cell.className = '';
        cell.style.background = '';

        var actionClass = 'action-fold';

        if (rangeData && rangeData[hand]) {
          var freqs = rangeData[hand];
          var r = freqs.raise || 0;
          var c = freqs.call || 0;
          var f = freqs.fold || 0;
          var totalAction = r + c;

          if (totalAction < 0.05) {
            actionClass = 'action-fold';
            cell.style.background = colors.fold;
          } else if (r >= 0.95 && c < 0.05) {
            actionClass = 'action-raise';
            cell.style.background = colors.raise;
          } else if (c >= 0.95 && r < 0.05) {
            actionClass = 'action-call';
            cell.style.background = colors.call;
          } else {
            // Mixed: compute proportional gradient
            var total = r + c + f;
            if (total === 0) total = 1;
            var rPct = (r / total) * 100;
            var cPct = (c / total) * 100;
            var rcEnd = rPct + cPct;

            cell.style.background = 'linear-gradient(to right, ' +
              colors.raise + ' 0% ' + rPct.toFixed(1) + '%, ' +
              colors.call + ' ' + rPct.toFixed(1) + '% ' + rcEnd.toFixed(1) + '%, ' +
              colors.fold + ' ' + rcEnd.toFixed(1) + '% 100%)';

            if (r > c * 2) actionClass = 'action-mixed-raise';
            else if (c > r * 2) actionClass = 'action-mixed-call';
            else actionClass = 'action-mixed-even';
          }
        } else {
          cell.style.background = colors.fold;
        }

        cell.classList.add(actionClass);
        if (GTO.Data.isPair(hand)) cell.classList.add('hand-pair');
        else if (GTO.Data.isSuited(hand)) cell.classList.add('hand-suited');
        if (activeHand && hand === activeHand) cell.classList.add('active-hand');
      });
    } catch(e) {
      console.error('[HandMatrix] updateMatrix error:', e);
    }
  },

  clearMatrix: function(matrixId) {
    var table = document.getElementById(matrixId);
    if (!table) return;
    table.querySelectorAll('td[data-hand]').forEach(function(cell) {
      cell.className = 'action-fold';
      cell.style.background = '';
      if (GTO.Data.isPair(cell.getAttribute('data-hand'))) cell.classList.add('hand-pair');
      else if (GTO.Data.isSuited(cell.getAttribute('data-hand'))) cell.classList.add('hand-suited');
    });
  },

  showPreflopRange: function(matrixId, scenario) {
    var rangeData = GTO.Engine.PreflopDrill.getRangeForScenario(scenario);
    var action = scenario.actionContext === 'rfi' ? 'raise' : 'action';
    this.updateMatrix(matrixId, rangeData, action, scenario.hand);
  },

  // GTO Wizard-style summary bar showing raise/call/fold totals
  updateSummaryBar: function(barId, rangeData, labels) {
    var bar = document.getElementById(barId);
    if (!bar) return;

    var rLabel = labels && labels.raise ? labels.raise : 'R';
    var cLabel = labels && labels.call ? labels.call : 'C';
    var fLabel = labels && labels.fold ? labels.fold : 'F';

    var raiseCombos = 0, callCombos = 0, foldCombos = 0;
    var totalCombos = 0;

    GTO.Data.ALL_HANDS.forEach(function(hand) {
      var combos = GTO.Data.COMBOS[hand] || 0;
      totalCombos += combos;
      if (rangeData && rangeData[hand]) {
        var freqs = rangeData[hand];
        raiseCombos += combos * (freqs.raise || 0);
        callCombos += combos * (freqs.call || 0);
        foldCombos += combos * (freqs.fold || 0);
      } else {
        foldCombos += combos;
      }
    });

    if (totalCombos === 0) totalCombos = 1;

    var rPct = raiseCombos / totalCombos * 100;
    var cPct = callCombos / totalCombos * 100;
    var fPct = foldCombos / totalCombos * 100;

    var html = '';
    if (rPct >= 1) {
      html += '<div class="summary-segment seg-raise" style="width:' + rPct.toFixed(1) + '%">' +
        rLabel + ' ' + rPct.toFixed(1) + '% <span style="opacity:0.7">(' + Math.round(raiseCombos) + ')</span></div>';
    }
    if (cPct >= 1) {
      html += '<div class="summary-segment seg-call" style="width:' + cPct.toFixed(1) + '%">' +
        cLabel + ' ' + cPct.toFixed(1) + '% <span style="opacity:0.7">(' + Math.round(callCombos) + ')</span></div>';
    }
    if (fPct >= 1) {
      html += '<div class="summary-segment seg-fold" style="width:' + fPct.toFixed(1) + '%">' +
        fLabel + ' ' + fPct.toFixed(1) + '% <span style="opacity:0.7">(' + Math.round(foldCombos) + ')</span></div>';
    }

    bar.innerHTML = html;
  }
};
