# Contrato: «Estructura resultante»

Es el texto que genera el botón **Copiar estructura** del lab y que el usuario pega en el
chat. Lo produce `structure()` en `template/layout-lab.html`; si cambia allá, cambiar acá.

## Forma

```
Card: 800 px · padding 0 px
y=0: Nº de orden @0 · Logo carrier @162 · Fecha @200 · Nota reapertura @340
y=44: Estado @0
y=82: Cliente @0
y=120: Dirección @0 · ZIP @420
y=146: Etiqueta carrier @200
y=156: Load / Recipient # @0
y=160: Carrier R+L @200 · Carrier RIST @274 · Carrier PICK UP @348 · Carrier DAYLIGHT @436 · Carrier PAV @536 · Carrier … @608
y=216: E-bike etiqueta @460
y=220: Pallets @0 · Bikes @70 · Parts @150 · Weight @250
y=236: E-bike carton @460 · E-bike modelo @530 · E-bike lbs @620
y=330: Combined order @0 · Picking summary @300 · Reopen @480 · Foto 1 @660 · Foto 2 @708
y=378: Fotos ⋯ @660
y=384: Delete @300
y=460: Aviso litio @0 · Aviso Daylight @320
y=520: Order items @0
Grupos: [Pallets + Bikes + Parts + Weight]
Ocultos: Notas

{"width":800,"pad":0,"pos":[["ordno",0,0],…],"groups":[["n-pallets","n-bikes","n-parts","n-weight"]]}
```

## Semántica

| Línea | Significado |
|---|---|
| `Card: W px · padding P px` | Ancho del card en el que el usuario tomó la decisión y padding interno del contenedor. |
| `y=N: A @x · B @x …` | Una **fila**: todos los átomos visibles cuyo borde superior cae a ≤ 14 px de distancia del primero, ordenados por `x`. `N` es el `top` del primero. |
| `@x` | Borde izquierdo del átomo dentro del card (sin contar el padding). La diferencia entre `@x` consecutivos menos el ancho del anterior ≈ `gap`. |
| `Grupos: [A + B] [C + D]` | Átomos que el usuario agrupó: se mueven juntos y en código van en un sub-contenedor propio. Un átomo no puede estar en dos grupos. Los grupos ya están desplegados en las filas (sus miembros aparecen con coordenadas absolutas). |
| `Ocultos: A, B` | Átomos que el usuario quitó (botón «Ocultar» o Supr). No aparecen en ninguna fila. |
| JSON final | `snapshot()` completo: `{width, pad, pos: [[id, x, y, hidden]…], groups: [[ids]…]}`. Es un preset válido para `presets.json` (`today`). No es una especificación de CSS. |

Notas:
- Las filas son una **lectura** de posiciones absolutas: dos átomos en la misma fila con un
  hueco grande entre ellos suelen significar `justify-between`, no un `gap` de 300 px.
- Un átomo cuyo `@x` coincide con el de la fila anterior indica una columna: si se repite en
  varias filas (`@460` en E-bike etiqueta / carton / modelo / lbs), es un bloque lateral → dos
  columnas en el código, no filas independientes.
- Cuando el usuario cambió el ancho a 360, está diciendo «así en móvil»; si dejó 800 o
  1000, está pensando en escritorio. Si hacen falta ambos, pedirle un lab por ancho.
