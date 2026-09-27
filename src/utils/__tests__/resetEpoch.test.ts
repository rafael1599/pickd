import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isResetEpochNeeded, backupAuthTokens, performAppReset } from '../resetEpoch';

describe('resetEpoch utility', () => {
  describe('isResetEpochNeeded', () => {
    it('returns true when server epoch is strictly greater than local epoch', () => {
      expect(isResetEpochNeeded(1, 0)).toBe(true);
      expect(isResetEpochNeeded(2, 1)).toBe(true);
      expect(isResetEpochNeeded(5, 2)).toBe(true);
    });

    it('returns false when server epoch is equal or lower', () => {
      expect(isResetEpochNeeded(1, 1)).toBe(false);
      expect(isResetEpochNeeded(0, 1)).toBe(false);
      expect(isResetEpochNeeded(1, 2)).toBe(false);
    });
  });

  describe('backupAuthTokens', () => {
    it('preserves Supabase authentication keys and ignores regular keys', () => {
      const mockStorage: Record<string, string> = {
        'sb-myproject-auth-token': JSON.stringify({ access_token: 'xyz', user: 'bob' }),
        'supabase.auth.token': 'token-123',
        pickd_theme: 'dark',
        'pickd-inventory-cache-v1.5.0': 'cache-data',
        random_key: 'foo',
      };

      const storageObj = {
        length: Object.keys(mockStorage).length,
        key: (i: number) => Object.keys(mockStorage)[i] ?? null,
        getItem: (k: string) => mockStorage[k] ?? null,
        setItem: vi.fn(),
        removeItem: vi.fn(),
        clear: vi.fn(),
      } as unknown as Storage;

      const backup = backupAuthTokens(storageObj);
      expect(backup).toEqual([
        ['sb-myproject-auth-token', JSON.stringify({ access_token: 'xyz', user: 'bob' })],
        ['supabase.auth.token', 'token-123'],
      ]);
    });
  });

  describe('performAppReset', () => {
    let mockStorage: Record<string, string>;
    let storageObj: Storage;

    beforeEach(() => {
      mockStorage = {
        'sb-demo-auth-token': 'jwt-secret',
        'pickd-cache': 'stale-data',
        pickd_reset_epoch: '0',
      };

      storageObj = {
        get length() {
          return Object.keys(mockStorage).length;
        },
        key: (i: number) => Object.keys(mockStorage)[i] ?? null,
        getItem: (k: string) => mockStorage[k] ?? null,
        setItem: (k: string, v: string) => {
          mockStorage[k] = v;
        },
        removeItem: (k: string) => {
          delete mockStorage[k];
        },
        clear: () => {
          mockStorage = {};
        },
      } as unknown as Storage;
    });

    it('clears storage, restores auth tokens, and writes new reset epoch', async () => {
      const persisterClear = vi.fn().mockResolvedValue(undefined);

      await performAppReset(2, {
        reload: false,
        storage: storageObj,
        persisterClear,
      });

      expect(persisterClear).toHaveBeenCalledTimes(1);
      // Non-auth keys must be cleared
      expect(mockStorage['pickd-cache']).toBeUndefined();
      // Auth tokens must be restored
      expect(mockStorage['sb-demo-auth-token']).toBe('jwt-secret');
      // Target reset epoch must be stored
      expect(mockStorage['pickd_reset_epoch']).toBe('2');
    });
  });
});
