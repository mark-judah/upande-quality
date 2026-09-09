data = frappe.request.get_json()
bucket_id = (data.get("bucket_id") or "").strip()
requested_new_bucket = (data.get("new_bucket_id") or "").strip()
# Specific Pick List Item to swap. Required when a bucket is allocated to multiple
# OPLs — the caller must pick one so other orders aren't affected.
requested_pli = (data.get("pick_list_item") or "").strip()

# Permission check via Has Role (same role as bunch correction)
has_role_rows = frappe.get_all(
    "Has Role",
    filters={"parent": frappe.session.user, "role": "Harvest Details Updater"},
    fields=["name"],
    limit=1,
)
is_admin = frappe.session.user == "Administrator"
user_has_role = bool(has_role_rows) or is_admin

if not user_has_role:
    frappe.response["http_status_code"] = 403
    frappe.response["data"] = {"error": "Role 'Harvest Details Updater' required."}

if user_has_role:
    if not bucket_id:
        frappe.response["http_status_code"] = 400
        frappe.response["data"] = {"error": "bucket_id is required."}

    if bucket_id:
        try:
            # 1. Find Pick List Item(s) that own this bucket.
            #    If pick_list_item is given, scope to that exact row. Otherwise,
            #    fall back to the latest — but require a single match. If multiple
            #    PLIs exist and the caller didn't pick, return 409 with the list.
            base_pli_filters = {"custom_bucket": bucket_id}
            if requested_pli:
                base_pli_filters["name"] = requested_pli
            pli_rows = frappe.get_all(
                "Pick List Item",
                filters=base_pli_filters,
                fields=[
                    "name", "parent", "parenttype",
                    "item_code", "item_name", "description",
                    "qty", "stock_qty", "uom", "conversion_factor", "stock_uom",
                    "warehouse", "custom_stem_length", "custom_shelf",
                    "custom_sale_order_item", "custom_box_id",
                    "custom_truck", "custom_rate", "custom_packrate",
                    "sales_order", "sales_order_item",
                    "custom_issued", "creation",
                ],
                order_by="creation desc",
                limit=50 if not requested_pli else 1,
            )

            if not pli_rows:
                frappe.response["http_status_code"] = 404
                frappe.response["data"] = {
                    "error": "No allocation found for bucket " + bucket_id +
                             (" (pick_list_item " + requested_pli + ")" if requested_pli else "") + "."
                }

            if pli_rows and not requested_pli and len(pli_rows) > 1:
                # Bucket is allocated to multiple OPLs — caller must pick one.
                opl_names = list({r["parent"] for r in pli_rows if r.get("parent")})
                frappe.response["http_status_code"] = 409
                frappe.response["data"] = {
                    "error": "Bucket " + bucket_id + " is allocated to " +
                             str(len(pli_rows)) + " Pick List Items across " +
                             str(len(opl_names)) + " OPL(s). " +
                             "Supply pick_list_item to choose one.",
                    "needs_pick_list_item": True,
                    "candidate_pick_list_items": [r["name"] for r in pli_rows],
                }

            if pli_rows and (requested_pli or len(pli_rows) == 1):
                pli = pli_rows[0]
                opl_name = pli.get("parent")
                sale_order_item = pli.get("custom_sale_order_item")
                so_name = pli.get("sales_order")
                variety = pli.get("item_code") or ""
                stem_length = pli.get("custom_stem_length") or ""

                # 2. Determine farm — prefer the shelf the bucket was picked from (OPL's source).
                # This stays consistent even when the same bucket has been reused across farms.
                shelf_name = pli.get("custom_shelf") or ""
                farm = ""
                if shelf_name:
                    shelf_meta = frappe.get_all(
                        "Shelf",
                        filters={"name": shelf_name},
                        fields=["farm"],
                        limit=1,
                    )
                    if shelf_meta:
                        farm = shelf_meta[0].get("farm") or ""
                if not farm:
                    old_harvest_rows = frappe.get_all(
                        "Stock Entry",
                        filters={"custom_bucket_id": bucket_id, "stock_entry_type": "Harvesting"},
                        fields=["custom_farm"],
                        order_by="posting_date desc, posting_time desc, creation desc",
                        limit=1,
                    )
                    if old_harvest_rows:
                        farm = old_harvest_rows[0].get("custom_farm") or ""

                if not variety or not stem_length or not farm:
                    frappe.response["http_status_code"] = 400
                    frappe.response["data"] = {
                        "error": "Cannot determine variety/length/farm for bucket " + bucket_id
                    }

                if variety and stem_length and farm:
                    # 3. Find candidate replacement Shelf Item(s)
                    # If new_bucket_id is provided, validate THAT bucket matches the criteria.
                    # Otherwise, fall back to FIFO auto-pick.
                    if requested_new_bucket:
                        candidates = frappe.db.sql(
                            """
                            SELECT si.name AS shelf_item, si.parent AS shelf,
                                   si.bucket_id, si.variety, si.stem_length,
                                   si.stem_qty, si.date_added,
                                   si.warehouse, si.greenhouse
                            FROM `tabShelf Item` si
                            INNER JOIN `tabShelf` s ON s.name = si.parent
                            WHERE si.variety = %s
                              AND si.stem_length = %s
                              AND s.farm = %s
                              AND si.bucket_id = %s
                              AND si.bucket_id != %s
                            LIMIT 1
                            """,
                            (variety, stem_length, farm, requested_new_bucket, bucket_id),
                            as_dict=True,
                        )
                        if not candidates:
                            frappe.response["http_status_code"] = 404
                            frappe.response["data"] = {
                                "error": "Bucket " + requested_new_bucket +
                                         " is not a valid replacement (must be shelved, " +
                                         variety + " " + stem_length + " from " + farm + ")."
                            }
                    else:
                        candidates = frappe.db.sql(
                            """
                            SELECT si.name AS shelf_item, si.parent AS shelf,
                                   si.bucket_id, si.variety, si.stem_length,
                                   si.stem_qty, si.date_added,
                                   si.warehouse, si.greenhouse
                            FROM `tabShelf Item` si
                            INNER JOIN `tabShelf` s ON s.name = si.parent
                            WHERE si.variety = %s
                              AND si.stem_length = %s
                              AND s.farm = %s
                              AND si.bucket_id != %s
                            ORDER BY si.date_added ASC
                            LIMIT 1
                            """,
                            (variety, stem_length, farm, bucket_id),
                            as_dict=True,
                        )

                        if not candidates:
                            frappe.response["http_status_code"] = 404
                            frappe.response["data"] = {
                                "error": "No replacement available for " + variety +
                                         " " + stem_length + " from " + farm + "."
                            }

                    if candidates:
                        new = candidates[0]
                        new_bucket_id = new["bucket_id"]
                        new_shelf = new["shelf"]
                        new_shelf_item = new["shelf_item"]
                        new_warehouse = new.get("warehouse") or pli.get("warehouse") or ""
                        now_ts = frappe.utils.now()

                        # Swap-in-place: update the existing Pick List Item to point at the
                        # new bucket. This avoids adding/removing rows on a submitted OPL.
                        frappe.db.set_value("Pick List Item", pli["name"], {
                            "custom_bucket": new_bucket_id,
                            "custom_shelf": new_shelf,
                            "warehouse": new_warehouse,
                            "custom_issued": 1,
                        })

                        # Un-issue the old bucket's latest SE
                        old_se_rows = frappe.get_all(
                            "Stock Entry",
                            filters={"custom_bucket_id": bucket_id, "docstatus": 1},
                            fields=["name"],
                            order_by="creation desc",
                            limit=1,
                        )
                        if old_se_rows:
                            frappe.db.set_value(
                                "Stock Entry", old_se_rows[0]["name"],
                                "custom_issued_to", None
                            )

                        # Issue the replacement bucket's latest SE
                        new_se_rows = frappe.get_all(
                            "Stock Entry",
                            filters={"custom_bucket_id": new_bucket_id, "docstatus": 1},
                            fields=["name"],
                            order_by="creation desc",
                            limit=1,
                        )
                        if new_se_rows:
                            frappe.db.set_value(
                                "Stock Entry", new_se_rows[0]["name"],
                                "custom_issued_to", sale_order_item
                            )

                        # Remove the replacement bucket from its shelf
                        shl_log = frappe.db.get_value("Shelving Log", {"shelf_item": new_shelf_item, "reason": "Shelved"}, "name")
                        if shl_log:
                            frappe.db.set_value("Shelving Log", shl_log, {"reason": "Replaced", "removed_on": frappe.utils.now_datetime()}, update_modified=False)
                        frappe.delete_doc("Shelf Item", new_shelf_item,
                                          force=1, ignore_permissions=True)
                        frappe.db.set_value("Shelf", new_shelf, "modified", now_ts)

                        # Touch parent OPL
                        frappe.db.set_value("Order Pick List", opl_name, "modified", now_ts)

                        frappe.db.commit()

                        frappe.response["data"] = {
                            "status": "success",
                            "message": "Bucket " + bucket_id + " replaced with " + new_bucket_id + ".",
                            "old_bucket": bucket_id,
                            "new_bucket": new_bucket_id,
                            "opl": opl_name,
                            "sale_order_item": sale_order_item,
                            "variety": variety,
                            "stem_length": stem_length,
                            "farm": farm,
                        }

        except Exception as e:
            frappe.db.rollback()
            frappe.log_error("replaceBucket error: " + str(e))
            frappe.response["http_status_code"] = 500
            frappe.response["data"] = {"error": str(e)}
