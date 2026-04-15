// Edge function: cleanup-gallery-trash
//
// Permanently deletes gallery photos that have been in trash for >14 days.
// Fail-safe: only deletes from DB if R2 deletion succeeded for that photo.
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
      .select('id, filename, url')
      .not('deleted_at', 'is', null)
      .lt('deleted_at', cutoff);

    if (queryErr) throw queryErr;

    if (!expired || expired.length === 0) {
      return new Response(JSON.stringify({ message: 'No expired photos', deleted: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 2. Delete from R2 — track which ones succeeded
    const r2Endpoint = Deno.env.get('R2_ENDPOINT');
    const r2AccessKey = Deno.env.get('R2_ACCESS_KEY_ID');
    const r2SecretKey = Deno.env.get('R2_SECRET_ACCESS_KEY');
    const r2Bucket = Deno.env.get('R2_BUCKET_NAME');

    const r2SuccessIds: string[] = [];
    const r2FailedIds: string[] = [];

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
        try {
          await Promise.all([
            s3.deleteObject(`photos/gallery/${photo.id}.webp`),
            s3.deleteObject(`photos/gallery/thumbs/${photo.id}.webp`),
          ]);
          r2SuccessIds.push(photo.id);
        } catch (err) {
          console.error(
            `R2 delete failed for ${photo.id}:`,
            err instanceof Error ? err.message : err
          );
          r2FailedIds.push(photo.id);
        }
      }
    } else {
      // No R2 config — skip R2 deletion, still clean DB
      for (const photo of expired) {
        r2SuccessIds.push(photo.id);
      }
    }

    // 3. Only hard delete from DB photos that were successfully removed from R2
    let dbDeleted = 0;
    if (r2SuccessIds.length > 0) {
      const { error: deleteErr } = await supabase
        .from('gallery_photos')
        .delete()
        .in('id', r2SuccessIds);

      if (deleteErr) throw deleteErr;
      dbDeleted = r2SuccessIds.length;
    }

    // 4. Log audit trail
    const result = {
      message: 'Cleanup complete',
      expired: expired.length,
      r2Deleted: r2SuccessIds.length,
      r2Failed: r2FailedIds.length,
      dbDeleted,
      failedIds: r2FailedIds,
    };
    console.log('[CLEANUP]', JSON.stringify(result));

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
