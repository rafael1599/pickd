import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import ChevronUp from 'lucide-react/dist/esm/icons/chevron-up';
import { PickingSessionView } from './PickingSessionView';
import { DoubleCheckView, PickingItem } from './DoubleCheckView';
import { useAuth } from '../../../context/AuthContext';
import { useConfirmation } from '../../../context/ConfirmationContext';
import { usePickingSession } from '../../../context/PickingContext';
import { useViewMode } from '../../../context/ViewModeContext';
import { useInventory } from '../../inventory/hooks/InventoryProvider';
import { getOptimizedPickingPath, calculatePallets } from '../../../utils/pickingLogic';
import toast from 'react-hot-toast';


export const PickingCartDrawer: React.FC = () => {
    const { user } = useAuth();
    const { showConfirmation } = useConfirmation();
    const {
        externalDoubleCheckId,
        setExternalDoubleCheckId,
    } = useViewMode();

    const {
        cartItems,
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
        setOrderNumber,
        updateCustomerDetails,
        updateCartQty,
        removeFromCart,
        notes,
        isNotesLoading,
        addNote,
        returnToBuilding,
        deleteList,
        resetSession,
        listStatus,
    } = usePickingSession();

    const { inventoryData, processPickingList } = useInventory();

    const [isOpen, setIsOpen] = useState(false);
    const [currentView, setCurrentView] = useState('double-check');
    const [checkedItems, setCheckedItems] = useState<Set<string>>(new Set());
    const isOwner = user?.id === ownerId;
    const isConfirmingRef = React.useRef(false);
    const [isProcessingDeduction, setIsProcessingDeduction] = useState(false);

    const totalItems = cartItems.length;
    const totalQty = cartItems.reduce((acc, item) => acc + (item.pickingQty || 0), 0);

    // 0. Restore state on load if already in double-check session
    useEffect(() => {
        if (sessionMode === 'double_checking' && activeListId) {
            setCurrentView('double-check');
            const savedProgress = localStorage.getItem(`double_check_progress_${activeListId}`);
            if (savedProgress) {
                try {
                    setCheckedItems(new Set(JSON.parse(savedProgress)));
                } catch (e) { }
            }
        } else if (sessionMode === 'building') {
            setCurrentView('picking');
            setCheckedItems(new Set());
        } else if (sessionMode === 'picking') {
            setCurrentView('double-check');
        }
    }, [sessionMode, activeListId]);

    // 1. Auto-close if completed from elsewhere
    useEffect(() => {
        if (listStatus === 'completed' && isOpen) {
            setIsOpen(false);
            resetSession();
        }
    }, [listStatus, isOpen, resetSession]);

    // 1. Handle External Trigger (from Header)
    useEffect(() => {
        if (externalDoubleCheckId) {
            console.log('🔄 [PickingCartDrawer] External trigger detected:', externalDoubleCheckId);
            const startDoubleCheck = async () => {
                try {
                    console.log('📦 [PickingCartDrawer] Loading external list...');
                    const list = await loadExternalList(String(externalDoubleCheckId));
                    console.log('📋 [PickingCartDrawer] List loaded:', list?.id, 'User:', user?.id);

                    if (list && user) {
                        // Check for takeover
                        if (list.checked_by && list.checked_by !== user.id) {
                            console.log('⚠️ [PickingCartDrawer] Takeover required for list:', list.id);
                            isConfirmingRef.current = true;
                            showConfirmation(
                                'Takeover Order',
                                `This order is currently being checked by another user. Do you want to take over?`,
                                async () => {
                                    console.log('⚔️ [PickingCartDrawer] confirmed takeover');
                                    await lockForCheck(String(externalDoubleCheckId));
                                    const savedProgress = localStorage.getItem(`double_check_progress_${externalDoubleCheckId}`);
                                    if (savedProgress) setCheckedItems(new Set(JSON.parse(savedProgress)));
                                    else setCheckedItems(new Set());
                                    setCurrentView('double-check');
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

                        const savedProgress = localStorage.getItem(`double_check_progress_${externalDoubleCheckId}`);
                        if (savedProgress) {
                            try {
                                setCheckedItems(new Set(JSON.parse(savedProgress)));
                            } catch (e) {
                                setCheckedItems(new Set());
                            }
                        } else {
                            setCheckedItems(new Set());
                        }

                        console.log('🔓 [PickingCartDrawer] Opening drawer for double check');
                        setCurrentView('double-check');
                        setIsOpen(true);
                        setExternalDoubleCheckId(null);
                    } else {
                        console.error('❌ [PickingCartDrawer] List or User missing. List:', !!list, 'User:', !!user);
                    }
                } catch (err) {
                    console.error('💥 [PickingCartDrawer] Error in startDoubleCheck:', err);
                }
            };
            startDoubleCheck();
        }
    }, [externalDoubleCheckId, user, loadExternalList, lockForCheck, setExternalDoubleCheckId, showConfirmation]);

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
        const listId = await markAsReady(cartItems as any, finalOrderNumber);
        if (listId) {
            setCheckedItems(new Set()); // Reset progress for new verification
            setCurrentView('double-check');
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
        const allLocations = inventoryData.map(i => ({
            id: (i as any).location_id || '',
            location: i.location || '',
            warehouse: i.warehouse as any,
            picking_order: (i as any).picking_order || 0
        })) as any;

        const path = getOptimizedPickingPath(cartItems as any, allLocations);
        const pallets = calculatePallets(path);

        const newChecked = new Set<string>();
        pallets.forEach(p => {
            p.items.forEach(item => {
                const key = `${p.id}-${item.sku}-${item.location}`;
                newChecked.add(key);
            });
        });

        setCheckedItems(newChecked);
    };

    const handleDeduct = async (items: PickingItem[], isVerified: boolean) => {
        if (isProcessingDeduction) return false;
        setIsProcessingDeduction(true);

        try {
            if (!isVerified) {
                // Rule: All-or-nothing verification. 
                await releaseCheck(activeListId!);
                toast('Order released to queue (No deduction made)', {
                    icon: '📋',
                    duration: 4000,
                });
                return true;
            }

            // Calculate final metrics before completing
            const totalUnits = items.reduce((acc: number, item: any) => acc + (item.pickingQty || 0), 0);

            // Re-map locations for path optimization
            const allLocations = inventoryData.map(i => ({
                id: (i as any).location_id || '',
                location: i.location || '',
                warehouse: i.warehouse as any,
                picking_order: (i as any).picking_order || 0
            })) as any;

            const optimizedPath = getOptimizedPickingPath(items as any, allLocations);
            const calculatedPallets = calculatePallets(optimizedPath);
            const pallets_qty = calculatedPallets.length;

            await processPickingList(
                activeListId!,
                pallets_qty,
                totalUnits
            );

            resetSession();
            setIsOpen(false);
            return true;
        } catch (error: any) {
            console.error('Operation failed:', error);
            toast.error(error.message || 'Deduction failed');
            throw error;
        } finally {
            setIsProcessingDeduction(false);
        }
    };

    // Visibility logic:
    // 1. If we have an external trigger (Verification Queue order selected)
    // 2. If we are in an active session (picking/building or double_checking) - NOT 'idle'
    // 3. If the cart has items
    const isVisible = !!externalDoubleCheckId || (sessionMode && sessionMode !== 'idle') || totalItems > 0;

    if (!isVisible) return null;

    return createPortal(
        <>
            {isOpen && (
                <div
                    className="fixed inset-0 z-[100010] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-in fade-in duration-200"
                    onClick={() => {
                        if (sessionMode === 'double_checking' && activeListId) {
                            releaseCheck(activeListId);
                        }
                        setIsOpen(false);
                    }}
                >
                    <div
                        className={`bg-surface border-subtle shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col ${currentView === 'double-check'
                            ? 'fixed inset-0 w-full h-full rounded-none border-0' // Full screen for Double Check
                            : 'w-full max-w-2xl h-[90dvh] rounded-3xl border'     // Card/Modal for Picking
                            }`}
                        onClick={(e) => e.stopPropagation()}
                    >
                        {currentView === 'picking' ? (
                            <PickingSessionView
                                activeListId={activeListId ?? null}
                                orderNumber={orderNumber ?? null}
                                customer={customer ?? null}
                                onUpdateOrderNumber={setOrderNumber}
                                onUpdateCustomer={(details) => {
                                    if (customer?.id) updateCustomerDetails(customer.id, details);
                                }}
                                cartItems={cartItems as any}
                                correctionNotes={correctionNotes}
                                notes={notes as any}
                                isNotesLoading={isNotesLoading}
                                onGoToDoubleCheck={handleMarkAsReady as any}
                                onUpdateQty={updateCartQty}
                                onRemoveItem={removeFromCart}
                                onClose={() => setIsOpen(false)}
                                onDelete={deleteList}
                            />
                        ) : (
                            <DoubleCheckView
                                customer={customer ?? null}
                                cartItems={cartItems as any}
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
                                status={listStatus}
                                onBack={async () => {
                                    await returnToBuilding(activeListId ?? null);
                                }}
                                onRelease={() => {
                                    if (activeListId) {
                                        releaseCheck(activeListId);
                                        setIsOpen(false);
                                    }
                                }}
                                onClose={() => {
                                    if (sessionMode === 'double_checking' && activeListId) releaseCheck(activeListId);
                                    setIsOpen(false);
                                }}
                            />
                        )}
                    </div>
                </div >
            )
            }

            {/* Collapsed State - Floating Trigger instead of Mini Bar */}
            {
                !isOpen && (
                    <button
                        onClick={() => setIsOpen(true)}
                        className={`fixed bottom-24 left-4 right-4 p-4 rounded-2xl shadow-2xl flex items-center justify-between gap-2 cursor-pointer active:scale-95 transition-all z-[9999] border border-white/10 ${sessionMode === 'double_checking'
                            ? 'bg-orange-500 text-white'
                            : sessionMode === 'building'
                                ? 'bg-slate-800 text-white border-slate-700'
                                : 'bg-accent text-main'
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
                                        : sessionMode === 'building'
                                            ? `Reviewing ${totalItems} SKUs`
                                            : `${totalQty} Units to Pick`}
                                </span>
                            </div>
                        </div>
                        {totalQty > 0 && (
                            <div className="px-3 py-1 bg-black/20 rounded-full text-[10px] font-black">
                                {totalQty} UNITS
                            </div>
                        )}
                    </button>
                )
            }
        </>,
        document.body
    );
};
