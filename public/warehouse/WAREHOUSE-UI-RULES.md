# WAREHOUSE UI RULES (NON-NEGOTIABLES)

This document contains the strict, mandatory UI and UX rules that must be present across all warehouse visualization screens (`zone.html`, `bay2_pallet_layout.html`, etc.). These are the non-negotiable features defined by the user.

## 1. Dynamic Dimension Inputs (Always Present)
- **Pallet Text Areas:** Every screen must feature input text areas to dynamically change pallet dimensions on the fly.
- **Default Sizes:** Pallets default to **60" Depth (D) × 62" Width (W)**. 
- **Real-time Engine:** Changing these inputs must instantly trigger the `PalletEngine` to recalculate the physics and re-render the SVG map.

## 2. Global Metric Counters
The following metrics must be permanently anchored in the header/top-section of every layout screen in large, highly visible typography:
- **TOTAL PALLETS:** The total capacity of pallets in the current layout.
- **TOTAL BIKES:** Total bike capacity (calculating pallets + loose bike blocks).
- **FAST PICKING:** The number of accessible pallet slots that touch an open floor/aisle.

## 3. Universal Toggles & Orientation
- **Layout Switches:** Every bay must have a toggle (switch) allowing the user to view different structural versions (e.g., `E-W ROWS` vs `N-S ROWS`, or toggling an optional wall hall). This empowers space optimization testing without changing code.

## 4. Visual Interactions & Feedback
- **Universal Hover (Fluorescence):** SVG elements (pallets, racks, halls) must have hover states (glow or opacity changes) universally across all bays to make the map feel alive and readable.
- **Structural Collision Warnings:** If a structural post obstructs a slot or a hall, it must be visually flagged in red (`--bad`), and the "HITS" metric must appear in the UI counting lost slots.

## 5. Navigation & Terminology
- **Return to Map:** A prominent `← MAP` button must always be available to return the user to the master blueprint (`warehouse_map.html`).
- **Nomenclature:** The UI and labels must strictly use the word **"Hall"** instead of "aisle" or "pasillo". Islands/racks are referred to as "blocks" or "rows" (never "islas"). Example: `MAIN HALL`, `EAST HALL`.

## 6. Structural Preferences (Engine Level UI)
- **Wall Preference:** If there is a tie in capacity, the engine must prefer drawing a single row against the wall rather than wasting space on a wall-hugging hall.
- **Anti-Trap Rule:** The engine must enforce that no structural post can be left inside a hall unless there is a minimum of 54" clearance on at least one of its sides.
