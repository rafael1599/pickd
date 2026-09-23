/**
 * The batch intake's moving parts, around the pure reducer in `labelBatch.ts`:
 * the photos, the reader, the catalogue lookup, the draft that survives closing
 * the app, and the one write.
 *
 * **The reader waits for the camera to close.** PP-OCRv6 runs on ONNX Runtime
 * without its proxy worker, so it holds the main thread for about 1.8 s per
 * label on a phone (`clientOcr.ts`, `04-plan-f2-subfases.md`). Reading while
 * the viewfinder is live would freeze it right after every shot. Checking a
 * card takes longer than reading one, so once the camera closes the queue stays
 * ahead of the operator after the first card. And it reads one label at a
 * time: the OCR service is a module-level singleton, not safe to run twice at
 * once.
 *
 * **What is kept per photo** is the compressed `File` (in memory and in
 * IndexedDB, for the draft) and a 240 px thumbnail — never a decoded
 * full-resolution image, twelve of which would be ~400 MB on a phone.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { get as idbGet, set as idbSet, del as idbDel } from 'idb-keyval';
import { recognizeLabelClient } from '../../../lib/recognition/recognizeLabelClient';
import { buildSkuLabelDraft } from '../utils/labelToSkuDraft';
import {
  batchPayload,
  batchReducer,
  batchStats,
  batchSummary,
  initialBatchState,
  type BatchAction,
  type BatchState,
} from '../utils/labelBatch';
import { serialKey, serialLooksReal } from '../utils/serialIdentity';
import { lookupBatchCatalog, submitLabelBatch, type BatchResult } from '../api/labelBatch.service';
import { recordSkuSerial } from '../api/skuSerials.service';
import { uploadPhoto } from '../../../services/photoUpload.service';
import { useAuth } from '../../../context/AuthContext';

const DRAFT_KEY = 'pickd.labelBatch.v1';
const photoKey = (id: string) => `labelBatch:photo:${id}`;
const newId = () => crypto.randomUUID();

/** One draft per device (PRD Q2). A photo mid-read when the app closed is read again. */
function loadDraft(): BatchState {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return initialBatchState(newId());
    const state = JSON.parse(raw) as BatchState;
    return {
      ...state,
      photos: state.photos.map((p) => (p.status === 'reading' ? { ...p, status: 'queued' } : p)),
    };
  } catch {
    return initialBatchState(newId());
  }
}

function saveDraft(state: BatchState) {
  try {
    if (state.photos.length === 0 && state.cards.length === 0) localStorage.removeItem(DRAFT_KEY);
    else localStorage.setItem(DRAFT_KEY, JSON.stringify(state));
  } catch {
    // Private mode or a full disk: the batch still works, it just won't survive a reload.
  }
}

async function makeThumbnail(file: Blob): Promise<string> {
  try {
    const bitmap = await createImageBitmap(file, { resizeWidth: 240, resizeQuality: 'medium' });
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.7)
    );
    return URL.createObjectURL(blob ?? file);
  } catch {
    return URL.createObjectURL(file);
  }
}

/** Let the browser paint (the card turns to READING) before the reader takes the thread. */
const yieldToPaint = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));

export interface UseLabelBatch {
  state: BatchState;
  dispatch: (action: BatchAction) => void;
  summary: ReturnType<typeof batchSummary>;
  thumbnails: Record<string, string>;
  /** The camera is open: shots are taken, nothing is read. */
  cameraOpen: boolean;
  setCameraOpen: (open: boolean) => void;
  addPhoto: (file: File) => void;
  removePhoto: (photoId: string) => void;
  removeCard: (cardId: string) => void;
  send: () => Promise<void>;
  sending: boolean;
  sendError: string | null;
  discard: () => void;
}

