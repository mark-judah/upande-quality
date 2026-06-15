# SO-MAPS — Extracted Sales Order Automation Maps

Source: live Client Scripts on `kaitet-group.upande.com` (fetched via `kaitet-web/fac.sh`), cross-checked against `kaitet-web/reskin/SO-ANALYSIS-client-scripts.md`. Values below are **quoted from the actual scripts / live docs**, not invented.

These are the maps a web port must replicate to reproduce the form's behavior for **Roses** sales orders.

---

## (a) sales-order-type → company / custom_farm / custom_business_unit

Two enabled scripts both fire on `custom_sales_order_type` and both write these three fields:

- **"Sales order autopopulate"** — the SUPERSET map (use this one):

| custom_sales_order_type | company | custom_farm | custom_business_unit |
|---|---|---|---|
| Westwood Yoghurt | Karen Roses | Karen | Westwood Yoghurt |
| Roses | Karen Roses | "" (empty) | Roses |
| Westwood Milk | Karen Roses | Kapkolia | Westwood Milk |
| Westwood Poultry | Karen Roses | "" (empty) | Westwood Poultry |
| Endebess Coffee | Kaitet Ltd | "" (empty) | Endebess Coffee |
| Lokitela Orchards | Kaitet Ltd | "" (empty) | Lokitela Orchards |

- **"Autopopulate Farm and Business Unit (SO)"** — a partial overlap (only `Yoghurt` and `Roses`); note it keys on `"Yoghurt"` (not `"Westwood Yoghurt"`) and sets `custom_farm="Karen"` for it. For Roses it sets the identical values as above. Both scripts are enabled, so both run; for Roses the result is consistent: **company=`Karen Roses`, custom_farm=`""`, custom_business_unit=`Roses`**.

For the Roses port: when type = Roses → set `company="Karen Roses"`, `custom_farm=""` (blank — the farm is determined per-row by source warehouse, see (b)), `custom_business_unit="Roses"`.

---

## (b) Roses-MAP warehouse mapping — how `warehouse` and `custom_source_warehouse` are derived

Two mechanisms exist:

### b1. SO Warehouse Mapping "Roses-MAP" (script "SO target warehouse Population")
Trigger: item-row `custom_source_warehouse` change (and `item_code`, as a redundant safety net).
**Guard:** only runs when `frm.doc.custom_sales_order_type == "Roses"` AND the row has a `custom_source_warehouse`.
Logic: load doc `SO Warehouse Mapping` / name `"Roses-MAP"`; find the child `items` row where `source_warehouse == row.custom_source_warehouse`; set `row.warehouse = that_row.delivery_warehouse`. `frappe.throw` if no mapping / no items / no delivery warehouse.

So `custom_source_warehouse` is **user-selected** on the row; `warehouse` (delivery/target) is **derived** from it via this exact table.

**Live Roses-MAP child table (`SO Warehouse Mapping`, name `Roses-MAP`, business_unit `Roses`, 6 rows) — `source_warehouse → delivery_warehouse`:**

| source_warehouse | delivery_warehouse |
|---|---|
| Ravine Available for Sale - KR | Ravine Graded Sold - KR |
| Karen Available for Sale - KR | Karen Graded Sold - KR |
| Kapkolia Receiving Cold Store - KR | Ravine Graded Sold - KR |
| Karen Receiving Cold Store - KR | Karen Graded Sold - KR |
| KAPK Available for Sale - KR | Ravine Graded Sold - KR |
| KARN Available for Sale - KR | Karen Graded Sold - KR |

(Child doctype: `SO Warehouse Mapping Item`, fields `source_warehouse`, `delivery_warehouse`.)

### b2. Mixed-box wizard `get_warehouses(farm)` (script "Calculate Quantity from Packrate and Boxes")
For mixed-box rows the warehouses are derived from **farm** (not from a selected source warehouse), via a hardcoded function:

| farm | source (custom_source_warehouse) | warehouse (target/delivery) |
|---|---|---|
| Karen | Karen Available for Sale - KR | Karen Graded Sold - KR |
| Kapkolia | Ravine Available for Sale - KR | Ravine Graded Sold - KR |
| (other / blank) | "" | "" |

```js
function get_warehouses(farm) {
    if (!farm) return { source: '', warehouse: '' };
    if (farm === 'Karen')    return { source: 'Karen Available for Sale - KR',  warehouse: 'Karen Graded Sold - KR'  };
    if (farm === 'Kapkolia') return { source: 'Ravine Available for Sale - KR', warehouse: 'Ravine Graded Sold - KR' };
    return { source: '', warehouse: '' };
}
```

