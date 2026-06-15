# Frappe Server Script (Type: API), api_method = soMgrGet
# One Sales Order: header + items + linked-doc counts.
# Params: name.
# safe_exec: no import / def / += / list.append / sql. Flat while-loops only.

frappe.response["message"] = {"success": False, "error": "Script failed"}
try:
    name = frappe.form_dict.get("name")
    if not name:
        frappe.response["message"] = {"success": False, "error": "name is required"}
    else:
        doc = frappe.get_doc("Sales Order", name)

        hfields = ["name", "docstatus", "status", "customer", "customer_name",
                   "transaction_date", "delivery_date", "custom_farm",
                   "custom_order_name", "custom_week", "custom_s_number",
                   "custom_truck_details", "custom_daily_time",
                   "custom_packhouse_stage", "po_no", "selling_price_list",
                   "custom_consignee", "custom_consignee_country",
                   "custom_delivery_point", "custom_shipping_agent",
                   "custom_mode_of_transport", "territory",
                   "payment_terms_template", "custom_remote_truck_details",
                   "total_qty", "grand_total"]
        header = {}
        hi = 0
        while hi < len(hfields):
            k = hfields[hi]
            v = doc.get(k)
            if k in ("transaction_date", "delivery_date") and v:
                v = str(v)
            header[k] = v
            hi = hi + 1

        ifields = ["name", "idx", "item_code", "item_name", "qty", "uom",
                   "stock_uom", "conversion_factor", "custom_ordered_quantity",
                   "custom_length", "custom_box_type", "custom_packrate",
                   "custom_number_of_boxes", "custom_mixed_box",
                   "custom_mix_group", "custom_mix_name",
                   "custom_packrate_mixed_box", "warehouse",
                   "custom_source_warehouse", "custom_truck",
                   "custom_reserve_status", "rate", "amount", "cost_center",
                   "delivery_date"]
        items = []
        rows = doc.get("items") or []
        ri = 0
        while ri < len(rows):
            row = rows[ri]
            d = {}
            fi = 0
            while fi < len(ifields):
                k = ifields[fi]
                v = row.get(k)
                if k == "delivery_date" and v:
                    v = str(v)
                d[k] = v
                fi = fi + 1
            items = items + [d]
            ri = ri + 1

        # Linked-doc distinct-parent counts (server-side perms apply).
        dn = frappe.get_all("Delivery Note Item",
                            filters={"against_sales_order": name},
                            fields=["parent"], limit_page_length=0)
        dn_set = {}
        di = 0
        while di < len(dn):
            dn_set[dn[di].get("parent")] = 1
            di = di + 1

        si = frappe.get_all("Sales Invoice Item",
                            filters={"sales_order": name},
                            fields=["parent"], limit_page_length=0)
        si_set = {}
        sii = 0
        while sii < len(si):
            si_set[si[sii].get("parent")] = 1
            sii = sii + 1

        pl = frappe.get_all("Pick List Item",
                            filters={"sales_order": name},
                            fields=["parent"], limit_page_length=0)
        pl_set = {}
        pli = 0
        while pli < len(pl):
            pl_set[pl[pli].get("parent")] = 1
            pli = pli + 1

        links = {
            "delivery_notes": len(dn_set),
            "invoices": len(si_set),
            "pick_lists": len(pl_set),
        }

        frappe.response["message"] = {"success": True, "data": {
            "header": header, "items": items, "links": links}}
except Exception as e:
    frappe.response["message"] = {"success": False, "error": str(e)}
