# ---------------------------------------------------------
# DISCARD BUCKET SERVER SCRIPT
# Discards buckets that are 5 days old or more.
#
# Discard-list path: when called with from_discard_request=1, the bucket is
# verified to be on an APPROVED Discard Request for the farm, then the age and
# allocation checks (which approval overrides) are BYPASSED. not_received and
# already_discarded are kept — the first is structural (the discard Stock Entry
# is built from the receiving entry), the second prevents duplicate discards.
# ---------------------------------------------------------

# ---------------------------------------------------------
# FETCH LATEST RECEIVING OR LATE RECEIPT
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
# CALCULATE BUCKET AGE IN DAYS
# ---------------------------------------------------------
def calculate_bucket_age(receiving_doc):
    """Calculate age of bucket in days from posting date"""
    if not receiving_doc:
        return 0

    posting_datetime = frappe.utils.get_datetime(f"{receiving_doc.posting_date} {receiving_doc.posting_time}")
    current_datetime = frappe.utils.now_datetime()

    age_days = frappe.utils.date_diff(current_datetime, posting_datetime)
    return age_days


# ---------------------------------------------------------
# CHECK IF BUCKET IS ALREADY DISCARDED
# ---------------------------------------------------------
def is_bucket_discarded(bucket_id):
    """Check if bucket already has a discard entry"""
    today = frappe.utils.today()
    discard_entries = frappe.get_all(
        "Stock Entry",
        filters={
            "stock_entry_type": "Discard",
            "custom_received_bucket_id": bucket_id,
            "docstatus": 1,
            "posting_date": today
        },
        fields=["name"],
        limit=1
    )

    return len(discard_entries) > 0


# ---------------------------------------------------------
# CHECK IF BUCKET IS ALLOCATED TO AN OPL CREATED TODAY
# ---------------------------------------------------------
def is_bucket_in_todays_opl(bucket_id):
    """Check if bucket is allocated to an Order Pick List created today"""
    today = frappe.utils.today()
    opl_items = frappe.get_all(
        "Pick List Item",
        filters={
            "custom_bucket": bucket_id,
            "parenttype": "Order Pick List",
            "docstatus": 1
        },
        fields=["parent"],
        limit=1,
        order_by="creation desc"
    )

    if not opl_items:
        return False

    # Check if the parent OPL was created today
    opl = frappe.get_all(
        "Order Pick List",
        filters={
            "name": opl_items[0].parent,
            "date_created": today
        },
        fields=["name"],
        limit=1
    )

    return len(opl) > 0


# ---------------------------------------------------------
# CHECK IF BUCKET IS ON AN APPROVED DISCARD REQUEST
# ---------------------------------------------------------
def is_in_approved_discard_request(bucket_id, farm):
    """True if the bucket is a row on an Approved Discard Request (for the farm,
    when farm is supplied). Gates the validation bypass so only list-authorised
    buckets skip the age/allocation checks."""
    # Farm lives on the CHILD row, not the parent request — filter the bucket
    # rows by farm, then confirm the parent request is Approved.
    child_filters = {"bucket_id": bucket_id, "parenttype": "Discard Request"}
    if farm:
        child_filters["farm"] = farm
    rows = frappe.get_all(
        "Discard Request Bucket",
        filters=child_filters,
        fields=["parent"],
        limit=50
    )
    i = 0
    while i < len(rows):
        dr = frappe.get_all(
            "Discard Request",
            filters={"name": rows[i].parent, "workflow_state": "Approved"},
            fields=["name"],
            limit=1
        )
        if dr:
            return True
        i = i + 1
    return False


