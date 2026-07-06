window.GTO = window.GTO || {};
GTO.UI = GTO.UI || {};

GTO.UI.Modal = {
  open: function(modalId) {
    var modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.remove('hidden');
      GTO.Keyboard.disable();
    }
  },

  close: function(modalId) {
    var modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.add('hidden');
      GTO.Keyboard.enable();
    }
  },

  closeAll: function() {
    document.querySelectorAll('.modal-overlay').forEach(function(m) { m.classList.add('hidden'); });
    GTO.Keyboard.enable();
  },

  init: function() {
    var self = this;
    // Close modals on overlay click
    document.querySelectorAll('.modal-overlay').forEach(function(overlay) {
      overlay.addEventListener('click', function(e) {
        if (e.target === overlay) self.closeAll();
      });
    });

    // Close buttons
    document.querySelectorAll('.modal-close').forEach(function(btn) {
      btn.addEventListener('click', function() { self.closeAll(); });
    });
  }
};
