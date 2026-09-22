import { useState, useCallback } from 'react';
import toast from 'react-hot-toast';
import { supabase } from '../../../lib/supabase';
import { isAuthError } from '../../../lib/supabaseRetry';
import { useAuth } from '../../../context/AuthContext';
import { generateBikeLabels, type LabelItem } from '../../inventory/utils/generateBikeLabel';
import { persistSkuUpcMapping } from '../../recognition/liveSession/upcCatalogResolver';

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
  /** Per-entry: include the QR / Code 128 barcode on this label. */
  withQr: boolean;
  withBarcode: boolean;
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

      setIsGenerating(true);
      let stage: 'save tags' | 'build PDF' = 'save tags';
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
            upc: entry?.withUpc === false ? null : (entry?.upc ?? null),
            color: entry?.color ?? null,
            model: entry?.model ?? null,
            size: entry?.size ?? null,
            category: entry?.category ?? null,
            is_bike: entry?.isBike ?? null,
            serial_number: entry?.serialNumber ?? null,
            made_in: entry?.madeIn ?? null,
            po_number: entry?.poNumber ?? null,
            withQr: entry?.withQr ?? true,
            withBarcode: entry?.withBarcode ?? true,
          };
        });

        stage = 'build PDF';
        const blobUrl = await generateBikeLabels(labelItems);
        window.open(blobUrl, '_blank');

        const tagCount = tags.length;
        toast.success(`${tagCount} asset tags created, ${tagCount * 2} labels generated`);
        return tagCount;
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
        return 0;
      } finally {
        setIsGenerating(false);
      }
    },
    [user]
  );

  return { generate, isGenerating };
}
