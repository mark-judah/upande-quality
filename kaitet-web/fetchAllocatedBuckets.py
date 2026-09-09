# Frappe Server Script (Type: API), api_method = fetchAllocatedBuckets
# Buckets awaiting transfer for a farm, for the bucket-requests app.
# Visibility is gated by STATE (custom_awaiting_transfer=1, custom_in_transit=0),
# NOT by OPL creation date — a bucket allocated on a previous day is still
# awaiting transfer until it is loaded/shelved, so it must remain downloadable.
# Payload: { "farm": "<farm>", "opl_name": "<optional OPL>" }
payload = frappe.request.get_json()
if not payload or 'farm' not in payload:
    frappe.response["error"] = "Farm is required in JSON payload"
    frappe.response["http_status_code"] = 400
else:
    farm_name = payload['farm']
    opl_name = payload.get('opl_name')  # Optional: filter by specific OPL

    # Delivery-date window: buckets processed today go out on the next days, so
    # only download OPLs whose Sales Order delivers in [tomorrow, day-after]
    # (e.g. run on the 29th -> deliveries on the 30th and 31st). Overridable via
    # payload from_date/to_date. A specific opl_name request ignores the window.
    from_date = payload.get('from_date')
    to_date = payload.get('to_date')
    if not from_date:
        from_date = str(frappe.utils.add_days(frappe.utils.today(), 1))
    if not to_date:
        to_date = str(frappe.utils.add_days(frappe.utils.today(), 2))

    vehicles = frappe.get_all(
        "Vehicle",
        filters={"custom_dispatch_truck": ["!=", 1]},
        fields=["name"],
        pluck="name",
    )

    # ── Step 1: Pick List Item buckets awaiting transfer for this farm ─────────
    #    State (awaiting_transfer=1, not yet in transit) is the gate; buckets
    #    drop off automatically once transferred/shelved. No date filter.
    pli_filters = {
        "custom_awaiting_transfer": 1,
        "custom_in_transit": 0,
        "custom_bucket": ["!=", ""],
        "warehouse": ["like", "%" + farm_name + "%"],
        "parenttype": "Order Pick List",
    }
    if opl_name:
        pli_filters["parent"] = opl_name

    pick_list_items = frappe.get_all(
        "Pick List Item",
        filters=pli_filters,
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
            "No remote buckets awaiting transfer found for farm: " + farm_name
        )
        frappe.response["data"] = []
        frappe.response["vehicles"] = vehicles
        frappe.response["http_status_code"] = 200
    else:
        # ── Step 2: Parent OPL info for the matched buckets (docstatus 0/1) ────
        opl_names = list(set(item["parent"] for item in pick_list_items))
        opl_docs = frappe.get_all(
            "Order Pick List",
            filters={"name": ["in", opl_names], "docstatus": ["in", [0, 1]]},
            fields=[
                "name",
                "creation",
                "customer",
                "custom_order_name",
                "custom_consignee",
                "sales_order",
                "custom_status",
            ],
        )
        opl_map = {o["name"]: o for o in opl_docs}

        # ── Delivery-date window: keep only OPLs whose Sales Order delivers in
        #    [from_date, to_date]. Skipped for a specific opl_name request. ──────
        if not opl_name:
            so_names = list(set(
                (opl_map[n].get("sales_order")) for n in opl_map if opl_map[n].get("sales_order")
            ))
            in_window_so = {}
            if so_names:
                so_rows = frappe.get_all(
                    "Sales Order",
                    filters={"name": ["in", so_names],
                             "delivery_date": ["between", [from_date, to_date]]},
                    fields=["name"],
                )
                for sr in so_rows:
                    in_window_so[sr["name"]] = 1
            # Rebuild opl_map to only OPLs whose SO is in the delivery window.
            kept = {}
            for n in opl_map:
                so = opl_map[n].get("sales_order")
                if so and so in in_window_so:
                    kept[n] = opl_map[n]
            opl_map = kept

        # Drop items whose parent OPL is out-of-window / cancelled / missing.
        pick_list_items = [it for it in pick_list_items if it["parent"] in opl_map]

        if not pick_list_items:
            frappe.response["message"] = (
                "No remote buckets awaiting transfer found for farm: " + farm_name
            )
            frappe.response["data"] = []
            frappe.response["vehicles"] = vehicles
            frappe.response["http_status_code"] = 200
        else:
            # ── Step 3: Bulk fetch latest harvest date per bucket ──────────────
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
            bucket_harvest_map = {}
            for entry in all_harvest_entries:
                bid = entry["custom_bucket_id"]
                if bid not in bucket_harvest_map:
                    bucket_harvest_map[bid] = {
                        "harvest_date": entry["posting_date"],
                        "harvest_time": entry["posting_time"],
                    }

            # ── Step 4: Assemble result ───────────────────────────────────────
            # A bucket can appear on MULTIPLE Pick List Item rows of the same OPL
            # (mixed-box / split allocations). The app treats a physical bucket as
            # one, so collapse duplicates to a single row per (OPL, bucket) — the
            # transfer sync (setOfflineTrolleyFlags) flags all sibling rows anyway.
            result = []
            seen_bucket = {}
            for item in pick_list_items:
                bucket_id = item["custom_bucket"]
                dedupe_key = str(item["parent"]) + "||" + str(bucket_id).lower()
                if dedupe_key in seen_bucket:
                    continue
                seen_bucket[dedupe_key] = 1
                harvest_info = bucket_harvest_map.get(bucket_id, {})
                opl_info = opl_map.get(item["parent"], {})
                created = opl_info.get("creation")
                allocated_date = str(created)[:10] if created else None
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
                    "allocated_date": allocated_date,
                })

            frappe.response["message"] = (
                "Found " + str(len(result)) + " remote buckets awaiting transfer for " + farm_name
            )
            frappe.response["data"] = result
            frappe.response["vehicles"] = vehicles
            frappe.response["http_status_code"] = 200
