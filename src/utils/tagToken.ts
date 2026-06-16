/**
 * Compact transport for the asset-tag `public_token` (a UUID) inside QR codes.
 *
 * A UUID's canonical hex form is 36 chars; the same 16 bytes as base64url are
 * just 22 — a big slice of the QR payload, which keeps the printed code sparser
 * and easier to scan. `encode`/`decode` are exact inverses, and `normalize`
 * accepts either form so already-printed labels (raw UUID) and new ones
 * (base64url) both resolve against the `get_public_tag` RPC, which expects a UUID.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// 16 bytes → 22 base64url chars (no padding).
const B64URL_TOKEN_RE = /^[A-Za-z0-9_-]{22}$/;

function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** UUID → 22-char base64url. Non-UUID input is returned unchanged. */
export function encodeTagToken(uuid: string): string {
  const hex = uuid.replace(/-/g, '');
  if (!/^[0-9a-f]{32}$/i.test(hex)) return uuid;
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytesToBase64Url(bytes);
}

/** 22-char base64url → canonical lowercase UUID. */
export function decodeTagToken(token: string): string {
  const hex = Array.from(base64UrlToBytes(token), (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Resolve a tag token from the URL to the UUID the RPC expects. Accepts both the
 * legacy canonical UUID (old labels) and the compact base64url form (new labels).
 * Unknown shapes pass through so the RPC can reject them.
 */
export function normalizeTagToken(token: string): string {
  if (UUID_RE.test(token)) return token.toLowerCase();
  if (B64URL_TOKEN_RE.test(token)) {
    try {
      return decodeTagToken(token);
    } catch {
      return token;
    }
  }
  return token;
}
