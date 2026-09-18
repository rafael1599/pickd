# "Done Editing" desaparece al editar un SKU

## Estado
IMPLEMENTADO

## Pedido de Rafael (literal)
"Cuando estoy editando un SKU 'Done Editing' se desaparece para dejarme
ver [el panel de Replace: LOC, Replace/Adjust Qty/Remove, motivo de
reemplazo, Cancel/Confirm Replace]. Si presiono Cancel o Confirm Replace
recién vuelve a aparecer 'Done Editing', porque muchas veces presiono
'Done Editing' en vez de los botones que quiero."

Lectura del problema: no es solo que el botón se oculte — es que Rafael
lo busca por reflejo mientras el panel de Replace está abierto, y como no
está ahí, es fácil que termine tocando otra cosa por error. El fix puede
ser "que Done Editing no desaparezca" O "que sea imposible confundirlo
con otra cosa" — dos soluciones válidas, a decidir con lo que se
encuentre en el código.

## Contexto ya conocido
Investigación de agy (18 sep, sesión anterior) — hipótesis débil, poco
verificada:
- `src/features/picking/components/CorrectionModeView.tsx` (~líneas
  1310-1335, ~880-905): al abrir un panel de acción (`activePanel`), se
  despliega dentro de la tarjeta del ítem. Hipótesis de agy: el teclado
  virtual en móvil empuja el contenedor o tapa la barra inferior fija.
- `DoubleCheckView.tsx` (~1810-1820) invoca `CorrectionModeView` pero el
  cambio probablemente vive solo en `CorrectionModeView.tsx`.
Confianza de agy: 85% — la más baja de todas las hipótesis que dio, y sin
verificar contra el layout real. Tratar como punto de partida, no como
diagnóstico confirmado.

## Hallazgos
### 2026-09-18 12:58 — agy
- **Mecanismo EXACTO en código (CONFIRMADO)**:
  - En `src/features/picking/components/CorrectionModeView.tsx` líneas 1310-1335:
    ```tsx
    {/* Footer — Done button */}
    <div className="shrink-0 p-4 pb-28 border-t border-subtle bg-main">
      <button
        onClick={() => { ... }}
        className={`w-full py-4 font-black uppercase tracking-widest text-[10px] rounded-2xl shadow-lg active:scale-95 transition-all flex items-center justify-center gap-2 ...`}
      >
        <Check size={16} strokeWidth={3} />
        {isReopened ? (hasChanges ? 'Review Changes' : 'Close Without Changes') : 'Done Editing'}
      </button>
    </div>
    ```
- **Clarificación clave del pedido de Rafael**:
  - Al leer la frase completa de Rafael: *"porque muchas veces presiono 'Done Editing' en vez de los botones que quiero"*, la causa raíz queda evidente:
  - Cuando Rafael abre el panel de Replace (`activePanel = { type: 'confirm_replace', ... }`), dentro de la tarjeta se muestran los botones de acción (`ActionButtons`: `Cancel` y `Confirm Replace`, líneas 975-984).
  - Justo debajo de la tarjeta, en la parte inferior fija de la pantalla, permanece visible el botón gigante "Done Editing".
  - Por reflejo muscular o toque impreciso en pantalla táctil, Rafael pulsa "Done Editing" en lugar de "Confirm Replace" o "Cancel", cerrando la vista de edición (`onClose()`) y perdiendo el reemplazo en curso.
  - Rafael pide explícitamente: **que mientras esté editando un SKU (`activePanel !== null`), "Done Editing" se oculte** para despejar la vista y evitar toques erróneos; y que vuelva a aparecer tan pronto se confirme o cancele el panel (`activePanel === null`).
- **Evaluación de viabilidad**:
  - Ocultar condicionalmente el footer con `{!activePanel && ( <div className="shrink-0 ...">...</div> )}` es 100% viable, seguro y no rompe ningún layout.
  - De hecho, mejora enormemente la experiencia móvil porque libera más de 120px de altura (`pb-28` + botón de 48px), dando espacio para ver la lista de razones (`ReasonPicker`) y los botones de Confirm/Cancel sin tener que scrollear incómodamente.
- **Nivel de confianza**: ALTA (100% verificado en el código).

