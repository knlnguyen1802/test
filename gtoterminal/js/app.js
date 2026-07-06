window.GTO = window.GTO || {};

GTO.App = {
  init: function() {
    // Initialize core systems
    GTO.State.init();
    GTO.Env.load(); // Load .env file (async, applies API key if present)
    GTO.Keyboard.init();

    // Initialize UI
    GTO.UI.Panels.init();
    GTO.UI.Nav.init();
    GTO.UI.Modal.init();

    // Load settings into UI
    this._loadSettings();

    // Set up views
    this._setupExplore();
    this._setupDrillTypeSelector();
    this._setupPreflopDrill();
    this._setupPostflopDrill();
    this._setupTournamentDrill();
    this._setupSessionSummary();
    this._setupPlaythrough();
    this._setupPlans();
    this._setupLearn();
    this._setupStream();
    this._setupICMToggle();

    // Global keyboard shortcuts
    GTO.Keyboard.register('global', '?', function() { GTO.UI.Modal.open('modal-help'); });
    GTO.Keyboard.register('global', 'escape', function() { GTO.UI.Modal.closeAll(); });

    // Settings button
    var settingsBtn = document.getElementById('btn-settings');
    if (settingsBtn) settingsBtn.addEventListener('click', function() { GTO.UI.Modal.open('modal-settings'); });
    var helpBtn = document.getElementById('btn-help');
    if (helpBtn) helpBtn.addEventListener('click', function() { GTO.UI.Modal.open('modal-help'); });

    // Status bar clock
    this._updateClock();
    setInterval(this._updateClock, 60000);

    // Update format display
    GTO.UI.HUD.updateFormat(GTO.State.get('settings.format'));

    console.log('%c[GTOTerminal] Ready.', 'color: #ff8c00; font-weight: bold');
  },

  _loadSettings: function() {
    var settings = GTO.State.get('settings');
    // Load API key into settings modal
    var apiKeyInput = document.getElementById('settings-api-key');
    if (apiKeyInput && settings.groqApiKey) apiKeyInput.value = settings.groqApiKey;

    // Save settings on change
    if (apiKeyInput) {
      apiKeyInput.addEventListener('change', function() {
        GTO.State.set('settings.groqApiKey', this.value);
        GTO.UI.Toast.success('API key saved');
      });
    }

    // Settings toggle handlers
    var self = this;
    document.querySelectorAll('#modal-settings .toggle-option').forEach(function(opt) {
      opt.addEventListener('click', function() {
        var group = this.parentElement;
        group.querySelectorAll('.toggle-option').forEach(function(o) { o.classList.remove('active'); });
        this.classList.add('active');
        if (GTO.UI.Sounds) GTO.UI.Sounds.play('tick');
        var val = this.getAttribute('data-value');
        if (group.id === 'settings-format') {
          GTO.State.set('settings.format', val);
          GTO.UI.HUD.updateFormat(val);
        } else if (group.id === 'settings-sound') {
          GTO.State.set('settings.soundEnabled', val === 'on');
        } else if (group.id === 'settings-accent') {
          GTO.State.set('settings.accentColor', val);
          self._applyTheme();
        } else if (group.id === 'settings-range-scheme') {
          GTO.State.set('settings.rangeScheme', val);
          self._applyTheme();
        } else if (group.id === 'settings-boot') {
          localStorage.setItem('gto_settings_showBoot', val === 'on' ? 'true' : 'false');
        }
      });
    });

    // Restore saved settings to UI
    var savedAccent = settings.accentColor || 'orange';
    var savedScheme = settings.rangeScheme || 'classic';
    var savedSound = settings.soundEnabled ? 'on' : 'off';
    var savedBoot = localStorage.getItem('gto_settings_showBoot') === 'true' ? 'on' : 'off';
    ['settings-accent', 'settings-range-scheme', 'settings-sound', 'settings-boot'].forEach(function(gid) {
      var grp = document.getElementById(gid);
      if (!grp) return;
      var target = gid === 'settings-accent' ? savedAccent :
                   gid === 'settings-range-scheme' ? savedScheme :
                   gid === 'settings-boot' ? savedBoot : savedSound;
      grp.querySelectorAll('.toggle-option').forEach(function(o) {
        o.classList.toggle('active', o.getAttribute('data-value') === target);
      });
    });

    // Apply theme on load
    this._applyTheme();

    // Reset data button
    var resetBtn = document.getElementById('btn-reset-data');
    if (resetBtn) {
      resetBtn.addEventListener('click', function() {
        if (confirm('Reset all training data? This cannot be undone.')) {
          GTO.Storage.clear();
          GTO.State.init();
          GTO.UI.Toast.info('All data reset');
          location.reload();
        }
      });
    }
  },

  // ── Theme / Personalization ──

  _ACCENT_PRESETS: {
    orange:  { accent: '#ff8c00', dim: '#cc7000', glow: 'rgba(255, 140, 0, 0.15)', rgb: '255, 140, 0' },
    green:   { accent: '#4af6c3', dim: '#2db88e', glow: 'rgba(74, 246, 195, 0.15)', rgb: '74, 246, 195' },
    blue:    { accent: '#4a9eff', dim: '#2b7cd6', glow: 'rgba(74, 158, 255, 0.15)', rgb: '74, 158, 255' },
    cyan:    { accent: '#00e5ff', dim: '#00b0c4', glow: 'rgba(0, 229, 255, 0.15)', rgb: '0, 229, 255' },
    purple:  { accent: '#b388ff', dim: '#8c5dcc', glow: 'rgba(179, 136, 255, 0.15)', rgb: '179, 136, 255' },
    red:     { accent: '#ff5252', dim: '#cc3333', glow: 'rgba(255, 82, 82, 0.15)', rgb: '255, 82, 82' },
    gold:    { accent: '#ffd700', dim: '#b39700', glow: 'rgba(255, 215, 0, 0.15)', rgb: '255, 215, 0' }
  },

  _RANGE_PRESETS: {
    classic: { raise: '74, 246, 195',  call: '0, 104, 255',   raiseColor: '#4af6c3', callColor: '#0068ff' },
    warm:    { raise: '255, 140, 0',   call: '255, 215, 0',   raiseColor: '#ff8c00', callColor: '#ffd700' },
    cool:    { raise: '0, 229, 255',   call: '179, 136, 255', raiseColor: '#00e5ff', callColor: '#b388ff' },
    mono:    { raise: '220, 220, 220', call: '120, 120, 120', raiseColor: '#dcdcdc', callColor: '#787878' },
    redblue: { raise: '255, 82, 82',   call: '74, 158, 255',  raiseColor: '#ff5252', callColor: '#4a9eff' }
  },

  _applyTheme: function() {
    var settings = GTO.State.get('settings');
    var accentKey = settings.accentColor || 'orange';
    var rangeKey = settings.rangeScheme || 'classic';

    var accent = this._ACCENT_PRESETS[accentKey] || this._ACCENT_PRESETS.orange;
    var range = this._RANGE_PRESETS[rangeKey] || this._RANGE_PRESETS.classic;

    var root = document.documentElement.style;
    root.setProperty('--accent', accent.accent);
    root.setProperty('--accent-dim', accent.dim);
    root.setProperty('--accent-glow', accent.glow);
    root.setProperty('--accent-rgb', accent.rgb);
    root.setProperty('--range-raise', range.raise);
    root.setProperty('--range-call', range.call);
    root.setProperty('--range-raise-color', range.raiseColor);
    root.setProperty('--range-call-color', range.callColor);

    // Re-render matrix so inline styles pick up new range colors
    if (this._updateExploreMatrix) this._updateExploreMatrix();
  },

  _setupPreflopDrill: function() {
    var self = this;

    // Config UI: toggle chips
    document.querySelectorAll('#preflop-config .checkbox-chip').forEach(function(chip) {
      chip.addEventListener('click', function() { this.classList.toggle('checked'); if (GTO.UI.Sounds) GTO.UI.Sounds.play('tick'); });
    });
    document.querySelectorAll('#preflop-config .toggle-option').forEach(function(opt) {
      opt.addEventListener('click', function() {
        var group = this.parentElement;
        group.querySelectorAll('.toggle-option').forEach(function(o) { o.classList.remove('active'); });
        this.classList.add('active');
        if (GTO.UI.Sounds) GTO.UI.Sounds.play('tick');
      });
    });

    // Start drill button
    var startBtn = document.getElementById('btn-start-preflop');
    if (startBtn) {
      startBtn.addEventListener('click', function() { self._startPreflopSession(); });
    }

    // Action buttons
    var actionBtns = document.querySelectorAll('#preflop-actions .action-btn');
    actionBtns.forEach(function(btn) {
      btn.addEventListener('click', function() {
        var action = this.getAttribute('data-action');
        if (action) self._submitPreflopAction(action);
      });
    });

    // Keyboard shortcuts for drill
    GTO.Keyboard.register('drill-preflop', 'f', function() { self._submitPreflopAction('fold'); });
    GTO.Keyboard.register('drill-preflop', 'c', function() { self._submitPreflopAction('call'); });
    GTO.Keyboard.register('drill-preflop', 'r', function() { self._submitPreflopAction('raise'); });
    GTO.Keyboard.register('result', 'n', function() { self._nextDrill(); });
    GTO.Keyboard.register('result', ' ', function() { self._nextDrill(); });

    // Next button (added dynamically in feedback area)
    // Drills advance via keyboard Space/N

    // AI explain button
    var explainBtn = document.getElementById('btn-explain-preflop');
    if (explainBtn) {
      explainBtn.addEventListener('click', function() { self._requestAIExplanation(); });
    }
    GTO.Keyboard.register('result', 'e', function() { self._requestAIExplanation(); });
  },

  _startPreflopSession: function() {
    if (GTO.UI.Sounds) GTO.UI.Sounds.play('thock');
    // Read config from UI
    var format = 'cash';
    var formatToggle = document.querySelector('#preflop-format-toggle .toggle-option.active');
    if (formatToggle) format = formatToggle.getAttribute('data-value') || 'cash';

    var stackDepths = [];
    document.querySelectorAll('#preflop-stack-chips .checkbox-chip.checked').forEach(function(c) {
      stackDepths.push(c.getAttribute('data-value'));
    });
    if (stackDepths.length === 0) stackDepths = ['100bb'];

    var positions = [];
    document.querySelectorAll('#preflop-position-chips .checkbox-chip.checked').forEach(function(c) {
      positions.push(c.getAttribute('data-value'));
    });
    if (positions.length === 0) positions = GTO.Data.POSITIONS.slice();

    var actionContexts = [];
    document.querySelectorAll('#preflop-action-chips .checkbox-chip.checked').forEach(function(c) {
      actionContexts.push(c.getAttribute('data-value'));
    });
    if (actionContexts.length === 0) actionContexts = ['rfi'];

    var countEl = document.querySelector('#preflop-drill-count .toggle-option.active');
    var count = countEl ? parseInt(countEl.getAttribute('data-value')) || 0 : 50;

    var config = {
      drillType: 'preflop',
      format: format,
      stackDepths: stackDepths,
      positions: positions,
      actionContexts: actionContexts,
      count: count
    };

    var self = this;
    GTO.Engine.DrillEngine.startSession(config, {
      onScenario: function(scenario, index) { self._renderPreflopScenario(scenario, index); },
      onResult: function(result, scenario) { self._renderPreflopResult(result, scenario); },
      onSessionEnd: function(session) { self._renderSessionEnd(session); }
    });

    // Show active drill, hide config
    var configEl = document.getElementById('preflop-config');
    var activeEl = document.getElementById('preflop-active');
    if (configEl) configEl.classList.add('hidden');
    if (activeEl) activeEl.classList.remove('hidden');

    GTO.Keyboard.setContext('drill-preflop');
    this._showDrillProgress();
  },

  _renderPreflopScenario: function(scenario, index) {
    // Render cards
    GTO.UI.BoardDisplay.renderHoleCards('hero-cards', scenario.cards);

    // Update table display
    GTO.UI.HUD.updateTable('table-display', scenario.position, scenario.villainPosition);

    // Update stat rows
    GTO.UI.HUD.updateStat('stat-position', scenario.position + ' (' + (GTO.Data.POSITION_NAMES[scenario.position] || '') + ')');
    GTO.UI.HUD.updateStat('stat-stack', scenario.stackDepth);
    GTO.UI.HUD.updateStat('stat-villain', scenario.villainPosition ? scenario.villainPosition + ' opens' : 'Folds to you');
    GTO.UI.HUD.updateStat('stat-action', scenario.description);

    // Show/hide call button based on context
    var callBtn = document.querySelector('#preflop-actions .btn-call');
    if (callBtn) {
      callBtn.style.display = scenario.actionContext === 'rfi' ? 'none' : 'flex';
    }

    // Update action labels
    var labels = GTO.Engine.PreflopDrill.getActionLabels(scenario.actionContext);
    document.querySelectorAll('#preflop-actions .action-btn').forEach(function(btn) {
      var action = btn.getAttribute('data-action');
      var labelEl = btn.querySelector('.action-label');
      if (labelEl && labels[action]) labelEl.textContent = labels[action];
    });

    // Clear feedback and matrix
    var feedbackEmpty = document.getElementById('feedback-empty');
    var feedbackContent = document.getElementById('feedback-content');
    if (feedbackEmpty) feedbackEmpty.classList.remove('hidden');
    if (feedbackContent) feedbackContent.classList.add('hidden');
    GTO.UI.HandMatrix.clearMatrix('hand-matrix-table');

    // Clear summary bar, position bar, stats
    var summaryBar = document.getElementById('drill-summary-bar');
    if (summaryBar) summaryBar.innerHTML = '';
    var posBar = document.getElementById('feedback-position-bar');
    if (posBar) posBar.innerHTML = '';
    var eqEl = document.getElementById('feedback-equity');
    if (eqEl) eqEl.textContent = '--';
    var poEl = document.getElementById('feedback-pot-odds');
    if (poEl) poEl.textContent = '--';

    // Enable action buttons
    document.querySelectorAll('#preflop-actions .action-btn').forEach(function(b) { b.disabled = false; });

    // Update status bar
    GTO.UI.HUD.updateStatusBar(GTO.Engine.DrillEngine.getProgress());

    // Hide AI insight
    var aiInsight = document.getElementById('ai-insight-preflop');
    if (aiInsight) aiInsight.classList.add('hidden');
    var explainBtn = document.getElementById('btn-explain-preflop');
    if (explainBtn) explainBtn.style.display = 'none';
  },

  _submitPreflopAction: function(action) {
    if (!GTO.Engine.DrillEngine.isActive()) return;
    if (GTO.Keyboard.getContext() !== 'drill-preflop') return;
    if (GTO.UI.Sounds) GTO.UI.Sounds.play('action');

    var result = GTO.Engine.DrillEngine.submitAnswer(action);
    if (!result) return;

    // Disable action buttons
    document.querySelectorAll('#preflop-actions .action-btn').forEach(function(b) { b.disabled = true; });

    // Switch to result context
    GTO.Keyboard.setContext('result');
  },

  _renderPreflopResult: function(result, scenario) {
    // Use passed scenario directly (always valid); fall back to engine state
    var currentScenario = scenario || GTO.Engine.DrillEngine.getCurrentScenario();

    var feedbackEmpty = document.getElementById('feedback-empty');
    var feedbackContent = document.getElementById('feedback-content');
    if (feedbackEmpty) feedbackEmpty.classList.add('hidden');
    if (feedbackContent) {
      feedbackContent.classList.remove('hidden');
      feedbackContent.style.display = '';
    }

    // Update hand matrix with full range FIRST (most important visual)
    try {
      if (currentScenario) {
        GTO.UI.HandMatrix.showPreflopRange('hand-matrix-table', currentScenario);
        var drillRangeData = GTO.Engine.PreflopDrill.getRangeForScenario(currentScenario);
        GTO.UI.HandMatrix.updateSummaryBar('drill-summary-bar', drillRangeData);
      }
    } catch(e) {
      console.error('[Drill] Matrix update error:', e);
    }

    // GTO Frequency bars
    var freqs = result.gtoFreqs || {};
    this._renderFreqBar('freq-fold', freqs.fold || 0);
    this._renderFreqBar('freq-call', freqs.call || 0);
    this._renderFreqBar('freq-raise', freqs.raise || 0);

    // Verdict
    var verdictEl = document.getElementById('verdict');
    if (verdictEl) {
      verdictEl.className = 'verdict ' + GTO.Engine.Scoring.getVerdictClass(result.verdict);
      var verdictHtml = '<span class="verdict-icon">' + GTO.Engine.Scoring.getVerdictIcon(result.verdict) + '</span> ' +
        'You chose <strong>' + (result.userAction || '?').toUpperCase() + '</strong> — ' + GTO.Engine.Scoring.getVerdictLabel(result.verdict);
      if (result.verdict !== 'optimal' && result.bestAction) {
        verdictHtml += '<div style="font-size:11px; font-weight:400; margin-top:4px; opacity:0.85;">GTO prefers <strong>' +
          result.bestAction.toUpperCase() + '</strong> (' + Math.round((result.bestFreq || 0) * 100) + '% frequency)</div>';
      }
      verdictEl.innerHTML = verdictHtml;
    }

    // EV stats
    try {
      GTO.UI.HUD.updateStat('ev-optimal', (result.bestAction || '?').toUpperCase() + ' (' + Math.round((result.bestFreq || 0) * 100) + '%)');
      GTO.UI.HUD.updateStat('ev-loss', GTO.Utils.formatEV(result.evLoss || 0));
    } catch(e) {}

    // Position context bar
    try {
      var posBar = document.getElementById('feedback-position-bar');
      if (posBar && currentScenario) {
        var positions = GTO.Data.POSITIONS || ['UTG','MP','CO','BTN','SB','BB'];
        var heroPos = currentScenario.position;
        var villainPos = currentScenario.villainPosition;
        var posHtml = '';
        positions.forEach(function(pos) {
          var cls = 'position-chip';
          if (pos === heroPos) cls += ' hero';
          if (pos === villainPos) cls += ' villain';
          posHtml += '<span class="' + cls + '">' + pos + '</span>';
        });
        posBar.innerHTML = posHtml;
      }
    } catch(e) {}

    // Hand equity + pot odds
    try {
      var equityEl = document.getElementById('feedback-equity');
      if (equityEl && currentScenario && currentScenario.hand) {
        var eq = GTO.Engine.HandEvaluator.estimatePreflopEquity(currentScenario.hand);
        equityEl.textContent = Math.round(eq * 100) + '%';
      }
      var potOddsEl = document.getElementById('feedback-pot-odds');
      if (potOddsEl && currentScenario) {
        if (currentScenario.actionContext === 'rfi') potOddsEl.textContent = 'N/A';
        else if (currentScenario.actionContext === 'vs_raise') potOddsEl.textContent = '~36%';
        else if (currentScenario.actionContext === 'vs_3bet') potOddsEl.textContent = '~38%';
        else if (currentScenario.actionContext === 'vs_4bet') potOddsEl.textContent = '~31%';
        else potOddsEl.textContent = '--';
      }
    } catch(e) {}

    // Update status bar + live progress
    GTO.UI.HUD.updateStatusBar(GTO.Engine.DrillEngine.getProgress());
    this._updateDrillProgress();

    // Show action buttons
    var explainBtnEl = document.getElementById('btn-explain-preflop');
    if (explainBtnEl) explainBtnEl.style.display = '';
    var viewRangeBtn = document.getElementById('btn-view-range-preflop');
    if (viewRangeBtn) viewRangeBtn.style.display = '';

    // Show next bar
    var nextBar = document.getElementById('drill-next-bar');
    if (nextBar) nextBar.classList.remove('hidden');

    // Store for AI + view range
    this._lastResult = result;
    this._lastScenario = currentScenario;
  },

  _renderFreqBar: function(id, value) {
    var fill = document.getElementById(id);
    if (!fill) return;
    fill.style.width = Math.round(value * 100) + '%';
    var valueEl = document.getElementById(id + '-val');
    if (valueEl) valueEl.textContent = Math.round(value * 100) + '%';
  },

  _nextDrill: function() {
    if (GTO.Keyboard.getContext() !== 'result') return;
    if (GTO.UI.Sounds) GTO.UI.Sounds.play('thock');

    // Hide next bar
    var nextBar = document.getElementById('drill-next-bar');
    if (nextBar) nextBar.classList.add('hidden');

    // Hide view-range + explain buttons
    var viewRangeBtn = document.getElementById('btn-view-range-preflop');
    if (viewRangeBtn) viewRangeBtn.style.display = 'none';
    var explainBtn = document.getElementById('btn-explain-preflop');
    if (explainBtn) explainBtn.style.display = 'none';
    var aiInsight = document.getElementById('ai-insight-preflop');
    if (aiInsight) aiInsight.classList.add('hidden');

    // Determine the correct drill keyboard context
    var session = GTO.Engine.DrillEngine.getSession();
    if (session) {
      var ctx = 'drill-' + session.type;
      if (ctx === 'drill-tournament') ctx = 'drill-mtt';
      GTO.Keyboard.setContext(ctx);
    } else {
      GTO.Keyboard.setContext('navigation');
    }
    GTO.Engine.DrillEngine.nextDrill();
  },

  _showDrillProgress: function() {
    var bar = document.getElementById('drill-progress-bar');
    if (bar) bar.classList.remove('hidden');
    // Reset
    var fill = document.getElementById('drill-progress-fill');
    if (fill) fill.style.width = '0%';
    var text = document.getElementById('drill-progress-text');
    if (text) text.textContent = '0/' + (GTO.Engine.DrillEngine.getProgress().total || '--');
    var acc = document.getElementById('drill-accuracy-live');
    if (acc) acc.textContent = '0%';
    var ev = document.getElementById('drill-ev-loss-live');
    if (ev) ev.textContent = '0.00 bb';
  },

  _hideDrillProgress: function() {
    var bar = document.getElementById('drill-progress-bar');
    if (bar) bar.classList.add('hidden');
    var nextBar = document.getElementById('drill-next-bar');
    if (nextBar) nextBar.classList.add('hidden');
  },

  _updateDrillProgress: function() {
    var progress = GTO.Engine.DrillEngine.getProgress();
    var fill = document.getElementById('drill-progress-fill');
    var text = document.getElementById('drill-progress-text');
    var acc = document.getElementById('drill-accuracy-live');
    var ev = document.getElementById('drill-ev-loss-live');
    if (fill) fill.style.width = (progress.total > 0 ? (progress.current / progress.total * 100) : 0) + '%';
    if (text) text.textContent = progress.current + '/' + (progress.total || '--');
    if (acc) acc.textContent = Math.round(progress.accuracy * 100) + '%';
    if (ev) ev.textContent = GTO.Utils.formatEV(progress.evLoss || 0);
  },

  _navigateToExploreWithScenario: function() {
    if (GTO.UI.Sounds) GTO.UI.Sounds.play('nav');
    var scenario = this._lastScenario;
    if (!scenario) return;

    // Pre-fill explore filters from the current scenario
    var setToggle = function(groupId, value) {
      var group = document.getElementById(groupId);
      if (!group) return;
      group.querySelectorAll('.toggle-option').forEach(function(o) { o.classList.remove('active'); });
      var match = group.querySelector('[data-value="' + value + '"]');
      if (match) match.classList.add('active');
    };

    setToggle('explore-mode', 'preflop');
    setToggle('explore-format', scenario.format || 'cash');
    setToggle('explore-stack', scenario.stackDepth || '100bb');
    setToggle('explore-position', scenario.position || 'UTG');
    setToggle('explore-action', scenario.actionContext || 'rfi');

    // Handle villain position for vs_raise/vs_3bet/vs_4bet
    if (scenario.actionContext === 'vs_raise' || scenario.actionContext === 'vs_3bet' || scenario.actionContext === 'vs_4bet') {
      var villainRow = document.getElementById('explore-villain-row');
      if (villainRow) villainRow.classList.remove('hidden');
      var posKey = scenario.positionKey || '';
      var parts = posKey.split('_');
      // vs_raise: villain_hero, vs_3bet: hero_villain, vs_4bet: villain_hero
      var villain = scenario.actionContext === 'vs_3bet' ? parts[1] : parts[0];
      if (villain) setToggle('explore-villain', villain);
    }

    // Switch to explore view and highlight the hand on the matrix
    GTO.UI.Nav.switchView('explore');
    this._exploreActiveHand = scenario.hand || null;
    this._updateExploreMatrix();
  },

  _requestAIExplanation: function(containerId) {
    if (!this._lastScenario || !this._lastResult) return;
    GTO.AI.InsightPanel.requestExplanation(
      this._lastScenario,
      this._lastResult.userAction || 'unknown',
      this._lastResult,
      containerId || 'ai-insight-body'
    );
  },

  _renderSessionEnd: function(session) {
    this._showSessionSummary(session, 'preflop');
  },

  _setupPostflopDrill: function() {
    var self = this;

    // Config toggles
    document.querySelectorAll('#postflop-config .checkbox-chip').forEach(function(c) {
      c.addEventListener('click', function() { this.classList.toggle('checked'); if (GTO.UI.Sounds) GTO.UI.Sounds.play('tick'); });
    });
    document.querySelectorAll('#postflop-config .toggle-option').forEach(function(opt) {
      opt.addEventListener('click', function() {
        this.parentElement.querySelectorAll('.toggle-option').forEach(function(o) { o.classList.remove('active'); });
        this.classList.add('active');
        if (GTO.UI.Sounds) GTO.UI.Sounds.play('tick');
      });
    });

    var startBtn = document.getElementById('btn-start-postflop');
    if (startBtn) {
      startBtn.addEventListener('click', function() { self._startPostflopSession(); });
    }

    // Postflop action buttons (both groups)
    // Dynamic action buttons — delegate clicks from container
    var dynActions = document.getElementById('postflop-dynamic-actions');
    if (dynActions) {
      dynActions.addEventListener('click', function(e) {
        var btn = e.target.closest('.action-btn');
        if (btn && !btn.disabled) {
          var action = btn.getAttribute('data-action');
          if (action) self._submitPostflopAction(action);
        }
      });
    }

    // Postflop AI explain button
    var postExplainBtn = document.getElementById('btn-explain-postflop');
    if (postExplainBtn) {
      postExplainBtn.addEventListener('click', function() { self._requestAIExplanation('ai-insight-postflop-body'); });
    }

    // Keyboard shortcuts registered dynamically per scenario in _registerPostflopKeys
    GTO.Keyboard.register('drill-postflop', 'x', function() { self._submitPostflopAction('check'); });
    GTO.Keyboard.register('drill-postflop', 'f', function() { self._submitPostflopAction('fold'); });
    GTO.Keyboard.register('drill-postflop', 'c', function() { self._submitPostflopAction('call'); });
    GTO.Keyboard.register('drill-postflop', 'r', function() { self._submitPostflopAction('raise'); });
    GTO.Keyboard.register('drill-postflop', 'a', function() { self._submitPostflopAction('allin'); });
    GTO.Keyboard.register('drill-postflop', '1', function() { self._submitPostflopAction('bet_33'); });
    GTO.Keyboard.register('drill-postflop', '2', function() { self._submitPostflopAction('bet_50'); });
    GTO.Keyboard.register('drill-postflop', '3', function() { self._submitPostflopAction('bet_67'); });
    GTO.Keyboard.register('drill-postflop', '4', function() { self._submitPostflopAction('bet_100'); });
  },

  _startPostflopSession: function() {
    if (GTO.UI.Sounds) GTO.UI.Sounds.play('thock');
    var spotTypes = [];
    document.querySelectorAll('#postflop-spot-chips .checkbox-chip.checked').forEach(function(c) {
      spotTypes.push(c.getAttribute('data-value'));
    });
    if (spotTypes.length === 0) spotTypes = ['IP_cbet_flop'];

    var countEl = document.querySelector('#postflop-drill-count .toggle-option.active');
    var count = countEl ? parseInt(countEl.getAttribute('data-value')) || 0 : 30;

    var formatEl = document.querySelector('#postflop-format-toggle .toggle-option.active');
    var format = formatEl ? formatEl.getAttribute('data-value') : (GTO.State.get('settings.format') || 'cash');

    var matchups = [];
    document.querySelectorAll('#postflop-matchup-chips .checkbox-chip.checked').forEach(function(c) {
      matchups.push(c.getAttribute('data-value'));
    });

    var depths = [];
    document.querySelectorAll('#postflop-depth-chips .checkbox-chip.checked').forEach(function(c) {
      depths.push(c.getAttribute('data-value'));
    });

    var config = {
      drillType: 'postflop',
      format: format,
      spotTypes: spotTypes,
      matchups: matchups.length > 0 ? matchups : undefined,
      depths: depths.length > 0 ? depths : undefined,
      count: count
    };

    var self = this;
    GTO.Engine.DrillEngine.startSession(config, {
      onScenario: function(scenario, index) { self._renderPostflopScenario(scenario, index); },
      onResult: function(result, scenario) { self._renderPostflopResult(result, scenario); },
      onSessionEnd: function(session) { self._renderPostflopSessionEnd(session); }
    });

    var configEl = document.getElementById('postflop-config');
    var activeEl = document.getElementById('postflop-active');
    if (configEl) configEl.classList.add('hidden');
    if (activeEl) activeEl.classList.remove('hidden');

    GTO.Keyboard.setContext('drill-postflop');
    this._showDrillProgress();
  },

  _renderPostflopScenario: function(scenario) {
    GTO.UI.BoardDisplay.renderHoleCards('postflop-hero-cards', scenario.cards);
    GTO.UI.BoardDisplay.renderBoard('postflop-board-cards', scenario.boardCards);

    GTO.UI.HUD.updateStat('postflop-position', scenario.position + (scenario.isIP ? ' (IP)' : ' (OOP)'));
    GTO.UI.HUD.updateStat('postflop-pot', scenario.potSize + 'bb');
    GTO.UI.HUD.updateStat('postflop-stack', scenario.effectiveStack + 'bb');
    GTO.UI.HUD.updateStat('postflop-street', GTO.Data.PostflopSpotLabels ? GTO.Data.PostflopSpotLabels[scenario.spotType] : scenario.spotType);

    // Populate middle column: board display + texture analysis
    GTO.UI.BoardDisplay.renderBoard('board-display-cards', scenario.boardCards);

    var tex = scenario.boardTexture;
    var texLabel = GTO.Data.BoardTextureLabels ? GTO.Data.BoardTextureLabels[tex] : tex;
    GTO.UI.HUD.updateStat('texture-type', texLabel);

    var isWet = tex.indexOf('wet') >= 0 || tex === 'highly_connected';
    var isMonotone = tex === 'monotone';
    var isTwotone = tex.indexOf('twotone') >= 0;

    GTO.UI.HUD.updateStat('texture-wetness', isWet ? 'Wet' : 'Dry');
    GTO.UI.HUD.updateStat('texture-connect', tex === 'highly_connected' ? 'High' : (isWet ? 'Medium' : 'Low'));
    GTO.UI.HUD.updateStat('texture-flush', isMonotone ? 'Complete' : (isTwotone ? 'Draw Possible' : 'None'));

    if (scenario.boardCards && scenario.boardCards.length > 0) {
      var boardRanks = scenario.boardCards.map(function(c) { return GTO.Data.RANK_VALUES[c.rank]; });
      var highRank = Math.max.apply(null, boardRanks);
      var rankNames = {14:'A',13:'K',12:'Q',11:'J',10:'T',9:'9',8:'8',7:'7',6:'6',5:'5',4:'4',3:'3',2:'2'};
      GTO.UI.HUD.updateStat('texture-high', rankNames[highRank] || '--');
    }

    // Hand strength label
    var hsLabel = GTO.Data.HandStrengthLabels ? GTO.Data.HandStrengthLabels[scenario.handStrength] : scenario.handStrength;
    GTO.UI.HUD.updateStat('postflop-hand-strength', hsLabel || scenario.handStrength);

    // Range advantage estimate based on position
    var ipAdv = scenario.isIP ? 55 : 45;
    var ipBar = document.getElementById('range-adv-ip');
    var oopBar = document.getElementById('range-adv-oop');
    var ipVal = document.getElementById('range-adv-ip-val');
    var oopVal = document.getElementById('range-adv-oop-val');
    if (ipBar) ipBar.style.width = ipAdv + '%';
    if (oopBar) oopBar.style.width = (100 - ipAdv) + '%';
    if (ipVal) ipVal.textContent = ipAdv + '%';
    if (oopVal) oopVal.textContent = (100 - ipAdv) + '%';

    // Render dynamic action buttons from solver or fallback
    this._renderPostflopActions(scenario);

    var feedbackEl = document.getElementById('postflop-feedback-content');
    if (feedbackEl) feedbackEl.classList.add('hidden');
    var emptyEl = document.getElementById('postflop-feedback-empty');
    if (emptyEl) emptyEl.classList.remove('hidden');

    GTO.UI.HUD.updateStatusBar(GTO.Engine.DrillEngine.getProgress());
  },

  _renderPostflopActions: function(scenario) {
    var container = document.getElementById('postflop-dynamic-actions');
    if (!container) return;

    var actions = GTO.Engine.PostflopDrill.getAvailableActions(scenario.spotType, scenario);
    var labels = GTO.Engine.PostflopDrill.getActionLabels(scenario.spotType, scenario);
    var hints = GTO.Engine.PostflopDrill.getActionHints(scenario.spotType, scenario);

    var html = '';
    actions.forEach(function(key) {
      var label = labels[key] || key;
      var hint = hints[key] || '';
      var btnClass = 'action-btn';
      if (key === 'check') btnClass += ' btn-check';
      else if (key === 'fold') btnClass += ' btn-fold';
      else if (key === 'call') btnClass += ' btn-call';
      else btnClass += ' btn-raise';

      html += '<button class="' + btnClass + '" data-action="' + key + '">' +
        '<span class="key-hint">' + hint + '</span> ' + label + '</button>';
    });

    container.innerHTML = html;
  },

  _submitPostflopAction: function(action) {
    if (!GTO.Engine.DrillEngine.isActive()) return;
    if (GTO.Keyboard.getContext() !== 'drill-postflop') return;
    if (GTO.UI.Sounds) GTO.UI.Sounds.play('action');

    GTO.Engine.DrillEngine.submitAnswer(action);
    document.querySelectorAll('#postflop-dynamic-actions .action-btn').forEach(function(b) { b.disabled = true; });
    GTO.Keyboard.setContext('result');
  },

  _renderPostflopResult: function(result, scenario) {
    var feedbackEl = document.getElementById('postflop-feedback-content');
    var emptyEl = document.getElementById('postflop-feedback-empty');
    if (feedbackEl) feedbackEl.classList.remove('hidden');
    if (emptyEl) emptyEl.classList.add('hidden');

    // Render verdict
    var verdictEl = document.getElementById('postflop-verdict');
    if (verdictEl) {
      verdictEl.className = 'verdict ' + GTO.Engine.Scoring.getVerdictClass(result.verdict);
      var dataSourceBadge = '';
      if (result.dataSource) {
        var isSolver = result.dataSource === 'solver';
        dataSourceBadge = '<span style="font-size:9px; font-weight:700; padding:1px 5px; border-radius:3px; margin-left:8px; letter-spacing:0.05em; ' +
          (isSolver ? 'background:rgba(74,246,195,0.15); color:var(--green);' : 'background:rgba(255,215,0,0.15); color:var(--accent);') +
          '">' + result.dataSource.toUpperCase() + '</span>';
        if (!isSolver && scenario && scenario.matchup) {
          dataSourceBadge += '<button class="solver-action-btn" id="btn-solve-drill" ' +
            'style="margin-left:6px; font-size:9px; padding:1px 6px; vertical-align:middle;">SOLVE</button>';
        }
      }
      var verdictHtml = '<span class="verdict-icon">' + GTO.Engine.Scoring.getVerdictIcon(result.verdict) + '</span> ' +
        result.userAction.toUpperCase() + ' — ' + GTO.Engine.Scoring.getVerdictLabel(result.verdict) + dataSourceBadge;
      if (result.verdict !== 'optimal' && result.bestAction) {
        var betLabel = result.bestAction.replace('bet_33', 'Bet 1/3').replace('bet_50', 'Bet 1/2').replace('bet_67', 'Bet 2/3').replace('bet_100', 'Bet Pot').replace('allin', 'All-in').replace('check', 'Check').replace('fold', 'Fold').replace('call', 'Call').replace('raise', 'Raise');
        verdictHtml += '<div style="font-size:11px; font-weight:400; margin-top:4px; opacity:0.85;">GTO prefers <strong>' +
          betLabel + '</strong> (' + Math.round((result.bestFreq || 0) * 100) + '% frequency)</div>';
      }
      verdictEl.innerHTML = verdictHtml;

      // Attach live solve handler
      var solveBtn = document.getElementById('btn-solve-drill');
      if (solveBtn) {
        var self = this;
        solveBtn.addEventListener('click', function() { self._solveDrillSpot(); });
      }
    }

    // Render frequency bars for postflop
    var freqs = result.gtoFreqs || {};
    var barsContainer = document.getElementById('postflop-freq-bars');
    if (barsContainer) {
      var html = '';
      Object.keys(freqs).forEach(function(action) {
        var pct = Math.round(freqs[action] * 100);
        var label = action.replace('bet_', 'B').replace('check', 'Chk').replace('fold', 'Fold').replace('call', 'Call').replace('raise', 'Raise').replace('allin', 'All-in');
        html += '<div class="freq-bar-item">' +
          '<span class="freq-bar-label">' + label + '</span>' +
          '<div class="freq-bar-track"><div class="freq-bar-fill fill-bet" style="width:' + pct + '%"></div></div>' +
          '<span class="freq-bar-value">' + pct + '%</span>' +
        '</div>';
      });
      barsContainer.innerHTML = html;
    }

    // Range composition summary line
    var compLine = document.getElementById('drill-composition-line');
    var compText = document.getElementById('drill-composition-text');
    if (compLine && compText && scenario && GTO.Engine.RangeFilter && GTO.Engine.RangeFilter.analyzeComposition) {
      var compVisible = false;
      if (scenario.preflopContext && scenario.preflopAction) {
        var isIP = scenario.heroPosition === 'BTN' || scenario.heroPosition === 'CO';
        var side = isIP ? 'ip' : 'oop';
        var heroCtx = scenario.preflopContext[side + 'Context'];
        var heroPos = scenario.preflopContext[side + 'Position'];
        var heroRange = GTO.Engine.RangeFilter.buildActionRange(
          scenario.format || 'cash', scenario.depth || '100bb', heroCtx, heroPos, scenario.preflopAction
        );
        var boardObjs = (scenario.boardCards || []).map(function(c) {
          return typeof c === 'string' ? { rank: c[0], suit: c[1] } : c;
        });
        var comp = GTO.Engine.RangeFilter.analyzeComposition(heroRange, boardObjs);
        if (comp.total > 0) {
          var parts = [];
          if (Math.round(comp.monsters * 100) > 0) parts.push(Math.round(comp.monsters * 100) + '% monsters');
          if (Math.round(comp.strong * 100) > 0) parts.push(Math.round(comp.strong * 100) + '% strong');
          if (Math.round(comp.draws * 100) > 0) parts.push(Math.round(comp.draws * 100) + '% draws');
          if (Math.round(comp.air * 100) > 0) parts.push(Math.round(comp.air * 100) + '% air');
          compText.textContent = parts.join(', ');
          compLine.style.display = '';
          compVisible = true;
        }
      }
      if (!compVisible) compLine.style.display = 'none';
    }

    // Populate postflop EV stats
    var bestLabel = (result.bestAction || '').replace('bet_33', 'Bet 1/3').replace('bet_50', 'Bet 1/2').replace('bet_67', 'Bet 2/3').replace('bet_100', 'Bet Pot').replace('allin', 'All-in').replace('check', 'Check').replace('fold', 'Fold').replace('call', 'Call').replace('raise', 'Raise');
    GTO.UI.HUD.updateStat('post-ev-yours', result.userAction ? result.userAction.replace('bet_33', 'Bet 1/3').replace('bet_50', 'Bet 1/2').replace('bet_67', 'Bet 2/3').replace('bet_100', 'Bet Pot').replace('allin', 'All-in').replace('check', 'Check').replace('fold', 'Fold').replace('call', 'Call').replace('raise', 'Raise') : '--');
    GTO.UI.HUD.updateStat('post-ev-optimal', bestLabel || '--');
    GTO.UI.HUD.updateStat('post-ev-loss', result.evLoss != null ? GTO.Utils.formatEV(result.evLoss) : '--');

    GTO.UI.HUD.updateStatusBar(GTO.Engine.DrillEngine.getProgress());
    this._updateDrillProgress();

    // Show next bar
    var nextBar = document.getElementById('drill-next-bar');
    if (nextBar) nextBar.classList.remove('hidden');

    this._lastResult = result;
    this._lastScenario = scenario;
  },

  _renderPostflopSessionEnd: function(session) {
    this._showSessionSummary(session, 'postflop');
  },

  _solveDrillSpot: function() {
    var scenario = this._lastScenario;
    var userAction = this._lastResult ? this._lastResult.userAction : null;
    if (!scenario || !userAction) return;

    // Show spinner on button
    var btn = document.getElementById('btn-solve-drill');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="solver-spinner"></span>';
    }

    var self = this;
    var boardCards = scenario.boardCards;
    // Ensure string format
    if (boardCards && boardCards.length > 0 && typeof boardCards[0] !== 'string') {
      boardCards = boardCards.map(function(c) {
        return (c.rank || c.r || '') + (c.suit || c.s || '');
      });
    }

    GTO.Engine.PostflopLookup.solveLive({
      spotType: scenario.spotType,
      boardCards: boardCards,
      matchup: scenario.matchup,
      depth: scenario.depth
    }, function(solverResult) {
      if (!solverResult) {
        if (btn) { btn.textContent = 'FAILED'; btn.style.color = 'var(--red)'; }
        return;
      }

      // Re-score with solver data — apply ICM if MTT
      var scoringFreqs = solverResult.freqs;
      var icmEnabled = scenario.format === 'mtt' && scenario.icmContext &&
        GTO.Engine.ICM && GTO.State.get('icmEnabled') !== false;
      if (icmEnabled && scoringFreqs && scenario.icmContext.bubbleFactor > 1.0) {
        var icmSpot = GTO.Engine.ICM.resolveSpotType(scenario);
        scoringFreqs = GTO.Engine.ICM.adjustFrequencies(scoringFreqs, scenario.icmContext.bubbleFactor, icmSpot);
      }
      // Range composition adjustment
      if (scoringFreqs && scenario.preflopContext && scenario.preflopAction &&
          GTO.Engine.RangeFilter && GTO.Engine.RangeFilter.adjustForComposition) {
        var isIP = scenario.heroPosition === 'BTN' || scenario.heroPosition === 'CO';
        var side = isIP ? 'ip' : 'oop';
        var heroCtx = scenario.preflopContext[side + 'Context'];
        var heroPos = scenario.preflopContext[side + 'Position'];
        var heroRange = GTO.Engine.RangeFilter.buildActionRange(
          scenario.format || 'cash', scenario.depth || '100bb', heroCtx, heroPos, scenario.preflopAction
        );
        var boardObjs = (scenario.boardCards || []).map(function(c) {
          return typeof c === 'string' ? { rank: c[0], suit: c[1] } : c;
        });
        var comp = GTO.Engine.RangeFilter.analyzeComposition(heroRange, boardObjs);
        if (comp.total > 0) {
          scoringFreqs = GTO.Engine.RangeFilter.adjustForComposition(scoringFreqs, comp, scenario.spotType);
        }
      }
      var newResult = GTO.Engine.Scoring.scorePostflop(
        scoringFreqs, userAction, { potSize: scenario.potSize || 6.5 }
      );
      newResult.dataSource = 'solver';
      if (icmEnabled) {
        newResult.rawGtoFreqs = solverResult.freqs;
        GTO.Engine.Scoring.scoreWithICM(newResult, scenario.icmContext, 0.5);
      }

      // Update stored result
      self._lastResult = newResult;
      self._renderPostflopResult(newResult, scenario);
    }, function(progress) {
      // Update button with progress
      if (btn && progress && progress.pctDone !== undefined) {
        btn.innerHTML = '<span class="solver-spinner"></span> ' + Math.round(progress.pctDone) + '%';
      }
    });
  },

  _setupTournamentDrill: function() {
    var self = this;

    document.querySelectorAll('#mtt-config .checkbox-chip').forEach(function(c) {
      c.addEventListener('click', function() { this.classList.toggle('checked'); if (GTO.UI.Sounds) GTO.UI.Sounds.play('tick'); });
    });
    document.querySelectorAll('#mtt-config .toggle-option').forEach(function(opt) {
      opt.addEventListener('click', function() {
        this.parentElement.querySelectorAll('.toggle-option').forEach(function(o) { o.classList.remove('active'); });
        this.classList.add('active');
        if (GTO.UI.Sounds) GTO.UI.Sounds.play('tick');
      });
    });

    var startBtn = document.getElementById('btn-start-mtt');
    if (startBtn) {
      startBtn.addEventListener('click', function() { self._startTournamentSession(); });
    }

    document.querySelectorAll('#mtt-actions-pushfold .action-btn, #mtt-actions-deep .action-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var action = this.getAttribute('data-action');
        if (action) self._submitMTTAction(action);
      });
    });

    // MTT AI explain button
    var mttExplainBtn = document.getElementById('btn-explain-mtt');
    if (mttExplainBtn) {
      mttExplainBtn.addEventListener('click', function() { self._requestAIExplanation('ai-insight-mtt-body'); });
    }

    GTO.Keyboard.register('drill-mtt', 'p', function() { self._submitMTTAction('push'); });
    GTO.Keyboard.register('drill-mtt', 'f', function() { self._submitMTTAction('fold'); });
  },

  _startTournamentSession: function() {
    if (GTO.UI.Sounds) GTO.UI.Sounds.play('thock');
    // Read stack range from chips
    var stackVals = [];
    document.querySelectorAll('#mtt-stack-chips .checkbox-chip.checked').forEach(function(c) {
      stackVals.push(parseInt(c.getAttribute('data-value')));
    });
    var stackMin = stackVals.length > 0 ? Math.min.apply(null, stackVals) : 5;
    var stackMax = stackVals.length > 0 ? Math.max.apply(null, stackVals) : 20;

    // Read positions
    var positions = [];
    document.querySelectorAll('#mtt-position-chips .checkbox-chip.checked').forEach(function(c) {
      positions.push(c.getAttribute('data-value'));
    });
    if (positions.length === 0) positions = GTO.Data.POSITIONS.slice();

    // Read stage
    var stageEl = document.querySelector('#mtt-stage-toggle .toggle-option.active');
    var stage = stageEl ? stageEl.getAttribute('data-value') : 'normal';

    // Read drill count
    var countEl = document.querySelector('#mtt-drill-count .toggle-option.active');
    var count = countEl ? parseInt(countEl.getAttribute('data-value')) : 30;

    // Read payout structure
    var structEl = document.querySelector('#mtt-structure-toggle .toggle-option.active');
    var structureKey = structEl ? structEl.getAttribute('data-value') : '9max_sng';

    var config = {
      drillType: 'tournament',
      format: 'mtt',
      stackMin: stackMin,
      stackMax: stackMax,
      positions: positions,
      stage: stage,
      structureKey: structureKey,
      count: count
    };

    var self = this;
    GTO.Engine.DrillEngine.startSession(config, {
      onScenario: function(scenario, index) { self._renderMTTScenario(scenario, index); },
      onResult: function(result, scenario) { self._renderMTTResult(result, scenario); },
      onSessionEnd: function(session) {
        self._showSessionSummary(session, 'pushfold');
      }
    });

    var configEl = document.getElementById('mtt-config');
    var activeEl = document.getElementById('mtt-active');
    if (configEl) configEl.classList.add('hidden');
    if (activeEl) activeEl.classList.remove('hidden');

    GTO.Keyboard.setContext('drill-mtt');
    this._showDrillProgress();
  },

  _renderMTTScenario: function(scenario) {
    GTO.UI.BoardDisplay.renderHoleCards('mtt-hero-cards', scenario.cards);
    GTO.UI.HUD.updateStat('mtt-position', scenario.position);
    GTO.UI.HUD.updateStat('mtt-stack', scenario.stackBB + 'bb');
    GTO.UI.HUD.updateStat('mtt-players', (scenario.playersLeft || '--') + ' left');

    // Payout structure label
    if (scenario.payoutStructure) {
      var paidSpots = scenario.payoutStructure.payouts.length;
      GTO.UI.HUD.updateStat('mtt-payouts', scenario.payoutStructure.label + ' (' + paidSpots + ' paid)');
    }

    // ICM pressure & bubble factor badges
    if (scenario.icmPressure !== null && scenario.icmPressure !== undefined) {
      var pressLabel = GTO.Engine.ICM.pressureLabel(scenario.icmPressure);
      var pressColor = GTO.Engine.ICM.pressureColor(scenario.icmPressure);
      GTO.UI.HUD.updateStat('mtt-pressure-badge',
        '<span class="' + pressColor + '">' + pressLabel + ' (' + scenario.icmPressure + ')</span>');
    }
    if (scenario.bubbleFactor !== null && scenario.bubbleFactor !== undefined) {
      var bfClass = scenario.bubbleFactor >= 1.5 ? 'pressure-high' : (scenario.bubbleFactor >= 1.2 ? 'pressure-moderate' : 'pressure-low');
      GTO.UI.HUD.updateStat('mtt-bf-badge',
        '<span class="' + bfClass + '">' + scenario.bubbleFactor.toFixed(2) + 'x</span>');
    }

    // Table stacks mini display
    if (scenario.tableStacks) {
      var stacksEl = document.getElementById('mtt-table-stacks');
      var listEl = document.getElementById('mtt-stacks-list');
      if (stacksEl && listEl) {
        stacksEl.classList.remove('hidden');
        var html = '';
        var posLabels = ['P1','P2','P3','P4','P5','P6','P7','P8','P9'];
        for (var i = 0; i < scenario.tableStacks.length; i++) {
          var isHero = i === scenario.heroIdx;
          html += '<span style="padding:2px 6px; border-radius:3px; ' +
            (isHero ? 'background:var(--accent); color:var(--bg-primary); font-weight:bold;' : 'background:var(--bg-tertiary);') +
            '">' + (isHero ? 'H' : posLabels[i]) + ':' + scenario.tableStacks[i] + 'bb</span>';
        }
        listEl.innerHTML = html;
      }
    }

    document.querySelectorAll('#mtt-actions-pushfold .action-btn, #mtt-actions-deep .action-btn').forEach(function(b) { b.disabled = false; });
    var mttFeedback = document.getElementById('mtt-feedback-content');
    if (mttFeedback) mttFeedback.classList.add('hidden');

    GTO.UI.HUD.updateStatusBar(GTO.Engine.DrillEngine.getProgress());
  },

  _submitMTTAction: function(action) {
    if (!GTO.Engine.DrillEngine.isActive()) return;
    if (GTO.Keyboard.getContext() !== 'drill-mtt') return;
    if (GTO.UI.Sounds) GTO.UI.Sounds.play('action');
    GTO.Engine.DrillEngine.submitAnswer(action);
    document.querySelectorAll('#mtt-actions-pushfold .action-btn, #mtt-actions-deep .action-btn').forEach(function(b) { b.disabled = true; });
    GTO.Keyboard.setContext('result');
  },

  _renderMTTResult: function(result, scenario) {
    var mttEmpty = document.getElementById('mtt-feedback-empty');
    var mttFeedback = document.getElementById('mtt-feedback-content');
    if (mttEmpty) mttEmpty.classList.add('hidden');
    if (mttFeedback) mttFeedback.classList.remove('hidden');

    var verdictEl = document.getElementById('mtt-verdict');
    if (verdictEl) {
      verdictEl.className = 'verdict ' + GTO.Engine.Scoring.getVerdictClass(result.verdict);
      verdictEl.innerHTML = '<span class="verdict-icon">' + GTO.Engine.Scoring.getVerdictIcon(result.verdict) + '</span> ' +
        'You chose ' + (result.userAction || '?').toUpperCase() + ' — Nash says ' + (result.correctAction || '?').toUpperCase();
    }

    // Populate push/fold frequency bars
    var pushFreq = result.correctAction === 'push' ? 100 : 0;
    var foldFreq = result.correctAction === 'fold' ? 100 : 0;
    var pushBar = document.getElementById('mtt-freq-push');
    var foldBar = document.getElementById('mtt-freq-fold');
    if (pushBar) pushBar.style.width = pushFreq + '%';
    if (foldBar) foldBar.style.width = foldFreq + '%';
    GTO.UI.HUD.updateStat('mtt-freq-push-val', pushFreq + '%');
    GTO.UI.HUD.updateStat('mtt-freq-fold-val', foldFreq + '%');

    // Populate ICM stats
    if (result.hasICM) {
      GTO.UI.HUD.updateStat('mtt-cev', (result.chipEV >= 0 ? '+' : '') + result.chipEV.toFixed(2) + 'bb');
      GTO.UI.HUD.updateStat('mtt-icev', (result.icmEV >= 0 ? '+' : '') + '$' + result.icmEV.toFixed(2));
      GTO.UI.HUD.updateStat('mtt-ev-loss', result.evLoss !== 0 ? result.evLoss.toFixed(2) + 'bb' : '0.00bb');
      GTO.UI.HUD.updateStat('mtt-icm-pressure',
        '<span class="' + result.pressureColor + '">' + result.pressureLabel + ' (' + result.icmPressure + ')</span>');
      GTO.UI.HUD.updateStat('mtt-bubble-factor', result.bubbleFactor.toFixed(2) + 'x');
      GTO.UI.HUD.updateStat('mtt-icm-tax', result.icmTax ? ('$' + result.icmTax.toFixed(2)) : '--');
    } else {
      GTO.UI.HUD.updateStat('mtt-cev', result.evLoss ? result.evLoss.toFixed(2) + 'bb' : '0.00bb');
      GTO.UI.HUD.updateStat('mtt-icev', '--');
      GTO.UI.HUD.updateStat('mtt-ev-loss', result.evLoss ? result.evLoss.toFixed(2) + 'bb' : '0.00bb');
      GTO.UI.HUD.updateStat('mtt-icm-pressure', '--');
      GTO.UI.HUD.updateStat('mtt-bubble-factor', '--');
      GTO.UI.HUD.updateStat('mtt-icm-tax', '--');
    }

    GTO.UI.HUD.updateStatusBar(GTO.Engine.DrillEngine.getProgress());
    this._updateDrillProgress();

    // Show next bar
    var nextBar = document.getElementById('drill-next-bar');
    if (nextBar) nextBar.classList.remove('hidden');

    this._lastResult = result;
    this._lastScenario = scenario;
  },

  _setupPlaythrough: function() {
    var self = this;

    // Config toggles
    document.querySelectorAll('#play-config .toggle-option').forEach(function(opt) {
      opt.addEventListener('click', function() {
        this.parentElement.querySelectorAll('.toggle-option').forEach(function(o) { o.classList.remove('active'); });
        this.classList.add('active');
        if (GTO.UI.Sounds) GTO.UI.Sounds.play('tick');
      });
    });

    // Start button
    var startBtn = document.getElementById('btn-start-play');
    if (startBtn) {
      startBtn.addEventListener('click', function() { self._startPlaythrough(); });
    }

    // Event delegation for dynamic action buttons
    var actionsContainer = document.getElementById('play-current-actions');
    if (actionsContainer) {
      actionsContainer.addEventListener('click', function(e) {
        var btn = e.target.closest('.action-btn');
        if (!btn || btn.disabled) return;
        var action = btn.getAttribute('data-action');
        if (action) self._submitPlayAction(action);
      });
    }

    // Wire persistent end-of-hand buttons (once, not per hand)
    var nextBtn = document.getElementById('btn-next-hand');
    var backBtn = document.getElementById('btn-back-play-config');
    if (nextBtn) {
      nextBtn.addEventListener('click', function() { self._startPlaythrough(); });
    }
    if (backBtn) {
      backBtn.addEventListener('click', function() {
        var config = document.getElementById('play-config');
        var active = document.getElementById('play-active');
        if (config) config.classList.remove('hidden');
        if (active) active.classList.add('hidden');
        // Reset right panel to empty state
        var rangeEmpty = document.getElementById('play-range-empty');
        var matrixArea = document.getElementById('play-matrix-area');
        var boardArea = document.getElementById('play-board-area');
        var feedbackEmpty = document.getElementById('play-feedback-empty');
        var feedbackContent = document.getElementById('play-feedback-content');
        if (rangeEmpty) rangeEmpty.classList.remove('hidden');
        if (matrixArea) matrixArea.classList.add('hidden');
        if (boardArea) boardArea.classList.add('hidden');
        if (feedbackEmpty) feedbackEmpty.classList.remove('hidden');
        if (feedbackContent) feedbackContent.classList.add('hidden');
        var summaryBar = document.getElementById('play-summary-bar');
        if (summaryBar) summaryBar.innerHTML = '';
      });
    }

    // Play-specific keyboard shortcuts
    GTO.Keyboard.register('play-preflop', 'f', function() { self._submitPlayAction('fold'); });
    GTO.Keyboard.register('play-preflop', 'c', function() { self._submitPlayAction('call'); });
    GTO.Keyboard.register('play-preflop', 'r', function() { self._submitPlayAction('raise'); });

    GTO.Keyboard.register('play-postflop', 'x', function() { self._submitPlayAction('check'); });
    GTO.Keyboard.register('play-postflop', '1', function() { self._submitPlayAction('bet_33'); });
    GTO.Keyboard.register('play-postflop', '2', function() { self._submitPlayAction('bet_50'); });
    GTO.Keyboard.register('play-postflop', '3', function() { self._submitPlayAction('bet_67'); });
    GTO.Keyboard.register('play-postflop', '4', function() { self._submitPlayAction('bet_100'); });
    GTO.Keyboard.register('play-postflop', 'f', function() { self._submitPlayAction('fold'); });
    GTO.Keyboard.register('play-postflop', 'c', function() { self._submitPlayAction('call'); });
    GTO.Keyboard.register('play-postflop', 'r', function() { self._submitPlayAction('raise'); });
    GTO.Keyboard.register('play-postflop', 'a', function() { self._submitPlayAction('allin'); });

    GTO.Keyboard.register('play-end', 'n', function() { self._startPlaythrough(); });
    GTO.Keyboard.register('play-end', ' ', function() { self._startPlaythrough(); });
  },

  _startPlaythrough: function() {
    if (GTO.UI.Sounds) GTO.UI.Sounds.play('thock');
    var formatEl = document.querySelector('#play-format-toggle .toggle-option.active');
    var stackEl = document.querySelector('#play-stack-toggle .toggle-option.active');
    var format = formatEl ? formatEl.getAttribute('data-value') : 'cash';
    var stack = stackEl ? stackEl.getAttribute('data-value') + 'bb' : '100bb';

    var hand = GTO.Engine.HandPlaythrough.startHand({
      format: format,
      stackDepth: stack,
      position: GTO.Utils.randPick(GTO.Data.POSITIONS.slice(0, 5)) // exclude BB for opening
    });

    // Show active, hide config
    var config = document.getElementById('play-config');
    var active = document.getElementById('play-active');
    if (config) config.classList.add('hidden');
    if (active) active.classList.remove('hidden');

    // Hide end actions, show street area
    var endActions = document.getElementById('play-end-actions');
    if (endActions) endActions.classList.add('hidden');

    // Reset right panel to initial state
    var rangeEmpty = document.getElementById('play-range-empty');
    var matrixArea = document.getElementById('play-matrix-area');
    var boardArea = document.getElementById('play-board-area');
    var feedbackEmpty = document.getElementById('play-feedback-empty');
    var feedbackContent = document.getElementById('play-feedback-content');
    if (rangeEmpty) rangeEmpty.classList.remove('hidden');
    if (matrixArea) matrixArea.classList.add('hidden');
    if (boardArea) boardArea.classList.add('hidden');
    if (feedbackEmpty) {
      feedbackEmpty.classList.remove('hidden');
      var emptyText = feedbackEmpty.querySelector('.empty-state-text');
      if (emptyText) emptyText.textContent = 'Choose your action';
      var emptyHint = feedbackEmpty.querySelector('.empty-state-hint');
      if (emptyHint) emptyHint.textContent = 'Press F / C / R to submit';
    }
    if (feedbackContent) feedbackContent.classList.add('hidden');
    GTO.UI.HandMatrix.clearMatrix('play-matrix-table');
    var summaryBar = document.getElementById('play-summary-bar');
    if (summaryBar) summaryBar.innerHTML = '';
    var rangeTag = document.getElementById('play-range-tag');
    if (rangeTag) rangeTag.textContent = 'PREFLOP';

    // Render hero cards
    GTO.UI.BoardDisplay.renderHoleCards('play-hero-cards', hand.cards);

    // Reset all 5 board card slots to facedown/unrevealed
    for (var i = 0; i < 5; i++) {
      var slot = document.getElementById('play-board-' + i);
      if (slot) {
        slot.className = 'playing-card card-facedown card-unrevealed' + (i >= 3 ? ' play-board-gap' : '');
        slot.innerHTML = '';
      }
    }

    // Update position and action info
    var posEl = document.getElementById('play-position');
    if (posEl) posEl.textContent = hand.heroPosition + ' (' + (GTO.Data.POSITION_NAMES[hand.heroPosition] || '') + ')';
    var actionEl = document.getElementById('play-preflop-action');
    if (actionEl) actionEl.textContent = 'Folds to you. ' + hand.stackDepth + ' effective.';

    // Highlight hero position on table display
    GTO.UI.HUD.updateTable('play-table-display', hand.heroPosition);

    // Update pot
    var potEl = document.getElementById('play-pot');
    if (potEl) potEl.textContent = hand.pot.toFixed(1) + 'bb';

    // Set street label
    var streetLabel = document.getElementById('play-street-label');
    if (streetLabel) streetLabel.textContent = 'PREFLOP';

    // Render preflop action buttons
    this._renderPlayButtons('preflop');

    // Clear street results timeline + stored contexts
    var results = document.getElementById('play-street-results');
    if (results) results.innerHTML = '';
    this._playStreetResults = [];

    var handNum = document.getElementById('play-hand-num');
    if (handNum) handNum.textContent = 'Hand #' + hand.id.slice(0, 6);

    GTO.Keyboard.setContext('play-preflop');
  },

  _renderPlayButtons: function(street) {
    var container = document.getElementById('play-current-actions');
    if (!container) return;

    var html = '';
    if (street === 'preflop') {
      html =
        '<button class="action-btn btn-fold" data-action="fold"><span class="key-hint">F</span> <span class="action-label">Fold</span></button>' +
        '<button class="action-btn btn-call" data-action="call"><span class="key-hint">C</span> <span class="action-label">Call</span></button>' +
        '<button class="action-btn btn-raise" data-action="raise"><span class="key-hint">R</span> <span class="action-label">Raise</span></button>';
    } else {
      // Postflop: try to get solver actions for this exact spot
      var hand = GTO.Engine.HandPlaythrough.getHand();
      var solverActions = null;
      if (hand && hand.matchup && GTO.Engine.PostflopLookup) {
        var isIP = hand.heroPosition === 'BTN' || hand.heroPosition === 'CO';
        var spotType = (isIP ? 'IP_' : 'OOP_') + 'cbet_flop';
        if (street === 'turn') spotType = (isIP ? 'IP_' : 'OOP_') + 'turn_barrel';
        if (street === 'river') spotType = (isIP ? 'IP_' : 'OOP_') + 'river_bet';

        var boardStrCards = hand.board.map(function(c) {
          return (c.rank || c.r || '') + (c.suit || c.s || '');
        });
        var lookupResult = GTO.Engine.PostflopLookup.lookup({
          spotType: spotType,
          boardTexture: GTO.Data.BoardCategories ? GTO.Data.BoardCategories.classify(hand.board) : null,
          handStrength: null,
          spr: hand.effectiveStack / hand.pot,
          boardCards: boardStrCards,
          matchup: hand.matchup,
          depth: hand.stackDepth
        });
        if (lookupResult.actions) {
          solverActions = lookupResult.actions;
        }
      }

      if (solverActions && solverActions.length > 0) {
        solverActions.forEach(function(a) {
          var btnClass = 'action-btn';
          if (a.key === 'check') btnClass += ' btn-check';
          else if (a.key === 'fold') btnClass += ' btn-fold';
          else if (a.key === 'call') btnClass += ' btn-call';
          else btnClass += ' btn-raise';
          html += '<button class="' + btnClass + '" data-action="' + a.key + '"><span class="key-hint">' + a.hint + '</span> ' + a.label + '</button>';
        });
      } else {
        html =
          '<button class="action-btn btn-check" data-action="check"><span class="key-hint">X</span> Check</button>' +
          '<button class="action-btn btn-raise" data-action="bet_33"><span class="key-hint">1</span> 1/3</button>' +
          '<button class="action-btn btn-raise" data-action="bet_67"><span class="key-hint">2</span> 2/3</button>' +
          '<button class="action-btn btn-raise" data-action="bet_100"><span class="key-hint">3</span> Pot</button>';
      }
    }

    container.innerHTML = html;
  },

  _submitPlayAction: function(rawAction) {
    var hand = GTO.Engine.HandPlaythrough.getHand();
    if (!hand || hand.isComplete) return;
    if (GTO.UI.Sounds) GTO.UI.Sounds.play('action');

    var street = hand.currentStreet;
    var action = rawAction;

    var result = GTO.Engine.HandPlaythrough.submitStreetAction(action);
    if (!result) return;

    // Disable current buttons
    document.querySelectorAll('#play-current-actions .action-btn').forEach(function(b) { b.disabled = true; });

    // Render inline range analysis + feedback in right panel
    this._renderPlayRangeAnalysis(street, hand, result, action);

    // Add compact street result row to left panel timeline
    var resultsEl = document.getElementById('play-street-results');
    if (resultsEl) {
      var verdictColor = result.verdict === 'optimal' ? 'var(--green)' : (result.verdict === 'acceptable' ? 'var(--orange)' : 'var(--red)');
      var verdictBg = result.verdict === 'optimal' ? 'rgba(74,246,195,0.08)' : (result.verdict === 'acceptable' ? 'rgba(255,215,0,0.08)' : 'rgba(255,67,61,0.08)');
      var icon = result.verdict === 'optimal' ? '&#10003;' : (result.verdict === 'acceptable' ? '~' : '&#10007;');

      var line = '<div style="padding:6px 10px; margin-bottom:3px; border:1px solid var(--border-dim); border-radius:var(--radius-sm); background:' + verdictBg + ';">' +
        '<div style="display:flex; align-items:center; gap:8px; font-size:11px;">' +
          '<span style="color:var(--accent); font-weight:700; font-size:10px; min-width:56px; text-transform:uppercase; letter-spacing:0.08em;">' + street + '</span>' +
          '<span style="color:var(--text-secondary);">' + (result.userAction || action).toUpperCase() + '</span>' +
          '<span style="margin-left:auto; color:' + verdictColor + '; font-weight:600; font-size:10px;">' + icon + ' ' + GTO.Engine.Scoring.getVerdictLabel(result.verdict) + '</span>' +
          '<span style="color:var(--text-dim); font-size:10px;">' + GTO.Utils.formatEV(result.evLoss) + '</span>' +
        '</div>' +
      '</div>';
      resultsEl.innerHTML += line;
    }

    // If folded or hand complete, show summary
    if (hand.isComplete) {
      this._endPlaythrough(hand);
      return;
    }

    // Deal next street
    var dealResult = GTO.Engine.HandPlaythrough.dealStreet();
    if (dealResult) {
      this._renderPlayStreet(hand, dealResult);
    }
  },

  _renderPlayStreet: function(hand, dealResult) {
    var street = dealResult.street;
    var newCards = dealResult.newCards || [];

    // Reveal board cards in-place by replacing individual card slots
    if (street === 'flop' && newCards.length === 3) {
      for (var i = 0; i < 3; i++) {
        this._revealBoardCard(i, newCards[i]);
      }
    } else if (street === 'turn' && newCards.length === 1) {
      this._revealBoardCard(3, newCards[0]);
    } else if (street === 'river' && newCards.length === 1) {
      this._revealBoardCard(4, newCards[0]);
    }

    // Update pot
    var potEl = document.getElementById('play-pot');
    if (potEl) potEl.textContent = hand.pot.toFixed(1) + 'bb';

    // Update street label
    var streetLabel = document.getElementById('play-street-label');
    if (streetLabel) streetLabel.textContent = street.toUpperCase();

    // Render new action buttons for this street
    this._renderPlayButtons(street);

    // Show board texture analysis in right panel, reset feedback
    this._preparePlayRangeForStreet(street, hand);

    // Set appropriate keyboard context
    GTO.Keyboard.setContext('play-postflop');
  },

  _revealBoardCard: function(slotIndex, card) {
    var slot = document.getElementById('play-board-' + slotIndex);
    if (!slot || !card) return;

    var suitClass = 'suit-' + card.suit;
    var symbol = GTO.Data.SUIT_SYMBOLS[card.suit];

    // Replace facedown with rendered card
    slot.className = 'playing-card ' + suitClass + (slotIndex >= 3 ? ' play-board-gap' : '');
    slot.innerHTML = '<span class="card-rank">' + card.rank + '</span><span class="card-suit">' + symbol + '</span>';
  },

  _solvePlaySpot: function(street, hand, userAction) {
    if (!hand) return;

    // Show spinner on button
    var btn = document.getElementById('btn-solve-play');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="solver-spinner"></span>';
    }

    // Derive spot type from street + position
    var isIP = hand.heroPosition === 'BTN' || hand.heroPosition === 'CO';
    var spotType;
    if (street === 'flop') spotType = (isIP ? 'IP_' : 'OOP_') + 'cbet_flop';
    else if (street === 'turn') spotType = (isIP ? 'IP_' : 'OOP_') + 'turn_barrel';
    else spotType = (isIP ? 'IP_' : 'OOP_') + 'river_bet';

    // Convert board card objects to strings
    var boardCards = hand.board.map(function(c) {
      return (c.rank || c.r || '') + (c.suit || c.s || '');
    });

    // Resolve matchup if not available
    var matchup = hand.matchup;
    if (!matchup && GTO.Engine.PostflopLookup) {
      matchup = GTO.Engine.PostflopLookup.resolveMatchup(hand.heroPosition, !isIP);
    }
    if (!matchup) {
      if (btn) { btn.textContent = 'NO DATA'; btn.style.color = 'var(--red)'; }
      return;
    }

    var self = this;
    GTO.Engine.PostflopLookup.solveLive({
      spotType: spotType,
      boardCards: boardCards,
      matchup: matchup,
      depth: hand.stackDepth
    }, function(solverResult) {
      if (!solverResult) {
        if (btn) { btn.textContent = 'FAILED'; btn.style.color = 'var(--red)'; }
        return;
      }

      // Re-score with solver data — apply ICM if MTT
      var scoringFreqs = solverResult.freqs;
      var icmEnabled = hand.format === 'mtt' && GTO.Engine.ICM &&
        GTO.State.get('icmEnabled') !== false;
      if (icmEnabled && scoringFreqs) {
        var bf = self._getExploreBubbleFactor();
        if (bf > 1.0) {
          var icmSpot = (spotType && spotType.indexOf('facing') >= 0) ? 'postflop_facing' : 'postflop_bet';
          scoringFreqs = GTO.Engine.ICM.adjustFrequencies(scoringFreqs, bf, icmSpot);
        }
      }
      var newResult = GTO.Engine.Scoring.scorePostflop(
        scoringFreqs, userAction, { potSize: hand.pot }
      );
      newResult.dataSource = 'solver';
      if (icmEnabled) {
        newResult.rawGtoFreqs = solverResult.freqs;
        // Generate ICM context for overlay
        var structure = GTO.Data.TournamentStructures.get(hand.structureKey || '9max_sng');
        var stackBB = parseInt(hand.stackDepth) || 25;
        var stacks = GTO.Data.TournamentStructures.generateTableStacks({
          players: structure.players, heroIdx: 0, heroStackBB: stackBB, avgStackBB: stackBB, stage: 'normal'
        });
        var prizes = GTO.Data.TournamentStructures.getPrizes(hand.structureKey || '9max_sng', 100);
        var icmCtx = {
          heroIdx: 0, stacks: stacks, prizes: prizes,
          prizePool: prizes.reduce(function(a,b){return a+b;},0), potSize: hand.pot,
          heroEquity: GTO.Engine.ICM.calculateEquities(stacks, prizes)[0],
          bubbleFactor: GTO.Engine.ICM.bubbleFactor(0, stacks, prizes, hand.pot),
          icmPressure: GTO.Engine.ICM.pressure(0, stacks, prizes),
          pressureLabel: GTO.Engine.ICM.pressureLabel(GTO.Engine.ICM.pressure(0, stacks, prizes)),
          pressureColor: GTO.Engine.ICM.pressureColor(GTO.Engine.ICM.pressure(0, stacks, prizes))
        };
        GTO.Engine.Scoring.scoreWithICM(newResult, icmCtx, 0.5);
      }

      // Re-render feedback
      self._renderPlayFeedback(street, hand, newResult, userAction);
    }, function(progress) {
      if (btn && progress && progress.pctDone !== undefined) {
        btn.innerHTML = '<span class="solver-spinner"></span> ' + Math.round(progress.pctDone) + '%';
      }
    });
  },

  _endPlaythrough: function(hand) {
    GTO.Keyboard.setContext('play-end');

    // Clear action buttons
    var actionsContainer = document.getElementById('play-current-actions');
    if (actionsContainer) actionsContainer.innerHTML = '';

    // Update street label to show completion
    var streetLabel = document.getElementById('play-street-label');
    if (streetLabel) streetLabel.textContent = 'COMPLETE';

    // Show end-of-hand buttons
    var endActions = document.getElementById('play-end-actions');
    if (endActions) endActions.classList.remove('hidden');

    // Add total EV summary row to street results
    var resultsEl = document.getElementById('play-street-results');
    if (resultsEl) {
      var totalClass = hand.totalEvLoss < 0.5 ? 'var(--green)' : 'var(--red)';
      resultsEl.innerHTML += '<div style="padding:8px 10px; margin-top:4px; border:1px solid var(--border-dim); border-radius:var(--radius-sm); background:var(--bg-secondary); display:flex; justify-content:space-between; align-items:center;">' +
        '<span style="font-size:11px; font-weight:700; color:var(--text-primary); letter-spacing:0.05em;">TOTAL</span>' +
        '<span style="font-size:13px; font-weight:700; color:' + totalClass + ';">' + GTO.Utils.formatEV(hand.totalEvLoss) + ' EV</span>' +
        '</div>';
    }

    // Update AI review text
    var aiBody = document.getElementById('ai-insight-play-body');
    if (aiBody) aiBody.textContent = 'Hand complete. Total EV loss: ' + GTO.Utils.formatEV(hand.totalEvLoss);
    var aiPanel = document.getElementById('ai-insight-play');
    if (aiPanel) aiPanel.classList.remove('hidden');
  },

  // ── Play Range Analysis (inline, per-street) ──

  _renderPlayRangeAnalysis: function(street, hand, result, action) {
    // Hide empty states
    var rangeEmpty = document.getElementById('play-range-empty');
    if (rangeEmpty) rangeEmpty.classList.add('hidden');
    var feedbackEmpty = document.getElementById('play-feedback-empty');
    if (feedbackEmpty) feedbackEmpty.classList.add('hidden');
    var feedbackContent = document.getElementById('play-feedback-content');
    if (feedbackContent) feedbackContent.classList.remove('hidden');

    // Update street tag
    var tag = document.getElementById('play-range-tag');
    if (tag) tag.textContent = street.toUpperCase();

    if (street === 'preflop') {
      this._renderPlayPreflopRange(hand, result);
    } else {
      this._renderPlayPostflopRange(street, hand, result);
    }
    this._renderPlayFeedback(street, hand, result, action);
  },

  _renderPlayPreflopRange: function(hand, result) {
    var matrixArea = document.getElementById('play-matrix-area');
    var boardArea = document.getElementById('play-board-area');
    if (matrixArea) matrixArea.classList.remove('hidden');
    if (boardArea) boardArea.classList.add('hidden');

    try {
      var scenario = {
        format: hand.format,
        stackDepth: hand.stackDepth,
        position: hand.heroPosition,
        positionKey: hand.heroPosition,
        actionContext: 'rfi'
      };
      var rangeData = GTO.Engine.PreflopDrill.getRangeForScenario(scenario);

      // ICM adjustment for MTT play mode
      if (hand.format === 'mtt' && GTO.Engine.ICM && GTO.State.get('icmEnabled') !== false) {
        var bf = this._getExploreBubbleFactor();
        if (bf > 1.0) {
          GTO.Data.ALL_HANDS.forEach(function(h) {
            if (rangeData[h]) {
              rangeData[h] = GTO.Engine.ICM.adjustFrequencies(rangeData[h], bf, 'preflop_rfi');
            }
          });
        }
      }

      GTO.UI.HandMatrix.updateMatrix('play-matrix-table', rangeData, null, hand.hand);
      GTO.UI.HandMatrix.updateSummaryBar('play-summary-bar', rangeData);
    } catch (e) {
      // Silently handle matrix rendering errors
    }
  },

  _renderPlayPostflopRange: function(street, hand, result) {
    var matrixArea = document.getElementById('play-matrix-area');
    var boardArea = document.getElementById('play-board-area');
    if (matrixArea) matrixArea.classList.add('hidden');
    if (boardArea) boardArea.classList.remove('hidden');

    // Clear summary bar (not relevant for postflop)
    var summaryBar = document.getElementById('play-summary-bar');
    if (summaryBar) summaryBar.innerHTML = '';

    try {
      // Render board cards
      GTO.UI.BoardDisplay.renderBoard('play-range-board-display', hand.board);

      // Classify texture
      var tex = GTO.Data.BoardCategories.classify(hand.board);
      var texLabel = GTO.Data.BoardTextureLabels ? GTO.Data.BoardTextureLabels[tex] : tex;
      GTO.UI.HUD.updateStat('play-texture-type', texLabel || tex);

      var isWet = tex.indexOf('wet') >= 0 || tex === 'highly_connected';
      var isMonotone = tex === 'monotone';
      var isTwotone = tex.indexOf('twotone') >= 0;

      GTO.UI.HUD.updateStat('play-texture-wetness', isWet ? 'Wet' : 'Dry');
      GTO.UI.HUD.updateStat('play-texture-connect', tex === 'highly_connected' ? 'High' : (isWet ? 'Medium' : 'Low'));
      GTO.UI.HUD.updateStat('play-texture-flush', isMonotone ? 'Complete' : (isTwotone ? 'Draw Possible' : 'None'));

      if (hand.board && hand.board.length > 0) {
        var boardRanks = hand.board.map(function(c) { return GTO.Data.RANK_VALUES[c.rank]; });
        var highRank = Math.max.apply(null, boardRanks);
        var rankNames = {14:'A',13:'K',12:'Q',11:'J',10:'T',9:'9',8:'8',7:'7',6:'6',5:'5',4:'4',3:'3',2:'2'};
        GTO.UI.HUD.updateStat('play-texture-high', rankNames[highRank] || '--');
      }

      // Hand strength
      var strength = GTO.Engine.HandEvaluator.classify(hand.cards, hand.board);
      var strengthLabel = GTO.Data.HandStrengthLabels ? GTO.Data.HandStrengthLabels[strength] : strength;
      GTO.UI.HUD.updateStat('play-hand-strength', strengthLabel || strength);

      // Range advantage estimate
      var positions = GTO.Data.POSITIONS;
      var posIdx = positions.indexOf(hand.heroPosition);
      var isIP = posIdx >= 3; // BTN, CO, MP generally IP
      var ipAdv = isIP ? 55 : 45;
      var ipBar = document.getElementById('play-range-adv-ip');
      var oopBar = document.getElementById('play-range-adv-oop');
      var ipVal = document.getElementById('play-range-adv-ip-val');
      var oopVal = document.getElementById('play-range-adv-oop-val');
      if (ipBar) ipBar.style.width = ipAdv + '%';
      if (oopBar) oopBar.style.width = (100 - ipAdv) + '%';
      if (ipVal) ipVal.textContent = ipAdv + '%';
      if (oopVal) oopVal.textContent = (100 - ipAdv) + '%';

      // Show hero's narrowed range based on preflop action (multi-street consistency)
      var pathHeader = document.getElementById('play-preflop-path-header');
      var pathStats = document.getElementById('play-preflop-path-stats');
      if (pathHeader && pathStats && hand.preflopContext && hand.preflopAction && GTO.Engine.RangeFilter) {
        var heroSide = isIP ? 'ip' : 'oop';
        var heroCtx = hand.preflopContext[heroSide + 'Context'];
        var heroPos = hand.preflopContext[heroSide + 'Position'];
        var filteredRange = GTO.Engine.RangeFilter.buildActionRange(
          hand.format, hand.stackDepth, heroCtx, heroPos, hand.preflopAction
        );
        var rangeSize = GTO.Engine.RangeFilter.getRangeSize(filteredRange);
        var handCount = Object.keys(filteredRange).length;
        GTO.UI.HUD.updateStat('play-range-action', hand.preflopAction.toUpperCase() + ' range');
        GTO.UI.HUD.updateStat('play-range-count', handCount + ' hands (' + rangeSize + ' combos)');
        pathHeader.style.display = '';
        pathStats.style.display = '';

        // Range composition analysis
        var compHeader = document.getElementById('play-composition-header');
        var compBars = document.getElementById('play-composition-bars');
        if (compHeader && compBars && GTO.Engine.RangeFilter.analyzeComposition) {
          var comp = GTO.Engine.RangeFilter.analyzeComposition(filteredRange, hand.board);
          if (comp.total > 0) {
            var buckets = ['monsters','strong','medium','draws','weak','air'];
            for (var bi = 0; bi < buckets.length; bi++) {
              var pct = Math.round(comp[buckets[bi]] * 100);
              var bar = document.getElementById('play-comp-' + buckets[bi]);
              var val = document.getElementById('play-comp-' + buckets[bi] + '-val');
              if (bar) bar.style.width = pct + '%';
              if (val) val.textContent = pct + '%';
            }
            compHeader.style.display = '';
            compBars.style.display = '';
          }
        }
      } else if (pathHeader && pathStats) {
        pathHeader.style.display = 'none';
        pathStats.style.display = 'none';
        var compH = document.getElementById('play-composition-header');
        var compB = document.getElementById('play-composition-bars');
        if (compH) compH.style.display = 'none';
        if (compB) compB.style.display = 'none';
      }
    } catch (e) {
      // Silently handle postflop rendering errors
    }
  },

  _renderPlayFeedback: function(street, hand, result, action) {
    // Build frequency bars dynamically based on street
    var barsContainer = document.getElementById('play-freq-bars');
    if (barsContainer) {
      var freqs = result.gtoFreqs || {};
      var html = '';
      if (street === 'preflop') {
        var pf = { fold: freqs.fold || 0, call: freqs.call || 0, raise: freqs.raise || 0 };
        html += '<div class="freq-bar-item"><span class="freq-bar-label">Fold</span><div class="freq-bar-track"><div class="freq-bar-fill fill-fold" style="width:' + Math.round(pf.fold * 100) + '%"></div></div><span class="freq-bar-value">' + Math.round(pf.fold * 100) + '%</span></div>';
        html += '<div class="freq-bar-item"><span class="freq-bar-label">Call</span><div class="freq-bar-track"><div class="freq-bar-fill fill-call" style="width:' + Math.round(pf.call * 100) + '%"></div></div><span class="freq-bar-value">' + Math.round(pf.call * 100) + '%</span></div>';
        html += '<div class="freq-bar-item"><span class="freq-bar-label">Raise</span><div class="freq-bar-track"><div class="freq-bar-fill fill-raise" style="width:' + Math.round(pf.raise * 100) + '%"></div></div><span class="freq-bar-value">' + Math.round(pf.raise * 100) + '%</span></div>';
      } else {
        Object.keys(freqs).forEach(function(act) {
          var pct = Math.round(freqs[act] * 100);
          var label = act.replace('bet_33', 'Bet 1/3').replace('bet_50', 'Bet 1/2').replace('bet_67', 'Bet 2/3').replace('bet_100', 'Pot').replace('allin', 'All-in').replace('check', 'Check').replace('fold', 'Fold').replace('call', 'Call').replace('raise', 'Raise');
          var fillClass = act === 'check' ? 'fill-check' : (act === 'fold' ? 'fill-fold' : 'fill-bet');
          html += '<div class="freq-bar-item"><span class="freq-bar-label">' + label + '</span><div class="freq-bar-track"><div class="freq-bar-fill ' + fillClass + '" style="width:' + pct + '%"></div></div><span class="freq-bar-value">' + pct + '%</span></div>';
        });
      }
      barsContainer.innerHTML = html;
    }

    // Verdict
    var verdictEl = document.getElementById('play-verdict');
    if (verdictEl) {
      verdictEl.className = 'verdict ' + GTO.Engine.Scoring.getVerdictClass(result.verdict);
      var dataSourceBadge = '';
      if (result.dataSource) {
        var isSolver = result.dataSource === 'solver';
        dataSourceBadge = '<span style="font-size:9px; font-weight:700; padding:1px 5px; border-radius:3px; margin-left:8px; letter-spacing:0.05em; ' +
          (isSolver ? 'background:rgba(74,246,195,0.15); color:var(--green);' : 'background:rgba(255,215,0,0.15); color:var(--accent);') +
          '">' + result.dataSource.toUpperCase() + '</span>';
        if (!isSolver) {
          dataSourceBadge += '<button class="solver-action-btn" id="btn-solve-play" ' +
            'style="margin-left:6px; font-size:9px; padding:1px 6px; vertical-align:middle;">SOLVE</button>';
        }
      }
      var actionLabel = (result.userAction || action).toUpperCase();
      var verdictHtml = '<span class="verdict-icon">' + GTO.Engine.Scoring.getVerdictIcon(result.verdict) + '</span> ' +
        actionLabel + ' — ' + GTO.Engine.Scoring.getVerdictLabel(result.verdict) + dataSourceBadge;
      if (result.verdict !== 'optimal' && result.bestAction) {
        var bestLabel = result.bestAction.replace('bet_33', 'Bet 1/3').replace('bet_50', 'Bet 1/2').replace('bet_67', 'Bet 2/3').replace('bet_100', 'Bet Pot').replace('allin', 'All-in').replace('check', 'Check').replace('fold', 'Fold').replace('call', 'Call').replace('raise', 'Raise').toUpperCase();
        verdictHtml += '<div style="font-size:11px; font-weight:400; margin-top:4px; opacity:0.85;">GTO prefers <strong>' +
          bestLabel + '</strong> (' + Math.round((result.bestFreq || 0) * 100) + '% frequency)</div>';
      }
      verdictEl.innerHTML = verdictHtml;

      // Attach live solve handler for play mode
      var solveBtn = document.getElementById('btn-solve-play');
      if (solveBtn) {
        var self = this;
        solveBtn.addEventListener('click', function() { self._solvePlaySpot(street, hand, action); });
      }
    }

    // EV stats
    GTO.UI.HUD.updateStat('play-ev-optimal', result.bestAction ? result.bestAction.toUpperCase() : '--');
    GTO.UI.HUD.updateStat('play-ev-loss', GTO.Utils.formatEV(result.evLoss));

    // ICM stats for Play mode
    var playIcmStats = document.getElementById('play-icm-stats');
    if (result.hasICM && playIcmStats) {
      playIcmStats.classList.remove('hidden');
      GTO.UI.HUD.updateStat('play-icm-pressure',
        '<span class="' + result.pressureColor + '">' + result.pressureLabel + ' (' + result.icmPressure + ')</span>');
      GTO.UI.HUD.updateStat('play-bubble-factor', result.bubbleFactor.toFixed(2) + 'x');
      GTO.UI.HUD.updateStat('play-icm-ev', (result.icmEV >= 0 ? '+' : '') + '$' + result.icmEV.toFixed(2));
      GTO.UI.HUD.updateStat('play-icm-tax', result.icmTax ? ('$' + result.icmTax.toFixed(2)) : '--');
    } else if (playIcmStats) {
      playIcmStats.classList.add('hidden');
    }

    // Position context bar
    try {
      var posBar = document.getElementById('play-position-bar');
      if (posBar) {
        var posHtml = '';
        GTO.Data.POSITIONS.forEach(function(p) {
          var cls = 'position-chip' + (p === hand.heroPosition ? ' hero' : '');
          posHtml += '<div class="' + cls + '">' + p + '</div>';
        });
        posBar.innerHTML = posHtml;
      }
    } catch (e) {}

    // Equity and pot odds
    try {
      var equity;
      if (street === 'preflop') {
        equity = GTO.Engine.HandEvaluator.estimatePreflopEquity(hand.hand);
      } else {
        equity = GTO.Engine.HandEvaluator.estimateEquity(hand.cards, hand.board);
      }
      GTO.UI.HUD.updateStat('play-feedback-equity', Math.round(equity * 100) + '%');

      var potOdds = hand.pot > 0 ? Math.round((1 / (hand.pot + 1)) * 100) : 0;
      GTO.UI.HUD.updateStat('play-feedback-pot-odds', potOdds + '%');
    } catch (e) {}
  },

  _preparePlayRangeForStreet: function(street, hand) {
    // Called when a new street is dealt — show board texture, reset feedback
    var rangeEmpty = document.getElementById('play-range-empty');
    if (rangeEmpty) rangeEmpty.classList.add('hidden');

    var tag = document.getElementById('play-range-tag');
    if (tag) tag.textContent = street.toUpperCase();

    // Show board area with current texture
    var matrixArea = document.getElementById('play-matrix-area');
    var boardArea = document.getElementById('play-board-area');
    if (matrixArea) matrixArea.classList.add('hidden');
    if (boardArea) boardArea.classList.remove('hidden');

    // Clear summary bar
    var summaryBar = document.getElementById('play-summary-bar');
    if (summaryBar) summaryBar.innerHTML = '';

    try {
      GTO.UI.BoardDisplay.renderBoard('play-range-board-display', hand.board);

      var tex = GTO.Data.BoardCategories.classify(hand.board);
      var texLabel = GTO.Data.BoardTextureLabels ? GTO.Data.BoardTextureLabels[tex] : tex;
      GTO.UI.HUD.updateStat('play-texture-type', texLabel || tex);

      var isWet = tex.indexOf('wet') >= 0 || tex === 'highly_connected';
      var isMonotone = tex === 'monotone';
      var isTwotone = tex.indexOf('twotone') >= 0;

      GTO.UI.HUD.updateStat('play-texture-wetness', isWet ? 'Wet' : 'Dry');
      GTO.UI.HUD.updateStat('play-texture-connect', tex === 'highly_connected' ? 'High' : (isWet ? 'Medium' : 'Low'));
      GTO.UI.HUD.updateStat('play-texture-flush', isMonotone ? 'Complete' : (isTwotone ? 'Draw Possible' : 'None'));

      if (hand.board && hand.board.length > 0) {
        var boardRanks = hand.board.map(function(c) { return GTO.Data.RANK_VALUES[c.rank]; });
        var highRank = Math.max.apply(null, boardRanks);
        var rankNames = {14:'A',13:'K',12:'Q',11:'J',10:'T',9:'9',8:'8',7:'7',6:'6',5:'5',4:'4',3:'3',2:'2'};
        GTO.UI.HUD.updateStat('play-texture-high', rankNames[highRank] || '--');
      }

      // Hand strength
      var strength = GTO.Engine.HandEvaluator.classify(hand.cards, hand.board);
      var strengthLabel = GTO.Data.HandStrengthLabels ? GTO.Data.HandStrengthLabels[strength] : strength;
      GTO.UI.HUD.updateStat('play-hand-strength', strengthLabel || strength);

      // Range advantage
      var positions = GTO.Data.POSITIONS;
      var posIdx = positions.indexOf(hand.heroPosition);
      var isIP = posIdx >= 3;
      var ipAdv = isIP ? 55 : 45;
      var ipBar = document.getElementById('play-range-adv-ip');
      var oopBar = document.getElementById('play-range-adv-oop');
      var ipVal = document.getElementById('play-range-adv-ip-val');
      var oopVal = document.getElementById('play-range-adv-oop-val');
      if (ipBar) ipBar.style.width = ipAdv + '%';
      if (oopBar) oopBar.style.width = (100 - ipAdv) + '%';
      if (ipVal) ipVal.textContent = ipAdv + '%';
      if (oopVal) oopVal.textContent = (100 - ipAdv) + '%';
    } catch (e) {}

    // Reset feedback to awaiting state
    var feedbackEmpty = document.getElementById('play-feedback-empty');
    var feedbackContent = document.getElementById('play-feedback-content');
    if (feedbackEmpty) {
      feedbackEmpty.classList.remove('hidden');
      var emptyText = feedbackEmpty.querySelector('.empty-state-text');
      if (emptyText) emptyText.textContent = 'Choose your action for ' + street.toUpperCase();
      var emptyHint = feedbackEmpty.querySelector('.empty-state-hint');
      if (emptyHint) emptyHint.textContent = 'Press X / 1 / 2 / 3 to submit';
    }
    if (feedbackContent) feedbackContent.classList.add('hidden');
  },

  _setupPlans: function() {
    var self = this;
    // Plan template buttons - each "Select" button in the template list
    document.querySelectorAll('#plan-templates-list .drill-item .btn-primary').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var item = this.closest('.drill-item');
        var titleEl = item ? item.querySelector('.drill-item-title') : null;
        var name = titleEl ? titleEl.textContent : 'Custom Plan';
        var idx = Array.from(document.querySelectorAll('#plan-templates-list .drill-item')).indexOf(item);
        var templateIds = ['mtt_fundamentals', 'cash_grinder', 'tournament_prep', 'leak_plugger'];
        var templateId = templateIds[idx] || 'preflop_fundamentals';
        var plan = GTO.Training.PlanEngine.createPlan(templateId, {
          name: name,
          format: GTO.State.get('settings.format')
        });
        if (plan) {
          GTO.UI.Toast.success('Training plan created: ' + plan.name);
          self._renderActivePlan();
        }
      });
    });

    this._renderActivePlan();
  },

  _setupLearn: function() {
    if (GTO.Content && GTO.Content.LearnView) {
      GTO.Content.LearnView.init();
    }
  },

  _setupStream: function() {
    if (GTO.Streaming && GTO.Streaming.StreamView) {
      GTO.Streaming.StreamView.init();
    }
  },

  _renderActivePlan: function() {
    var plan = GTO.Training.PlanEngine.getActivePlan();
    var nameEl = document.getElementById('active-plan-name');
    var progressEl = document.getElementById('active-plan-bar');
    var progressText = document.getElementById('active-plan-pct');
    var upcomingEl = document.getElementById('plan-upcoming-sessions');
    var deleteBtn = document.getElementById('btn-delete-plan');

    if (!plan) {
      if (nameEl) nameEl.textContent = 'No active plan';
      if (progressEl) progressEl.style.width = '0%';
      if (progressText) progressText.textContent = '0/0 sessions';
      if (upcomingEl) upcomingEl.innerHTML = '<div style="padding:16px 0; text-align:center;"><div style="font-size:20px; color:var(--text-dim); margin-bottom:8px;">&#9776;</div><div style="color:var(--text-secondary); font-size:11px; line-height:1.6;">No active plan.<br>Select a template to get started.</div></div>';
      if (deleteBtn) deleteBtn.style.display = 'none';
      return;
    }

    if (nameEl) nameEl.textContent = plan.name;
    var progress = GTO.Training.PlanEngine.getProgress();
    if (progressEl) progressEl.style.width = Math.round(progress.percent * 100) + '%';
    if (progressText) progressText.textContent = progress.completed + '/' + progress.total + ' sessions';
    if (deleteBtn) deleteBtn.style.display = '';

    // Render upcoming sessions
    if (upcomingEl && plan.sessions) {
      var upcoming = plan.sessions.filter(function(s) { return s.status === 'pending'; }).slice(0, 5);
      if (upcoming.length === 0) {
        upcomingEl.innerHTML = '<div class="text-green" style="padding:8px 0; font-size:11px;">All sessions complete! Plan finished.</div>';
      } else {
        var html = '';
        upcoming.forEach(function(sess, idx) {
          var drillNames = (sess.drills || []).map(function(d) {
            return (d.type || '?').toUpperCase() + (d.subtype ? ' ' + d.subtype.replace(/_/g, ' ') : '');
          }).join(', ');
          var dayLabel = 'Day ' + (sess.day || (idx + 1));
          html += '<div style="display:flex; align-items:center; gap:8px; padding:6px 0; border-bottom:1px solid var(--border-dim); font-size:11px;">' +
            '<span style="color:var(--accent); font-weight:600; width:48px; flex-shrink:0;">' + dayLabel + '</span>' +
            '<span style="color:var(--text-primary); flex:1;">' + drillNames + '</span>' +
            '<span style="color:var(--text-dim);">' + (sess.drills || []).reduce(function(sum, d) { return sum + (d.count || 0); }, 0) + ' hands</span>' +
          '</div>';
        });
        upcomingEl.innerHTML = html;
      }
    }

    // Wire delete button
    if (deleteBtn && !deleteBtn._wired) {
      deleteBtn._wired = true;
      var self = this;
      deleteBtn.addEventListener('click', function() {
        var activePlan = GTO.Training.PlanEngine.getActivePlan();
        if (activePlan) {
          GTO.Training.PlanEngine.deletePlan(activePlan.id);
          GTO.UI.Toast.success('Plan deleted');
          self._renderActivePlan();
        }
      });
    }
  },

  // ═══════════════════ ICM TOGGLE ═══════════════════
  _setupICMToggle: function() {
    var self = this;

    // Default ICM enabled
    GTO.State.set('icmEnabled', true);

    // All ICM toggle checkboxes sync to one state
    var checkboxIds = ['explore-icm-check', 'preflop-icm-check', 'play-icm-check', 'postflop-icm-check', 'solver-icm-check'];
    checkboxIds.forEach(function(id) {
      var cb = document.getElementById(id);
      if (cb) {
        cb.addEventListener('change', function() {
          GTO.State.set('icmEnabled', this.checked);
          // Sync all checkboxes
          checkboxIds.forEach(function(otherId) {
            var other = document.getElementById(otherId);
            if (other) other.checked = GTO.State.get('icmEnabled');
          });
          // Refresh explore matrix if visible
          if (self._updateExploreMatrix) self._updateExploreMatrix();
        });
      }
    });

    // Show/hide ICM toggle when format changes
    var formatGroups = [
      { toggle: 'explore-format', icm: 'explore-icm-toggle' },
      { toggle: 'preflop-format-toggle', icm: 'preflop-icm-toggle' },
      { toggle: 'play-format-toggle', icm: 'play-icm-toggle' },
      { toggle: 'postflop-format-toggle', icm: 'postflop-icm-toggle' },
      { toggle: 'solver-format', icm: 'solver-icm-toggle' }
    ];

    formatGroups.forEach(function(fg) {
      var group = document.getElementById(fg.toggle);
      var icmEl = document.getElementById(fg.icm);
      if (!group || !icmEl) return;

      group.querySelectorAll('.toggle-option').forEach(function(opt) {
        opt.addEventListener('click', function() {
          var val = this.getAttribute('data-value');
          if (val === 'mtt') {
            icmEl.classList.remove('hidden');
          } else {
            icmEl.classList.add('hidden');
          }
          // Sync format across all tabs
          formatGroups.forEach(function(otherFg) {
            var otherGroup = document.getElementById(otherFg.toggle);
            var otherIcm = document.getElementById(otherFg.icm);
            if (!otherGroup) return;
            otherGroup.querySelectorAll('.toggle-option').forEach(function(o) {
              o.classList.toggle('active', o.getAttribute('data-value') === val);
            });
            if (otherIcm) {
              otherIcm.classList.toggle('hidden', val !== 'mtt');
            }
          });
          // Update status bar
          GTO.UI.HUD.updateFormat(val);
        });
      });
    });
  },

  // ═══════════════════ EXPLORE VIEW ═══════════════════
  _setupExplore: function() {
    var self = this;

    // Wire up all toggle groups in explore view
    document.querySelectorAll('#view-explore .toggle-option').forEach(function(opt) {
      opt.addEventListener('click', function() {
        var group = this.parentElement;
        group.querySelectorAll('.toggle-option').forEach(function(o) { o.classList.remove('active'); });
        this.classList.add('active');
        if (GTO.UI.Sounds) GTO.UI.Sounds.play('tick');

        // Handle mode switch
        if (group.id === 'explore-mode') {
          var mode = this.getAttribute('data-value');
          var preflopFilters = document.getElementById('explore-preflop-filters');
          var pfFilters = document.getElementById('explore-pushfold-filters');
          var solverFilters = document.getElementById('explore-solver-filters');
          var preflopStats = document.getElementById('explore-preflop-stats');
          var solverStats = document.getElementById('explore-solver-stats');
          var matrixSection = document.querySelector('.explore-matrix-section');
          var detailSection = document.querySelector('.explore-detail-section');
          var solverResults = document.getElementById('explore-solver-results');
          if (preflopFilters) preflopFilters.classList.toggle('hidden', mode !== 'preflop');
          if (pfFilters) pfFilters.classList.toggle('hidden', mode !== 'pushfold');
          if (solverFilters) solverFilters.classList.toggle('hidden', mode !== 'solver');
          if (preflopStats) preflopStats.style.display = mode === 'solver' ? 'none' : '';
          if (solverStats) solverStats.classList.toggle('hidden', mode !== 'solver');
          // Matrix + detail always visible — postflop uses the same range matrix
          if (matrixSection) matrixSection.style.display = '';
          if (detailSection) detailSection.style.display = '';
          // Solver results panel is hidden infrastructure (data rendered on matrix instead)
          if (solverResults) {
            solverResults.classList.add('hidden');
            solverResults.style.display = 'none';
          }
          // Toggle board display + legend variants
          var boardDisplay = document.getElementById('explore-board-display');
          var legendPreflop = document.getElementById('explore-legend-preflop');
          var legendPostflop = document.getElementById('explore-legend-postflop');
          if (boardDisplay) {
            boardDisplay.classList.toggle('hidden', mode !== 'solver');
            boardDisplay.style.display = mode === 'solver' ? 'inline-flex' : 'none';
          }
          if (legendPreflop) legendPreflop.classList.toggle('hidden', mode === 'solver');
          if (legendPostflop) legendPostflop.classList.toggle('hidden', mode !== 'solver');
          // Update freq bar labels for postflop context
          var foldLabel = document.getElementById('explore-freq-fold-label');
          var callLabel = document.getElementById('explore-freq-call-label');
          var raiseLabel = document.getElementById('explore-freq-raise-label');
          if (mode === 'solver') {
            if (foldLabel) foldLabel.textContent = 'FOLD';
            if (callLabel) callLabel.textContent = 'CHECK';
            if (raiseLabel) raiseLabel.textContent = 'BET';
          } else {
            if (foldLabel) foldLabel.textContent = 'FOLD';
            if (callLabel) callLabel.textContent = 'CALL';
            if (raiseLabel) raiseLabel.textContent = 'RAISE';
          }
          // Auto-load first solution when switching to solver mode
          if (mode === 'solver') {
            self._updateSolverFilters();
          }
          // Refresh matrix when switching back to preflop/pushfold
          if (mode !== 'solver') {
            self._updateExploreMatrix();
          }
        }

        // Skip solver toggles — handled by dedicated listeners below
        if (group.id === 'solver-depth' || group.id === 'solver-matchup' || group.id === 'solver-format') {
          return;
        }

        // Show/hide villain row for vs_raise/vs_3bet
        if (group.id === 'explore-action') {
          var action = this.getAttribute('data-value');
          var villainRow = document.getElementById('explore-villain-row');
          if (villainRow) villainRow.classList.toggle('hidden', action === 'rfi');
        }

        self._exploreActiveHand = null; // clear active hand on manual filter change
        self._updateExploreMatrix();
      });
    });

    // Wire up matrix cell clicks for hand details
    var exploreTable = document.getElementById('explore-matrix-table');
    if (exploreTable) {
      exploreTable.addEventListener('click', function(e) {
        var cell = e.target.closest('td[data-hand]');
        if (cell) {
          if (GTO.UI.Sounds) GTO.UI.Sounds.play('tick');
          self._showExploreHandDetail(cell.getAttribute('data-hand'));
        }
      });
    }

    // Wire "View Postflop" button
    var postflopBtn = document.getElementById('explore-view-postflop');
    if (postflopBtn) {
      postflopBtn.addEventListener('click', function() {
        self._transitionToPostflopExplore();
      });
    }

    // Wire preflop SOLVE button
    var preflopSolveBtn = document.getElementById('btn-explore-preflop-solve');
    if (preflopSolveBtn) {
      preflopSolveBtn.addEventListener('click', function() {
        self._solvePreflopExplore();
      });
    }

    // Initial render
    this._updateExploreMatrix();

    // ── Solver filter auto-trigger wiring ──
    // These use MutationObserver-style approach: the general toggle handler above
    // sets .active, then we detect the change and trigger _autoSolve.
    ['solver-depth', 'solver-matchup', 'solver-format'].forEach(function(groupId) {
      var group = document.getElementById(groupId);
      if (!group) return;
      // Track the current active value so we can detect changes
      var lastActive = (group.querySelector('.toggle-option.active') || {}).getAttribute &&
                       group.querySelector('.toggle-option.active') ?
                       group.querySelector('.toggle-option.active').getAttribute('data-value') : null;
      group.addEventListener('click', function(e) {
        var opt = e.target.closest('.toggle-option');
        if (!opt) return;
        var newVal = opt.getAttribute('data-value');
        if (newVal !== lastActive) {
          lastActive = newVal;
          self._autoSolve();
        }
      });
    });

    // Open board picker modal
    var openBtn = document.getElementById('solver-open-board-picker');
    if (openBtn) {
      openBtn.addEventListener('click', function() { self._openBoardPicker(); });
    }

    // Board picker modal wiring
    this._initBoardPickerModal();
  },

  _updateExploreMatrix: function() {
    // Reset hand details to empty state
    var emptyEl = document.getElementById('explore-hand-empty');
    var infoEl = document.getElementById('explore-hand-info');
    if (emptyEl) emptyEl.style.display = '';
    if (infoEl) infoEl.classList.add('hidden');

    var modeEl = document.querySelector('#explore-mode .toggle-option.active');
    var mode = modeEl ? modeEl.getAttribute('data-value') : 'preflop';

    // Solver mode doesn't use the preflop matrix
    if (mode === 'solver') return;

    if (mode === 'preflop') {
      var formatEl = document.querySelector('#explore-format .toggle-option.active');
      var stackEl = document.querySelector('#explore-stack .toggle-option.active');
      var posEl = document.querySelector('#explore-position .toggle-option.active');
      var actionEl = document.querySelector('#explore-action .toggle-option.active');

      var format = formatEl ? formatEl.getAttribute('data-value') : 'cash';
      var stack = stackEl ? stackEl.getAttribute('data-value') : '100bb';
      var position = posEl ? posEl.getAttribute('data-value') : 'UTG';
      var actionCtx = actionEl ? actionEl.getAttribute('data-value') : 'rfi';

      var positionKey = position;
      if (actionCtx === 'vs_raise' || actionCtx === 'vs_3bet' || actionCtx === 'vs_4bet') {
        var villainEl = document.querySelector('#explore-villain .toggle-option.active');
        var villain = villainEl ? villainEl.getAttribute('data-value') : 'UTG';
        // vs_raise: villain_hero, vs_3bet: hero_villain, vs_4bet: villain_hero
        positionKey = actionCtx === 'vs_3bet' ? position + '_' + villain : villain + '_' + position;
      }

      // Build range data for the scenario
      var scenario = { format: format, stackDepth: stack, actionContext: actionCtx, position: position, positionKey: positionKey };
      var rangeData = GTO.Engine.PreflopDrill.getRangeForScenario(scenario);

      // ICM adjustment: tighten ranges when format=mtt and ICM enabled
      var icmLabel = '';
      if (format === 'mtt' && GTO.Engine.ICM && GTO.State.get('icmEnabled') !== false) {
        var bf = this._getExploreBubbleFactor();
        if (bf > 1.0) {
          var icmSpotType = (actionCtx === 'rfi') ? 'preflop_rfi' : 'preflop_call';
          GTO.Data.ALL_HANDS.forEach(function(h) {
            if (rangeData[h]) {
              rangeData[h] = GTO.Engine.ICM.adjustFrequencies(rangeData[h], bf, icmSpotType);
            }
          });
          icmLabel = ' [ICM BF:' + bf.toFixed(1) + 'x]';
        }
      }

      var activeHand = this._exploreActiveHand || null;
      GTO.UI.HandMatrix.updateMatrix('explore-matrix-table', rangeData, null, activeHand);

      // Update label
      var label = document.getElementById('explore-matrix-label');
      if (label) label.textContent = actionCtx.toUpperCase().replace('_', ' ') + ' — ' + position + ' — ' + stack + icmLabel;

      // Update source indicator — detect whether data came from solver cache or curated
      var sourceEl = document.getElementById('explore-preflop-source');
      if (sourceEl) {
        var sampleLookup = GTO.Data.lookupPreflop(format, stack, actionCtx, positionKey, 'AA');
        if (sampleLookup && sampleLookup._source === 'solver') {
          var cachedMeta = GTO.PreflopSolverCache && GTO.PreflopSolverCache.lookup(format, stack, actionCtx, positionKey);
          var metaStr = cachedMeta && cachedMeta.meta ? ' (' + cachedMeta.meta.iterations + ' iter)' : '';
          sourceEl.textContent = 'Solver' + metaStr;
          sourceEl.style.color = 'var(--green)';
        } else {
          sourceEl.textContent = 'Curated';
          sourceEl.style.color = 'var(--text-dim)';
        }
      }

      // Update combo count — count all non-fold combos (raise + call)
      this._exploreRangeData = rangeData;
      var combos = 0;
      var totalCombos = 0;
      GTO.Data.ALL_HANDS.forEach(function(h) {
        var c = GTO.Data.COMBOS[h] || 0;
        totalCombos += c;
        if (rangeData[h]) {
          var actionFreq = (rangeData[h].raise || 0) + (rangeData[h].call || 0);
          combos += c * actionFreq;
        }
      });
      var comboEl = document.getElementById('explore-combo-count');
      var pctEl = document.getElementById('explore-hand-pct');
      if (comboEl) comboEl.textContent = Math.round(combos);
      if (pctEl) pctEl.textContent = (totalCombos > 0 ? (combos / totalCombos * 100).toFixed(1) : '0') + '%';

    } else {
      // Push/fold mode (always tournament context)
      var pfStackEl = document.querySelector('#explore-pf-stack .toggle-option.active');
      var pfPosEl = document.querySelector('#explore-pf-position .toggle-option.active');
      var stackBB = pfStackEl ? parseInt(pfStackEl.getAttribute('data-value')) : 10;
      var pfPos = pfPosEl ? pfPosEl.getAttribute('data-value') : 'UTG';

      // Check ICM adjustment for push/fold (only in MTT format)
      var pfFormatEl = document.querySelector('#explore-format .toggle-option.active');
      var pfFormat = pfFormatEl ? pfFormatEl.getAttribute('data-value') : 'cash';
      var icmEnabled = pfFormat === 'mtt' && GTO.Engine.ICM && GTO.State.get('icmEnabled') !== false;
      var bf = icmEnabled ? this._getExploreBubbleFactor() : 1.0;

      var rangeData = {};
      GTO.Data.ALL_HANDS.forEach(function(h) {
        var lookup = GTO.Data.lookupPushFold(6, pfPos, stackBB, h);
        var inRange = lookup ? lookup.inRange : false;
        var freqs = { fold: inRange ? 0 : 1, call: 0, raise: inRange ? 1 : 0 };
        // Under ICM pressure, marginal pushes become folds
        if (icmEnabled && bf > 1.0) {
          freqs = GTO.Engine.ICM.adjustFrequencies(freqs, bf, 'pushfold');
        }
        rangeData[h] = freqs;
      });
      var activeHand = this._exploreActiveHand || null;
      GTO.UI.HandMatrix.updateMatrix('explore-matrix-table', rangeData, 'raise', activeHand);

      var icmLabel = (icmEnabled && bf > 1.0) ? ' [ICM BF:' + bf.toFixed(1) + 'x]' : '';
      var label = document.getElementById('explore-matrix-label');
      if (label) label.textContent = 'PUSH/FOLD — ' + pfPos + ' — ' + stackBB + 'BB' + icmLabel;

      this._exploreRangeData = rangeData;
      var combos = 0;
      GTO.Data.ALL_HANDS.forEach(function(h) {
        if (rangeData[h] && rangeData[h].raise > 0) combos += (GTO.Data.COMBOS[h] || 0) * rangeData[h].raise;
      });
      var comboEl = document.getElementById('explore-combo-count');
      var pctEl = document.getElementById('explore-hand-pct');
      if (comboEl) comboEl.textContent = Math.round(combos);
      if (pctEl) pctEl.textContent = (combos / 1326 * 100).toFixed(1) + '%';
    }

    // Update summary bar
    GTO.UI.HandMatrix.updateSummaryBar('explore-summary-bar', this._exploreRangeData);

    // If an active hand was set (from drill/play "View Range"), auto-show its detail
    if (this._exploreActiveHand) {
      this._showExploreHandDetail(this._exploreActiveHand);
      this._exploreActiveHand = null; // clear so manual filter changes don't re-trigger
    }
  },

  // Run the preflop WASM solver for the current Explore preflop filters
  _solvePreflopExplore: function() {
    var self = this;

    // Read current filter values
    var formatEl = document.querySelector('#explore-format .toggle-option.active');
    var stackEl = document.querySelector('#explore-stack .toggle-option.active');
    var posEl = document.querySelector('#explore-position .toggle-option.active');
    var actionEl = document.querySelector('#explore-action .toggle-option.active');

    var format = formatEl ? formatEl.getAttribute('data-value') : 'cash';
    var stack = stackEl ? stackEl.getAttribute('data-value') : '100bb';
    var position = posEl ? posEl.getAttribute('data-value') : 'UTG';
    var actionCtx = actionEl ? actionEl.getAttribute('data-value') : 'rfi';

    var positionKey = position;
    if (actionCtx !== 'rfi') {
      var villainEl = document.querySelector('#explore-villain .toggle-option.active');
      var villain = villainEl ? villainEl.getAttribute('data-value') : 'UTG';
      positionKey = actionCtx === 'vs_3bet' ? position + '_' + villain : villain + '_' + position;
    }

    // Show progress
    var progressEl = document.getElementById('explore-preflop-solve-progress');
    var statusEl = document.getElementById('explore-preflop-solve-status');
    var solveBtn = document.getElementById('btn-explore-preflop-solve');
    if (progressEl) progressEl.classList.remove('hidden');
    if (solveBtn) solveBtn.disabled = true;

    var stackBB = parseInt(stack);

    // Build ICM bubble factor if applicable
    var icmBubbleFactor = 1.0;
    if (format === 'mtt' && GTO.Engine.ICM && GTO.State.get('icmEnabled') !== false) {
      icmBubbleFactor = this._getExploreBubbleFactor();
    }

    // Use the preflop solver API
    if (!GTO.PreflopSolver) {
      if (statusEl) statusEl.textContent = 'Solver not available';
      if (solveBtn) solveBtn.disabled = false;
      return;
    }

    GTO.PreflopSolver.solve({
      stackDepth: stackBB,
      actionContext: actionCtx,
      position: position,
      icmBubbleFactor: icmBubbleFactor > 1.0 ? icmBubbleFactor : undefined,
      onProgress: function(msg) {
        if (statusEl) {
          statusEl.textContent = 'Iter ' + msg.iterations + ' | Exploit: ' + msg.exploitability.toFixed(4);
        }
      }
    }).then(function(result) {
      // Cache the result for future lookups
      if (GTO.PreflopSolverCache) {
        var compactResult = result.compact || {};
        compactResult.meta = {
          iterations: result.iterations,
          exploitability: result.exploitability
        };
        GTO.PreflopSolverCache.store(format, stack, actionCtx, positionKey, compactResult);
      }

      // Build range data from solver results
      var rangeData = {};
      if (result.results) {
        var hands = Object.keys(result.results);
        for (var i = 0; i < hands.length; i++) {
          var h = hands[i];
          var r = result.results[h];
          rangeData[h] = { fold: r.fold || 0, call: r.call || 0, raise: r.raise || 0 };
        }
      }

      // Fill in any missing hands as fold
      if (GTO.Data.ALL_HANDS) {
        GTO.Data.ALL_HANDS.forEach(function(h) {
          if (!rangeData[h]) rangeData[h] = { fold: 1, call: 0, raise: 0 };
        });
      }

      // Update the matrix with solver results
      self._exploreRangeData = rangeData;
      GTO.UI.HandMatrix.updateMatrix('explore-matrix-table', rangeData, null, null);
      GTO.UI.HandMatrix.updateSummaryBar('explore-summary-bar', rangeData);

      // Update combo count
      var combos = 0;
      var totalCombos = 0;
      if (GTO.Data.ALL_HANDS) {
        GTO.Data.ALL_HANDS.forEach(function(h) {
          var c = GTO.Data.COMBOS[h] || 0;
          totalCombos += c;
          if (rangeData[h]) {
            combos += c * ((rangeData[h].raise || 0) + (rangeData[h].call || 0));
          }
        });
      }
      var comboEl = document.getElementById('explore-combo-count');
      var pctEl = document.getElementById('explore-hand-pct');
      if (comboEl) comboEl.textContent = Math.round(combos);
      if (pctEl) pctEl.textContent = (totalCombos > 0 ? (combos / totalCombos * 100).toFixed(1) : '0') + '%';

      // Update label with SOLVER badge
      var label = document.getElementById('explore-matrix-label');
      if (label) label.textContent = actionCtx.toUpperCase().replace('_', ' ') + ' — ' + position + ' — ' + stack + ' [SOLVER]';

      // Update source indicator
      var sourceEl = document.getElementById('explore-preflop-source');
      if (sourceEl) {
        sourceEl.textContent = 'WASM Solver (' + result.iterations + ' iter, ' + result.exploitability.toFixed(4) + ' exploit)';
        sourceEl.style.color = 'var(--green)';
      }

      // Hide progress
      if (progressEl) progressEl.classList.add('hidden');
      if (solveBtn) solveBtn.disabled = false;

      if (GTO.UI.Toast) GTO.UI.Toast.show('Preflop solver complete — ' + Math.round(combos) + ' combos');
    }).catch(function(err) {
      console.error('[PreflopSolver] Error:', err);
      if (statusEl) statusEl.textContent = 'Error: ' + (err.message || err);
      if (solveBtn) solveBtn.disabled = false;
      if (GTO.UI.Toast) GTO.UI.Toast.show('Solver error: ' + (err.message || err), 'error');
    });
  },

  // Get bubble factor for Explore ICM adjustments
  // Uses a synthetic table context based on current stack depth setting
  _getExploreBubbleFactor: function() {
    var structEl = document.querySelector('#mtt-structure-toggle .toggle-option.active');
    var structKey = structEl ? structEl.getAttribute('data-value') : '9max_sng';
    if (!GTO.Data.TournamentStructures || !GTO.Engine.ICM) return 1.0;
    var structure = GTO.Data.TournamentStructures.get(structKey);
    var stackEl = document.querySelector('#explore-stack .toggle-option.active');
    var stackBB = stackEl ? parseInt(stackEl.getAttribute('data-value')) : 25;
    // Generate a representative table for the explore context
    var stacks = GTO.Data.TournamentStructures.generateTableStacks({
      players: structure.players, heroIdx: 0,
      heroStackBB: stackBB, avgStackBB: stackBB, stage: 'normal'
    });
    var prizes = GTO.Data.TournamentStructures.getPrizes(structKey, 100);
    return GTO.Engine.ICM.bubbleFactor(0, stacks, prizes, stackBB);
  },

  _showExploreHandDetail: function(hand) {
    if (!hand) return;

    // Hide empty state, show hand info
    var emptyEl = document.getElementById('explore-hand-empty');
    var infoEl = document.getElementById('explore-hand-info');
    if (emptyEl) emptyEl.style.display = 'none';
    if (infoEl) infoEl.classList.remove('hidden');

    var selectedEl = document.getElementById('explore-selected-hand');
    if (selectedEl) selectedEl.textContent = hand;

    var modeEl = document.querySelector('#explore-mode .toggle-option.active');
    var mode = modeEl ? modeEl.getAttribute('data-value') : 'preflop';
    var rangeData = (mode === 'solver') ? (this._postflopRangeData || {}) : (this._exploreRangeData || {});
    var freqs = rangeData[hand] || { fold: 1, call: 0, raise: 0 };

    // Update freq bars
    var foldFill = document.getElementById('explore-freq-fold');
    var callFill = document.getElementById('explore-freq-call');
    var raiseFill = document.getElementById('explore-freq-raise');
    if (foldFill) foldFill.style.width = Math.round(freqs.fold * 100) + '%';
    if (callFill) callFill.style.width = Math.round(freqs.call * 100) + '%';
    if (raiseFill) raiseFill.style.width = Math.round(freqs.raise * 100) + '%';

    var foldVal = document.getElementById('explore-freq-fold-val');
    var callVal = document.getElementById('explore-freq-call-val');
    var raiseVal = document.getElementById('explore-freq-raise-val');
    if (foldVal) foldVal.textContent = Math.round(freqs.fold * 100) + '%';
    if (callVal) callVal.textContent = Math.round(freqs.call * 100) + '%';
    if (raiseVal) raiseVal.textContent = Math.round(freqs.raise * 100) + '%';

    // Update labels based on postflop mode
    if (mode === 'solver' && this._postflopActions) {
      var actionNames = this._postflopActions.map(function(a) { return a.split(':')[0]; });
      var hasCheck = actionNames.indexOf('Check') >= 0;
      var hasBet = actionNames.indexOf('Bet') >= 0;
      var callLabelEl = document.getElementById('explore-freq-call-label');
      var raiseLabelEl = document.getElementById('explore-freq-raise-label');
      if (callLabelEl) callLabelEl.textContent = hasCheck ? 'CHECK' : 'CALL';
      if (raiseLabelEl) raiseLabelEl.textContent = hasBet ? 'BET' : 'RAISE';
    }

    var combosEl = document.getElementById('explore-hand-combos');
    var typeEl = document.getElementById('explore-hand-type');
    if (combosEl) combosEl.textContent = GTO.Data.COMBOS[hand] || '?';
    if (typeEl) {
      if (GTO.Data.isPair(hand)) typeEl.textContent = 'Pocket Pair';
      else if (GTO.Data.isSuited(hand)) typeEl.textContent = 'Suited';
      else typeEl.textContent = 'Offsuit';
    }

    // Render combo grid
    this._renderComboGrid(hand);

    // Show/hide "View Postflop" button (only in preflop mode)
    var postflopBtn = document.getElementById('explore-view-postflop');
    if (postflopBtn) {
      postflopBtn.style.display = (mode === 'preflop') ? '' : 'none';
    }
  },

  _positionToMatchup: function(position) {
    var map = {
      'UTG': 'UTG_vs_BB', 'MP': 'UTG_vs_BB', 'CO': 'CO_vs_BB',
      'BTN': 'BTN_vs_BB', 'SB': 'SB_vs_BB'
    };
    return map[position] || 'BTN_vs_BB';
  },

  _transitionToPostflopExplore: function() {
    // Read current preflop state
    var formatEl = document.querySelector('#explore-format .toggle-option.active');
    var format = formatEl ? formatEl.getAttribute('data-value') : 'cash';
    var stackEl = document.querySelector('#explore-stack .toggle-option.active');
    var stack = stackEl ? stackEl.getAttribute('data-value') : '100bb';
    var posEl = document.querySelector('#explore-position .toggle-option.active');
    var position = posEl ? posEl.getAttribute('data-value') : 'BTN';

    // Map to matchup
    var matchupKey = this._positionToMatchup(position);

    // Switch to solver mode
    var solverOpt = document.querySelector('#explore-mode .toggle-option[data-value="solver"]');
    if (solverOpt) solverOpt.click();

    // Set solver matchup toggle
    var matchupOpt = document.querySelector('#solver-matchup .toggle-option[data-value="' + matchupKey + '"]');
    if (matchupOpt) matchupOpt.click();

    // Set solver depth to match preflop stack
    var depthOpt = document.querySelector('#solver-depth .toggle-option[data-value="' + stack + '"]');
    if (depthOpt) depthOpt.click();

    // Set solver format to match preflop format
    var solverFmtOpt = document.querySelector('#solver-format .toggle-option[data-value="' + format + '"]');
    if (solverFmtOpt) solverFmtOpt.click();

    // Auto-solve will be triggered by the toggle changes
  },

  _renderComboGrid: function(hand) {
    var container = document.getElementById('explore-combo-grid');
    if (!container) return;

    var modeEl = document.querySelector('#explore-mode .toggle-option.active');
    var mode = modeEl ? modeEl.getAttribute('data-value') : 'preflop';
    var rangeData = (mode === 'solver') ? (this._postflopRangeData || {}) : (this._exploreRangeData || {});
    var freqs = rangeData[hand] || { fold: 1, call: 0, raise: 0 };

    var SUITS = ['s', 'h', 'd', 'c'];
    var SYM = { s: '\u2660', h: '\u2665', d: '\u2666', c: '\u2663' };
    var SCOL = { s: 'var(--text-primary)', h: '#ff433d', d: '#0068ff', c: '#4af6c3' };

    var combos = [];
    if (GTO.Data.isPair(hand)) {
      var r = hand[0];
      for (var i = 0; i < 4; i++)
        for (var j = i + 1; j < 4; j++)
          combos.push([r, SUITS[i], r, SUITS[j]]);
    } else if (GTO.Data.isSuited(hand)) {
      var r1 = hand[0], r2 = hand[1];
      for (var i = 0; i < 4; i++)
        combos.push([r1, SUITS[i], r2, SUITS[i]]);
    } else {
      var r1 = hand[0], r2 = hand[1];
      for (var i = 0; i < 4; i++)
        for (var j = 0; j < 4; j++)
          if (i !== j) combos.push([r1, SUITS[i], r2, SUITS[j]]);
    }

    var r = freqs.raise || 0, c = freqs.call || 0, f = freqs.fold || 0;
    var total = r + c + f || 1;
    var rP = (r / total * 100).toFixed(1);
    var cP = (c / total * 100).toFixed(1);
    var rcP = (parseFloat(rP) + parseFloat(cP)).toFixed(1);
    var grad = 'linear-gradient(to right, rgba(74,246,195,0.5) 0% ' + rP + '%, rgba(0,104,255,0.5) ' + rP + '% ' + rcP + '%, #1a1a1a ' + rcP + '% 100%)';

    var html = '';
    combos.forEach(function(cb) {
      html += '<div class="combo-chip">' +
        '<span class="combo-chip-cards">' +
          '<span style="color:' + SCOL[cb[1]] + '">' + cb[0] + SYM[cb[1]] + '</span>' +
          '<span style="color:' + SCOL[cb[3]] + '">' + cb[2] + SYM[cb[3]] + '</span>' +
        '</span>' +
        '<div class="combo-mini-bar" style="background:' + grad + '"></div>' +
      '</div>';
    });

    container.innerHTML = html;
  },

  _exploreRangeData: null,
  _solverResults: null,
  _postflopRangeData: null,
  _postflopActions: null,

  // ═══════════════════ SOLVER (GTO Wizard-style) ═══════════════════
  _solveGeneration: 0,

  // Map solver action names to matrix color slots
  _solverActionSlots: function(actions) {
    var AGGRESSIVE = { 'Bet': true, 'Raise': true, 'Allin': true };
    var PASSIVE = { 'Check': true, 'Call': true };
    return actions.map(function(a) {
      var name = a.split(':')[0];
      if (name === 'Fold') return 'fold';
      if (AGGRESSIVE[name]) return 'raise';
      if (PASSIVE[name]) return 'call';
      return 'raise';
    });
  },

  // Convert pre-computed (aggregate) solution to rangeData for matrix
  _buildPostflopRangeDataFromCache: function(cached, matchup) {
    var player = cached.player || 'oop';
    var rangeStr = player === 'oop' ? matchup.oopRange : matchup.ipRange;
    var hands = rangeStr.split(',').map(function(h) { return h.trim(); });

    var actions = (cached.actions || '').split('/');
    var strategy = cached.strategy || [];
    var slots = this._solverActionSlots(actions);

    // Build aggregate frequencies
    var aggFreqs = { raise: 0, call: 0, fold: 0 };
    for (var i = 0; i < actions.length; i++) {
      aggFreqs[slots[i]] += (strategy[i] || 0);
    }

    var rangeData = {};
    for (var i = 0; i < hands.length; i++) {
      if (hands[i]) rangeData[hands[i]] = { raise: aggFreqs.raise, call: aggFreqs.call, fold: aggFreqs.fold };
    }
    return rangeData;
  },

  // Convert WASM per-hand solver output to rangeData for matrix
  _buildPostflopRangeDataFromWASM: function(results) {
    var RANKS_STR = '23456789TJQKA';
    var data = results.results || [];
    var actions = (results.actions || '').split('/');
    var player = results.player || 'oop';
    var numActions = results.numActions || actions.length;
    var oopCards = results.oopCards || [];
    var ipCards = results.ipCards || [];
    var isOop = player === 'oop';
    var cards = isOop ? oopCards : ipCards;
    var numCombos = cards.length;
    var oopN = oopCards.length;
    var ipN = ipCards.length;

    if (data.length < 3 || numCombos === 0) return {};

    var slots = this._solverActionSlots(actions);

    // Extract weights
    var weightOffset = 3 + (isOop ? 0 : oopN);
    var weights = data.slice(weightOffset, weightOffset + numCombos);

    // Extract strategy (same parsing as _renderSolverResults)
    var isEmptyFlag = data[2];
    var offset = 3 + oopN + ipN + oopN + ipN;
    if (isEmptyFlag === 0) {
      offset += oopN + ipN + oopN + ipN + oopN + ipN;
    }

    var strategy = [];
    if (data.length >= offset + numActions * numCombos) {
      for (var a = 0; a < numActions; a++) {
        var actionStrat = [];
        for (var c = 0; c < numCombos; c++) {
          actionStrat.push(data[offset + a * numCombos + c]);
        }
        strategy.push(actionStrat);
      }
    }

    // Map combos to hand names and accumulate
    var handAccum = {};
    for (var i = 0; i < numCombos; i++) {
      var w = weights[i] || 0;
      if (w < 0.001) continue;

      // Cards are packed as pairs: [c1, c2] in the array
      var c1, c2;
      if (Array.isArray(cards[i])) {
        c1 = cards[i][0]; c2 = cards[i][1];
      } else {
        c1 = cards[i] & 0xFF; c2 = (cards[i] >> 8) & 0xFF;
      }
      var r1 = Math.floor(c1 / 4);
      var r2 = Math.floor(c2 / 4);

      // Build hand name (higher rank first)
      var highR = Math.max(r1, r2);
      var lowR = Math.min(r1, r2);
      var handName;
      if (r1 === r2) {
        handName = RANKS_STR[r1] + RANKS_STR[r2];
      } else if ((c1 % 4) === (c2 % 4)) {
        handName = RANKS_STR[highR] + RANKS_STR[lowR] + 's';
      } else {
        handName = RANKS_STR[highR] + RANKS_STR[lowR] + 'o';
      }

      if (!handAccum[handName]) {
        handAccum[handName] = { raise: 0, call: 0, fold: 0, totalWeight: 0 };
      }

      for (var a = 0; a < numActions; a++) {
        var freq = strategy[a] ? strategy[a][i] : 0;
        handAccum[handName][slots[a]] += freq * w;
      }
      handAccum[handName].totalWeight += w;
    }

    // Normalize to [0,1] per hand
    var rangeData = {};
    for (var h in handAccum) {
      var acc = handAccum[h];
      var tw = acc.totalWeight;
      if (tw > 0) {
        rangeData[h] = {
          raise: acc.raise / tw,
          call: acc.call / tw,
          fold: acc.fold / tw
        };
      }
    }
    return rangeData;
  },

  // Apply ICM adjustment to postflop rangeData when MTT + ICM enabled
  _applyICMToRangeData: function(rangeData) {
    // Read format from the correct toggle depending on explore mode
    var modeEl = document.querySelector('#explore-mode .toggle-option.active');
    var mode = modeEl ? modeEl.getAttribute('data-value') : 'preflop';
    var formatEl;
    if (mode === 'solver') {
      formatEl = document.querySelector('#solver-format .toggle-option.active');
    } else {
      formatEl = document.querySelector('#explore-format .toggle-option.active');
    }
    var format = formatEl ? formatEl.getAttribute('data-value') : 'cash';
    if (format !== 'mtt') return rangeData;
    if (!GTO.Engine.ICM || GTO.State.get('icmEnabled') === false) return rangeData;

    var bf = this._getExploreBubbleFactor();
    if (bf <= 1.0) return rangeData;

    var adjusted = {};
    var keys = Object.keys(rangeData);
    for (var i = 0; i < keys.length; i++) {
      adjusted[keys[i]] = GTO.Engine.ICM.adjustFrequencies(rangeData[keys[i]], bf, 'postflop_bet');
    }
    return adjusted;
  },

  // Render inline board cards in the matrix header
  _updatePostflopBoardDisplay: function(boardCards) {
    var container = document.getElementById('explore-board-display');
    if (!container || !boardCards) return;
    var html = '';
    boardCards.forEach(function(c) {
      var card = typeof c === 'string' ? { rank: c[0], suit: c[1] } : c;
      html += GTO.UI.BoardDisplay.renderCard(card);
    });
    container.innerHTML = html;
  },

  // Update matrix label for postflop context
  _updatePostflopMatrixLabel: function(matchup, boardCards) {
    var label = document.getElementById('explore-matrix-label');
    if (!label) return;
    var boardStr = boardCards.map(function(c) {
      return typeof c === 'string' ? c.toUpperCase() : (c.rank + c.suit).toUpperCase();
    }).join(' ');
    label.textContent = (matchup.label || '') + ' \u2014 ' + boardStr;
  },

  _selectedBoardCards: [], // array of card strings like ['Ac','7d','2h']

  // ── Board Picker Modal ──
  _initBoardPickerModal: function() {
    var self = this;

    // Build the 4x13 card grid
    var grid = document.getElementById('bp-card-grid');
    if (grid) {
      var RANKS = ['A','K','Q','J','T','9','8','7','6','5','4','3','2'];
      var SUITS = [
        { code: 's', sym: '\u2660', name: 'spades' },
        { code: 'h', sym: '\u2665', name: 'hearts' },
        { code: 'd', sym: '\u2666', name: 'diamonds' },
        { code: 'c', sym: '\u2663', name: 'clubs' }
      ];
      var html = '';
      SUITS.forEach(function(suit) {
        RANKS.forEach(function(rank) {
          var card = rank + suit.code;
          html += '<div class="bp-card bp-suit-' + suit.code + '" data-card="' + card + '">' +
            rank + suit.sym + '</div>';
        });
      });
      grid.innerHTML = html;

      grid.addEventListener('click', function(e) {
        var el = e.target.closest('.bp-card');
        if (!el) return;
        var card = el.getAttribute('data-card');
        var len = self._selectedBoardCards.length;
        var idx = self._selectedBoardCards.indexOf(card);

        if (idx >= 0) {
          // Deselect: remove this card and any later-street cards
          self._selectedBoardCards = self._selectedBoardCards.slice(0, idx);
        } else if (len < 3) {
          // Building flop: add cards until we have 3
          self._selectedBoardCards.push(card);
        } else if (len === 3) {
          // Flop complete → set turn card (slot 3)
          self._selectedBoardCards[3] = card;
        } else if (len === 4) {
          // Turn set → set river card (slot 4)
          self._selectedBoardCards[4] = card;
        } else {
          // Board full (5 cards) → replace river card
          self._selectedBoardCards[4] = card;
        }
        self._updateBoardPickerDisplay();
      });
    }

    // Texture preset tabs
    var textureGroup = document.getElementById('bp-texture');
    if (textureGroup) {
      textureGroup.addEventListener('click', function(e) {
        var opt = e.target.closest('.toggle-option');
        if (!opt) return;
        textureGroup.querySelectorAll('.toggle-option').forEach(function(o) { o.classList.remove('active'); });
        opt.classList.add('active');
        self._populatePresetBoards();
      });
    }

    // Preset board clicks
    var presetContainer = document.getElementById('bp-preset-boards');
    if (presetContainer) {
      presetContainer.addEventListener('click', function(e) {
        var el = e.target.closest('.bp-preset-board');
        if (!el) return;
        var boardLabel = el.getAttribute('data-board');
        var boards = GTO.Data.PostflopBoards || [];
        for (var i = 0; i < boards.length; i++) {
          if (boards[i].label === boardLabel) {
            self._selectedBoardCards = boards[i].board.slice();
            self._updateBoardPickerDisplay();
            // Close modal — _closeBoardPicker handles preview update + autoSolve
            self._closeBoardPicker();
            return;
          }
        }
      });
    }

    // Clear button
    var clearBtn = document.getElementById('bp-clear');
    if (clearBtn) {
      clearBtn.addEventListener('click', function() {
        self._selectedBoardCards = [];
        self._updateBoardPickerDisplay();
      });
    }

    // Random button
    var randomBtn = document.getElementById('bp-random');
    if (randomBtn) {
      randomBtn.addEventListener('click', function() {
        self._randomSolverBoard();
        self._updateBoardPickerDisplay();
      });
    }

    // CONFIRM button — apply selection and solve
    var confirmBtn = document.getElementById('bp-confirm');
    if (confirmBtn) {
      confirmBtn.addEventListener('click', function() { self._confirmBoardPicker(); });
    }

    // CANCEL button — revert to previous selection
    var cancelBtn = document.getElementById('bp-cancel');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', function() { self._cancelBoardPicker(); });
    }

    // Close X button — same as cancel
    var closeBtn = document.querySelector('#modal-board-picker .modal-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', function() { self._cancelBoardPicker(); });
    }

    // Init preset boards
    this._populatePresetBoards();
  },

  _boardPickerPrevCards: null,

  _openBoardPicker: function() {
    // Save current state so we can revert on cancel
    this._boardPickerPrevCards = this._selectedBoardCards.slice();
    var modal = document.getElementById('modal-board-picker');
    if (modal) modal.classList.remove('hidden');
    this._updateBoardPickerDisplay();
  },

  _confirmBoardPicker: function() {
    var modal = document.getElementById('modal-board-picker');
    if (modal) modal.classList.add('hidden');
    this._boardPickerPrevCards = null;
    // Apply: update preview and solve
    this._updateBoardPreview();
    if (this._selectedBoardCards.length >= 3) {
      this._autoSolve();
    }
  },

  _cancelBoardPicker: function() {
    // Revert to previous selection
    if (this._boardPickerPrevCards) {
      this._selectedBoardCards = this._boardPickerPrevCards.slice();
    }
    this._boardPickerPrevCards = null;
    var modal = document.getElementById('modal-board-picker');
    if (modal) modal.classList.add('hidden');
  },

  _closeBoardPicker: function() {
    // Legacy — now routes through confirm
    this._confirmBoardPicker();
  },

  _updateBoardPickerDisplay: function() {
    // Update grid highlights
    var grid = document.getElementById('bp-card-grid');
    if (grid) {
      var selected = this._selectedBoardCards;
      grid.querySelectorAll('.bp-card').forEach(function(el) {
        el.classList.toggle('bp-selected', selected.indexOf(el.getAttribute('data-card')) >= 0);
      });
    }

    // Update selected cards display in modal
    var display = document.getElementById('bp-selected-cards');
    if (display) {
      var html = '';
      // Show 5 slots: 3 flop + turn + river
      for (var i = 0; i < 5; i++) {
        if (i === 3) html += '<div class="bp-street-sep"></div>';
        if (i === 4) html += '<div class="bp-street-sep"></div>';
        if (i < this._selectedBoardCards.length) {
          var c = this._selectedBoardCards[i];
          html += GTO.UI.BoardDisplay.renderCard({ rank: c[0], suit: c[1] });
        } else {
          var label = i < 3 ? '' : (i === 3 ? 'T' : 'R');
          html += '<div class="bp-placeholder">' + label + '</div>';
        }
      }
      display.innerHTML = html;
    }

    // Update street labels to show active street
    var streetLabels = document.getElementById('bp-street-labels');
    if (streetLabels) {
      var n = this._selectedBoardCards.length;
      var flopLabel = n < 3 ? 'FLOP (' + (3 - n) + ' more)' : 'FLOP';
      var turnLabel = n === 3 ? 'TURN (pick 1)' : 'TURN (+1)';
      var riverLabel = n === 4 ? 'RIVER (pick 1)' : 'RIVER (+1)';
      streetLabels.innerHTML =
        '<span style="color:' + (n < 3 ? 'var(--accent)' : 'var(--text-dim)') + '">' + flopLabel + '</span>' +
        '<span style="margin-left:12px;color:' + (n === 3 ? 'var(--accent)' : 'var(--text-dim)') + '">' + turnLabel + '</span>' +
        '<span style="margin-left:12px;color:' + (n === 4 ? 'var(--accent)' : 'var(--text-dim)') + '">' + riverLabel + '</span>';
    }
  },

  _updateBoardPreview: function() {
    // Update the small board preview in the filter panel
    var display = document.getElementById('solver-board-preview');
    if (!display) return;
    if (this._selectedBoardCards.length === 0) {
      display.innerHTML = '<span style="font-size:9px;color:var(--text-dim);">No board selected</span>';
    } else {
      var html = '';
      for (var i = 0; i < this._selectedBoardCards.length; i++) {
        if (i === 3 || i === 4) html += '<div class="board-street-sep"></div>';
        var c = this._selectedBoardCards[i];
        html += GTO.UI.BoardDisplay.renderCard({ rank: c[0], suit: c[1] });
      }
      display.innerHTML = html;
    }
  },

  _populatePresetBoards: function() {
    var container = document.getElementById('bp-preset-boards');
    var textureEl = document.querySelector('#bp-texture .toggle-option.active');
    if (!container || !textureEl || !GTO.Data.PostflopTextures) return;

    var texture = textureEl.getAttribute('data-value');
    var textureDef = GTO.Data.PostflopTextures[texture];
    var boardLabels = textureDef ? textureDef.boards : [];
    var boards = GTO.Data.PostflopBoards || [];

    var html = '';
    boardLabels.forEach(function(label) {
      var boardDef = null;
      for (var i = 0; i < boards.length; i++) {
        if (boards[i].label === label) { boardDef = boards[i]; break; }
      }
      if (!boardDef) return;
      html += '<div class="bp-preset-board" data-board="' + label + '">';
      boardDef.board.forEach(function(c) {
        html += GTO.UI.BoardDisplay.renderCard({ rank: c[0], suit: c[1] });
      });
      html += '</div>';
    });
    container.innerHTML = html;
  },

  _updateSolverFilters: function() {
    // Auto-select a default board if none selected
    if (this._selectedBoardCards.length < 3) {
      var boards = GTO.Data.PostflopBoards || [];
      if (boards.length > 0) {
        this._selectedBoardCards = boards[0].board.slice();
      }
    }
    this._updateBoardPreview();
    this._autoSolve();
  },

  _autoSolve: function() {
    var self = this;
    var generation = ++this._solveGeneration;

    // Read filter state
    var depthEl = document.querySelector('#solver-depth .toggle-option.active');
    var matchupEl = document.querySelector('#solver-matchup .toggle-option.active');

    var depth = depthEl ? depthEl.getAttribute('data-value') : '100bb';
    var matchupKey = matchupEl ? matchupEl.getAttribute('data-value') : 'SB_vs_BB';

    // Board from card picker (need at least 3 = flop)
    var boardCards = this._selectedBoardCards || [];
    if (boardCards.length < 3 || !GTO.Data.PostflopMatchups) return;

    var matchup = GTO.Data.PostflopMatchups[matchupKey];
    if (!matchup) return;

    // Depth config
    var depthCfg = GTO.Data.PostflopDepths ? GTO.Data.PostflopDepths[depth] : { pot: 100, stack: 450 };

    // Try to find matching pre-computed board
    var boardLabel = null;
    var boards = GTO.Data.PostflopBoards || [];
    for (var i = 0; i < boards.length; i++) {
      var b = boards[i].board;
      if (b.length === boardCards.length && boardCards.every(function(c, idx) { return c === b[idx]; })) {
        boardLabel = boards[i].label;
        break;
      }
    }

    // ── Immediately update header board display + label + stats ──
    this._updatePostflopBoardDisplay(boardCards);
    this._updatePostflopMatrixLabel(matchup, boardCards);
    GTO.UI.HUD.updateStat('solver-stat-matchup', matchup.label);
    GTO.UI.HUD.updateStat('solver-stat-board', boardLabel || boardCards.join(' ').toUpperCase());
    GTO.UI.HUD.updateStat('solver-stat-texture', boardLabel ? boards.find(function(b) { return b.label === boardLabel; }).texture.replace(/_/g, ' ') : 'custom');

    // Check pre-computed solutions (depth-aware, only for matching preset boards)
    var cached = null;
    if (boardLabel) {
      var varName = depth === '100bb' ? 'PostflopSolutions' : 'PostflopSolutions_' + depth.replace('bb', 'BB');
      var solutions = GTO.Data[varName];
      if (solutions && solutions[matchupKey] && solutions[matchupKey][boardLabel] && !solutions[matchupKey][boardLabel].error) {
        cached = solutions[matchupKey][boardLabel];
      }
    }

    var loadingEl = document.getElementById('solver-loading');
    var matrixLoading = document.getElementById('explore-matrix-loading');

    // Helper to hide all loading states
    function hideLoading() {
      if (loadingEl) loadingEl.classList.add('hidden');
      if (matrixLoading) matrixLoading.classList.add('hidden');
    }

    if (cached) {
      // Instant display from pre-computed solution
      hideLoading();
      self._renderSolverResultsFromCache(cached, boardCards, depthCfg.pot);
      return;
    }

    // No cache match — show in-range hands immediately (neutral), then try WASM
    var rangeData = this._buildInRangeOnlyData(matchup);
    this._postflopRangeData = rangeData;
    this._postflopActions = null;
    GTO.UI.HandMatrix.updateMatrix('explore-matrix-table', rangeData, null, null);
    GTO.UI.HandMatrix.updateSummaryBar('explore-summary-bar', rangeData, { raise: 'B', call: 'X', fold: 'F' });

    // Clear solver-specific stats for custom boards
    GTO.UI.HUD.updateStat('solver-stat-oop-ev', '--');
    GTO.UI.HUD.updateStat('solver-stat-ip-ev', '--');
    GTO.UI.HUD.updateStat('solver-stat-accuracy', '--');

    // Show loading overlays on both left panel and matrix
    if (loadingEl) loadingEl.classList.remove('hidden');
    if (matrixLoading) matrixLoading.classList.remove('hidden');

    var initPromise = (GTO.Solver && GTO.Solver.isAvailable()) ? Promise.resolve() : (GTO.Solver ? GTO.Solver.init() : Promise.reject(new Error('Solver not available')));

    initPromise.then(function() {
      return GTO.Solver.solveWithCache({
        oopRange: matchup.oopRange,
        ipRange: matchup.ipRange,
        board: boardCards,
        startingPot: depthCfg.pot,
        effectiveStack: depthCfg.stack,
        oopPosition: matchup.oop,
        ipPosition: matchup.ip,
        oopFlopBet: '33%', oopFlopRaise: '60%',
        oopTurnBet: '67%', oopTurnRaise: '60%',
        oopRiverBet: '67%', oopRiverRaise: '60%',
        ipFlopBet: '33%', ipFlopRaise: '60%',
        ipTurnBet: '67%', ipTurnRaise: '60%',
        ipRiverBet: '67%', ipRiverRaise: '60%',
        maxIterations: 200,
        targetExploitability: 0.5,
        onProgress: function() { /* silent */ }
      });
    }).then(function(results) {
      if (generation !== self._solveGeneration) return; // stale
      hideLoading();
      self._solverResults = results;

      // SolverCache returns texture-matched pre-computed results in a different format
      if (results.cached) {
        // Convert SolverCache format to our _renderSolverResultsFromCache format
        var fakeCached = {
          actions: results.actions,
          strategy: results.strategy,
          player: results.player || 'oop',
          oopEV: results.oopEV,
          ipEV: results.ipEV,
          exploitability: results.solveInfo ? results.solveInfo.exploitability : null,
          iterations: results.solveInfo ? results.solveInfo.iterations : 0
        };
        self._renderSolverResultsFromCache(fakeCached, boardCards, depthCfg.pot);
      } else {
        self._renderSolverResults(results, boardCards, depthCfg.pot);
      }
    }).catch(function(err) {
      if (generation !== self._solveGeneration) return;
      hideLoading();
      // Matrix shows in-range hands; update accuracy to indicate no solver data
      GTO.UI.HUD.updateStat('solver-stat-accuracy', 'no solver');
      console.warn('[Solver] WASM solve failed:', err && err.message || err);
    });
  },

  // Build rangeData with all in-range hands as "call" (neutral blue) for boards without solver data
  _buildInRangeOnlyData: function(matchup) {
    var player = 'oop';
    var rangeStr = matchup.oopRange;
    var hands = rangeStr.split(',').map(function(h) { return h.trim(); });
    var rangeData = {};
    for (var i = 0; i < hands.length; i++) {
      if (hands[i]) rangeData[hands[i]] = { raise: 0, call: 1, fold: 0 };
    }
    return rangeData;
  },

  _renderSolverResultsFromCache: function(cached, boardCards, pot) {
    var emptyEl = document.getElementById('solver-empty');
    var outputEl = document.getElementById('solver-output');
    if (emptyEl) emptyEl.style.display = 'none';
    if (outputEl) outputEl.classList.remove('hidden');

    // Update label
    var label = document.getElementById('solver-results-label');
    if (label) label.textContent = boardCards.join(' ').toUpperCase();

    // Board display — convert string cards to {rank, suit} objects
    if (GTO.UI.BoardDisplay) {
      var cardObjects = boardCards.map(function(c) {
        return typeof c === 'string' ? { rank: c[0], suit: c[1] } : c;
      });
      GTO.UI.BoardDisplay.renderBoard('solver-board-display', cardObjects);
    }

    // Parse actions
    var actions = (cached.actions || '').split('/');
    var strategy = cached.strategy || [];

    // Player label
    var playerLabel = document.getElementById('solver-player-label');
    if (playerLabel) playerLabel.textContent = (cached.player || 'OOP').toUpperCase();

    // Stats
    GTO.UI.HUD.updateStat('solver-stat-oop-ev', cached.oopEV != null ? cached.oopEV.toFixed(1) : '--');
    GTO.UI.HUD.updateStat('solver-stat-ip-ev', cached.ipEV != null ? cached.ipEV.toFixed(1) : '--');
    GTO.UI.HUD.updateStat('solver-stat-accuracy', cached.exploitability != null
      ? cached.exploitability.toFixed(1) + '% (' + (cached.iterations || 0) + ' iter)'
      : '--');

    // Action buttons
    var actionsDiv = document.getElementById('solver-actions');
    if (actionsDiv) {
      var html = '';
      for (var a = 0; a < actions.length; a++) {
        var parts = actions[a].split(':');
        var name = parts[0] || actions[a];
        var amount = parts[1] && parts[1] !== '0' ? ' ' + parts[1] : '';
        html += '<button class="solver-action-btn" data-action="' + actions[a] + '">' + name + amount + '</button>';
      }
      actionsDiv.innerHTML = html;
    }

    // Strategy bars
    this._renderSolverStrategyBars(strategy, actions, 0);

    // Hand table — aggregate only for cached solutions
    var tbody = document.getElementById('solver-hand-tbody');
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-dim);font-size:10px;padding:16px;">Aggregate strategy from pre-computed solution</td></tr>';
    }

    // ── Update the range matrix with postflop data ──
    var matchupEl = document.querySelector('#solver-matchup .toggle-option.active');
    var matchupKey = matchupEl ? matchupEl.getAttribute('data-value') : 'SB_vs_BB';
    var matchup = GTO.Data.PostflopMatchups ? GTO.Data.PostflopMatchups[matchupKey] : null;
    if (matchup) {
      var rangeData = this._buildPostflopRangeDataFromCache(cached, matchup);
      rangeData = this._applyICMToRangeData(rangeData);
      this._postflopRangeData = rangeData;
      this._postflopActions = (cached.actions || '').split('/');
      GTO.UI.HandMatrix.updateMatrix('explore-matrix-table', rangeData, null, null);
      GTO.UI.HandMatrix.updateSummaryBar('explore-summary-bar', rangeData, { raise: 'B', call: 'X', fold: 'F' });
    }

    // ── OOP Range Composition ──
    this._renderSolverComposition(boardCards, matchupKey);
  },

  _renderSolverComposition: function(boardCards, matchupKey) {
    var compEl = document.getElementById('solver-composition');
    if (!compEl || !GTO.Engine.RangeFilter || !GTO.Engine.RangeFilter.analyzeComposition) return;

    var matchup = GTO.Data.PostflopMatchups ? GTO.Data.PostflopMatchups[matchupKey] : null;
    if (!matchup || !matchup.oopRange) { compEl.classList.add('hidden'); return; }

    // Build OOP's preflop raising range for composition analysis
    var preflopCtx = GTO.Engine.RangeFilter.resolveActionContext(matchupKey);
    var actionRange = null;
    if (preflopCtx) {
      actionRange = GTO.Engine.RangeFilter.buildActionRange(
        'cash', document.querySelector('#solver-depth .toggle-option.active')
          ? document.querySelector('#solver-depth .toggle-option.active').getAttribute('data-value') : '100bb',
        preflopCtx.oopContext, preflopCtx.oopPosition, preflopCtx.oopAction
      );
    }
    // Fallback: use full OOP range if no preflop filter
    if (!actionRange || Object.keys(actionRange).length === 0) {
      actionRange = {};
      matchup.oopRange.split(',').forEach(function(h) { h = h.trim(); if (h) actionRange[h] = 1.0; });
    }

    // Convert board cards to objects
    var boardObjs = boardCards.map(function(c) {
      return typeof c === 'string' ? { rank: c[0], suit: c[1] } : c;
    });

    var comp = GTO.Engine.RangeFilter.analyzeComposition(actionRange, boardObjs);
    if (comp.total === 0) { compEl.classList.add('hidden'); return; }

    var buckets = ['monsters','strong','medium','draws','weak','air'];
    for (var i = 0; i < buckets.length; i++) {
      var pct = Math.round(comp[buckets[i]] * 100);
      var bar = document.getElementById('solver-comp-' + buckets[i]);
      var val = document.getElementById('solver-comp-' + buckets[i] + '-val');
      if (bar) bar.style.width = pct + '%';
      if (val) val.textContent = pct + '%';
    }
    compEl.classList.remove('hidden');
  },

  _randomSolverBoard: function() {
    // Pick 3 random cards for a flop
    var RANKS = ['A','K','Q','J','T','9','8','7','6','5','4','3','2'];
    var SUITS = ['s','h','d','c'];
    var deck = [];
    for (var r = 0; r < RANKS.length; r++) {
      for (var s = 0; s < SUITS.length; s++) {
        deck.push(RANKS[r] + SUITS[s]);
      }
    }
    // Shuffle and pick 3
    for (var i = deck.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = deck[i]; deck[i] = deck[j]; deck[j] = tmp;
    }
    this._selectedBoardCards = deck.slice(0, 3);

    // Clear preset highlights in modal
    var textureGroup = document.getElementById('bp-texture');
    if (textureGroup) textureGroup.querySelectorAll('.toggle-option').forEach(function(o) { o.classList.remove('active'); });
  },

  _renderSolverResults: function(results, boardCards, pot) {
    var emptyEl = document.getElementById('solver-empty');
    var outputEl = document.getElementById('solver-output');
    if (emptyEl) emptyEl.style.display = 'none';
    if (outputEl) outputEl.classList.remove('hidden');

    // Update label
    var label = document.getElementById('solver-results-label');
    if (label) label.textContent = boardCards.join(' ').toUpperCase();

    // Board display — convert string cards to {rank, suit} objects
    var boardDisplay = document.getElementById('solver-board-display');
    if (boardDisplay && GTO.UI.BoardDisplay) {
      var cardObjects = boardCards.map(function(c) {
        return typeof c === 'string' ? { rank: c[0], suit: c[1] } : c;
      });
      GTO.UI.BoardDisplay.renderBoard('solver-board-display', cardObjects);
    } else if (boardDisplay) {
      boardDisplay.innerHTML = boardCards.map(function(c) {
        return '<span style="font-size:18px; font-weight:700; letter-spacing:0.05em;">' + c + '</span>';
      }).join('');
    }

    // Parse the packed results array
    var data = results.results || [];
    var actions = (results.actions || '').split('/');
    var player = results.player || 'oop';
    var numActions = results.numActions || actions.length;
    var oopCards = results.oopCards || [];
    var ipCards = results.ipCards || [];

    var playerLabel = document.getElementById('solver-player-label');
    if (playerLabel) playerLabel.textContent = player.toUpperCase();

    // Update solver stats
    var solveInfo = results.solveInfo || {};
    GTO.UI.HUD.updateStat('solver-stat-accuracy', solveInfo.exploitability != null
      ? (solveInfo.exploitability || 0).toFixed(1) + '% (' + (solveInfo.iterations || 0) + ' iter)'
      : '--');

    // Render action buttons
    var actionsDiv = document.getElementById('solver-actions');
    if (actionsDiv) {
      var html = '';
      actions.forEach(function(a) {
        var parts = a.split(':');
        var name = parts[0] || a;
        var amount = parts[1] ? ' ' + parts[1] : '';
        html += '<button class="solver-action-btn" data-action="' + a + '">' + name + amount + '</button>';
      });
      actionsDiv.innerHTML = html;
    }

    // Parse strategy from packed results
    // The packed format from lib.rs:
    //   [0] = oopPot, [1] = ipPot, [2] = isEmptyFlag
    //   Then: oopWeights(N), ipWeights(N), oopNormWeights(N), ipNormWeights(N)
    //   Then: oopEquity(N), ipEquity(N), oopEV(N), ipEV(N), oopEQR(N), ipEQR(N)
    //   Then: strategy(numActions * N), evDetail(numActions * N) [if not empty/terminal]
    // N = number of combos for the active player

    var isCurrentOop = player === 'oop';
    var cards = isCurrentOop ? oopCards : ipCards;
    var numCombos = cards.length;

    if (data.length < 3 || numCombos === 0 || actions[0] === 'terminal' || actions[0] === 'chance') {
      // Terminal or chance node — show minimal info
      this._renderSolverStrategyBars([], actions, numCombos);
      this._renderSolverHandTable([], [], cards, actions, numActions, data, pot);
      return;
    }

    var isEmptyFlag = data[2];
    var offset = 3;
    // Skip: oopWeights, ipWeights
    var oopN = oopCards.length;
    var ipN = ipCards.length;
    offset += oopN + ipN; // raw weights
    offset += oopN + ipN; // normalized weights

    if (isEmptyFlag === 0) {
      offset += oopN + ipN; // equity
      offset += oopN + ipN; // ev
      offset += oopN + ipN; // eqr
    }

    // Strategy starts at offset, length = numActions * numCombos
    var strategy = [];
    if (data.length >= offset + numActions * numCombos) {
      for (var a = 0; a < numActions; a++) {
        var actionStrat = [];
        for (var c = 0; c < numCombos; c++) {
          actionStrat.push(data[offset + a * numCombos + c]);
        }
        strategy.push(actionStrat);
      }
    }

    // Get weights for the active player
    var weightOffset = 3 + (isCurrentOop ? 0 : oopN);
    var weights = data.slice(weightOffset, weightOffset + numCombos);

    // Get equity/EV for active player
    var equityArr = [], evArr = [];
    if (isEmptyFlag === 0) {
      var eqStart = 3 + oopN + ipN + oopN + ipN + (isCurrentOop ? 0 : oopN);
      equityArr = data.slice(eqStart, eqStart + numCombos);
      var evStart = eqStart + oopN + ipN;
      evArr = data.slice(evStart, evStart + numCombos);
    }

    // Calculate aggregate strategy (weighted average across combos)
    var aggStrategy = [];
    var totalWeight = 0;
    for (var c = 0; c < numCombos; c++) totalWeight += (weights[c] || 0);

    for (var a = 0; a < numActions; a++) {
      var weightedSum = 0;
      for (var c = 0; c < numCombos; c++) {
        weightedSum += (strategy[a] ? strategy[a][c] : 0) * (weights[c] || 0);
      }
      aggStrategy.push(totalWeight > 0 ? weightedSum / totalWeight : 0);
    }

    // Compute aggregate EV
    if (isEmptyFlag === 0 && totalWeight > 0) {
      var oopEvTotal = 0, ipEvTotal = 0;
      var oopWtStart = 3;
      var ipWtStart = 3 + oopN;
      var oopEvStart = 3 + oopN + ipN + oopN + ipN + oopN + ipN;
      var ipEvStart = oopEvStart + oopN;
      for (var c = 0; c < oopN; c++) {
        oopEvTotal += (data[oopEvStart + c] || 0) * (data[oopWtStart + c] || 0);
      }
      var oopTotalWt = 0;
      for (var c = 0; c < oopN; c++) oopTotalWt += (data[oopWtStart + c] || 0);
      var ipTotalWt = 0;
      for (var c = 0; c < ipN; c++) ipTotalWt += (data[ipWtStart + c] || 0);
      for (var c = 0; c < ipN; c++) {
        ipEvTotal += (data[ipEvStart + c] || 0) * (data[ipWtStart + c] || 0);
      }

      var oopEvEl = document.getElementById('solver-stat-oop-ev');
      var ipEvEl = document.getElementById('solver-stat-ip-ev');
      if (oopEvEl) oopEvEl.textContent = oopTotalWt > 0 ? (oopEvTotal / oopTotalWt).toFixed(1) : '--';
      if (ipEvEl) ipEvEl.textContent = ipTotalWt > 0 ? (ipEvTotal / ipTotalWt).toFixed(1) : '--';
    }

    this._renderSolverStrategyBars(aggStrategy, actions, numCombos);
    this._renderSolverHandTable(strategy, weights, cards, actions, numActions, data, pot, equityArr, evArr);

    // ── Update the range matrix with per-hand postflop data ──
    var rangeData = this._buildPostflopRangeDataFromWASM(results);
    rangeData = this._applyICMToRangeData(rangeData);
    this._postflopRangeData = rangeData;
    this._postflopActions = actions;
    GTO.UI.HandMatrix.updateMatrix('explore-matrix-table', rangeData, null, null);
    GTO.UI.HandMatrix.updateSummaryBar('explore-summary-bar', rangeData, { raise: 'B', call: 'X', fold: 'F' });

    // ── OOP Range Composition ──
    var matchupEl = document.querySelector('#solver-matchup .toggle-option.active');
    var matchupKey = matchupEl ? matchupEl.getAttribute('data-value') : 'SB_vs_BB';
    this._renderSolverComposition(boardCards, matchupKey);
  },

  _renderSolverStrategyBars: function(aggStrategy, actions, numCombos) {
    var container = document.getElementById('solver-strategy-bars');
    if (!container) return;

    var ACTION_COLORS = {
      'Fold': 'rgba(255,255,255,0.15)', 'Check': 'rgba(0,104,255,0.5)',
      'Call': 'rgba(0,104,255,0.5)', 'Bet': 'rgba(74,246,195,0.5)',
      'Raise': 'rgba(255,140,0,0.5)', 'Allin': 'rgba(255,67,61,0.5)'
    };

    var html = '';
    for (var a = 0; a < actions.length; a++) {
      var parts = actions[a].split(':');
      var name = parts[0] || actions[a];
      var amount = parts[1] ? ' ' + parts[1] : '';
      var pct = aggStrategy[a] ? (aggStrategy[a] * 100).toFixed(1) : '0.0';
      var color = ACTION_COLORS[name] || 'rgba(255,255,255,0.2)';

      html += '<div class="solver-freq-row">' +
        '<span class="solver-freq-label">' + name + amount + '</span>' +
        '<div class="solver-freq-track">' +
          '<div class="solver-freq-fill" style="width:' + pct + '%; background:' + color + '"></div>' +
        '</div>' +
        '<span class="solver-freq-value">' + pct + '%</span>' +
      '</div>';
    }
    container.innerHTML = html;
  },

  _renderSolverHandTable: function(strategy, weights, cards, actions, numActions, data, pot, equityArr, evArr) {
    var tbody = document.getElementById('solver-hand-tbody');
    if (!tbody) return;

    var RANKS = '23456789TJQKA';
    var SUITS = ['c', 'd', 'h', 's'];
    var SYM = { c: '\u2663', d: '\u2666', h: '\u2665', s: '\u2660' };
    var SCOL = { c: '#4af6c3', d: '#0068ff', h: '#ff433d', s: '#fff' };

    var ACTION_COLORS = {
      'Fold': 'rgba(255,255,255,0.15)', 'Check': 'rgba(0,104,255,0.5)',
      'Call': 'rgba(0,104,255,0.5)', 'Bet': 'rgba(74,246,195,0.5)',
      'Raise': 'rgba(255,140,0,0.5)', 'Allin': 'rgba(255,67,61,0.5)'
    };

    // Build sortable hand entries
    var entries = [];
    for (var i = 0; i < cards.length; i++) {
      var w = weights[i] || 0;
      if (w < 0.001) continue;

      var cardPacked = cards[i];
      var c1 = cardPacked & 0xFF;
      var c2 = (cardPacked >> 8) & 0xFF;
      var r1 = Math.floor(c1 / 4), s1 = c1 % 4;
      var r2 = Math.floor(c2 / 4), s2 = c2 % 4;

      var name = '<span style="color:' + SCOL[SUITS[s1]] + '">' + RANKS[r1] + SYM[SUITS[s1]] + '</span>' +
                 '<span style="color:' + SCOL[SUITS[s2]] + '">' + RANKS[r2] + SYM[SUITS[s2]] + '</span>';

      var strat = [];
      for (var a = 0; a < numActions; a++) {
        strat.push(strategy[a] ? strategy[a][i] : 0);
      }

      var eq = equityArr && equityArr[i] !== undefined ? equityArr[i] : null;
      var ev = evArr && evArr[i] !== undefined ? evArr[i] : null;

      entries.push({ name: name, weight: w, equity: eq, ev: ev, strat: strat, sortRank: r1 * 100 + r2 });
    }

    // Sort by descending rank
    entries.sort(function(a, b) { return b.sortRank - a.sortRank; });

    // Limit display to top 50 hands
    var maxShow = Math.min(entries.length, 50);
    var html = '';
    for (var i = 0; i < maxShow; i++) {
      var e = entries[i];
      var eqStr = e.equity !== null ? (e.equity * 100).toFixed(1) + '%' : '--';
      var evStr = e.ev !== null ? e.ev.toFixed(1) : '--';

      // Strategy mini-bar
      var barHtml = '<div class="solver-strat-bar">';
      for (var a = 0; a < actions.length; a++) {
        var parts = actions[a].split(':');
        var name = parts[0];
        var color = ACTION_COLORS[name] || 'rgba(255,255,255,0.2)';
        var pct = (e.strat[a] * 100).toFixed(1);
        if (pct > 0.5) {
          barHtml += '<div style="width:' + pct + '%; background:' + color + '" title="' + name + ' ' + pct + '%"></div>';
        }
      }
      barHtml += '</div>';

      html += '<tr>' +
        '<td style="font-weight:600;">' + e.name + '</td>' +
        '<td>' + e.weight.toFixed(2) + '</td>' +
        '<td>' + eqStr + '</td>' +
        '<td>' + evStr + '</td>' +
        '<td>' + barHtml + '</td>' +
      '</tr>';
    }

    if (entries.length > maxShow) {
      html += '<tr><td colspan="5" style="text-align:center; color:var(--text-dim); font-size:9px; padding:8px;">... and ' + (entries.length - maxShow) + ' more hands</td></tr>';
    }

    tbody.innerHTML = html;
  },

  // ═══════════════════ DRILL TYPE SELECTOR ═══════════════════
  _setupDrillTypeSelector: function() {
    var self = this;
    var selector = document.getElementById('drill-type-selector');
    if (!selector) return;

    selector.querySelectorAll('.toggle-option').forEach(function(opt) {
      opt.addEventListener('click', function() {
        selector.querySelectorAll('.toggle-option').forEach(function(o) { o.classList.remove('active'); });
        this.classList.add('active');
        self._switchDrillType(this.getAttribute('data-value'));
      });
    });
  },

  _activeDrillType: 'preflop',

  _switchDrillType: function(type) {
    this._activeDrillType = type;

    // End any active drill session to prevent ghost callbacks
    if (GTO.Engine.DrillEngine.isActive()) {
      GTO.Engine.DrillEngine.endSession();
    }

    // Reset keyboard context to navigation
    GTO.Keyboard.setContext('navigation');

    // Update tag
    var tag = document.getElementById('drill-type-tag');
    if (tag) tag.textContent = type.toUpperCase();

    // Toggle configs
    var configs = { preflop: 'preflop-config', postflop: 'postflop-config', pushfold: 'mtt-config' };
    var actives = { preflop: 'preflop-active', postflop: 'postflop-active', pushfold: 'mtt-active' };
    var matrices = { preflop: 'drill-matrix-area', postflop: 'drill-board-area', pushfold: 'drill-pushfold-matrix' };
    var feedbacks = { preflop: 'drill-preflop-feedback', postflop: 'drill-postflop-feedback', pushfold: 'drill-pushfold-feedback' };

    // Hide all configs/actives
    Object.values(configs).forEach(function(id) { var el = document.getElementById(id); if (el) el.classList.add('hidden'); });
    Object.values(actives).forEach(function(id) { var el = document.getElementById(id); if (el) el.classList.add('hidden'); });
    Object.values(matrices).forEach(function(id) { var el = document.getElementById(id); if (el) el.classList.add('hidden'); });
    Object.values(feedbacks).forEach(function(id) { var el = document.getElementById(id); if (el) el.classList.add('hidden'); });

    // Show selected type
    var configId = configs[type];
    var matrixId = matrices[type];
    var feedbackId = feedbacks[type];
    if (configId) { var el = document.getElementById(configId); if (el) el.classList.remove('hidden'); }
    if (matrixId) { var el = document.getElementById(matrixId); if (el) el.classList.remove('hidden'); }
    if (feedbackId) { var el = document.getElementById(feedbackId); if (el) el.classList.remove('hidden'); }

    // Hide session summary and progress
    var summary = document.getElementById('drill-session-summary');
    if (summary) summary.classList.add('hidden');
    this._hideDrillProgress();
  },

  // ═══════════════════ SESSION SUMMARY ═══════════════════
  _setupSessionSummary: function() {
    var self = this;
    var againBtn = document.getElementById('btn-drill-again');
    var backBtn = document.getElementById('btn-back-config');
    if (againBtn) {
      againBtn.addEventListener('click', function() {
        self._hideSummaryShowConfig();
        // Re-start the same drill type
        if (self._activeDrillType === 'preflop') self._startPreflopSession();
        else if (self._activeDrillType === 'postflop') self._startPostflopSession();
        else if (self._activeDrillType === 'pushfold') self._startTournamentSession();
      });
    }
    if (backBtn) {
      backBtn.addEventListener('click', function() {
        self._hideSummaryShowConfig();
      });
    }

    // Wire NEXT HAND bar button
    var nextDrillBtn = document.getElementById('btn-drill-next');
    if (nextDrillBtn) {
      nextDrillBtn.addEventListener('click', function() {
        self._nextDrill();
      });
    }

    // Wire View Range button
    var viewRangeBtn = document.getElementById('btn-view-range-preflop');
    if (viewRangeBtn) {
      viewRangeBtn.addEventListener('click', function() {
        self._navigateToExploreWithScenario();
      });
    }
  },

  _showSessionSummary: function(session, drillType) {
    // Hide active drill areas + progress bar
    this._hideDrillProgress();
    ['preflop-active', 'postflop-active', 'mtt-active'].forEach(function(id) {
      var el = document.getElementById(id);
      if (el) el.classList.add('hidden');
    });

    // Show summary
    var summary = document.getElementById('drill-session-summary');
    if (summary) summary.classList.remove('hidden');

    // Populate stats
    var totalEl = document.getElementById('summary-total');
    var accEl = document.getElementById('summary-accuracy');
    var evEl = document.getElementById('summary-ev-loss');
    var timeEl = document.getElementById('summary-time');

    if (totalEl) totalEl.textContent = session.totalDrills || session.decisions.length;
    if (accEl) accEl.textContent = Math.round(session.accuracy * 100) + '%';
    if (evEl) evEl.textContent = GTO.Utils.formatEV(session.totalEvLoss);

    var elapsed = session.endTime && session.startTime ? Math.round((session.endTime - session.startTime) / 1000) : 0;
    var mins = Math.floor(elapsed / 60);
    var secs = elapsed % 60;
    if (timeEl) timeEl.textContent = mins + ':' + (secs < 10 ? '0' : '') + secs;

    // Populate decisions table
    var tbody = document.getElementById('summary-decisions-body');
    if (tbody && session.decisions) {
      var html = '';
      session.decisions.forEach(function(d, i) {
        var verdictClass = '';
        if (d.result.verdict === 'optimal') verdictClass = 'positive';
        else if (d.result.verdict === 'acceptable') verdictClass = 'text-orange';
        else verdictClass = 'negative';

        var gtoAction = d.result.bestAction || d.result.correctAction || '?';
        html += '<tr>' +
          '<td>' + (i + 1) + '</td>' +
          '<td>' + (d.scenario.hand || '?') + '</td>' +
          '<td>' + (d.scenario.position || '?') + '</td>' +
          '<td>' + (d.userAction || '?').toUpperCase() + '</td>' +
          '<td>' + gtoAction.toUpperCase() + '</td>' +
          '<td class="' + verdictClass + '">' + (d.result.verdict || '?').toUpperCase() + '</td>' +
        '</tr>';
      });
      tbody.innerHTML = html;
    }

    GTO.Keyboard.setContext('navigation');
    this._activeDrillType = drillType;
  },

  _hideSummaryShowConfig: function() {
    var summary = document.getElementById('drill-session-summary');
    if (summary) summary.classList.add('hidden');

    // Show the right config for current drill type
    this._switchDrillType(this._activeDrillType);
  },

  _updateClock: function() {
    var el = document.getElementById('status-clock');
    if (el) el.textContent = GTO.Utils.formatTime();
  },

  _lastResult: null,
  _lastScenario: null
};

// Boot
document.addEventListener('DOMContentLoaded', function() {
  GTO.App.init();
});
