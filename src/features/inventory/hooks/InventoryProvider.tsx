/* eslint-disable react-refresh/only-export-components */
import { ReactNode } from 'react';
import { useInventoryRealtime } from './useInventoryRealtime';
export { useInventory } from './useInventoryData';

/**
 * REEMPLAZO DEL PROVIDER MONOLITICO.
 * Ya no usa React Context para distribuir los 19,000 items.
 * Su única función ahora es montar el motor Websocket (useInventoryRealtime)
 * una sola vez en la raíz de la aplicación (App.tsx) para mantener
 * la caché de React Query sincronizada.
 */
export const InventoryProvider = ({ children }: { children: ReactNode }) => {
  useInventoryRealtime();
  return <>{children}</>;
};
