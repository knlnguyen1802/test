window.GTO = window.GTO || {};
GTO.Content = GTO.Content || {};

GTO.Content.Engine = {
  CACHE_KEY: 'gto_contentCache',
  PROGRESS_KEY: 'gto_contentProgress',

  // Get cached article body for a topic
  getCachedArticle: function(topicId) {
    var cache = GTO.Storage.get(this.CACHE_KEY, {});
    return cache[topicId] || null;
  },

  // Cache an article body
  cacheArticle: function(topicId, body) {
    var cache = GTO.Storage.get(this.CACHE_KEY, {});
    cache[topicId] = {
      body: body,
      generated: Date.now()
    };
    GTO.Storage.set(this.CACHE_KEY, cache);
  },

  // Clear a cached article (for regeneration)
  clearCachedArticle: function(topicId) {
    var cache = GTO.Storage.get(this.CACHE_KEY, {});
    delete cache[topicId];
    GTO.Storage.set(this.CACHE_KEY, cache);
  },

  // Get reading progress
  getProgress: function() {
    return GTO.Storage.get(this.PROGRESS_KEY, {});
  },

  // Mark topic as read
  markAsRead: function(topicId) {
    var progress = this.getProgress();
    progress[topicId] = { readAt: Date.now() };
    GTO.Storage.set(this.PROGRESS_KEY, progress);
  },

  // Check if topic has been read
  isRead: function(topicId) {
    var progress = this.getProgress();
    return !!progress[topicId];
  },

  // Count read topics
  getReadCount: function() {
    return Object.keys(this.getProgress()).length;
  },

  // Get cache size in bytes (approximate)
  getCacheSize: function() {
    var cache = GTO.Storage.get(this.CACHE_KEY, {});
    var str = JSON.stringify(cache);
    return str.length;
  },

  // Generate article via Groq API
  generateArticle: async function(topicId) {
    var topic = GTO.Data.ContentCatalog.getTopicById(topicId);
    if (!topic) return { error: 'Topic not found' };

    // Check cache first
    var cached = this.getCachedArticle(topicId);
    if (cached) return { text: cached.body, fromCache: true };

    // Check API key
    var apiKey = GTO.State.get('settings.groqApiKey');
    if (!apiKey) return { error: 'No API key configured. Add your Groq API key in Settings.' };

    try {
      var response = await fetch(GTO.AI.GroqClient.API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + apiKey
        },
        body: JSON.stringify({
          model: GTO.AI.GroqClient.MODEL,
          messages: [
            {
              role: 'system',
              content: 'You are a world-class poker coach and writer. Write clear, structured articles about GTO poker strategy. Use headers (##), bullet points, and bold for key concepts. Be specific with hand examples. Write in a direct, professional tone. No fluff.'
            },
            {
              role: 'user',
              content: topic.aiPrompt
            }
          ],
          temperature: 0.4,
          max_tokens: 1500
        })
      });

      if (!response.ok) {
        var errData = await response.json().catch(function() { return {}; });
        return { error: 'API error: ' + (errData.error ? errData.error.message : response.status) };
      }

      var data = await response.json();
      var articleBody = data.choices[0].message.content;

      // Cache the result
      this.cacheArticle(topicId, articleBody);

      return { text: articleBody, fromCache: false };
    } catch (e) {
      return { error: 'Network error: ' + e.message };
    }
  },

  // Score topics against user weaknesses and return recommended topics
  getRecommendedTopics: function(limit) {
    limit = limit || 4;
    var weaknesses = [];

    if (GTO.Training && GTO.Training.WeaknessAnalyzer) {
      weaknesses = GTO.Training.WeaknessAnalyzer.analyze();
    }

    var progress = this.getProgress();
    var topics = GTO.Data.ContentCatalog.TOPICS;
    var scored = [];

    for (var i = 0; i < topics.length; i++) {
      var topic = topics[i];
      var score = 0;

      if (topic.weaknessMatch && weaknesses.length > 0) {
        var match = topic.weaknessMatch;
        for (var j = 0; j < weaknesses.length; j++) {
          var w = weaknesses[j];
          // Match dimension
          var dimensionMatch = false;
          if (match.dimension === 'byPosition' && w.dimension === 'position') {
            dimensionMatch = match.keys.indexOf(w.key) >= 0;
          } else if (match.dimension === 'bySpotType' && w.dimension === 'spotType') {
            dimensionMatch = match.keys.indexOf(w.key) >= 0;
          }

          if (dimensionMatch) {
            var priorityBonus = w.priority === 'critical' ? 20 : (w.priority === 'high' ? 12 : (w.priority === 'medium' ? 6 : 2));
            score += (1 - w.accuracy) * Math.min(w.volume, 100) * 0.1 + priorityBonus;
          }
        }
      }

      // Base score for topics without weakness match (mental game, etc.)
      if (score === 0 && !topic.weaknessMatch) {
        score = 1;
      }

      // Reduce score for already-read topics
      if (progress[topic.id]) {
        score *= 0.3;
      }

      scored.push({ topic: topic, score: score });
    }

    // Sort by score descending
    scored.sort(function(a, b) { return b.score - a.score; });

    // Return top N topics
    var result = [];
    for (var k = 0; k < Math.min(limit, scored.length); k++) {
      result.push(scored[k].topic);
    }
    return result;
  },

  // Get all topics filtered by category
  getTopicsByCategory: function(category) {
    if (!category || category === 'all') return GTO.Data.ContentCatalog.TOPICS;
    return GTO.Data.ContentCatalog.getTopicsByCategory(category);
  },

  // Clear all cached articles
  clearCache: function() {
    GTO.Storage.set(this.CACHE_KEY, {});
  }
};
