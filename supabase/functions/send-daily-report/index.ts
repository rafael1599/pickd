const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Finds all <img src="https://..."> in the HTML, replaces each src with a
 * CID reference, and returns a Resend-compatible attachments array.
 * Resend fetches the image via `path` — no base64 encoding needed.
 */
function inlineImages(html: string): { html: string; attachments: object[] } {
  const attachments: object[] = [];
  let counter = 0;

  // Match <img ... src="https://..."> — captures the full URL
  const processed = html.replace(
    /<img([^>]*)\ssrc=["'](https?:\/\/[^"']+)["']/gi,
    (_match, before: string, url: string) => {
      const id = `img-${counter}`;
      const ext = url.split('.').pop()?.split('?')[0] || 'png';
      attachments.push({
        path: url,
        filename: `${id}.${ext}`,
        content_id: id,
      });
      counter++;
      return `<img${before} src="cid:${id}"`;
    }
  );

  return { html: processed, attachments };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { to, subject, html, account } = await req.json();

    // Select API key based on account
    let apiKey = Deno.env.get('RESEND_API_KEY');
    if (account === 'personal') {
      apiKey = Deno.env.get('RESEND_API_KEY_PERSONAL') || apiKey;
    } else if (account === 'jamis') {
      apiKey = Deno.env.get('RESEND_API_KEY_JAMIS') || apiKey;
    }

    if (!apiKey) {
      console.error('Resend API Key is missing for account:', account || 'default');
      throw new Error(`Server configuration error: Missing API Key for ${account || 'default'}`);
    }

    // Convert external image URLs to CID inline attachments so they render
    // in ALL email clients (including those that block external images).
    const { html: processedHtml, attachments } = inlineImages(html);

    const body: Record<string, unknown> = {
      from: 'Inventory System <onboarding@resend.dev>',
      to,
      subject,
      html: processedHtml,
    };
    if (attachments.length > 0) {
      body.attachments = attachments;
    }

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    const data = await res.json();
    if (!res.ok) {
      console.error('Resend API Error:', data);
      return new Response(JSON.stringify({ error: data }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (error) {
    console.error('Edge Function Error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});
