# Sales Order — Server Scripts & Custom Fields Analysis

Source: kaitet-group.upande.com (FAC, read-only). Date: 2026-06-15.
Purpose: enumerate everything that must run / be evaluated when creating a Sales Order, so the behaviour can be faithfully replicated outside the Frappe desk form.

---

## PART A — Server-script behaviours on SO save / submit

### A.1 DocType Event Server Scripts (reference_doctype = Sales Order)

9 total; **4 enabled**, 5 disabled. Listed by trigger.

| Name | Event | Enabled | Summary |
|---|---|---|---|
| Enforce Ordered Stems Non-zero | **Before Save** | YES | Validation / throw |
| Reject Reason | **Before Save** | YES | Workflow audit (no real effect on create) |
| Shopify Sales Order Default UOM | **Before Save** | YES | Sets UOM on Shopify orders |
| Create Work Order for Consumables | **Before Submit** | YES | Side effect: creates+submits Work Orders |
| CRM Activity - Sales Order Submitted | **After Submit** | YES | Side effect: creates CRM Activity Log |
| Create Standing Order | Before Insert | no (disabled) | Would create Standing Order |
| Auto-Create Missing Stem Length Bin | Before Submit | no (disabled) | Stock-bin hotfix |
| create shopify stock entry | Before Submit | no (disabled) | Stock Entry for Shopify |
| Edit shopify sales order | After Save | no (disabled) | Shopify field mapping |

#### MUST run on SAVE (Before Save) — all enabled

1. **Enforce Ordered Stems Non-zero** (validation, can THROW)
   - Condition: `doc.custom_sales_order_type == "Roses"`.
   - For every item where `item_code != "Mix Box"`: if `custom_ordered_quantity == 0` → `frappe.throw("Row {idx}: Ordered Stems field cannot be zero…")`.
   - **Replication rule:** for Roses SOs, every non-"Mix Box" line must have `custom_ordered_quantity > 0` or save is blocked.

2. **Shopify Sales Order Default UOM** (field setter)
   - Condition: `doc.shopify_order_id` or `doc.shopify_order_number` present.
   - Forces every item `uom = "Stems"` and `stock_uom = "Stems"`. (rest of script commented out.) Irrelevant for normal/desk-created roses orders.

3. **Reject Reason** (workflow audit only)
   - Note: defines `execute(doc, method)` but is a plain Before Save script — the `def` body is effectively dead unless invoked; it only matters in the "Rejected by Sales Manager" workflow transition. Adds a workflow comment / throws if rejecting without a reason. **Not relevant to creating an SO.**

#### MUST run on SUBMIT (Before Submit) — enabled

4. **Create Work Order for Consumables** (SIDE EFFECT — creates docs)
   - For each item where `item.custom_consumables_charge` is truthy:
     - Reads production item from BOM `"BOM-Consumables WR0054-001"`.
     - Creates a **Work Order** (company "Karen Roses", qty = item.qty, wip/fg = `Karen Graded Sold - KR`, source = `Karen Packhouse Store - KR`) and `submit()`s it.
   - **Replication rule:** submitting a Roses SO that has any line with `custom_consumables_charge = 1` triggers automatic Work Order creation per such line. Hard-coded warehouses/BOM/company.

#### Runs AFTER SUBMIT — enabled

5. **CRM Activity - Sales Order Submitted** (SIDE EFFECT — creates CRM log; wrapped in try/except so never blocks)
   - Inserts a `CRM Activity Log` (activity_type "Sales Order Submitted", reference to the SO, customer, subject/summary with grand_total + item count). Non-fatal.

#### Disabled (do NOT fire today, but document intended logic)

