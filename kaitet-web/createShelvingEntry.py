# ---------------------------------------------------------
# VALIDATION (NO RETURNS)
# ---------------------------------------------------------
def validation(data, result):
    validation_rule = [
        ('shelf_id_not_null', "Shelf ID is missing."),
        ('bucket_id_not_null', "Bucket ID is missing."),
        ('two_buckets_per_shelf', "The shelf is full."),
        ('duplicate_entry', "The bucket has already been shelved."),
        ('farm_not_null', "Farm is missing.")
    ]
    
    result["passed"] = True
    result["reason"] = "validation_successful"
    result["message"] = "Validation successful."
    result["shelf_doc"] = None
    
    # shelf_id_not_null
    if not data.get('shelf_id'):
        result["passed"] = False
        result["reason"] = validation_rule[0][0]
        result["message"] = validation_rule[0][1]
        frappe.log_error("Shelf ID Validation Failed", f"Shelf ID is missing. Data: {data}")
    
    # bucket_id_not_null
    elif not data.get('bucket_id'):
        result["passed"] = False
        result["reason"] = validation_rule[1][0]
        result["message"] = validation_rule[1][1]
        frappe.log_error("Bucket ID Validation Failed", f"Bucket ID is missing. Data: {data}")
    
    # farm_not_null
    elif not data.get('farm'):
        result["passed"] = False
        result["reason"] = validation_rule[4][0]
        result["message"] = validation_rule[4][1]
        frappe.log_error("Farm Validation Failed", f"Farm is missing. Data: {data}")
    
    # If prelim validation passed → load/create shelf
    if result["passed"]:
        shelf_id = data.get('shelf_id')
        try:
            shelf_doc = frappe.get_doc("Shelf", shelf_id)
        except frappe.DoesNotExistError:
            new_shelf_doc = frappe.new_doc("Shelf")
            new_shelf_doc.name = shelf_id
            new_shelf_doc.shelf_id = shelf_id
            new_shelf_doc.insert()
            shelf_doc = new_shelf_doc
        
        result["shelf_doc"] = shelf_doc
        bucket_id = data.get("bucket_id")
        
        # duplicate_entry - CHECK CURRENT SHELF
        if shelf_doc and shelf_doc.items:
            for item in shelf_doc.items:
                if item.bucket_id.lower() == bucket_id.lower():
                    result["passed"] = False
                    result["reason"] = validation_rule[3][0]
                    result["message"] = validation_rule[3][1]
                    frappe.log_error("Duplicate Entry Validation Failed", 
                                   f"Bucket {bucket_id} already exists on shelf {shelf_id}. Data: {data}")
        
        # duplicate_entry - CHECK ALL OTHER SHELVES
        if result["passed"]:
            other_shelves = frappe.get_all(
                "Shelf Item",
                filters={
                    "bucket_id": bucket_id,
                    "parent": ["!=", shelf_id]  # Exclude current shelf
                },
                fields=["parent"],
                limit=1
            )
            
            if other_shelves:
                result["passed"] = False
                result["reason"] = validation_rule[3][0]
                result["message"] = f"The bucket has already been shelved on shelf {other_shelves[0].parent}."
                frappe.log_error("Duplicate Entry Validation Failed", 
                               f"Bucket {bucket_id} already shelved on shelf {other_shelves[0].parent}. Data: {data}")
        
        # two_buckets_per_shelf (2 max)
        if result["passed"] and shelf_doc.items and len(shelf_doc.items) >= 2:
            result["passed"] = False
            result["reason"] = validation_rule[2][0]
            result["message"] = validation_rule[2][1]
            frappe.log_error("Shelf Capacity Validation Failed", 
                           f"Shelf {shelf_id} is full (2 buckets max). Data: {data}")


