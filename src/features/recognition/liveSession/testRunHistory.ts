/**
 * testRunHistory.ts
 *
 * Guarda UN registro en `live_check_test_runs` por sesión de `/live-check`:
 * qué dispositivo la corrió, con qué commit de la app, y si llegó a escanear
 * la orden completa o quedó a medias — para correlacionar un cambio de
 * comportamiento con un commit específico sin depender de que alguien haya
 * pegado el JSON en un chat.
 *
 * El disparador es "lo primero que pase" entre tocar "Copiar resultado" o
 * salir de la pantalla (`LiveCheckScreen.tsx`, `testRunSavedRef`); esta
 * función en sí no deduplica — asume que el llamador ya decidió que
 * corresponde guardar.
 *
 * Es telemetría, no una operación crítica: una falla al guardar (offline, RLS,
 * lo que sea) nunca debe romper "Copiar resultado" ni la sesión de escaneo.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { parseDeviceInfo } from './deviceInfo';

export type LiveCheckTestRunTrigger = 'copy_result' | 'exit';

export interface LiveCheckTestRunInput {
  createdBy: string | null;
  orderNumbers: string[];
  groupId: string | null;
  boxesConfirmed: number;
  bikesRequired: number;
  durationSeconds: number;
  /** sessionState.stats.isGroupFullyVerified al momento de guardar. */
  fullyScanned: boolean;
  /** sessionState.stats.progressPercent (0-100) al momento de guardar. */
  progressPercent: number;
  /** Qué disparó este guardado: el botón de copiar, o salir sin haberlo tocado. */
  saveTrigger: LiveCheckTestRunTrigger;
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
      fully_scanned: input.fullyScanned,
      progress_percent: input.progressPercent,
      save_trigger: input.saveTrigger,
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
