payload = frappe.request.get_json()
if not payload or 'farm' not in payload:
    frappe.response["error"] = "Farm is required in JSON payload"
    frappe.response["http_status_code"] = 400
else:
    farm_name = payload['farm']
    opl_name = payload.get('opl_name') # Optional: filter by specific OPL

    # ── Step 1: Get all relevant OPL names up front (only last 2 days) ────────
    opl_filters = {
        "docstatus": ["in", [0, 1]],
        "creation": [">=", frappe.utils.add_days(frappe.utils.nowdate(), -2)]
    }
    if opl_name:
        opl_filters["name"] = opl_name

    opl_docs = frappe.get_all(
        "Order Pick List",
        filters=opl_filters,
        fields=[
            "name",
            "customer",
            "custom_order_name",
            "custom_consignee",
            "sales_order",
            "custom_status",
        ],
    )

    if not opl_docs:
        frappe.response["message"] = f"No OPLs found for farm: {farm_name}"
        frappe.response["data"] = []
        frappe.response["vehicles"] = frappe.get_all("Vehicle", filters={"custom_dispatch_truck": ["!=", 1]}, fields=["name"], pluck="name")
        frappe.response["http_status_code"] = 200
    else:
        opl_names = [o["name"] for o in opl_docs]
        # Build OPL lookup dict once
        opl_map = {o["name"]: o for o in opl_docs}

        # ── Step 2: Single query for all pick list items ──────────────────────
        pick_list_items = frappe.get_all(
            "Pick List Item",
            filters={
                "custom_awaiting_transfer": 1,
                "custom_in_transit": 0,
                "custom_bucket": ["!=", ""],
                "warehouse": ["like", f"%{farm_name}%"],
                "parent": ["in", opl_names],
            },
            fields=[
                "name",
                "parent",
                "item_code",
                "item_name",
                "custom_bucket",
                "custom_shelf",
                "warehouse",
                "qty",
                "uom",
                "custom_stem_length",
                "sales_order",
                "sales_order_item",
            ],
        )

        if not pick_list_items:
            frappe.response["message"] = (
                f"No remote buckets awaiting transfer found for farm: {farm_name}"
            )
            frappe.response["data"] = []
            frappe.response["vehicles"] = frappe.get_all("Vehicle", filters={"custom_dispatch_truck": ["!=", 1]}, fields=["name"], pluck="name")
            frappe.response["http_status_code"] = 200
        else:
            # ── Step 3: Bulk fetch harvest dates for all buckets in one query ─
            bucket_ids = list(set(item["custom_bucket"] for item in pick_list_items))
            
            all_harvest_entries = frappe.get_all(
                "Stock Entry",
                filters={
                    "stock_entry_type": "Harvesting",
                    "custom_bucket_id": ["in", bucket_ids],
                    "docstatus": 1,
                },
                fields=["custom_bucket_id", "posting_date", "posting_time"],
                order_by="custom_bucket_id asc, posting_date desc, posting_time desc",
            )

            # Keep only the first (latest) entry per bucket
            bucket_harvest_map = {}
            for entry in all_harvest_entries:
                bid = entry["custom_bucket_id"]
                if bid not in bucket_harvest_map:
                    bucket_harvest_map[bid] = {
                        "harvest_date": entry["posting_date"],
                        "harvest_time": entry["posting_time"],
                    }

            # ── Step 4: Assemble result ───────────────────────────────────────
            result = []
            for item in pick_list_items:
                bucket_id = item["custom_bucket"]
                harvest_info = bucket_harvest_map.get(bucket_id, {})
                opl_info = opl_map.get(item["parent"], {})
                result.append({
                    # OPL Information
                    "opl_name": item["parent"],
                    "customer": opl_info.get("customer"),
                    "order_name": opl_info.get("custom_order_name"),
                    "consignee": opl_info.get("custom_consignee"),
                    "sales_order": item["sales_order"],
                    "opl_status": opl_info.get("custom_status"),
                    # Item Information
                    "pick_list_item_id": item["name"],
                    "item_code": item["item_code"],
                    "item_name": item["item_name"],
                    "qty": item["qty"],
                    "uom": item["uom"],
                    "stem_length": item["custom_stem_length"],
                    # Location Information
                    "shelf_location": item["custom_shelf"],
                    "warehouse": item["warehouse"],
                    # Bucket Information
                    "bucket_id": bucket_id,
                    "harvest_date": harvest_info.get("harvest_date"),
                    "harvest_time": harvest_info.get("harvest_time"),
                })

            # ── Step 5: Fetch only vehicle names where custom_dispatch_truck is not true ─
            vehicles = frappe.get_all(
                "Vehicle",
                filters={"custom_dispatch_truck": ["!=", 1]},
                fields=["name"],
                pluck="name"          # Returns simple list of names only
            )

            frappe.response["message"] = (
                f"Found {len(result)} remote buckets awaiting transfer for {farm_name}"
            )
            frappe.response["data"] = result
            frappe.response["vehicles"] = vehicles
            frappe.response["http_status_code"] = 200