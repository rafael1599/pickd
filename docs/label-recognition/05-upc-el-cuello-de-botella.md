# 05 — El UPC es el cuello de botella, y el AS400 no lo va a resolver

_21 sep 2026. Medido contra producción (`xexkttehzpxtviebglei`), no estimado._

## El hecho que cambia el plan

La caja de fábrica Tipo B no trae el SKU en barras: trae el UPC. Toda la
identificación en vivo depende de traducir UPC → SKU. Eso se mide así:

| Medida                                          | Valor                                           |
| ----------------------------------------------- | ----------------------------------------------- |
| SKUs en `sku_metadata`                          | 2 525                                           |
| …con `upc` cargado                              | **11** (0.4 %)                                  |
| SKUs de bici despachados en los últimos 90 días | 172                                             |
| …de esos, con `upc` en la base                  | **1**                                           |
| Pares UPC→SKU que hoy sostienen `/live-check`   | 20, **hardcodeados en `upcCatalogResolver.ts`** |
| `asset_tags` con UPC                            | 6 de 204                                        |

La lectura en vivo funciona hoy porque veinte pares están escritos a mano en el
código fuente. Esa lista no escala a 172 modelos por trimestre, y cada caja que
cae fuera de ella llega a la pantalla como «código leído, SKU no identificado».

## Por qué el AS400 no lo resuelve (verificado, no supuesto)

Se propuso cargar los UPC en masa desde lo que la laptop de bay 2 ya captura.
**No están ahí.** Las 263 capturas de `as400_captures` guardan, por ítem,
exactamente cinco campos:

```
description · pickingQty · sku · sku_metadata{is_bike} · unit_price
```

El `raw_text` confirma por qué: el watchdog captura la pantalla **ORDER
INQUIRY**, que lista `Stock # / W/H / Description / Unit Price / Extend`. El UPC
vive en el maestro de artículos (ITEM INQUIRY), una pantalla que nadie está
capturando. La carga masiva «en 2 minutos» no existe mientras no se capture esa
otra pantalla.

Eso deja tres caminos reales, y conviene no confundirlos:

1. **Capturar la pantalla del item master en bay 2.** Es la única vía que llena
   los 2 525 de golpe. Cuesta un cambio en el watchdog, no en la app.
2. **Un export de Jamis** (si existe un reporte SKU↔UPC). Barato si existe.
3. **Aprender del piso**, que es lo que ya está implementado abajo y no depende
   de nadie más.

## Lo implementado hoy

**Canal de texto en `/live-check`.** Cuando las barras traen un UPC que el
catálogo no conoce, se dispara OCR sobre la retícula (auto al detectar el
código, o a demanda tocando la retícula / el botón OCR). Lee el SKU impreso en
grande, que es lo que el ojo humano usa.

**Aprendizaje del par, con freno.** Si el SKU leído por OCR coincide con uno que
la orden espera, hay dos canales independientes concordando —las barras dieron
el UPC, el texto dio el SKU, y la orden esperaba justo ese SKU— y el par se
guarda en `sku_metadata.upc`. La siguiente caja de ese modelo se lee en 15 ms
sin tocar nada.

Los frenos importan más que la función:

- **Un OCR que no coincide con nada que la orden espera NO se asciende a SKU.**
  La primera versión tomaba el primer candidato «porque era el único que había».
  El OCR confunde 8 con B y 0 con D; eso habría fabricado un SKU que nadie
  verificó, con `confidence: 0.95`, y lo habría escrito en el catálogo de
  producción. Un mapeo equivocado no se nota nunca: la próxima caja de ese
  modelo resuelve en 15 ms, pinta verde, y el operador confirma con un toque una
  bici que sigue en el piso. Es exactamente el falso positivo de $150–$300 más
  el reclamo.
- **`persistSkuUpcMapping` solo rellena un UPC vacío.** Nunca reemplaza uno
  existente; un UPC distinto ya guardado se devuelve como `conflict` y lo decide
  una persona. Tampoco inventa la fila de un SKU que no está en el catálogo.

**El generador de etiquetas ya estaba en sintonía, y ahora cierra el círculo.**
Nuestra etiqueta imprime Code 128 **con el SKU** (`labelLayout.ts:683`), o sea
que nuestras cajas se leen directo, sin catálogo de por medio: son mejores que
las de fábrica. Lo que faltaba era el retorno — el UPC que el operador tecleaba
al imprimir se guardaba en `asset_tags` y moría ahí. Ahora ese mismo UPC se
aprende en `sku_metadata` con las mismas reglas de arriba, así que teclearlo una
vez al imprimir habilita la lectura en vivo de todas las cajas de ese modelo.

## Para el planeador: prioridades de usabilidad a corto plazo (vistas de test)

Ordenadas por cuánta fricción quitan del piso por unidad de trabajo.

1. **Medir el arranque en frío del OCR en el S25 Ultra.** Hay `warmupOcrService()`
   al montar la pantalla, pero nadie midió cuánto tarda la primera lectura real
   ni la segunda. Si la primera cuesta 3 s, el auto-disparo va a sentirse roto
   justo en la caja que más importa. Sin este número las prioridades 2 y 3 se
   deciden a ciegas.
2. **Pantalla de cobertura UPC.** Una vista de test que liste, para la orden
   activa, qué SKUs ya resuelven por catálogo y cuáles van a exigir OCR. Es la
   diferencia entre enterarse frente a la caja y saberlo antes de empezar.
3. **Sembrar los 172 SKUs activos.** Los 20 pares hardcodeados deberían estar en
   la base, no en el código. Migrar esos 20 a `sku_metadata` y dejar que el
   aprendizaje llene el resto con el uso.
4. **Hacer visible lo aprendido.** Hoy el aprendizaje es silencioso salvo el
   toast. Una lista «pares aprendidos en esta sesión» en la vista de test deja
   auditar de un vistazo si el OCR está inventando.
5. **Capturar el item master en bay 2** (punto 1 de los tres caminos). Es el
   único que vuelve irrelevante todo lo demás, y no toca la app — por eso va al
   final de esta lista y al principio de la conversación con quien mantiene el
   watchdog.
6. **`sku_serials` desde `/live-check`.** La tabla por cartón se llena solo
   desde `Add SKU · Foto`; el lector en vivo lee seriales todo el tiempo y no los
   guarda. Es `recordSkuSerial` con `source: 'live_check'`.

## Lo que sigue abierto

- El OCR varía entre dos fotos de la misma etiqueta (3 528 ms vs 7 263 ms, talla
  presente y después ausente). Sospecha: la cascada de rotación dispara en una y
  no en la otra. Sin investigar.
- `preloadFromDatabase` consulta `asset_tags` por `sku` crudo y `sku_metadata`
  por `sku_key` normalizado. Funciona, pero son dos convenciones para la misma
  llave.