# ---------------------------------------------------------
# CHECK IF BUCKET IS ON A FINAL DISCARD REQUEST (farm-agnostic)
# ---------------------------------------------------------
def is_on_final_discard_request(bucket_id):
    """True if the bucket is a row on a FINAL Discard Request — one that has been
    approved and submitted (workflow_state 'Approved' AND docstatus 1). Once a
    request is final the manager has authorised the discard, so the age check
    must NOT block it (a listed bucket is discarded regardless of age). This is
    intentionally farm-agnostic and independent of the from_discard_request flag,
    so the age bypass holds even for an older app build or a re-shelved bucket
    whose row farm no longer matches the station."""
    rows = frappe.get_all(
        "Discard Request Bucket",
        filters={"bucket_id": bucket_id, "parenttype": "Discard Request"},
        fields=["parent"],
        limit=50
    )
    i = 0
    while i < len(rows):
        dr = frappe.get_all(
            "Discard Request",
            filters={"name": rows[i].parent, "workflow_state": "Approved", "docstatus": 1},
            fields=["name"],
            limit=1
        )
        if dr:
            return True
        i = i + 1
    return False


# ---------------------------------------------------------
# CHECK IF BUCKET IS ALLOCATED TO AN ORDER
# ---------------------------------------------------------
def is_bucket_allocated(bucket_id):
    """True if the bucket currently appears in Bucket Allocation Status (allocated
    to a sales order). Hard backstop: a discard request is a fetch-time snapshot,
    so a listed bucket may have been allocated afterwards — never discard it."""
    allocated = frappe.get_all(
        "Bucket Allocation Status",
        filters={"bucket_id": bucket_id},
        fields=["name"],
        limit=1
    )
    return len(allocated) > 0


# ---------------------------------------------------------
# CREATE DISCARD STOCK ENTRY
# ---------------------------------------------------------
def create_discard_entry(receiving_doc, result):
    """Create Discard stock entry for discard"""

    try:
        # Get item details from receiving entry
        recv_item = receiving_doc.items[0]

        # Create new Stock Entry for discard
        discard_entry = frappe.new_doc("Stock Entry")
        discard_entry.stock_entry_type = "Discard"
        discard_entry.purpose = "Discard"
        discard_entry.company = receiving_doc.company
        discard_entry.posting_date = frappe.utils.now_datetime().date()
        discard_entry.posting_time = frappe.utils.now_datetime().time()
        discard_entry.set_posting_time = 1

        # Copy custom fields from receiving entry
        discard_entry.custom_farm = receiving_doc.custom_farm
        discard_entry.custom_location = receiving_doc.custom_location
        discard_entry.custom_business_unit = receiving_doc.custom_business_unit
        discard_entry.custom_greenhouse = receiving_doc.custom_greenhouse
        discard_entry.custom_harvester = receiving_doc.custom_harvester
        discard_entry.custom_harvester_payroll_number = receiving_doc.custom_harvester_payroll_number
        discard_entry.custom_harvest_batch_no = receiving_doc.custom_harvest_batch_no
        discard_entry.custom_received_bucket_id = receiving_doc.custom_received_bucket_id
        discard_entry.custom_stem_length = receiving_doc.custom_stem_length
        discard_entry.custom_graded_by = receiving_doc.custom_graded_by
        discard_entry.custom_grader_payroll_number = receiving_doc.custom_grader_payroll_number

        # Set warehouses
        discard_entry.from_warehouse = recv_item.t_warehouse  # Taking from receiving warehouse

        # Add item to discard entry
        discard_item = discard_entry.append("items", {})
        discard_item.item_code = recv_item.item_code
        discard_item.item_name = recv_item.item_name
        discard_item.description = recv_item.description
        discard_item.item_group = recv_item.item_group
        discard_item.qty = recv_item.qty
        discard_item.uom = recv_item.uom
        discard_item.stock_uom = recv_item.stock_uom
        discard_item.conversion_factor = recv_item.conversion_factor
        discard_item.s_warehouse = recv_item.t_warehouse  # From receiving warehouse
        discard_item.expense_account = recv_item.expense_account
        discard_item.cost_center = recv_item.cost_center
        discard_item.allow_zero_valuation_rate = 1

        # Copy custom fields from receiving item
        discard_item.custom_grower = recv_item.custom_grower
        discard_item.custom_harvester = recv_item.custom_harvester
        discard_item.custom_bunched_by = recv_item.custom_bunched_by
        discard_item.custom_number_of_stems = recv_item.custom_number_of_stems

        # Insert and submit
        discard_entry.insert(ignore_permissions=True)
        discard_entry.submit()

        result["discard_entry"] = discard_entry.name

    except Exception as e:
        frappe.log_error(f"Error creating discard entry: {str(e)}", "Discard Entry Creation Error")
        raise


