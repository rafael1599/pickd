#!/usr/bin/env node
/**
 * JAMIS Catalog Image Migration — Consolidated Script
 *
 * Usage:
 *   node migrate.mjs --download    Download images from jamisbikes.com and upload to R2
 *   node migrate.mjs --link        Match inventory item_names to catalog images in sku_metadata
 *   node migrate.mjs --all         Run both steps sequentially
 *   node migrate.mjs --dry-run     Show what would happen without making changes
 *
 * Env vars (from project .env):
 *   R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, R2_PUBLIC_DOMAIN
 *   SUPABASE_URL          (default: http://127.0.0.1:54321)
 *   SUPABASE_SERVICE_KEY   (default: local service_role key)
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

// ── Setup ──────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '../../../../..'); // navigate from skills dir to project root

config({ path: resolve(PROJECT_ROOT, '.env') });

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const DO_DOWNLOAD = args.includes('--download') || args.includes('--all');
const DO_LINK = args.includes('--link') || args.includes('--all');

if (!DO_DOWNLOAD && !DO_LINK && !DRY_RUN) {
  console.log(`Usage: node migrate.mjs [--download] [--link] [--all] [--dry-run]

  --download   Download images from jamisbikes.com → upload to R2
  --link       Match inventory items → upsert sku_metadata with image URLs
  --all        Run both steps
  --dry-run    Preview without making changes`);
  process.exit(0);
}

// ── Config ─────────────────────────────────────────────────────────
const R2_ENDPOINT = process.env.R2_ENDPOINT;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME;
const R2_PUBLIC_DOMAIN = process.env.R2_PUBLIC_DOMAIN;

const SUPABASE_URL = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_KEY ||
  // Local dev default (supabase start service_role key — safe to embed)
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const MAX_IMAGE_SIZE = 1024 * 1024; // 1MB — compress above this

const s3 = new S3Client({
  region: 'auto',
  endpoint: R2_ENDPOINT,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
});

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── Catalog Data ───────────────────────────────────────────────────
const CATALOG_PATH = resolve(__dirname, '../references/jamisBikeCatalog.json');
const catalog = JSON.parse(readFileSync(CATALOG_PATH, 'utf-8'));

// catalogKey → catalog entry
const CATALOG_MAP = Object.fromEntries([
  ['hardline', 'Hardline 3VO'],
  ['portal', 'Portal 3VO'],
  ['defcon', 'Defcon eMTB'],
  ['faultline-mpx', 'Faultline MPX'],
  ['faultline-mp2', 'Faultline MP2'],
  ['kromo', 'Kromo'],
  ['dragon', 'Dragon'],
  ['komodo', 'Komodo'],
  ['highpoint-v2', 'Highpoint V2'],
  ['highpoint', 'Highpoint'],
  ['durango', 'Durango'],
  ['trail-x', 'Trail X'],
  ['trail-xr', 'Trail XR'],
  ['helix', 'Helix'],
  ['divide', 'Divide'],
  ['carbon-renegade', 'Carbon Renegade'],
  ['steel-renegade', 'Steel Renegade'],
  ['aluminum-renegade', 'Aluminum Renegade'],
  ['ventura-all-road', 'Ventura All-Road'],
  ['ventura', 'Ventura'],
  ['sequel', 'Sequel'],
  ['hudson-e2', 'Hudson E2'],
  ['hudson', 'Hudson'],
  ['coda', 'Coda'],
  ['allegro', 'Allegro'],
  ['dxt', 'DXT'],
  ['beatnik', 'Beatnik'],
  ['citizen', 'Citizen'],
  ['explorer', 'Explorer'],
  ['earth-cruiser', 'Earth Cruiser'],
  ['boss-cruiser', 'Boss Cruiser'],
  ['taxi', 'Taxi'],
  ['taxi-trike', 'Taxi Trike'],
  ['xr26', 'XR26'],
  ['x24-disc', 'X24 Disc'],
  ['xr24', 'XR24'],
  ['capri-24', 'Capri 24'],
  ['xr20', 'XR20'],
  ['laser-20', 'Laser 20'],
  ['starlite', 'Starlite'],
  ['laser-16', 'Laser 16'],
  ['miss-daisy', 'Miss Daisy'],
].map(([key, name]) => [key, catalog.find((c) => c.name === name)]));

// ── Match Rules: inventory item_name → catalogKey ──────────────────
// IMPORTANT: specific variants BEFORE generic patterns
const MATCH_RULES = [
  // Renegade variants
  { pattern: /^RENEGADE C/i, catalogKey: 'carbon-renegade' },
  { pattern: /^RENEGADE S/i, catalogKey: 'steel-renegade' },
  { pattern: /^RENEGADE A/i, catalogKey: 'aluminum-renegade' },
  // Highpoint V2 vs regular
  { pattern: /^HIGHPOINT.*V2/i, catalogKey: 'highpoint-v2' },
  { pattern: /^HIGHPOINT/i, catalogKey: 'highpoint' },
  // Faultline V2 (MPX) vs regular (MP2)
  { pattern: /^FAULTLINE.*V2/i, catalogKey: 'faultline-mpx' },
  { pattern: /^FAULTLINE/i, catalogKey: 'faultline-mp2' },
  // Hudson E2 vs regular
  { pattern: /^HUDSON E2/i, catalogKey: 'hudson-e2' },
  { pattern: /^HUDSON/i, catalogKey: 'hudson' },
  // Ventura All-Road (CUES) vs regular
  { pattern: /^VENTURA A1 CUES/i, catalogKey: 'ventura-all-road' },
  { pattern: /^VENTURA/i, catalogKey: 'ventura' },
  // Boss Cruiser aliases
  { pattern: /^BOSS CRUISER/i, catalogKey: 'boss-cruiser' },
  { pattern: /^BC7/i, catalogKey: 'boss-cruiser' },
  { pattern: /^BCCB/i, catalogKey: 'boss-cruiser' },
  // Earth Cruiser aliases
  { pattern: /^EARTH CRUISER/i, catalogKey: 'earth-cruiser' },
  { pattern: /^EC\d/i, catalogKey: 'earth-cruiser' },
  // Taxi Trike vs Taxi
  { pattern: /^TAXI TRIKE/i, catalogKey: 'taxi-trike' },
  { pattern: /^TAXI/i, catalogKey: 'taxi' },
  // Kids (JUV prefix)
  { pattern: /^JUV MISS DAISY/i, catalogKey: 'miss-daisy' },
  { pattern: /^JUV STARLITE/i, catalogKey: 'starlite' },
  { pattern: /^JUV CAPRI/i, catalogKey: 'capri-24' },
  { pattern: /^JUV LASER 1\.6/i, catalogKey: 'laser-16' },
  { pattern: /^JUV LASER 2\.0/i, catalogKey: 'laser-20' },
  { pattern: /^JUV LASER/i, catalogKey: 'laser-20' },
  { pattern: /^JUV XR\.20/i, catalogKey: 'xr20' },
  { pattern: /^JUV XR\.24/i, catalogKey: 'xr24' },
  { pattern: /^JUV XR\.26/i, catalogKey: 'xr26' },
  { pattern: /^JUV CRITTER/i, catalogKey: 'xr20' },
  // Direct matches
  { pattern: /^HARDLINE/i, catalogKey: 'hardline' },
  { pattern: /^PORTAL/i, catalogKey: 'portal' },
  { pattern: /^DEFCON/i, catalogKey: 'defcon' },
  { pattern: /^KROMO/i, catalogKey: 'kromo' },
  { pattern: /^DRAGON/i, catalogKey: 'dragon' },
  { pattern: /^KOMODO/i, catalogKey: 'komodo' },
  { pattern: /^DURANGO/i, catalogKey: 'durango' },
  { pattern: /^TRAIL X /i, catalogKey: 'trail-x' },
  { pattern: /^TRAIL XR/i, catalogKey: 'trail-xr' },
  { pattern: /^HELIX/i, catalogKey: 'helix' },
  { pattern: /^DIVIDE/i, catalogKey: 'divide' },
  { pattern: /^SEQUEL/i, catalogKey: 'sequel' },
  { pattern: /^CODA/i, catalogKey: 'coda' },
  { pattern: /^ALLEGRO/i, catalogKey: 'allegro' },
  { pattern: /^DXT/i, catalogKey: 'dxt' },
  { pattern: /^BEATNIK/i, catalogKey: 'beatnik' },
  { pattern: /^CITIZEN/i, catalogKey: 'citizen' },
  { pattern: /^EXPLORER/i, catalogKey: 'explorer' },
];

// ── Helpers ────────────────────────────────────────────────────────

/** Remove WordPress resize suffixes to get full-res URL */
function getHiResUrl(url) {
  return url.replace(/_\d+px(-\d+x\d+)?\.(\w+)/, '.$2').replace(/-\d+x\d+\.(\w+)/, '.$1');
}

