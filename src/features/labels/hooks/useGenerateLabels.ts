import { useState, useCallback } from 'react';
import toast from 'react-hot-toast';
import { supabase } from '../../../lib/supabase';
import { useAuth } from '../../../context/AuthContext';
import { generateBikeLabels, type LabelItem } from '../../inventory/utils/generateBikeLabel';

export interface LabelEntry {
  sku: string;
  itemName: string | null;
  location: string | null;
  stock: number;
  tagged: number;
  qty: number;
  layout: 'standard' | 'vertical';
  prefix: string | null;
  extra: string | null;
  upc: string | null;
  poNumber: string | null;
  cNumber: string | null;
  serialNumber: string | null;
  madeIn: string | null;
  otherNotes: string | null;
}

interface InsertRow {
  sku: string;
  warehouse: string;
  location: string;
  created_by: string;
  printed_at: string;
  status: string;
  upc?: string | null;
  po_number?: string | null;
  c_number?: string | null;
  serial_number?: string | null;
  made_in?: string | null;
  other_notes?: string | null;
}

interface TagRow {
  short_code: string;
  sku: string;
  public_token: string;
}

export function useGenerateLabels() {
  const { user } = useAuth();
  const [isGenerating, setIsGenerating] = useState(false);

  const generate = useCallback(
    async (entries: LabelEntry[]): Promise<number> => {
      if (!user) {
        toast.error('You must be logged in to generate labels');
        return 0;
      }

      const activeEntries = entries.filter((e) => e.qty > 0);
      if (activeEntries.length === 0) {
        toast.error('No entries with quantity > 0');
        return 0;
      }

      const missingLocation = activeEntries.find((e) => !e.location || e.location.trim() === '');
      if (missingLocation) {
        toast.error(`Location required for ${missingLocation.sku}`);
        return 0;
      }

      setIsGenerating(true);
      try {
        const now = new Date().toISOString();

        const inserts: InsertRow[] = activeEntries.flatMap((entry) =>
          Array.from({ length: entry.qty }, () => ({
            sku: entry.sku,
            warehouse: 'LUDLOW',
            location: entry.location!,
            created_by: user.id,
            printed_at: now,
            status: entry.stock > 0 ? 'in_stock' : 'printed',
            upc: entry.upc,
            po_number: entry.poNumber,
            c_number: entry.cNumber,
            serial_number: entry.serialNumber,
            made_in: entry.madeIn,
            other_notes: entry.otherNotes,
          }))
        );

        const { data: tags, error } = await supabase
          .from('asset_tags')
          .insert(inserts)
          .select('short_code, sku, public_token');

        if (error || !tags) throw error || new Error('No tags returned');

        // Build a lookup from sku to entry for label metadata
        const entryBySku = new Map(activeEntries.map((e) => [e.sku, e]));

        const labelItems: LabelItem[] = (tags as TagRow[]).map((tag) => {
          const entry = entryBySku.get(tag.sku);
          return {
            sku: tag.sku,
            item_name: entry?.itemName ?? null,
            short_code: tag.short_code,
            public_token: tag.public_token,
            extra: entry?.extra ?? null,
            prefix: entry?.prefix ?? null,
            layout: entry?.layout ?? 'standard',
            upc: entry?.upc ?? null,
            serial_number: entry?.serialNumber ?? null,
            made_in: entry?.madeIn ?? null,
            po_number: entry?.poNumber ?? null,
          };
        });

        const blobUrl = await generateBikeLabels(labelItems);
        window.open(blobUrl, '_blank');

        const tagCount = tags.length;
        toast.success(`${tagCount} asset tags created, ${tagCount * 2} labels generated`);
        return tagCount;
      } catch (err) {
        console.error('Label generation failed:', err);
        toast.error('Failed to generate labels');
        return 0;
      } finally {
        setIsGenerating(false);
      }
    },
    [user]
  );

  return { generate, isGenerating };
}
