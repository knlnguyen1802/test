window.GTO = window.GTO || {};
GTO.Content = GTO.Content || {};

GTO.Content.LearnView = {
  _activeCategory: 'all',
  _activeTopic: null,

  init: function() {
    var self = this;

    // Event delegation on the learn view
    var view = document.getElementById('view-learn');
    if (!view) return;

    view.addEventListener('click', function(e) {
      // Category filter buttons
      var filterBtn = e.target.closest('.learn-filter-btn');
      if (filterBtn) {
        self._activeCategory = filterBtn.getAttribute('data-category');
        view.querySelectorAll('.learn-filter-btn').forEach(function(b) {
          b.classList.toggle('active', b.getAttribute('data-category') === self._activeCategory);
        });
        self._renderCatalog();
        return;
      }

      // Topic card click
      var topicCard = e.target.closest('.learn-topic-card');
      if (topicCard) {
        var topicId = topicCard.getAttribute('data-topic-id');
        if (topicId) self._openTopic(topicId);
        return;
      }

      // Back button
      if (e.target.closest('.learn-back-btn')) {
        self._closeTopic();
        return;
      }

      // Generate article button
      if (e.target.closest('.learn-generate-btn')) {
        self._generateArticle();
        return;
      }

      // Drill launch button
      var drillBtn = e.target.closest('.learn-drill-btn');
      if (drillBtn) {
        var drillIdx = parseInt(drillBtn.getAttribute('data-drill-idx'));
        self._launchDrill(drillIdx);
        return;
      }

      // Clear cache button
      if (e.target.closest('#learn-clear-cache')) {
        GTO.Content.Engine.clearCache();
        self._renderSidebar();
        if (GTO.UI.Toast) GTO.UI.Toast.success('Article cache cleared');
        return;
      }
    });
  },

  render: function() {
    this._renderRecommended();
    this._renderFilters();
    this._renderCatalog();
    this._renderSidebar();

    // Ensure catalog is visible and article is hidden
    var catalog = document.querySelector('.learn-catalog-panel');
    var article = document.querySelector('.learn-article-panel');
    if (catalog) catalog.classList.remove('hidden');
    if (article) article.classList.remove('active');
  },

  _renderRecommended: function() {
    var container = document.getElementById('learn-recommended');
    if (!container) return;

    var topics = GTO.Content.Engine.getRecommendedTopics(4);
    if (topics.length === 0) {
      container.innerHTML = '<div class="text-dim" style="font-size:10px; padding:8px 0;">Complete some drills to get personalized recommendations.</div>';
      return;
    }

    var html = '';
    for (var i = 0; i < topics.length; i++) {
      html += this._renderTopicCard(topics[i]);
    }
    container.innerHTML = html;
  },

  _renderFilters: function() {
    var container = document.getElementById('learn-filters');
    if (!container) return;

    var categories = GTO.Data.ContentCatalog.getAllCategories();
    var html = '<button class="learn-filter-btn active" data-category="all">ALL</button>';
    for (var i = 0; i < categories.length; i++) {
      var cat = categories[i];
      var label = GTO.Data.ContentCatalog.getCategoryLabel(cat);
      // Short label for pills
      var shortLabel = label.split(' ')[0].toUpperCase();
      if (shortLabel.length > 8) shortLabel = shortLabel.substring(0, 8);
      html += '<button class="learn-filter-btn" data-category="' + cat + '">' + shortLabel + '</button>';
    }
    container.innerHTML = html;
  },

  _renderCatalog: function() {
    var container = document.getElementById('learn-catalog');
    if (!container) return;

    var topics = GTO.Content.Engine.getTopicsByCategory(this._activeCategory);
    var progress = GTO.Content.Engine.getProgress();

    if (topics.length === 0) {
      container.innerHTML = '<div class="text-dim" style="font-size:10px; padding:16px 0; text-align:center;">No topics in this category.</div>';
      return;
    }

    var html = '';
    for (var i = 0; i < topics.length; i++) {
      html += this._renderTopicCard(topics[i]);
    }
    container.innerHTML = html;
  },

  _renderTopicCard: function(topic) {
    var isRead = GTO.Content.Engine.isRead(topic.id);
    var catColor = GTO.Data.ContentCatalog.getCategoryColor(topic.category);
    var catLabel = GTO.Data.ContentCatalog.getCategoryLabel(topic.category).split(' ')[0].toUpperCase();
    var drillCount = topic.drills ? topic.drills.length : 0;

    var html = '<div class="learn-topic-card' + (isRead ? ' read' : '') + '" data-topic-id="' + topic.id + '" style="border-left-color:' + catColor + ';">';
    html += '<div class="topic-card-header">';
    html += '<span class="topic-category-badge" style="background:' + catColor + '15; color:' + catColor + ';">' + catLabel + '</span>';
    html += '<span class="topic-difficulty ' + topic.difficulty + '">' + topic.difficulty.toUpperCase() + '</span>';
    html += '</div>';
    html += '<div class="topic-title">' + topic.title + '</div>';
    html += '<div class="topic-summary">' + topic.summary.substring(0, 120) + '...</div>';
    html += '<div class="topic-meta">';
    if (isRead) {
      html += '<span class="topic-read-indicator">&#10003; READ</span>';
    } else {
      html += '<span style="color:var(--text-dim);">&bull; Unread</span>';
    }
    if (drillCount > 0) {
      html += '<span class="topic-drill-count">' + drillCount + ' drill' + (drillCount > 1 ? 's' : '') + '</span>';
    }
    html += '</div>';
    html += '</div>';
    return html;
  },

  _renderSidebar: function() {
    // Reading progress
    var readCount = GTO.Content.Engine.getReadCount();
    var totalCount = GTO.Data.ContentCatalog.TOPICS.length;
    var el = document.getElementById('learn-read-count');
    if (el) el.textContent = readCount + ' / ' + totalCount;

    var bar = document.getElementById('learn-progress-bar');
    if (bar) bar.style.width = (totalCount > 0 ? (readCount / totalCount * 100) : 0) + '%';

    // Weakness snapshot
    var weakContainer = document.getElementById('learn-weakness-snapshot');
    if (weakContainer) {
      var weaknesses = [];
      if (GTO.Training && GTO.Training.WeaknessAnalyzer) {
        weaknesses = GTO.Training.WeaknessAnalyzer.getTopWeaknesses(3);
      }
      if (weaknesses.length === 0) {
        weakContainer.innerHTML = '<div class="text-dim" style="font-size:10px;">No weaknesses detected yet.</div>';
      } else {
        var html = '';
        weaknesses.forEach(function(w) {
          var pct = Math.round(w.accuracy * 100);
          var color = pct < 60 ? 'text-red' : (pct < 70 ? 'text-orange' : 'text-dim');
          html += '<div style="display:flex; justify-content:space-between; font-size:10px; padding:2px 0;">';
          html += '<span class="text-dim">' + w.category + '</span>';
          html += '<span class="' + color + '">' + pct + '%</span>';
          html += '</div>';
        });
        weakContainer.innerHTML = html;
      }
    }

    // Cache size
    var cacheEl = document.getElementById('learn-cache-size');
    if (cacheEl) {
      var bytes = GTO.Content.Engine.getCacheSize();
      var kb = (bytes / 1024).toFixed(1);
      cacheEl.textContent = kb + ' KB';
    }
  },

  _openTopic: function(topicId) {
    var topic = GTO.Data.ContentCatalog.getTopicById(topicId);
    if (!topic) return;
    this._activeTopic = topic;

    // Hide catalog, show article
    var catalog = document.querySelector('.learn-catalog-panel');
    var article = document.querySelector('.learn-article-panel');
    if (catalog) catalog.classList.add('hidden');
    if (article) article.classList.add('active');

    // Render article content
    var titleEl = document.getElementById('learn-article-title');
    var metaEl = document.getElementById('learn-article-meta');
    var summaryEl = document.getElementById('learn-article-summary');
    var bodyEl = document.getElementById('learn-article-body');
    var drillsEl = document.getElementById('learn-article-drills');
    var genBtn = document.getElementById('learn-generate-btn');

    if (titleEl) titleEl.textContent = topic.title;

    if (metaEl) {
      var catLabel = GTO.Data.ContentCatalog.getCategoryLabel(topic.category);
      metaEl.innerHTML = '<span>' + catLabel + '</span><span>' + topic.difficulty.toUpperCase() + '</span>';
      if (topic.tags && topic.tags.length) {
        metaEl.innerHTML += '<span>' + topic.tags.slice(0, 3).join(', ') + '</span>';
      }
    }

    if (summaryEl) summaryEl.textContent = topic.summary;

    // Check for cached article
    var cached = GTO.Content.Engine.getCachedArticle(topicId);
    if (cached) {
      if (bodyEl) bodyEl.innerHTML = this._markdownToHtml(cached.body);
      if (genBtn) {
        genBtn.innerHTML = '&#8635; REGENERATE ARTICLE';
        genBtn.disabled = false;
        genBtn.setAttribute('data-regenerate', 'true');
      }
    } else {
      if (bodyEl) bodyEl.innerHTML = '<div class="text-dim" style="font-size:10px; padding:12px 0;">Click "Generate Article" to create an AI-written deep dive on this topic.</div>';
      if (genBtn) {
        genBtn.innerHTML = '&#9889; GENERATE ARTICLE';
        genBtn.disabled = !GTO.AI.GroqClient.isConfigured();
        genBtn.removeAttribute('data-regenerate');
      }
    }

    // Render drills
    if (drillsEl) {
      if (topic.drills && topic.drills.length > 0) {
        var html = '<div class="learn-section-header">PRACTICE DRILLS</div>';
        topic.drills.forEach(function(drill, idx) {
          html += '<button class="learn-drill-btn" data-drill-idx="' + idx + '">';
          html += '<span>' + drill.label + '</span>';
          html += '<span class="drill-arrow">&rarr;</span>';
          html += '</button>';
        });
        drillsEl.innerHTML = html;
      } else {
        drillsEl.innerHTML = '';
      }
    }

    // Mark as read
    GTO.Content.Engine.markAsRead(topicId);
    this._renderSidebar();
  },

  _closeTopic: function() {
    this._activeTopic = null;
    var catalog = document.querySelector('.learn-catalog-panel');
    var article = document.querySelector('.learn-article-panel');
    if (catalog) catalog.classList.remove('hidden');
    if (article) article.classList.remove('active');

    // Refresh catalog to show updated read status
    this._renderRecommended();
    this._renderCatalog();
  },

  _generateArticle: async function() {
    if (!this._activeTopic) return;
    var topic = this._activeTopic;
    var genBtn = document.getElementById('learn-generate-btn');
    var bodyEl = document.getElementById('learn-article-body');

    // If regenerating, clear cache first
    if (genBtn && genBtn.getAttribute('data-regenerate') === 'true') {
      GTO.Content.Engine.clearCachedArticle(topic.id);
    }

    // Show loading
    if (genBtn) {
      genBtn.innerHTML = '<span class="spinner"></span> GENERATING...';
      genBtn.disabled = true;
    }
    if (bodyEl) bodyEl.innerHTML = '<div class="text-dim" style="font-size:10px; padding:12px 0;">Generating article... This may take a few seconds.</div>';

    var result = await GTO.Content.Engine.generateArticle(topic.id);

    if (result.error) {
      if (bodyEl) bodyEl.innerHTML = '<div class="text-red" style="font-size:10px; padding:12px 0;">' + result.error + '</div>';
      if (genBtn) {
        genBtn.innerHTML = '&#9889; RETRY GENERATE';
        genBtn.disabled = false;
      }
      return;
    }

    if (bodyEl) bodyEl.innerHTML = this._markdownToHtml(result.text);
    if (genBtn) {
      genBtn.innerHTML = '&#8635; REGENERATE ARTICLE';
      genBtn.disabled = false;
      genBtn.setAttribute('data-regenerate', 'true');
    }

    this._renderSidebar();
    if (GTO.UI.Toast) GTO.UI.Toast.success('Article generated');
  },

  _launchDrill: function(drillIdx) {
    if (!this._activeTopic || !this._activeTopic.drills) return;
    var drill = this._activeTopic.drills[drillIdx];
    if (!drill) return;

    // Switch to drill view
    GTO.UI.Nav.switchView('drill');

    // Start the drill with the topic's config
    var config = Object.assign({}, drill.config);

    // Small delay to let view switch complete
    setTimeout(function() {
      if (GTO.Engine.DrillEngine.isActive()) {
        GTO.Engine.DrillEngine.endSession();
      }

      // Switch drill type panel to match the drill config
      var drillTypeMap = { preflop: 'preflop', postflop: 'postflop', tournament: 'pushfold' };
      var panelType = drillTypeMap[config.drillType] || 'preflop';
      if (GTO.App._switchDrillType) {
        GTO.App._switchDrillType(panelType);
      }

      // Update drill type selector toggle
      var selector = document.getElementById('drill-type-selector');
      if (selector) {
        selector.querySelectorAll('.toggle-option').forEach(function(opt) {
          opt.classList.toggle('active', opt.getAttribute('data-value') === panelType);
        });
      }

      // Start the drill via the engine with the correct renderers for the drill type
      if (GTO.UI.Toast) GTO.UI.Toast.info('Starting drill: ' + drill.label);

      var callbacks;
      if (config.drillType === 'preflop') {
        // Show preflop active panel
        var pfConfig = document.getElementById('preflop-config');
        var pfActive = document.getElementById('preflop-active');
        if (pfConfig) pfConfig.classList.add('hidden');
        if (pfActive) pfActive.classList.remove('hidden');

        callbacks = {
          onScenario: function(scenario, index) { GTO.App._renderPreflopScenario(scenario, index); },
          onResult: function(result, scenario) { GTO.App._renderPreflopResult(result, scenario); },
          onSessionEnd: function(session) { GTO.App._renderSessionEnd(session); }
        };
        GTO.Keyboard.setContext('drill-preflop');
      } else if (config.drillType === 'postflop') {
        var postConfig = document.getElementById('postflop-config');
        var postActive = document.getElementById('postflop-active');
        if (postConfig) postConfig.classList.add('hidden');
        if (postActive) postActive.classList.remove('hidden');

        callbacks = {
          onScenario: function(scenario, index) { GTO.App._renderPostflopScenario(scenario, index); },
          onResult: function(result, scenario) { GTO.App._renderPostflopResult(result, scenario); },
          onSessionEnd: function(session) { GTO.App._renderPostflopSessionEnd(session); }
        };
        GTO.Keyboard.setContext('drill-postflop');
      } else if (config.drillType === 'tournament') {
        callbacks = {
          onScenario: function(scenario, index) { GTO.App._renderMTTScenario(scenario, index); },
          onResult: function(result, scenario) { GTO.App._renderMTTResult(result, scenario); },
          onSessionEnd: function(session) { GTO.App._renderSessionEnd(session); }
        };
        GTO.Keyboard.setContext('drill-mtt');
      }

      if (callbacks) {
        GTO.Engine.DrillEngine.startSession(config, callbacks);
        GTO.App._showDrillProgress();
      }
    }, 200);
  },

  // Simple markdown to HTML converter
  _markdownToHtml: function(md) {
    if (!md) return '';
    var html = md
      // Headers
      .replace(/^### (.+)$/gm, '<h3>$1</h3>')
      .replace(/^## (.+)$/gm, '<h2>$1</h2>')
      // Bold
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      // Italic
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      // Inline code
      .replace(/`(.+?)`/g, '<code>$1</code>')
      // Unordered lists
      .replace(/^[-*] (.+)$/gm, '<li>$1</li>')
      // Numbered lists
      .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
      // Paragraphs
      .replace(/\n\n/g, '</p><p>')
      // Line breaks
      .replace(/\n/g, '<br>');

    // Wrap consecutive <li> in <ul>
    html = html.replace(/(<li>.+?<\/li>(<br>)?)+/g, function(match) {
      return '<ul>' + match.replace(/<br>/g, '') + '</ul>';
    });

    return '<p>' + html + '</p>';
  }
};