/** Compress image if over MAX_IMAGE_SIZE */
async function maybeCompress(buffer, url) {
  if (buffer.length <= MAX_IMAGE_SIZE) return buffer;

  // Dynamic import — sharp is optional, only needed for compression
  const { default: sharp } = await import('sharp');
  const isJpeg = /\.jpe?g$/i.test(url);

  let img = sharp(buffer).resize({ width: 1600, withoutEnlargement: true });
  if (isJpeg) img = img.jpeg({ quality: 85 });
  else img = img.png({ compressionLevel: 9 });

  const compressed = await img.toBuffer();
  console.log(`    compressed: ${(buffer.length / 1024).toFixed(0)}KB → ${(compressed.length / 1024).toFixed(0)}KB`);
  return compressed;
}

// ── Step 1: Download & Upload ──────────────────────────────────────
async function downloadAndUpload() {
  console.log('\n📥 Step 1: Download from jamisbikes.com → upload to R2\n');

  if (!R2_ENDPOINT || !R2_ACCESS_KEY_ID) {
    console.error('  Missing R2 env vars. Set R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, R2_PUBLIC_DOMAIN');
    process.exit(1);
  }

  const uploaded = {};
  let ok = 0, failed = 0;

  for (const [key, entry] of Object.entries(CATALOG_MAP)) {
    if (!entry) {
      console.log(`  ⚠️  No catalog entry for key: ${key}`);
      continue;
    }

    const hiResUrl = getHiResUrl(entry.imageUrl);
    const r2Key = `catalog/${key}.png`;
    const publicUrl = `${R2_PUBLIC_DOMAIN}/${r2Key}`;

    try {
      // Try hi-res first, fall back to original
      let res = await fetch(hiResUrl);
      let usedUrl = hiResUrl;

      if (!res.ok && hiResUrl !== entry.imageUrl) {
        res = await fetch(entry.imageUrl);
        usedUrl = entry.imageUrl;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      let buffer = Buffer.from(await res.arrayBuffer());
      const sizeKB = (buffer.length / 1024).toFixed(0);

      if (!DRY_RUN) {
        buffer = await maybeCompress(buffer, usedUrl);
        const contentType = /\.jpe?g$/i.test(usedUrl) ? 'image/jpeg' : 'image/png';
        await s3.send(new PutObjectCommand({
          Bucket: R2_BUCKET_NAME,
          Key: r2Key,
          Body: buffer,
          ContentType: contentType,
        }));
      }

      const label = usedUrl === hiResUrl && hiResUrl !== entry.imageUrl ? 'hi-res' : 'original';
      console.log(`  ✅ ${entry.name}: ${sizeKB}KB (${label})${DRY_RUN ? ' [dry-run]' : ''}`);
      uploaded[key] = publicUrl;
      ok++;
    } catch (err) {
      console.error(`  ❌ ${entry.name}: ${err.message}`);
      failed++;
    }
  }

  console.log(`\n  Uploaded: ${ok} | Failed: ${failed}`);
  return uploaded;
}

// ── Step 2: Link Inventory ─────────────────────────────────────────
async function linkInventory(uploadedUrls) {
  console.log('\n🔗 Step 2: Match inventory → upsert sku_metadata\n');

  // If no uploadedUrls provided (running --link alone), build from R2_PUBLIC_DOMAIN
  if (!uploadedUrls) {
    uploadedUrls = {};
    for (const key of Object.keys(CATALOG_MAP)) {
      if (CATALOG_MAP[key]) {
        uploadedUrls[key] = `${R2_PUBLIC_DOMAIN}/catalog/${key}.png`;
      }
    }
  }

  const { data: items, error } = await supabase
    .from('inventory')
    .select('sku, item_name')
    .not('item_name', 'is', null);

  if (error) throw new Error(`Inventory query failed: ${error.message}`);

  // Skip SKUs that already have images
  const { data: existingMeta } = await supabase
    .from('sku_metadata')
    .select('sku, image_url')
    .not('image_url', 'is', null);

  const skusWithImages = new Set((existingMeta || []).map((m) => m.sku));

  let matched = 0, skipped = 0, unmatched = 0;
  const unmatchedNames = new Set();
  const upserts = [];

  for (const item of items) {
    const name = (item.item_name || '').trim();
    if (!name) continue;

    if (skusWithImages.has(item.sku)) { skipped++; continue; }

    const rule = MATCH_RULES.find((r) => r.pattern.test(name));
    if (!rule || !uploadedUrls[rule.catalogKey]) {
      unmatched++;
      unmatchedNames.add(name);
      continue;
    }

    upserts.push({ sku: item.sku, image_url: uploadedUrls[rule.catalogKey] });
    matched++;
  }

  if (!DRY_RUN) {
    const CHUNK_SIZE = 50;
    for (let i = 0; i < upserts.length; i += CHUNK_SIZE) {
      const chunk = upserts.slice(i, i + CHUNK_SIZE);
      const { error: upsertError } = await supabase
        .from('sku_metadata')
        .upsert(chunk, { onConflict: 'sku' });

      if (upsertError) console.error(`  ❌ Upsert batch ${i / CHUNK_SIZE + 1}: ${upsertError.message}`);
      else console.log(`  💾 Upserted batch ${i / CHUNK_SIZE + 1}: ${chunk.length} rows`);
    }
  }

  console.log(`\n  Matched: ${matched} | Skipped (has image): ${skipped} | Unmatched: ${unmatched}${DRY_RUN ? ' [dry-run]' : ''}`);

  if (unmatchedNames.size > 0) {
    console.log(`\n  Unmatched item_names:`);
    for (const n of [...unmatchedNames].sort()) console.log(`    - ${n}`);
  }
}

// ── Main ───────────────────────────────────────────────────────────
async function main() {
  console.log(`🚀 JAMIS Catalog Image Migration${DRY_RUN ? ' (DRY RUN)' : ''}`);
  console.log(`   Supabase: ${SUPABASE_URL}`);
  console.log(`   R2 Domain: ${R2_PUBLIC_DOMAIN || '(not set)'}`);

  let uploadedUrls = null;

  if (DO_DOWNLOAD) {
    uploadedUrls = await downloadAndUpload();
  }

  if (DO_LINK) {
    await linkInventory(uploadedUrls);
  }

  console.log('\n🏁 Done!');
}

main().catch((err) => {
  console.error('\n💥 Fatal:', err.message);
  process.exit(1);
});
