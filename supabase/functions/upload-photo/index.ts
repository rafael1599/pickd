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
      const body: {
        gallery?: boolean;
        photoId?: string;
        sku?: string;
        image: string;
        thumbnail?: string;
      } = await req.json();

      // --- Gallery mode: upload to photos/gallery/ paths, no DB touch ---
      if (body.gallery) {
        if (!body.photoId || !body.image || !body.thumbnail) {
          return new Response(
            JSON.stringify({
              error: 'photoId, image, and thumbnail are required for gallery uploads',
            }),
            {
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            }
          );
        }

        // Decode and validate full-size image
        const binaryString = atob(body.image);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }

        if (bytes.length > 5 * 1024 * 1024) {
          return new Response(JSON.stringify({ error: 'Image exceeds 5MB limit' }), {
            status: 413,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const fullKey = `photos/gallery/${body.photoId}.webp`;
        const thumbKey = `photos/gallery/thumbs/${body.photoId}.webp`;

        // Upload full-size
        await s3.putObject(fullKey, bytes, { contentType: 'image/webp' });

        // Upload thumbnail
        const thumbBinary = atob(body.thumbnail);
        const thumbBytes = new Uint8Array(thumbBinary.length);
        for (let i = 0; i < thumbBinary.length; i++) {
          thumbBytes[i] = thumbBinary.charCodeAt(i);
        }
        await s3.putObject(thumbKey, thumbBytes, { contentType: 'image/webp' });

        return new Response(
          JSON.stringify({
            url: `${publicDomain}/${fullKey}`,
            thumbnailUrl: `${publicDomain}/${thumbKey}`,
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // --- SKU mode (existing logic) ---
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

      // Upload full-size image
      await s3.putObject(objectKey, bytes, { contentType: 'image/webp' });

      // Upload thumbnail if provided
      if (body.thumbnail) {
        const thumbBinary = atob(body.thumbnail);
        const thumbBytes = new Uint8Array(thumbBinary.length);
        for (let i = 0; i < thumbBinary.length; i++) {
          thumbBytes[i] = thumbBinary.charCodeAt(i);
        }
        const thumbKey = `photos/thumbs/${encodedSku}.webp`;
        await s3.putObject(thumbKey, thumbBytes, { contentType: 'image/webp' });
      }

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
      const body: { gallery?: boolean; photoId?: string; sku?: string } = await req.json();

      // --- Gallery mode: delete from photos/gallery/ paths, no DB touch ---
      if (body.gallery) {
        if (!body.photoId) {
          return new Response(
            JSON.stringify({ error: 'photoId is required for gallery deletes' }),
            {
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            }
          );
        }

        const fullKey = `photos/gallery/${body.photoId}.webp`;
        const thumbKey = `photos/gallery/thumbs/${body.photoId}.webp`;

        await Promise.all([
          s3.deleteObject(fullKey).catch(() => {}),
          s3.deleteObject(thumbKey).catch(() => {}),
        ]);

        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // --- SKU mode (existing logic) ---
      if (!body.sku) {
        return new Response(JSON.stringify({ error: 'sku is required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const encodedSku = encodeURIComponent(body.sku);
      const objectKey = `photos/${encodedSku}.webp`;
      const thumbKey = `photos/thumbs/${encodedSku}.webp`;

      // Delete full-size and thumbnail from R2 (both may not exist)
      await Promise.all([
        s3.deleteObject(objectKey).catch(() => {}),
        s3.deleteObject(thumbKey).catch(() => {}),
      ]);

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
