// The engine state lives in the URL, so a layout someone is looking at is a
// link they can send: `?zone=bay3_north&west=0&pd=65`. Defaults are omitted,
// which keeps the plain `?zone=` link the canonical one. Hall overrides stay
// in memory — they are a what-if, not a plan — and any change to the layout
// clears them, because the halls they named have moved.

import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { defaultEngineState } from '../engine';
import type { EngineState, LayoutPreset, ZoneConfig } from '../engine';

/** What a URL may ask for, inches. A pallet outside it is a typo, not a plan. */
export const PALLET_MIN = 40;
export const PALLET_MAX = 80;

const PRESET_PARAM: Record<LayoutPreset, string | null> = {
  standard: null,
  center_hall: 'center',
  solid: 'solid',
};

/** The hall toggles a zone offers, from its own obstacles — never a list by zone id. */
export function toggleKeys(config: ZoneConfig): string[] {
  const keys: string[] = [];
  for (const o of config.obstacles ?? []) {
    if (o.toggleable && !keys.includes(o.toggleable)) keys.push(o.toggleable);
  }
  return keys;
}

export function parseEngineState(params: URLSearchParams, config: ZoneConfig): EngineState {
  const state = defaultEngineState();
  const inches = (key: string, fallback: number) => {
    const raw = params.get(key);
    if (raw === null) return fallback;
    const v = Number(raw);
    return Number.isFinite(v) && v >= PALLET_MIN && v <= PALLET_MAX ? v : fallback;
  };
  state.pd = inches('pd', state.pd);
  state.pw = inches('pw', state.pw);
  state.isEW = params.get('rows') === 'ew';
  const preset = params.get('preset');
  state.layoutPreset =
    preset === 'center' ? 'center_hall' : preset === 'solid' ? 'solid' : 'standard';
  state.toggles = {};
  for (const key of toggleKeys(config)) state.toggles[key] = params.get(key) !== '0';
  return state;
}

/** Writes the state's non-default keys onto a copy of `params`; other keys are kept. */
export function writeEngineState(
  params: URLSearchParams,
  state: EngineState,
  config: ZoneConfig
): URLSearchParams {
  const next = new URLSearchParams(params);
  const defaults = defaultEngineState();
  const set = (key: string, value: string | null) => {
    if (value === null) next.delete(key);
    else next.set(key, value);
  };
  set('pd', state.pd === defaults.pd ? null : String(state.pd));
  set('pw', state.pw === defaults.pw ? null : String(state.pw));
  set('rows', state.isEW ? 'ew' : null);
  set('preset', PRESET_PARAM[state.layoutPreset]);
  for (const key of toggleKeys(config)) set(key, state.toggles[key] === false ? '0' : null);
  return next;
}

export type ZoneStatePatch = Partial<Omit<EngineState, 'toggles'>> & {
  toggles?: Record<string, boolean>;
};

export function useZoneState(config: ZoneConfig) {
  const [params, setParams] = useSearchParams();
  const [hallOverrides, setHallOverrides] = useState<Record<number, number>>({});

  const state = useMemo<EngineState>(
    () => ({ ...parseEngineState(params, config), hallOverrides }),
    [params, config, hallOverrides]
  );

  const update = useCallback(
    (patch: ZoneStatePatch) => {
      const { hallOverrides: overrides, toggles, ...rest } = patch;
      const layoutChanged = Object.keys(rest).length + Object.keys(toggles ?? {}).length > 0;
      if (overrides !== undefined) setHallOverrides(overrides);
      else if (layoutChanged) setHallOverrides({});
      if (!layoutChanged) return;
      const merged: EngineState = {
        ...state,
        ...rest,
        toggles: { ...state.toggles, ...(toggles ?? {}) },
      };
      setParams(writeEngineState(params, merged, config), { replace: true });
    },
    [params, setParams, state, config]
  );

  return [state, update] as const;
}
