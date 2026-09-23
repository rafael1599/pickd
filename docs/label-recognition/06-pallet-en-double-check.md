# El pallet entero en una foto, dentro de Double Check

> 23 sep 2026. Primera vez que el reconocimiento de etiquetas toca una pantalla que abre un
> picker. Fase 1 de dos: **ver lo que la foto dice**. Compararlo con la orden es la fase 2 y
> deliberadamente no está todavía (Rafael: «primero quiero hacer esa funcionalidad y después lo
> conectamos para que compare a la orden»).

## Lo que había, y por qué no servía

«Take Photo» en Double Check leía **sólo códigos QR** (`readBarcodesOffThread(file, { formats:
['QRCode'] })`) y los cruzaba con las líneas de la orden por `parseQRPayload`. Ese QR **lo imprime
PickD**. La caja que llega del contenedor trae etiqueta de fábrica —`MK NO`, `GTIN`, la caja negra
del SKU, el `DESTINATION: U.S.A.`—, así que apuntar la cámara a un pallet real y no sacar nada no
era el caso raro: era el caso. Rafael, 23 sep 2026: «el escanner antiguo que no saca nada».

Lo que sí servía de ese gesto **se queda entero**: la foto se sube a R2, se guarda en
`picking_lists.pallet_photos`, cuenta para `Foto n de m` y **destraba completar la orden**. Eso es
prueba de lo que salió, no reconocimiento.

## Lo que hay ahora

`PalletScanSheet` (`src/features/recognition/components/PalletScanSheet.tsx`): se toma la foto, se
ve **la foto misma, oscurecida**, y encima cada etiqueta que se reconoció, **según se reconoce**.

- **Púrpura es lo que dice la foto. Verde es lo que el catálogo confirma.** Son dos afirmaciones
  distintas y no se funden nunca — la misma regla que el motor sigue campo por campo
  (`recognizeMultiBoxClient`: «un valor que viene del CATÁLOGO y un valor que viene de la FOTO no
  son el mismo dato»).
- **Se pinta sobre la foto, no en una lista debajo**, porque así el operador puede comprobar la
  respuesta sin confiar en ella: el recuadro está alrededor de la etiqueta que tiene delante o no
  está.
- **Sólo se pinta lo que tiene SKU.** Un recuadro sin nombre no le dice nada a nadie.
- **Cada etiqueta aparece cuando termina, no todas al final** (`onBox` en el motor). El catálogo se
  consulta de a una, así que la última puede ir un segundo o dos detrás de la primera; una que ya
  encendió es una respuesta aunque la de abajo siga leyéndose.

## La trampa de las coordenadas

`bbox` viene en píxeles **del lienzo que usó el OCR**, no de la foto. `runClientOcr` reintenta la
imagen girada 90° o 270° cuando la pasada derecha no encuentra anclas, y **nadie mapeaba esas cajas
de vuelta**: invisible mientras el único lector era un resumen de texto, y muy visible en cuanto
alguien dibuja un rectángulo. Por eso el giro viaja en el resultado (`image.rotationUsed`) y se
deshace en `src/lib/recognition/overlayBoxes.ts` — `unmapBoxFromRotation` es la inversa exacta de
`mapBoxToRotation`, y el test lo comprueba con ida y vuelta en los tres giros.

`toOverlayRect` devuelve **porcentajes**, no píxeles: la misma foto mide 4032 px de ancho en el
teléfono que la tomó y 398 px en la hoja que la enseña. Y devuelve **`null` si la foto no reportó su
tamaño**: una etiqueta pintada en el sitio equivocado es peor que una etiqueta sin pintar.

## Qué falta

1. **Comparar con la orden** (fase 2): qué línea cubre cada SKU reconocido, qué falta en el pallet y
   qué hay de más. Es donde el verde pasará a significar «coincide con la orden».
2. `src/features/picking/utils/parseQRPayload.ts` se quedó **sin llamador** al salir el lector de QR.
   No se borró: si la fase 2 quiere leer la etiqueta que PickD imprime, es exactamente esa función.
