window.GTO = window.GTO || {};
GTO.UI = GTO.UI || {};

GTO.UI.Toast = {
  show: function(message, type, duration) {
    type = type || 'info';
    duration = duration || 3000;

    var container = document.getElementById('toast-container');
    if (!container) return;

    var toast = document.createElement('div');
    toast.className = 'toast toast-' + type;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(function() {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s';
      setTimeout(function() { toast.remove(); }, 300);
    }, duration);
  },

  success: function(msg) { this.show(msg, 'success'); },
  error: function(msg) { this.show(msg, 'error'); },
  info: function(msg) { this.show(msg, 'info'); }
};
