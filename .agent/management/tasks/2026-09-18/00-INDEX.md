# Tareas pendientes — 18 sep 2026

Ver `PROTOCOLO.md` antes de tocar cualquier archivo de esta carpeta.

Ya resuelto y en `main` (no está en esta lista): contenedores (7005N) no
elegibles para pickup, pallet count + combining orders, sincronización de
carrier a hermanas, load #/BOL en el mismo click (live board y Ship).

| # | Tarea | Estado | Archivo |
|---|---|---|---|
| 1 | Ocultar banner "Picking from" en DCV | IMPLEMENTADO | `01-dcv-picking-from-banner.md` |
| 2 | Ocultar banner "Live sync lost" en toda la app | IMPLEMENTADO | `02-live-sync-lost-banner.md` |
| 3 | DCV: recoger de la letra más alta a la A | IMPLEMENTADO | `03-dcv-sublocation-reverse-order.md` |
| 4 | Ship-to: usar la dirección del documento, no la del account | BLOQUEADO | `04-ship-to-address-accuracy.md` |
| 5 | Ship > Waiting no muestra todas las órdenes | IMPLEMENTADO PARCIAL | `05-ship-waiting-missing-orders.md` |
| 6 | "Done Editing" desaparece al editar un SKU | IMPLEMENTADO | `06-dcv-done-editing-disappears.md` |
| 7 | Barra de progreso más animada (cajita) | IMPLEMENTADO (sin verificación visual) | `07-progress-bar-animation.md` |
| 8 | App se cuelga con 2+ pestañas en el celular | IMPLEMENTADO (sin repro en celular) | `08-multi-tab-freeze-mobile.md` |
| 9 | "Failed to print labels" recurrente | INVESTIGANDO | `09-print-labels-failure.md` |

## Cómo sigue Claude desde aquí

Cuando una fila diga `LISTO PARA CONFIRMAR`, Claude abre solo ese archivo,
lee el plan de fix, lo confirma contra el código actual con una lectura
rápida (no una investigación nueva) y lo implementa. Nada de volver a
investigar lo que agy ya investigó.
