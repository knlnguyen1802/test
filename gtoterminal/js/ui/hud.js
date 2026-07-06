window.GTO = window.GTO || {};
GTO.UI = GTO.UI || {};

GTO.UI.HUD = {
  // Update the 6-max table display to highlight hero and villain
  updateTable: function(containerId, heroPosition, villainPosition) {
    var container = document.getElementById(containerId);
    if (!container) return;

    var seats = container.querySelectorAll('.seat');
    seats.forEach(function(seat) {
      seat.classList.remove('active', 'villain');
      var pos = seat.getAttribute('data-position');
      if (pos === heroPosition) seat.classList.add('active');
      if (pos === villainPosition) seat.classList.add('villain');
    });
  },

  // Update stat rows (position, stack, etc)
  updateStat: function(id, value) {
    var el = document.getElementById(id);
    if (!el) return;
    if (typeof value === 'string' && value.indexOf('<') !== -1) {
      el.innerHTML = value;
    } else {
      el.textContent = value;
    }
  },

  // Update the status bar
  updateStatusBar: function(progress) {
    var sessionEl = document.getElementById('status-session');
    var accuracyEl = document.getElementById('status-accuracy');
    var evLossEl = document.getElementById('status-ev-loss');

    if (sessionEl) sessionEl.textContent = progress.current + '/' + (progress.total || '--');
    if (accuracyEl) {
      var pct = progress.current > 0 ? Math.round(progress.accuracy * 100) : '--';
      accuracyEl.textContent = pct + '%';
      accuracyEl.className = 'status-value' + (pct >= 80 ? ' positive' : (pct >= 65 ? ' highlight' : (pct !== '--' ? ' negative' : '')));
    }
    if (evLossEl) {
      evLossEl.textContent = GTO.Utils.formatEV(progress.evLoss || 0);
      evLossEl.className = 'status-value' + ((progress.evLoss || 0) < -1 ? ' negative' : '');
    }
  },

  // Update format indicator
  updateFormat: function(format) {
    var el = document.getElementById('status-format');
    if (el) el.textContent = (format || 'cash').toUpperCase() + ' 6MAX';
  }
};
