window.GTO = window.GTO || {};
GTO.Content = GTO.Content || {};

GTO.Content.ProfileView = {
  render: function() {
    var container = document.getElementById('stats-profile');
    if (!container) return;

    var profile = GTO.Content.PlayerProfile.compute();
    var c = profile.skillRating.color;

    var html = '';

    // ── TOP ROW: Skill badge + Metrics ──
    html += '<div class="profile-top">';

    // Skill badge — larger, more prominent
    html += '<div class="profile-badge-wrap">';
    html += '<div class="profile-skill-badge" style="border-color:' + c + '; box-shadow: 0 0 20px ' + c + '22, inset 0 0 12px ' + c + '11;">';
    html += '<div class="profile-skill-score" style="color:' + c + ';">' + profile.skillRating.score + '</div>';
    html += '<div class="profile-skill-label" style="color:' + c + ';">' + profile.skillRating.level + '</div>';
    html += '</div>';
    html += '</div>';

    // Metrics — vertical dividers between them
    html += '<div class="profile-metrics-row">';
    html += this._metric(profile.totalDecisions.toLocaleString(), 'DECISIONS', 'var(--text-primary)');
    html += '<div class="profile-metric-divider"></div>';
    var accColor = profile.overallAccuracy >= 0.8 ? '#4af6c3' : (profile.overallAccuracy >= 0.65 ? 'var(--orange)' : '#ff433d');
    html += this._metric(profile.totalDecisions > 0 ? Math.round(profile.overallAccuracy * 100) + '%' : '--', 'ACCURACY', accColor);
    html += '<div class="profile-metric-divider"></div>';
    html += this._metric(profile.totalDecisions > 0 ? GTO.Utils.formatEV(profile.totalEvLoss) : '--', 'EV LOSS', '#ff433d');
    html += '<div class="profile-metric-divider"></div>';
    html += this._metric(profile.sessionsCompleted.toString(), 'SESSIONS', 'var(--text-primary)');
    html += '<div class="profile-metric-divider"></div>';
    html += this._metric(profile.favoritePosition, 'FAV POS', 'var(--accent)');
    html += '</div>';

    html += '</div>'; // profile-top

    // ── BOTTOM ROW: Strengths | Achievements | Recommended ──
    html += '<div class="profile-bottom">';

    // Strengths
    html += '<div class="profile-col">';
    html += '<div class="profile-col-header">STRENGTHS</div>';
    if (profile.strengths.length > 0) {
      profile.strengths.forEach(function(s) {
        var pct = Math.round(s.accuracy * 100);
        html += '<div class="profile-strength-row">';
        html += '<span class="profile-strength-name">' + s.label + '</span>';
        html += '<div class="profile-strength-bar-track"><div class="profile-strength-bar-fill" style="width:' + pct + '%;"></div></div>';
        html += '<span class="profile-strength-pct">' + pct + '%</span>';
        html += '</div>';
      });
    } else {
      html += '<div class="profile-empty">Complete 15+ decisions per area</div>';
    }
    html += '</div>';

    // Achievements
    html += '<div class="profile-col">';
    html += '<div class="profile-col-header">ACHIEVEMENTS</div>';
    if (profile.achievements.length > 0) {
      html += '<div class="profile-achievement-grid">';
      profile.achievements.forEach(function(a) {
        html += '<div class="profile-ach-badge" title="' + a.desc + '">';
        html += '<div class="profile-ach-icon">&#9733;</div>';
        html += '<div class="profile-ach-label">' + a.label + '</div>';
        html += '</div>';
      });
      html += '</div>';
    } else {
      html += '<div class="profile-empty">Complete drills to earn badges</div>';
    }
    html += '</div>';

    // Recommended
    html += '<div class="profile-col">';
    html += '<div class="profile-col-header">RECOMMENDED READING</div>';
    if (profile.recommendedContent.length > 0) {
      profile.recommendedContent.forEach(function(topic) {
        var catColor = GTO.Data.ContentCatalog.getCategoryColor(topic.category);
        html += '<div class="profile-rec-item" data-topic-id="' + topic.id + '">';
        html += '<span class="profile-rec-dot" style="background:' + catColor + ';"></span>';
        html += '<span class="profile-rec-text">' + topic.title + '</span>';
        html += '<span class="profile-rec-arrow">&rarr;</span>';
        html += '</div>';
      });
    } else {
      html += '<div class="profile-empty">Complete drills for recommendations</div>';
    }
    html += '</div>';

    html += '</div>'; // profile-bottom

    container.querySelector('.panel-body').innerHTML = html;

    // Wire recommended content links
    container.querySelectorAll('.profile-rec-item').forEach(function(el) {
      el.addEventListener('click', function() {
        var topicId = this.getAttribute('data-topic-id');
        if (topicId) {
          GTO.UI.Nav.switchView('learn');
          setTimeout(function() {
            GTO.Content.LearnView._openTopic(topicId);
          }, 100);
        }
      });
    });
  },

  _metric: function(value, label, color) {
    return '<div class="profile-metric">' +
      '<div class="profile-metric-val" style="color:' + color + ';">' + value + '</div>' +
      '<div class="profile-metric-lbl">' + label + '</div>' +
    '</div>';
  }
};