# ---------------------------------------------------------
# FETCH LATEST RECEIVING OR LATE RECEIPT (NO RETURNS)
# ---------------------------------------------------------
def fetch_latest_receiving(bucket_id, result):
    result["receiving_doc"] = None
    
    entries = frappe.get_all(
        "Stock Entry",
        filters={
            "stock_entry_type": ["in", ["Receiving", "Late Receipt"]],
            "custom_received_bucket_id": bucket_id,
            "docstatus": 1
        },
        fields=["name"],
        order_by="creation desc",
        limit=1
    )
    
    if entries:
        try:
            doc = frappe.get_doc("Stock Entry", entries[0].name)
            result["receiving_doc"] = doc
        except:
            pass


# ---------------------------------------------------------
# MARK BUCKET SHELVED (NO RETURNS)
# ---------------------------------------------------------
def mark_bucket_as_shelved(bucket_id, receiving_doc, result):
    result["shelved_info"] = None
    
    if receiving_doc:
        try:
            item = receiving_doc.items[0]
            item.custom_shelved_at_kapkolia = 1
            receiving_doc.save(ignore_permissions=True)
            result["shelved_info"] = {
                "stock_entry": receiving_doc.name,
                "shelved": True
            }
        except:
            result["shelved_info"] = None


# ---------------------------------------------------------
# UPDATE OPL TRANSIT STATUS (NO RETURNS)
# ---------------------------------------------------------
def update_transit_status(bucket_id, result):
    result["transit_updated"] = False
    
    transit_rows = frappe.get_all(
        "Pick List Item",
        filters={
            "custom_bucket": bucket_id,
            "custom_in_transit": 1,
            "custom_shelved": 0
        },
        fields=["name", "parent"],
        limit=1
    )
    
    if transit_rows:
        opl_name = transit_rows[0].parent
        child_name = transit_rows[0].name
        opl_doc = frappe.get_doc("Order Pick List", opl_name)
        for row in opl_doc.locations:
            if row.name == child_name:
                row.custom_in_transit = 0
                row.custom_shelved = 1
                break
        opl_doc.save(ignore_permissions=True)
        result["transit_updated"] = True
        result["transit_opl"] = opl_name


# ─────────────────────────────────────────────────────
# NEW: UPDATE BUCKET ALLOCATION STATUS TRANSIT FLAGS
# ─────────────────────────────────────────────────────
def update_bas_transit_status(bucket_id, variety, farm, shelf_id, result):
    """
    Clear in_transit flag and update farm/shelf location in Bucket Allocation Status.
    Recalculate available_quantity to make balance available for allocation.
    """
    result["bas_updated"] = False
    result["bas_available_qty"] = 0
    
    try:
        bas_name = frappe.db.get_value(
            "Bucket Allocation Status",
            {"bucket_id": bucket_id, "item_code": variety},
            "name"
        )
        
        if bas_name:
            bas_doc = frappe.get_doc("Bucket Allocation Status", bas_name)
            
            # Only update if it was marked in_transit
            if bas_doc.in_transit == 1:
                bas_doc.in_transit = 0
                bas_doc.shelf_farm = farm
                bas_doc.shelf_location = shelf_id
                
                # Recalculate available quantity
                bas_doc.available_quantity = bas_doc.total_quantity - bas_doc.allocated_quantity
                
                bas_doc.save(ignore_permissions=True)
                frappe.db.commit()
                
                result["bas_updated"] = True
                result["bas_available_qty"] = bas_doc.available_quantity
                
                frappe.log_error(
                    title="BAS Transit Cleared",
                    message=f"Bucket: {bucket_id}, Variety: {variety}, Farm: {farm}\n"
                            f"Total: {bas_doc.total_quantity}, Allocated: {bas_doc.allocated_quantity}, "
                            f"Available: {bas_doc.available_quantity}"
                )
    except Exception as e:
        frappe.log_error("BAS Transit Update Failed", frappe.get_traceback())


