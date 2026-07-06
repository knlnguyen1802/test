window.GTO = window.GTO || {};

GTO.Env = {
  _vars: {},

  // Fetch and parse .env file, then apply known keys to app state
  load: async function() {
    // .env fetch only works over http(s), skip for file:// protocol
    if (window.location.protocol === 'file:') return;
    try {
      var response = await fetch('.env');
      if (!response.ok) return; // No .env file — that's fine
      var text = await response.text();
      this._parse(text);
      this._apply();
    } catch (e) {
      // .env not found or fetch failed — silent, not required
    }
  },

  _parse: function(text) {
    var lines = text.split('\n');
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line || line.charAt(0) === '#') continue;
      var eqIdx = line.indexOf('=');
      if (eqIdx < 0) continue;
      var key = line.substring(0, eqIdx).trim();
      var val = line.substring(eqIdx + 1).trim();
      // Strip surrounding quotes if present
      if ((val.charAt(0) === '"' && val.charAt(val.length - 1) === '"') ||
          (val.charAt(0) === "'" && val.charAt(val.length - 1) === "'")) {
        val = val.substring(1, val.length - 1);
      }
      this._vars[key] = val;
    }
  },

  _apply: function() {
    // Map env vars to app settings (only if not already set by user)
    var mapping = {
      'GROQ_API_KEY': 'settings.groqApiKey'
    };

    for (var envKey in mapping) {
      if (!this._vars[envKey]) continue;
      var statePath = mapping[envKey];
      var current = GTO.State.get(statePath);
      // Only apply if the current value is empty/unset
      if (!current) {
        GTO.State.set(statePath, this._vars[envKey]);
      }
    }
  },

  get: function(key) {
    return this._vars[key] || '';
  }
};
