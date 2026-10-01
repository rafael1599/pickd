import { describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';

vi.mock('../../../../../lib/supabase', () => ({ supabase: {} }));

import { setSkuPhotoInCaches } from '../itemCardShared';

const row = (sku: string) => ({ id: sku, sku, sku_metadata: { sku, image_url: null } });

describe('setSkuPhotoInCaches', () => {
  it('reaches the Stock lists under their real keys, and search', () => {
    const qc = new QueryClient();
    qc.setQueryData(['inventory', 'grouped-all', false], [row('03-3933BK'), row('03-4066BK')]);
    qc.setQueryData(['inventory', 'parts-bins', true], [row('03-3933BK')]);
    qc.setQueryData(['inventory', 'search', 'coda'], { items: [row('03-3933BK')], total: 1 });
    qc.setQueryData(['inventory', 'bikes-total', false], 120);

    setSkuPhotoInCaches(qc, '03-3933BK', 'https://x/photos/03-3933BK.webp?v=1');

    const url = (r: unknown) => (r as ReturnType<typeof row>).sku_metadata.image_url;
    const bikes = qc.getQueryData<unknown[]>(['inventory', 'grouped-all', false])!;
    expect(url(bikes[0])).toBe('https://x/photos/03-3933BK.webp?v=1');
    expect(url(bikes[1])).toBeNull();
    expect(url(qc.getQueryData<unknown[]>(['inventory', 'parts-bins', true])![0])).toContain(
      '?v=1'
    );
    const search = qc.getQueryData<{ items: unknown[] }>(['inventory', 'search', 'coda'])!;
    expect(url(search.items[0])).toContain('?v=1');
    expect(qc.getQueryData(['inventory', 'bikes-total', false])).toBe(120);
  });
});
