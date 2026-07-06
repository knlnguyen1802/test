window.GTO = window.GTO || {};

GTO.Utils = {
  // Random integer between min and max inclusive
  randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; },

  // Pick random element from array
  randPick(arr) { return arr[Math.floor(Math.random() * arr.length)]; },

  // Weighted random pick - items is [{item, weight}]
  weightedPick(items) {
    const total = items.reduce((s, i) => s + i.weight, 0);
    let r = Math.random() * total;
    for (const {item, weight} of items) {
      r -= weight;
      if (r <= 0) return item;
    }
    return items[items.length - 1].item;
  },

  // Format number with sign
  formatEV(val) {
    if (val === 0) return '0.00bb';
    return (val > 0 ? '+' : '') + val.toFixed(2) + 'bb';
  },

  // Format percentage
  formatPct(val) { return Math.round(val * 100) + '%'; },

  // Debounce function
  debounce(fn, ms) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), ms);
    };
  },

  // Generate unique ID
  uid() { return Date.now().toString(36) + Math.random().toString(36).substr(2, 5); },

  // Clamp number
  clamp(val, min, max) { return Math.min(Math.max(val, min), max); },

  // Deep clone
  clone(obj) { return JSON.parse(JSON.stringify(obj)); },

  // Format date as "Feb 22"
  formatDate(d) {
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const date = new Date(d);
    return months[date.getMonth()] + ' ' + date.getDate();
  },

  // Format time as HH:MM
  formatTime() {
    const d = new Date();
    return d.getHours().toString().padStart(2,'0') + ':' + d.getMinutes().toString().padStart(2,'0');
  },

  // Shuffle array in place (Fisher-Yates)
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
};
