# Roses Sales Order — Web Form (Packhouse Dashboard)

**Date:** 2026-06-15
**Status:** Design — awaiting user review
**Page slug:** `roses-sales-order` (title: "Roses Sales Order")

## 1. Goal

Replace the ERPNext desk Sales Order form, for the **Roses** flow only, with a custom
Web Page in the packhouse dashboard. Same functionality, better UX — the tedious child
tables are abstracted away into one continuous "fill the order" form. Users can browse,
create, edit, delete and submit Roses Sales Orders. Editing must work on **submitted**
orders too (add/edit/delete rows), which requires bypassing Frappe's docstatus lock,
permissions and document hooks by writing directly to the database.

A "Roses SO" = the standard Sales Order doctype filtered to
`custom_sales_order_type = "Roses"` and `custom_business_unit = "Roses"`. It uses only a
subset of the doctype's fields (see §7).

## 2. Scope

**In scope (v1):**
- List view of Roses SOs with filters.
- Create new SO (draft or submit).
- Edit existing SO — drafts and submitted.
- Add / edit / delete item rows on any SO, including submitted.
- Submit a draft from the page.
- Spec-driven bulk item population + manual single-product entry (Approach A).

**Out of scope:**
- Standing orders, Shopify fields, Yoghurt / non-Roses sales order types.
- Cascading edits to downstream documents (Delivery Notes, Invoices, Pick Lists,
  Work Orders) — see §6 risk.
- Multi-currency editing beyond what Roses orders already use.

## 3. Architecture

Single Web Page (`roses-sales-order`), aph design system, linked in the packhouse
sidebar. One page, two JS-switched views (**List** / **Form**); create and edit share
the Form view.

**Hybrid automation** — instant client feedback, server as source of truth:

| Layer | Responsibility |
|-------|----------------|
| Client JS | Week# from delivery date; qty = `boxes × packrate`; order-name suffix preview; consignee/shipping-agent gating; warehouse-map preview; mixed-box drawer logic; inline required-field validation; totals. |
| Server endpoints | All reads of dropdown data; spec expansion; pricing; **all writes** (create/edit/delete/submit) via direct DB. Server re-applies & validates the maps so client logic can't drift. |

### Server endpoints (Frappe Server Scripts, API type — safe_exec rules: no import/def/`+=`/`.append`; use `x = x + [i]`, `d[k]=v`, `while` loops, `|~|`-joined strings for lists)

- **`soMgrMeta`** — one call returns all dropdown/reference data: customers, varieties
  (items), specifications, packrates, box types, farms, warehouses, price lists,
  consignees, shipping agents, delivery points, settings (takt, maps). Cached client-side
  for the session.
- **`soMgrExpandSpec`** — input: spec name + customer. Output: expanded item rows
  (Mono/Mixed box logic) ready to drop into the form as product cards.
- **`soMgrPrice`** — input: customer + items + length. Output: rates per row (mirrors the
  enabled pricing scripts: price-list / by-length).
- **`soMgrList`** — input: filters (date range, customer, status, farm, week, search).
  Output: list rows (name, order name, customer, delivery date, week, farm, total_qty,
  status, docstatus). Defaults to recent window for speed.
- **`soMgrGet`** — input: SO name. Output: full header + items + linked-doc summary
  (counts of OPLs / Delivery Notes / Invoices) for the downstream check.
- **`soMgrSave`** — the write/finalize endpoint (see §5). Input: full header + items
  payload + mode (draft|submit) + intent (create|update). Direct DB writes, recomputes
  aggregates, returns SO name. Replicates server-side validation we choose to keep.

> Note: standalone child-row inserts/edits/deletes on a submitted parent cannot go
> through `doc.save()` (it raises on submitted docs). The write endpoint uses direct DB
> primitives (`frappe.db.set_value`, child-row direct insert with explicit
> `parent`/`parenttype`/`parentfield`/`idx`/name, `frappe.db.delete`) with
> `ignore_permissions`. If safe_exec lacks a needed primitive for child-row INSERT, the
> fallback is a thin whitelisted method in a custom app (flag during planning).

## 4. UI

### 4.1 List view
Table: Order Name · Customer · Delivery · Week · Farm · Stems · Status · Docstatus.
Filters: customer, status, farm, week, free-text search; date range defaults to recent.
`+ New Sales Order` button. Draft rows → editable form; submitted rows → editable form
(with downstream guardrail, §6). "Duplicate to new" shortcut on any row.

### 4.2 Form view — one continuous form, no visible child grid
- **① Order:** customer, order name (+auto suffix), transaction date, delivery date,
  week# (auto), s_number, farm, daily time, packhouse stage, po_no, price list.
- **② Logistics / export:** consignee (+country), delivery point, shipping agent, mode of
  transport, territory, truck details, remote truck details, payment terms. Gating mirrors
  the doctype `depends_on` (consignee disabled until customer set; shipping agent until
  delivery point set).
- **③ Products:** Approach-A card list + `+ Add product` / `From spec`; live totals
  footer (stems + value); `[Save draft]` and `[Submit ▸]` (submit confirms; warns that
  consumables Work Orders are NOT auto-created since hooks are bypassed — see §6).

Product card: `Variety · Length · BoxType · #boxes · stems · @rate · amount` with edit /
delete. Mixed box shown as an expandable card listing its varieties.

### 4.3 Add-product drawer
User edits only: variety, length, box type, packrate, # boxes, mixed-box toggle
(→ mix group / name / multi-variety picker).
Derived/auto: ordered qty (`boxes × packrate`), uom=Stems, warehouse + source warehouse
(map), truck, reserve status, cost center, delivery date, conversion_factor, amount.

