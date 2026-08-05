import React, { useRef, useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import Camera from 'lucide-react/dist/esm/icons/camera';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw';
import X from 'lucide-react/dist/esm/icons/x';
import Check from 'lucide-react/dist/esm/icons/check';
import ImagePlus from 'lucide-react/dist/esm/icons/image-plus';
import toast from 'react-hot-toast';
import { uploadPhoto } from '../../../services/photoUpload.service';
import { useScrollLock } from '../../../hooks/useScrollLock';

interface QuickCameraModalProps {
  isOpen: boolean;
  onClose: () => void;
  sku: string;
  onSuccess: (imageUrl: string) => void;
}

export const QuickCameraModal: React.FC<QuickCameraModalProps> = ({
  isOpen,
  onClose,
  sku,
  onSuccess,
}) => {
  useScrollLock(isOpen);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [stream, setStream] = useState<MediaStream | null>(null);
  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [isUploading, setIsUploading] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const stopStream = useCallback(() => {
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      setStream(null);
    }
  }, [stream]);

  const startCamera = useCallback(
    async (mode: 'environment' | 'user') => {
      setCameraError(null);
      try {
        if (stream) {
          stream.getTracks().forEach((t) => t.stop());
        }
        const newStream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: mode,
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        });
        setStream(newStream);
        if (videoRef.current) {
          videoRef.current.srcObject = newStream;
        }
      } catch {
        setCameraError('Camera access denied or unavailable');
      }
    },
    [stream]
  );

  useEffect(() => {
    if (isOpen && !capturedBlob) {
      startCamera(facingMode);
    } else {
      stopStream();
    }
    return () => {
      stopStream();
    };
  }, [isOpen, facingMode, capturedBlob]);

  if (!isOpen) return null;

  const handleCapture = () => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        setCapturedBlob(blob);
        setPreviewUrl(URL.createObjectURL(blob));
        stopStream();
      },
      'image/webp',
      0.9
    );
  };

  const handleRetake = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setCapturedBlob(null);
    setPreviewUrl(null);
    startCamera(facingMode);
  };

  const handleUpload = async () => {
    if (!capturedBlob || !sku) return;
    setIsUploading(true);
    try {
      const file = new File([capturedBlob], `${sku}_photo.webp`, { type: 'image/webp' });
      const url = await uploadPhoto(sku, file);
      toast.success(`Photo saved for SKU ${sku}`);
      onSuccess(url);
      handleClose();
    } catch {
      toast.error('Failed to upload photo');
    } finally {
      setIsUploading(false);
    }
  };

  const handleFallbackFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !sku) return;
    setIsUploading(true);
    try {
      const url = await uploadPhoto(sku, file);
      toast.success(`Photo saved for SKU ${sku}`);
      onSuccess(url);
      handleClose();
    } catch {
      toast.error('Failed to upload photo');
    } finally {
      setIsUploading(false);
    }
  };

  const handleToggleFacingMode = () => {
    const nextMode = facingMode === 'environment' ? 'user' : 'environment';
    setFacingMode(nextMode);
  };

  const handleClose = () => {
    stopStream();
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setCapturedBlob(null);
    setPreviewUrl(null);
    onClose();
  };

  return createPortal(
    <div className="fixed inset-0 z-[200] bg-black/90 flex flex-col justify-between animate-in fade-in duration-200">
      {/* Hidden canvas & file fallback */}
      <canvas ref={canvasRef} className="hidden" />
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFallbackFileSelect}
        className="hidden"
      />

      {/* Top Bar */}
      <div className="p-4 flex items-center justify-between text-white bg-gradient-to-b from-black/80 to-transparent z-10">
        <div>
          <h2 className="text-sm font-bold tracking-tight">Camera Capture</h2>
          <p className="text-xs text-emerald-400 font-mono">SKU: {sku}</p>
        </div>
        <button
          type="button"
          onClick={handleClose}
          className="p-2.5 rounded-full bg-white/10 hover:bg-white/20 active:scale-95 transition-all text-white"
        >
          <X size={20} />
        </button>
      </div>

      {/* Center Viewport */}
      <div className="relative flex-1 flex items-center justify-center overflow-hidden bg-black">
        {previewUrl ? (
          <img
            src={previewUrl}
            alt="Captured photo preview"
            className="w-full h-full object-contain"
          />
        ) : cameraError ? (
          <div className="p-6 text-center text-white space-y-4 max-w-sm">
            <p className="text-sm text-red-400 font-semibold">{cameraError}</p>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="w-full py-3 px-4 bg-emerald-500 hover:bg-emerald-400 text-black font-bold rounded-xl flex items-center justify-center gap-2"
            >
              <ImagePlus size={18} /> Choose from Library
            </button>
          </div>
        ) : (
          <div className="relative w-full h-full flex items-center justify-center">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
            />
            {/* Viewfinder frame overlay */}
            <div className="absolute inset-8 border-2 border-dashed border-white/40 rounded-2xl pointer-events-none flex items-center justify-center">
              <span className="text-[10px] uppercase font-bold text-white/50 bg-black/40 px-3 py-1 rounded-full tracking-widest backdrop-blur-sm">
                Center carton or product
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Bottom Controls */}
      <div className="p-6 bg-gradient-to-t from-black/90 to-transparent flex items-center justify-around z-10">
        {previewUrl ? (
          <>
            <button
              type="button"
              onClick={handleRetake}
              disabled={isUploading}
              className="px-5 py-3 rounded-xl bg-white/10 hover:bg-white/20 text-white font-semibold text-xs flex items-center gap-2 active:scale-95 transition-all"
            >
              <RefreshCw size={16} /> Retake
            </button>
            <button
              type="button"
              onClick={handleUpload}
              disabled={isUploading}
              className="px-6 py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-xs flex items-center gap-2 shadow-lg shadow-emerald-500/20 active:scale-95 transition-all disabled:opacity-50"
            >
              {isUploading ? (
                <div className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" />
              ) : (
                <Check size={18} />
              )}
              <span>Upload Photo</span>
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="p-3.5 rounded-full bg-white/10 hover:bg-white/20 text-white active:scale-95 transition-all"
              title="Choose from gallery"
            >
              <ImagePlus size={20} />
            </button>

            <button
              type="button"
              onClick={handleCapture}
              disabled={!!cameraError}
              className="w-18 h-18 rounded-full bg-white border-4 border-emerald-500 flex items-center justify-center active:scale-90 transition-all shadow-xl shadow-emerald-500/30 disabled:opacity-40"
              title="Take Photo"
            >
              <div className="w-14 h-14 rounded-full bg-emerald-500 flex items-center justify-center text-black">
                <Camera size={26} />
              </div>
            </button>

            <button
              type="button"
              onClick={handleToggleFacingMode}
              disabled={!!cameraError}
              className="p-3.5 rounded-full bg-white/10 hover:bg-white/20 text-white active:scale-95 transition-all"
              title="Switch Camera"
            >
              <RefreshCw size={20} />
            </button>
          </>
        )}
      </div>
    </div>,
    document.body
  );
};