- **Create Standing Order** (Before Insert): if `custom_is_standing_order`, upserts a `Standing Order` (customer, frequency, daily_time/weekly_day/day_of_month), computes `next_order_date`, links back via `doc.custom_standing_order`.
- **Auto-Create Missing Stem Length Bin** (Before Submit): hotfix that auto-creates / tops-up `Stem Length Bin` rows so stock-reservation passes; logs interventions.
- **create shopify stock entry** (Before Submit) and **Edit shopify sales order** (After Save): Shopify-only warehouse/farm mapping + Stock Entry.

> There is **no enabled `validate` / `before_save` script that sets pricing, qty, warehouses, farm, week, spec fields**. All of that autofill/pricing/qty logic lives in **Client Scripts** (see A.3) — it runs in the browser only, so any non-desk SO creator must reproduce it server-side.

### A.2 Whitelisted API Server Scripts the SO UI calls

These are `script_type = API` (the `doctype_event = "Before Insert"` shown is a Frappe quirk for API scripts and is irrelevant). Relevant ones:

- **`confimSalesOrderItem`** (Confirm Sales Order Item) — partial farm-confirmation engine.
  - Args (form_dict): `sales_order`, `line_no` (idx), `processing_location` (Farm), `action` in {confirm,unconfirm,get_confirmations}, `stems`.
  - Edits the **parent-level** `custom_confirmed_stems_table` (child doctype **Confirmed Stems**, rows: `sales_order_item`, `farm`, `stems`).
  - Validates: total confirmed across farms for a line cannot exceed `custom_ordered_quantity`. stems=0 removes the row. Saves with `flags.ignore_validate_update_after_submit=True` (works on submitted SOs). Returns per-line bookings + totals.

- **`getSalesOrder`** (Sales Order API) — POST `{customer, delivery_date?}`; returns SO headers + items (read-only listing).

- **`clearOplAllocations`** (Clear OPL Allocations) — cleanup: resets SO-Item alloc flags (`custom_fully_allocated=0`, `custom_stock_available=0`, `custom_opl=""`), deletes `Bucket Allocation Status` for those SO/varieties, force-deletes the OPL. Repair tool, not part of create.

- **`issueBucketToSaleOrderItem`**, **`getReadySaleOrderItemsData`**, **`fetchSalesAllocationPlanningData`**, **`updateOplSchedule`** — downstream allocation/packing/coldstore APIs, not part of SO creation. (Allocation reads `Shelf`/`Shelf Item`/`Confirmed Stems`; farms filtered by `Farm.custom_handles_sales = 1`.)

- No server-side `getSpec…` autofill API exists. Spec autofill is a **client script** (A.3).

### A.3 Client Scripts (browser-only) that drive SO creation — MUST be replicated server-side for non-desk creation

All enabled on Sales Order / Form view unless noted.

1. **Autofill Sales Order By Specification** — single source of truth for spec-driven population.
   - On item `custom_line` (Link → `Specifications`) change: loads the `Specifications` doc and applies it.
   - `box_assortment == "Mono Box"` → fills a straight line per box item (extra box items become their own rows).
   - `box_assortment == "Mixed Box"` → prompts source-warehouse/boxes, generates grouped mix rows sharing `custom_mix_group`.
   - Delivery (target) warehouse resolved from **`SO Warehouse Mapping` "Roses-MAP"** (`source_warehouse → delivery_warehouse`).
   - Farm derived from source warehouse string: contains "Karen"/"KARN"→Karen; "Ravine"/"Kapkolia"/"KAPK"→Kapkolia.
   - Sets item detail fields from spec: `custom_cut_stage`, `custom_defoliation_length`, `custom_bud_counts`, `custom_consumables_charge`, `custom_documentation_fee`, `custom_certificate_of_origin`, `custom_with_flower_food` (from consumables map), `custom_sleeve_description` (Karen Branded / Clear Sleeve), `custom_labels_description_on_sleeve`.
   - `custom_ordered_quantity = packrate × number_of_boxes` (mono: `custom_packrate`; mixed: `custom_packrate_mixed_box`).
   - SO `validate`: warns (does not block) if any line with an item_code has no `custom_line` spec.