export function useLabelBatch(warehouse = 'LUDLOW'): UseLabelBatch {
  const queryClient = useQueryClient();
  const { user, profile } = useAuth();
  const [state, dispatch] = useReducer(batchReducer, undefined, loadDraft);
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  // A fresh batch opens on the camera; a restored draft opens on its pile.
  const [cameraOpen, setCameraOpen] = useState(() => state.photos.length === 0);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [filesReady, setFilesReady] = useState(0);

  const filesRef = useRef(new Map<string, File>());
  const readingRef = useRef(false);
  const lookingUpRef = useRef(new Set<string>());
  const sendingRef = useRef(false);

  const summary = useMemo(() => batchSummary(state), [state]);

  useEffect(() => saveDraft(state), [state]);

  // A restored draft: bring its photos back from IndexedDB.
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    void (async () => {
      for (const p of state.photos) {
        let file: File | undefined;
        try {
          file = await idbGet<File>(photoKey(p.id));
        } catch {
          file = undefined;
        }
        if (file) {
          filesRef.current.set(p.id, file);
          const url = await makeThumbnail(file);
          setThumbnails((t) => ({ ...t, [p.id]: url }));
        } else if (p.status === 'queued') {
          // A photo IndexedDB lost before it was read would wait forever and hold
          // the whole batch; it becomes a NO SKU card, like an unreadable label.
          dispatch({ type: 'photoFailed', id: p.id, cardId: newId() });
        }
      }
      setFilesReady((n) => n + 1);
    })();
  }, [state.photos]);

  // Thumbnails go when their photo goes.
  const thumbsRef = useRef(thumbnails);
  thumbsRef.current = thumbnails;
  useEffect(() => {
    const alive = new Set(state.photos.map((p) => p.id));
    const dead = Object.keys(thumbsRef.current).filter((id) => !alive.has(id));
    if (dead.length === 0) return;
    dead.forEach((id) => {
      URL.revokeObjectURL(thumbsRef.current[id]);
      filesRef.current.delete(id);
      void idbDel(photoKey(id)).catch(() => {});
    });
    setThumbnails((t) => Object.fromEntries(Object.entries(t).filter(([id]) => alive.has(id))));
  }, [state.photos]);
  useEffect(
    () => () => Object.values(thumbsRef.current).forEach((url) => URL.revokeObjectURL(url)),
    []
  );

  const addPhoto = useCallback((file: File) => {
    const id = newId();
    filesRef.current.set(id, file);
    dispatch({ type: 'photoShot', id, at: Date.now() });
    void idbSet(photoKey(id), file).catch(() => {});
    void makeThumbnail(file).then((url) => setThumbnails((t) => ({ ...t, [id]: url })));
  }, []);

  // ── The reader: one label at a time, only with the camera closed ─────────
  const [readTick, setReadTick] = useState(0);
  useEffect(() => {
    if (cameraOpen || readingRef.current) return;
    const next = state.photos.find((p) => p.status === 'queued' && filesRef.current.has(p.id));
    if (!next) return;
    const file = filesRef.current.get(next.id) as File;
    readingRef.current = true;
    dispatch({ type: 'photoReading', id: next.id });
    void (async () => {
      await yieldToPaint();
      try {
        const result = await recognizeLabelClient(file, file.name);
        dispatch({
          type: 'photoRead',
          id: next.id,
          draft: buildSkuLabelDraft(result),
          cardId: newId(),
        });
      } catch {
        dispatch({ type: 'photoFailed', id: next.id, cardId: newId() });
      } finally {
        readingRef.current = false;
        setReadTick((n) => n + 1);
      }
    })();
  }, [cameraOpen, state.photos, readTick, filesReady]);

  // ── The catalogue: every card with a SKU, looked up once ─────────────────
  useEffect(() => {
    const pending = state.cards.filter(
      (c) => c.sku && !c.catalog && !c.catalogError && !lookingUpRef.current.has(`${c.id}:${c.sku}`)
    );
    if (pending.length === 0) return;
    const timer = setTimeout(() => {
      const keys = pending.map((c) => `${c.id}:${c.sku}`);
      keys.forEach((k) => lookingUpRef.current.add(k));
      lookupBatchCatalog(
        pending.map((c) => c.sku as string),
        warehouse
      )
        .then((found) => {
          for (const card of pending) {
            const info = found.get(card.sku as string);
            if (info)
              dispatch({ type: 'catalogResolved', cardId: card.id, info, sku: card.sku as string });
            else dispatch({ type: 'catalogFailed', cardId: card.id, error: 'Not found' });
          }
        })
        .catch((e: unknown) => {
          const error = e instanceof Error ? e.message : 'Lookup failed';
          pending.forEach((card) => dispatch({ type: 'catalogFailed', cardId: card.id, error }));
        })
        .finally(() => keys.forEach((k) => lookingUpRef.current.delete(k)));
    }, 250);
    return () => clearTimeout(timer);
  }, [state.cards, warehouse]);

  const removePhoto = useCallback((photoId: string) => {
    dispatch({ type: 'photoRemoved', id: photoId });
  }, []);

  const removeCard = useCallback((cardId: string) => {
    dispatch({ type: 'cardRemoved', cardId });
  }, []);

  const clearFiles = useCallback((ids: string[]) => {
    ids.forEach((id) => {
      filesRef.current.delete(id);
      void idbDel(photoKey(id)).catch(() => {});
    });
  }, []);

  const discard = useCallback(() => {
    clearFiles(state.photos.map((p) => p.id));
    dispatch({ type: 'reset', batchId: newId() });
    setSendError(null);
    setCameraOpen(true);
  }, [clearFiles, state.photos]);

  /**
   * After the write: the registry of cartons and the catalogue photos that were
   * missing. Best effort and in the background — the batch is already written,
   * and neither of these may hold up or undo it. The files are taken before the
   * draft is cleared.
   */
  const afterWrite = useCallback(
    (written: BatchState, result: BatchResult) => {
      const uploads: { sku: string; file: File }[] = [];
      for (const card of written.cards) {
        const sku = card.catalog?.canonicalSku ?? card.sku;
        if (!sku) continue;
        const own = written.photos.filter((p) => card.photoIds.includes(p.id));
        // One sighting per carton: two photos of one box are one row, not two.
        const seen = new Set<string>();
        for (const p of own) {
          const key = serialKey(p.serial);
          if (!p.serial || !serialLooksReal(p.serial) || !key || seen.has(key)) continue;
          seen.add(key);
          void recordSkuSerial({
            sku,
            serial: p.serial,
            warehouse,
            source: 'label_scan',
            observed: { model: card.model.value, size: card.size.value, color: card.color.value },
          }).catch(() => {});
        }
        // The label photo becomes the catalogue photo only where there is none.
        const needsImage = result.new_skus.includes(sku) || card.catalog?.hasImage === false;
        const first = own.map((p) => filesRef.current.get(p.id)).find((f): f is File => !!f);
        if (needsImage && first) uploads.push({ sku, file: first });
      }
      void (async () => {
        for (const { sku, file } of uploads) {
          try {
            await uploadPhoto(sku, file);
          } catch {
            // A photo that fails to upload never undoes a batch that was written.
          }
        }
        if (uploads.length) queryClient.invalidateQueries({ queryKey: ['inventory'] });
      })();
    },
    [warehouse, queryClient]
  );

  const send = useCallback(async () => {
    if (sendingRef.current || !summary.canSend) return;
    sendingRef.current = true;
    setSending(true);
    setSendError(null);
    const written = state;
    try {
      const result = await submitLabelBatch({
        batchId: written.batchId,
        location: written.location,
        items: batchPayload(written),
        userId: user?.id ?? '',
        performedBy: profile?.full_name || user?.email || 'Batch Intake',
        warehouse,
        stats: {
          ...batchStats(written, Date.now()),
          app_version: __BUILD_ID__,
          device: navigator.userAgent.slice(0, 200),
        },
      });
      if (!result.replayed) afterWrite(written, result);
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      queryClient.invalidateQueries({ queryKey: ['locations', 'active'] });
      toast.success(
        `${result.skus} SKUS · ${result.units} U · ${result.new_skus.length} NEW → ${result.location}`
      );
      clearFiles(written.photos.map((p) => p.id));
      dispatch({ type: 'reset', batchId: newId() });
      setCameraOpen(true);
    } catch (e) {
      // Nothing was written (one transaction). The pile stays, and RETRY sends
      // the same batch_id — if the first try did land, it answers without writing.
      setSendError(e instanceof Error ? e.message : 'The batch could not be sent');
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }, [summary.canSend, state, user, profile, warehouse, afterWrite, queryClient, clearFiles]);

  return {
    state,
    dispatch,
    summary,
    thumbnails,
    cameraOpen,
    setCameraOpen,
    addPhoto,
    removePhoto,
    removeCard,
    send,
    sending,
    sendError,
    discard,
  };
}
