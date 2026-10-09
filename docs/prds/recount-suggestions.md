# Recount que llega al personal, y contar con el scanner — estudio (idea-263)

> 9 oct 2026. Rafael: «AS400 no es la verdad absoluta y no debe usarse para reconciliar. Necesito
> una manera de sugerir recount al personal y agregar estos: 03-4623BL, 03-4635MN, 03-4637MN,
> 03-4638RD y 03-4639MN». Y después: «Casi nadie entra a recount, debemos trabajarlo ahora mismo y
> además debemos prepararnos para poder hacer el recount o conteo en general con el scanner comprado».

## 1) Lo que hay hoy, y por qué no sirve

- **Stock Count** (menú → Stock Count, `/stock-count`) es una pantalla a la que hay que ir a
  propósito. Rafael: casi nadie entra.
- **No cuenta.** Al marcar un SKU como verificado, `syncVerifiedToDb`
  (`StockCountScreen.tsx:364`) guarda `counted_qty = lo que dice el sistema`. Nadie escribe un
  número, así que `variance` siempre sale 0 y el historial afirma conteos que nunca pasaron.
- **Ningún SKU puede quedar pendiente** para que lo cuente otra persona.
- **El scanner** es la Zebra ET401 con DataWedge: escribe como un teclado y manda ENTER, sin SDK
  (5 oct 2026, `scan-serials.md`). En Stock, `useTypeToSearch` ya escucha teclas sin un campo
  enfocado.
- **Qué hay en una caja para leer:** el SKU **no** viene en barras; el UPC sí, pero PickD sólo lo
  tiene guardado para **21 de 660** bicis con stock (`sku_metadata.upc`); y el QR de fábrica no es
  único (R15). **Un disparo es una caja**: con la pistola es la persona quien decide cuándo
  disparar, así que se evita el problema de «la misma caja otra vez» que tenía la cámara en video.

## 2) Principio

**El recount va a donde ya está la gente, y contar es un número que escribe quien mira,** o un
disparo por caja. Nunca se copia el número del sistema.

## 3) Propuesta en tres piezas

### A. La cola (`recount_requests`)

Cada petición guarda: `sku`, `location` (nula = todas sus filas), `reason` (en inglés, lo lee el
piso), quién la pidió y cuándo, y quién la cerró y cuándo. Hay una sola abierta por SKU y ubicación.
**Se cierra cuando alguien cuenta ese SKU, nunca por reloj.** Los 5 SKUs de hoy entran como semilla.

### B. Llevarlo a donde está la gente (sin entrar a ninguna pantalla)

1. **Al recoger (pick):** cuando quien recoge está en la ubicación de un SKU con recount abierto,
   después de tomar sus unidades aparece una sola pregunta: **«How many are left here?»**. Escribe
   el número (o dispara la pistola a cada caja) y la petición queda cerrada. Es el «conteo al
   recoger» de cualquier WMS: el momento más barato, porque la persona ya está delante.
2. **En Stock:** el SKU con recount abierto lleva una marca `RECOUNT` en su tarjeta. Al tocarla se
   escribe el número. La tarjeta no cambia de forma; la marca va al estilo de las que ya tiene
   (regla del 7 oct).
3. **En el menú y en Stock Count:** el número de recounts abiertos, para quien sí entra.

### C. Contar de verdad, y con el scanner

1. **El conteo es ciego:** no se enseña el número del sistema hasta después de contar. Si se
   enseña, la gente confirma lo que ve en vez de contar.
2. **Por ubicación:** se cuenta lo que hay en una ROW o estante, SKU por SKU.
3. **Con la pistola:**
   - un disparo suma 1 al SKU de esa caja, con sonido y vibración (`feedbackService`);
   - `−1` deshace;
   - un código que PickD no conoce pregunta **«Which SKU is this?»** y muestra sólo los SKUs de esa
     ubicación; con un toque, PickD guarda ese código para ese SKU, así la siguiente caja ya no
     pregunta. Así se llena `upc` sin una campaña aparte.
4. **Sin la pistola:** un campo de número grande. Para las partes a granel es lo normal: nadie
   dispara 500 cámaras.
5. **Al terminar:** contado contra sistema. Si cuadra, se cierra. Si no cuadra, se aplica el número
   contado (`adjust_inventory_quantity`, acción `CYCLE_COUNT`, con quién y la sesión) y queda en el
   historial con su diferencia.

## 4) Fases

- **F1 (hoy):** la cola, la pregunta al recoger, la marca en Stock y el número en el menú. Stock
  Count deja de copiar el número del sistema (escribir el número contado), con el conteo ciego.
  Semilla: los 5 SKUs. Todo funciona sin la pistola, tecleando.
- **F2 (con la ET401 en mano):** disparo = +1, aprender el código desconocido y probar en el piso
  a 8". El código se puede dejar listo hoy, porque la pistola escribe como un teclado y se prueba
  tecleando el UPC con ENTER.

## 5) ❓ Para Rafael (con respuesta por defecto)

1. ❓ **¿La pregunta al recoger interrumpe al picker?** — **Default: sí, pero una sola pregunta y
   con `Skip`.** Saltarla no cierra la petición.
2. ❓ **¿Conteo ciego?** — **Default: sí.**
3. ❓ **Si el conteo no cuadra, ¿se aplica ya o lo cuenta una segunda persona?** — **Default: se
   aplica ya** (tu regla: la cantidad la pone quien cuenta) y queda en el historial con la
   diferencia. Con diferencias de más de 5 unidades, en vez de aplicarse ya se abre otro recount
   para otra persona.
4. ❓ **¿Quién puede pedir un recount?** — **Default: cualquiera**, y se ve quién lo pidió.
5. ❓ **¿Las ubicaciones tienen una etiqueta con código de barras?** Si la tienen, disparar a la
   etiqueta de la ROW abre su conteo. — **Default: no lo sé; F2 empieza sin eso** (eliges la ROW
   con un toque).
6. ❓ **¿Agrego `03-4516BL` (+1) y `06-4284TL` (+3)?** — **Default: sí.**
7. ❓ **¿Qué motivo llevan los 5 de hoy?** — **Default: `Written by AS400 sync (Sep 14), never
counted`.**

## 6) Lo que no hace

- Nada se cierra ni caduca por tiempo.
- El AS400 nunca pone una cantidad: a lo sumo, su informe sugiere candidatos para la cola.
- La pistola nunca adivina el SKU: si un código es dudoso, se pregunta (R15: un toque cuesta 1 s,
  un error cuesta $150–300).
