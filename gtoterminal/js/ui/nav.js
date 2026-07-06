window.GTO = window.GTO || {};
GTO.UI = GTO.UI || {};

GTO.UI.Nav = {
  init: function() {
    var self = this;
    // Click handlers for nav tabs
    document.querySelectorAll('.nav-tab').forEach(function(tab) {
      tab.addEventListener('click', function() {
        var view = this.getAttribute('data-view');
        if (view) self.switchView(view);
      });
    });

    // Keyboard shortcuts for view switching (1-5)
    var views = ['explore','drill','playthrough','plans','stats','learn','stream'];
    views.forEach(function(v, i) {
      GTO.Keyboard.register('navigation', String(i + 1), function() { self.switchView(v); });
    });
  },

  switchView: function(viewName) {
    // Tab switch sound
    if (GTO.UI.Sounds) GTO.UI.Sounds.play('tab');

    // Update tabs
    document.querySelectorAll('.nav-tab').forEach(function(tab) {
      tab.classList.toggle('active', tab.getAttribute('data-view') === viewName);
    });

    // Update views
    document.querySelectorAll('.view').forEach(function(view) {
      view.classList.toggle('active', view.id === 'view-' + viewName);
    });

    // Update state
    GTO.State.set('activeView', viewName);

    // Update keyboard context
    if (viewName === 'drill') {
      if (GTO.Engine.DrillEngine.isActive()) {
        var drillType = GTO.Engine.DrillEngine.getSession();
        var ctx = drillType ? 'drill-' + drillType.type : 'navigation';
        if (ctx === 'drill-tournament') ctx = 'drill-mtt';
        GTO.Keyboard.setContext(ctx);
      } else {
        GTO.Keyboard.setContext('navigation');
      }
    } else {
      GTO.Keyboard.setContext('navigation');
    }

    // Render learn view if switching to learn
    if (viewName === 'learn' && GTO.Content && GTO.Content.LearnView) {
      GTO.Content.LearnView.render();
    }

    // Render dashboard if switching to stats
    if (viewName === 'stats' && GTO.Analytics && GTO.Analytics.Dashboard) {
      GTO.Analytics.Dashboard.render();
    }

    // Render explore matrix if switching to explore
    if (viewName === 'explore' && GTO.App._updateExploreMatrix) {
      GTO.App._updateExploreMatrix();
    }

    // Render stream view if switching to stream
    if (viewName === 'stream' && GTO.Streaming && GTO.Streaming.StreamView) {
      GTO.Streaming.StreamView.render();
    }
  }
};