# ---------------------------------------------------------
# REMOVE BUCKET FROM SHELF
# ---------------------------------------------------------
def remove_bucket_from_shelf(bucket_id, result):
    """Remove bucket from all shelves"""
    result["removed_from_shelf"] = []

    try:
        # Find all shelf items with this bucket
        shelf_items = frappe.db.get_all(
            'Shelf Item',
            filters={'bucket_id': bucket_id},
            fields=['name', 'parent']
        )

        removed_shelves = []

        for item in shelf_items:
            frappe.delete_doc('Shelf Item', item.name, force=1)
            removed_shelves.append(item.parent)

            # Touch parent Shelf (keeps UI + modified in sync)
            frappe.db.set_value(
                'Shelf',
                item.parent,
                'modified',
                frappe.utils.now()
            )

        result["removed_from_shelf"] = list(set(removed_shelves))

    except Exception as e:
        frappe.log_error(f"Error removing bucket from shelf: {str(e)}", "Remove From Shelf Error")
        # Don't raise - shelf removal is not critical for discard


# ---------------------------------------------------------
# MARK BUCKET DISCARDED ON EVERY DISCARD REQUEST
# ---------------------------------------------------------
def mark_discarded_on_requests(bucket_id):
    """Set discarded=1 on ALL Discard Request Bucket rows for this bucket, across
    every request (a bucket is often listed on several requests — nightly re-lists
    plus manual ones). Keeps the requests' checkbox in sync so a discarded bucket
    never shows as pending. Filter is case-insensitive at the DB layer."""
    try:
        rows = frappe.get_all(
            "Discard Request Bucket",
            filters={"bucket_id": bucket_id, "parenttype": "Discard Request"},
            fields=["name"]
        )
        for row in rows:
            frappe.db.set_value(
                "Discard Request Bucket", row["name"], "discarded", 1,
                update_modified=False
            )
    except Exception as e:
        frappe.log_error(f"Error marking discarded on requests: {str(e)}", "Discard Flag Error")
        # Don't raise - flagging is not critical to the discard itself