# ─────────────────────────────────────────────────────
# NEW: CHECK IF OPL CAN BE AUTO-SUBMITTED
# ─────────────────────────────────────────────────────
def check_and_submit_opl(bucket_id, result):
    """
    Check if OPL(s) referencing this bucket can now be submitted.
    Submit only when no row is still in transit (custom_in_transit = 1) or
    awaiting transfer (custom_awaiting_transfer = 1) - i.e. every transfer
    bucket has been shelved at the sales farm. Local buckets carry neither flag.
    """
    result["opl_submitted"] = []
    
    try:
        # Find OPL(s) that reference this bucket
        opl_rows = frappe.db.sql("""
            SELECT DISTINCT parent
            FROM `tabPick List Item`
            WHERE custom_bucket = %s
        """, bucket_id, as_dict=True)
        
        for row in opl_rows:
            opl_name = row.parent
            opl_doc = frappe.get_doc("Order Pick List", opl_name)
            
            # Skip if already submitted
            if opl_doc.docstatus == 1:
                continue
            
            # Submit only when EVERY transfer bucket has been shelved at the sales farm.
            # A bucket still being transferred is one that is in transit
            # (custom_in_transit = 1), not yet moved (custom_awaiting_transfer = 1),
            # OR saved to a trolley but not yet shelved (custom_loaded_in_trolley = 1
            # and custom_shelved != 1 — saveTrolleyData clears awaiting_transfer, so
            # this state would otherwise slip past and let the OPL submit early).
            # Local sales-shelf buckets carry none of these flags, so they never block.
            # (Requiring custom_shelved = 1 on EVERY row would wrongly block local
            # buckets, which never get shelved-at-kapkolia; hence the loaded gate.)
            all_ready = True
            for loc in opl_doc.locations:
                if loc.custom_in_transit == 1 or loc.custom_awaiting_transfer == 1:
                    all_ready = False
                    break
                if (loc.custom_loaded_in_trolley or 0) == 1 and (loc.custom_shelved or 0) != 1:
                    all_ready = False
                    break
            
            # Submit if all ready
            if all_ready:
                opl_doc.flags.ignore_permissions = True
                opl_doc.submit()
                frappe.db.commit()
                
                result["opl_submitted"].append(opl_name)
                
                frappe.log_error(
                    title="OPL Auto-Submitted",
                    message=f"OPL {opl_name} auto-submitted after bucket {bucket_id} shelved. "
                            f"All items now ready for packing."
                )
                
    except Exception as e:
        frappe.log_error("OPL Auto-Submit Check Failed", frappe.get_traceback())


