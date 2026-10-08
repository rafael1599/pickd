import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePalletDims } from '../usePalletDims';
import type { PalletDimsEntry } from '../../../../utils/palletDims';

// Mock de Supabase para usePalletDims
type RealtimeCallback = (payload: { new: Record<string, unknown> }) => void;
let realtimeListener: RealtimeCallback | null = null;
let currentDbDims: PalletDimsEntry[] = [];
const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];

const mockChannel = {
  on: vi.fn((_event: string, _opts: unknown, cb: RealtimeCallback) => {
    realtimeListener = cb;
    return mockChannel;
  }),
  subscribe: vi.fn().mockReturnThis(),
};

const mockRpc = vi.fn((name: string, args: Record<string, unknown>) => {
  rpcCalls.push({ name, args });
  // Simulación fiel de la lógica de patch_shipment_pallet en PostgreSQL:
  // 1. Bloqueo y lectura
  // 2. Fusión elem || p_patch
  // 3. Forzar units = sum(items) si hay items
  const palletId = args.p_pallet as number;
  const patch = args.p_patch as Record<string, unknown>;

  let found = false;
  const updated = currentDbDims.map((elem) => {
    if (elem.pallet === palletId) {
      found = true;
      const merged: PalletDimsEntry = {
        ...elem,
        ...patch,
        pallet: palletId,
      };
      if (Array.isArray(merged.items) && merged.items.length > 0) {
        merged.units = merged.items.reduce((sum, item) => sum + (Number(item?.qty) || 0), 0);
      }
      return merged;
    }
    return elem;
  });

  if (!found) {
    const newEntry: PalletDimsEntry = {
      pallet: palletId,
      units: 0,
      length_in: null,
      width_in: null,
      height_in: null,
      ...patch,
    };
    if (Array.isArray(newEntry.items) && newEntry.items.length > 0) {
      newEntry.units = newEntry.items.reduce((sum, item) => sum + (Number(item?.qty) || 0), 0);
    }
    updated.push(newEntry);
  }

  updated.sort((a, b) => a.pallet - b.pallet);
  currentDbDims = updated;
  return Promise.resolve({ data: currentDbDims, error: null });
});

const mockRemoveChannel = vi.fn();

vi.mock('../../../../lib/supabase', () => ({
  supabase: {
    from: vi.fn((table: string) => {
      if (table === 'pallet_events') {
        return {
          upsert: vi.fn().mockResolvedValue({ error: null }),
        };
      }
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn().mockImplementation(() =>
              Promise.resolve({
                data: { pallet_dims: currentDbDims },
                error: null,
              })
            ),
          })),
        })),
      };
    }),
    rpc: (name: string, args: Record<string, unknown>) => mockRpc(name, args),
    channel: vi.fn(() => mockChannel),
    removeChannel: (ch: unknown) => mockRemoveChannel(ch),
  },
}));