# ---------------------------------------------------------
# MAIN EXECUTION BLOCK
# ---------------------------------------------------------
try:
    data = frappe.request.get_json()
    bucket_id = data.get("bucket_id")
    override_age = False  # Allow discarding young buckets if True
    # Discard-list context: bypass the age + allocation checks once the bucket is
    # verified to be on an Approved Discard Request for the farm.
    from_discard_request = data.get("from_discard_request")
    farm = data.get("farm")

    if not bucket_id:
        frappe.response["data"] = {
            "status": "failed",
            "reason": "bucket_id_missing",
            "message": "Bucket ID is required.",
            "payload": {}
        }
    else:
        result = {}
        bypass = False
        done = False

        # When the discard comes via the discard list, authorise the bypass by
        # verifying the bucket is actually on an Approved Discard Request — and
        # hard-block it if it has since been allocated (the list is a fetch-time
        # snapshot, so a bucket can be allocated after the request was built).
        if from_discard_request:
            if is_bucket_allocated(bucket_id):
                frappe.response["data"] = {
                    "status": "failed",
                    "reason": "bucket_allocated",
                    "message": "This bucket has been allocated to an order and can no longer be discarded.",
                    "payload": {"bucket_id": bucket_id}
                }
                done = True
            elif is_in_approved_discard_request(bucket_id, farm):
                bypass = True
            else:
                frappe.response["data"] = {
                    "status": "failed",
                    "reason": "not_in_discard_list",
                    "message": "This bucket is not on an approved discard list.",
                    "payload": {"bucket_id": bucket_id}
                }
                done = True

        if not done:
            # Fetch receiving entry
            fetch_latest_receiving(bucket_id, result)
            receiving_doc = result.get("receiving_doc")

            if not receiving_doc:
                frappe.response["data"] = {
                    "status": "failed",
                    "reason": "not_received",
                    "message": "This bucket has no Receiving or Late Receipt entry.",
                    "payload": {"bucket_id": bucket_id}
                }
            else:
                # Already-discarded guard is kept even on the bypass path to avoid
                # creating a duplicate Discard stock entry.
                if is_bucket_discarded(bucket_id):
                    frappe.response["data"] = {
                        "status": "failed",
                        "reason": "already_discarded",
                        "message": "This bucket has already been discarded.",
                        "payload": {"bucket_id": bucket_id}
                    }
                # Allocation check — bypassed for approved discard-list buckets.
                elif (not bypass) and is_bucket_in_todays_opl(bucket_id):
                    frappe.response["data"] = {
                        "status": "failed",
                        "reason": "bucket_allocated",
                        "message": "Cannot discard,this bucket has been allocated to an order.",
                        "payload": {"bucket_id": bucket_id}
                    }
                else:
                    # Calculate bucket age
                    age_days = calculate_bucket_age(receiving_doc)

                    # Get variety from receiving entry
                    variety = receiving_doc.items[0].item_code
                    qty = receiving_doc.items[0].qty

                    # Age check — bypassed for discard-list buckets AND for any
                    # bucket already on a FINAL (approved + submitted) discard
                    # request, since the manager has authorised that discard.
                    on_final_dr = is_on_final_discard_request(bucket_id)
                    if age_days < 5 and not override_age and not bypass and not on_final_dr:
                        frappe.response["data"] = {
                            "status": "failed",
                            "reason": "bucket_too_young",
                            "message": f"Bucket is only {age_days} days old. Discards are only allowed for buckets 5 days or older.",
                            "payload": {
                                "bucket_id": bucket_id,
                                "age_days": age_days,
                                "variety": variety,
                                "stems": qty
                            }
                        }
                    else:
                        # Create discard entry
                        create_discard_entry(receiving_doc, result)

                        # Remove bucket from shelf
                        remove_bucket_from_shelf(bucket_id, result)

                        # Flag the bucket discarded on every Discard Request that lists it
                        mark_discarded_on_requests(bucket_id)

                        success_message = f"Bucket {bucket_id} discarded successfully. Age: {age_days} days, Variety: {variety}, Stems: {qty}."
                        if (bypass or on_final_dr) and age_days < 5:
                            success_message += " (Discard-request age override applied)"

                        if result.get("removed_from_shelf"):
                            success_message += f" Removed from shelf(s): {', '.join(result['removed_from_shelf'])}."

                        frappe.response["data"] = {
                            "status": "success",
                            "message": success_message,
                            "payload": {
                                "bucket_id": bucket_id,
                                "age_days": age_days,
                                "variety": variety,
                                "stems": qty,
                                "discard_entry": result.get("discard_entry"),
                                "override_age": override_age,
                                "from_discard_request": bool(from_discard_request),
                                "removed_from_shelves": result.get("removed_from_shelf", [])
                            }
                        }

    frappe.db.commit()

except Exception as e:
    frappe.log_error(f"Unexpected error in discard script", e)
    frappe.response["data"] = {
        "status": "error",
        "reason": "unknown_error",
        "message": f"An unexpected error occurred: {str(e)}"
    }
