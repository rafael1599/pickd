// Edge function: dcv-original-url — the private bucket of Double Check originals.
//
// The shadow of the label reader (docs/label-recognition/09-plan-de-evaluacion.md,
// stage 8) keeps every pallet photo at full resolution in `pickd-dcv-originals`,
// a PRIVATE R2 bucket: the photos carry FedEx labels with customer data, so
// nothing here is ever public. The phone never holds R2 credentials — it asks
// this function for a short-lived signed PUT and uploads straight to R2.
//
// Actions (POST, JSON):
//   { action: 'put', photoId, variants: ['full'|'r2000'] }
//       → { urls: { full: { key, url }, r2000?: { key, url } } }   any signed-in user
//   { action: 'put-ocr', key }                                     any signed-in user
//       → { key, url } signed PUT for what the reader saw in that original, as
//         JSON next to it: full/YYYY/MM/<photoId>.ocr.json. Same prefix, so the
//         same 30-day rule; the raw OCR text carries FedEx names and addresses
//         just like the photo, so it lives where the photo lives (idea-238).
//   { action: 'sample', key }                                      any signed-in user
//       → copies an uploaded full/ original to sample/, which has NO expiry
//         rule (kept until adjudicated, then deleted by hand)
//   { action: 'get', key }                                         admin only
//       → { url } signed GET for analysis
//   { action: 'get-claimed', key }                                 the reader holding it
//       → { url } signed GET of a full/ original whose photo_reads row the
//         caller has claimed (status 'reading', claimed_by = caller): another
//         PickD finishing a photo the phone that took it never read (idea-247
//         F0, 6 oct 2026). Only while the claim is theirs.
//
// Keys are decided HERE, never by the client, and name nothing about the order
// or the customer: full/YYYY/MM/<photoId>.jpg, r2000/…, sample/…
// Retention lives in R2 lifecycle rules by prefix (full/ 30 d, r2000/ 180 d).
//
// Validates the JWT itself (like upload-photo): gateway verification must be
// OFF — supabase/config.toml [functions.dcv-original-url] verify_jwt = false,
// and deploy with --no-verify-jwt.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { S3Client } from 'https://deno.land/x/s3_lite_client@0.7.0/mod.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const PUT_EXPIRY_SECONDS = 120;
const GET_EXPIRY_SECONDS = 300;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FULL_KEY = /^full\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.jpg$/i;
/** A full/ original or the reader's JSON next to it. */
const FULL_OR_OCR_KEY = /^full\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.(jpg|ocr\.json)$/i;
const ANY_KEY = /^(full|r2000|sample)\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.(jpg|ocr\.json)$/i;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing authorization header' }, 401);

    // A client that acts AS the caller, so is_admin() sees their auth.uid().
    const asCaller = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      {
        global: { headers: { Authorization: authHeader } },
      }
    );
    const token = authHeader.replace('Bearer ', '');
    const {
      data: { user },
      error: authError,
    } = await asCaller.auth.getUser(token);
    if (authError || !user) return json({ error: 'Invalid or expired token' }, 401);

    const s3 = new S3Client({
      endPoint: Deno.env.get('R2_DCV_ENDPOINT')!.replace('https://', ''),
      accessKey: Deno.env.get('R2_DCV_ACCESS_KEY_ID')!,
      secretKey: Deno.env.get('R2_DCV_SECRET_ACCESS_KEY')!,
      bucket: Deno.env.get('R2_DCV_BUCKET_NAME') ?? 'pickd-dcv-originals',
      region: 'auto',
      useSSL: true,
    });

    const body = (await req.json()) as {
      action?: 'put' | 'put-ocr' | 'sample' | 'get' | 'get-claimed';
      photoId?: string;
      variants?: string[];
      key?: string;
    };

    if (body.action === 'put') {
      if (!body.photoId || !UUID.test(body.photoId))
        return json({ error: 'photoId must be a uuid' }, 400);
      const variants = (body.variants ?? ['full']).filter((v) => v === 'full' || v === 'r2000');
      if (variants.length === 0) return json({ error: 'no valid variants' }, 400);
      const now = new Date();
      const ym = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
      const urls: Record<string, { key: string; url: string }> = {};
      for (const v of variants) {
        const key = `${v}/${ym}/${body.photoId.toLowerCase()}.jpg`;
        urls[v] = {
          key,
          url: await s3.getPresignedUrl('PUT', key, { expirySeconds: PUT_EXPIRY_SECONDS }),
        };
      }
      return json({ urls });
    }

    if (body.action === 'put-ocr') {
      if (!body.key || !FULL_KEY.test(body.key))
        return json({ error: 'key must be a full/ original' }, 400);
      const key = body.key.replace(/\.jpg$/i, '.ocr.json');
      return json({
        key,
        url: await s3.getPresignedUrl('PUT', key, { expirySeconds: PUT_EXPIRY_SECONDS }),
      });
    }

    if (body.action === 'sample') {
      if (!body.key || !FULL_OR_OCR_KEY.test(body.key))
        return json({ error: 'key must be a full/ original or its .ocr.json' }, 400);
      const sampleKey = body.key.replace(/^full\//, 'sample/');
      await s3.copyObject({ sourceKey: body.key }, sampleKey);
      return json({ key: sampleKey });
    }

    if (body.action === 'get') {
      const { data: isAdmin, error } = await asCaller.rpc('is_admin');
      if (error || isAdmin !== true) return json({ error: 'admin only' }, 403);
      if (!body.key || !ANY_KEY.test(body.key)) return json({ error: 'invalid key' }, 400);
      return json({
        url: await s3.getPresignedUrl('GET', body.key, { expirySeconds: GET_EXPIRY_SECONDS }),
      });
    }

    if (body.action === 'get-claimed') {
      if (!body.key || !FULL_KEY.test(body.key))
        return json({ error: 'key must be a full/ original' }, 400);
      const { data: claim, error } = await asCaller
        .from('photo_reads')
        .select('photo_id')
        .eq('photo_key', body.key)
        .eq('claimed_by', user.id)
        .eq('status', 'reading')
        .maybeSingle();
      if (error || !claim) return json({ error: 'not your claim' }, 403);
      return json({
        url: await s3.getPresignedUrl('GET', body.key, { expirySeconds: GET_EXPIRY_SECONDS }),
      });
    }

    return json({ error: 'unknown action' }, 400);
  } catch (err) {
    console.error('[dcv-original-url]', err);
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
