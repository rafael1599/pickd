import { useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import ArrowLeft from 'lucide-react/dist/esm/icons/arrow-left';
import Plus from 'lucide-react/dist/esm/icons/plus';
import Flame from 'lucide-react/dist/esm/icons/flame';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2';
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import ShoppingCart from 'lucide-react/dist/esm/icons/shopping-cart';
import Printer from 'lucide-react/dist/esm/icons/printer';
import { generateShoppingListPdf } from './generateShoppingListPdf.ts';
import {
  useShoppingList,
  useAddShoppingItem,
  useUpdateShoppingItem,
  useDeleteShoppingItem,
  useShoppingListRealtime,
  type ShoppingItem,
} from './hooks/useShoppingList.ts';

// ─── Helpers ──────────────────────────────────────────────────────

function timeAgo(dateStr: string): string {
  const ms = Date.now() - new Date(dateStr).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

// ─── Add Bar ──────────────────────────────────────────────────────

const AddBar: React.FC<{
  onAdd: (item: { item_name: string; quantity?: string; urgent?: boolean }) => void;
}> = ({ onAdd }) => {
  const [name, setName] = useState('');
  const [qty, setQty] = useState('');
  const [urgent, setUrgent] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onAdd({ item_name: trimmed, quantity: qty.trim() || undefined, urgent: urgent || undefined });
    setName('');
    setQty('');
    setUrgent(false);
    inputRef.current?.focus();
  };

  return (
    <div className="bg-card border border-subtle rounded-2xl p-3 mb-4">
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder="What's needed?"
          className="flex-1 bg-surface border border-subtle rounded-xl px-3 py-2 text-sm text-content placeholder:text-muted/50 focus:outline-none focus:ring-1 focus:ring-accent"
        />
        <input
          type="text"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder="Qty"
          className="w-16 bg-surface border border-subtle rounded-xl px-2 py-2 text-sm text-content placeholder:text-muted/50 text-center focus:outline-none focus:ring-1 focus:ring-accent"
        />
        <button
          onClick={() => setUrgent(!urgent)}
          className={`p-2 rounded-xl border transition-colors ${
            urgent
              ? 'bg-red-500/10 border-red-500/30 text-red-500'
              : 'bg-surface border-subtle text-muted hover:text-content'
          }`}
          aria-label="Mark urgent"
        >
          <Flame size={16} />
        </button>
        <button
          onClick={submit}
          disabled={!name.trim()}
          className="p-2 rounded-xl bg-accent text-white disabled:opacity-30 transition-opacity"
          aria-label="Add item"
        >
          <Plus size={16} />
        </button>
      </div>
    </div>
  );
};

// ─── Swipeable Item ───────────────────────────────────────────────

const SwipeableItem: React.FC<{
  item: ShoppingItem;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
}> = ({ item, onToggle, onDelete }) => {
  const [offsetX, setOffsetX] = useState(0);
  const [swiping, setSwiping] = useState(false);
  const startX = useRef(0);
  const startY = useRef(0);
  const locked = useRef(false);
  const isDone = item.status === 'done';

  const handleTouchStart = (e: React.TouchEvent) => {
    startX.current = e.touches[0].clientX;
    startY.current = e.touches[0].clientY;
    locked.current = false;
    setSwiping(true);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!swiping) return;
    const dx = e.touches[0].clientX - startX.current;
    const dy = e.touches[0].clientY - startY.current;

    // Lock direction on first significant move
    if (!locked.current && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
      locked.current = true;
      if (Math.abs(dy) > Math.abs(dx)) {
        setSwiping(false);
        return;
      }
    }

    if (dx < 0) setOffsetX(Math.max(dx, -100));
  };

  const handleTouchEnd = () => {
    if (offsetX < -60) {
      onDelete(item.id);
    }
    setOffsetX(0);
    setSwiping(false);
  };

  return (
    <div className="relative overflow-hidden rounded-2xl">
      {/* Delete background */}
      <div className="absolute inset-0 bg-red-500 flex items-center justify-end pr-4 rounded-2xl">
        <Trash2 size={18} className="text-white" />
      </div>

      {/* Card */}
      <div
        className="relative bg-card border border-subtle rounded-2xl p-3 flex items-center gap-3 transition-transform"
        style={{
          transform: `translateX(${offsetX}px)`,
          transition: swiping ? 'none' : 'transform 0.2s ease-out',
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {/* Checkbox */}
        <button
          onClick={() => onToggle(item.id)}
          className={`w-7 h-7 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all duration-200 ${
            isDone
              ? 'bg-emerald-500 border-emerald-500 scale-95'
              : 'border-muted/40 hover:border-accent'
          }`}
          aria-label={isDone ? 'Mark pending' : 'Mark done'}
        >
          {isDone && (
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          )}
        </button>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <p
            className={`text-sm font-semibold leading-tight ${isDone ? 'line-through text-muted' : 'text-content'}`}
          >
            {item.item_name}
            {item.urgent && !isDone && (
              <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-black uppercase bg-red-500/10 text-red-500">
                urgent
              </span>
            )}
          </p>
          <div className="flex items-center gap-1.5 mt-0.5">
            {item.quantity && (
              <span className={`text-xs ${isDone ? 'text-muted/50' : 'text-muted'}`}>
                {item.quantity}
              </span>
            )}
            {item.quantity && item.requested_by_name && (
              <span className="text-muted/30 text-xs">&middot;</span>
            )}
            {item.requested_by_name && (
              <span className="text-xs text-muted/50">{item.requested_by_name}</span>
            )}
            <span className="text-muted/30 text-xs">&middot;</span>
            <span className="text-xs text-muted/50">{timeAgo(item.created_at)}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── Screen ───────────────────────────────────────────────────────

export const ShoppingListScreen: React.FC = () => {
  const navigate = useNavigate();
  const { data: items, isLoading } = useShoppingList();
  const addItem = useAddShoppingItem();
  const updateItem = useUpdateShoppingItem();
  const deleteItem = useDeleteShoppingItem();
  useShoppingListRealtime();

  const [doneExpanded, setDoneExpanded] = useState(false);

  const pending = (items ?? [])
    .filter((i) => i.status === 'pending')
    .sort((a, b) => {
      if (a.urgent !== b.urgent) return a.urgent ? -1 : 1;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

  const done = (items ?? [])
    .filter((i) => i.status === 'done')
    .sort(
      (a, b) =>
        new Date(b.done_at ?? b.updated_at).getTime() -
        new Date(a.done_at ?? a.updated_at).getTime()
    );

  const handleToggle = useCallback(
    (id: string) => {
      const item = items?.find((i) => i.id === id);
      if (!item) return;
      updateItem.mutate({
        id,
        status: item.status === 'done' ? 'pending' : 'done',
      });
    },
    [items, updateItem]
  );

  const handleDelete = useCallback(
    (id: string) => {
      deleteItem.mutate(id);
    },
    [deleteItem]
  );

  if (isLoading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <Loader2 className="animate-spin text-accent w-8 h-8 opacity-20" />
      </div>
    );
  }

  return (
    <div className="p-4 max-w-2xl mx-auto pb-24">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate('/')}
          className="p-2 hover:bg-card rounded-xl text-muted hover:text-content transition-colors"
        >
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1">
          <h1 className="text-lg font-black uppercase tracking-tight text-content">
            Shopping List
          </h1>
          <p className="text-[10px] text-muted font-bold uppercase tracking-widest">
            Supplies &amp; materials
          </p>
        </div>
        {pending.length > 0 && (
          <span className="px-2 py-0.5 rounded-full bg-accent/10 text-accent text-xs font-bold">
            {pending.length}
          </span>
        )}
      </div>

      {/* Add bar */}
      <AddBar onAdd={(input) => addItem.mutate(input)} />

      {/* Pending items */}
      {pending.length === 0 && done.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted/50">
          <ShoppingCart size={40} strokeWidth={1.5} className="mb-3 opacity-40" />
          <p className="text-sm font-semibold">Nothing needed right now</p>
          <p className="text-xs mt-1">Add items the warehouse needs</p>
        </div>
      ) : (
        <>
          <div className="space-y-2">
            {pending.map((item) => (
              <SwipeableItem
                key={item.id}
                item={item}
                onToggle={handleToggle}
                onDelete={handleDelete}
              />
            ))}
          </div>

          {/* Done section */}
          {done.length > 0 && (
            <div className="mt-6">
              <button
                onClick={() => setDoneExpanded(!doneExpanded)}
                className="flex items-center gap-2 text-muted text-xs font-bold uppercase tracking-widest mb-2 hover:text-content transition-colors"
              >
                <ChevronDown
                  size={14}
                  className={`transition-transform duration-200 ${doneExpanded ? 'rotate-0' : '-rotate-90'}`}
                />
                Done ({done.length})
              </button>
              {doneExpanded && (
                <div className="space-y-2">
                  {done.map((item) => (
                    <SwipeableItem
                      key={item.id}
                      item={item}
                      onToggle={handleToggle}
                      onDelete={handleDelete}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Print button */}
          {pending.length > 0 && (
            <button
              onClick={() => generateShoppingListPdf(items ?? [])}
              className="w-full mt-6 flex items-center justify-center gap-3 py-4 bg-card border border-subtle rounded-2xl text-content font-bold text-sm uppercase tracking-wider hover:bg-surface active:scale-[0.98] transition-all"
            >
              <Printer size={20} />
              Print Shopping List
            </button>
          )}
        </>
      )}
    </div>
  );
};
