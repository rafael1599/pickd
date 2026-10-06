import { useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';
import { CameraCaptureSheet } from '../../../components/ui/CameraCaptureSheet';
import { uploadPhoto } from '../../../services/photoUpload.service';
import { feedbackService } from '../../../services/feedback.service';
import { INVENTORY_ROOT_KEY } from './useInventoryRealtime';
import { setSkuPhotoInCaches } from '../components/ItemDetailView/itemCardShared';

export interface SkuPhotoCapture {
  openCamera: () => void;
  openGallery: () => void;
  isUploading: boolean;
  /** The hidden file input and the camera sheet: render it once. */
  element: ReactNode;
}

/**
 * Take or choose the photo of a SKU from a Stock card. The card's ⋯ menu and
 * the empty photo column of the photo-first card (docs/prds/stock-card-photo-first.md,
 * ❓1) open the same camera, so a photo taken from either lands the same way.
 */
export function useSkuPhotoCapture(sku: string | undefined): SkuPhotoCapture {
  const queryClient = useQueryClient();
  const [cameraOpen, setCameraOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    if (!sku) return;
    setIsUploading(true);
    try {
      const url = await uploadPhoto(sku, file);
      setSkuPhotoInCaches(queryClient, sku, url);
      queryClient.invalidateQueries({ queryKey: INVENTORY_ROOT_KEY });
      feedbackService.success();
    } catch {
      feedbackService.error();
    } finally {
      setIsUploading(false);
    }
  };

  // Inside a card: a tap in the camera sheet (a portal, which React still
  // bubbles to its tree) must not reach the card and open the item.
  const element = (
    <span className="contents" onClick={(e) => e.stopPropagation()}>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void handleFile(file);
        }}
        className="hidden"
      />
      {cameraOpen &&
        sku &&
        createPortal(
          <CameraCaptureSheet
            single
            onCapture={(file) => void handleFile(file)}
            onClose={() => setCameraOpen(false)}
          />,
          document.body
        )}
    </span>
  );

  return {
    openCamera: () => setCameraOpen(true),
    openGallery: () => inputRef.current?.click(),
    isUploading,
    element,
  };
}
