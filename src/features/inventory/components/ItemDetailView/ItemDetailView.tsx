import React from 'react';

import type {
  InventoryItemInput,
  InventoryItemWithMetadata,
} from '../../../../schemas/inventory.schema.ts';
import { RegisterItemView } from './RegisterItemView.tsx';
import { ItemCardView } from './ItemCardView.tsx';

interface ItemDetailViewProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: InventoryItemInput) => void | Promise<void>;
  onDelete?: () => void;
  initialData?: InventoryItemWithMetadata | null;
  mode?: 'add' | 'edit';
  screenType?: string;
  /** A label photo taken before the register screen opened. */
  initialPhotoFile?: File | null;
  /** Add mode opened from "photo": the register screen starts on the camera. */
  startWithCamera?: boolean;
}

/**
 * The item card (docs/prds/item-detail-register.md): a new item is registered
 * on its carton label (`RegisterItemView`), an existing one is edited on the
 * same label (`ItemCardView`). Mounted only while open, so each opening starts
 * from its own item.
 */
export const ItemDetailView: React.FC<ItemDetailViewProps> = (props) => {
  if (!props.isOpen) return null;
  if ((props.mode ?? 'add') === 'add') {
    return (
      <RegisterItemView
        isOpen
        onClose={props.onClose}
        onSave={props.onSave}
        initialData={props.initialData}
        screenType={props.screenType}
        initialPhotoFile={props.initialPhotoFile}
        startWithCamera={props.startWithCamera}
      />
    );
  }
  if (!props.initialData) return null;
  return (
    <ItemCardView
      key={`${props.initialData.id}-${props.initialData.sku}`}
      isOpen
      onClose={props.onClose}
      onSave={props.onSave}
      onDelete={props.onDelete}
      item={props.initialData}
    />
  );
};
