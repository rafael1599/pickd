import React from 'react';
import Camera from 'lucide-react/dist/esm/icons/camera';

export const PhotoCountBadge: React.FC<{ count: number }> = ({ count }) => {
  if (count === 0) return null;
  return (
    <span className="inline-flex items-center gap-0.5 text-[10px] text-muted/60 font-bold">
      <Camera size={10} />
      {count}
    </span>
  );
};
