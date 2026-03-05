import React, { useState, useRef, useEffect } from 'react';
import Package from 'lucide-react/dist/esm/icons/package';
import Truck from 'lucide-react/dist/esm/icons/truck';
import ArrowRight from 'lucide-react/dist/esm/icons/arrow-right';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2';
import Minus from 'lucide-react/dist/esm/icons/minus';
import Plus from 'lucide-react/dist/esm/icons/plus';
import { usePickingSession } from '../../../context/PickingContext';
import { CustomerAutocomplete } from './CustomerAutocomplete';
import { useAutoSelect } from '../../../hooks/useAutoSelect';
import toast from 'react-hot-toast';

// Define Interface for Cart Items matches PickingSessionView definition
import { type CartItem } from '../../../hooks/picking/usePickingCart';

interface OrderBuilderModeProps {
    cartItems: CartItem[];
    onGeneratePath: () => void;
}

export const OrderBuilderMode: React.FC<OrderBuilderModeProps> = ({ cartItems, onGeneratePath }) => {
    const { removeFromCart, updateCartQty, setCartQty, isSaving, customer, setCustomer } = usePickingSession();
    const autoSelect = useAutoSelect();

    const [editingIndex, setEditingIndex] = useState<number | null>(null);
    const [editingQuantity, setEditingQuantity] = useState<string>('');
    const inputRef = useRef<HTMLInputElement>(null);

    // Focus input when editing starts
    useEffect(() => {
        if (editingIndex !== null && inputRef.current) {
            inputRef.current.focus();
            inputRef.current.select();
        }
    }, [editingIndex]);

    const handleQuantityClick = (index: number, currentQty: number | undefined) => {
        setEditingIndex(index);
        setEditingQuantity((currentQty || 0).toString());
    };

    const handleQuantitySubmit = (item: CartItem) => {
        const newQty = parseInt(editingQuantity, 10);
        const maxStock = typeof item.quantity === 'string' ? parseInt(item.quantity, 10) : item.quantity;

        if (isNaN(newQty) || newQty < 0) {
            toast.error('Please enter a valid quantity');
            setEditingQuantity(item.pickingQty?.toString() || '0');
        } else if (newQty > maxStock) {
            toast.error(`Cannot exceed stock of ${maxStock}`);
            setCartQty(item, maxStock);
        } else if (newQty === 0) {
            removeFromCart(item);
        } else {
            setCartQty(item, newQty);
        }
        setEditingIndex(null);
    };

    const handleQuantityKeyDown = (e: React.KeyboardEvent, item: CartItem) => {
        if (e.key === 'Enter') {
            handleQuantitySubmit(item);
        } else if (e.key === 'Escape') {
            setEditingIndex(null);
            setEditingQuantity(item.pickingQty?.toString() || '0');
        }
    };

    if (cartItems.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center p-8 text-center h-64 text-slate-400">
                <Package className="w-12 h-12 mb-3 opacity-20" />
                <p className="text-sm font-medium">Your cart is empty</p>
                <p className="text-xs mt-1">Add items from inventory to build your order</p>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full bg-card">
            {/* Header / Instructions */}
            <div className="px-4 py-3 bg-surface border-b border-subtle">
                <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3 mb-1">
                        <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
                            <span className="text-blue-600 text-sm font-bold">1</span>
                        </div>
                        <div>
                            <h3 className="text-sm font-bold text-content">Build Your Order</h3>
                            <p className="text-[10px] text-muted">
                                Add all items you need, then generate the picking path.
                            </p>
                        </div>
                    </div>
                </div>

                <div className="mt-3">
                    <CustomerAutocomplete
                        value={customer}
                        onChange={setCustomer}
                        placeholder="Customer / Company Name (Optional)"
                        className="w-full"
                    />
                </div>
            </div>

            {/* Simple List of Items */}
            <div className="flex-1 overflow-y-auto p-3 space-y-2 min-h-0">
                {cartItems.map((item, index) => (
                    <div
                        key={`${item.sku}-${index}`}
                        className="flex items-center justify-between bg-surface p-3 rounded-lg border border-subtle shadow-sm animate-in fade-in slide-in-from-bottom-2"
                    >
                        <div className="flex-1 mr-4">
                            <div className="flex items-center gap-3 mb-1">
                                <span className="flex-shrink-0 w-6 h-6 rounded bg-card text-muted text-xs font-bold flex items-center justify-center border border-subtle">
                                    {index + 1}
                                </span>
                                <div className="text-sm font-bold text-content">{item.sku}</div>
                            </div>
                            <div className="flex items-center gap-2 pl-9">
                                {item.warehouse && (
                                    <span className="text-[10px] border px-1 rounded text-slate-400">
                                        {item.warehouse}
                                    </span>
                                )}
                                {item.sku_note && (
                                    <span className="bg-yellow-50 text-yellow-700 px-1 rounded border border-yellow-100 text-[10px] truncate max-w-[120px]">
                                        {item.sku_note}
                                    </span>
                                )}
                                {item.sku_metadata && (item.sku_metadata.length_in || item.sku_metadata.width_in || item.sku_metadata.height_in) && (
                                    <span className="hidden md:inline-block bg-accent/5 text-accent/70 text-[9px] px-1 rounded border border-accent/10 font-bold whitespace-nowrap">
                                        {item.sku_metadata.length_in || 0} x {item.sku_metadata.width_in || 0} x {item.sku_metadata.height_in || 0} in
                                    </span>
                                )}
                            </div>
                        </div>

                        <div className="flex items-center gap-3">
                            <div className="flex items-center bg-card rounded-lg p-0.5 border border-subtle">
                                <button
                                    onClick={() => updateCartQty(item, -1)}
                                    className="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-slate-700 active:bg-slate-200 rounded transition-colors"
                                >
                                    <Minus size={14} />
                                </button>
                                {editingIndex === index ? (
                                    <input
                                        ref={inputRef}
                                        type="number"
                                        value={editingQuantity}
                                        onChange={(e) => setEditingQuantity(e.target.value)}
                                        onBlur={() => handleQuantitySubmit(item)}
                                        onKeyDown={(e) => handleQuantityKeyDown(e, item)}
                                        {...autoSelect}
                                        className="w-10 text-center font-bold text-content text-sm bg-accent/10 border border-accent rounded focus:outline-none focus:ring-2 focus:ring-accent"
                                        min="0"
                                    />
                                ) : (
                                    <div
                                        onClick={() => handleQuantityClick(index, item.pickingQty)}
                                        className="w-10 text-center font-bold text-content text-sm cursor-pointer hover:bg-accent/10 rounded transition-colors py-1"
                                    >
                                        {item.pickingQty}
                                    </div>
                                )}
                                <button
                                    onClick={() => updateCartQty(item, 1)}
                                    className="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-slate-700 active:bg-slate-200 rounded transition-colors"
                                >
                                    <Plus size={14} />
                                </button>
                            </div>

                            <button
                                onClick={() => removeFromCart(item)}
                                className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                            >
                                <Trash2 className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                ))}
            </div>

            {/* Actions Footer */}
            <div className="p-4 bg-surface border-t border-subtle shadow-lg z-20 shrink-0">
                <div className="flex items-center justify-between mb-3 text-xs text-muted font-medium">
                    <span>{cartItems.length} SKUs selected</span>
                    <span>Total Units: {cartItems.reduce((acc, i) => acc + (i.pickingQty || 0), 0)}</span>
                </div>

                <button
                    onClick={onGeneratePath}
                    disabled={isSaving}
                    className="w-full bg-accent hover:bg-accent/90 text-white font-bold py-3.5 px-4 rounded-xl shadow-lg shadow-accent/20 active:scale-[0.98] transition-all flex items-center justify-center gap-2 group disabled:opacity-70 disabled:cursor-not-allowed"
                >
                    {isSaving ? (
                        <>
                            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            <span>Checking Availability...</span>
                        </>
                    ) : (
                        <>
                            <Truck className="w-4 h-4" />
                            <span>Start Picking</span>
                            <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform opacity-60" />
                        </>
                    )}
                </button>
                <p className="text-[9px] text-center text-muted mt-2">
                    Reserves stock & optimizes route immediately.
                </p>
            </div>
        </div>
    );
};
