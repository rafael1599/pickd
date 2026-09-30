import { useState, useCallback } from 'react';
import toast from 'react-hot-toast';
import { supabase } from '../../../lib/supabase';
import { isAuthError } from '../../../lib/supabaseRetry';
import { useAuth } from '../../../context/AuthContext';
import { generateBikeLabels, type LabelItem } from '../../inventory/utils/generateBikeLabel';
import { persistSkuUpcMapping } from '../../../utils/skuUpc';

export interface LabelEntry {
  sku: string;
  itemName: string | null;
  location: string | null;
  stock: number;
  tagged: number;
  qty: number;
  prefix: string | null;
  extra: string | null;
  upc: string | null;
  /** Print the UPC. The tag stores it either way; absent = print it (Label Studio). */
  withUpc?: boolean;
  color: string | null;
  model?: string | null;
  size?: string | null;
  /** `frame` = cuadro suelto: parte, pero con talla de cuadro. */
  category?: string | null;
  isBike?: boolean | null;
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

export interface GenerateLabelsResult {
  /** Asset tags created (one per unit). 0 = nothing printed. */
  count: number;
  /** The S/D number of every S/D SKU in the job, by SKU. */
  sdNumbers: Map<string, number>;
}

const NOTHING: GenerateLabelsResult = { count: 0, sdNumbers: new Map() };

interface TagRow {
  short_code: string;
  sku: string;
  public_token: string;
}

export function useGenerateLabels() {
  const { user } = useAuth();
  const [isGenerating, setIsGenerating] = useState(false);

  const generate = useCallback(
    async (entries: LabelEntry[]): Promise<GenerateLabelsResult> => {
      if (!user) {
        toast.error('You must be logged in to generate labels');
        return NOTHING;
      }

      const activeEntries = entries.filter((e) => e.qty > 0);
      if (activeEntries.length === 0) {
        toast.error('No entries with quantity > 0');
        return NOTHING;
      }

      setIsGenerating(true);
      let stage: 'save tags' | 'number S/D' | 'build PDF' = 'save tags';
      try {
        const now = new Date().toISOString();

        const inserts: InsertRow[] = activeEntries.flatMap((entry) =>
          Array.from({ length: entry.qty }, () => ({
            sku: entry.sku,
            warehouse: 'LUDLOW',
            // Location isn't printed on the label or in the QR — it's a print-time
            // snapshot on the tag. Auto-fill from inventory; fall back to the
            // column's 'UNKNOWN' default rather than forcing the user to type it.
            location: entry.location || 'UNKNOWN',
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

        // Sincronizar automáticamente el UPC hacia sku_metadata para que el escáner en vivo lo reconozca
        for (const entry of activeEntries) {
          if (entry.sku && entry.upc?.trim()) {
            void persistSkuUpcMapping(supabase, entry.sku, entry.upc.trim());
          }
        }

        // S/D numbers, given in the order this job lists its SKUs. A SKU that
        // already has one gets it back; one that is not S/D gets nothing.
        stage = 'number S/D';
        const { data: numbered, error: numberError } = await supabase.rpc('assign_sd_numbers', {
          p_skus: activeEntries.map((e) => e.sku),
        });
        if (numberError) throw numberError;
        const sdNumbers = new Map(
          (numbered ?? []).map((r: { sku: string; sd_number: number }) => [r.sku, r.sd_number])
        );

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
            upc: entry?.withUpc === false ? null : (entry?.upc ?? null),
            color: entry?.color ?? null,
            model: entry?.model ?? null,
            size: entry?.size ?? null,
            category: entry?.category ?? null,
            is_bike: entry?.isBike ?? null,
            serial_number: entry?.serialNumber ?? null,
            made_in: entry?.madeIn ?? null,
            po_number: entry?.poNumber ?? null,
            sd_number: sdNumbers.get(tag.sku) ?? null,
          };
        });

        stage = 'build PDF';
        const blobUrl = await generateBikeLabels(labelItems);
        window.open(blobUrl, '_blank');

        const tagCount = tags.length;
        // A S/D unit is one label + its number page; anything else, two copies.
        const pages = labelItems.length * 2;
        toast.success(`${tagCount} asset tags created, ${pages} pages generated`);
        return { count: tagCount, sdNumbers };
      } catch (err) {
        console.error(`Label generation failed (${stage}):`, err);
        // The 'save tags' insert never went through withSupabaseRetry, so
        // an expired JWT would otherwise just show a toast forever instead
        // of forcing the re-login that actually fixes it (task 10).
        if (isAuthError(err as { code?: string; status?: number })) {
          window.dispatchEvent(new CustomEvent('auth-error-401'));
        }
        const detail =
          err instanceof Error
            ? err.message
            : typeof err === 'object' && err !== null && 'message' in err
              ? String((err as { message: unknown }).message)
              : '';
        toast.error(
          detail
            ? `Failed to generate labels — ${stage}: ${detail}`
            : `Failed to generate labels — ${stage}`
        );
        return NOTHING;
      } finally {
        setIsGenerating(false);
      }
    },
    [user]
  );

  return { generate, isGenerating };
}
