window.GTO = window.GTO || {};
GTO.AI = GTO.AI || {};

GTO.AI.GroqClient = {
  API_URL: 'https://api.groq.com/openai/v1/chat/completions',
  MODEL: 'llama-3.3-70b-versatile',

  async explain(scenario, userAction, result) {
    var apiKey = GTO.State.get('settings.groqApiKey');
    if (!apiKey) return { error: 'No API key configured. Add your Groq API key in Settings.' };

    var prompt = GTO.AI.PromptBuilder.build(scenario, userAction, result);

    try {
      var response = await fetch(this.API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + apiKey
        },
        body: JSON.stringify({
          model: this.MODEL,
          messages: [
            { role: 'system', content: 'You are a world-class poker coach specializing in GTO strategy for No-Limit Hold\'em. Give concise, actionable analysis. Use pot odds, equity, and range analysis. Keep responses under 200 words. Be direct.' },
            { role: 'user', content: prompt }
          ],
          temperature: 0.3,
          max_tokens: 500
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

  isConfigured: function() {
    return !!GTO.State.get('settings.groqApiKey');
  }
};
