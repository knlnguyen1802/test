window.GTO = window.GTO || {};
GTO.AI = GTO.AI || {};

GTO.AI.InsightPanel = {
  _container: null,

  init: function(containerId) {
    this._container = document.getElementById(containerId || 'ai-insight-content');
  },

  show: function(containerId) {
    var el = document.getElementById(containerId || 'ai-insight-section');
    if (el) el.classList.remove('hidden');
  },

  hide: function(containerId) {
    var el = document.getElementById(containerId || 'ai-insight-section');
    if (el) el.classList.add('hidden');
  },

  async requestExplanation(scenario, userAction, result, containerId) {
    var container = document.getElementById(containerId || 'ai-insight-content');
    if (!container) return;

    container.innerHTML = '<div class="ai-loading">Analyzing position</div>';
    this.show();

    var response = await GTO.AI.GroqClient.explain(scenario, userAction, result);

    if (response.error) {
      container.innerHTML = '<div class="text-red text-xs">' + response.error + '</div>';
    } else {
      container.innerHTML = '<div class="text-xs" style="line-height:1.7;white-space:pre-wrap">' + this._formatResponse(response.text) + '</div>';
    }
  },

  _formatResponse: function(text) {
    // Basic formatting: bold **text**, bullet points
    return text
      .replace(/\*\*(.*?)\*\*/g, '<strong class="text-orange">$1</strong>')
      .replace(/^- /gm, '&bull; ')
      .replace(/\n/g, '<br>');
  }
};