Note: length does NOT enter warehouse derivation in either mechanism — warehouse is driven by source-warehouse (b1) or farm (b2), never by length or item.

---

## (c) Truck-details autopopulate ("Autopopulate Truck Details")

- Header field: `custom_truck_details`.
- On `custom_truck_details` change: copy its value to **every** item row's `custom_truck` (`row.custom_truck = frm.doc.custom_truck_details`), then `refresh_field("items")`.
- On `items_add` (new row): if `custom_truck_details` is set, set the new row's `custom_truck = frm.doc.custom_truck_details`.

`custom_remote_truck_details` is **not referenced by any of the fetched scripts** — no autopopulate rule found for it. (Mixed-box rows separately set `custom_truck = 0`, see (g).)

---

## (d) Order-name suffix rule ("Add OrderName Suffix")

Trigger: `on_submit`. Guard: `frm.doc.name && frm.doc.custom_order_name`.
- `so_number = frm.doc.name.split('-').pop()` → last hyphen segment, e.g. `"00517"` from `"SO-2026-00517"`.
- If `custom_order_name` already ends in digits (`/\d+$/`): replace that trailing number with `so_number`.
- Else: append `"-" + so_number`.
- Only writes if the value changed, via `frappe.client.set_value('Sales Order', name, 'custom_order_name', new_order_name)`, then `reload_doc`.

---

## (e) Week-number rule ("Autopopulate Week Number")

Trigger: `delivery_date` change. Sets `custom_week` = ISO-8601 week number of `delivery_date`.
Algorithm (local `getWeekNumber`, ISO week — Thursday-based):
```js
let d = new Date(Date.UTC(y, m, day));
d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));   // shift to nearest Thursday
let yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
let weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
```

---

## (f) The TWO pricing rules — exact rate resolution

Both are enabled and both write `rate` on `item_code`/`custom_length` changes (execution order between them is non-deterministic — a known conflict; the port should pick ONE source of truth).

### f1. "Set Price On SO" — doctype **Price By Length**
Trigger: item `item_code` or `custom_length`. Guard: `row.item_code && row.custom_length && frm.doc.customer && frm.doc.currency`.
Lookup via `frappe.client.get_value`:
- doctype: **`Price By Length`**
- filters: `{ customer: frm.doc.customer, currency: frm.doc.currency, item_code: row.item_code, length: row.custom_length }`
- fieldname: `["rate"]`

On hit (`r.message.rate`):
- `stock_uom_rate = r.message.rate`   (the per-stem rate as stored)
- `rate = r.message.rate * row.conversion_factor`
On miss: `stock_uom_rate = 0` (does not touch `rate`).

So **Price By Length is keyed by (customer, currency, item_code, length)** and yields a single `rate` field; the row `rate` = that × `conversion_factor`.

### f2. "Fetch Price List Data" — embedded in **Customer.custom_customer_pricing** child table
Triggers: SO `customer`/`currency`/`custom_event`/`onload_post_render` + custom event `apply_customer_pricing`; item `item_code`/`custom_length`/`items_add`. Guard: `frm.doc.customer && row.item_code && row.custom_length`.
Loads `frappe.db.get_doc('Customer', customer)` and reads `customer_doc.custom_customer_pricing` (child rows). Matching:
- **Event match (priority):** row where `p.variety === item_code && p.stem_length === custom_length && p.currency === doc.currency && p.event === doc.custom_event && p.event_rate` → `final_rate = p.event_rate`.
- **Standard fallback:** row where `p.variety === item_code && p.stem_length === custom_length && p.currency === doc.currency` → `final_rate = p.rate`.
- No match → return (no change).

On a hit it sets `rate = final_rate`, `price_list_rate = final_rate`, `discount_percentage = 0`, then triggers `calculate_taxes_and_totals` and `refresh_field('items')`.

Child-table `custom_customer_pricing` fieldnames used: `variety`, `stem_length`, `currency`, `event`, `event_rate`, `rate`.

**Note the difference:** f1 multiplies by `conversion_factor` and writes `stock_uom_rate`; f2 writes the raw rate directly to both `rate` and `price_list_rate` and zeroes the discount.

---

## (g) Qty rule ("Calculate Quantity from Packrate and Boxes")

