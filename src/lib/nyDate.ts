/**
 * NY Timezone — single source of truth (TS side).
 *
 * Thin wrappers over the Postgres functions `current_ny_date()` and
 * `ny_day_bounds(date)` defined in
 * `supabase/migrations/20260410100000_ny_timezone_helpers.sql`.
 *
 * Rule for the team:
 *   - Anywhere in the codebase that needs "today's NY date", call
 *     `getCurrentNYDate()`. Never use `new Date().toISOString().slice(0,10)`
 *     (that's UTC, not NY).
 *   - Anywhere that needs "the UTC bounds of NY day X", call
 *     `getNYDayBounds(x)`. Never construct `${date}T00:00:00.000Z` by hand.
 *   - DST is handled by Postgres. Don't try to add/subtract hours yourself.
 */

import { supabase } from './supabase';

export interface NYDayBounds {
  startsAt: string; // UTC ISO string
  endsAt: string; // UTC ISO string
}

/**
 * Returns today's calendar date in America/New_York as a YYYY-MM-DD string.
 */
export async function getCurrentNYDate(): Promise<string> {
  const { data, error } = await supabase.rpc('current_ny_date');
  if (error) throw error;
  if (!data) throw new Error('current_ny_date returned no data');
  return data;
}

/**
 * For a NY calendar date (YYYY-MM-DD), returns the UTC timestamp bounds of
 * that day. Use these bounds for any query against `timestamptz` columns that
 * needs to scope results to a specific NY day.
 */
export async function getNYDayBounds(nyDate: string): Promise<NYDayBounds> {
  const { data, error } = await supabase.rpc('ny_day_bounds', { p_ny_date: nyDate });
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error(`ny_day_bounds returned no data for ${nyDate}`);
  }
  return {
    startsAt: data[0].starts_at,
    endsAt: data[0].ends_at,
  };
}
