import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import Search from 'lucide-react/dist/esm/icons/search';
import CheckCircle2 from 'lucide-react/dist/esm/icons/check-circle-2';
import Truck from 'lucide-react/dist/esm/icons/truck';
import MessageSquare from 'lucide-react/dist/esm/icons/message-square';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right';
import MapPin from 'lucide-react/dist/esm/icons/map-pin';
import Check from 'lucide-react/dist/esm/icons/check';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import { orderColorFor } from '../../utils/orderColors';

export const DemoJul17 = () => {
  const [activeTab, setActiveTab] = useState<'labels' | 'doublecheck' | 'liveboard'>('labels');
  
  // Real info state
  const [realSku, setRealSku] = useState<Record<string, unknown> | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Active double check order
  const [activeOrder, setActiveOrder] = useState<number | null>(null);
  
  // Fetch real data on mount
  useEffect(() => {
    async function fetchData() {
      try {
        const { data: items } = await supabase
          .from('inventory')
          .select('*')
          .ilike('sku', '%S/D%')
          .limit(1);
        if (items && items.length > 0) {
          setRealSku(items[0]);
        }
      } catch (err) {
        console.error("Demo fetch error", err);
      }
    }
    fetchData();
  }, []);

  return (
    <div className="flex h-screen bg-main font-body text-main overflow-hidden">
      
      {/* Sidebar - Using Glassmorphism and their tokens */}
      <div className="w-[300px] shrink-0 border-r border-subtle bg-surface/50 backdrop-blur-xl flex flex-col z-20">
        <div className="p-8 pb-4">
          <div className="text-[10px] font-black tracking-widest text-muted mb-3 opacity-60">P I C K D · W A R E H O U S E</div>
          <h1 className="text-3xl font-heading font-black tracking-tight leading-none text-main mb-2">Jul 17<br/>Updates</h1>
        </div>
        
        <nav className="flex-1 px-4 space-y-3 mt-6">
          <button 
            onClick={() => setActiveTab('labels')}
            className={`w-full text-left px-5 py-4 rounded-2xl font-bold transition-all flex items-center gap-4 group ${
              activeTab === 'labels' 
                ? 'bg-accent text-white shadow-[0_4px_20px_-4px_var(--accent-primary)] scale-[1.02]' 
                : 'text-muted hover:bg-surface border border-transparent hover:border-subtle hover:text-main'
            }`}
          >
            <div className={`p-2 rounded-xl transition-colors ${activeTab === 'labels' ? 'bg-white/20' : 'bg-surface shadow-sm border border-subtle group-hover:border-accent/30'}`}>
              <Search size={18} />
            </div>
            Label Studio
          </button>
          
          <button 
            onClick={() => setActiveTab('doublecheck')}
            className={`w-full text-left px-5 py-4 rounded-2xl font-bold transition-all flex items-center gap-4 group ${
              activeTab === 'doublecheck' 
                ? 'bg-accent text-white shadow-[0_4px_20px_-4px_var(--accent-primary)] scale-[1.02]' 
                : 'text-muted hover:bg-surface border border-transparent hover:border-subtle hover:text-main'
            }`}
          >
            <div className={`p-2 rounded-xl transition-colors ${activeTab === 'doublecheck' ? 'bg-white/20' : 'bg-surface shadow-sm border border-subtle group-hover:border-accent/30'}`}>
              <CheckCircle2 size={18} />
            </div>
            Double Check
          </button>
          
          <button 
            onClick={() => setActiveTab('liveboard')}
            className={`w-full text-left px-5 py-4 rounded-2xl font-bold transition-all flex items-center gap-4 group ${
              activeTab === 'liveboard' 
                ? 'bg-accent text-white shadow-[0_4px_20px_-4px_var(--accent-primary)] scale-[1.02]' 
                : 'text-muted hover:bg-surface border border-transparent hover:border-subtle hover:text-main'
            }`}
          >
            <div className={`p-2 rounded-xl transition-colors ${activeTab === 'liveboard' ? 'bg-white/20' : 'bg-surface shadow-sm border border-subtle group-hover:border-accent/30'}`}>
              <Truck size={18} />
            </div>
            Live Board
          </button>
        </nav>
        
        <div className="p-8 border-t border-subtle mt-auto">
          <div className="ios-glass p-4 rounded-2xl flex flex-col gap-2">
            <div className="text-xs font-bold text-main">Interactive Demo</div>
            <div className="text-[11px] text-muted leading-relaxed">Built exactly like Pickd, using native styles and DB.</div>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col relative bg-main overflow-hidden">
        
        {/* LABELS SCREEN */}
        {activeTab === 'labels' && (
          <div className="h-full flex flex-col animate-in fade-in zoom-in-95 duration-400">
            <div className="px-10 py-6 border-b border-subtle bg-surface/80 backdrop-blur-md z-10 sticky top-0">
              <h2 className="font-heading font-black text-2xl tracking-tight">Label Studio & Global Search</h2>
              <p className="text-muted text-sm mt-1">Instant server-side search. Zero 1000-row limits.</p>
            </div>
            
            <div className="p-10 flex-1 overflow-y-auto">
              <div className="max-w-3xl mx-auto space-y-6">
                
                {/* Search Box mimicking Pickd UI */}
                <div className="bg-surface rounded-[var(--radius-ios)] shadow-ios border border-subtle p-8 transition-all">
                  <h3 className="text-[10px] font-black text-muted mb-4 uppercase tracking-widest">Global SKU Search</h3>
                  
                  <div className="relative group">
                    <input 
                      type="text" 
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full pl-12 pr-4 py-4 bg-main border border-subtle rounded-2xl focus:ring-2 focus:ring-accent focus:border-accent outline-none font-mono text-sm transition-all shadow-inner group-hover:border-muted/30" 
                      placeholder="Search SKU (e.g. 2419 or S/D)..."
                    />
                    <div className="absolute left-4 top-4 text-muted transition-colors group-focus-within:text-accent">
                      <Search size={22} />
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-6 mt-6 text-sm text-muted">
                    <label className="flex items-center gap-2 opacity-50 cursor-not-allowed"><input type="checkbox" checked disabled className="accent-accent scale-110" /> Bikes</label>
                    <label className="flex items-center gap-2 opacity-50 cursor-not-allowed"><input type="checkbox" disabled className="accent-accent scale-110" /> Parts</label>
                    <label className="flex items-center gap-2 opacity-50 cursor-not-allowed"><input type="checkbox" disabled className="accent-accent scale-110" /> S/D</label>
                    <span className="text-xs text-accent font-bold ml-auto px-3 py-1 bg-accent/10 rounded-full">Checkboxes bypassed during search</span>
                  </div>
                </div>
                
                {searchQuery.length >= 2 && (
                  <div className="bg-surface rounded-[var(--radius-ios)] shadow-ios border border-subtle overflow-hidden animate-in slide-in-from-bottom-4 duration-300">
                    <div className="bg-accent/5 border-b border-subtle px-6 py-3 flex items-center gap-3">
                       <div className="w-2 h-2 rounded-full bg-accent animate-pulse"></div>
                       <span className="text-xs font-black text-accent uppercase tracking-widest">Server Response</span>
                    </div>
                    
                    {realSku && (searchQuery.toLowerCase().includes('s/d') || searchQuery.toLowerCase().includes('2419') || searchQuery.toLowerCase().includes(String(realSku.sku).toLowerCase())) ? (
                      <div className="p-6 flex items-center justify-between hover:bg-main/50 transition-colors cursor-pointer group">
                        <div className="flex gap-6 items-center">
                          <div className="w-16 h-16 rounded-2xl bg-main border border-subtle flex flex-col items-center justify-center shadow-inner">
                            <span className="text-[10px] font-black text-muted tracking-widest">SKU</span>
                          </div>
                          <div>
                            <div className="font-bold text-lg font-mono text-main mb-1">{String(realSku.sku)}</div>
                            <div className="font-semibold text-muted text-sm">{String(realSku.item_name) || 'Bicycle (S/D)'}</div>
                            
                            <div className="flex gap-2 mt-3">
                              <span className="bg-main border border-subtle px-2.5 py-1 rounded-lg text-[11px] font-bold text-muted">M: {String(realSku.model) || 'Unknown'}</span>
                              <span className="bg-main border border-subtle px-2.5 py-1 rounded-lg text-[11px] font-bold text-muted">Sz: {String(realSku.size) || 'N/A'}</span>
                              <span className="bg-main border border-subtle px-2.5 py-1 rounded-lg text-[11px] font-bold text-main font-mono">SN: {String(realSku.serial_number) || 'N/A'}</span>
                            </div>
                          </div>
                        </div>
                        <button className="bg-surface border-2 border-subtle text-main group-hover:border-accent group-hover:bg-accent group-hover:text-white px-5 py-2.5 rounded-xl font-bold text-xs uppercase tracking-widest transition-all shadow-sm active:scale-95">
                          Print Label
                        </button>
                      </div>
                    ) : (
                      <div className="p-12 text-center text-muted font-bold animate-pulse flex flex-col items-center gap-3">
                        <Loader2 className="animate-spin text-subtle w-8 h-8" />
                        Fetching from DB...
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
        
        {/* DOUBLE CHECK SCREEN */}
        {activeTab === 'doublecheck' && (
          <div className="h-full flex flex-col animate-in fade-in zoom-in-95 duration-400">
             <div className="px-10 py-6 border-b border-subtle bg-surface/80 backdrop-blur-md z-10 sticky top-0 flex items-center gap-4">
               <div className="h-10 w-10 rounded-2xl bg-accent/10 text-accent flex items-center justify-center"><CheckCircle2 size={20} /></div>
               <div>
                 <h2 className="font-heading font-black text-2xl tracking-tight">Double Check Focus</h2>
                 <p className="text-muted text-sm mt-1">Click an order number to filter the items view.</p>
               </div>
            </div>
            
            <div className="flex-1 bg-main flex flex-col relative overflow-hidden">
              
              {/* Filter Header using actual Pickd style logic */}
              <div className="bg-surface border-b border-subtle px-10 py-5 flex items-center gap-4 shadow-sm z-10 sticky top-0">
                <div className="text-[10px] font-black text-muted tracking-widest mr-2 uppercase">Orders</div>
                
                {[
                  { id: 214, qty: 2, color: orderColorFor('214', ['214', '240']).hex },
                  { id: 240, qty: 1, color: orderColorFor('240', ['214', '240']).hex }
                ].map((order) => {
                  const isActive = activeOrder === order.id;
                  const isFaded = activeOrder !== null && activeOrder !== order.id;
                  
                  return (
                    <button 
                      key={order.id}
                      onClick={() => setActiveOrder(isActive ? null : order.id)}
                      style={isActive ? { backgroundColor: order.color, color: 'white', borderColor: order.color } : {}}
                      className={`px-5 py-2.5 rounded-[var(--radius-ios)] transition-all flex flex-col items-center relative overflow-hidden border-2
                        ${isActive ? 'shadow-[0_4px_15px_-3px_rgba(0,0,0,0.2)] transform scale-[1.05] animate-pulse z-20' : ''}
                        ${isFaded ? 'opacity-40 bg-surface border-subtle' : 'bg-surface border-subtle text-main hover:border-muted/30'}
                      `}
                    >
                      <div className="font-bold font-mono text-xl z-10 tracking-tight">·{order.id}</div>
                      <div className="text-[10px] font-black uppercase tracking-widest z-10 opacity-80 mt-1">Qty: {order.qty}</div>
                    </button>
                  );
                })}
              </div>
              
              {/* Item List mimicking actual DoubleCheckView cards */}
              <div className="p-10 flex-1 overflow-y-auto space-y-4 max-w-4xl mx-auto w-full">
                {[
                  { oid: 214, name: 'RENEGADE S3', sku: '03-0144-58' },
                  { oid: 240, name: 'CODA S2 - 15"', sku: '03-0551-15' },
                  { oid: 214, name: 'PEDALS', sku: '22-1000' }
                ].map((item, idx) => {
                  const isVisible = activeOrder === null || activeOrder === item.oid;
                  if (!isVisible) return null;
                  
                  const color = orderColorFor(item.oid === 214 ? '214' : '240', ['214', '240']).hex;
                  return (
                    <div key={idx} className="bg-surface p-5 rounded-[var(--radius-ios)] shadow-ios border border-subtle flex items-center gap-6 transition-all duration-300 animate-in slide-in-from-bottom-4 relative overflow-hidden">
                      <div className="absolute left-0 top-0 bottom-0 w-2" style={{ backgroundColor: color }}></div>
                      
                      <div className="w-16 h-16 bg-main rounded-2xl flex items-center justify-center font-black text-muted text-[10px] tracking-widest border border-subtle shadow-inner">
                        IMG
                      </div>
                      <div className="flex-1">
                        <div className="font-heading font-black text-xl text-main mb-1">{item.name}</div>
                        <div className="text-sm text-muted font-mono bg-main inline-block px-3 py-1 rounded-lg border border-subtle">{item.sku}</div>
                      </div>
                      
                      <div className="font-mono font-bold text-2xl px-4" style={{ color }}>·{item.oid}</div>
                      
                      <button className="w-14 h-14 rounded-full bg-main border-2 border-subtle flex items-center justify-center ml-4 hover:border-accent hover:text-accent transition-all text-muted shadow-sm">
                        <Check size={24} strokeWidth={3} />
                      </button>
                    </div>
                  );
                })}
              </div>
              
              <div className="bg-surface border-t border-subtle px-10 py-6 sticky bottom-0 flex justify-between items-center backdrop-blur-xl bg-surface/90">
                <div className="text-[11px] font-black text-muted uppercase tracking-widest">2 / 3 Verified</div>
                <button className="bg-main border-2 border-subtle text-main hover:border-accent hover:text-accent px-8 py-4 rounded-2xl font-black text-sm tracking-widest uppercase shadow-sm transition-all flex items-center gap-3 active:scale-95 group">
                  <MapPin size={18} className="group-hover:animate-bounce" /> Assign Pickup
                </button>
              </div>
            </div>
          </div>
        )}
        
        {/* LIVE BOARD SCREEN */}
        {activeTab === 'liveboard' && (
          <div className="h-full flex flex-col animate-in fade-in zoom-in-95 duration-400">
            <div className="px-10 py-6 border-b border-subtle bg-surface/80 backdrop-blur-md z-10 sticky top-0 flex items-center justify-between">
              <div>
                <h2 className="font-heading font-black text-2xl tracking-tight">Live Board</h2>
                <p className="text-muted text-sm mt-1">Real-time status and filtering.</p>
              </div>
              
              <div className="flex items-center bg-main p-1.5 rounded-[var(--radius-ios)] border border-subtle shadow-inner">
                 <button className="px-5 py-2 rounded-[12px] bg-surface shadow-sm border border-subtle text-xs font-black text-main uppercase tracking-widest">All</button>
                 <button className="px-5 py-2 rounded-[12px] text-xs font-bold text-muted hover:text-main uppercase tracking-widest transition-colors">FedEx</button>
                 <button className="px-5 py-2 rounded-[12px] text-xs font-bold text-muted hover:text-main uppercase tracking-widest transition-colors">Regular</button>
              </div>
            </div>
            
            <div className="p-10 flex-1 overflow-y-auto">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-5xl mx-auto">
                <div>
                  <h3 className="text-[11px] font-black text-muted uppercase tracking-widest mb-6 flex items-center justify-between">
                    Pulling 
                    <span className="bg-surface border border-subtle text-main px-3 py-1 rounded-full shadow-sm">1</span>
                  </h3>
                  
                  {/* Pickd Card UI */}
                  <div className="bg-surface border border-subtle rounded-[var(--radius-squircle)] p-6 shadow-ios relative overflow-hidden group">
                    <div className="absolute top-0 left-0 right-0 h-1 bg-accent"></div>
                    
                    <div className="flex justify-between items-start mb-4 mt-2">
                      <div className="font-bold text-2xl font-mono text-main tracking-tight">#880214</div>
                      <div className="text-[10px] font-black uppercase tracking-widest bg-main border border-subtle text-main px-3 py-1.5 rounded-lg shadow-sm">FedEx</div>
                    </div>
                    
                    <div className="text-sm font-semibold text-muted mb-5">Jamis Bikes - 3 items</div>
                    
                    {/* The Note mimicking Pickd meaningfulNote logic */}
                    <div className="bg-[#fffbeb] border border-[#fde68a] rounded-[var(--radius-ios)] p-4 mb-5 flex items-start gap-3 shadow-inner">
                      <div className="text-[#d97706] mt-0.5 bg-[#fef3c7] p-1.5 rounded-lg"><MessageSquare size={16} strokeWidth={3} /></div>
                      <div className="text-sm text-[#92400e] font-bold leading-snug">Please include extra bolts for assembly. Urgent!</div>
                    </div>
                    
                    <div className="flex items-center gap-4 mt-6">
                      <div className="flex-1 bg-main border border-subtle h-3 rounded-full overflow-hidden shadow-inner relative">
                         <div className="bg-accent w-1/3 h-full rounded-full absolute left-0 top-0 bottom-0 shadow-[0_0_10px_rgba(16,185,129,0.5)]"></div>
                      </div>
                      <div className="text-xs font-black text-muted font-mono tracking-widest">1/3</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
