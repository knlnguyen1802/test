window.GTO = window.GTO || {};
GTO.UI = GTO.UI || {};

GTO.UI.Panels = {
  init: function() {
    // Nothing needed for now - CSS Grid handles layout
  },

  focusPanel: function(panelId) {
    var panels = document.querySelectorAll('.panel');
    panels.forEach(function(p) { p.classList.remove('focused'); });
    var panel = document.getElementById(panelId);
    if (panel) panel.classList.add('focused');
  },

  unfocusAll: function() {
    document.querySelectorAll('.panel').forEach(function(p) { p.classList.remove('focused'); });
  }
};
