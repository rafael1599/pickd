/**
 * Termina las fotos de pallet que nadie terminó (idea-247 F0).
 *
 * Una foto se lee en el teléfono que la tomó; si la app se cerró antes de
 * acabar, su fila queda sin terminar. Montado en `LayoutMain`, esto la toma
 * desde cualquier pantalla: al minuto de abrir, cada minuto y al volver a la
 * app.
 *
 * - **Una PC** (puntero fino: la estación de Ship) toma cualquiera.
 * - **Un teléfono** sólo las suyas: no le carga a un picker leer fotos ajenas
 *   mientras recoge (el lector es pesado; Rafael ya se quejaba del lag).
 *
 * De a una, y nunca encima de una lectura que ya corre en esta PickD.
 */
import { useEffect } from 'react';
import { useAuth } from '../../../context/AuthContext';
import { useDcvShadowFlag } from '../hooks/useDcvShadowFlag';
import { shadowRunsFor } from '../utils/dcvShadow';
import { claimPhotoRead } from './api';
import { photoReadsRunning, resumePhotoRead } from './processor';

const FIRST_SWEEP_MS = 15_000;
const SWEEP_EVERY_MS = 60_000;
const PER_SWEEP = 5;

export function usePhotoReadSweeper(): void {
  const flag = useDcvShadowFlag();
  const { user } = useAuth();
  const runs = shadowRunsFor(flag, user?.id);

  useEffect(() => {
    if (!runs) return;
    const desktop =
      typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: fine)').matches;
    let stopped = false;
    let busy = false;
    const sweep = async () => {
      if (stopped || busy || photoReadsRunning() > 0) return;
      if (document.visibilityState !== 'visible') return;
      busy = true;
      try {
        for (let i = 0; i < PER_SWEEP && !stopped; i += 1) {
          const row = await claimPhotoRead(!desktop);
          if (!row) break;
          await resumePhotoRead(row, flag);
        }
      } catch (e) {
        console.warn('[photoReads] sweep:', e instanceof Error ? e.message : e);
      } finally {
        busy = false;
      }
    };
    const first = setTimeout(() => void sweep(), FIRST_SWEEP_MS);
    const every = setInterval(() => void sweep(), SWEEP_EVERY_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void sweep();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      clearTimeout(first);
      clearInterval(every);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [runs, flag]);
}
