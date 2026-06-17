# Sales Order — Client Script Analysis

Source: Frappe instance `kaitet-group.upande.com`. All 19 Client Scripts with `dt = "Sales Order"` (view = Form). Two are mislabeled and actually bind to other doctypes (noted below). Enabled flag: y = enabled (1), n = disabled (0).

The most important consolidated output — the field show/hide/required/read-only logic across all scripts — is the table at the very end.

---

## 1. Autofill Sales Order By Specification  (enabled: y)

**Triggers**
- `Sales Order Item`: `custom_line` (spec picked → load `Specifications` doc and populate), `custom_number_of_boxes`, `custom_packrate`, `custom_packrate_mixed_box` (all recompute ordered qty).
- `Sales Order`: `onload`, `refresh`, `customer` (all call `set_spec_query`), `validate`.

**What it does**
Spec-driven population of the items grid. Picking `custom_line` (a `Specifications` link) fills item rows: `Mono Box` → one straight line per box item (multi-variety prompts a MultiCheck dialog); `Mixed Box` → prompts for source warehouse / boxes and generates grouped mix rows. Delivery warehouse resolved from `SO Warehouse Mapping "Roses-MAP"`. Re-entrancy guarded by `SPEC_AUTOFILL_BUSY`.

**Field show/hide & state logic**
- `set_query('custom_line', 'items', ...)` — restricts the spec link picker on each item row to `filters: { customer: frm.doc.customer }` when a customer is set (else no filter). Not show/hide, but a conditional link filter.
- No `set_df_property`/`toggle_display`/`toggle_reqd`/`toggle_enable`/`.df.hidden`/`.df.reqd`/`.df.read_only` calls. Dialog fields use `reqd: 1` (mix_name, source_warehouse, number_of_boxes) and a dialog `read_only`/`reqd` only inside transient `frappe.ui.Dialog`s, not on the form.

**validate logic**
- Builds `missing[]` = rows where `!it.custom_line && it.item_code`; if any, `frappe.msgprint` warning "Please select a Specification for row(s)…" (warning only, does not block submit).

**Methods called**
- `frappe.db.get_doc('Specifications', row.custom_line)`
- `frappe.db.get_doc('SO Warehouse Mapping', 'Roses-MAP')` (via `load_roses_map`)
- `frappe.db.get_value('Item', code, 'item_name')` (via `fetch_item_names`)
- `frappe.db.exists('Packrate', pr)` (only sets `custom_packrate` if the Packrate record exists)
- No custom server methods.

**Child-table behavior (items / Sales Order Item)**
- Mono fill: first chosen variety fills the triggering row; extras via `frm.add_child('items')`. Sets per row: `item_code`, `item_name`, `custom_length`, `custom_box_type`, `uom` (`Bunch (n)` derived from `stems_per_bunch`), `custom_packrate` (if Packrate exists), `warehouse` (from Roses-MAP if `custom_source_warehouse` present), plus detail payload below. Sets directly (not via set_value): `custom_line`, `custom_mixed_box=0`, `custom_mix_group=''`.
- Mixed fill: removes the triggering placeholder row, then `frm.add_child('items')` per variety; sets `item_code, item_name, uom, custom_line, custom_mixed_box=1, custom_mix_group (next group #), custom_mix_name, custom_packrate_mixed_box (=pack_rate), custom_number_of_boxes, custom_length, custom_box_type, custom_ordered_quantity (=packrate×boxes), custom_truck=0, custom_farm (derived from source), custom_source_warehouse, warehouse (Roses-MAP), stock_qty, qty (=stems/uom factor)`.
- `set_ordered_qty`: `custom_ordered_quantity = packrate × custom_number_of_boxes` (mixed uses `custom_packrate_mixed_box`, mono uses `custom_packrate`).
- Detail payload set on every row: `custom_cut_stage, custom_defoliation_length, custom_bud_counts, custom_consumables_charge, custom_documentation_fee, custom_certificate_of_origin, custom_with_flower_food (0/1 from Flower Food consumable), custom_sleeve_description (matched from Sleeve desc), custom_labels_description_on_sleeve`.
- Form-level: `custom_ftnft` set from spec; `show_box_tally` alerts running boxes/stems totals.

