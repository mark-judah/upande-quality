# Frappe Server Script (Type: API), api_method = soMgrSave
# Single write endpoint for the Roses Sales Order web form.
# Behaviors: A) CREATE (new_doc + insert/submit), B) UPDATE (direct-DB,
# bypasses docstatus lock/hooks/perms), C) AGGREGATE RECOMPUTE (update only).
#
# safe_exec rules: NO import / def / += / list.append / frappe.parse_json /
# raw frappe.db.sql. Use x = x + [i], d[k]=v, while. A document's
# .append("items", {}) child helper IS allowed.
#
# ---- PARAMS (frappe.form_dict) ----
# intent   = "create" | "update"
# mode     = "draft"  | "submit"
# name     = SO name (UPDATE only)
# override = "1" to bypass the linked-Sales-Invoice block (UPDATE only)
# Header (individual form params):
#   customer, transaction_date, delivery_date, custom_farm, custom_order_name,
#   custom_s_number, custom_daily_time, custom_packhouse_stage, po_no,
#   selling_price_list, custom_week, custom_truck_details, custom_consignee,
#   custom_consignee_country, custom_delivery_point, custom_shipping_agent,
#   custom_mode_of_transport, territory, payment_terms_template,
#   custom_remote_truck_details
# Roses constants set on CREATE: custom_sales_order_type="Roses",
#   custom_business_unit="Roses", company="Karen Roses". custom_farm comes
#   from the form (user picks); not forced blank.
#
# ---- items payload ----
# items = a "|~|"-joined string; each row is "~"-joined in this FIXED order:
#   rowname ~ item_code ~ custom_length ~ custom_box_type ~ custom_packrate ~
#   custom_number_of_boxes ~ custom_ordered_quantity ~ custom_mixed_box ~
#   custom_mix_group ~ custom_mix_name ~ rate ~ deleted ~ custom_source_warehouse
# rowname empty  = new row (CREATE ignores rowname/deleted).
# deleted == "1" = delete that row (UPDATE only).
#
# ---- QTY / UOM (production-correct; verified against live Roses SOs) ----
# custom_ordered_quantity (from form) = packrate * boxes = STEM count = stock_qty.
# Real qty is in UOM (bunch) units: qty = stock_qty / conversion_factor.
# conversion_factor & uom are derived from the Item (sales_uom + uoms table),
# fallback uom=stock_uom / factor=1. amount = qty * rate. (Spec literally said
# qty=custom_ordered_quantity, but every live SO stores qty=stems/factor and
# would otherwise be inflated ~10x; matched production instead.)
#
# ---- warehouse ----
# row.custom_source_warehouse is user-selected; row.warehouse (delivery) is
# derived from SO Warehouse Mapping "Roses-MAP" child `items`
# (source_warehouse -> delivery_warehouse), read live.
#
# ---- truck ----
# header custom_truck_details copied to each row's custom_truck.
#
# ---- ordered-qty validation (KEEP) ----
# Every non-"Mix Box" item must have custom_ordered_quantity > 0 else bail
# with {"success": False, "error": ...} WITHOUT saving.

