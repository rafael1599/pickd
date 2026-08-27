# Warehouse user flows — who is on which screen, and where the number goes

> For anyone who writes about PickD for the people who use it (the `warehouse-report-writer`
> agent reads this before every report). It describes the **work**, not the code: the screen,
> the person, the decision, and where the result is copied next. Facts marked ❓ are not
> confirmed by Rafael — ask, do not assume. Technical detail lives in `CLAUDE.md`.

## People and where they stand

| Who          | Where                                 | Screens                                                                                                             |
| ------------ | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Pickers      | the floor, phone in hand              | Board → Double Check (verification) → Stock (item detail, register)                                                 |
| Ship station | the FedEx computer and the truck dock | Ship, FedEx Ship Manager (FSM), **Audit Source** ❓ (the paperwork system for non-FedEx loads — confirm what it is) |
| Bay 2 Mac    | receiving desk                        | the watcher (order intake from AS400 PDFs), its Maintenance panel                                                   |
| Rafael       | everywhere                            | builds PickD, reviews every report                                                                                  |
| Roman        | operations lead                       | reads the weekly                                                                                                    |
| Carine       | stakeholder                           | reads the daily progress update                                                                                     |

## Flow 1 — An order arrives (AS400 → Board)

1. The order exists in **AS400** (the ERP). Its paper/PDF lists SKUs as `DD-NNNN` + colour
   (`03-3768BL`; AS400 sometimes prints a third letter, `BLD`, that is a finish, not a bike).
2. The **watcher** on the Bay 2 Mac reads the PDF and creates the order in PickD with its lines,
   the Bill-to customer and the Ship-to, and the AS400 account + ship-to (`0010495 00`) that
   later becomes the **FedEx Recipient ID** (`1049500`).
3. Each line is matched to the catalog by exact SKU. No catalog row → **UNREG**. Not enough
   stock on the shelves → **LOW STOCK**. The same bike under a sibling name with stock is taken
   automatically.
4. The order appears on the **Board** in its lane: **FedEx** or **Regular** (an item over 50 lb
   or five or more bikes → Regular; the operator can drag it to the other lane). Orders that
   wait for stock live under **Waiting for inventory**.

## Flow 2 — Picking and Double Check (the picker)

1. The picker opens the order from the Board; PickD lays out the lines **by pallet** and in
   **ROW order** (the walking order of the aisles; `ROW 43 A` = row + shelf letter).
2. Each line is checked off as it is pulled. A line with a problem shows a badge and, since
   26 Aug, a panel that names the case and offers only the buttons that fit:
   - _same bike, other name_ → swapped alone, with **Undo**;
   - **UNREG** → _Register_ (Bike or Part, form pre-filled), _Replace_, _Remove_;
   - registered, 0 anywhere → _Replace_, _Remove_;
   - reserved by other orders → says which orders; _Replace_, _Remove_;
   - some but not enough → **Take N**, _Replace_, _Remove_.
     Every change asks for a reason; the reason becomes the order's note.
3. Long-press on a line = "where is it really": every location of that SKU, the order's first.
4. **Edit Order** is for deliberate changes (add, swap, adjust) with a reason; it is not the
   place to discover problems any more.
5. Photos of each pallet are taken here. **Ready to double check** → **Complete** moves the order
   to Ship. Two people on one multi-pallet order is _Assist mode_ (planned, idea-155).

## Flow 3 — Ship (the ship station)

The Ship card exists for **four numbers: pallets, bikes, parts, weight**. They are copied into
**Audit Source** (non-FedEx loads) or into **FedEx Ship Manager**; a wrong number there is a wrong
shipment, so the station adds it by hand on a calculator when PickD is wrong (27 Aug 2026,
881303 combined into 881301). Everything else on the card serves those numbers:

- **Order Items** lists the SKUs with location and, since 27 Aug, **Lbs** per line. One click on a
  SKU opens its detail (stock, dimensions, weight, photo) without leaving Ship.
- **Carrier**: only what this order can use — a FedEx order shows FedEx alone; a regular order
  shows R+L and RIST and keeps FedEx under "…". The selected one always shows.
- **Combined orders**: two orders for the same customer ship as one; the card shows both under
  _Combined Order_ and the numbers are the group's, wherever it is opened from.
- **Pallet photos** (two tiles + menu), **Recipient ID** chip on FedEx orders (paste into FSM's
  Recipient ID field and the address fills itself), **Reopen order** (with reason), **Picking
  summary**.
- **Shipped today** keeps the day's shipped orders reachable, filtered by carrier.

FedEx side: FSM imports PickD's **Dimensions** table (one carton per model + size, Replace mode)
and, per shipment, takes the Recipient ID. Lithium (e-bike) shipments need the hazmat label —
see the manuals (`/manuals`).

## Flow 4 — Stock (anyone)

Inventory by **ROW** and shelf letter; **item detail** holds quantity, location, dimensions &
weight, photo, and the Bike / Part type. **Register** a new SKU from here or from Double Check;
the type is chosen by a person, never guessed from the location. **Scratch & Dent** bikes have
their own list and prices. Locations that are not storage (staging, cages, containers) do not
count as space.

## Flow 5 — Reports (Rafael, via the agent)

- **Daily progress update** → Carine, plain text, ≤30 lines, win of the day first.
- **What's new** → the floor, printable, Menu → What's new; one pain story per item, screenshots.
- **Weekly** → Roman, branded PDF.

## Still to confirm with Rafael ❓

- What **Audit Source** is exactly and which of the four numbers it takes (all four? weight and
  pallets only?).
- Whether the ship station and the pickers are the same people on a given day.
- Whether Carine also reads What's new, or only the daily.