2. **Calculate Quantity from Packrate and Boxes** — on `custom_packrate` / `custom_number_of_boxes` / `uom` change (straight boxes only, skips mixed): `stems = packrate × boxes`; `qty = stems / uom_factor` where uom_factor parsed from `"... (N)"`; sets `qty` and `stock_qty = stems`. On `item_code` change fetches `item_name`/`stock_uom`; only overrides `uom` for item_group "Spray Roses".

3. **Autopopulate Farm and Business Unit (SO)** — on `custom_sales_order_type`: Yoghurt → company "Karen Roses", farm "Karen", business_unit "Westwood Yoghurt"; Roses → company "Karen Roses", farm "", business_unit "Roses".

4. **Update Source Warehouse** — on `custom_business_unit == "Westwood Yoghurt"`: `set_warehouse = "Yoghurt Store Karen - KR"`.

5. Others (fetch full scripts before porting): **Set Price On SO**, **Fetch Price List Data** (pricing), **Autopopulate Week Number** (`custom_week`), **Autopopulate Truck Details**, **SO target warehouse Population**, **Add OrderName Suffix**, **Consignee Select Dialog**, **OPL Connections to SO**, **Auto Populate Lead Status**, **Sales order autopopulate**, **Bed Sampling Script**. Disabled: Rate based on Length, Amount Calc Based on IGP, Mixed Box Dialog, Show Shelf and Qty Shelved.

### A.4 Net "must run on create" checklist for a non-desk SO creator (Roses)

1. Header: `custom_sales_order_type` (reqd), `custom_business_unit` (reqd), `custom_farm` (reqd), `custom_order_name` (reqd for Roses BU), `custom_consignee` (reqd for Roses BU). Company "Karen Roses".
2. Each line: resolve spec (`custom_line`) → spec-detail fields; set `custom_packrate`/`custom_number_of_boxes` → compute `custom_ordered_quantity = packrate×boxes`, `stock_qty = stems`, `qty = stems / uom_factor`; resolve source + delivery warehouse via "Roses-MAP"; derive farm. `custom_number_of_boxes` is reqd; `custom_length` mandatory for Roses; `custom_ordered_quantity` mandatory for Roses non-"Mix Box".
3. On save the **Enforce Ordered Stems Non-zero** server validation will THROW if any non-"Mix Box" Roses line has ordered qty 0.
4. On submit: **Create Work Order for Consumables** auto-creates Work Orders for lines with `custom_consumables_charge`; **After submit** a CRM log is created.
5. Pricing must be set (client-side today) — replicate Set Price On SO / Fetch Price List Data.

---

## PART B — Custom field condition tables

Conventions: DEP = `depends_on` (show/hide), MAND = `mandatory_depends_on`, ROD = `read_only_depends_on`, reqd/ro/hidden = static flags, FETCH = `fetch_from`. `parent.` refers to the Sales Order in child-row evals.

### B.1 Sales Order — custom fields (54 total; breaks omitted)

