window.GTO = window.GTO || {};

GTO.Storage = {
  VERSION: 1,

  get(key, defaultVal) {
    try {
      const raw = localStorage.getItem('gto_' + key);
      if (raw === null) return defaultVal;
      const parsed = JSON.parse(raw);
      return parsed;
    } catch(e) {
      return defaultVal;
    }
  },

  set(key, value) {
    try {
      localStorage.setItem('gto_' + key, JSON.stringify(value));
    } catch(e) {
      console.warn('Storage write failed:', e);
    }
  },

  remove(key) {
    localStorage.removeItem('gto_' + key);
  },

  clear() {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k.startsWith('gto_')) keys.push(k);
    }
    keys.forEach(k => localStorage.removeItem(k));
  },

  // Get storage usage in bytes (approximate)
  getUsage() {
    let total = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k.startsWith('gto_')) {
        total += k.length + (localStorage.getItem(k) || '').length;
      }
    }
    return total;
  }
};
