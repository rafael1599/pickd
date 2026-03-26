import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { S3Client } from 'https://deno.land/x/s3_lite_client@0.7.0/mod.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    // Validate auth via Supabase JWT
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseAuth = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!
    );

    const token = authHeader.replace('Bearer ', '');
    const {
      data: { user },
      error: authError,
    } = await supabaseAuth.auth.getUser(token);

    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Invalid or expired token' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Service role client for DB writes
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // R2 client
    const s3 = new S3Client({
      endPoint: Deno.env.get('R2_ENDPOINT')!.replace('https://', ''),
      accessKey: Deno.env.get('R2_ACCESS_KEY_ID')!,
      secretKey: Deno.env.get('R2_SECRET_ACCESS_KEY')!,
      bucket: Deno.env.get('R2_BUCKET_NAME')!,
      region: 'auto',
      useSSL: true,
    });

    const publicDomain = Deno.env.get('R2_PUBLIC_DOMAIN')!;

    if (req.method === 'POST') {
      const body: { sku: string; image: string } = await req.json();

      if (!body.sku || !body.image) {
        return new Response(JSON.stringify({ error: 'sku and image are required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Decode base64 to binary
      const binaryString = atob(body.image);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // ~5MB limit check on decoded size
      if (bytes.length > 5 * 1024 * 1024) {
        return new Response(JSON.stringify({ error: 'Image exceeds 5MB limit' }), {
          status: 413,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const encodedSku = encodeURIComponent(body.sku);
      const objectKey = `photos/${encodedSku}.webp`;

      await s3.putObject(objectKey, bytes, { contentType: 'image/webp' });

      const publicUrl = `${publicDomain}/${objectKey}`;

      // Upsert image_url in sku_metadata
      const { error: upsertError } = await supabase
        .from('sku_metadata')
        .upsert({ sku: body.sku, image_url: publicUrl }, { onConflict: 'sku' });

      if (upsertError) {
        console.error('Upsert error:', upsertError);
        throw new Error(`Database error: ${upsertError.message}`);
      }

      return new Response(JSON.stringify({ url: publicUrl }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (req.method === 'DELETE') {
      const body: { sku: string } = await req.json();

      if (!body.sku) {
        return new Response(JSON.stringify({ error: 'sku is required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const encodedSku = encodeURIComponent(body.sku);
      const objectKey = `photos/${encodedSku}.webp`;

      // Delete from R2
      await s3.deleteObject(objectKey);

      // Null out image_url in sku_metadata
      const { error: updateError } = await supabase
        .from('sku_metadata')
        .update({ image_url: null })
        .eq('sku', body.sku);

      if (updateError) {
        console.error('Update error:', updateError);
        throw new Error(`Database error: ${updateError.message}`);
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Upload Photo Error:', message);
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