| fieldname | label | type (options) | static | depends_on | mandatory_depends_on | read_only_depends_on | fetch_from / default |
|---|---|---|---|---|---|---|---|
| custom_sales_order_type | Sales Order Type | Select (Roses, Yoghurt, Milk, Poultry, Avocados, Coffee, Shopify Roses) | reqd | — | — | — | — |
| custom_business_unit | Business Unit | Link/Business Unit | reqd | — | — | — | — |
| custom_farm | Farm | Link/Farm | reqd | — | — | — | — |
| farm | Farm | Link/Farm | — | — | — | — | — |
| custom_order_name | Order Name | Data | reqd | `doc.custom_business_unit == "Roses"` | — | — | — |
| custom_consignee | Consignee | Link/Consignee | reqd | `doc.custom_business_unit == "Roses"` | — | — | — |
| custom_consignee_country | Consignee Country | Data | — | `doc.custom_business_unit == "Roses"` | — | — | FETCH custom_consignee.country |
| custom_statescountry | Customer Country | Data | — | `doc.custom_business_unit == "Roses"` | — | — | FETCH customer.territory |
| custom_incoterms | Incoterms | Link/Incoterm | — | `doc.custom_business_unit == "Roses"` | — | — | — |
| custom_company_flo_id | Company FLO ID | Data | — | `doc.custom_business_unit == "Roses"` | — | — | — |
| custom_customer_flo_id | Customer FLO ID | Data | — | `doc.custom_business_unit == "Roses"` | — | — | — |
| custom_mode_of_transport | Mode Of Transport | Select (Air, Sea Freight) | — | `doc.custom_business_unit == "Roses"` | — | — | — |
| custom_remote_truck_details | Remote Truck Details | Data | — | `doc.custom_business_unit == "Roses"` | — | — | — |
| custom_shipping_agent | Shipping Agent | Link/Shipping Agent | — | `doc.custom_business_unit == "Roses"` | — | — | — |
| custom_delivery_point | Delivery Point | Link/Delivery Point | — | `doc.custom_business_unit == "Roses"` | — | — | — |
| custom_event | Event | Select (Valentine's Day, Mother's Day, Women's Day) | — | `doc.custom_business_unit == "Roses"` | — | — | — |
| custom_available_stock | Available Stock | Float | — | `doc.custom_business_unit == "Roses"` | — | — | — |
| custom_ftnft | FT/NFT | Select (FT, NFT) | hidden | `doc.custom_business_unit == "Roses"` | — | — | — |
| custom_reason_for_rejected_sales_order | Reason for Rejected SO | Small Text | — | `doc.custom_business_unit == "Roses"` | — | — | — |
| custom_s_number | S_Number | Data | — | `doc.custom_business_unit == "Roses"` | `doc.custom_sales_order_type == "Roses"` | — | — |
| custom_total_stock_qty | Total No of Stems | Int | — | `doc.custom_sales_order_type == "Roses" \|\| doc.custom_sales_order_type == "Spray Roses"` | — | — | — |
| custom_stock_available | Stock Available | Check | — | `doc.custom_sales_order_type == "Roses"` | — | — | — |
| custom_priority | Priority | Data | — | `doc.custom_sales_order_type == "Roses"` | — | — | — |
| custom_truck_details | Remote Truck Details | Data | — | `doc.custom_sales_order_type == "Roses"` | `doc.custom_sales_order_type == "Roses"` | — | — |
| custom_frequency | Frequency | Select (Daily, Weekly, Monthly) | — | `doc.custom_is_standing_order == 1` | `doc.custom_is_standing_order == 1` | — | — |
| custom_daily_time | Daily Time | Time | — | `doc.custom_frequency == "Daily"` | `doc.custom_frequency == "Daily"` | — | — |
| custom_weekly_day | Weekly Day | Select (Mon…Sun) | — | `doc.custom_frequency == "Weekly"` | `doc.custom_frequency == "Weekly"` | — | — |
| custom_day_of_month | Day of Month | Int | — | `doc.custom_frequency == "Monthly"` | `doc.custom_frequency == "Monthly"` | — | — |
| custom_is_standing_order | Is Standing Order | Check | — | — | — | — | — |
| custom_standing_order | Standing Order | Link/Standing Order | ro | — | — | — | — |
| custom_standing_order_ref | Standing Order Ref | Link/Standing Order | ro | — | — | — | — |
| custom_packhouse_stage | Packhouse Stage | Select ( , Upcoming, In Progress, Ready) | — | — | — | — | DEFAULT "Upcoming" |
| custom_material_transfer_created | Material Transfer Created | Check | ro | — | — | — | — |
| custom_stock_allocated | Stock Allocated? | Check | — | — | — | — | — |
| custom_confirmed_stems_table | Confirmed Stems Table | Table/Confirmed Stems | — | — | — | — | — |
| custom_bunch_specifications | Bunch Specifications | Table/SO Spec Item | hidden | — | — | — | — |
| custom_box_type | Box Type | Link/Box Type | — | — | — | — | — |
| custom_line_code | Line Code | Data | — | — | — | — | — |
| custom_expected_delivery_date | Expected Delivery Date | Date | — | — | — | — | — |
| custom_comment | Comment | Small Text | — | — | — | — | — |
| custom_week | Week | Data | — | — | — | — | — |
| rejection_reason | Rejection Reason | Small Text | hidden, ro | — | — | — | — |
| workflow_state | Workflow State | Link/Workflow State | hidden | — | — | — | — |
| custom_delivered | Delivered | Check | hidden | — | — | — | — |
| shopify_order_id / shopify_order_number / shopify_order_status | Shopify Id/Number/Status | Small Text | ro | — | — | — | — |

> Note: the **"Spray Roses"** sales-order-type value is referenced in several DEP evals (e.g. custom_total_stock_qty) but is **not** in the `custom_sales_order_type` option list (which has "Roses", "Yoghurt", "Milk", "Poultry", "Avocados", "Coffee", "Shopify Roses"). So those `|| "Spray Roses"` branches never fire from this field today — likely legacy.

### B.2 Sales Order Item — custom fields (47 total)

| fieldname | label | type (options) | static | depends_on | mandatory_depends_on | read_only_depends_on |
|---|---|---|---|---|---|---|
| custom_number_of_boxes | Number of Boxes | Int | reqd | — | — | — |
| custom_ordered_quantity | Ordered Stems | Float | — | — | `parent.custom_sales_order_type == "Roses" && doc.item_code != "Mix Box"` | — |
| custom_length | Length | Link/Stem Length | — | `parent.custom_sales_order_type == "Roses" \|\| parent.custom_sales_order_type == "Roses"` (dup) | `parent.custom_sales_order_type == "Roses"` | — |
| custom_packrate | Packrate | Link/Packrate | — | — | `doc.custom_stock_entry_type == "Roses"` | — |
| custom_packrate_mixed_box | Packrate Mixed Box | Int/Packrate | — | — | `doc.custom_stock_entry_type == "Roses"` | — |
| custom_truck | Truck | Data | — | — | `parent.custom_sales_order_type == "Roses"` | — |
| custom_source_warehouse | Source Warehouse | Link/Warehouse | — | `parent.custom_sales_order_type == "Roses" \|\| parent.custom_sales_order_type == "Spray Roses"` | — | `parent.custom_sales_order_type == "Yoghurt"` |
| custom_box_label | Box Label | Data | — | `doc.custom_sales_order_type == "Roses" \|\| doc.custom_sales_order_type == "Spray Roses"` | — | `parent.custom_sales_order_type == "Yoghurt"` |
| custom_box_id | Box ID | Int | — | — | — | `parent.custom_sales_order_type == "Yoghurt"` |
| custom_reserve_status | Reserve Status | Select (Reserved, Not Reserved, Insufficient Stock) | — | `parent.custom_sales_order_type == "Roses" \|\| parent.custom_sales_order_type == "Spray Roses"` | — | — |
| custom_reserved_qty | Reserved Qty | Float | — | `parent.custom_sales_order_type == "Roses" \|\| parent.custom_sales_order_type == "Spray Roses"` | — | — |
| custom_farm (Item) | Farm | Data | — | `parent.custom_sales_order_type == "Roses" \|\| parent.custom_sales_order_type == "Spray Roses"` | — | — |
| custom_amount_stems | Amount (Stems) | Currency | — | `parent.custom_sales_order_type == "Roses" \|\| parent.custom_sales_order_type == "Spray Roses"` | — | — |
| custom_total_stems | Total Stems | Float | ro | — | — | — |
| custom_available_quantity | Available Stems | Float | ro | — | — | — |
| shopify_item_discount | Shopify Discount per unit | Float | ro | — | — | — |
| custom_opl | OPL | Link/Order Pick List | — | — | — | — |
| custom_stock_available | Stock Available | Check | — | — | — | — |
| custom_fully_allocated | Fully Allocated | Check | — | — | — | — |
| custom_allocated_qty | Allocated Qty(Stems) | Int | — | — | — | — |
| custom_mixed_box | Mixed Box | Check | — | — | — | — |
| custom_box_mix | Box Mix | Link/Box Mix | — | — | — | — |
| custom_mix_name / custom_mix_group | Mix Name / Mix Group | Data | — | — | — | — |
| custom_processing_location | Processing Location | Link/Farm | — | — | — | — |
| custom_line | Specification | Link/Specifications | — | — | — | — |
| custom_line_code | Line Code | Data | — | — | — | — |
| custom_flower_food | Flower Food | Link/Item | — | — | — | — |
| custom_with_flower_food | With Flower Food? | Check | — | — | — | — |
| custom_sleeve_description | Sleeve Description | Select (Karen Branded, Clear Sleeve) | — | — | — | — |
| custom_defoliation_length | Defoliation Length | Select (10,12,15,20,25,WHOLE) | — | — | — | — |
| custom_bud_counts | Bud Counts | Data | — | — | — | — |
| custom_cut_stage | Cut Stage | Select (1.5-2, 2-2.5, 2.0-3.0, 2.5-3.0) | — | — | — | — |
| custom_labels_description_on_sleeve | Labels Description on Sleeve | Data | — | — | — | — |
| custom_certificate_of_origin | Certificate of Origin | Check | — | — | — | — |
| custom_documentation_fee | Documentation Fee | Check | — | — | — | — |
| custom_consumables_charge | Consumables Charge | Check | — | — | — | — |
| custom_confirmed_box_quantity | Confirmed Box Quantity | Int | — | — | — | — |
| custom_box_quantity | Box Quantity | Int | — | — | — | — |
| custom_truck_details | Truck Details | Data | — | — | — | — |
| custom_delivery_point | Delivery Point | Link/Delivery Point | — | — | — | — |
| custom_box_type | Box Type | Link/Box Type | — | — | — | — |
| custom_certificate / farm (Link) / custom_mix_group | misc | — | — | — | — | — |

> Gotchas in the data: `custom_length` DEP is `"Roses" || "Roses"` (duplicate — effectively just Roses). `custom_packrate`/`custom_packrate_mixed_box` MAND keys on `doc.custom_stock_entry_type` (a field that is NOT a Sales Order Item custom field per this list) — likely never true, so those are effectively optional. `custom_box_label` DEP uses `doc.custom_sales_order_type` (the field lives on parent, not the child row) so that eval is unreliable; the parallel ROD uses `parent.`.

### B.3 Child custom doctypes

- **Confirmed Stems** (`custom_confirmed_stems_table` on Sales Order): no Custom Fields (it's a standalone custom doctype). Used fields per `confimSalesOrderItem` and the planning SQL: `sales_order_item` (Link to SO Item row name), `farm` (Link/Farm), `stems` (Float). parenttype="Sales Order", parentfield="custom_confirmed_stems_table".
- **SO Spec Item** (`custom_bunch_specifications`, hidden): no Custom Fields. Schema not readable (no FAC permission to its doctype).
- **Customer Spec Multiselect Item**: no Custom Fields.

---

## Appendix — methods to fetch when porting pricing/qty (not yet captured in full)
Client Scripts: `Set Price On SO`, `Fetch Price List Data`, `Autopopulate Week Number`, `Autopopulate Truck Details`, `SO target warehouse Population`, `Add OrderName Suffix`, `Consignee Select Dialog`, `Sales order autopopulate`. (The qty/spec/farm/warehouse ones are fully summarised in A.3.)
