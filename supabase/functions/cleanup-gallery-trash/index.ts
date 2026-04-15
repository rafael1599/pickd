// Edge function: cleanup-gallery-trash
//
// Permanently deletes gallery photos that have been in trash for >14 days.
// Steps:
//   1. Query gallery_photos WHERE deleted_at < now() - 14 days
//   2. Delete photos from R2 (full + thumbnail)
//   3. Hard delete rows from DB (CASCADE removes task_photos)
//
// Triggered daily by .github/workflows/cleanup-gallery-trash.yml at 06:00 UTC.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { S3Client } from 'https://deno.land/x/s3_lite_client@0.7.0/mod.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // 1. Find expired trash photos (deleted_at > 14 days ago)
    const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: expired, error: queryErr } = await supabase
      .from('gallery_photos')
      .select('id')
      .not('deleted_at', 'is', null)
      .lt('deleted_at', cutoff);

    if (queryErr) throw queryErr;

    if (!expired || expired.length === 0) {
      return new Response(JSON.stringify({ message: 'No expired photos', deleted: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 2. Delete from R2
    const r2Endpoint = Deno.env.get('R2_ENDPOINT');
    const r2AccessKey = Deno.env.get('R2_ACCESS_KEY_ID');
    const r2SecretKey = Deno.env.get('R2_SECRET_ACCESS_KEY');
    const r2Bucket = Deno.env.get('R2_BUCKET_NAME');

    let r2Deleted = 0;
    if (r2Endpoint && r2AccessKey && r2SecretKey && r2Bucket) {
      const s3 = new S3Client({
        endPoint: r2Endpoint.replace('https://', ''),
        accessKey: r2AccessKey,
        secretKey: r2SecretKey,
        bucket: r2Bucket,
        region: 'auto',
        useSSL: true,
      });

      for (const photo of expired) {
        await Promise.all([
          s3.deleteObject(`photos/gallery/${photo.id}.webp`).catch(() => {}),
          s3.deleteObject(`photos/gallery/thumbs/${photo.id}.webp`).catch(() => {}),
        ]);
        r2Deleted++;
      }
    }

    // 3. Hard delete from DB (CASCADE removes task_photos)
    const expiredIds = expired.map((p) => p.id);
    const { error: deleteErr } = await supabase
      .from('gallery_photos')
      .delete()
      .in('id', expiredIds);

    if (deleteErr) throw deleteErr;

    const result = { message: 'Cleanup complete', deleted: expiredIds.length, r2Deleted };
    console.log(JSON.stringify(result));

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Cleanup Gallery Trash Error:', message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