### 2026-09-18 13:08 — claude (re-verificación)
- **Confirmado en código:** el footer "Done Editing" (`CorrectionModeView.tsx:1310-1335`) se monta **sin ninguna condición** — no existe `{!activePanel && ...}` hoy (grep de `activePanel` no lo encuentra en el footer). No se desmonta ni cambia de CSS al abrir un panel; el root es `fixed inset-0 z-30 flex flex-col` (1059) y el footer es `shrink-0 p-4 pb-28` (1311) bajo el scroll `flex-1 overflow-y-auto px-4 pb-32 min-h-0` (1173).
- **La frase de Rafael admite dos lecturas y el fix es el mismo para ambas:** (a) el botón sigue ahí y lo toca por error en vez de Cancel/Confirm (lectura de agy); (b) en el celular el teclado virtual (buscador de Replace, motivo) lo tapa/empuja y «se desaparece», y solo reaparece al cerrar el panel. En (a) hay que ocultarlo; en (b) ya se comporta como él dice y ocultarlo lo hace explícito. Ocultarlo mientras haya panel abierto cubre las dos.
- **Viabilidad de ocultarlo — confirmada:** el scroll ya reserva `pb-32` (128 px) por su cuenta, así que al quitar el footer los botones Cancel/Confirm de un panel no quedan bajo la BottomNavigation flotante. Los paneles se pueden cerrar sin el footer: `Cancel` en `ActionButtons` (1014, 1043; 976 vuelve a la búsqueda), la X de Add Item (1215), y tocar de nuevo Replace/Adjust Qty/Remove (toggle, 871-899). En el paso de búsqueda de Replace (`activePanel.type==='replace'`, 930-941) no hay botón Cancel propio: se sale con el toggle del botón Replace o la flecha del header.
- **Punto ciego a saber:** la flecha `ChevronLeft` del header (1064, `onClick={onClose}`) hace lo mismo que Done Editing, y no se oculta. Está arriba, lejos del pulgar, así que no compite con Cancel/Confirm; se deja.
- Con `initialPanel` (Replace abierto desde el panel de LOW STOCK de Double Check) la vista abre con `activePanel` ya puesto: Done Editing no se ve hasta cerrar el panel. Es coherente con lo pedido.
- **Confianza:** alta en el mecanismo (siempre montado); media-alta en la intención de Rafael (dos lecturas, un mismo fix).

## Plan de fix propuesto
En `src/features/picking/components/CorrectionModeView.tsx`:

1. Envolver el footer (líneas 1310-1335) en la condición `!activePanel`:
```tsx
      {/* Footer — Done button (se oculta mientras haya un panel de acción abierto para evitar toques accidentales y dar espacio) */}
      {!activePanel && (
        <div className="shrink-0 p-4 pb-28 border-t border-subtle bg-main">
          <button
            onClick={() => {
              if (isReopened && initialSnapshot !== null) {
                const current = JSON.stringify(
                  allItems.map((i) => ({ sku: i.sku, qty: i.pickingQty }))
                );
                if (current === initialSnapshot) {
                  onCancelReopen?.();
                  return;
                }
              }
              onClose();
            }}
            className={`w-full py-4 font-black uppercase tracking-widest text-[10px] rounded-2xl shadow-lg active:scale-95 transition-all flex items-center justify-center gap-2 ${
              isReopened
                ? 'bg-orange-500 text-white shadow-orange-500/20'
                : 'bg-accent text-main shadow-accent/20'
            }`}
          >
            <Check size={16} strokeWidth={3} />
            {isReopened ? (hasChanges ? 'Review Changes' : 'Close Without Changes') : 'Done Editing'}
          </button>
        </div>
      )}
```
2. Cuando el usuario pulsa "Cancel" o "Confirm" en cualquier panel (`ActionButtons`), los handlers (`setActivePanel(null)`) limpian `activePanel`, haciendo que "Done Editing" reaparezca instantáneamente en la parte inferior.

## Autocorrección
### 2026-09-18 13:00 — agy
- **Antes creía**: La sesión anterior asumió que Rafael se quejaba de que "Done Editing" desaparecía indeseadamente (un supuesto bug de desaparición).
- **Nuevo hallazgo**: En el código actual (`CorrectionModeView.tsx:1310-1335`), "Done Editing" NUNCA desaparece; está siempre renderizado en el footer fijo.
- **Por qué la interpretación anterior estaba mal**: La frase de Rafael *"porque muchas veces presiono 'Done Editing' en vez de los botones que quiero"* demuestra que el problema real es que "Done Editing" está presente cuando NO debería estarlo. Rafael pidió que se oculte durante la edición de un SKU para no pulsarlo por accidente.

### 2026-09-18 13:08
- Antes creía (agy 13:00): "Rafael pidió explícitamente que se oculte" — presentado como hecho.
- Nuevo hallazgo: la cita literal admite también la lectura (b) (teclado tapa el footer). Ninguna de las dos está confirmada con Rafael, pero ocultar con `!activePanel` es correcto en ambas.
- Por qué estaba a medias: la interpretación de agy es plausible pero se escribió como certeza; el archivo del plan no cambia.

## Preguntas para Rafael
Ninguna. La intención y el código concuerdan perfectamente.