---

## 2. OPL Connections to SO  (enabled: y)

**Triggers**: `Sales Order`: `refresh`.

**What it does**
Adds a blue "Sales Tracker" dropdown button to the form toolbar with two items: "Order Pick List" (routes to `Order Pick List` list filtered by `sales_order = frm.doc.name`) and "Farm Pack List" (routes to `Farm Pack List` list filtered by `custom_sales_order = frm.doc.name`).

**Field state logic**: none (pure UI/toolbar manipulation via jQuery/Bootstrap dropdown).
**Methods called**: none server-side; uses `frappe.set_route` / `frappe.route_options`.
**Child-table behavior**: none.

---

## 3. Autopopulate Week Number  (enabled: y)

**Triggers**: `Sales Order`: `delivery_date`.

**What it does**: When `delivery_date` set, computes ISO week number (local `getWeekNumber`) and sets `custom_week`.

**Field state logic**: none. **Methods called**: none. **Child-table**: none.

---

## 4. Autopopulate Farm and Business Unit (SO)  (enabled: y)

**Triggers**: `Sales Order`: `custom_sales_order_type`.

**What it does**
On `custom_sales_order_type` change: if "Yoghurt" → set `company="Karen Roses"`, `custom_farm="Karen"`, `custom_business_unit="Westwood Yoghurt"`. If "Roses" → `company="Karen Roses"`, `custom_farm=""`, `custom_business_unit="Roses"`. (Overlaps with #19 "Sales order autopopulate"; both enabled.)

**Field state logic**: none (value-setting only, not show/hide). **Methods**: none.
**Child-table**: refreshes the items grid and each grid row (`frm.fields_dict.items.grid.refresh()` + per-row `refresh()`), no data changes.

---

## 5. SO target warehouse Population  (enabled: y)

**Triggers**: `Sales Order Item`: `custom_source_warehouse`, `item_code`.

**What it does**
Only when `frm.doc.custom_sales_order_type == "Roses"` and the row has a `custom_source_warehouse`: looks up `SO Warehouse Mapping "Roses-MAP"`, finds the mapping row matching the source warehouse, and sets `row.warehouse` to its `delivery_warehouse`. The `item_code` handler is a duplicate "in case it was missed". `frappe.throw` on missing mapping/items/delivery warehouse.

**Field state logic**: none (writes `row.warehouse`). **Methods**: `frappe.db.get_doc("SO Warehouse Mapping", "Roses-MAP")`.
**Child-table**: sets `row.warehouse` (target/delivery warehouse) on the triggering item row.

---

## 6. Update Source Warehouse  (enabled: y)

**Triggers**: `Sales Order`: `custom_business_unit`.

**What it does**: If `custom_business_unit == "Westwood Yoghurt"` → set header `set_warehouse = "Yoghurt Store Karen - KR"`.

**Field state logic**: none. **Methods**: none. **Child-table**: none.

---

## 7. Autopopulate Truck Details  (enabled: y)

**Triggers**: `Sales Order`: `custom_truck_details`. `Sales Order Item`: `items_add`.

**What it does**: When header `custom_truck_details` set, copies it to `custom_truck` on every item row. On adding a new item row, if `custom_truck_details` is set, copies it to that new row's `custom_truck`.

**Field state logic**: none. **Methods**: none.
**Child-table**: writes `custom_truck` on all rows (and on newly added rows).

---

## 8. Set Price On SO  (enabled: y)

**Triggers**: `Sales Order Item`: `item_code`, `custom_length`.

**What it does**
On item_code/length change, if `item_code && custom_length && customer && currency`: looks up `Price By Length` matching customer+currency+item_code+length; sets `stock_uom_rate = rate` and `rate = rate × conversion_factor`. If none found, sets `stock_uom_rate = 0`.

**Field state logic**: none. **Methods**: `frappe.call({ method: "frappe.client.get_value", doctype: "Price By Length", … fieldname:["rate"] })`.
**Child-table**: sets `stock_uom_rate`, `rate` on the row.

---

## 9. Rate based on Length  (enabled: n — DISABLED)

**Triggers**: `Sales Order Item`: `custom_length`.

**What it does**
On length change (if `item_name && custom_length && price_list_currency && currency`): calls custom server method to fetch a length-based price from the selling price list; converts by `plc_conversion_rate` if price-list currency ≠ doc currency; sets `price_list_rate`, `base_price_list_rate`, `stock_uom_rate`, `amount` (= rate × qty). Falls back to "Standard Selling" price list, then to `price_list_rate = 0` with a msgprint.

**Field state logic**: none. **Methods (custom server)**: `upande_kaitet.api.item_length_price.get_length_price` (args: item_name, length, currency=`price_list_currency`, price_list).
**Child-table**: sets `price_list_rate, base_price_list_rate, stock_uom_rate, amount` on the row.

---

## 10. Amount Calc Based on IGP  (enabled: n — DISABLED)

**Triggers**: `Sales Order Item`: `custom_length`, `item_code`. `Sales Order`: `refresh`, `onload`.

**What it does**
Forces manual pricing. On length/item change, zeroes `rate`, `stock_uom_rate`, `amount` and msgprints "No price found… Please set a price to proceed!". On item_code (after 300ms) also makes the grid `amount` column editable. (Item-group price lookup is commented out.)

**Field show/hide & state logic**
- `cur_frm.fields_dict.items.grid.toggle_enable("amount", true)` — makes child-grid `amount` column EDITABLE; on `item_code` (after 300ms), on `refresh`, and on `onload`. Condition: unconditional (always, when this script runs).

**Methods**: none active (commented). On `onload` also sets header `ignore_pricing_rule = 1`.
**Child-table**: zeroes `rate/stock_uom_rate/amount`; toggles `amount` column enable.

---

## 11. Bed Sampling Script  (enabled: y) — ⚠ MISLABELED: binds to `Bed Sampling Form`, NOT Sales Order

**Triggers**: `Bed Sampling Form`: `refresh` (empty), `onload`.

**What it does**: On a new Bed Sampling Form, clears `growth_stages` child table and seeds 7 fixed stages (Fresh cut, Rice stage, Pea stage, Bean stage, Ball stage, Colour Break, Harvest).

**Relevance to Sales Order: NONE** (dt is set to Sales Order but the script targets a different doctype, so it never runs on Sales Order forms).

---

## 12. Auto Populate Lead Status  (enabled: y) — ⚠ MISLABELED: binds to `Lead`, NOT Sales Order

**Triggers**: `Lead`: `refresh`, `status`.

**What it does**: Maps Lead `status` → `custom_lead` (lead type), e.g. Open→Cold Lead, Replied→Warm Lead, Opportunity/Quotation→Hot Lead, Converted→Customer.

**Relevance to Sales Order: NONE** (targets Lead doctype).

---

## 13. Mixed Box Dialog  (enabled: n — DISABLED)

**Triggers**: `Sales Order Item`: `item_code`.

**What it does**
When `row.item_code == "Mix Box"`, opens a "Create Mixed Box" dialog (packrate, no_of_boxes, read-only stems_in_box, and a `box_items` table of varieties). Validates total stems == packrate, then inserts a `Box Mix` doc, sets `custom_box_mix` on the row, and (if `custom_source_warehouse` set) creates + submits a `Stock Entry` Material Receipt for the varieties. Live recalculation of total stems via MutationObserver + debounced handlers; clamps bunch counts so total can't exceed packrate.

**Field show/hide & state logic** (all inside the transient dialog, not the form):
- Dialog field `stems_in_box`: `read_only: 1` (always read-only — computed).
- Dialog field `packrate`: `reqd: 1, read_only: 0`.
- Dialog field `no_of_boxes`: `reqd: 1, read_only: 0`.
- Dialog field `box_items` (Table): `reqd: 1`; child col `item_code` `reqd:1`, `total_stems` `read_only:1`.
- No form-level `set_df_property`/`toggle_*`.

**Methods**: `frappe.client.insert` (Box Mix), `frappe.client.insert` (Stock Entry / Material Receipt), `frappe.client.submit` (the Stock Entry).
**Child-table**: sets `custom_packrate`, `custom_number_of_boxes`, `custom_box_mix` on the SO item row; reads `custom_source_warehouse`, `frm.doc.custom_farm`.

---

## 14. Show Shelf and Qty Shelved  (enabled: n — DISABLED)

**Triggers**: `Sales Order Item`: `custom_length`.

**What it does**: On length change (if `item_code && custom_length`), calls a custom server method to list shelves holding that item/length and msgprints the matching shelves + stem qtys.

**Field state logic**: none. **Methods (custom server)**: `upande_kaitet.server_scripts.get_shelf_for_item.get_shelves_for_item` (args: item_code, custom_length, farm=`frm.doc.custom_farm`).
**Child-table**: read-only of `item_code`, `custom_length`; no writes.

---

## 15. Consignee Select Dialog  (enabled: y)

**Triggers**: `Sales Order`: `refresh`, `custom_delivery_point`, `customer`.

**What it does**
Intercepts clicks on the `custom_shipping_agent` and `custom_consignee` link fields to open custom selection dialogs instead of the default link picker. Shipping agent options come from `Delivery Point.shipping_agent` child table (requires `custom_delivery_point` set first); consignee options from `Customer.custom_consignees` child table (requires `customer` set first). Selecting verifies existence (if the field is a Link) and sets the value. Clears `custom_shipping_agent` when `custom_delivery_point` changes; clears `custom_consignee` when `customer` changes.

**Field show/hide & state logic**
- No `set_df_property`/`toggle_*`. It reads `frm.fields_dict.custom_shipping_agent.df.fieldtype`/`.df.options` and `custom_consignee.df.fieldtype`/`.df.options` to decide Link-verification — does not modify them.
- Behavioral gating: shipping-agent dialog blocked unless `custom_delivery_point` set ("Please select a Delivery Point first"); consignee dialog blocked unless `customer` set ("Please select a Customer first").

**Methods**: `frappe.db.get_doc("Delivery Point", …)`, `frappe.db.get_doc("Customer", …)`, `frappe.db.exists(<doctype>, selected)`.
**Child-table**: none on SO items; reads child tables of Delivery Point and Customer.

---

## 16. Calculate Quantity from Packrate and Boxes  (enabled: y)

**Triggers**
- `Sales Order Item`: `custom_packrate`, `custom_number_of_boxes`, `uom`, `item_code`.
- `Sales Order`: `refresh` (adds custom buttons).

**What it does**
Straight-box qty engine: `qty = (custom_packrate × custom_number_of_boxes) / uom_factor`, `stock_qty = packrate×boxes` — only for non-mixed rows (`if (row.custom_mixed_box) return`). On item_code, fetches `stock_uom/item_name/item_group` and only overrides `uom` for item_group "Spray Roses". Also provides the full multi-group Mixed Box wizard (Add / Edit Mixed Boxes buttons), localStorage draft persistence, reverse-extraction of existing mix rows, and validation (packrate==sum of stems_per_box, unique mix names, per-variety length/qty/box-count checks).

**Field show/hide & state logic**
- `frm.add_custom_button('Add Mixed Boxes', …, 'Actions')` — always.
- `frm.add_custom_button('Edit Mixed Boxes', …, 'Actions')` — ONLY shown when `frm.doc.items.some(r => r.custom_mixed_box)` (i.e., the order already has mixed-box rows). This is a conditional toolbar button (closest thing to a show/hide rule).
- Dialog table col `uom`: `read_only: 1`. Wizard "Clear all groups"/Next-group buttons hidden/disabled in edit mode (`.hide()`, `.prop('disabled', …)`, `.toggle(...)`) — dialog UI only.
- No form-field `set_df_property`/`toggle_*`.

**Methods**: `frappe.db.get_value('Item', item_code, ['stock_uom','item_name','item_group'])`; `frappe.client.get_list` (Item → sales_uom/item_name for the wizard).
**Child-table (items)** — extensive:
- Straight rows: sets `qty`, `stock_qty`, `item_name`, conditionally `uom` (Spray Roses).
- Wizard apply (`apply_mixed_boxes_aggregated`): strips empty rows (`frm.doc.items.filter(r => r.item_code)`); on add, removes all `custom_mixed_box` rows then re-adds; on edit, removes only rows whose `custom_mix_group` ∈ edited groups, then re-adds. Per added row sets: `item_code, item_name, uom, custom_mixed_box=1, custom_mix_group, custom_mix_name, custom_packrate_mixed_box(=stems_per_box), custom_number_of_boxes, custom_length, custom_box_type, custom_ordered_quantity, custom_truck=0, custom_source_warehouse, warehouse (from get_warehouses(farm)), stock_qty, qty`.
- `get_warehouses(farm)`: Karen → source "Karen Available for Sale - KR" / target "Karen Graded Sold - KR"; Kapkolia → "Ravine Available for Sale - KR" / "Ravine Graded Sold - KR".

---

## 17. Add OrderName Suffix  (enabled: y)

**Triggers**: `Sales Order`: `on_submit`.

**What it does**
On submit, if `name && custom_order_name`: appends the SO number suffix (last hyphen segment, e.g. "00517" from "SO-2026-00517") to `custom_order_name` (replacing an existing trailing number if present), via `frappe.client.set_value` on the submitted doc, then `reload_doc`.

**Field state logic**: none. **Methods**: `frappe.client.set_value` (Sales Order.custom_order_name).
**Child-table**: none.

---

## 18. Fetch Price List Data  (enabled: y)

**Triggers**
- `Sales Order`: `customer`, `currency`, `custom_event`, `onload_post_render`, and custom event `apply_customer_pricing`.
- `Sales Order Item`: `item_code`, `custom_length`, `items_add`.

**What it does**
Customer-embedded pricing. Reads `Customer.custom_customer_pricing` child table; for each item row matches on `variety==item_code && stem_length==custom_length && currency==doc.currency` (and `event==custom_event` for event pricing). Event price takes priority; falls back to standard `rate`. Sets `rate`, `price_list_rate`, `discount_percentage=0`, then triggers `calculate_taxes_and_totals`.

**Field state logic**: none. **Methods**: `frappe.db.get_doc('Customer', frm.doc.customer)`.
**Child-table**: sets `rate`, `price_list_rate`, `discount_percentage` on matched rows; iterates all `frm.doc.items`.

---

## 19. Sales order autopopulate  (enabled: y)

**Triggers**: `Sales Order`: `custom_sales_order_type`.

**What it does**
On `custom_sales_order_type`, sets `company`, `custom_farm`, `custom_business_unit` from a mapping table:
- Westwood Yoghurt → Karen Roses / Karen / Westwood Yoghurt
- Roses → Karen Roses / "" / Roses
- Westwood Milk → Karen Roses / Kapkolia / Westwood Milk
- Westwood Poultry → Karen Roses / "" / Westwood Poultry
- Endebess Coffee → Kaitet Ltd / "" / Endebess Coffee
- Lokitela Orchards → Kaitet Ltd / "" / Lokitela Orchards

(Superset of #4; both are enabled and bind the same trigger.)

**Field state logic**: none (value setting). **Methods**: none.
**Child-table**: refreshes grid + each row only.

---

# CONSOLIDATED: Field show / hide / required / read-only / enable conditions

There are **no `set_df_property` / `toggle_display` / `toggle_reqd` / `.df.hidden` / `.df.reqd` / `.df.read_only` calls on actual Sales Order form fields anywhere.** The conditional UI state across all scripts consists of: (a) one grid-column enable toggle, (b) conditional toolbar buttons, (c) conditional link-field query filters, (d) behavioral gating of click handlers, and (e) `reqd`/`read_only` on transient dialog fields. All are tabulated below (form-level first, then dialog-scoped).

| # | Script | Field / element | State applied | Condition / trigger | Mechanism |
|---|--------|-----------------|---------------|---------------------|-----------|
| 10 | Amount Calc Based on IGP (DISABLED) | items grid column `amount` | becomes **editable/enabled** | always — on `refresh`, `onload`, and `item_code` (after 300ms) | `frm.fields_dict.items.grid.toggle_enable("amount", true)` |
| 16 | Calculate Quantity from Packrate and Boxes | toolbar button **"Edit Mixed Boxes"** | **shown** | only when `frm.doc.items.some(r => r.custom_mixed_box)` (order has mixed-box rows) | `frm.add_custom_button(..., 'Actions')` guarded by `has_mixed` |
| 16 | Calculate Quantity from Packrate and Boxes | toolbar button **"Add Mixed Boxes"** | shown | always (refresh) | `frm.add_custom_button(..., 'Actions')` |
| 2 | OPL Connections to SO | toolbar button **"Sales Tracker"** dropdown | shown | always (refresh) | `frm.add_custom_button` + jQuery dropdown |
| 1 | Autofill SO By Specification | item row link `custom_line` | **filtered** to customer's specs | when `frm.doc.customer` set (else unfiltered) | `frm.set_query('custom_line','items', {filters:{customer}})` |
| 15 | Consignee Select Dialog | field `custom_shipping_agent` (click) | custom picker **gated** (blocked) | blocked unless `frm.doc.custom_delivery_point` is set | click handler `if(!custom_delivery_point) msgprint+return` |
| 15 | Consignee Select Dialog | field `custom_consignee` (click) | custom picker **gated** (blocked) | blocked unless `frm.doc.customer` is set | click handler `if(!customer) msgprint+return` |
| 15 | Consignee Select Dialog | `custom_shipping_agent` | **cleared** ('') | when `custom_delivery_point` changes (and agent was set) | `frm.set_value('custom_shipping_agent','')` |
| 15 | Consignee Select Dialog | `custom_consignee` | **cleared** ('') | when `customer` changes (and consignee was set) | `frm.set_value('custom_consignee','')` |
| 13 | Mixed Box Dialog (DISABLED) | dialog field `stems_in_box` | **read-only** | always (computed total) | dialog field `read_only: 1` |
| 13 | Mixed Box Dialog (DISABLED) | dialog field `packrate` | **required**, editable | always | `reqd: 1, read_only: 0` |
| 13 | Mixed Box Dialog (DISABLED) | dialog field `no_of_boxes` | **required**, editable | always | `reqd: 1, read_only: 0` |
| 13 | Mixed Box Dialog (DISABLED) | dialog table `box_items` | **required** | always | `reqd: 1` |
| 13 | Mixed Box Dialog (DISABLED) | dialog child col `item_code` | **required** | always | `reqd: 1` |
| 13 | Mixed Box Dialog (DISABLED) | dialog child col `total_stems` | **read-only** | always (computed) | `read_only: 1` |
| 16 | Calculate Quantity… (Mixed wizard) | dialog fields `mix_name, farm, packrate, number_of_boxes, box_type` | **required** | always | `reqd: 1` |
| 16 | Calculate Quantity… (Mixed wizard) | dialog table cols `item_code, custom_length, stems_per_box, number_of_boxes, ordered_quantity` | **required** | always | `reqd: 1` |
| 16 | Calculate Quantity… (Mixed wizard) | dialog table col `uom` | **read-only** | always | `read_only: 1` |
| 16 | Calculate Quantity… (Mixed wizard) | dialog farm link | **filtered** to `custom_handles_sales=1` | always | `get_query` filter |
| 16 | Calculate Quantity… (Mixed wizard) | "Clear all groups" link, "Next Group" button | **hidden/disabled** | when `edit_mode` (and on last group) | `.hide()` / `.prop('disabled')` / `.toggle()` |
| 1 | Autofill SO By Specification (mixed dialog) | dialog fields `mix_name, source_warehouse, number_of_boxes` | **required** | always | `reqd: 1` |

## Consolidated: value-population (auto-set) field rules — non-show/hide, but key conditional logic to replicate

| Trigger field | Sets | Condition |
|---|---|---|
| `custom_sales_order_type` (#4, #19) | `company`, `custom_farm`, `custom_business_unit` | per type map (Roses, Yoghurt, Westwood Milk/Poultry, Endebess Coffee, Lokitela Orchards) |
| `custom_business_unit` (#6) | header `set_warehouse="Yoghurt Store Karen - KR"` | when `=="Westwood Yoghurt"` |
| `delivery_date` (#3) | `custom_week` | ISO week of delivery_date |
| `custom_truck_details` (#7) | every row `custom_truck`; new row `custom_truck` | when header value set |
| item `custom_source_warehouse` / `item_code` (#5) | row `warehouse` = delivery_warehouse from Roses-MAP | only when `custom_sales_order_type=="Roses"` and source set |
| item `item_code`/`custom_length` (#8) | row `stock_uom_rate`, `rate(=rate×conversion_factor)` | when item_code+custom_length+customer+currency present (Price By Length) |
| item `custom_length` (#9, DISABLED) | `price_list_rate, base_price_list_rate, stock_uom_rate, amount` | when item_name+length+price_list_currency+currency present |
| item `custom_length`/`item_code` (#10, DISABLED) | row `rate/stock_uom_rate/amount = 0` + msgprint | always (forces manual pricing) |
| item `item_code`/`custom_length`/`items_add`, header `customer/currency/custom_event` (#18) | row `rate, price_list_rate, discount_percentage=0` | matched in `Customer.custom_customer_pricing`; event price > standard |
| item `custom_packrate`/`custom_number_of_boxes`/`uom` (#16) | row `qty`, `stock_qty` | only when NOT `custom_mixed_box`, and packrate+boxes+uom set |
| item `item_code` (#16) | row `uom` = stock_uom | only when item_group == "Spray Roses" |
| item `custom_line` (#1) | full spec payload (see #1) | when spec selected; path by `box_assortment` |
| `on_submit` (#17) | `custom_order_name` (+ SO number suffix) | when name + custom_order_name present |

## Custom / notable server methods referenced
- `upande_kaitet.api.item_length_price.get_length_price` (#9, disabled)
- `upande_kaitet.server_scripts.get_shelf_for_item.get_shelves_for_item` (#14, disabled)
- `frappe.client.get_value` → `Price By Length` (#8)
- `frappe.client.insert` → `Box Mix`, `Stock Entry` (Material Receipt) + `frappe.client.submit` (#13, disabled)
- `frappe.client.set_value` → Sales Order.custom_order_name (#17)
- `frappe.client.get_list` → Item (#16)
- `frappe.db.get_doc` → `Specifications`, `SO Warehouse Mapping` (Roses-MAP), `Customer`, `Delivery Point` (#1, #5, #15, #18)
- `frappe.db.get_value` / `frappe.db.exists` → `Item`, `Packrate`, address/consignee verification (#1, #15, #16)

## Notes / caveats for porting
- **Two scripts are mislabeled** (`dt="Sales Order"` but bind a different doctype): #11 Bed Sampling Script (→ `Bed Sampling Form`) and #12 Auto Populate Lead Status (→ `Lead`). They do NOT execute on Sales Order; ignore for SO behavior.
- **Overlapping/competing scripts** (all enabled, may double-fire): #4 vs #19 both on `custom_sales_order_type`; pricing scripts #8 (`Price By Length`) and #18 (`Customer.custom_customer_pricing`) both fire on `item_code`/`custom_length` and write `rate` — order of execution matters. #1 and #16 both compute ordered qty / handle mixed boxes.
- The reactive qty engine (#16) intentionally skips mixed rows; #1 sets qty/stock_qty directly for mixed rows.
