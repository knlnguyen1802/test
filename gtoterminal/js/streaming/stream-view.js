window.GTO = window.GTO || {};
GTO.Streaming = GTO.Streaming || {};

GTO.Streaming.StreamView = {
  _activeCategory: 'all',
  _activeChannel: null,
  _activePlatform: null,
  _activeStreamId: null,
  _screenshotData: null,
  _captureStream: null, // MediaStream from getDisplayMedia
  _pipActive: false,
  _pipDragging: false,
  _pipDragOffset: null,

  VISION_MODEL: 'meta-llama/llama-4-scout-17b-16e-instruct',

  init: function() {
    var self = this;
    var view = document.getElementById('view-stream');
    if (!view) return;

    view.addEventListener('click', function(e) {
      var filterBtn = e.target.closest('.stream-filter-btn');
      if (filterBtn) {
        self._activeCategory = filterBtn.getAttribute('data-category');
        view.querySelectorAll('.stream-filter-btn').forEach(function(b) {
          b.classList.toggle('active', b.getAttribute('data-category') === self._activeCategory);
        });
        self._renderStreamList();
        return;
      }

      var streamCard = e.target.closest('.stream-card');
      if (streamCard) {
        var streamId = streamCard.getAttribute('data-stream-id');
        if (streamId) self._selectStream(streamId);
        return;
      }

      var schedRow = e.target.closest('.stream-sched-row');
      if (schedRow) {
        var schedStreamId = schedRow.getAttribute('data-stream-id');
        if (schedStreamId) self._selectStream(schedStreamId);
        return;
      }

      if (e.target.closest('#spot-analyze-btn')) {
        self._captureAndAnalyze();
        return;
      }

      if (e.target.closest('.spot-drill-btn')) {
        self._launchSpotAsDrill();
        return;
      }

      if (e.target.closest('#stream-load-btn')) {
        self._loadCustomChannel();
        return;
      }

      if (e.target.closest('#stream-pip-btn')) {
        self._togglePiP();
        return;
      }

      if (e.target.closest('#spot-clear-btn')) {
        self._clearScreenshot();
        return;
      }
    });

    // Channel input: Enter key
    var channelInput = document.getElementById('stream-channel-input');
    if (channelInput) {
      channelInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          self._loadCustomChannel();
        }
      });
    }

    // PiP close button
    var pipCloseBtn = document.getElementById('pip-close-btn');
    if (pipCloseBtn) {
      pipCloseBtn.addEventListener('click', function() { self._closePiP(); });
    }

    // PiP restore-to-tab button
    var pipRestoreBtn = document.getElementById('pip-restore-btn');
    if (pipRestoreBtn) {
      pipRestoreBtn.addEventListener('click', function() {
        self._closePiP();
        GTO.UI.Nav.switchView('stream');
      });
    }

    // PiP drag support
    var pipHeader = document.querySelector('#pip-overlay .pip-header');
    if (pipHeader) {
      pipHeader.addEventListener('mousedown', function(e) {
        if (e.target.closest('.pip-close')) return;
        self._pipDragging = true;
        var overlay = document.getElementById('pip-overlay');
        var rect = overlay.getBoundingClientRect();
        self._pipDragOffset = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        e.preventDefault();
      });
      document.addEventListener('mousemove', function(e) {
        if (!self._pipDragging) return;
        var overlay = document.getElementById('pip-overlay');
        overlay.style.left = (e.clientX - self._pipDragOffset.x) + 'px';
        overlay.style.top = (e.clientY - self._pipDragOffset.y) + 'px';
        overlay.style.right = 'auto';
        overlay.style.bottom = 'auto';
      });
      document.addEventListener('mouseup', function() {
        self._pipDragging = false;
      });
    }

    // Also support paste as fallback
    document.addEventListener('paste', function(e) {
      if (GTO.State.get('activeView') !== 'stream') return;
      var items = (e.clipboardData || e.originalEvent.clipboardData).items;
      for (var i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          e.preventDefault();
          var blob = items[i].getAsFile();
          self._handleImageBlob(blob);
          return;
        }
      }
    });
  },

  // ── Screen Capture + Analyze in one click ──

  _captureAndAnalyze: async function() {
    var resultEl = document.getElementById('spot-result');
    var analyzeBtn = document.getElementById('spot-analyze-btn');
    var preview = document.getElementById('spot-screenshot-preview');

    if (!GTO.AI.GroqClient.isConfigured()) {
      if (resultEl) {
        resultEl.style.display = 'block';
        resultEl.innerHTML = '<span class="text-red">No API key configured. Add your Groq API key in Settings.</span>';
      }
      return;
    }

    // If we already have a screenshot (from paste), use it directly
    if (this._screenshotData) {
      this._sendToVision();
      return;
    }

    // Capture screen
    if (analyzeBtn) {
      analyzeBtn.innerHTML = '<span class="spinner"></span> SELECT SCREEN...';
      analyzeBtn.disabled = true;
    }

    try {
      // Request screen capture — browser shows picker
      var stream = await navigator.mediaDevices.getDisplayMedia({
        video: { mediaSource: 'screen' },
        audio: false
      });

      // Grab a single frame
      var track = stream.getVideoTracks()[0];
      var imageCapture = null;

      // Use ImageCapture API if available, otherwise use canvas
      if (typeof ImageCapture !== 'undefined') {
        imageCapture = new ImageCapture(track);
        var bitmap = await imageCapture.grabFrame();
        var canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        var ctx = canvas.getContext('2d');
        ctx.drawImage(bitmap, 0, 0);
        this._screenshotData = canvas.toDataURL('image/jpeg', 0.85);
      } else {
        // Fallback: use video element + canvas
        var video = document.createElement('video');
        video.srcObject = stream;
        video.muted = true;
        await video.play();
        // Small delay to ensure frame is rendered
        await new Promise(function(r) { setTimeout(r, 300); });
        var canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        var ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0);
        this._screenshotData = canvas.toDataURL('image/jpeg', 0.85);
        video.pause();
      }

      // Stop capture immediately
      stream.getTracks().forEach(function(t) { t.stop(); });

      // Show preview
      if (preview) {
        preview.innerHTML = '<img src="' + this._screenshotData + '" style="max-width:100%; max-height:100px; border-radius:2px; border:1px solid var(--border-dim);">' +
          '<button class="stream-ctrl-btn" id="spot-clear-btn" style="margin-left:8px; font-size:9px;">CLEAR</button>';
        preview.style.display = 'flex';
      }

      // Now analyze
      this._sendToVision();

    } catch (e) {
      // User cancelled or API not supported
      if (analyzeBtn) {
        analyzeBtn.innerHTML = '&#9889; ANALYZE HAND';
        analyzeBtn.disabled = false;
      }
      if (e.name === 'NotAllowedError') {
        if (GTO.UI.Toast) GTO.UI.Toast.info('Screen capture cancelled. You can also paste a screenshot (Cmd+V).');
      } else {
        if (resultEl) {
          resultEl.style.display = 'block';
          resultEl.innerHTML = '<span class="text-red">Screen capture not supported. Paste a screenshot instead (Cmd/Ctrl+V).</span>';
        }
      }
    }
  },

  _sendToVision: function() {
    var resultEl = document.getElementById('spot-result');
    var analyzeBtn = document.getElementById('spot-analyze-btn');

    if (!this._screenshotData) return;

    if (analyzeBtn) {
      analyzeBtn.innerHTML = '<span class="spinner"></span> ANALYZING HAND...';
      analyzeBtn.disabled = true;
    }
    if (resultEl) {
      resultEl.style.display = 'block';
      resultEl.innerHTML = '<span class="text-dim">AI is reading the poker table...</span>';
    }

    var self = this;
    this._callVisionAnalysis(this._screenshotData).then(function(result) {
      if (analyzeBtn) {
        analyzeBtn.innerHTML = '&#9889; ANALYZE HAND';
        analyzeBtn.disabled = false;
      }

      if (result.error) {
        if (resultEl) resultEl.innerHTML = '<span class="text-red">' + result.error + '</span>';
        return;
      }

      self._lastAnalysisResult = result.text;

      var html = '<div style="white-space:pre-wrap; line-height:1.6;">' + result.text + '</div>';
      html += '<div class="spot-result-actions">';
      html += '<button class="spot-drill-btn">DRILL THIS &rarr;</button>';
      html += '</div>';
      if (resultEl) resultEl.innerHTML = html;

      if (GTO.UI.Toast) GTO.UI.Toast.success('Hand analyzed');
    });
  },

  _handleImageBlob: function(blob) {
    var self = this;
    var reader = new FileReader();
    reader.onload = function(e) {
      self._screenshotData = e.target.result;
      var preview = document.getElementById('spot-screenshot-preview');
      if (preview) {
        preview.innerHTML = '<img src="' + self._screenshotData + '" style="max-width:100%; max-height:100px; border-radius:2px; border:1px solid var(--border-dim);">' +
          '<button class="stream-ctrl-btn" id="spot-clear-btn" style="margin-left:8px; font-size:9px;">CLEAR</button>';
        preview.style.display = 'flex';
      }
      var dropZone = document.getElementById('spot-drop-zone');
      if (dropZone) dropZone.style.display = 'none';
      if (GTO.UI.Toast) GTO.UI.Toast.success('Screenshot loaded — click Analyze');
    };
    reader.readAsDataURL(blob);
  },

  _clearScreenshot: function() {
    this._screenshotData = null;
    var preview = document.getElementById('spot-screenshot-preview');
    var dropZone = document.getElementById('spot-drop-zone');
    if (preview) { preview.innerHTML = ''; preview.style.display = 'none'; }
    if (dropZone) dropZone.style.display = 'flex';
  },

  // ── Vision API Call ──

  _callVisionAnalysis: async function(imageData) {
    var apiKey = GTO.State.get('settings.groqApiKey');
    if (!apiKey) return { error: 'No API key configured.' };

    try {
      var response = await fetch(GTO.AI.GroqClient.API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + apiKey
        },
        body: JSON.stringify({
          model: this.VISION_MODEL,
          messages: [
            {
              role: 'system',
              content: 'You are a world-class poker coach analyzing screenshots from live poker streams and poker software. Extract all visible information and provide GTO analysis.\n\nFirst, identify what you can see:\n- Hero\'s hole cards (rank and suit)\n- Community/board cards (flop, turn, river)\n- Player positions\n- Pot size, stack sizes, bet amounts\n- Current action or street\n\nThen provide concise GTO analysis:\n- Correct play and why\n- Key equity/range considerations\n- Common mistakes in this spot\n\nIf the image is not a poker hand, say so. Be concise (under 250 words).'
            },
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: 'Analyze this poker hand from the screenshot. Extract all visible hand information and provide GTO strategy analysis.'
                },
                {
                  type: 'image_url',
                  image_url: {
                    url: imageData
                  }
                }
              ]
            }
          ],
          temperature: 0.3,
          max_completion_tokens: 800
        })
      });

      if (!response.ok) {
        var errData = await response.json().catch(function() { return {}; });
        return { error: 'API error: ' + (errData.error ? errData.error.message : response.status) };
      }

      var data = await response.json();
      return { text: data.choices[0].message.content };
    } catch (e) {
      return { error: 'Network error: ' + e.message };
    }
  },

  // ── Stream Loading ──

  render: function() {
    this._renderFilters();
    this._renderStreamList();
    this._renderSchedule();

    var lastId = GTO.State.get('stream.lastStreamId');
    if (lastId && !this._activeChannel) {
      var stream = GTO.Data.TournamentCatalog.getStreamById(lastId);
      if (stream) this._selectStream(stream.id);
    }
  },

  _selectStream: function(streamId) {
    var stream = GTO.Data.TournamentCatalog.getStreamById(streamId);
    if (!stream) return;

    this._activeStreamId = streamId;
    this._activePlatform = stream.platform;
    this._loadEmbed(stream.platform, stream.channel);

    var view = document.getElementById('view-stream');
    if (view) {
      view.querySelectorAll('.stream-card').forEach(function(card) {
        card.classList.toggle('active', card.getAttribute('data-stream-id') === streamId);
      });
    }

    this._updateInfoBar(stream);
    GTO.State.set('stream.lastStreamId', streamId);
  },

  _loadEmbed: function(platform, channel) {
    if (!channel) return;
    this._activeChannel = channel;

    var container = document.getElementById('stream-player-container');
    if (!container) return;

    if (platform === 'youtube') {
      // YouTube doesn't support live_stream embeds by channel name.
      // Show a styled channel card with link to their YouTube live page.
      var handle = channel.charAt(0) === '@' ? channel : '@' + channel;
      var liveUrl = 'https://www.youtube.com/' + encodeURIComponent(handle) + '/live';
      var channelUrl = 'https://www.youtube.com/' + encodeURIComponent(handle);
      container.innerHTML =
        '<div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;' +
        'background:#0a0a0a;gap:16px;text-align:center;padding:24px;">' +
        '<div style="font-size:36px;opacity:0.4;">&#9654;</div>' +
        '<div style="font-size:16px;font-weight:700;color:#fff;letter-spacing:0.05em;">' + channel.toUpperCase() + '</div>' +
        '<div style="font-size:11px;color:#888;max-width:280px;">YouTube channels open in a new tab. Click below to watch live or browse their content.</div>' +
        '<div style="display:flex;gap:8px;margin-top:4px;">' +
        '<a href="' + liveUrl + '" target="_blank" rel="noopener" ' +
        'style="display:inline-flex;align-items:center;gap:6px;padding:10px 20px;background:#ff433d;color:#fff;' +
        'font-size:12px;font-weight:700;letter-spacing:0.08em;text-decoration:none;border-radius:2px;">' +
        '&#9654; WATCH LIVE</a>' +
        '<a href="' + channelUrl + '" target="_blank" rel="noopener" ' +
        'style="display:inline-flex;align-items:center;gap:6px;padding:10px 20px;background:#222;color:#ccc;' +
        'font-size:12px;font-weight:700;letter-spacing:0.08em;text-decoration:none;border-radius:2px;border:1px solid #333;">' +
        'CHANNEL</a>' +
        '</div></div>';
    } else {
      var parent = window.location.hostname || 'localhost';
      var iframeSrc = 'https://player.twitch.tv/?channel=' +
        encodeURIComponent(channel) + '&parent=' + encodeURIComponent(parent) +
        '&muted=true';
      container.innerHTML = '<iframe src="' + iframeSrc + '" allowfullscreen allow="autoplay; encrypted-media"></iframe>';
    }

    var tag = document.getElementById('stream-channel-tag');
    var platformLabel = platform === 'youtube' ? 'YT' : 'TTV';
    if (tag) tag.textContent = platformLabel + ': ' + channel.toUpperCase();

    var input = document.getElementById('stream-channel-input');
    if (input) input.value = channel;
  },

  _loadCustomChannel: function() {
    var input = document.getElementById('stream-channel-input');
    if (!input || !input.value.trim()) return;

    var raw = input.value.trim();
    var platform = 'twitch';
    var channel = raw.toLowerCase();

    if (raw.indexOf('youtube.com/') !== -1 || raw.indexOf('youtu.be/') !== -1) {
      platform = 'youtube';
      if (raw.indexOf('/watch') !== -1 || raw.indexOf('youtu.be/') !== -1) {
        var match = raw.match(/[?&]v=([^&]+)/) || raw.match(/youtu\.be\/([^?]+)/);
        if (match) { this._loadVideoEmbed(match[1]); return; }
      }
      channel = raw.split('youtube.com/').pop().split('/')[0].split('?')[0];
      if (channel.charAt(0) === '@') channel = channel.substring(1);
    } else if (raw.indexOf('twitch.tv/') !== -1) {
      channel = raw.split('twitch.tv/').pop().split('?')[0].split('/')[0];
    }

    this._activeStreamId = null;
    this._activePlatform = platform;
    this._loadEmbed(platform, channel);

    var view = document.getElementById('view-stream');
    if (view) {
      view.querySelectorAll('.stream-card').forEach(function(card) {
        card.classList.remove('active');
      });
    }
    this._updateInfoBar({ label: channel, platform: platform, category: null });
  },

  _loadVideoEmbed: function(videoId) {
    var container = document.getElementById('stream-player-container');
    if (!container) return;

    container.innerHTML = '<iframe src="https://www.youtube.com/embed/' +
      encodeURIComponent(videoId) + '?autoplay=1&mute=1" allowfullscreen allow="autoplay; encrypted-media"></iframe>';

    var tag = document.getElementById('stream-channel-tag');
    if (tag) tag.textContent = 'YT: VIDEO';
    this._activeChannel = videoId;
    this._activePlatform = 'youtube';
  },

  _updateInfoBar: function(stream) {
    var infoBar = document.getElementById('stream-info-bar');
    if (!infoBar) return;

    var platformIcon = (stream.platform === 'youtube') ? '&#9654; YT' : '&#9678; TTV';
    var html = '<span class="stream-info-channel">' + platformIcon + ' &mdash; ' + (stream.label || stream.channel || '') + '</span>';
    if (stream.category) {
      var catColor = GTO.Data.TournamentCatalog.getCategoryColor(stream.category);
      var catLabel = GTO.Data.TournamentCatalog.getCategoryLabel(stream.category);
      html += '<span class="stream-info-category" style="background:' + catColor + '15; color:' + catColor + ';">' + catLabel + '</span>';
    }
    infoBar.innerHTML = html;
  },

  _renderFilters: function() {
    var container = document.getElementById('stream-filters');
    if (!container) return;

    var categories = GTO.Data.TournamentCatalog.getAllCategories();
    var html = '<button class="stream-filter-btn active" data-category="all">ALL</button>';
    for (var i = 0; i < categories.length; i++) {
      var cat = categories[i];
      var label = GTO.Data.TournamentCatalog.getCategoryLabel(cat).toUpperCase();
      html += '<button class="stream-filter-btn" data-category="' + cat + '">' + label + '</button>';
    }
    container.innerHTML = html;
  },

  _renderStreamList: function() {
    var container = document.getElementById('stream-catalog');
    if (!container) return;

    var streams = GTO.Data.TournamentCatalog.getStreamsByCategory(this._activeCategory);
    if (streams.length === 0) {
      container.innerHTML = '<div class="text-dim" style="font-size:10px; padding:8px 0; text-align:center;">No streams in this category.</div>';
      return;
    }

    var self = this;
    var html = '<div class="stream-card-grid">';
    streams.forEach(function(s) {
      var catColor = GTO.Data.TournamentCatalog.getCategoryColor(s.category);
      var isActive = self._activeStreamId === s.id;
      var platformTag = s.platform === 'youtube' ? 'YT' : 'TTV';
      var platformColor = s.platform === 'youtube' ? '#ff433d' : '#9146ff';
      html += '<div class="stream-card' + (isActive ? ' active' : '') + '" data-stream-id="' + s.id + '" style="border-left-color:' + catColor + ';">';
      html += '<div class="stream-card-platform" style="color:' + platformColor + ';">' + platformTag + '</div>';
      html += '<div class="stream-card-info">';
      html += '<div class="stream-card-name">' + s.label + '</div>';
      html += '<div class="stream-card-desc">' + s.description + '</div>';
      html += '</div>';
      html += '<span class="stream-card-badge" style="background:' + catColor + '15; color:' + catColor + ';">' + GTO.Data.TournamentCatalog.getCategoryLabel(s.category).split(' ')[0].toUpperCase() + '</span>';
      html += '</div>';
    });
    html += '</div>';
    container.innerHTML = html;
  },

  _renderSchedule: function() {
    var self = this;
    var container = document.getElementById('stream-schedule');
    if (!container) return;

    var tournaments = GTO.Data.TournamentCatalog.getUpcomingTournaments(15);
    if (tournaments.length === 0) {
      container.innerHTML = '<div class="text-dim" style="font-size:10px; padding:8px 0;">No upcoming events.</div>';
      return;
    }

    var html = '';
    tournaments.forEach(function(t) {
      var dateStr = self._formatDate(t.startDate);
      var statusClass = t.status === 'live' ? 'live' : 'upcoming';

      html += '<div class="stream-sched-row" data-stream-id="' + t.stream + '" title="' + t.description + '">';
      html += '<span class="stream-sched-status ' + statusClass + '">' + (t.status === 'live' ? 'LIVE' : '') + '</span>';
      if (t.status !== 'live') {
        html += '<span class="stream-sched-date">' + dateStr + '</span>';
      }
      html += '<span class="stream-sched-name">' + t.name + '</span>';
      html += '<span class="stream-sched-buyin">' + t.buyIn + '</span>';
      html += '<span class="stream-sched-format">' + t.format + '</span>';
      html += '</div>';
    });
    container.innerHTML = html;
  },

  _formatDate: function(dateStr) {
    if (!dateStr) return '';
    var parts = dateStr.split('-');
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    var m = parseInt(parts[1], 10) - 1;
    var d = parseInt(parts[2], 10);
    return months[m] + ' ' + d;
  },

  // ── Picture-in-Picture Mini-Player ──

  _togglePiP: function() {
    if (this._pipActive) {
      this._closePiP();
      return;
    }

    var container = document.getElementById('stream-player-container');
    var pipContent = document.getElementById('pip-content');
    var overlay = document.getElementById('pip-overlay');
    if (!container || !pipContent || !overlay) return;

    // Find the iframe in the stream player
    var iframe = container.querySelector('iframe');
    if (!iframe) {
      if (GTO.UI.Toast) GTO.UI.Toast.info('Load a stream first');
      return;
    }

    // Move iframe to PiP overlay
    pipContent.appendChild(iframe);
    overlay.classList.remove('hidden');
    // Reset position to bottom-right
    overlay.style.right = '20px';
    overlay.style.bottom = '20px';
    overlay.style.left = 'auto';
    overlay.style.top = 'auto';

    // Show placeholder in main player
    container.innerHTML = '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;' +
      'background:#0a0a0a;color:var(--text-dim);font-size:11px;letter-spacing:0.05em;">STREAM IN MINI-PLAYER</div>';

    this._pipActive = true;
    var pipBtn = document.getElementById('stream-pip-btn');
    if (pipBtn) pipBtn.textContent = 'RESTORE';
  },

  _closePiP: function() {
    if (!this._pipActive) return;

    var container = document.getElementById('stream-player-container');
    var pipContent = document.getElementById('pip-content');
    var overlay = document.getElementById('pip-overlay');
    if (!container || !pipContent || !overlay) return;

    var iframe = pipContent.querySelector('iframe');
    if (iframe) {
      container.innerHTML = '';
      container.appendChild(iframe);
    }

    overlay.classList.add('hidden');
    pipContent.innerHTML = '';
    this._pipActive = false;

    var pipBtn = document.getElementById('stream-pip-btn');
    if (pipBtn) pipBtn.textContent = 'PiP';
  },

  _launchSpotAsDrill: function() {
    GTO.UI.Nav.switchView('drill');
    setTimeout(function() {
      if (GTO.Engine.DrillEngine.isActive()) {
        GTO.Engine.DrillEngine.endSession();
      }
      if (GTO.UI.Toast) GTO.UI.Toast.info('Configure a drill to practice this spot type');
    }, 200);
  }
};
