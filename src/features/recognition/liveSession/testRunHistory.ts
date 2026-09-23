/**
 * testRunHistory.ts
 *
 * Guarda un registro en `live_check_test_runs` cada vez que se genera la
 * telemetría R15 de una sesión de `/live-check` (botón "Copiar resultado" en
 * LiveCheckScreen.tsx): qué dispositivo la corrió y con qué commit de la app,
 * para poder correlacionar un cambio de comportamiento con un commit
 * específico sin depender de que alguien haya pegado el JSON en un chat.
 *
 * Es telemetría, no una operación crítica: una falla al guardar (offline, RLS,
 * lo que sea) nunca debe romper "Copiar resultado" ni la sesión de escaneo.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { parseDeviceInfo } from './deviceInfo';

export interface LiveCheckTestRunInput {
  createdBy: string | null;
  orderNumbers: string[];
  groupId: string | null;
  boxesConfirmed: number;
  bikesRequired: number;
  durationSeconds: number;
  /** __BUILD_ID__ tal como lo emite vite.config.ts: "<commit corto>-<hora>". */
  appBuild: string;
  userAgent: string;
  /** El payload completo TELEMETRIA_BARRIDO_LIVE_CHECK_R15. */
  telemetry: unknown;
}

/** El commit corto es lo primero antes del guion, igual que buildCommit() en useAppUpdate.tsx. */
export function shortCommitFromBuild(build: string): string | null {
  const commit = build.split('-')[0]?.trim();
  return commit || null;
}

/**
 * Inserta el registro. Nunca lanza: un fallo de telemetría no debe tumbar la
 * pantalla de escaneo. Devuelve `true` si se guardó.
 */
export async function saveLiveCheckTestRun(
  supabase: SupabaseClient,
  input: LiveCheckTestRunInput
): Promise<boolean> {
  try {
    const device = parseDeviceInfo(input.userAgent);

    const { error } = await supabase.from('live_check_test_runs').insert({
      created_by: input.createdBy,
      order_numbers: input.orderNumbers,
      group_id: input.groupId,
      boxes_confirmed: input.boxesConfirmed,
      bikes_required: input.bikesRequired,
      duration_seconds: input.durationSeconds,
      app_build: input.appBuild,
      app_commit: shortCommitFromBuild(input.appBuild),
      device_user_agent: device.userAgent || null,
      device_label: device.label,
      device_os: device.os,
      device_is_mobile: device.isMobile,
      telemetry: input.telemetry as never,
    });

    if (error) {
      console.warn('[testRunHistory] No se pudo guardar el historial de test:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[testRunHistory] Error guardando historial de test:', err);
    return false;
  }
}
