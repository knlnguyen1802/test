window.GTO = window.GTO || {};

GTO.State = {
  _state: {},
  _listeners: {},

  init() {
    // Load persisted state
    this._state = {
      settings: GTO.Storage.get('settings', {
        format: 'cash',
        stackDepths: ['100bb'],
        positions: ['UTG','MP','CO','BTN','SB','BB'],
        groqApiKey: '',
        soundEnabled: false,
        theme: 'bloomberg'
      }),
      currentDrill: null,
      session: null,
      history: GTO.Storage.get('history', []),
      analytics: GTO.Storage.get('analytics', {
        byPosition: {},
        byStackDepth: {},
        bySpotType: {},
        byActionContext: {},
        overall: { total: 0, correct: 0, evLoss: 0 }
      }),
      trainingPlans: GTO.Storage.get('plans', []),
      activePlan: GTO.Storage.get('activePlan', null),
      activeView: 'explore'
    };

    return this;
  },

  get(path) {
    const parts = path.split('.');
    let val = this._state;
    for (const p of parts) {
      if (val === undefined || val === null) return undefined;
      val = val[p];
    }
    return val;
  },

  set(path, value) {
    const parts = path.split('.');
    let obj = this._state;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!obj[parts[i]]) obj[parts[i]] = {};
      obj = obj[parts[i]];
    }
    obj[parts[parts.length - 1]] = value;

    // Persist certain state slices
    const root = parts[0];
    if (['settings','history','analytics','trainingPlans','activePlan'].includes(root)) {
      this._persist(root);
    }

    // Emit change event
    this.emit(path, value);
    this.emit(root, this._state[root]);
  },

  _persist: GTO.Utils.debounce(function(key) {
    const keyMap = {
      settings: 'settings',
      history: 'history',
      analytics: 'analytics',
      trainingPlans: 'plans',
      activePlan: 'activePlan'
    };
    GTO.Storage.set(keyMap[key] || key, GTO.State._state[key]);
  }, 500),

  on(event, callback) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(callback);
  },

  off(event, callback) {
    if (!this._listeners[event]) return;
    this._listeners[event] = this._listeners[event].filter(cb => cb !== callback);
  },

  emit(event, data) {
    if (this._listeners[event]) {
      this._listeners[event].forEach(cb => cb(data));
    }
  }
};
