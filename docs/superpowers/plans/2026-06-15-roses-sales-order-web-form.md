# Roses Sales Order Web Form — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a `roses-sales-order` Web Page in the packhouse dashboard that lists, creates, edits (incl. submitted), and submits Roses Sales Orders through six safe_exec server endpoints, with all writes going direct-to-DB to bypass docstatus/permission/hook locks.

**Architecture:** Single Web Page (aph design system), two JS-switched views (List / Form). Hybrid automation: client JS for instant UX (qty math, gating, week#), server endpoints as source of truth for reads, spec expansion, pricing, and all writes. Writes use `frappe.db.*` primitives with `ignore_permissions` and recompute parent aggregates for self-consistency.

**Tech Stack:** Frappe/ERPNext (kaitet-group.upande.com), Server Scripts (API type, safe_exec), Frappe Web Page (`main_section_html`), vanilla JS + aph CSS, deployed via FAC MCP HTTP endpoint.

---

## Conventions (read before any task)

**FAC endpoint** — all deploys and endpoint tests use this curl harness. Save it as `kaitet-web/fac.sh` in Task 0:

```bash
#!/usr/bin/env bash
# Usage: fac.sh <tool> <json-args>
# tool: get_document | update_document | create_document | list_documents
TOKEN="${FAC_TOKEN:?export FAC_TOKEN=key:secret}"
URL="https://kaitet-group.upande.com/api/method/frappe_assistant_core.api.fac_endpoint.handle_mcp"
printf '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"%s","arguments":%s}}' "$1" "$2" > /tmp/fac_q.json
curl -s -m 90 -X POST "$URL" -H "Authorization: token $TOKEN" -H "Content-Type: application/json" --data-binary @/tmp/fac_q.json
```

**Calling a server endpoint to test it** (server scripts of type "API" are reachable at `/api/method/<api_method>`):

```bash
curl -s -m 90 "https://kaitet-group.upande.com/api/method/soMgrMeta" \
  -H "Authorization: token $FAC_TOKEN" -G --data-urlencode 'arg=value' | python3 -m json.tool
```

**safe_exec rules (every server script MUST obey):** no `import`, no `def`, no `+=`, no `.append()`, no `frappe.parse_json`, no raw `frappe.db.sql` for writes. Use `x = x + [i]`, `d[k] = v`, `while` loops. Lists arrive as `"|~|"`-joined strings. Every script starts with a failure default and wraps logic in `try/except`:

```python
frappe.response["message"] = {"success": False, "error": "Script failed"}
try:
    ...
    frappe.response["message"] = {"success": True, "data": out}
except Exception as e:
    frappe.response["message"] = {"success": False, "error": str(e)}
```

**Source-of-truth for maps:** exact map values (sales-order-type → farm/BU/company, Roses-MAP warehouse mapping, truck-details rules, pricing rules) live in the existing client scripts. Read them from `kaitet-web/reskin/SO-ANALYSIS-client-scripts.md` and, where that summarizes, from the live Client Scripts via `fac.sh get_document '{"doctype":"Client Script","name":"<name>"}'`. Do NOT invent map values.

**Local versioning:** every server script is saved as `kaitet-web/<name>.py`; the page as `kaitet-web/roses-sales-order.html`. Deploy by `update_document` on the Server Script `script` field / Web Page `main_section_html`.

**Deploy a server script** (after creating the Server Script doc once in the desk or via create_document):

```bash
PY=$(python3 -c 'import json,sys;print(json.dumps(open(sys.argv[1]).read()))' kaitet-web/soMgrMeta.py)
./kaitet-web/fac.sh update_document "{\"doctype\":\"Server Script\",\"name\":\"soMgrMeta\",\"data\":{\"script\":$PY}}"
```

---

## File Structure

- `kaitet-web/fac.sh` — curl harness (Task 0)
- `kaitet-web/soMgrMeta.py` — reference/dropdown data endpoint (Task 2)
- `kaitet-web/soMgrList.py` — list view data endpoint (Task 3)
- `kaitet-web/soMgrGet.py` — single SO + linked-doc counts (Task 4)
- `kaitet-web/soMgrExpandSpec.py` — spec → item rows (Task 5)
- `kaitet-web/soMgrPrice.py` — pricing (Task 6)
- `kaitet-web/soMgrSave.py` — create/update/delete/submit writer (Tasks 7–9)
- `kaitet-web/roses-sales-order.html` — the Web Page (Tasks 10–15)
- `kaitet-web/reskin/packhouse-dashboard.new.html` — sidebar nav source to copy (Task 15)

---

## Task 0: Harness & data gathering

**Files:**
- Create: `kaitet-web/fac.sh`

- [ ] **Step 1: Write the curl harness**

Create `kaitet-web/fac.sh` with the script from Conventions above. `chmod +x kaitet-web/fac.sh`.

- [ ] **Step 2: Verify connectivity**

Run: `export FAC_TOKEN=<current token>; ./kaitet-web/fac.sh list_documents '{"doctype":"Sales Order","filters":{"custom_sales_order_type":"Roses"},"fields":["name"],"limit_page_length":3}'`
Expected: JSON with `"success"`-shaped result containing ≥1 SO name. If `AuthenticationError`, ask user for a fresh token.

- [ ] **Step 3: Gather the exact map values**

Read `kaitet-web/reskin/SO-ANALYSIS-client-scripts.md`. Extract into a scratch note `kaitet-web/SO-MAPS.md`: (a) type→company/farm/BU map, (b) Roses-MAP warehouse mapping (farm/length → warehouse + source warehouse), (c) truck-details rule, (d) order-name suffix rule, (e) the two pricing rules (price-list and by-length). Where the analysis only summarizes, fetch the raw Client Script via `fac.sh get_document`. These values are reused verbatim in Tasks 5–9.

- [ ] **Step 4: Commit**

```bash
git add kaitet-web/fac.sh kaitet-web/SO-MAPS.md
git commit -m "chore: FAC harness + extracted SO automation maps"
```

---

## Task 1: Create the six empty Server Script docs

**Files:** none local (creates docs on the instance).

- [ ] **Step 1: Create each Server Script (API type, public/guest off)**

For each of `soMgrMeta, soMgrList, soMgrGet, soMgrExpandSpec, soMgrPrice, soMgrSave` run:

```bash
./kaitet-web/fac.sh create_document '{"doctype":"Server Script","data":{"name":"soMgrMeta","script_type":"API","api_method":"soMgrMeta","allow_guest":0,"disabled":0,"script":"frappe.response[\"message\"]={\"success\":True,\"data\":\"stub\"}"}}'
```

- [ ] **Step 2: Verify each is reachable**

Run: `curl -s "https://kaitet-group.upande.com/api/method/soMgrMeta" -H "Authorization: token $FAC_TOKEN"`
Expected: `{"message":{"success":true,"data":"stub"}}`. Repeat for all six.

- [ ] **Step 3: Commit** (no local files — note in message)

```bash
git commit --allow-empty -m "chore: scaffold six soMgr server scripts on instance"
```

---

## Task 2: `soMgrMeta` — reference data

**Files:**
- Create: `kaitet-web/soMgrMeta.py`

- [ ] **Step 1: Write the endpoint**

Return all dropdown data the form needs in one call. Use `frappe.get_all` with filters; keep field lists minimal.

```python
frappe.response["message"] = {"success": False, "error": "Script failed"}
try:
    customers = frappe.get_all("Customer", filters={"disabled": 0},
        fields=["name", "customer_name", "customer_group", "territory"], limit_page_length=0)
    varieties = frappe.get_all("Item",
        filters=[["item_group", "in", ["Roses", "Spray Roses"]], ["disabled", "=", 0]],
        fields=["name", "item_name", "item_group", "stock_uom"], limit_page_length=0)
    specs = frappe.get_all("Specifications",
        fields=["name", "spec_name", "customer", "box_assortment"], limit_page_length=0)
    packrates = frappe.get_all("Packrate", fields=["name", "custom_stems_per_box"], limit_page_length=0)
    farms = frappe.get_all("Warehouse", filters={"is_group": 0},
        fields=["name", "warehouse_name"], limit_page_length=0)
    pricelists = frappe.get_all("Price List", filters={"selling": 1}, fields=["name"], limit_page_length=0)
    box_types = frappe.get_all("DocField",
        filters={"parent": "Sales Order Item", "fieldname": "custom_box_type"}, fields=["options"])
    settings = {}
    frappe.response["message"] = {"success": True, "data": {
        "customers": customers, "varieties": varieties, "specs": specs,
        "packrates": packrates, "farms": farms, "pricelists": pricelists,
        "box_types": box_types, "settings": settings}}
except Exception as e:
    frappe.response["message"] = {"success": False, "error": str(e)}
```

> Adjust the `Item.item_group` filter and `Packrate` field names to match real data discovered in Task 0. Box-type options come from the field definition; if `custom_box_type` is a Link, fetch that doctype's records instead.

- [ ] **Step 2: Deploy** (use the deploy snippet from Conventions with name `soMgrMeta`).

- [ ] **Step 3: Verify**

Run: `curl -s "https://kaitet-group.upande.com/api/method/soMgrMeta" -H "Authorization: token $FAC_TOKEN" | python3 -m json.tool`
Expected: `success:true`, non-empty `customers`, `varieties`, `specs`, `packrates`.

- [ ] **Step 4: Commit**

```bash
git add kaitet-web/soMgrMeta.py && git commit -m "feat(so): soMgrMeta reference-data endpoint"
```

---

## Task 3: `soMgrList` — list view data

**Files:**
- Create: `kaitet-web/soMgrList.py`

- [ ] **Step 1: Write the endpoint** (filters arrive as form_dict params; date window defaults to last 30 days)

```python
frappe.response["message"] = {"success": False, "error": "Script failed"}
try:
    fd = frappe.form_dict
    flt = [["custom_sales_order_type", "=", "Roses"]]
    frm = fd.get("from_date")
    to = fd.get("to_date")
    if frm:
        flt = flt + [["transaction_date", ">=", frm]]
    if to:
        flt = flt + [["transaction_date", "<=", to]]
    if fd.get("customer"):
        flt = flt + [["customer", "=", fd.get("customer")]]
    if fd.get("farm"):
        flt = flt + [["custom_farm", "=", fd.get("farm")]]
    if fd.get("week"):
        flt = flt + [["custom_week", "=", fd.get("week")]]
    if fd.get("status"):
        flt = flt + [["status", "=", fd.get("status")]]
    rows = frappe.get_all("Sales Order", filters=flt,
        fields=["name", "custom_order_name", "customer", "customer_name", "delivery_date",
                "custom_week", "custom_farm", "total_qty", "status", "docstatus"],
        order_by="transaction_date desc, creation desc", limit_page_length=200)
    frappe.response["message"] = {"success": True, "data": rows}
except Exception as e:
    frappe.response["message"] = {"success": False, "error": str(e)}
```

- [ ] **Step 2: Deploy** (name `soMgrList`).

- [ ] **Step 3: Verify**

Run: `curl -s "https://kaitet-group.upande.com/api/method/soMgrList" -H "Authorization: token $FAC_TOKEN" | python3 -m json.tool`
Expected: `success:true`, array of recent Roses SOs with the listed fields.
Then test a filter: append `-G --data-urlencode 'customer=<a real customer>'` and confirm narrowing.

- [ ] **Step 4: Commit**

```bash
git add kaitet-web/soMgrList.py && git commit -m "feat(so): soMgrList endpoint"
```

---

## Task 4: `soMgrGet` — one SO + linked-doc counts

**Files:**
- Create: `kaitet-web/soMgrGet.py`

- [ ] **Step 1: Write the endpoint**

```python
frappe.response["message"] = {"success": False, "error": "Script failed"}
try:
    name = frappe.form_dict.get("name")
    doc = frappe.get_doc("Sales Order", name)
    items = []
    i = 0
    while i < len(doc.items):
        it = doc.items[i]
        items = items + [{
            "name": it.name, "idx": it.idx, "item_code": it.item_code, "item_name": it.item_name,
            "qty": it.qty, "uom": it.uom, "stock_uom": it.stock_uom, "conversion_factor": it.conversion_factor,
            "custom_ordered_quantity": it.custom_ordered_quantity, "custom_length": it.custom_length,
            "custom_box_type": it.custom_box_type, "custom_packrate": it.custom_packrate,
            "custom_number_of_boxes": it.custom_number_of_boxes, "custom_mixed_box": it.custom_mixed_box,
            "custom_mix_group": it.custom_mix_group, "custom_mix_name": it.custom_mix_name,
            "custom_packrate_mixed_box": it.custom_packrate_mixed_box, "warehouse": it.warehouse,
            "custom_source_warehouse": it.custom_source_warehouse, "custom_truck": it.custom_truck,
            "custom_reserve_status": it.custom_reserve_status, "rate": it.rate, "amount": it.amount,
            "cost_center": it.cost_center, "delivery_date": it.delivery_date}]
        i = i + 1
    header = {
        "name": doc.name, "docstatus": doc.docstatus, "status": doc.status,
        "customer": doc.customer, "customer_name": doc.customer_name,
        "transaction_date": str(doc.transaction_date), "delivery_date": str(doc.delivery_date),
        "custom_farm": doc.custom_farm, "custom_order_name": doc.custom_order_name,
        "custom_week": doc.custom_week, "custom_s_number": doc.custom_s_number,
        "custom_truck_details": doc.custom_truck_details, "custom_daily_time": doc.custom_daily_time,
        "custom_packhouse_stage": doc.custom_packhouse_stage, "po_no": doc.po_no,
        "selling_price_list": doc.selling_price_list, "custom_consignee": doc.custom_consignee,
        "custom_consignee_country": doc.custom_consignee_country, "custom_delivery_point": doc.custom_delivery_point,
        "custom_shipping_agent": doc.custom_shipping_agent, "custom_mode_of_transport": doc.custom_mode_of_transport,
        "territory": doc.territory, "payment_terms_template": doc.payment_terms_template,
        "custom_remote_truck_details": doc.custom_remote_truck_details, "total_qty": doc.total_qty,
        "grand_total": doc.grand_total}
    # linked-doc counts for the submitted-edit guardrail
    dn = frappe.get_all("Delivery Note Item", filters={"against_sales_order": name}, fields=["parent"], limit_page_length=0)
    si = frappe.get_all("Sales Invoice Item", filters={"sales_order": name}, fields=["parent"], limit_page_length=0)
    opl = frappe.get_all("Pick List Item", filters={"sales_order": name}, fields=["parent"], limit_page_length=0)
    dn_set = {}
    j = 0
    while j < len(dn):
        dn_set[dn[j].parent] = 1
        j = j + 1
    si_set = {}
    k = 0
    while k < len(si):
        si_set[si[k].parent] = 1
        k = k + 1
    opl_set = {}
    m = 0
    while m < len(opl):
        opl_set[opl[m].parent] = 1
        m = m + 1
    links = {"delivery_notes": len(dn_set), "invoices": len(si_set), "pick_lists": len(opl_set)}
    frappe.response["message"] = {"success": True, "data": {"header": header, "items": items, "links": links}}
except Exception as e:
    frappe.response["message"] = {"success": False, "error": str(e)}
```

> Verify the linked-doc field names against the instance in Step 3 — `Pick List Item.sales_order` may instead be a custom link; adjust to whatever the OPL flow actually uses (cross-check with `getSchedulerDrafts.py` which reads `Pick List Item`).

- [ ] **Step 2: Deploy** (name `soMgrGet`).

- [ ] **Step 3: Verify**

Run: `curl -s "https://kaitet-group.upande.com/api/method/soMgrGet" -H "Authorization: token $FAC_TOKEN" -G --data-urlencode 'name=<a submitted Roses SO with a pick list>'`
Expected: `success:true`; `header.docstatus==1`; `items` populated; `links.pick_lists>=1`. Pick a SO known to have an invoice and confirm `links.invoices>=1`.

- [ ] **Step 4: Commit**

```bash
git add kaitet-web/soMgrGet.py && git commit -m "feat(so): soMgrGet endpoint with linked-doc counts"
```

---

## Task 5: `soMgrExpandSpec` — spec → item rows

**Files:**
- Create: `kaitet-web/soMgrExpandSpec.py`

- [ ] **Step 1: Re-read the source logic**

Read `kaitet-web/autofill_so_by_specification.client.js` and the "Autofill Sales Order By Specification" entry in `SO-ANALYSIS-client-scripts.md`. Note exactly how Mono Box vs Mixed Box specs map to rows (box_items child, packrate, stems-per-box, mix grouping). Reproduce that mapping — do not approximate.

- [ ] **Step 2: Write the endpoint** (skeleton — fill mapping from Step 1)

```python
frappe.response["message"] = {"success": False, "error": "Script failed"}
try:
    spec_name = frappe.form_dict.get("spec")
    customer = frappe.form_dict.get("customer")
    spec = frappe.get_doc("Specifications", spec_name)
    rows = []
    assortment = spec.box_assortment
    i = 0
    while i < len(spec.box_items):
        bi = spec.box_items[i]
        # MAP per Step 1: derive item_code, custom_length, custom_box_type,
        # custom_packrate, custom_number_of_boxes, custom_ordered_quantity,
        # and (for Mixed Box) custom_mixed_box / custom_mix_group / custom_mix_name.
        row = {
            "item_code": bi.item_code,
            "custom_length": bi.custom_length,
            "custom_box_type": bi.box_type,
            "custom_packrate": bi.packrate,
            "custom_number_of_boxes": bi.number_of_boxes,
            "custom_mixed_box": 1 if assortment == "Mixed Box" else 0,
            "custom_mix_group": bi.mix_group if assortment == "Mixed Box" else None,
            "custom_mix_name": spec.spec_name if assortment == "Mixed Box" else None}
        rows = rows + [row]
        i = i + 1
    frappe.response["message"] = {"success": True, "data": {"assortment": assortment, "rows": rows}}
except Exception as e:
    frappe.response["message"] = {"success": False, "error": str(e)}
```

> The real `Specifications` child fieldnames (box_items columns) must be confirmed via `fac.sh get_document '{"doctype":"Specifications","name":"<one>"}'` before finalizing.

- [ ] **Step 3: Deploy** (name `soMgrExpandSpec`).

- [ ] **Step 4: Verify**

Run against a real Mono spec and a real Mixed spec:
`curl -s ".../api/method/soMgrExpandSpec" -H "Authorization: token $FAC_TOKEN" -G --data-urlencode 'spec=<mono spec>' --data-urlencode 'customer=<cust>'`
Expected: rows whose item_code/length/box_type/packrate match the spec; mixed spec returns `custom_mixed_box:1` with mix_group set. Cross-check one expansion against an actual SO that was built from that spec.

- [ ] **Step 5: Commit**

```bash
git add kaitet-web/soMgrExpandSpec.py && git commit -m "feat(so): soMgrExpandSpec endpoint"
```

---

## Task 6: `soMgrPrice` — pricing

**Files:**
- Create: `kaitet-web/soMgrPrice.py`

- [ ] **Step 1: Re-read source** — "Set Price On SO" and "Fetch Price List Data" entries in the analysis. Capture the exact rate-resolution order (price-list lookup keyed by item+length vs by-length formula).

- [ ] **Step 2: Write the endpoint** (items arrive as a `"|~|"`-joined string of `item_code~length`)

```python
frappe.response["message"] = {"success": False, "error": "Script failed"}
try:
    customer = frappe.form_dict.get("customer")
    price_list = frappe.form_dict.get("price_list")
    raw = frappe.form_dict.get("items") or ""
    out = []
    parts = raw.split("|~|")
    i = 0
    while i < len(parts):
        seg = parts[i].strip()
        if seg != "":
            kv = seg.split("~")
            item_code = kv[0]
            length = kv[1] if len(kv) > 1 else ""
            rate = 0
            # MAP per Step 1: resolve rate from Item Price (price_list+item_code[+length])
            ip = frappe.get_all("Item Price",
                filters={"price_list": price_list, "item_code": item_code},
                fields=["price_list_rate", "custom_length"], limit_page_length=0)
            j = 0
            while j < len(ip):
                if (not length) or str(ip[j].custom_length) == str(length):
                    rate = ip[j].price_list_rate
                j = j + 1
            out = out + [{"item_code": item_code, "length": length, "rate": rate}]
        i = i + 1
    frappe.response["message"] = {"success": True, "data": out}
except Exception as e:
    frappe.response["message"] = {"success": False, "error": str(e)}
```

- [ ] **Step 3: Deploy** (name `soMgrPrice`).

- [ ] **Step 4: Verify** — call with a real customer + price list + 2 items; confirm returned rates match what those items show on a recent SO for that customer.

- [ ] **Step 5: Commit**

```bash
git add kaitet-web/soMgrPrice.py && git commit -m "feat(so): soMgrPrice endpoint"
```

---

## Task 7: `soMgrSave` — CREATE (draft)

**Files:**
- Create: `kaitet-web/soMgrSave.py`

The payload is JSON-encoded but safe_exec blocks `frappe.parse_json`; pass it as a `"|~|"`/`~`-delimited structure OR use `frappe._dict`-friendly form fields. **Decision:** pass header fields as individual form params, and items as a `"|~|"`-joined string of `~`-delimited field tuples in a fixed column order. Document the order at the top of the script.

- [ ] **Step 1: Write CREATE path**

```python
frappe.response["message"] = {"success": False, "error": "Script failed"}
# ITEM COLUMNS (fixed order, ~-joined per row, |~|-joined across rows):
# item_code~custom_length~custom_box_type~custom_packrate~custom_number_of_boxes~
# custom_ordered_quantity~custom_mixed_box~custom_mix_group~custom_mix_name~rate
try:
    fd = frappe.form_dict
    intent = fd.get("intent") or "create"
    mode = fd.get("mode") or "draft"
    if intent == "create":
        doc = frappe.new_doc("Sales Order")
        doc.custom_sales_order_type = "Roses"
        doc.custom_business_unit = "Roses"
        doc.customer = fd.get("customer")
        doc.transaction_date = fd.get("transaction_date")
        doc.delivery_date = fd.get("delivery_date")
        doc.custom_farm = fd.get("custom_farm")
        doc.custom_order_name = fd.get("custom_order_name")
        doc.custom_s_number = fd.get("custom_s_number")
        doc.custom_daily_time = fd.get("custom_daily_time")
        doc.custom_packhouse_stage = fd.get("custom_packhouse_stage")
        doc.po_no = fd.get("po_no")
        doc.selling_price_list = fd.get("selling_price_list")
        doc.custom_consignee = fd.get("custom_consignee")
        doc.custom_delivery_point = fd.get("custom_delivery_point")
        doc.custom_shipping_agent = fd.get("custom_shipping_agent")
        doc.custom_mode_of_transport = fd.get("custom_mode_of_transport")
        doc.payment_terms_template = fd.get("payment_terms_template")
        # SERVER MAPS (from SO-MAPS.md): custom_week from delivery_date,
        # custom_truck_details, warehouse + source warehouse per row, cost_center,
        # custom_reserve_status, company/farm/BU.
        doc.custom_week = fd.get("custom_week")
        raw = fd.get("items") or ""
        parts = raw.split("|~|")
        i = 0
        while i < len(parts):
            seg = parts[i].strip()
            if seg != "":
                c = seg.split("~")
                row = doc.append("items", {})
                row.item_code = c[0]
                row.custom_length = c[1]
                row.custom_box_type = c[2]
                row.custom_packrate = c[3]
                row.custom_number_of_boxes = c[4]
                row.custom_ordered_quantity = c[5]
                row.custom_mixed_box = int(c[6] or 0)
                row.custom_mix_group = c[7]
                row.custom_mix_name = c[8]
                row.rate = float(c[9] or 0)
                row.qty = float(c[5] or 0)
                # warehouse/source_warehouse/truck/reserve_status/cost_center from maps
            i = i + 1
        # validation we keep: Roses non-Mix rows need ordered_qty>0
        bad = 0
        n = 0
        while n < len(doc.items):
            it = doc.items[n]
            if it.item_code != "Mix Box" and (not it.custom_ordered_quantity or float(it.custom_ordered_quantity) <= 0):
                bad = 1
            n = n + 1
        if bad == 1:
            frappe.response["message"] = {"success": False, "error": "Every non-Mix item needs ordered quantity > 0"}
        else:
            doc.insert(ignore_permissions=True)
            if mode == "submit":
                doc.submit()
            frappe.response["message"] = {"success": True, "data": {"name": doc.name}}
except Exception as e:
    frappe.response["message"] = {"success": False, "error": str(e)}
```

> `.append()` on a child table is the Frappe Document API helper (returns a child row), NOT the Python `list.append` that safe_exec blocks — confirm it is permitted in Step 3; if blocked, build the doc dict with an `items` list and pass to `frappe.get_doc({...}).insert()`.

- [ ] **Step 2: Deploy** (name `soMgrSave`).

- [ ] **Step 3: Verify CREATE (draft)**

Run a create call with one real item; expected `success:true` + a new SO name. `fac.sh get_document` that SO and confirm: docstatus 0, custom_sales_order_type Roses, item qty/ordered_qty set, week populated. Then run with `mode=submit` and confirm docstatus 1. **Delete the test SOs after** via `fac.sh delete_document` (or cancel+delete if submitted).

- [ ] **Step 4: Commit**

```bash
git add kaitet-web/soMgrSave.py && git commit -m "feat(so): soMgrSave create path (draft+submit)"
```

---

## Task 8: `soMgrSave` — UPDATE / add / delete rows via direct DB

**Files:**
- Modify: `kaitet-web/soMgrSave.py`

- [ ] **Step 1: Add the UPDATE branch** (runs when `intent == "update"`; bypasses docstatus lock)

Each item row carries an extra leading token `rowname` (empty = new row) and a trailing `_deleted` flag. Direct writes:

```python
    if intent == "update":
        name = fd.get("name")
        # header fields -> direct set_value (bypasses submitted lock)
        hdr = {
            "customer": fd.get("customer"), "delivery_date": fd.get("delivery_date"),
            "custom_farm": fd.get("custom_farm"), "custom_order_name": fd.get("custom_order_name"),
            "custom_week": fd.get("custom_week"), "po_no": fd.get("po_no"),
            "custom_consignee": fd.get("custom_consignee"),
            "custom_delivery_point": fd.get("custom_delivery_point"),
            "custom_shipping_agent": fd.get("custom_shipping_agent"),
            "payment_terms_template": fd.get("payment_terms_template")}
        frappe.db.set_value("Sales Order", name, hdr, update_modified=True)
        raw = fd.get("items") or ""
        parts = raw.split("|~|")
        i = 0
        while i < len(parts):
            seg = parts[i].strip()
            if seg != "":
                c = seg.split("~")
                rowname = c[0]
                deleted = c[11] if len(c) > 11 else "0"
                if rowname and deleted == "1":
                    frappe.db.delete("Sales Order Item", {"name": rowname})
                elif rowname:
                    frappe.db.set_value("Sales Order Item", rowname, {
                        "item_code": c[1], "custom_length": c[2], "custom_box_type": c[3],
                        "custom_packrate": c[4], "custom_number_of_boxes": c[5],
                        "custom_ordered_quantity": c[6], "qty": float(c[6] or 0),
                        "custom_mixed_box": int(c[7] or 0), "custom_mix_group": c[8],
                        "custom_mix_name": c[9], "rate": float(c[10] or 0)})
                else:
                    nd = frappe.new_doc("Sales Order Item")
                    nd.parent = name
                    nd.parenttype = "Sales Order"
                    nd.parentfield = "items"
                    nd.item_code = c[1]
                    nd.custom_length = c[2]
                    nd.custom_box_type = c[3]
                    nd.custom_packrate = c[4]
                    nd.custom_number_of_boxes = c[5]
                    nd.custom_ordered_quantity = c[6]
                    nd.qty = float(c[6] or 0)
                    nd.custom_mixed_box = int(c[7] or 0)
                    nd.custom_mix_group = c[8]
                    nd.custom_mix_name = c[9]
                    nd.rate = float(c[10] or 0)
                    nd.db_insert()
            i = i + 1
        # reindex idx + recompute aggregates (Step 2)
```

> If `frappe.new_doc(...).db_insert()` is blocked in safe_exec, the contingency app method from spec §10 is required — flag to the user before proceeding.

- [ ] **Step 2: Add aggregate recompute + idx reindex** (shared by create & update; runs after row changes)

```python
        kids = frappe.get_all("Sales Order Item", filters={"parent": name},
            fields=["name", "qty", "rate"], order_by="idx asc")
        total_qty = 0
        total = 0
        ix = 1
        a = 0
        while a < len(kids):
            q = float(kids[a].qty or 0)
            r = float(kids[a].rate or 0)
            amt = q * r
            frappe.db.set_value("Sales Order Item", kids[a].name, {"idx": ix, "amount": amt, "base_amount": amt})
            total_qty = total_qty + q
            total = total + amt
            ix = ix + 1
            a = a + 1
        frappe.db.set_value("Sales Order", name, {
            "total_qty": total_qty, "total": total, "net_total": total,
            "base_total": total, "base_net_total": total, "grand_total": total,
            "base_grand_total": total, "rounded_total": total, "base_rounded_total": total},
            update_modified=True)
        frappe.response["message"] = {"success": True, "data": {"name": name, "total_qty": total_qty, "grand_total": total}}
```

> If Roses orders use taxes/conversion_rate, fold `conversion_rate`/`base_*` and `taxes` total in here per SO-MAPS.md. For export (untaxed) orders grand_total == net_total, which is the common case (analysis: taxes on 2/40).

- [ ] **Step 3: Deploy & verify UPDATE on a DRAFT**

Edit a draft test SO: change a row qty, add a row, delete a row. `fac.sh get_document` and confirm rows changed, `idx` is contiguous 1..N, and `total_qty`/`grand_total` recomputed correctly.

- [ ] **Step 4: Verify UPDATE on a SUBMITTED SO**

Pick a submitted test SO (create+submit a throwaway in Task 7). Add a row via the endpoint; confirm it succeeds despite docstatus 1 and the parent totals update. Clean up afterward.

- [ ] **Step 5: Commit**

```bash
git add kaitet-web/soMgrSave.py && git commit -m "feat(so): soMgrSave direct-DB update/add/delete + aggregate recompute"
```

---

## Task 9: `soMgrSave` — invoiced guardrail

**Files:**
- Modify: `kaitet-web/soMgrSave.py`

- [ ] **Step 1: Add the guardrail at the top of the UPDATE branch**

```python
        override = fd.get("override") or "0"
        si = frappe.get_all("Sales Invoice Item", filters={"sales_order": name}, fields=["parent"], limit_page_length=1)
        if len(si) > 0 and override != "1":
            frappe.response["message"] = {"success": False, "blocked": True,
                "error": "This order has a linked Sales Invoice. Editing is blocked. Confirm override to proceed."}
        else:
            # ... existing update logic ...
```

(Indent the existing update logic under the `else`.)

- [ ] **Step 2: Deploy & verify**

Call update on a SO that has an invoice without `override`; expected `success:false, blocked:true`. Repeat with `override=1`; expected success. Verify a SO with only a pick list updates without being blocked.

- [ ] **Step 3: Commit**

```bash
git add kaitet-web/soMgrSave.py && git commit -m "feat(so): block submitted-edit when invoiced unless overridden"
```

---

## Task 10: Web Page shell — aph layout, nav, view router

**Files:**
- Create: `kaitet-web/roses-sales-order.html`

- [ ] **Step 1: Build the shell**

Copy the `<style>` block, `.aph` grid, sidebar (`.aph-side` with packhouse nav) and topbar from `kaitet-web/reskin/packhouse-dashboard.new.html` (the verified gold template, "Karen Roses" brand). Add a nav item "Roses Sales Order" marked `.active`. Add two `<section>`s: `#view-list` and `#view-form` (hidden), and a JS `showView(name)` router. Define `const FAC_TOKEN`/`API` base = `/api/method/` and a `call(method, params)` helper using `frappe.call` (page runs authenticated in-session, so no token needed client-side).

```javascript
function call(method, args){
  return new Promise((res,rej)=>{
    frappe.call({method:method, type:"GET", args:args,
      callback:r=>res(r.message), error:e=>rej(e)});
  });
}
function showView(n){
  document.getElementById('view-list').style.display = n==='list'?'block':'none';
  document.getElementById('view-form').style.display = n==='form'?'block':'none';
}
```

- [ ] **Step 2: JS syntax check**

Extract the script and run: `node --check /tmp/rsо.js` (copy the `<script>` body out, or use a quick `python3` extraction). Expected: no syntax errors.

- [ ] **Step 3: Deploy the page**

Create a Web Page (route `roses-sales-order`, published) via `create_document`, then push `main_section_html`:

```bash
HTML=$(python3 -c 'import json,sys;print(json.dumps(open(sys.argv[1]).read()))' kaitet-web/roses-sales-order.html)
./kaitet-web/fac.sh update_document "{\"doctype\":\"Web Page\",\"name\":\"roses-sales-order\",\"data\":{\"main_section_html\":$HTML}}"
```

- [ ] **Step 4: Verify** — open `https://kaitet-group.upande.com/roses-sales-order` in the browser (or Playwright `browser_navigate` + `browser_snapshot`). Expected: aph layout renders, sidebar shows "Karen Roses" + packhouse nav, empty list/form containers present, no console errors.

- [ ] **Step 5: Commit**

```bash
git add kaitet-web/roses-sales-order.html && git commit -m "feat(so): roses-sales-order page shell"
```

---

## Task 11: List view wiring

**Files:**
- Modify: `kaitet-web/roses-sales-order.html`

- [ ] **Step 1: Render the list** — on load, call `soMgrList`, render the table (Order Name, Customer, Delivery, Week, Farm, Stems, Status, Docstatus). Add filter controls (customer/status/farm/week/search + date range defaulting to last 30 days) that re-call `soMgrList`. Add `+ New Sales Order` button → `openForm(null)`. Row click → `openForm(name)`. Use `.aph-tbl`, `.aph-empty`, `.aph-loading` classes.

- [ ] **Step 2: JS syntax check** (`node --check`).

- [ ] **Step 3: Deploy & verify** — reload page; expected: real Roses SOs listed; filters narrow results; clicking a row switches to (empty for now) form view.

- [ ] **Step 4: Commit**

```bash
git add kaitet-web/roses-sales-order.html && git commit -m "feat(so): list view + filters"
```

---

## Task 12: Form scaffold — sections ①②③, load, gating

**Files:**
- Modify: `kaitet-web/roses-sales-order.html`

- [ ] **Step 1: Build the form** — on `openForm(name)`: if name, `soMgrGet` to load; else blank. Render section ① Order, ② Logistics/export, ③ Products (empty card list + buttons + totals footer + Save draft / Submit). Populate selects from a cached `soMgrMeta` call (call once, memoize). Implement field gating: consignee disabled until customer set; shipping agent disabled until delivery point set; auto week# from delivery date (client). Show a read-only banner with `links` counts when editing a submitted SO; if `links.invoices>0`, show the "edit blocked unless override" state.

- [ ] **Step 2: JS syntax check**.

- [ ] **Step 3: Deploy & verify** — open an existing SO; expected: header + logistics fields populated, products area shows existing rows as cards, gating works, week auto-fills when delivery date changes. Open "New" → blank form.

- [ ] **Step 4: Commit**

```bash
git add kaitet-web/roses-sales-order.html && git commit -m "feat(so): form scaffold, load + field gating"
```

---

## Task 13: Add-product drawer + cards + derived qty

**Files:**
- Modify: `kaitet-web/roses-sales-order.html`

- [ ] **Step 1: Build the drawer** — `+ Add product` opens a drawer (variety, length, box type, packrate, # boxes, mixed-box toggle). On # boxes / packrate change, compute `ordered qty = boxes × packrate(stems)` and show derived qty/warehouse/rate preview (rate via `soMgrPrice` debounced). Mixed-box toggle reveals mix group/name + multi-variety picker. On Add → push a product object to in-memory `state.items` and re-render cards. Edit/delete on each card. Footer totals sum stems + value live.

- [ ] **Step 2: JS syntax check**.

- [ ] **Step 3: Deploy & verify** — add a mono product (qty computes correctly), add a mixed-box product (varieties captured), edit a card, delete a card; totals update each time.

- [ ] **Step 4: Commit**

```bash
git add kaitet-web/roses-sales-order.html && git commit -m "feat(so): add-product drawer, cards, derived qty"
```

---

## Task 14: Spec expansion + save/submit + guardrail

**Files:**
- Modify: `kaitet-web/roses-sales-order.html`

- [ ] **Step 1: From-spec** — `From spec` button → pick a Specification (filtered to the chosen customer) → `soMgrExpandSpec` → append returned rows as product cards (mixed rows rendered as mixed cards).

- [ ] **Step 2: Save/submit wiring** — `Save draft` serializes header params + items into the `|~|`/`~` payload and calls `soMgrSave` (intent create or update based on whether the form has a name). `Submit ▸` shows a confirm dialog (warning: consumables Work Orders are NOT auto-created from this page) then calls with `mode=submit`. Inline required-field validation before send (customer, order name, delivery date, farm; per-row length, # boxes, ordered qty for non-mix). On `blocked:true` response, show the invoiced-override dialog → resend with `override=1` if confirmed. On success, refresh and return to list.

- [ ] **Step 3: JS syntax check**.

- [ ] **Step 4: Deploy & verify (end-to-end create)** — create a brand-new Roses SO from the page (mono + mixed + a spec expansion), Save draft → confirm it appears in the list and matches in `fac.sh get_document`. Edit it, add/delete rows, Save → confirm changes + recomputed totals. Submit → docstatus 1. Delete the throwaway after.

- [ ] **Step 5: Verify guardrail** — open a submitted SO that has an invoice; attempt edit; confirm block + override path. Open one with only a pick list; confirm warn-but-allow.

- [ ] **Step 6: Commit**

```bash
git add kaitet-web/roses-sales-order.html && git commit -m "feat(so): spec expansion, save/submit, invoiced guardrail"
```

---

## Task 15: Sidebar link + final pass

**Files:**
- Modify: sibling packhouse pages' nav (add "Roses Sales Order" link), `kaitet-web/roses-sales-order.html`

- [ ] **Step 1: Add nav entry** — add the "Roses Sales Order" `.nav-item` (route `/roses-sales-order`) to the packhouse sidebar in the other packhouse-family pages so navigation is consistent. Deploy each changed page via `update_document` on its `main_section_html` (keep the JS/methods untouched — frontend nav only).

- [ ] **Step 2: Full regression pass** — list loads & filters; create draft; create+submit; edit draft (add/edit/delete rows, totals correct); edit submitted (allowed, totals correct); invoiced block + override; spec expansion (mono + mixed); field gating; week auto. Record any gap as a follow-up task.

- [ ] **Step 3: Final commit**

```bash
git add -A && git commit -m "feat(so): packhouse sidebar link + final regression pass"
```

---

## Self-Review notes (addressed)

- **Spec coverage:** List/Create/Edit/Submit (Tasks 3,7,8,10–14); submitted-editable + direct DB (Tasks 8); invoiced guardrail (Task 9, 14·5); spec expansion (5,14); pricing (6); field inventory (3,4,7,8,12); automation maps (0,7,8); aph design + nav (10,15). All spec sections map to a task.
- **Known contingency (called out at point of use):** safe_exec may block `child.append()` / `db_insert()` — Tasks 7·1 and 8·1 flag the app-method fallback before proceeding.
- **Type/name consistency:** endpoint names (`soMgr*`), the fixed item-column order, and `state.items` shape are defined once (Task 7/8) and reused; `call()`/`showView()`/`openForm()` defined in Task 10 and used thereafter.
- **External dependency:** exact map/field names (warehouse map, Specifications child columns, linked-doc link fields, Packrate fields, box-type source) are verified against the live instance in Tasks 0/4/5 before code is finalized — these are the only "fill from instance" points and each has a verification step.
