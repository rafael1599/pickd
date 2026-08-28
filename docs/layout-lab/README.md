# Layout Lab — the screen's real pieces, draggable, so Rafael lays them out himself

`ship-card.html` is a self-contained page (no build): every element of the Ship order card —
each of the four numbers, each carrier chip, each photo, each button, the header pieces — as a
draggable atom on a card whose width you set (360 / 520 / 800 / 1000 px or a slider). Zero
padding, gaps or markers by default; select, group (Shift + tap → Agrupar), split (✂ Separar),
hide, nudge with the arrow keys. **Copiar estructura** yields the positions as text + JSON.

Why it exists (2026-08-28): proposing layouts in prose produced three rounds of corrections;
the lab produced two layouts (phone and 60 %) Rafael dragged himself and pasted back, and the
card was built exactly that way (idea-168). His two rules for it: **free drag and grouping**, and
**no scaffolding** — "no quiero marking ni padding ni espaciado de ningún tipo por defecto".

## How to use it for another screen

1. Copy `ship-card.html` to `<screen>.html` and replace the `.item` elements inside `#card` with
   that screen's atoms. Keep `data-id` (stable key) and `data-label` (what the structure text
   says). Reuse the PickD look classes or add the screen's own; the item skin must carry no
   outer margin.
2. Put the current layout in `PRESETS.today` (`[id, x, y, hidden?]`) and a starting proposal in
   `PRESETS.proposal`. Positions are pixels from the card's top-left at the given width.
3. Publish it as an artifact (the Artifact tool) **and** attach the file — the artifact viewer's
   iframe rejects synthetic clicks, so Rafael tests the drag himself; the file has no such layer.
4. Ask the open questions **before** building from his structure (what overlaps, what only
   shows conditionally, what moved to a menu).
5. Build exactly the structure he pastes; screenshot the result at his widths; then correct.

The published artifact for the Ship card was "Ship Card Layout Lab"
(https://claude.ai/code/artifact/13d6be03-94a8-4a13-85c2-7c689f844830).
