---
name: layout-lab
description: >
  Laboratorio visual de layout: publica un Artifact donde el usuario arrastra los átomos de un
  card o pantalla que YA existe (agrupar, ocultar, ancho, padding) y devuelve una "Estructura
  resultante" en texto que Claude traduce a flex/grid en el componente real. Usar cuando el
  usuario quiera reacomodar visualmente un componente en vez de describirlo con palabras.
  Triggers: "quiero mover cosas del card", "arma un lab del layout de X", "hagamos un
  laboratorio de diseño", "déjame acomodar los elementos", "layout lab", "/layout-lab", y
  cuando el usuario pega un texto que empieza por "Card: N px · padding".
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
  - Artifact
metadata:
  category: web-dev
  tags:
    - layout
    - ui
    - artifact
    - drag-and-drop
---

# layout-lab

Ciclo de dos vueltas: Claude extrae los átomos del componente real → publica el lab →
el usuario acomoda y pega la estructura → Claude la traduce a código. El lab cambia
**dónde** va cada cosa, no cómo se ve: la fidelidad al componente real es lo que hace
válida la decisión.

Cuándo no: diseñar desde cero sin componente (usar `design` / `frontend-design`), o
cambiar colores/tipografía (el lab no captura eso).

## 1. Extraer los átomos (`atoms.html` en el scratchpad)

Leer el componente. **Un átomo = una cosa que el usuario movería por separado**: un
`StatField` (cifra + etiqueta) es un átomo, no dos; una tabla es un átomo; cada chip de
carrier es un átomo porque se reordenan sueltos.

```html
<style> /* CSS de los átomos: puede usar los tokens del template (abajo) */ </style>
<div class="item" data-id="cust" data-label="Cliente"><span class="cust">ATHENS BIKE WORKS</span></div>
```

- `data-id` estable y en kebab-case; `data-label` corto en español: es lo que vuelve en la
  estructura, y es como el usuario y Claude nombran la cosa.
- **Datos reales del proyecto** (un cliente real, SKUs reales), nunca lorem ipsum: el usuario
  decide mejor viendo contenido de verdad.
- Reproducir la apariencia real con el CSS mínimo (tamaños, pesos, colores). Los átomos
  son `white-space: nowrap` por defecto; los multilínea (avisos, tablas) declaran
  `white-space: normal`. Un átomo que debe ocupar todo el ancho usa `width: var(--items-w)`.
- Tokens disponibles: `--bg --card --surface --line --line-soft --text --muted --dim
  --green --blue --orange --purple --sky --amber --rose --heading --body --mono --items-w`.
- 20–40 átomos es el punto dulce. Ejemplo completo: `references/example-ship-card/`.

## 2. Presets (`presets.json`)

```json
{ "today":    { "width": 520, "pad": 0, "pos": [["cust", 0, 110], ["notes", 0, 760, true]], "groups": [] },
  "proposal": { "width": 800, "pad": 0, "pos": [...] } }
```

- **`today` es obligatorio**: cómo se ve el componente hoy. Calcular x/y aproximando el DOM
  actual (columnas → x, filas → y con las alturas reales). No hace falta precisión de píxel:
  es el ancla contra la que el usuario compara.
- `proposal` es opcional (la sugerencia de Claude); sin él, el chip no aparece.
- 4.º valor `true` = oculto. `groups` = listas de ids que se mueven juntos.
- Para iterar sobre un lab anterior: el JSON que cierra la "Estructura resultante" es un
  preset válido; pegarlo como `today`.

## 3. Construir y publicar

```bash
python3 "$SKILLS_PATH/global-skills/layout-lab/scripts/build.py" \
  --title "Ship Card Layout Lab" --key pickd:ship-card \
  --atoms atoms.html --presets presets.json --out lab.html
```

- `--key proyecto:componente` es la clave de `localStorage`: **única por componente**;
  reutilizarla carga las posiciones guardadas de otro lab.
- `--widths "Teléfono 360=360" "40 % · 520=520" …` cuando los anchos relevantes no son los
  genéricos (p. ej. columnas de un split view).
- `--standalone` sólo para abrirlo en local (Chrome headless con `cdp-ui-check`); el
  Artifact no lo necesita. `build.py` valida ids duplicados, átomos sin etiqueta y presets
  que referencian ids inexistentes.
- Publicar `lab.html` con la herramienta Artifact (favicon 🧪). Decirle al usuario: se
  guarda solo en su navegador; cuando termine, «Copiar estructura» y pegarla en el chat.

## 4. Traducir la estructura a código

Contrato completo en `references/structure-format.md`. Reglas de traducción:

| En la estructura | En el componente |
|---|---|
| `Card: W px · padding P px` | Ancho objetivo del layout (360 → mobile-first); `P` → padding del contenedor |
| Cada línea `y=N:` | Una fila: contenedor flex (o fila de grid). El orden dentro de la fila es el de `@x` |
| Separación entre `@x` consecutivos | `gap`; hueco grande o elemento pegado al borde derecho → `justify-between` / `ml-auto` |
| Dos filas con `y` muy cercano | El lab ya las fusiona (umbral 14 px); no inventar filas nuevas |
| `Grupos: [A + B]` | Sub-contenedor propio: en el código también se mueven juntos |
| `Ocultos: …` | Se quitan del componente. Si la acción es destructiva (borrar un botón "Delete"), confirmar |
| JSON final | Sólo para recargar el lab; **nunca** posiciones absolutas en producción |

- Mantener los componentes/clases existentes de cada átomo: se reubica, no se re-estiliza.
- Verificar visualmente al ancho elegido (`cdp-ui-check` o `run`) antes de dar por hecho.
- Si el usuario quiere seguir ajustando: republicar el **mismo** archivo (misma URL) con
  `today` = JSON pegado y la misma `--key`.

## Qué NO hacer

- No inventar átomos que no estén en el componente; si el usuario pide algo nuevo, va como
  átomo etiquetado «(nuevo)».
- No "mejorar" el estilo de los átomos en el lab.
- No guardar `lab.html` en el repo del proyecto: scratchpad + Artifact. Lo durable es el cambio
  de código (y, si sirve, la estructura pegada en el mensaje del commit).
- No editar `template/layout-lab.html` para un lab concreto: todo entra por los slots.
