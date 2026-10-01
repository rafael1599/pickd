import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/supabase', () => ({ supabase: {} }));

import { withPhotoVersion } from '../photoUpload.service';

describe('withPhotoVersion', () => {
  it('versions a bare URL, so a re-shot photo is a new URL', () => {
    expect(withPhotoVersion('https://x/photos/01-0357.webp')).toMatch(
      /^https:\/\/x\/photos\/01-0357\.webp\?v=\d+$/
    );
  });

  it('keeps the version the edge function stamped', () => {
    expect(withPhotoVersion('https://x/photos/01-0357.webp?v=123')).toBe(
      'https://x/photos/01-0357.webp?v=123'
    );
  });
});