## 5. Write semantics (`soMgrSave`)

1. Accept full payload (header + items array) + mode + intent.
2. **Create:** new SO; apply maps server-side (company/farm/BU from type, warehouse map,
   week, truck details, cost center, reserve status, qty), insert items with correct
   `idx`/naming, recompute aggregates, set docstatus per mode.
3. **Update:** diff items → update changed rows (`frappe.db.set_value`), insert new rows,
   delete removed rows directly. Update header fields directly. **Bypasses docstatus lock
   and all hooks/permissions.**
4. **Always recompute parent aggregates** after row changes: `total_qty`, `total`,
   `net_total`, `grand_total`, `base_total`, `base_net_total`, `base_grand_total`,
   `rounded_total`, `base_rounded_total`. Keeps the document internally consistent even
   though Frappe's machinery is skipped.
5. **Validation we keep (replicated, since hooks won't fire):** Roses non-"Mix Box" items
   must have `custom_ordered_quantity > 0`. Surfaced inline before the round-trip and
   re-checked server-side.
6. Return the SO name + refreshed totals.

## 6. Submitted-order guardrail & risks

**Decision: block if invoiced.** Before saving an edit to a submitted SO, `soMgrGet`
reports linked-doc counts:
- Linked Pick Lists / Delivery Notes only → **warn banner, allow** ("changes won't update
  these N documents").
- Linked **Sales Invoice** present → **block** the save (or require an explicit override
  confirm), because financial reconciliation is hardest there.

**Acknowledged risks (accepted):**
- Direct DB writes do not cascade to downstream docs; SO and its children can diverge.
- DocType-Event hooks (consumables Work Order on submit, CRM activity log, ordered-qty
  guard) do **not** fire on direct writes. The consumables Work Order in particular will
  not be auto-created from this page — documented in the submit confirm dialog.
- No Frappe version/audit trail entry for direct writes (we set `modified`/`modified_by`
  manually so the row timestamp stays truthful).

## 7. Field inventory (from analysis of 40 real Roses SOs)

**Header — always:** customer, customer_name, transaction_date, delivery_date, currency,
conversion_rate, selling_price_list, price_list_currency, plc_conversion_rate,
party_account_currency, custom_sales_order_type(=Roses), custom_business_unit(=Roses),
custom_farm, custom_order_name, custom_week, custom_s_number, custom_truck_details,
custom_daily_time, custom_packhouse_stage, po_no, order_type(=Sales), naming_series,
letter_head, language, title, total_qty, apply_discount_on.

**Header — conditional (export):** custom_consignee, custom_consignee_country,
custom_mode_of_transport, custom_statescountry, territory, customer_address,
address_display, custom_delivery_point, payment_terms_template, total/net_total/grand_total
+ base_*, custom_remote_truck_details, custom_shipping_agent, po_date, customer_group,
contact/shipping_address, custom_event.

**Items — always:** item_code, item_name, description, item_group, qty, uom, stock_uom,
conversion_factor, stock_qty, custom_ordered_quantity, custom_length, custom_truck,
custom_source_warehouse, warehouse, custom_reserve_status, delivery_date,
company_total_stock, cost_center, custom_number_of_boxes.

**Items — conditional:** custom_box_type, custom_packrate, custom_mixed_box,
custom_mix_group, custom_packrate_mixed_box, custom_mix_name, rate/amount + net_*/base_*/
stock_uom_rate/gross_profit, custom_opl, custom_fully_allocated, custom_stock_available,
custom_available_quantity, actual_qty, projected_qty, image, custom_processing_location.

**Excluded (dead/empty in Roses):** custom_box_label, custom_line, item-level
custom_consignee.

**Other child tables:** payment_schedule (auto from payment_terms_template — not
hand-entered), custom_confirmed_stems_table (confirmed orders only — read-only display in
v1), taxes (rare export VAT — display/passthrough only).

## 8. Automation replicated (from the 19 client scripts)

| Behavior | Where |
|----------|-------|
| Week# from delivery date | client + server safety net |
| Farm/BU/company from sales-order type | server (`soMgrSave`) |
| Warehouse + source warehouse map (Roses-MAP) | server |
| Truck details autopopulate | server |
| Order-name suffix | client preview + server |
| Spec → item rows (Mono/Mixed wizard) | `soMgrExpandSpec` |
| Qty = packrate × boxes | client + server |
| Pricing (price-list / by-length) | `soMgrPrice` + server |
| Consignee / shipping-agent click-gating | client |
| "Edit Mixed Boxes" affordance | client (per-card mixed editor) |

Disabled/mislabeled scripts (Rate based on Length, Amount Calc Based on IGP, Mixed Box
Dialog, Show Shelf, Bed Sampling→wrong doctype, Lead status→wrong doctype) are **not**
ported.

## 9. Error handling

- Inline required-field validation before submit (customer, order name, delivery date,
  farm; per-row: length, # boxes, ordered qty for non-mix rows).
- Server throws surfaced as a banner on the relevant section/card.
- Downstream guardrail (§6) blocks invoiced-order saves with a clear message.
- Network/endpoint failures: non-destructive — form state preserved, retry button.

## 10. Deliverables

1. `roses-sales-order` Web Page (HTML/CSS/JS, aph design system) — deployed via FAC.
2. Six server scripts: `soMgrMeta`, `soMgrExpandSpec`, `soMgrPrice`, `soMgrList`,
   `soMgrGet`, `soMgrSave` — versioned locally under `kaitet-web/`.
3. Packhouse sidebar nav entry.
4. (Contingency) thin whitelisted app method if safe_exec can't insert child rows on a
   submitted parent.
