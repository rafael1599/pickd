import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { completeVerifiedOrder } from '../orderCompleter';
import { initSessionFromOrders, setCandidateProposal, confirmActiveBox } from '../liveSessionState';
import { verificationProgress } from '../../../picking/utils/verificationProgress';

describe('orderCompleter against local Docker DB (supabase_db_pickd)', () => {
  const localUrl = 'http://127.0.0.1:54321';
  // Local service_role key to manage test records and bypass RLS in local integration test
  const localServiceKey =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
  const supabase = createClient(localUrl, localServiceKey);

  const testOrderId = '00000000-0000-0000-0000-000000000002';
  const testUserId = '00000000-0000-0000-0000-000000000001';

  beforeAll(async () => {
    // Ensure test user and initial order exist in local Docker DB
    await supabase.auth.admin.deleteUser(testUserId).catch(() => {});
    await supabase.auth.admin.createUser({
      id: testUserId,
      email: 'test-completer@example.com',
      password: 'password123',
      email_confirm: true,
    });
    await supabase.from('profiles').upsert({ id: testUserId, full_name: 'Test Completer' });
    await supabase.from('user_presence').upsert({ user_id: testUserId });
    await supabase.from('picking_lists').upsert({
      id: testOrderId,
      order_number: 'TEST-881999',
      user_id: testUserId,
      status: 'ready_to_double_check',
      items: [
        {
          sku: '03-3989GY',
          qty: 2,
          name: 'Renegade S1 56cm',
          sku_metadata: { is_bike: true, weight_lbs: 30 },
        },
      ],
      verified_item_keys: [],
    });
  });

  afterAll(async () => {
    // Clean up test data
    await supabase.from('picking_lists').delete().eq('id', testOrderId);
    await supabase.from('user_presence').delete().eq('user_id', testUserId);
    await supabase.from('profiles').delete().eq('id', testUserId);
    await supabase.auth.admin.deleteUser(testUserId).catch(() => {});
  });

  it('verifies 2 boxes, completes order in local DB, and achieves 100% verification progress', async () => {
    let state = initSessionFromOrders([
      {
        id: testOrderId,
        order_number: 'TEST-881999',
        status: 'ready_to_double_check',
        items: [
          {
            sku: '03-3989GY',
            qty: 2,
            name: 'Renegade S1 56cm',
            sku_metadata: { is_bike: true, weight_lbs: 30 },
          },
        ],
      },
    ]);

    // Box 1
    state = setCandidateProposal(state, {
      sku: '03-3989GY',
      rawBarcode: '03-3989GY',
      format: 'code_39',
      serial: 'U226U00001',
      consecutiveFrames: 2,
      confidence: 0.9,
      firstDetectedAt: 1000,
      lastDetectedAt: 1050,
    });
    state = confirmActiveBox(state).state;

    // Box 2
    state = setCandidateProposal(state, {
      sku: '03-3989GY',
      rawBarcode: '03-3989GY',
      format: 'code_39',
      serial: 'U226U00002',
      consecutiveFrames: 2,
      confidence: 0.9,
      firstDetectedAt: 1100,
      lastDetectedAt: 1150,
    });
    state = confirmActiveBox(state).state;

    expect(state.stats.totalBikesConfirmed).toBe(2);
    expect(state.stats.isGroupFullyVerified).toBe(true);

    // Complete order
    const result = await completeVerifiedOrder(supabase, testOrderId, testUserId, state);

    expect(result.success).toBe(true);
    expect(result.status).toBe('completed');
    expect(result.verifiedItemKeys).toEqual(['1-03-3989GY-0', '1-03-3989GY-1']);

    // Fetch from local Supabase container to verify database state
    const { data: dbRow, error } = await supabase
      .from('picking_lists')
      .select('id, order_number, status, checked_by, verified_item_keys, items')
      .eq('id', testOrderId)
      .single();

    expect(error).toBeNull();
    expect(dbRow?.status).toBe('completed');
    expect(dbRow?.checked_by).toBe(testUserId);
    expect(dbRow?.verified_item_keys).toEqual(['1-03-3989GY-0', '1-03-3989GY-1']);

    // Check that standard Pickd verificationProgress calculates 100%
    const progress = verificationProgress(dbRow as any);
    expect(progress).toBe(100);
  });
});
