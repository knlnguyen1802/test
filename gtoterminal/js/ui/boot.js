// GTOTerminal — Boot Screen
// Retro terminal boot with POST diagnostics and module loading.

window.GTO = window.GTO || {};
GTO.UI = GTO.UI || {};

GTO.UI.Boot = {
  _el: null,
  _lines: [],
  _ready: false,
  _skipped: false,
  _dismissed: false,
  _timers: [],

  init: function() {
    this._el = document.getElementById('boot-screen');
    if (!this._el) return;

    // Skip boot screen for returning users (unless they opted in via settings)
    var hasBooted = localStorage.getItem('gto_booted');
    var showBoot = localStorage.getItem('gto_settings_showBoot');
    if (hasBooted && showBoot !== 'true') {
      this._el.parentNode.removeChild(this._el);
      return;
    }

    // Read training data directly from localStorage (GTO.State not yet initialized)
    this._stats = this._readStats();
    this._storageKB = this._measureStorage();

    // Build dynamic content
    this._buildLines();
    this._buildStats();

    // Bind input
    var self = this;

    this._onKey = function(e) {
      if (self._dismissed) return;
      if (self._ready) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          self.dismiss();
        }
      } else {
        self._skipToReady();
      }
    };

    this._onClick = function() {
      if (self._dismissed) return;
      if (self._ready) self.dismiss();
      else self._skipToReady();
    };

    document.addEventListener('keydown', this._onKey);
    this._el.addEventListener('click', this._onClick);

    // Begin sequence
    this._startSequence();
  },

  // ── Data Helpers ──

  _readStats: function() {
    try {
      var raw = localStorage.getItem('gto_analytics');
      if (!raw) return null;
      var a = JSON.parse(raw);
      var o = (a && a.overall) ? a.overall : {};
      if (!o.total || o.total === 0) return null;

      var sessions = 0;
      try {
        var h = localStorage.getItem('gto_history');
        if (h) sessions = JSON.parse(h).length;
      } catch(e) {}

      return {
        hands: o.total,
        accuracy: Math.round((o.correct / o.total) * 100),
        sessions: sessions
      };
    } catch(e) {
      return null;
    }
  },

  _measureStorage: function() {
    var bytes = 0;
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (k.indexOf('gto_') === 0) {
        bytes += k.length + (localStorage.getItem(k) || '').length;
      }
    }
    return Math.round(bytes / 1024);
  },

  // ── Scheduling ──

  _after: function(fn, ms) {
    var id = setTimeout(fn, ms);
    this._timers.push(id);
    return id;
  },

  _cancelAll: function() {
    this._timers.forEach(clearTimeout);
    this._timers = [];
  },

  // ── Content Builders ──

  _buildLines: function() {
    var container = this._el.querySelector('#boot-lines');
    if (!container) return;
    this._lines = [];
    var self = this;

    var now = new Date();
    var mm = String(now.getMonth() + 1).padStart(2, '0');
    var dd = String(now.getDate()).padStart(2, '0');
    var yy = String(now.getFullYear());
    var dateStr = mm + '/' + dd + '/' + yy;

    var storageStr = this._storageKB >= 1024
      ? (this._storageKB / 1024).toFixed(1) + 'MB'
      : this._storageKB + 'KB';

    // Helper: pad a label..........value line
    function dotPad(label, value, width) {
      var dots = '';
      var count = width - label.length - value.length - 2;
      for (var i = 0; i < count; i++) dots += '.';
      return label + ' ' + dots + ' ' + value;
    }

    function addText(text, cls) {
      var el = document.createElement('div');
      el.className = 'boot-line' + (cls ? ' ' + cls : '');
      el.textContent = text;
      container.appendChild(el);
      self._lines.push({ el: el, type: 'text' });
    }

    function addModule(name, desc) {
      var el = document.createElement('div');
      el.className = 'boot-line';
      var pad = name;
      while (pad.length < 20) pad += ' ';
      el.innerHTML =
        '<span class="boot-module-name"> ' + pad + '</span>' +
        '<span class="boot-bar-empty">\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591</span>' +
        '  <span class="boot-module-desc">' + desc + '</span>';
      container.appendChild(el);
      self._lines.push({ el: el, type: 'module' });
    }

    // ── BIOS Header ──
    addText('GTO TERMINAL SYSTEM BIOS v2.0    ' + dateStr, 'bright');
    addText('Open Source \u2500 MIT License', 'dim');
    addText('');

    // ── POST Diagnostics ──
    addText('POST \u2500 Power-On Self Test');
    addText('');
    addText(dotPad('Processor', 'OK', 42), 'dim');
    addText(dotPad('Memory', '262144K OK', 42), 'dim');
    addText(dotPad('Display', 'CRT-M OK', 42), 'dim');
    addText(dotPad('Audio', 'WebAudio OK', 42), 'dim');
    addText(dotPad('Storage', storageStr + ' OK', 42), 'dim');
    addText('');

    // ── Module Loading ──
    addText('Loading core modules:');
    addModule('PREFLOP-RANGES', '600 scenarios');
    addModule('POSTFLOP-SOLVER', '460 solutions');
    addModule('PUSH-FOLD', 'Nash equilibrium');
    addModule('HAND-EVALUATOR', '7-card ranking');
    addModule('ICM-CALCULATOR', 'equity model');
    addModule('MONTE-CARLO', 'EV sampling');
    addModule('AI-PIPELINE', 'LLM bridge');
    addModule('TRAINING-ENGINE', 'multi-street');
    addText('');
    addText('8 modules loaded. All systems operational.', 'bright');
  },

  _buildStats: function() {
    var el = this._el.querySelector('#boot-stats');
    if (!el) return;

    var storageStr = this._storageKB >= 1024
      ? (this._storageKB / 1024).toFixed(1) + ' MB'
      : this._storageKB + ' KB';

    function row(label, value) {
      return '<div class="boot-stat-row">' +
        '<span class="boot-stat-label">' + label + '</span>' +
        '<span class="boot-stat-value">' + value + '</span>' +
      '</div>';
    }

    var html = row('Modules', '8 loaded');
    html += row('Storage', storageStr);

    if (this._stats) {
      html += row('Hands', this._stats.hands.toLocaleString());
      html += row('Accuracy', this._stats.accuracy + '%');
      html += row('Sessions', String(this._stats.sessions));
    } else {
      html += row('Hands', '0');
      html += row('Status', 'New operator');
    }

    el.innerHTML = html;
  },

  // ── Animation Sequence ──

  _startSequence: function() {
    var self = this;

    // Content fades in, lines start cascading
    this._after(function() {
      self._el.querySelector('.boot-content').classList.add('visible');
      // Show logo alongside the text
      var logo = self._el.querySelector('.boot-main-right');
      if (logo) logo.classList.add('visible');
      self._revealLines(0);
    }, 150);

    // Show skip hint
    this._after(function() {
      var hint = self._el.querySelector('.boot-skip');
      if (hint) hint.classList.add('visible');
    }, 1400);
  },

  _revealLines: function(i) {
    if (this._skipped || i >= this._lines.length) {
      if (!this._skipped) this._showStatusAndPrompt();
      return;
    }

    var self = this;
    var ln = this._lines[i];

    if (ln.type === 'module') {
      ln.el.classList.add('visible');
      this._after(function() {
        self._fillBar(ln.el, function() {
          self._revealLines(i + 1);
        });
      }, 25);
    } else {
      ln.el.classList.add('visible');
      var delay = ln.el.textContent === '' ? 15 : 55;
      this._after(function() { self._revealLines(i + 1); }, delay);
    }
  },

  _fillBar: function(el, callback) {
    var bar = el.querySelector('.boot-bar-empty');
    if (!bar) { callback(); return; }

    var self = this;
    var FULL = '\u2588';
    var EMPTY = '\u2591';
    var stages = [4, 9, 13, 16];
    var step = 0;

    function tick() {
      if (step >= stages.length) {
        bar.className = 'boot-bar';
        callback();
        return;
      }
      var n = stages[step];
      var str = '';
      for (var j = 0; j < 16; j++) str += (j < n) ? FULL : EMPTY;
      bar.textContent = str;
      if (n === 16) bar.className = 'boot-bar';
      step++;
      self._after(tick, 25);
    }

    tick();
  },

  _showStatusAndPrompt: function() {
    var self = this;
    var status = this._el.querySelector('.boot-status-section');
    var prompt = this._el.querySelector('.boot-prompt');
    var hint = this._el.querySelector('.boot-skip');

    // Status section fades in
    this._after(function() {
      if (status) status.style.opacity = '1';
    }, 200);

    // Enter prompt appears
    this._after(function() {
      if (prompt) prompt.classList.add('visible');
      if (hint) hint.style.opacity = '0';
      self._ready = true;
    }, 600);
  },

  // ── Skip & Dismiss ──

  _skipToReady: function() {
    if (this._skipped) return;
    this._skipped = true;
    this._cancelAll();

    // Instantly reveal everything
    this._el.querySelector('.boot-content').classList.add('visible');

    var logo = this._el.querySelector('.boot-main-right');
    if (logo) logo.classList.add('visible');

    this._lines.forEach(function(ln) {
      ln.el.classList.add('visible');
      var bar = ln.el.querySelector('.boot-bar-empty');
      if (bar) {
        bar.className = 'boot-bar';
        var s = '';
        for (var i = 0; i < 16; i++) s += '\u2588';
        bar.textContent = s;
      }
    });

    var status = this._el.querySelector('.boot-status-section');
    var prompt = this._el.querySelector('.boot-prompt');
    var hint = this._el.querySelector('.boot-skip');

    if (status) status.style.opacity = '1';
    if (prompt) prompt.classList.add('visible');
    if (hint) hint.style.opacity = '0';

    this._ready = true;
  },

  dismiss: function() {
    if (this._dismissed) return;
    this._dismissed = true;
    this._cancelAll();

    // Mark as booted so returning visits skip the boot screen
    try { localStorage.setItem('gto_booted', '1'); } catch(e) {}

    // Play a dismiss click if sound system is up
    try { if (GTO.UI.Sounds) GTO.UI.Sounds.play('thock'); } catch(e) {}

    var self = this;
    this._el.classList.add('shutting-down');

    setTimeout(function() {
      if (self._el && self._el.parentNode) {
        self._el.parentNode.removeChild(self._el);
      }
      document.removeEventListener('keydown', self._onKey);
    }, 400);
  }
};

// Auto-start when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
  GTO.UI.Boot.init();
});
