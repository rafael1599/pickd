import { useState, useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import Printer from 'lucide-react/dist/esm/icons/printer';
import Search from 'lucide-react/dist/esm/icons/search';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2';
import X from 'lucide-react/dist/esm/icons/x';
import toast from 'react-hot-toast';

import { supabase } from '../../../lib/supabase';
import {
  generateBikeLabels,
  type LabelItem,
  VALID_TRANSITIONS,
} from '../../inventory/utils/generateBikeLabel';
import { useLabelItems, type LabelInventoryItem } from '../hooks/useLabelItems';

interface AssetTagRow {
  id: string;
  short_code: string;
  public_token: string;
  sku: string;
  location: string | null;
  status: string;
  printed_at: string | null;
  created_at: string;
  upc?: string | null;
  po_number?: string | null;
  c_number?: string | null;
  serial_number?: string | null;
  made_in?: string | null;
  other_notes?: string | null;
  label_photo_url?: string | null;
}

export const HistoryMode = () => {
  const [historyFilter, setHistoryFilter] = useState('');
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [editingTag, setEditingTag] = useState<AssetTagRow | null>(null);
  const [isReprinting, setIsReprinting] = useState(false);

  const queryClient = useQueryClient();
  const { data: items } = useLabelItems();

  // Fetch asset_tags history
  const { data: createdTags, isLoading: isLoadingTags } = useQuery({
    queryKey: ['asset-tags-history'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('asset_tags')
        .select(
          'id, short_code, public_token, sku, location, status, printed_at, created_at, upc, po_number, c_number, serial_number, made_in, other_notes, label_photo_url'
        )
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as AssetTagRow[];
    },
    staleTime: 30_000,
  });

  // Group tags by SKU with filter
  const tagsBySku = useMemo(() => {
    if (!createdTags) return new Map<string, AssetTagRow[]>();
    const q = historyFilter.toUpperCase();
    const filtered = q
      ? createdTags.filter(
          (t) =>
            t.sku.includes(q) ||
            t.short_code.toUpperCase().includes(q) ||
            (t.location ?? '').toUpperCase().includes(q)
        )
      : createdTags;
    const map = new Map<string, AssetTagRow[]>();
    for (const tag of filtered) {
      const arr = map.get(tag.sku) ?? [];
      arr.push(tag);
      map.set(tag.sku, arr);
    }
    return map;
  }, [createdTags, historyFilter]);

  // Resolve item_name from inventory data
  const getItemName = useCallback(
    (sku: string) => items?.find((i: LabelInventoryItem) => i.sku === sku)?.item_name ?? null,
    [items]
  );

  const handleReprint = useCallback(
    async (sku: string, tags: AssetTagRow[]) => {
      setIsReprinting(true);
      try {
        const labelItems: LabelItem[] = tags.map((t) => ({
          sku: t.sku,
          item_name: getItemName(t.sku),
          short_code: t.short_code,
          public_token: t.public_token,
        }));
        const blobUrl = await generateBikeLabels(labelItems);
        window.open(blobUrl, '_blank');
        toast.success(`Reprinting ${tags.length * 2} labels for ${sku || 'selection'}`);
      } catch {
        toast.error('Failed to reprint labels');
      } finally {
        setIsReprinting(false);
      }
    },
    [getItemName]
  );

  const handleReleaseTags = useCallback(
    async (tagIds: string[], mode: 'invalidate' | 'delete') => {
      try {
        if (mode === 'delete') {
          const { error } = await supabase.from('asset_tags').delete().in('id', tagIds);
          if (error) throw error;
          toast.success(`${tagIds.length} tag${tagIds.length !== 1 ? 's' : ''} deleted`);
        } else {
          const { error } = await supabase
            .from('asset_tags')
            .update({ status: 'lost' })
            .in('id', tagIds);
          if (error) throw error;
          toast.success(`${tagIds.length} tag${tagIds.length !== 1 ? 's' : ''} invalidated`);
        }
        setSelectedTags(new Set());
        queryClient.invalidateQueries({ queryKey: ['asset-tags-history'] });
      } catch {
        toast.error('Failed to release tags');
      }
    },
    [queryClient]
  );

  const handleSaveTag = useCallback(
    async (tagId: string, updates: Record<string, string | null>) => {
      try {
        const { error } = await supabase.from('asset_tags').update(updates).eq('id', tagId);
        if (error) throw error;
        toast.success('Tag updated');
        setEditingTag(null);
        queryClient.invalidateQueries({ queryKey: ['asset-tags-history'] });
      } catch {
        toast.error('Failed to update tag');
      }
    },
    [queryClient]
  );

  const toggleTagSelection = useCallback((tagId: string) => {
    setSelectedTags((prev) => {
      const next = new Set(prev);
      if (next.has(tagId)) next.delete(tagId);
      else next.add(tagId);
      return next;
    });
  }, []);

  return (
    <>
      {/* History search */}
      <div className="px-4 pb-3">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            type="text"
            value={historyFilter}
            onChange={(e) => setHistoryFilter(e.target.value)}
            placeholder="Filter by SKU, tag code, or location..."
            className="w-full h-10 pl-9 pr-3 bg-surface border border-subtle rounded-xl text-xs text-content placeholder-muted focus:outline-none focus:border-accent/40 font-mono"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-8">
        {isLoadingTags && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="animate-spin text-accent w-8 h-8 opacity-30" />
          </div>
        )}

        {!isLoadingTags && tagsBySku.size === 0 && (
          <div className="text-center py-20 text-muted text-sm">
            {historyFilter ? 'No tags match your filter.' : 'No asset tags created yet.'}
          </div>
        )}

        {[...tagsBySku.entries()].map(([sku, tags]) => (
          <div key={sku} className="mb-4 p-3 bg-card border border-subtle rounded-xl">
            <div className="flex items-center justify-between mb-2">
              <div>
                <p className="text-sm font-bold text-content tracking-tight">{sku}</p>
                <p className="text-[10px] text-muted">{tags[0]?.location ?? 'No location'}</p>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-bold text-accent bg-accent/10 border border-accent/20 px-2 py-1 rounded-lg">
                  {tags.length}
                </span>
                <button
                  onClick={() => handleReprint(sku, tags)}
                  disabled={isReprinting}
                  className="p-1.5 bg-surface border border-subtle rounded-lg text-muted hover:text-accent hover:border-accent/30 transition-colors active:scale-90 disabled:opacity-30"
                  title="Reprint all"
                >
                  <Printer size={14} />
                </button>
                <button
                  onClick={() => {
                    if (
                      window.confirm(
                        `Release all ${tags.length} tags for ${sku}?\n\nChoose OK to invalidate, or cancel and use individual selection to delete.`
                      )
                    ) {
                      handleReleaseTags(
                        tags.map((t) => t.id),
                        'invalidate'
                      );
                    }
                  }}
                  className="p-1.5 bg-surface border border-subtle rounded-lg text-muted hover:text-red-500 hover:border-red-500/30 transition-colors active:scale-90"
                  title="Release all tags"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {tags.map((tag) => {
                const isSelected = selectedTags.has(tag.id);
                return (
                  <button
                    key={tag.id}
                    onClick={() => toggleTagSelection(tag.id)}
                    onDoubleClick={() => setEditingTag(tag)}
                    className={`text-[9px] font-mono font-bold px-2 py-1 rounded-lg border transition-all active:scale-95 ${
                      isSelected ? 'ring-2 ring-accent ring-offset-1 ring-offset-main' : ''
                    } ${
                      tag.status === 'printed'
                        ? 'bg-card border-subtle text-muted'
                        : tag.status === 'in_stock'
                          ? 'bg-green-500/10 border-green-500/20 text-green-500'
                          : tag.status === 'allocated' || tag.status === 'picked'
                            ? 'bg-blue-500/10 border-blue-500/20 text-blue-500'
                            : tag.status === 'shipped'
                              ? 'bg-accent/10 border-accent/20 text-accent'
                              : 'bg-red-500/10 border-red-500/20 text-red-500'
                    }`}
                    title={`${tag.status} -- tap to select, double-tap to edit`}
                  >
                    {tag.short_code}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Selection action bar */}
      {selectedTags.size > 0 && (
        <div className="fixed bottom-0 left-0 right-0 px-4 pt-3 pb-28 bg-gradient-to-t from-main via-main/90 to-transparent">
          <div className="flex items-center gap-2 bg-card border border-subtle rounded-2xl p-3">
            <span className="text-[10px] font-bold text-content flex-1">
              {selectedTags.size} selected
            </span>
            <button
              onClick={() =>
                handleReprint('', createdTags?.filter((t) => selectedTags.has(t.id)) ?? [])
              }
              className="px-3 py-2 bg-accent/10 border border-accent/20 rounded-xl text-[10px] font-bold text-accent active:scale-95"
            >
              Reprint
            </button>
            <button
              onClick={() => handleReleaseTags([...selectedTags], 'invalidate')}
              className="px-3 py-2 bg-amber-500/10 border border-amber-500/20 rounded-xl text-[10px] font-bold text-amber-500 active:scale-95"
            >
              Invalidate
            </button>
            <button
              onClick={() => {
                if (window.confirm(`Delete ${selectedTags.size} tag(s) permanently?`))
                  handleReleaseTags([...selectedTags], 'delete');
              }}
              className="px-3 py-2 bg-red-500/10 border border-red-500/20 rounded-xl text-[10px] font-bold text-red-500 active:scale-95"
            >
              Delete
            </button>
          </div>
        </div>
      )}

      {/* Tag edit modal */}
      {editingTag &&
        (() => {
          const et = editingTag;
          const fields = [
            ['upc', 'UPC', et.upc ?? ''],
            ['po_number', 'P/O No', et.po_number ?? ''],
            ['c_number', 'C/No', et.c_number ?? ''],
            ['serial_number', 'Serial No', et.serial_number ?? ''],
            ['made_in', 'Made In', et.made_in ?? ''],
            ['other_notes', 'Notes', et.other_notes ?? ''],
          ] as [string, string, string][];
          const editState: Record<string, string> = {};
          fields.forEach(([key, , val]) => {
            editState[key] = val;
          });
          let selectedStatus = et.status;
          const validTargets = VALID_TRANSITIONS[et.status] ?? [];

          return (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-main/60 backdrop-blur-md">
              <div className="bg-surface border border-subtle rounded-2xl p-5 w-full max-w-sm shadow-2xl">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <p className="text-sm font-bold text-content">{et.short_code}</p>
                    <p className="text-[10px] text-muted">
                      {et.sku} &middot; {et.status}
                    </p>
                  </div>
                  <button
                    onClick={() => setEditingTag(null)}
                    className="p-2 text-muted hover:text-content"
                  >
                    <X size={18} />
                  </button>
                </div>
                <div className="space-y-2">
                  {/* Status dropdown */}
                  <div>
                    <label className="text-[9px] text-muted font-black uppercase tracking-widest">
                      Status
                    </label>
                    <select
                      defaultValue={et.status}
                      onChange={(e) => {
                        selectedStatus = e.target.value;
                      }}
                      className="w-full h-9 px-3 bg-card border border-subtle rounded-lg text-xs text-content focus:outline-none focus:border-accent/40"
                    >
                      <option value={et.status} disabled>
                        {et.status}
                      </option>
                      {validTargets.map((s: string) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </div>
                  {fields.map(([key, label, defaultVal]) => (
                    <div key={key}>
                      <label className="text-[9px] text-muted font-black uppercase tracking-widest">
                        {label}
                      </label>
                      <input
                        type="text"
                        defaultValue={defaultVal}
                        onChange={(e) => {
                          editState[key] = e.target.value.toUpperCase();
                        }}
                        className="w-full h-9 px-3 bg-card border border-subtle rounded-lg text-xs text-content font-mono focus:outline-none focus:border-accent/40"
                      />
                    </div>
                  ))}
                </div>
                <div className="flex gap-2 mt-4">
                  <button
                    onClick={() => {
                      const updates: Record<string, string | null> = {
                        ...editState,
                      };
                      if (selectedStatus !== et.status) {
                        const allowed = VALID_TRANSITIONS[et.status] ?? [];
                        if (allowed.includes(selectedStatus)) {
                          updates.status = selectedStatus;
                        } else {
                          toast.error(`Cannot transition from ${et.status} to ${selectedStatus}`);
                          return;
                        }
                      }
                      handleSaveTag(et.id, updates);
                    }}
                    className="flex-1 h-10 bg-accent text-main font-bold text-[10px] uppercase tracking-widest rounded-xl active:scale-95"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => {
                      handleReprint(et.sku, [et]);
                      setEditingTag(null);
                    }}
                    className="h-10 px-4 bg-surface border border-subtle text-muted font-bold text-[10px] uppercase tracking-widest rounded-xl active:scale-95"
                  >
                    Reprint
                  </button>
                </div>
              </div>
            </div>
          );
        })()}
    </>
  );
};
