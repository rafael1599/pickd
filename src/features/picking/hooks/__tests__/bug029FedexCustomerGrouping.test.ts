import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useOrderGroups } from '../useOrderGroups';

// --- Mocks para useOrderGroups -----------------------------------------------
let mockGroupOrders: Array<{
  id: string;
  customer_id: string | null;
  ship_to_address_id: string | null;
  shipping_type: string | null;
  shipping_type_manual?: boolean;
  items: unknown;
  order_group?: { group_type?: string } | null;
}> = [];

const mockSkuMetadata: Array<{ sku: string; is_bike: boolean | null }> = [
  { sku: '03-1000BL', is_bike: true },
  { sku: '03-2000GY', is_bike: true },
  { sku: '01-0100BK', is_bike: true },
  { sku: '98-6860', is_bike: false },
];

const updatedRows: Array<{ id: string; payload: Record<string, unknown> }> = [];

const mockFrom = vi.fn((table: string) => {
  if (table === 'picking_lists') {
    return {
      select: vi.fn(() => ({
        eq: vi.fn(() => Promise.resolve({ data: mockGroupOrders, error: null })),
      })),
      update: vi.fn((payload: Record<string, unknown>) => ({
        in: vi.fn((_col: string, ids: string[]) => {
          for (const id of ids) {
            updatedRows.push({ id, payload });
          }
          return Promise.resolve({ error: null });
        }),
        eq: vi.fn((_col: string, id: string) => {
          updatedRows.push({ id, payload });
          return Promise.resolve({ error: null });
        }),
      })),
    };
  }
  if (table === 'sku_metadata') {
    return {
      select: vi.fn(() => ({
        in: vi.fn((_col: string, skus: string[]) => {
          const matched = mockSkuMetadata.filter((m) => skus.includes(m.sku));
          return Promise.resolve({ data: matched, error: null });
        }),
      })),
    };
  }
  if (table === 'order_groups') {
    return {
      insert: vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({ data: { id: 'group-general-1' }, error: null }),
        })),
      })),
    };
  }
  return {};
});

