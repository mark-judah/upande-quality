try:
    # Required data from json:
    # farm
    # greenhouse
    # harvester
    # bucket_id
    # stem_length
    # item_code
    # quantity
    
    data = frappe.request.get_json()
    frappe.log_error("harvest payload", data)
    
    farm = data.get("farm")
    greenhouse = data.get("greenhouse")
    harvester = data.get("harvester")
    stem_length = data.get("stem_length")
    item_code = data.get("item_code")
    quantity = data.get("quantity")
    bucket_data = data.get("bucket_id")
    
    # Enforce the configurable per-bucket standards limit (Production Settings); 0/unset means no cap.
    max_standard_limit = frappe.db.get_value(
        "Production Settings", "Production Settings", "custom_max_standard_roses_stems_per_bucket"
    ) or 0
    if max_standard_limit and float(quantity or 0) > float(max_standard_limit):
        frappe.log_error("Bucket Rate Error", data)
        frappe.throw(_(f"The maximum stems per bucket for standards is {int(max_standard_limit)}"))
        
    # Check if greenhouse name contains "karen" (case-insensitive)
    is_karen_greenhouse = "karen" in greenhouse.lower() if greenhouse else False
    
    # Check if the item is a Spray Rose
    if item_code:
        item_group = frappe.db.get_value("Item", item_code, "item_group")
        
        # Block Spray Roses in non-Karen greenhouses
        if item_group == "Spray Roses" and not is_karen_greenhouse:
            frappe.log_error("Attempt to harvest sprays from the harvest form", data)
            frappe.throw(_("Spray Roses can only be harvested on the grading page"))
    

    # Handle both string and JSON dict formats for bucket_id
    if isinstance(bucket_data, dict):
        bucket_id = list(bucket_data.keys())[0]
    else:
        bucket_id = str(bucket_data).strip()
    
    
    stock_entry = frappe.new_doc("Stock Entry")
    
    farm_doc = frappe.get_doc("Farm", farm)
    stock_entry.stock_entry_type = "Harvesting"
    stock_entry.company = farm_doc.company
    stock_entry.custom_farm = farm
    stock_entry.custom_greenhouse = greenhouse
    stock_entry.custom_harvester = harvester
    stock_entry.custom_bucket_id = bucket_id
    stock_entry.to_warehouse = greenhouse
    stock_entry.custom_stem_length = stem_length
    
    # create bucket if it does not exist
    if not frappe.db.exists("Bucket QR Code", bucket_id):
        frappe.get_doc({
            "doctype": "Bucket QR Code",
            "id": bucket_id,
            "status": "Available"
        }).insert(ignore_permissions=True)

    # ======================================
    # BUCKET STATUS VALIDATION (with row lock)
    # ======================================
    # Lock the bucket row to prevent race conditions from simultaneous harvest requests
    bucket_qr_doc = frappe.get_doc("Bucket QR Code", bucket_id, for_update=True)
    last_se = bucket_qr_doc.last_stock_entry
    last_se_doc = None
    last_farm = ""
    last_receiving_date = ""
    
    if last_se:
        last_se_doc = frappe.get_doc("Stock Entry", last_se)
        last_farm = last_se_doc.custom_farm
        
        days_ago = frappe.utils.date_diff(frappe.utils.today(), last_se_doc.posting_date)
        
        if days_ago == 0:
            last_receiving_date = "today"
        else:
            last_receiving_date = f"{days_ago} day(s) ago"
        
    
    # Block harvesting if bucket is already in use
    if bucket_qr_doc.status == "In Use":
        frappe.response["http_status_code"] = 400
        frappe.response["error"] = f"Bucket {bucket_id} is already in use. Please receive it first before harvesting again."
        frappe.throw(f"Bucket {bucket_id} is already in use. Please receive it first before harvesting again.")
    
    # ======================================
    # COMMENTED OUT: AUTO-RECEIVING LOGIC
    # ======================================
    # This logic was causing discrepancies between harvested and received quantities
    # It would auto-receive previous harvests when a new harvest was created
    # 
    # if bucket_qr_doc.status == "In Use":
    #     # Check if 12 hours have passed since last stock entry
    #     if last_se_doc:
    #         hours_since_last_harvest = frappe.utils.time_diff_in_hours(
    #             frappe.utils.now_datetime(), 
    #             last_se_doc.creation
    #         )
    #         
    #         # Prevent double harvesting within 12 hours
    #         if hours_since_last_harvest < 12:
    #             hours_remaining = 12 - hours_since_last_harvest
    #             frappe.response["http_status_code"] = 400
    #             frappe.response["error"] = f"Bucket already harvested."
    #             frappe.throw(f"Bucket already harvested.")
    #         
    #         # Only auto-receive if 12 hours have passed
    #         if hours_since_last_harvest >= 12:
    #             # Auto-receive the bucket with the posting date of last stock entry
    #             company = "Karen Roses"
    #             cost_center = "Main - KR"
    #             
    #             # Get item info from last stock entry
    #             item_row = frappe.db.get_all(
    #                 "Stock Entry Detail",
    #                 filters={"parent": last_se},
    #                 fields=["item_code", "qty", "uom", "t_warehouse"],
    #                 order_by="idx asc",
    #                 limit_page_length=1
    #             )
    #             
    #             if not item_row:
    #                 frappe.throw(f"No item found in last stock entry {last_se}")
    #             
    #             item = item_row[0]
    #             last_item_code = item["item_code"]
    #             last_quantity = float(item["qty"])
    #             last_uom = item["uom"]
    #             from_warehouse = item["t_warehouse"]
    #             to_warehouse = f"{last_farm} Receiving Cold Store - KR"
    #             
    #             # Get batch number from last stock entry
    #             batch_no = last_se_doc.custom_harvest_batch_no
    #             
    #             # Create Receiving Stock Entry with posting date from last stock entry
    #             receiving_stock_entry = frappe.get_doc({
    #                 "doctype": "Stock Entry",
    #                 "stock_entry_type": "Receiving",
    #                 "custom_received_bucket_id": bucket_id,
    #                 "custom_harvest_batch_no": batch_no,
    #                 "set_posting_time": 1,
    #                 "posting_date": last_se_doc.posting_date,
    #                 "company": company,
    #                 "from_warehouse": from_warehouse,
    #                 "to_warehouse": to_warehouse,
    #                 "cost_center": cost_center,
    #                 "custom_farm": last_farm,
    #                 "custom_greenhouse": last_se_doc.custom_greenhouse,
    #                 "custom_harvester": last_se_doc.custom_harvester,
    #                 "custom_business_unit": "Roses",
    #                 "items": [
    #                     {
    #                         "item_code": last_item_code,
    #                         "qty": last_quantity,
    #                         "uom": last_uom,
    #                         "stock_uom": last_uom,
    #                         "t_warehouse": to_warehouse,
    #                         "s_warehouse": from_warehouse,
    #                         "cost_center": cost_center,
    #                     }
    #                 ]
    #             })
    #             
    #             receiving_stock_entry.insert(ignore_permissions=True)
    #             receiving_stock_entry.submit()
    #             
    #             # Mark last stock entry as scanned
    #             frappe.get_doc("Stock Entry", last_se).db_set("custom_scanned", 1)
    #             frappe.db.commit()
        

    timestamp = frappe.utils.now_datetime()
    harvest_batch_id = f"{bucket_id}-{farm}-{item_code}-{timestamp}"
    
    stock_entry.custom_harvest_batch_no = harvest_batch_id
    stock_entry.custom_business_unit = "Roses"
    
    stock_entry.append("items", {
        "item_code": item_code,
        "qty": quantity
    })
    
    se = stock_entry.insert()
    se_submit = stock_entry.submit()
    
    if se and se_submit:
        # ======================================
        # UPDATE BUCKET STATUS TO "In Use"
        # ======================================
        # Mark bucket as In Use and link this stock entry so subsequent
        # harvest attempts on the same bucket are blocked until receiving.
        bucket_qr_doc.status = "In Use"
        bucket_qr_doc.last_stock_entry = stock_entry.name
        bucket_qr_doc.save(ignore_permissions=True)
        frappe.db.commit()

        # ==================================================================
        # RE-USE CLEANUP
        # This bucket id is starting a fresh life, so clear leftovers from its
        # previous cycle that would otherwise make it invisible downstream:
        #   (1) if it is STILL ON A SHELF, remove those Shelf Items (a bucket
        #       being harvested is leaving the cold store to be refilled);
        #   (2) if it is UNDISCARDED on any Discard Request, mark those rows
        #       discarded — the old discard obligation is void now that the
        #       bucket has been reused, so allocation/discard lists stop
        #       treating it as pending discard.
        # Both are no-ops when there is nothing to clear, and the whole block
        # is isolated so a cleanup hiccup can never fail the harvest itself.
        try:
            # Gather previous-life artifacts BEFORE clearing them, so the
            # anomaly record can capture where the bucket was.
            stale_shelf_items = frappe.get_all(
                "Shelf Item",
                filters={"bucket_id": bucket_id},
                fields=["name", "parent", "variety", "stem_qty"],
            )
            stale_disc = frappe.get_all(
                "Discard Request Bucket",
                filters={"bucket_id": bucket_id, "parenttype": "Discard Request",
                         "discarded": ["!=", 1]},
                fields=["name", "parent"],
            )

            if stale_shelf_items or stale_disc:
                # Classify the step skipped in the bucket's previous life:
                #   on a discard request -> discarding was skipped
                #   on a shelf only      -> issuing was skipped
                if stale_disc:
                    skipped_step = "Discarding Skipped"
                else:
                    skipped_step = "Issuing Skipped"

                prev_shelf = stale_shelf_items[0]["parent"] if stale_shelf_items else None
                prev_variety = stale_shelf_items[0].get("variety") if stale_shelf_items else item_code
                prev_stems = 0
                for shi in stale_shelf_items:
                    prev_stems = prev_stems + (shi.get("stem_qty") or 0)
                prev_dr = stale_disc[0]["parent"] if stale_disc else None

                # Remove from shelf in BOTH cases (issuing- OR discarding-skipped).
                for shi in stale_shelf_items:
                    frappe.delete_doc("Shelf Item", shi["name"], force=1, ignore_permissions=True)
                # Void any pending discard listings for the reused bucket.
                for drb in stale_disc:
                    frappe.db.set_value(
                        "Discard Request Bucket", drb["name"], "discarded", 1,
                        update_modified=False
                    )

                # Record the anomaly for later reporting.
                frappe.get_doc({
                    "doctype": "Bucket Reuse Anomaly",
                    "bucket_id": bucket_id,
                    "skipped_step": skipped_step,
                    "detected_on": frappe.utils.now(),
                    "farm": farm,
                    "greenhouse": greenhouse,
                    "variety": prev_variety,
                    "stems": prev_stems,
                    "previous_shelf": prev_shelf,
                    "discard_request": prev_dr,
                    "harvest_stock_entry": stock_entry.name,
                }).insert(ignore_permissions=True)

                frappe.db.commit()
        except Exception as ce:
            frappe.log_error("Harvest reuse cleanup error", str(ce))

        frappe.response["message"] = "Harvesting Stock Entry submitted successfully"
        frappe.response["stock_entry"] = stock_entry.name
    
except frappe.PermissionError as e:
    # frappe.log_error("Permission Error - Stock Entry Creation", f"User {frappe.session.user} does not have permission to create Stock Entry")
    frappe.response["http_status_code"] = 200
    frappe.response["error"] = "You do not have sufficient permissions to create Stock Entry. Please contact your IT Administrator"
    
    # Don't ever remove this throw line. The validation on frontend will fail
    # 
    # 
    frappe.throw("Permission denied: You do not have sufficient permissions to create Stock Entry")
    
    
except Exception as e:
    frappe.log_error("Harvesting Error", str(e))
    frappe.response["http_status_code"] = 500
    frappe.response["message"] = "An error occurred while submitting stock entry"
    frappe.response["error"] = str(e)