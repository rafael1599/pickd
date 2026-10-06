/**
 * Leer una foto de pallet hasta el final, esté quien la tomó donde esté
 * (idea-247 F0; Rafael, 6 oct 2026).
 *
 * - `startPhotoRead`: la foto recién tomada. Deja su fila (`photo_reads`, la
 *   toma quien la sacó), corre la sombra de siempre (`runDcvShadow`: original
 *   al bucket privado, motor en un Worker, fila en `dcv_shadow_runs`) y, al
 *   terminar, deja las alertas y el frente para todos. No depende de ninguna
 *   pantalla: si quien verifica pasa a otra orden, sigue.
 * - `resumePhotoRead`: una fila que otra PickD dejó sin terminar (se cerró la
 *   app, se quedó sin cola): baja el original con su reclamo y hace lo mismo.
 *
 * Nunca lanza. Una lectura que no llega a leer (cola llena, sin motor) suelta
 * la fila para que la tome otra PickD.
 */
import { runDcvShadow } from '../api/dcvShadow';
import type { ShadowFlag, ShadowGroupLine } from '../utils/dcvShadow';
import type { PalletUnit } from '../pallets/palletUnits';
import {
  downloadClaimedOriginal,
  finishPhotoRead,
  insertPhotoRead,
  releasePhotoRead,
  setPhotoReadKey,
  type PhotoReadRow,
} from './api';
import { frontSummary, photoAlerts } from './postProcess';

/** Cuántas lecturas corren en esta PickD ahora: el barrido no se suma a una en curso. */
let running = 0;
export const photoReadsRunning = () => running;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

interface ReadJob {
  photoId: string;
  listId: string;
  groupId: string | null;
  groupMembers: string[];
  lines: ShadowGroupLine[];
  snapshot: PalletUnit[];
  flag: ShadowFlag;
}

async function readAndFinish(job: ReadJob, file: File, existingKey?: string): Promise<void> {
  let outcome: string | null = null;
  const boxes = await runDcvShadow({
    file,
    photoId: job.photoId,
    listId: job.listId,
    groupId: job.groupId,
    groupMembers: job.groupMembers,
    lines: job.lines,
    flag: job.flag,
    existingKey,
    onUploaded: (key) => void setPhotoReadKey(job.photoId, key).catch(() => {}),
    onOutcome: (s) => (outcome = s),
  });
  if (!boxes) {
    await releasePhotoRead(job.photoId, outcome ?? 'no read').catch(() => {});
    return;
  }
  const alerts = photoAlerts(
    boxes,
    job.lines.map((l) => l.sku)
  );
  let front = null;
  let error: string | null = null;
  try {
    front = frontSummary(boxes, job.snapshot);
  } catch (e) {
    error = `front: ${message(e)}`;
  }
  await finishPhotoRead(job.photoId, alerts, front, error).catch((e) =>
    console.warn('[photoReads] not finished:', message(e))
  );
}

export async function startPhotoRead(
  job: ReadJob & {
    file: File;
    takenAt: number;
    palletHint: number | null;
    shot: number | null;
  }
): Promise<void> {
  running += 1;
  try {
    try {
      await insertPhotoRead({
        photo_id: job.photoId,
        list_id: job.listId,
        taken_at: new Date(job.takenAt).toISOString(),
        pallet_hint: job.palletHint,
        shot: job.shot,
        group_members: job.groupMembers,
        lines: job.lines,
        snapshot: job.snapshot,
      });
    } catch (e) {
      // Sin fila nadie más podría terminarla, pero la sombra corre igual.
      console.warn('[photoReads] row not created:', message(e));
    }
    await readAndFinish(job, job.file);
  } catch (e) {
    console.warn('[photoReads] read failed:', message(e));
  } finally {
    running -= 1;
  }
}

export async function resumePhotoRead(row: PhotoReadRow, flag: ShadowFlag): Promise<void> {
  if (!row.photo_key) return;
  running += 1;
  try {
    let file: File;
    try {
      file = await downloadClaimedOriginal(row.photo_key);
    } catch (e) {
      await releasePhotoRead(row.photo_id, `download: ${message(e)}`).catch(() => {});
      return;
    }
    await readAndFinish(
      {
        photoId: row.photo_id,
        listId: row.list_id,
        groupId: row.group_id,
        groupMembers: row.group_members ?? [],
        lines: row.lines ?? [],
        snapshot: row.snapshot ?? [],
        flag,
      },
      file,
      row.photo_key
    );
  } catch (e) {
    console.warn('[photoReads] resume failed:', message(e));
  } finally {
    running -= 1;
  }
}