# ---------------------------------------------------------
# MAIN EXECUTION BLOCK
# ---------------------------------------------------------
try:
    data = frappe.request.get_json()
    result = {}
    
    validation(data, result)
    
    # VALIDATION FAILED → respond
    if not result.get("passed"):
        frappe.response["data"] = {
            "status": "failed",
            "reason": result.get("reason"),
            "message": result.get("message"),
            "payload": {
                "shelf_id": data.get('shelf_id'),
                "bucket_id": data.get('bucket_id')
            }
        }
    else:
        bucket_id = data.get("bucket_id")
        shelf_id = data.get("shelf_id")
        farm = data.get("farm")
        
        # FETCH RECEIVING
        fetch_latest_receiving(bucket_id, result)
        receiving_doc = result.get("receiving_doc")
        
        if not receiving_doc:
            frappe.log_error("Receiving Entry Not Found", 
                           f"No Receiving or Late Receipt entry found for bucket {bucket_id}. Data: {data}")
            frappe.response["data"] = {
                "status": "failed",
                "reason": "not_received",
                "message": "This bucket has no Receiving or Late Receipt entry.",
                "payload": {"bucket_id": bucket_id}
            }
        else:
            # ─────────────────────────────────────────────────────────────
            # VALIDATIONS: prevent stale / old-cycle receiving data
            # ─────────────────────────────────────────────────────────────
            today_date = frappe.utils.getdate(frappe.utils.today())
            recv_date = frappe.utils.getdate(receiving_doc.posting_date)
            
            # 1. Harvest-to-Receiving gap must be ≤ 1 day
            harvest_entry = frappe.get_all(
                "Stock Entry",
                filters={
                    "stock_entry_type": "Harvesting",
                    "custom_bucket_id": bucket_id,
                    "posting_date": recv_date,
                    "docstatus": 1
                },
                fields=["name", "posting_date"],
                order_by="creation desc",
                limit=1
            )
            
            if not harvest_entry:
                harvest_entry = frappe.get_all(
                    "Stock Entry",
                    filters={
                        "stock_entry_type": "Harvesting",
                        "custom_bucket_id": bucket_id,
                        "posting_date": frappe.utils.add_days(recv_date, -1),
                        "docstatus": 1
                    },
                    fields=["name", "posting_date"],
                    order_by="creation desc",
                    limit=1
                )
            
            if not harvest_entry:
                frappe.log_error("Harvesting Entry Not Found Validation Failed",
                                f"No harvesting entry found for bucket {bucket_id} "
                                f"on or before receiving date {recv_date}. Data: {data}")
                frappe.response["data"] = {
                    "status": "failed",
                    "reason": "no_matching_harvest",
                    "message": f"No harvesting entry found for bucket {bucket_id} "
                               f"within 1 day of receiving date ({recv_date}).",
                    "payload": {
                        "bucket_id": bucket_id,
                        "received_on": str(recv_date)
                    }
                }
            else:
                harvest_date = frappe.utils.getdate(harvest_entry[0].posting_date)
                harvest_to_recv_days = (recv_date - harvest_date).days
                
                if harvest_to_recv_days > 1:
                    frappe.log_error("Harvest-to-Receiving Gap Validation Failed",
                                    f"Bucket {bucket_id} harvested on {harvest_date}, "
                                    f"received on {recv_date} ({harvest_to_recv_days} days gap). Data: {data}")
                    frappe.response["data"] = {
                        "status": "failed",
                        "reason": "harvest_receiving_gap_too_large",
                        "message": f"Bucket harvested on {harvest_date} but received on {recv_date} "
                                   f"({harvest_to_recv_days} days apart). Maximum allowed gap is 1 day.",
                        "payload": {
                            "bucket_id": bucket_id,
                            "harvested_on": str(harvest_date),
                            "received_on": str(recv_date),
                            "gap_days": harvest_to_recv_days
                        }
                    }
                else:
                    # 2. Staleness check
                    days_since_receiving = (today_date - recv_date).days
                    origin_farm = receiving_doc.custom_farm or farm
                    max_allowed_days = 50 if origin_farm and origin_farm.lower() == "kapkolia" else 40
                    
                    if days_since_receiving > max_allowed_days:
                        frappe.log_error("Stale Receiving Date Validation Failed",
                                        f"Bucket {bucket_id} received on {recv_date} "
                                        f"({days_since_receiving} days ago). "
                                        f"Origin farm: {origin_farm}, max allowed: {max_allowed_days} days. Data: {data}")
                        frappe.response["data"] = {
                            "status": "failed",
                            "reason": "stale_receiving_date",
                            "message": f"Cannot shelf bucket — received on {recv_date} "
                                       f"({days_since_receiving} days ago). "
                                       f"Maximum allowed for {origin_farm} is {max_allowed_days} day(s).",
                            "payload": {
                                "bucket_id": bucket_id,
                                "origin_farm": origin_farm,
                                "received_on": str(recv_date),
                                "days_since_receiving": days_since_receiving,
                                "max_allowed_days": max_allowed_days
                            }
                        }
                    else:
                        # ─────────────────────────────────────────────────────
                        # ALL CHECKS PASSED → proceed with shelving
                        # ─────────────────────────────────────────────────────
                        
                        # ---------------------------------------------------------
                        # CHECK IF BUCKET WAS IN TRANSIT → update OPL
                        # ---------------------------------------------------------
                        update_transit_status(bucket_id, result)
                        
                        # ---------------------------------------------------------
                        # SHELVING LOGIC
                        # ---------------------------------------------------------
                        recv_item = receiving_doc.items[0]
                        qty = recv_item.qty
                        variety = recv_item.item_code
                        origin_greenhouse = recv_item.s_warehouse
                        warehouse = recv_item.t_warehouse
                        
                        # ---------------------------------------------------------
                        # STEM LENGTH FALLBACK LOGIC
                        # ---------------------------------------------------------
                        stem_length = None
                        
                        # A — Grading
                        grading = frappe.get_all(
                            "Stock Entry",
                            filters={
                                "stock_entry_type": "Grading",
                                "custom_harvest_batch_no": receiving_doc.custom_harvest_batch_no,
                                "docstatus": 1
                            },
                            fields=["name", "custom_stem_length"],
                            order_by="creation desc",
                            limit=1
                        )
                        
                        if grading and grading[0].custom_stem_length:
                            stem_length = grading[0].custom_stem_length
                        
                        # B — Harvesting
                        if not stem_length:
                            harvesting = frappe.get_all(
                                "Stock Entry",
                                filters={
                                    "stock_entry_type": "Harvesting",
                                    "custom_harvest_batch_no": receiving_doc.custom_harvest_batch_no,
                                    "docstatus": 1
                                },
                                fields=["name", "custom_stem_length"],
                                order_by="creation desc",
                                limit=1
                            )
                            
                            if harvesting and harvesting[0].custom_stem_length:
                                stem_length = harvesting[0].custom_stem_length
                        
                        # C — Receiving fallback
                        if not stem_length:
                            stem_length = receiving_doc.custom_stem_length
                        
                        # ---------------------------------------------------------
                        shelf_doc = result.get("shelf_doc")
                        shelf_doc.farm = farm
                        
                        # Add bucket to shelf
                        new_item = shelf_doc.append("items", {})
                        new_item.bucket_id = bucket_id
                        new_item.variety = variety
                        new_item.date_added = frappe.utils.now_datetime()
                        new_item.stem_length = stem_length
                        new_item.custom_stem_length = stem_length
                        new_item.stem_qty = qty
                        new_item.greenhouse = origin_greenhouse
                        new_item.warehouse = warehouse
                        
                        shelf_doc.save()
                        
                        # Mark bucket as shelved in receiving entry
                        mark_bucket_as_shelved(bucket_id, receiving_doc, result)
                        
                        # ─────────────────────────────────────────────────────
                        # NEW: UPDATE BUCKET ALLOCATION STATUS
                        # ─────────────────────────────────────────────────────
                        update_bas_transit_status(bucket_id, variety, farm, shelf_id, result)
                        
                        # ─────────────────────────────────────────────────────
                        # NEW: CHECK IF OPL CAN BE AUTO-SUBMITTED
                        # ─────────────────────────────────────────────────────
                        check_and_submit_opl(bucket_id, result)
                        
                        # Build response message
                        msg = f"Bucket {bucket_id} shelved successfully with {qty} stems."
                        if result.get("shelved_info"):
                            msg += f" Updated receiving entry: {result['shelved_info']['stock_entry']}."
                        if result.get("transit_updated"):
                            msg += f" Transit status updated on {result['transit_opl']}."
                        if result.get("bas_updated"):
                            msg += f" BAS cleared: {result['bas_available_qty']} stems now available."
                        if result.get("opl_submitted"):
                            msg += f" Auto-submitted OPLs: {', '.join(result['opl_submitted'])}."
                        
                        frappe.response["data"] = {
                            "status": "success",
                            "message": msg,
                            "payload": {
                                "shelf_id": shelf_id,
                                "bucket_id": bucket_id,
                                "stems": qty,
                                "stem_length": stem_length,
                                "transit_updated": result.get("transit_updated", False),
                                "bas_updated": result.get("bas_updated", False),
                                "bas_available_qty": result.get("bas_available_qty", 0),
                                "opl_submitted": result.get("opl_submitted", [])
                            }
                        }
                        
                        frappe.db.commit()

except Exception as e:
    frappe.log_error(f"Unexpected error", e)
    frappe.response["data"] = {
        "status": "error",
        "reason": "unknown_error",
        "message": f"An unexpected error occurred: {str(e)}"
    }

