import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import ChevronUp from 'lucide-react/dist/esm/icons/chevron-up';
import { DoubleCheckView, PickingItem, type CorrectionAction } from './DoubleCheckView';
import { useAuth } from '../../../context/AuthContext';
import { useConfirmation } from '../../../context/ConfirmationContext';
import { usePickingSession } from '../../../context/PickingContext';
import { useViewMode } from '../../../context/ViewModeContext';
import { useInventory } from '../../inventory/hooks/InventoryProvider';
import { getOptimizedPickingPath, calculatePallets } from '../../../utils/pickingLogic';
import type { Location } from '../../../schemas/location.schema';
import { supabase } from '../../../lib/supabase';
import type { Json } from '../../../lib/database.types';
import toast from 'react-hot-toast';
import { useScrollLock } from '../../../hooks/useScrollLock';

export const PickingCartDrawer: React.FC = () => {
  const { user } = useAuth();
  const { showConfirmation } = useConfirmation();
  const { externalDoubleCheckId, setExternalDoubleCheckId, viewMode } = useViewMode();
  const { pathname } = useLocation();

  const {
    cartItems,
    setCartItems,
    activeListId,
    orderNumber,
    customer,
    sessionMode,
    checkedBy: _checkedBy,
    correctionNotes,
    loadExternalList,
    lockForCheck,
    releaseCheck,
    returnToPicker,
    markAsReady,
    ownerId,
    notes,
    isNotesLoading,
    addNote,
    deleteList: _deleteList,
    resetSession,
    listStatus,
    isWaitingInventory,
    setIsWaitingInventory,
    claimAsPicker,
    cancelReopen,
  } = usePickingSession();

  const { inventoryData, processPickingList, recompletePickingList } = useInventory();

  const [isOpen, setIsOpen] = useState(false);
  // currentView removed — always renders DoubleCheckView (idea-032 phase 2)
  const [checkedItems, setCheckedItems] = useState<Set<string>>(new Set());
  const isOwner = user?.id === ownerId;
  const isConfirmingRef = React.useRef(false);
  const isRecompletingRef = React.useRef(false);
  const [isProcessingDeduction, setIsProcessingDeduction] = useState(false);
  const overriddenPalletCountRef = React.useRef<number | null>(null);
  useScrollLock(isOpen, () => setIsOpen(false));

  const totalItems = cartItems.length;
  const totalQty = cartItems.reduce((acc, item) => acc + (item.pickingQty || 0), 0);

  // 0. Restore checked items on load if in double-check session
  useEffect(() => {
    if (sessionMode === 'double_checking' && activeListId) {
      const savedProgress = localStorage.getItem(`double_check_progress_${activeListId}`);
      if (savedProgress) {
        try {
          setCheckedItems(new Set(JSON.parse(savedProgress)));
        } catch {
          /* ignore corrupt localStorage */
        }
      }
    } else {
      setCheckedItems(new Set());
    }
  }, [sessionMode, activeListId]);

  // Auto-open full-screen when entering reopened mode
  useEffect(() => {
    if (sessionMode === 'reopened' && !isOpen) {
      setIsOpen(true);
    }
  }, [sessionMode, isOpen]);

  // Close drawer when leaving picking view or navigating away from home.
  // Exception: don't close when there's an external trigger (Verification Board
  // opens an order from any route) or during reopened mode transition.
  useEffect(() => {
    if (externalDoubleCheckId) return; // keep open regardless of route
    if ((viewMode !== 'picking' || pathname !== '/') && isOpen && sessionMode !== 'reopened') {
      setIsOpen(false);
    }
  }, [viewMode, pathname, externalDoubleCheckId, isOpen, sessionMode]);

  // 1. Auto-close if completed or session reset (idle with no items)
  useEffect(() => {
    if (listStatus === 'completed' && isOpen && !isRecompletingRef.current) {
      setIsOpen(false);
      resetSession();
    }
  }, [listStatus, isOpen, resetSession]);

  // Auto-close drawer when session is reset (e.g. after delete/cancel)
  useEffect(() => {
    if (sessionMode === 'idle' && totalItems === 0 && isOpen) {
      setIsOpen(false);
    }
  }, [sessionMode, totalItems, isOpen]);

  // 1. Handle External Trigger (from Header)
  useEffect(() => {
    if (externalDoubleCheckId) {
      console.log('🔄 [PickingCartDrawer] External trigger detected:', externalDoubleCheckId);
      const startDoubleCheck = async () => {
        try {
          console.log('📦 [PickingCartDrawer] Loading external list...');
          const list = (await loadExternalList(String(externalDoubleCheckId))) as
            | { id?: string; checked_by?: string | null }
            | undefined;
          console.log('📋 [PickingCartDrawer] List loaded:', list?.id, 'User:', user?.id);

          if (list && user) {
            // Check for takeover — also check group siblings
            const listData = list as {
              id?: string;
              checked_by?: string | null;
              group_id?: string | null;
            };
            let needsTakeover = !!(listData.checked_by && listData.checked_by !== user.id);

            if (!needsTakeover && listData.group_id) {
              const { data: groupSiblings } = await supabase
                .from('picking_lists')
                .select('checked_by')
                .eq('group_id', listData.group_id)
                .neq('id', String(externalDoubleCheckId))
                .not('checked_by', 'is', null);

              needsTakeover = groupSiblings?.some((s) => s.checked_by !== user.id) || false;
            }

            if (needsTakeover) {
              console.log('⚠️ [PickingCartDrawer] Takeover required for list:', listData.id);
              isConfirmingRef.current = true;
              showConfirmation(
                'Takeover Order',
                listData.group_id
                  ? 'This order group is currently being checked by another user. Do you want to take over the entire group?'
                  : 'This order is currently being checked by another user. Do you want to take over?',
                async () => {
                  console.log('⚔️ [PickingCartDrawer] confirmed takeover');
                  await lockForCheck(String(externalDoubleCheckId));
                  const savedProgress = localStorage.getItem(
                    `double_check_progress_${externalDoubleCheckId}`
                  );
                  if (savedProgress) setCheckedItems(new Set(JSON.parse(savedProgress)));
                  else setCheckedItems(new Set());
                  setIsOpen(true);
                  setExternalDoubleCheckId(null);
                  isConfirmingRef.current = false;
                },
                () => {
                  console.log('🛑 [PickingCartDrawer] takeover cancelled');
                  setExternalDoubleCheckId(null);
                  isConfirmingRef.current = false;
                },
                'Takeover',
                'Cancel'
              );
              return;
            }

            console.log('🔒 [PickingCartDrawer] Locking list for user...');
            await lockForCheck(String(externalDoubleCheckId));

            const savedProgress = localStorage.getItem(
              `double_check_progress_${externalDoubleCheckId}`
            );
            if (savedProgress) {
              try {
                setCheckedItems(new Set(JSON.parse(savedProgress)));
              } catch {
                setCheckedItems(new Set());
              }
            } else {
              setCheckedItems(new Set());
            }

            console.log('🔓 [PickingCartDrawer] Opening drawer for double check');
            setIsOpen(true);
            setExternalDoubleCheckId(null);
          } else {
            console.error(
              '❌ [PickingCartDrawer] List or User missing. List:',
              !!list,
              'User:',
              !!user
            );
          }
        } catch (err) {
          console.error('💥 [PickingCartDrawer] Error in startDoubleCheck:', err);
        }
      };
      startDoubleCheck();
    }
  }, [
    externalDoubleCheckId,
    user,
    loadExternalList,
    lockForCheck,
    setExternalDoubleCheckId,
    showConfirmation,
  ]);

  // 3. Persist local progress for double check
  useEffect(() => {
    if (sessionMode === 'double_checking' && activeListId && checkedItems.size >= 0) {
      localStorage.setItem(
        `double_check_progress_${activeListId}`,
        JSON.stringify(Array.from(checkedItems))
      );
    }
  }, [checkedItems, activeListId, sessionMode]);

  const handleMarkAsReady = async (finalOrderNumber: string) => {
    const listId = await markAsReady(cartItems, finalOrderNumber);
    if (listId) {
      setCheckedItems(new Set());
    }
  };

  const handleSendToVerifyQueue = async () => {
    if (!orderNumber) return;
    const listId = await markAsReady(cartItems, orderNumber);
    if (listId) {
      await releaseCheck(listId);
      setIsOpen(false);
      toast.success('Order sent to verification queue');
    }
  };

  const toggleCheck = (item: PickingItem, palletId: number | string) => {
    const key = `${palletId}-${item.sku}-${item.location}`;
    setCheckedItems((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const handleSelectAll = (keys?: string[]) => {
    if (keys) {
      setCheckedItems(new Set(keys));
      return;
    }

    // Fallback: We need the same logic used to calculate pallets in DoubleCheckView
    const allLocations: Location[] = inventoryData.map((i) => ({
      id: i.location_id || '',
      location: i.location || '',
      warehouse: i.warehouse as Location['warehouse'],
      zone: null,
      max_capacity: null,
      picking_order: null,
      is_active: true,
      created_at: '',
      length_ft: null,
      bike_line: null,
    }));

    const path = getOptimizedPickingPath(cartItems, allLocations);
    const pallets = calculatePallets(path);

    const newChecked = new Set<string>();
    pallets.forEach((p) => {
      p.items.forEach((item) => {
        const key = `${p.id}-${item.sku}-${item.location}`;
        newChecked.add(key);
      });
    });

    setCheckedItems(newChecked);
  };

  const handleReleaseOrder = async () => {
    if (sessionMode === 'double_checking' && activeListId) {
      await claimAsPicker(activeListId);
      await releaseCheck(activeListId);
    }
    setIsOpen(false);
  };

  const handleCorrectItem = async (action: CorrectionAction, targetListId?: string) => {
    if (!activeListId) return;
    const writeListId = targetListId ?? activeListId;
    // When a targetListId is provided, this is a sub-order edit inside a combined
    // group. Read that specific list's items from DB so we only mutate its row
    // (prevents the cross-sub-order duplication bug — see idea-057).
    const useDbSource = !!targetListId;
    try {
      let sourceItems: PickingItem[];
      if (useDbSource) {
        const { data: list, error: fetchErr } = await supabase
          .from('picking_lists')
          .select('items')
          .eq('id', writeListId)
          .single();
        if (fetchErr) throw fetchErr;
        sourceItems = Array.isArray(list?.items) ? (list.items as unknown as PickingItem[]) : [];
      } else {
        sourceItems = cartItems;
      }

      let newItems: PickingItem[];
      let logMessage: string;

      switch (action.type) {
        case 'swap': {
          newItems = sourceItems.map((item) =>
            item.sku === action.originalSku
              ? {
                  ...item,
                  sku: action.replacement.sku,
                  location: action.replacement.location,
                  item_name: action.replacement.item_name,
                  warehouse: action.replacement.warehouse,
                  pickingQty: action.newQty ?? item.pickingQty,
                  sku_not_found: false,
                  insufficient_stock: false,
                }
              : item
          );
          const qtySuffix = action.newQty !== undefined ? ` (qty ${action.newQty})` : '';
          logMessage = action.reason
            ? `Replaced ${action.originalSku} → ${action.replacement.sku}${qtySuffix}: ${action.reason}`
            : `Swapped SKU ${action.originalSku} → ${action.replacement.sku}${qtySuffix}`;
          break;
        }
        case 'adjust_qty': {
          newItems = sourceItems.map((item) =>
            item.sku === action.sku
              ? { ...item, pickingQty: action.newQty, insufficient_stock: false }
              : item
          );
          logMessage = action.reason
            ? `Adjusted ${action.sku} qty to ${action.newQty}: ${action.reason}`
            : `Adjusted qty for ${action.sku} to ${action.newQty}`;
          break;
        }
        case 'remove': {
          newItems = sourceItems.filter((item) => item.sku !== action.sku);
          logMessage = action.reason
            ? `Removed ${action.sku}: ${action.reason}`
            : `Removed SKU ${action.sku} from order`;
          break;
        }
        case 'add': {
          const existing = sourceItems.find((item) => item.sku === action.item.sku);
          if (existing) {
            newItems = sourceItems.map((item) =>
              item.sku === action.item.sku
                ? { ...item, pickingQty: item.pickingQty + action.item.pickingQty }
                : item
            );
            logMessage = action.reason
              ? `Added ${action.item.sku} (qty ${action.item.pickingQty}, total ${existing.pickingQty + action.item.pickingQty}): ${action.reason}`
              : `Extra item: ${action.item.sku}, qty ${action.item.pickingQty} (total ${existing.pickingQty + action.item.pickingQty})`;
          } else {
            newItems = [
              ...sourceItems,
              {
                sku: action.item.sku,
                location: action.item.location,
                warehouse: action.item.warehouse,
                item_name: action.item.item_name,
                pickingQty: action.item.pickingQty,
                sku_not_found: false,
                insufficient_stock: false,
              },
            ];
            logMessage = action.reason
              ? `Added ${action.item.sku} (qty ${action.item.pickingQty}): ${action.reason}`
              : `Extra item: ${action.item.sku}, qty ${action.item.pickingQty}`;
          }
          break;
        }
      }

      await supabase
        .from('picking_lists')
        .update({ items: newItems as unknown as Json })
        .eq('id', writeListId);

      await supabase.from('picking_list_notes').insert({
        list_id: writeListId,
        user_id: user!.id,
        message: logMessage,
      });

      if (useDbSource) {
        // Refresh merged cart so the combined view reflects the sub-order change.
        await loadExternalList(activeListId);
      } else {
        setCartItems(newItems as unknown as typeof cartItems);
      }

      toast.success(logMessage);
    } catch (err) {
      console.error('Correction failed:', err);
      toast.error('Correction failed');
    }
  };

  const handleDeduct = async (items: PickingItem[], isVerified: boolean) => {
    if (isProcessingDeduction) return false;
    setIsProcessingDeduction(true);

    try {
      // Claim as picker if current owner is Warehouse Team (script account)
      await claimAsPicker(activeListId!);

      if (!isVerified) {
        // Rule: All-or-nothing verification.
        await releaseCheck(activeListId!);
        toast('Order released to queue (No deduction made)', {
          icon: '📋',
          duration: 4000,
        });
        return true;
      }

      // Check if this order belongs to a group
      const { data: mainOrder } = await supabase
        .from('picking_lists')
        .select('group_id, items, order_group:order_groups(group_type)')
        .eq('id', activeListId!)
        .single();

      const isFedexGroup =
        (mainOrder?.order_group as { group_type: string } | null)?.group_type === 'fedex';

      // Calculate metrics from the MAIN ORDER's DB items only (not the merged cart)
      const mainDbItems = Array.isArray(mainOrder?.items)
        ? (mainOrder.items as Array<{ pickingQty?: number }>)
        : [];
      const mainUnits = mainDbItems.reduce((acc, item) => acc + (Number(item.pickingQty) || 0), 0);

      // FedEx orders don't use pallets — set to 0
      let pallets_qty: number;
      if (isFedexGroup) {
        pallets_qty = 0;
      } else if (overriddenPalletCountRef.current !== null && !mainOrder?.group_id) {
        pallets_qty = overriddenPalletCountRef.current;
      } else {
        const mainCartItems = mainOrder?.group_id
          ? items.filter(
              (i) => !i.source_order || i.source_order === (orderNumber?.split(' / ')[0] || '')
            )
          : items;
        const allLocations: Location[] = inventoryData.map((i) => ({
          id: i.location_id || '',
          location: i.location || '',
          warehouse: i.warehouse as Location['warehouse'],
          zone: null,
          max_capacity: null,
          picking_order: null,
          is_active: true,
          created_at: '',
          length_ft: null,
          bike_line: null,
        }));
        const optimizedPath = getOptimizedPickingPath(mainCartItems, allLocations);
        const calculatedPallets = calculatePallets(optimizedPath);
        pallets_qty = calculatedPallets.length;
      }

      // Complete main order with its own metrics
      await processPickingList(activeListId!, pallets_qty, mainUnits);

      // Batch completion: complete sibling orders in the same group
      if (mainOrder?.group_id) {
        try {
          const COMPLETABLE_STATUSES = [
            'ready_to_double_check',
            'double_checking',
            'needs_correction',
          ];
          const { data: siblings } = await supabase
            .from('picking_lists')
            .select('id, items, status')
            .eq('group_id', mainOrder.group_id)
            .neq('id', activeListId!)
            .in('status', COMPLETABLE_STATUSES);

          if (siblings && siblings.length > 0) {
            // Copy pallet photos from main order to all siblings
            // (same R2 file, just the URL reference — zero extra storage)
            const { data: mainPhotos } = await supabase
              .from('picking_lists')
              .select('pallet_photos')
              .eq('id', activeListId!)
              .single();
            const photosArray = Array.isArray(mainPhotos?.pallet_photos)
              ? (mainPhotos.pallet_photos as string[])
              : [];
            if (photosArray.length > 0) {
              const siblingIds = siblings.map((s) => s.id);
              await supabase
                .from('picking_lists')
                .update({ pallet_photos: photosArray })
                .in('id', siblingIds);
            }

            for (const sibling of siblings) {
              const siblingItems = Array.isArray(sibling.items)
                ? (sibling.items as Array<{ pickingQty?: number }>)
                : [];
              const siblingUnits = siblingItems.reduce(
                (acc, item) => acc + (Number(item.pickingQty) || 0),
                0
              );

              // FedEx = 0 pallets, otherwise calculate per-order
              let sibPalletsQty = 0;
              if (!isFedexGroup) {
                const siblingCartItems = siblingItems as unknown as PickingItem[];
                const sibLocations: Location[] = inventoryData.map((i) => ({
                  id: i.location_id || '',
                  location: i.location || '',
                  warehouse: i.warehouse as Location['warehouse'],
                  zone: null,
                  max_capacity: null,
                  picking_order: null,
                  is_active: true,
                  created_at: '',
                  length_ft: null,
                  bike_line: null,
                }));
                const sibPath = getOptimizedPickingPath(siblingCartItems, sibLocations);
                sibPalletsQty = calculatePallets(sibPath).length;
              }

              await processPickingList(sibling.id, sibPalletsQty, siblingUnits);
            }
            toast.success(`Group completed (${siblings.length + 1} orders)`, {
              duration: 4000,
            });
          }
        } catch (groupErr) {
          console.error('Batch completion warning:', groupErr);
          toast.error('Some orders in the group could not be completed');
        }
      }

      resetSession();
      setIsOpen(false);
      return true;
    } catch (error: unknown) {
      console.error('Operation failed:', error);
      toast.error(error instanceof Error ? error.message : 'Deduction failed');
      throw error;
    } finally {
      setIsProcessingDeduction(false);
    }
  };

  // Visibility: only on home page in picking mode with active session, or externally triggered
  const hasActiveSession = sessionMode !== 'idle' || totalItems > 0;
  const isVisible =
    (pathname === '/' && viewMode === 'picking' && hasActiveSession) || !!externalDoubleCheckId;

  if (!isVisible) return null;

  return createPortal(
    <>
      {isOpen && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-main/60 backdrop-blur-md animate-in fade-in duration-200"
          onClick={handleReleaseOrder}
        >
          <div
            className="bg-surface border-subtle shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col fixed inset-0 w-full h-full rounded-none border-0"
            onClick={(e) => e.stopPropagation()}
          >
            <DoubleCheckView
              customer={customer ?? null}
              cartItems={cartItems}
              orderNumber={orderNumber ?? null}
              activeListId={activeListId ?? null}
              checkedItems={checkedItems}
              onToggleCheck={toggleCheck}
              onDeduct={handleDeduct}
              onReturnToPicker={(notes) => activeListId && returnToPicker(activeListId, notes)}
              isOwner={isOwner}
              notes={notes}
              isNotesLoading={isNotesLoading}
              onAddNote={addNote}
              onSelectAll={handleSelectAll}
              onPalletCountChange={(count) => {
                overriddenPalletCountRef.current = count;
              }}
              status={listStatus}
              isWaitingInventory={isWaitingInventory}
              onSetWaitingInventory={setIsWaitingInventory}
              onBack={() => setIsOpen(false)}
              onRelease={handleReleaseOrder}
              onClose={handleReleaseOrder}
              onCorrectItem={handleCorrectItem}
              inventoryData={inventoryData}
              onMarkAsReady={() => orderNumber && handleMarkAsReady(orderNumber)}
              onSendToVerifyQueue={handleSendToVerifyQueue}
              onRecomplete={async (items) => {
                if (!activeListId) return;
                isRecompletingRef.current = true;
                try {
                  const totalUnits = items.reduce((acc, item) => acc + (item.pickingQty || 0), 0);
                  const allLocations: Location[] = inventoryData.map((i) => ({
                    id: i.location_id || '',
                    location: i.location || '',
                    warehouse: i.warehouse as Location['warehouse'],
                    zone: null,
                    max_capacity: null,
                    picking_order: null,
                    is_active: true,
                    created_at: '',
                    length_ft: null,
                    bike_line: null,
                  }));
                  const path = getOptimizedPickingPath(items, allLocations);
                  const palletsQty = calculatePallets(path).length;
                  await recompletePickingList(activeListId, palletsQty, totalUnits);
                  resetSession();
                  setIsOpen(false);
                } finally {
                  isRecompletingRef.current = false;
                }
              }}
              onCancelReopen={async () => {
                if (!activeListId) return;
                await cancelReopen(activeListId);
                setIsOpen(false);
              }}
              correctionNotes={correctionNotes}
            />
          </div>
        </div>
      )}

      {/* Collapsed State - Floating Trigger instead of Mini Bar */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className={`fixed bottom-24 left-4 right-4 p-4 rounded-2xl shadow-2xl flex items-center justify-between gap-2 cursor-pointer active:scale-95 transition-all z-40 border border-white/10 ${
            sessionMode === 'double_checking' ? 'bg-orange-500 text-white' : 'bg-accent text-main'
          }`}
        >
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/10 rounded-xl">
              <ChevronUp size={20} className="animate-bounce" />
            </div>
            <div className="font-extrabold uppercase tracking-widest text-[10px] text-left">
              <span className="opacity-70 block mb-0.5">Active Session</span>
              <span className="text-xs">
                {sessionMode === 'double_checking'
                  ? `Verifying #${orderNumber || activeListId?.slice(-6).toUpperCase()}`
                  : `${totalQty} Units · #${orderNumber || 'NEW'}`}
              </span>
            </div>
          </div>
          {totalQty > 0 && (
            <div className="px-3 py-1 bg-black/20 rounded-full text-[10px] font-black">
              {totalQty} UNITS
            </div>
          )}
        </button>
      )}
    </>,
    document.body
  );
};