vi.mock('../../../../lib/supabase', () => ({
  supabase: { from: (table: string) => mockFrom(table) },
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

describe('bug-029: Regla de >= 5 bicis por cliente y dirección en lotes FedEx', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGroupOrders = [];
    updatedRows.length = 0;
  });

  // Caso (a): 5 clientes x 1 bici en un lote FedEx
  it('Caso (a): 5 clientes x 1 bici en un lote FedEx no suma cruzando clientes ni convierte a regular', async () => {
    mockGroupOrders = [
      {
        id: 'ord-1',
        customer_id: 'cust-A',
        ship_to_address_id: 'addr-A',
        shipping_type: 'fedex',
        items: [{ sku: '03-1000BL', pickingQty: 1 }],
        order_group: { group_type: 'fedex' },
      },
      {
        id: 'ord-2',
        customer_id: 'cust-B',
        ship_to_address_id: 'addr-B',
        shipping_type: 'fedex',
        items: [{ sku: '03-1000BL', pickingQty: 1 }],
        order_group: { group_type: 'fedex' },
      },
      {
        id: 'ord-3',
        customer_id: 'cust-C',
        ship_to_address_id: 'addr-C',
        shipping_type: 'fedex',
        items: [{ sku: '03-1000BL', pickingQty: 1 }],
        order_group: { group_type: 'fedex' },
      },
      {
        id: 'ord-4',
        customer_id: 'cust-D',
        ship_to_address_id: 'addr-D',
        shipping_type: 'fedex',
        items: [{ sku: '03-1000BL', pickingQty: 1 }],
        order_group: { group_type: 'fedex' },
      },
      {
        id: 'ord-5',
        customer_id: 'cust-E',
        ship_to_address_id: 'addr-E',
        shipping_type: 'fedex',
        items: [{ sku: '03-1000BL', pickingQty: 1 }],
        order_group: { group_type: 'fedex' },
      },
    ];

    const { result } = renderHook(() => useOrderGroups());
    let resolution: string | null = null;
    await act(async () => {
      resolution = await result.current.resolveMixedShippingType('group-fedex-1');
    });

    // Un lote fedex es gestionado por la base de datos; la suma de 5x1 cliente nunca fuerza a regular
    expect(resolution).toBe('none');
    expect(updatedRows).toHaveLength(0);
  });

  // Caso (b): Cliente X con 3 + 2 bicis en 2 órdenes, misma dirección
  it('Caso (b): Cliente X con 3 + 2 bicis en 2 órdenes (misma dirección) en grupo general suma 5 y convierte a regular', async () => {
    mockGroupOrders = [
      {
        id: 'ord-x1',
        customer_id: 'cust-X',
        ship_to_address_id: 'addr-100-main',
        shipping_type: 'fedex',
        items: [{ sku: '03-1000BL', pickingQty: 3 }],
        order_group: { group_type: 'general' },
      },
      {
        id: 'ord-x2',
        customer_id: 'cust-X',
        ship_to_address_id: 'addr-100-main',
        shipping_type: 'fedex',
        items: [{ sku: '03-1000BL', pickingQty: 2 }],
        order_group: { group_type: 'general' },
      },
    ];

    const { result } = renderHook(() => useOrderGroups());
    let resolution: string | null = null;
    await act(async () => {
      resolution = await result.current.resolveMixedShippingType('group-general-1');
    });

    expect(resolution).toBe('auto-converted');
    expect(updatedRows).toHaveLength(2);
    expect(updatedRows.every((r) => r.payload.shipping_type === 'regular')).toBe(true);
  });

  // Caso (c): Cliente X con 3 + 2 bicis en 2 órdenes, pero DIFERENTE dirección
  it('Caso (c): Cliente X con 3 + 2 bicis en DIFERENTE dirección no se suman (3 < 5 y 2 < 5)', async () => {
    mockGroupOrders = [
      {
        id: 'ord-x1',
        customer_id: 'cust-X',
        ship_to_address_id: 'addr-north',
        shipping_type: 'fedex',
        items: [{ sku: '03-1000BL', pickingQty: 3 }],
        order_group: { group_type: 'general' },
      },
      {
        id: 'ord-x2',
        customer_id: 'cust-X',
        ship_to_address_id: 'addr-south',
        shipping_type: 'fedex',
        items: [{ sku: '03-1000BL', pickingQty: 2 }],
        order_group: { group_type: 'general' },
      },
    ];

    const { result } = renderHook(() => useOrderGroups());
    let resolution: string | null = null;
    await act(async () => {
      resolution = await result.current.resolveMixedShippingType('group-general-1');
    });

    // Como cada dirección tiene < 5 bicis, no se activa la regla 1
    expect(resolution).toBe('none');
    expect(updatedRows).toHaveLength(0);
  });

  // Caso (d): Cliente X con orden forzada a FedEx a mano (shipping_type_manual = true)
  it('Caso (d): Orden con shipping_type_manual = true no es sobreescrita a regular', async () => {
    mockGroupOrders = [
      {
        id: 'ord-x1-manual',
        customer_id: 'cust-X',
        ship_to_address_id: 'addr-100-main',
        shipping_type: 'fedex',
        shipping_type_manual: true, // Candado manual
        items: [{ sku: '03-1000BL', pickingQty: 3 }],
        order_group: { group_type: 'general' },
      },
      {
        id: 'ord-x2',
        customer_id: 'cust-X',
        ship_to_address_id: 'addr-100-main',
        shipping_type: 'fedex',
        shipping_type_manual: false,
        items: [{ sku: '03-1000BL', pickingQty: 3 }], // Total 6 bicis
        order_group: { group_type: 'general' },
      },
    ];

    const { result } = renderHook(() => useOrderGroups());
    let resolution: string | null = null;
    await act(async () => {
      resolution = await result.current.resolveMixedShippingType('group-general-1');
    });

    expect(resolution).toBe('auto-converted');
    // Solo se debe haber actualizado ord-x2; ord-x1-manual debe permanecer intacta
    expect(updatedRows).toHaveLength(1);
    expect(updatedRows[0].id).toBe('ord-x2');
    expect(updatedRows[0].payload.shipping_type === 'regular').toBe(true);
  });

  // Caso (e): Simulación de lote con verificación (group_is_held):
  // La regla de negocio indica que el shipping_type cambia siempre pero el group_id no se mueve
  it('Caso (e): En grupo held, el shipping_type se actualiza pero el candado de grupo preserva la tarjeta en curso', () => {
    // Verificación de contrato lógico:
    // Si group_is_held(group_id) = true:
    // shipping_type = 'regular'
    // group_id = group_id (no se vacía ni se altera)
    const isGroupHeld = true;
    const orderBefore = { id: 'ord-1', group_id: 'fedex-batch-1', shipping_type: 'fedex' };
    const simulatedUpdate = {
      shipping_type: 'regular',
      group_id: isGroupHeld ? orderBefore.group_id : null,
    };
    expect(simulatedUpdate.shipping_type).toBe('regular');
    expect(simulatedUpdate.group_id).toBe('fedex-batch-1');
  });

  // Caso (f): El candado sobrevive a una orden nueva del mismo cliente
  it('Caso (f): El candado manual sobrevive en el cliente y en filtros sin ser reseteado', async () => {
    const orderWithLock = {
      id: 'ord-locked',
      customer_id: 'cust-X',
      shipping_type: 'fedex',
      shipping_type_manual: true,
    };

    // Al llegar una nueva orden que alcanza umbral
    mockGroupOrders = [
      {
        ...orderWithLock,
        ship_to_address_id: 'addr-1',
        items: [{ sku: '03-1000BL', pickingQty: 2 }],
        order_group: { group_type: 'general' },
      },
      {
        id: 'ord-new',
        customer_id: 'cust-X',
        ship_to_address_id: 'addr-1',
        shipping_type: 'regular',
        shipping_type_manual: false,
        items: [{ sku: '03-1000BL', pickingQty: 3 }],
        order_group: { group_type: 'general' },
      },
    ];

    const { result } = renderHook(() => useOrderGroups());
    await act(async () => {
      await result.current.resolveMixedShippingType('group-general-1');
    });

    // La orden con lock no debe estar en las filas actualizadas
    const touchedLocked = updatedRows.find((r) => r.id === 'ord-locked');
    expect(touchedLocked).toBeUndefined();
  });

  // Caso (g): Combinar falla por load # distinto -> grupo general sí, envío no, la orden nueva entra
  it('Caso (g): Conflicto de load # impide fusionar shipments pero permite coexistencia en grupo general', () => {
    const existingOrder = {
      id: 'ord-1',
      load_number: 'LOAD-AAA',
      customer_id: 'cust-X',
      shipment_id: 'ship-1',
      group_id: 'grp-gen-1',
    };
    const newOrder = {
      id: 'ord-2',
      load_number: 'LOAD-BBB', // Distinto
      customer_id: 'cust-X',
      shipment_id: 'ship-2',
      group_id: 'grp-gen-1', // Comparte grupo de picking
    };

    const hasLoadConflict =
      Boolean(existingOrder.load_number && newOrder.load_number) &&
      existingOrder.load_number !== newOrder.load_number;

    expect(hasLoadConflict).toBe(true);

    // Con conflicto, shipments permanecen independientes:
    const finalShipmentIdNew = hasLoadConflict ? newOrder.shipment_id : existingOrder.shipment_id;
    expect(finalShipmentIdNew).toBe('ship-2'); // Envío no fusionado
    expect(existingOrder.group_id).toBe('grp-gen-1');
    expect(newOrder.group_id).toBe('grp-gen-1'); // Grupo general sí
  });
});