frappe.response["message"] = {"success": False, "error": "Script failed"}
try:
    fd = frappe.form_dict
    intent = (fd.get("intent") or "").strip()
    mode = (fd.get("mode") or "draft").strip()
    name = fd.get("name")
    override = (fd.get("override") or "").strip()
    items_raw = fd.get("items") or ""

    # ---- Header field list (form param -> SO field, same name) ----
    HFIELDS = ["customer", "transaction_date", "delivery_date", "custom_farm",
               "custom_order_name", "custom_s_number", "custom_daily_time",
               "custom_packhouse_stage", "po_no", "selling_price_list",
               "custom_week", "custom_truck_details", "custom_consignee",
               "custom_consignee_country", "custom_delivery_point",
               "custom_shipping_agent", "custom_mode_of_transport", "territory",
               "payment_terms_template", "custom_remote_truck_details"]

    truck = fd.get("custom_truck_details")

    # ---- Read Roses-MAP warehouse mapping live ----
    wmap = {}
    map_rows = frappe.get_all("SO Warehouse Mapping Item",
                              filters={"parent": "Roses-MAP",
                                       "parenttype": "SO Warehouse Mapping"},
                              fields=["source_warehouse", "delivery_warehouse"],
                              limit_page_length=0)
    mri = 0
    while mri < len(map_rows):
        sw = map_rows[mri].get("source_warehouse")
        dw = map_rows[mri].get("delivery_warehouse")
        if sw:
            wmap[sw] = dw
        mri = mri + 1

    # ---- Parse items payload into a list of dicts ----
    COLS = ["rowname", "item_code", "custom_length", "custom_box_type",
            "custom_packrate", "custom_number_of_boxes",
            "custom_ordered_quantity", "custom_mixed_box", "custom_mix_group",
            "custom_mix_name", "rate", "deleted", "custom_source_warehouse"]
    parsed = []
    segs = items_raw.split("|~|")
    si = 0
    while si < len(segs):
        seg = segs[si]
        if seg is not None and seg.strip() != "":
            bits = seg.split("~")
            row = {}
            ci = 0
            while ci < len(COLS):
                row[COLS[ci]] = bits[ci] if ci < len(bits) else ""
                ci = ci + 1
            parsed = parsed + [row]
        si = si + 1

    # Per-item UOM cache: item_code -> {"uom":..,"cf":..,"item_name":..}
    item_cache = {}

    # ---- ordered-qty validation across all non-deleted, non-mix rows ----
    bad = None
    vi = 0
    while vi < len(parsed):
        r = parsed[vi]
        is_deleted = (str(r.get("deleted") or "") == "1")
        is_mix = (str(r.get("custom_mixed_box") or "") == "1")
        if not is_deleted and not is_mix:
            oqs = r.get("custom_ordered_quantity") or "0"
            oqv = 0.0
            try:
                oqv = float(oqs)
            except Exception:
                oqv = 0.0
            if oqv <= 0:
                bad = r.get("item_code") or "(row " + str(vi + 1) + ")"
                vi = len(parsed)
        vi = vi + 1

    if bad is not None:
        frappe.response["message"] = {"success": False,
            "error": "Item '" + str(bad) + "' has ordered quantity 0. "
                     "Every non-Mix-Box item must have ordered quantity > 0."}
    else:
        # =====================================================================
        # A) CREATE
        # =====================================================================
        if intent == "create":
            doc = frappe.new_doc("Sales Order")
            doc.custom_sales_order_type = "Roses"
            doc.custom_business_unit = "Roses"
            doc.company = "Karen Roses"
            hi = 0
            while hi < len(HFIELDS):
                k = HFIELDS[hi]
                v = fd.get(k)
                if v is not None and v != "":
                    doc.set(k, v)
                hi = hi + 1

            ddate = fd.get("delivery_date")

            pi = 0
            while pi < len(parsed):
                r = parsed[pi]
                ic = r.get("item_code")
                # Resolve UOM + conversion_factor from the Item.
                uom = None
                cf = 1.0
                iname = ic
                if ic and ic in item_cache:
                    uom = item_cache[ic]["uom"]
                    cf = item_cache[ic]["cf"]
                    iname = item_cache[ic]["item_name"]
                elif ic:
                    irec = frappe.db.get_value("Item", ic,
                            ["stock_uom", "sales_uom", "item_name"], as_dict=True)
                    if irec:
                        uom = irec.get("sales_uom") or irec.get("stock_uom")
                        iname = irec.get("item_name") or ic
                        if uom:
                            urow = frappe.get_all("UOM Conversion Detail",
                                    filters={"parent": ic, "uom": uom},
                                    fields=["conversion_factor"],
                                    limit_page_length=1)
                            if len(urow) > 0 and urow[0].get("conversion_factor"):
                                cf = float(urow[0].get("conversion_factor"))
                    item_cache[ic] = {"uom": uom, "cf": cf, "item_name": iname}
                if not cf or cf == 0:
                    cf = 1.0

                stock_q = 0.0
                try:
                    stock_q = float(r.get("custom_ordered_quantity") or 0)
                except Exception:
                    stock_q = 0.0
                qty = stock_q / cf
                rate = 0.0
                try:
                    rate = float(r.get("rate") or 0)
                except Exception:
                    rate = 0.0

                child = doc.append("items", {})
                child.item_code = ic
                child.item_name = iname
                if uom:
                    child.uom = uom
                child.conversion_factor = cf
                child.qty = qty
                child.stock_qty = stock_q
                child.rate = rate
                child.custom_ordered_quantity = stock_q
                child.custom_length = r.get("custom_length")
                child.custom_box_type = r.get("custom_box_type") or None
                child.custom_packrate = r.get("custom_packrate") or None
                nb = r.get("custom_number_of_boxes")
                if nb is not None and nb != "":
                    child.custom_number_of_boxes = nb
                child.custom_mixed_box = 1 if str(r.get("custom_mixed_box") or "") == "1" else 0
                child.custom_mix_group = r.get("custom_mix_group") or None
                child.custom_mix_name = r.get("custom_mix_name") or None
                child.custom_source_warehouse = r.get("custom_source_warehouse") or None
                sw = r.get("custom_source_warehouse")
                if sw and sw in wmap:
                    child.warehouse = wmap[sw]
                if truck is not None and truck != "":
                    child.custom_truck = truck
                if ddate:
                    child.delivery_date = ddate
                pi = pi + 1

            doc.insert(ignore_permissions=True)
            if mode == "submit":
                doc.submit()
            frappe.response["message"] = {"success": True,
                                          "data": {"name": doc.name}}

        # =====================================================================
        # B) UPDATE (direct DB)
        # =====================================================================
        elif intent == "update":
            if not name:
                frappe.response["message"] = {"success": False,
                                              "error": "name is required for update"}
            else:
                # Invoiced guardrail FIRST.
                inv = frappe.get_all("Sales Invoice Item",
                                     filters={"sales_order": name},
                                     fields=["name"], limit_page_length=1)
                if len(inv) > 0 and override != "1":
                    frappe.response["message"] = {"success": False, "blocked": True,
                        "error": "This order has a linked Sales Invoice. Editing "
                                 "is blocked. Confirm override to proceed."}
                else:
                    # Header update (only fields actually supplied).
                    hupd = {}
                    hi = 0
                    while hi < len(HFIELDS):
                        k = HFIELDS[hi]
                        v = fd.get(k)
                        if v is not None:
                            hupd[k] = v
                        hi = hi + 1
                    if len(hupd) > 0:
                        frappe.db.set_value("Sales Order", name, hupd,
                                            update_modified=True)

                    # Conversion rate for base_* (export orders often != 1).
                    crate = frappe.db.get_value("Sales Order", name,
                                                "conversion_rate")
                    crate = float(crate or 1) or 1.0

                    # Row operations.
                    pi = 0
                    while pi < len(parsed):
                        r = parsed[pi]
                        rn = r.get("rowname") or ""
                        is_del = (str(r.get("deleted") or "") == "1")

                        if rn and is_del:
                            frappe.db.delete("Sales Order Item", {"name": rn})
                            pi = pi + 1
                            continue

                        # Resolve UOM + conversion_factor.
                        ic = r.get("item_code")
                        uom = None
                        cf = 1.0
                        iname = ic
                        if ic and ic in item_cache:
                            uom = item_cache[ic]["uom"]
                            cf = item_cache[ic]["cf"]
                            iname = item_cache[ic]["item_name"]
                        elif ic:
                            irec = frappe.db.get_value("Item", ic,
                                    ["stock_uom", "sales_uom", "item_name"],
                                    as_dict=True)
                            if irec:
                                uom = irec.get("sales_uom") or irec.get("stock_uom")
                                iname = irec.get("item_name") or ic
                                if uom:
                                    urow = frappe.get_all("UOM Conversion Detail",
                                            filters={"parent": ic, "uom": uom},
                                            fields=["conversion_factor"],
                                            limit_page_length=1)
                                    if len(urow) > 0 and urow[0].get("conversion_factor"):
                                        cf = float(urow[0].get("conversion_factor"))
                            item_cache[ic] = {"uom": uom, "cf": cf, "item_name": iname}
                        if not cf or cf == 0:
                            cf = 1.0

                        stock_q = 0.0
                        try:
                            stock_q = float(r.get("custom_ordered_quantity") or 0)
                        except Exception:
                            stock_q = 0.0
                        qty = stock_q / cf
                        rate = 0.0
                        try:
                            rate = float(r.get("rate") or 0)
                        except Exception:
                            rate = 0.0
                        amt = qty * rate

                        sw = r.get("custom_source_warehouse")
                        whse = wmap[sw] if (sw and sw in wmap) else None

                        rowvals = {
                            "item_code": ic,
                            "item_name": iname,
                            "qty": qty,
                            "stock_qty": stock_q,
                            "conversion_factor": cf,
                            "custom_ordered_quantity": stock_q,
                            "rate": rate,
                            "base_rate": rate * crate,
                            "amount": amt,
                            "base_amount": amt * crate,
                            "custom_length": r.get("custom_length"),
                            "custom_box_type": r.get("custom_box_type") or None,
                            "custom_packrate": r.get("custom_packrate") or None,
                            "custom_mixed_box": 1 if str(r.get("custom_mixed_box") or "") == "1" else 0,
                            "custom_mix_group": r.get("custom_mix_group") or None,
                            "custom_mix_name": r.get("custom_mix_name") or None,
                            "custom_source_warehouse": sw or None,
                        }
                        if uom:
                            rowvals["uom"] = uom
                        nb = r.get("custom_number_of_boxes")
                        if nb is not None and nb != "":
                            rowvals["custom_number_of_boxes"] = nb
                        if whse:
                            rowvals["warehouse"] = whse
                        if truck is not None and truck != "":
                            rowvals["custom_truck"] = truck

                        if rn:
                            frappe.db.set_value("Sales Order Item", rn, rowvals,
                                                update_modified=False)
                        else:
                            nd = frappe.new_doc("Sales Order Item")
                            nd.parent = name
                            nd.parenttype = "Sales Order"
                            nd.parentfield = "items"
                            fk = list(rowvals.keys())
                            fki = 0
                            while fki < len(fk):
                                nd.set(fk[fki], rowvals[fk[fki]])
                                fki = fki + 1
                            nd.db_insert()
                        pi = pi + 1

                    # ---- C) AGGREGATE RECOMPUTE ----
                    kids = frappe.get_all("Sales Order Item",
                            filters={"parent": name},
                            fields=["name", "qty", "rate"], order_by="idx asc")
                    total_qty = 0
                    total = 0
                    ix = 1
                    a = 0
                    while a < len(kids):
                        q = float(kids[a].qty or 0)
                        rr = float(kids[a].rate or 0)
                        amt = q * rr
                        frappe.db.set_value("Sales Order Item", kids[a].name,
                                {"idx": ix, "amount": amt,
                                 "base_amount": amt * crate}, update_modified=False)
                        total_qty = total_qty + q
                        total = total + amt
                        ix = ix + 1
                        a = a + 1
                    btotal = total * crate
                    frappe.db.set_value("Sales Order", name,
                            {"total_qty": total_qty, "total": total,
                             "net_total": total, "base_total": btotal,
                             "base_net_total": btotal, "grand_total": total,
                             "base_grand_total": btotal, "rounded_total": total,
                             "base_rounded_total": btotal}, update_modified=True)

                    frappe.response["message"] = {"success": True,
                            "data": {"name": name, "total_qty": total_qty,
                                     "grand_total": total}}
        else:
            frappe.response["message"] = {"success": False,
                    "error": "Unknown intent '" + str(intent) + "'"}
except Exception as e:
    frappe.response["message"] = {"success": False, "error": str(e)}