Triggers: item `custom_packrate`, `custom_number_of_boxes`, `uom`, `item_code`.
Straight (non-mixed) rows only — `if (row.custom_mixed_box) return;`. Requires `custom_packrate && custom_number_of_boxes && uom`:
```
stems  = flt(custom_packrate) * flt(custom_number_of_boxes)
factor = extract_uom_factor(uom)        // the (n) in the UOM name, else 1
qty       = stems / factor
stock_qty = stems                       // = packrate * boxes
```
`extract_uom_factor(uom)`: `uom.match(/\((\d+)\)/)` → the integer inside parentheses (e.g. `Bunch (10)` → 10); no match → 1.

`item_code` handler: `frappe.db.get_value('Item', item_code, ['stock_uom','item_name','item_group'])`; always sets `item_name`; **only** overrides `uom = stock_uom` when `item_group === 'Spray Roses'` (other groups keep the bunch UOM set elsewhere).

Mixed-box rows (wizard `apply_mixed_boxes_aggregated`) set, per added row: `item_code, item_name, uom, custom_mixed_box=1, custom_mix_group, custom_mix_name, custom_packrate_mixed_box (= stems_per_box), custom_number_of_boxes, custom_length, custom_box_type, custom_ordered_quantity, custom_truck=0, custom_source_warehouse + warehouse (from get_warehouses(farm), see b2), stock_qty, qty`. Mix group number = `max(existing custom_mix_group) + 1`.

`custom_ordered_quantity` (per row, used by spec/mixed paths) = `packrate × custom_number_of_boxes` (mixed uses `custom_packrate_mixed_box`, mono uses `custom_packrate`).

---

## (h) custom_reserve_status default & cost_center derivation

- **No `custom_reserve_status` field exists on Sales Order** (confirmed via doctype introspection). The only reserve-related field is the standard `reserve_stock` (Check, **default 0**). No script sets it.
- **`cost_center`** (Link → Cost Center, **no default**) is **not derived or set by any of the fetched client scripts**. No cost-center automation found.

---

## Confirmed live field/doctype names (for downstream tasks)

- **Packrate** doctype fields: `packrate` (Int — this IS the stems-per-box value; there is **no** separate "stems" field) and `box_type` (Link → Box Type). Spec autofill only sets `custom_packrate` when `frappe.db.exists('Packrate', pr)`.
- **SO Warehouse Mapping** parent fields: `business_unit`, child table `items` (doctype `SO Warehouse Mapping Item`, fields `source_warehouse`, `delivery_warehouse`). The Roses doc name is `Roses-MAP`.
- **Specifications** doctype fieldnames (relevant): `customer`, `spec_name`, `consumables_charge` (Check), `documentation_charge` (Check), `certificate_of_origin` (Check), `category_code`, `ftnft` (Select FT/NFT), `spec_type`, `cut_stage`, `defoliation_length`, `rubber_band_type`, `rubber_band_distance_1`, `rubber_band_distance_2`, **`box_assortment`** (Select: `Mono Box` / `Mixed Box` — this drives the mono-vs-mixed fill path), child tables `box_items` (doctype `Spec Box Item`) and `consumables` (doctype `Spec Consumable`).
- **Sales Order Item** custom fields referenced across scripts: `custom_line` (Link → Specifications), `custom_length`, `custom_box_type`, `custom_packrate`, `custom_packrate_mixed_box`, `custom_number_of_boxes`, `custom_ordered_quantity`, `custom_mixed_box`, `custom_mix_group`, `custom_mix_name`, `custom_source_warehouse`, `warehouse`, `custom_truck`, `custom_farm`, `stock_uom_rate`, `conversion_factor`.
- **Sales Order** custom header fields: `custom_sales_order_type`, `custom_farm`, `custom_business_unit`, `custom_truck_details`, `custom_week`, `custom_order_name`, `custom_event`, `custom_delivery_point`, `custom_shipping_agent`, `custom_consignee`, `custom_ftnft`.

## Maps whose logic could not be fully determined
- `Spec Box Item` doctype introspection returned an empty field list (the wizard reads `stems_per_box` per the script, but the exact child fieldnames of `Spec Box Item` were not confirmed via introspection — verify before relying on them in a downstream task).
- `custom_remote_truck_details` autopopulate: **no rule found** in the fetched scripts; behavior (if any) is unconfirmed.
- Pricing conflict (f1 vs f2) execution order is non-deterministic and unresolved in the live form; the port must choose one.
