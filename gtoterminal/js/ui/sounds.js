// GTOTerminal — Sound Effects (Web Audio API)
// Soft, mechanical, retro-terminal sounds. No audio files needed.

window.GTO = window.GTO || {};
GTO.UI = GTO.UI || {};

GTO.UI.Sounds = {
  _ctx: null,

  _ensureContext: function() {
    if (!this._ctx) {
      this._ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (this._ctx.state === 'suspended') {
      this._ctx.resume();
    }
    return this._ctx;
  },

  play: function(name) {
    var settings = GTO.State.get('settings');
    if (!settings || !settings.soundEnabled) return;

    try {
      var fn = this['_' + name];
      if (fn) fn.call(this);
    } catch (e) {
      // Silently fail — sounds are non-critical
    }
  },

  // Helper: create a noise buffer for mechanical sounds
  _noiseBuffer: function(ctx, duration) {
    var sr = ctx.sampleRate;
    var len = sr * duration;
    var buf = ctx.createBuffer(1, len, sr);
    var data = buf.getChannelData(0);
    for (var i = 0; i < len; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buf;
  },

  // ── Sound Definitions ──

  // Correct answer — soft double-ping, gentle and warm
  _correct: function() {
    var ctx = this._ensureContext();
    var now = ctx.currentTime;

    var osc1 = ctx.createOscillator();
    var gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.value = 600;
    gain1.gain.setValueAtTime(0.07, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.12);

    var osc2 = ctx.createOscillator();
    var gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.value = 800;
    gain2.gain.setValueAtTime(0.07, now + 0.07);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.07);
    osc2.stop(now + 0.2);
  },

  // Wrong answer — soft low thump, not buzzy
  _incorrect: function() {
    var ctx = this._ensureContext();
    var now = ctx.currentTime;

    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(200, now);
    osc.frequency.exponentialRampToValueAtTime(120, now + 0.1);
    gain.gain.setValueAtTime(0.06, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.15);
  },

  // Soft tick — tiny mechanical click for toggles/chips
  _tick: function() {
    var ctx = this._ensureContext();
    var now = ctx.currentTime;

    // Short filtered noise burst = typewriter key
    var noise = ctx.createBufferSource();
    noise.buffer = this._noiseBuffer(ctx, 0.02);
    var filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 3000;
    filter.Q.value = 2;
    var gain = ctx.createGain();
    gain.gain.setValueAtTime(0.04, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.02);
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    noise.start(now);
    noise.stop(now + 0.02);
  },

  // Thock — slightly heavier mechanical press for buttons (start drill, next hand)
  _thock: function() {
    var ctx = this._ensureContext();
    var now = ctx.currentTime;

    // Low thump component
    var osc = ctx.createOscillator();
    var oscGain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(400, now);
    osc.frequency.exponentialRampToValueAtTime(150, now + 0.04);
    oscGain.gain.setValueAtTime(0.06, now);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
    osc.connect(oscGain);
    oscGain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.05);

    // Click noise on top
    var noise = ctx.createBufferSource();
    noise.buffer = this._noiseBuffer(ctx, 0.015);
    var filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 2000;
    var nGain = ctx.createGain();
    nGain.gain.setValueAtTime(0.03, now);
    nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.015);
    noise.connect(filter);
    filter.connect(nGain);
    nGain.connect(ctx.destination);
    noise.start(now);
    noise.stop(now + 0.015);
  },

  // Tab switch — soft clack
  _tab: function() {
    var ctx = this._ensureContext();
    var now = ctx.currentTime;

    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(500, now);
    osc.frequency.exponentialRampToValueAtTime(250, now + 0.03);
    gain.gain.setValueAtTime(0.04, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.04);
  },

  // Deal — card snap, short percussive
  _deal: function() {
    var ctx = this._ensureContext();
    var now = ctx.currentTime;

    var noise = ctx.createBufferSource();
    noise.buffer = this._noiseBuffer(ctx, 0.03);
    var filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 2500;
    filter.Q.value = 1.5;
    var gain = ctx.createGain();
    gain.gain.setValueAtTime(0.05, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.03);
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    noise.start(now);
    noise.stop(now + 0.03);
  },

  // Session complete — gentle three-note chime, quiet
  _complete: function() {
    var ctx = this._ensureContext();
    var now = ctx.currentTime;
    var notes = [523, 659, 784]; // C5, E5, G5

    for (var i = 0; i < notes.length; i++) {
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = notes[i];
      var t = now + i * 0.1;
      gain.gain.setValueAtTime(0.06, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.2);
    }
  },

  // Action button press (fold/call/raise) — decisive click
  _action: function() {
    var ctx = this._ensureContext();
    var now = ctx.currentTime;

    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(350, now);
    osc.frequency.exponentialRampToValueAtTime(200, now + 0.03);
    gain.gain.setValueAtTime(0.04, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.04);
  },

  // Navigate / view range — soft whoosh-click
  _nav: function() {
    var ctx = this._ensureContext();
    var now = ctx.currentTime;

    var noise = ctx.createBufferSource();
    noise.buffer = this._noiseBuffer(ctx, 0.04);
    var filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(4000, now);
    filter.frequency.exponentialRampToValueAtTime(500, now + 0.04);
    var gain = ctx.createGain();
    gain.gain.setValueAtTime(0.03, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    noise.start(now);
    noise.stop(now + 0.04);
  }
};