describe('usePalletDims', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    realtimeListener = null;
    currentDbDims = [];
    rpcCalls.length = 0;
  });

  it('incidente #881856: guardar medidas con copia vieja manda sólo las dimensiones y conserva los 12 items en base de datos', async () => {
    // 1. Estado en la base de datos: tarima 1 armada con 12 items en DB
    const dbItems = [
      { sku: '03-3980BL', location: 'ROW 34', qty: 5 },
      { sku: '03-3983GY', location: 'ROW 32', qty: 4 },
      { sku: '03-3989GY', location: 'ROW 9', qty: 3 },
    ];
    currentDbDims = [
      {
        pallet: 1,
        length_in: null,
        width_in: null,
        height_in: null,
        items: dbItems,
        units: 12,
        edited_at: '2026-10-08T19:46:00Z',
      },
    ];

    const shipmentId = '00000000-0000-0000-0000-000000881856';
    const { result } = renderHook(() => usePalletDims(null, shipmentId));

    // Esperar a que lea el estado inicial
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.isFetched).toBe(true);

    // 2. Operador en pantalla mide ancho 46 y alto 82
    act(() => {
      // Notar que la pantalla vieja creía tener 9 unidades
      result.current.setAxis(1, 'width_in', 46, 9);
      result.current.setAxis(1, 'height_in', 82, 9);
    });

    // 3. Ejecutar guardado (flush)
    await act(async () => {
      await result.current.flush();
    });

    // 4. Verificar lo que se envió a la base de datos vía RPC:
    // Debe enviar SÓLO { width_in: 46, height_in: 82, measured_at: ... }
    // NUNCA items, NUNCA units, NUNCA la entrada completa
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].name).toBe('patch_shipment_pallet');
    expect(rpcCalls[0].args.p_shipment_id).toBe(shipmentId);
    expect(rpcCalls[0].args.p_pallet).toBe(1);

    const patchSent = rpcCalls[0].args.p_patch as Record<string, unknown>;
    expect(patchSent).toEqual({
      width_in: 46,
      height_in: 82,
      measured_at: expect.any(String),
    });
    expect(patchSent).not.toHaveProperty('items');
    expect(patchSent).not.toHaveProperty('units');
    expect(patchSent).not.toHaveProperty('bikes');

    // 5. El resultado conserva intactos los 12 items y sus 3 SKUs
    const pallet1 = result.current.entries.find((e) => e.pallet === 1);
    expect(pallet1).toBeDefined();
    expect(pallet1?.items).toEqual(dbItems);
    expect(pallet1?.units).toBe(12);
    expect(pallet1?.width_in).toBe(46);
    expect(pallet1?.height_in).toBe(82);
  });

  it('dos setters seguidos sobre la misma tarima no se pisan', async () => {
    currentDbDims = [
      {
        pallet: 1,
        length_in: null,
        width_in: null,
        height_in: null,
        units: 8,
      },
    ];

    const shipmentId = '00000000-0000-0000-0000-000000881857';
    const { result } = renderHook(() => usePalletDims(null, shipmentId));
    await act(async () => {
      await Promise.resolve();
    });

    // Operador cambia partes y luego teclea ancho en la misma tarima
    act(() => {
      result.current.setParts(1, 3, 8);
      result.current.setAxis(1, 'width_in', 44, 8);
    });

    await act(async () => {
      await result.current.flush();
    });

    expect(rpcCalls).toHaveLength(1);
    const patch = rpcCalls[0].args.p_patch as Record<string, unknown>;
    // Ambos campos deben sobrevivir en el parche acumulado
    expect(patch.parts).toBe(3);
    expect(patch.width_in).toBe(44);
    expect(patch.edited_at).toEqual(expect.any(String));
    expect(patch.measured_at).toEqual(expect.any(String));

    const p1 = result.current.entries.find((e) => e.pallet === 1);
    expect(p1?.parts).toBe(3);
    expect(p1?.width_in).toBe(44);
  });

  it('borrar una medida manda null al RPC', async () => {
    currentDbDims = [
      {
        pallet: 1,
        length_in: 50,
        width_in: 46,
        height_in: 82,
        units: 10,
        measured_at: '2026-10-08T19:00:00Z',
      },
    ];

    const shipmentId = '00000000-0000-0000-0000-000000881858';
    const { result } = renderHook(() => usePalletDims(null, shipmentId));
    await act(async () => {
      await Promise.resolve();
    });

    // Operador borra el campo alto (valor null)
    act(() => {
      result.current.setAxis(1, 'height_in', null, 10);
    });

    await act(async () => {
      await result.current.flush();
    });

    expect(rpcCalls).toHaveLength(1);
    const patch = rpcCalls[0].args.p_patch as Record<string, unknown>;
    expect(patch).toEqual({
      height_in: null,
    });

    const p1 = result.current.entries.find((e) => e.pallet === 1);
    expect(p1?.height_in).toBeNull();
    // width_in y length_in se conservan
    expect(p1?.width_in).toBe(46);
    expect(p1?.length_in).toBe(50);
  });

  it('suscripción realtime actualiza la copia local al llegar un cambio externo', async () => {
    currentDbDims = [
      {
        pallet: 1,
        length_in: null,
        width_in: 40,
        height_in: 70,
        units: 8,
      },
    ];

    const shipmentId = '00000000-0000-0000-0000-000000881859';
    const { result, unmount } = renderHook(() => usePalletDims(null, shipmentId));
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.entries[0].width_in).toBe(40);
    expect(realtimeListener).toBeDefined();

    // Simular evento Realtime que llega desde otro dispositivo (DCV agrega bicis y cambia altura)
    const externalUpdate: PalletDimsEntry[] = [
      {
        pallet: 1,
        length_in: null,
        width_in: 40,
        height_in: 85,
        units: 12,
        items: [{ sku: '03-3980BL', qty: 12 }],
      },
    ];

    act(() => {
      realtimeListener!({
        new: {
          id: shipmentId,
          pallet_dims: externalUpdate,
        },
      });
    });

    expect(result.current.entries[0].height_in).toBe(85);
    expect(result.current.entries[0].units).toBe(12);
    expect(result.current.entries[0].items).toHaveLength(1);

    // Al desmontar, se limpia la suscripción
    unmount();
    expect(mockRemoveChannel).toHaveBeenCalled();
  });
});
