import type { MutationKey, QueryClient } from '@tanstack/react-query';

/** The parts of a Mutation this reads — any Mutation<…> fits. */
export interface PersistableMutation {
  state: { isPaused: boolean; status: string };
  options: { mutationKey?: MutationKey };
}

/**
 * Which mutations may be written to IndexedDB (bug-047).
 *
 * Persisting keeps only `mutationKey` and `state`; the functions are gone after
 * a reload, and the only way back to one is `setMutationDefaults` in
 * `mutationRegistry.ts`. A mutation without a registered `mutationFn` is a
 * zombie the moment it is written: every start threw `No mutationFn found`
 * for `add-picking-note`, and 13 other keyed mutations and every unkeyed one
 * were one reload away from the same.
 *
 * `getMutationDefaults` returns `{}` when nothing matches — always truthy —
 * so the question has to be about `.mutationFn`, not about the object.
 *
 * Notes are deliberately not registered: `picking_list_notes` has no
 * idempotency key (an insert that landed but whose reply was lost comes back
 * as a duplicate) and `created_at` would stamp the resume time, hours later.
 */
export function hasResumableDefault(client: QueryClient, key: MutationKey | undefined): boolean {
  if (!Array.isArray(key) || key.length === 0) return false;
  return typeof client.getMutationDefaults(key).mutationFn === 'function';
}

/** `shouldDehydrateMutation`: paused or in flight, and able to run after a reload. */
export function shouldPersistMutation(client: QueryClient, mutation: PersistableMutation): boolean {
  const inFlight = mutation.state.isPaused === true || mutation.state.status === 'pending';
  return inFlight && hasResumableDefault(client, mutation.options.mutationKey);
}
