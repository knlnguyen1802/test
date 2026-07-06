window.GTO = window.GTO || {};
GTO.Analytics = GTO.Analytics || {};

GTO.Analytics.Dashboard = {
  render: function() {
    this.renderPositionChart();
    this.renderWeaknesses();
    this.renderSessionHistory();
    this.renderTrendChart();

    // Render player profile
    if (GTO.Content && GTO.Content.ProfileView) {
      GTO.Content.ProfileView.render();
    }
  },

  renderPositionChart: function() {
    var container = document.getElementById('position-accuracy-chart');
    if (!container) return;
    var data = GTO.Analytics.Aggregator.getAccuracyByPosition();
    var html = '';
    data.forEach(function(d) {
      var pct = Math.round(d.accuracy * 100);
      var fillClass = pct >= 80 ? 'fill-high' : (pct >= 65 ? 'fill-mid' : 'fill-low');
      html += '<div class="bar-row">' +
        '<span class="bar-label">' + d.position + '</span>' +
        '<div class="bar-track"><div class="bar-fill ' + fillClass + '" style="width:' + pct + '%"></div></div>' +
        '<span class="bar-value">' + (d.total > 0 ? pct + '%' : '--') + '</span>' +
      '</div>';
    });
    container.innerHTML = html;
  },

  renderWeaknesses: function() {
    var container = document.getElementById('weakness-list');
    if (!container) return;
    var spots = GTO.Analytics.Aggregator.getAccuracyBySpotType();
    var weaknesses = spots.filter(function(s) { return s.total >= 10 && s.accuracy < 0.75; }).slice(0, 5);

    if (weaknesses.length === 0) {
      container.innerHTML = '<div class="text-dim text-xs" style="padding:8px">Not enough data yet. Complete more drills to identify weaknesses.</div>';
      return;
    }

    var html = '';
    weaknesses.forEach(function(w) {
      var pct = Math.round(w.accuracy * 100);
      html += '<div class="weakness-item">' +
        '<span class="weakness-icon">!</span>' +
        '<span class="weakness-text">' + w.spotType + ' (' + w.total + ' decisions)</span>' +
        '<span class="weakness-pct">' + pct + '%</span>' +
      '</div>';
    });
    container.innerHTML = html;
  },

  renderSessionHistory: function() {
    var self = this;
    var container = document.getElementById('session-history-body');
    if (!container) return;
    var sessions = GTO.Analytics.Aggregator.getSessionHistory(20);

    if (sessions.length === 0) {
      container.innerHTML = '<tr><td colspan="5" class="text-dim" style="padding:8px">No sessions yet</td></tr>';
      return;
    }

    var html = '';
    sessions.forEach(function(s, idx) {
      var pct = Math.round(s.accuracy * 100);
      var color = pct >= 80 ? 'text-green' : (pct >= 65 ? 'text-orange' : 'text-red');
      var hasDetails = s.decisions && s.decisions.length > 0;
      html += '<tr class="' + (hasDetails ? 'clickable-row' : '') + '" data-session-idx="' + idx + '">' +
        '<td>' + GTO.Utils.formatDate(s.date) + '</td>' +
        '<td class="text-orange">' + (s.type || '').toUpperCase() + '</td>' +
        '<td>' + s.totalDrills + '</td>' +
        '<td>' + GTO.Utils.formatEV(s.totalEvLoss) + '</td>' +
        '<td class="' + color + ' font-bold">' + pct + '%</td>' +
      '</tr>';
      // Expandable detail row (hidden initially)
      if (hasDetails) {
        html += '<tr class="session-detail-row hidden" id="session-detail-' + idx + '"><td colspan="5">';
        html += '<table class="data-table" style="margin: 4px 0;"><thead><tr><th>#</th><th>Hand</th><th>Pos</th><th>You</th><th>GTO</th><th>Result</th></tr></thead><tbody>';
        s.decisions.forEach(function(d, di) {
          var vc = d.verdict === 'optimal' ? 'positive' : (d.verdict === 'acceptable' ? 'text-orange' : 'negative');
          html += '<tr><td>' + (di+1) + '</td><td>' + (d.hand||'?') + '</td><td>' + (d.position||'?') + '</td>' +
            '<td>' + (d.userAction||'?').toUpperCase() + '</td><td>' + (d.bestAction||'?').toUpperCase() + '</td>' +
            '<td class="' + vc + '">' + (d.verdict||'?').toUpperCase() + '</td></tr>';
        });
        html += '</tbody></table></td></tr>';
      }
    });
    container.innerHTML = html;

    // Wire click to expand
    container.querySelectorAll('.clickable-row').forEach(function(row) {
      row.addEventListener('click', function() {
        var idx = this.getAttribute('data-session-idx');
        var detail = document.getElementById('session-detail-' + idx);
        if (detail) detail.classList.toggle('hidden');
      });
    });
  },

  renderTrendChart: function() {
    var canvas = document.getElementById('ev-trend-canvas');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    var sessions = GTO.Analytics.Aggregator.getSessionHistory(30).reverse();

    canvas.width = canvas.parentElement.clientWidth;
    canvas.height = canvas.parentElement.clientHeight;
    var w = canvas.width, h = canvas.height;

    ctx.clearRect(0, 0, w, h);

    if (sessions.length < 2) {
      ctx.fillStyle = '#555';
      ctx.font = '11px JetBrains Mono';
      ctx.textAlign = 'center';
      ctx.fillText('Need 2+ sessions for trend', w/2, h/2);
      return;
    }

    // Draw grid
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 1;
    for (var i = 0; i <= 4; i++) {
      var y = (h * i) / 4;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // Plot accuracy line
    var padding = 20;
    var plotW = w - padding * 2;
    var plotH = h - padding * 2;

    ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#ff8c00';
    ctx.lineWidth = 2;
    ctx.beginPath();
    sessions.forEach(function(s, idx) {
      var x = padding + (plotW * idx) / (sessions.length - 1);
      var y = padding + plotH * (1 - s.accuracy);
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Draw dots
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#ff8c00';
    sessions.forEach(function(s, idx) {
      var x = padding + (plotW * idx) / (sessions.length - 1);
      var y = padding + plotH * (1 - s.accuracy);
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    });
  }
};
