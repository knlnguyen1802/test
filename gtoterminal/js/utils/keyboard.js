window.GTO = window.GTO || {};

GTO.Keyboard = {
  _handlers: {},
  _context: 'navigation', // 'navigation', 'drill-preflop', 'drill-postflop', 'drill-mtt', 'result'
  _enabled: true,

  init() {
    document.addEventListener('keydown', (e) => {
      if (!this._enabled) return;
      // Don't capture when typing in inputs
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      const key = e.key.toLowerCase();
      const ctx = this._context;

      // Global shortcuts (always active)
      if (this._handlers['global'] && this._handlers['global'][key]) {
        e.preventDefault();
        this._handlers['global'][key]();
        return;
      }

      // Context-specific shortcuts
      if (this._handlers[ctx] && this._handlers[ctx][key]) {
        e.preventDefault();
        this._handlers[ctx][key]();
        return;
      }
    });
  },

  // Register a shortcut: register('drill-preflop', 'f', () => fold())
  register(context, key, handler) {
    if (!this._handlers[context]) this._handlers[context] = {};
    this._handlers[context][key.toLowerCase()] = handler;
  },

  // Set active context
  setContext(ctx) {
    this._context = ctx;
  },

  getContext() {
    return this._context;
  },

  enable() { this._enabled = true; },
  disable() { this._enabled = false; }
};
