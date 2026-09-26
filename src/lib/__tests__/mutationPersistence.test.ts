import { describe, expect, it } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import {
  hasResumableDefault,
  shouldPersistMutation,
  type PersistableMutation,
} from '../mutationPersistence';

const client = () => {
  const c = new QueryClient();
  c.setMutationDefaults(['inventory', 'updateQuantity'], { mutationFn: async () => true });
  return c;
};

const mutation = (
  key: unknown,
  state: { isPaused?: boolean; status?: string }
): PersistableMutation =>
  ({
    options: { mutationKey: key },
    state: { isPaused: false, status: 'idle', ...state },
  }) as unknown as PersistableMutation;

describe('mutation persistence (bug-047)', () => {
  it('a key with a registered mutationFn can resume', () => {
    expect(hasResumableDefault(client(), ['inventory', 'updateQuantity'])).toBe(true);
  });

  it('getMutationDefaults returns {} for an unknown key, which is not a default', () => {
    const c = client();
    expect(c.getMutationDefaults(['add-picking-note', 'x'])).toEqual({});
    expect(hasResumableDefault(c, ['add-picking-note', 'x'])).toBe(false);
  });

  it('a mutation without a key never resumes', () => {
    expect(hasResumableDefault(client(), undefined)).toBe(false);
  });

  it('persists a paused inventory mutation', () => {
    expect(
      shouldPersistMutation(
        client(),
        mutation(['inventory', 'updateQuantity'], { isPaused: true, status: 'pending' })
      )
    ).toBe(true);
  });

  it('does not persist a paused note, an unkeyed mutation, or a settled one', () => {
    const c = client();
    expect(
      shouldPersistMutation(
        c,
        mutation(['add-picking-note', 'l1'], { isPaused: true, status: 'pending' })
      )
    ).toBe(false);
    expect(shouldPersistMutation(c, mutation(undefined, { status: 'pending' }))).toBe(false);
    expect(
      shouldPersistMutation(c, mutation(['inventory', 'updateQuantity'], { status: 'error' }))
    ).toBe(false);
  });

  it('completing an order does not persist: its key is not the registered one', () => {
    expect(
      shouldPersistMutation(client(), mutation(['picking', 'processList'], { status: 'pending' }))
    ).toBe(false);
  });
});
