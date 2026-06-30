export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';

    const corsHeaders = {
      'Access-Control-Allow-Origin':  env.ALLOWED_ORIGIN,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    // Only accept requests from the allowed origin
    if (origin !== env.ALLOWED_ORIGIN && !origin.includes('localhost')) {
      return new Response('Forbidden', { status: 403 });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response('Invalid JSON', { status: 400 });
    }

    const anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 400,
        system:     body.system || '',
        messages:   body.messages || [],
      }),
    });

    const data = await anthropicResponse.json();

    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  },
};
