# ---------------------------------------------------------
# DISCARD BUCKET SERVER SCRIPT
# ---------------------------------------------------------

def set_if_exists(doc, fieldname, value):
    """Set field only if it exists on the doctype meta. Skips silently otherwise."""
    if value is not None and doc.meta.has_field(fieldname):
        doc.set(fieldname, value)


def fetch_latest_receiving(bucket_id, result):
    result["receiving_doc"] = None
    entries = frappe.get_all(
        "Stock Entry",
        filters={
            "stock_entry_type": ["in", ["Receiving", "Late Receipt"]],
            "custom_bucket_id": bucket_id,
            "docstatus": 1
        },
        fields=["name"],
        order_by="creation desc",
        limit=1
    )
    if entries:
        result["receiving_doc"] = frappe.get_doc("Stock Entry", entries[0].name)


def calculate_bucket_age(receiving_doc):
    if not receiving_doc:
        return 0
    posting_datetime = frappe.utils.get_datetime(f"{receiving_doc.posting_date} {receiving_doc.posting_time}")
    current_datetime = frappe.utils.now_datetime()
    return frappe.utils.date_diff(current_datetime, posting_datetime)


def is_bucket_discarded(bucket_id, receiving_doc):
    """Bucket IDs are reused, so only count discards made after its latest receiving."""
    discard_entries = frappe.get_all(
        "Stock Entry",
        filters={
            "stock_entry_type": "Discard",
            "custom_bucket_id": bucket_id,
            "docstatus": 1,
            "creation": [">", receiving_doc.creation]
        },
        fields=["name"],
        limit=1
    )
    return len(discard_entries) > 0


def is_bucket_in_todays_opl(bucket_id):
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
    opl = frappe.get_all(
        "Order Pick List",
        filters={"name": opl_items[0].parent, "date_created": today},
        fields=["name"],
        limit=1
    )
    return len(opl) > 0


def is_in_approved_discard_request(bucket_id, farm):
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


def is_on_final_discard_request(bucket_id):
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


def is_bucket_allocated(bucket_id):
    allocated = frappe.get_all(
        "Bucket Allocation Status",
        filters={"bucket_id": bucket_id},
        fields=["name"],
        limit=1
    )
    return len(allocated) > 0


def create_discard_entry(receiving_doc, result):
    recv_item = receiving_doc.items[0]

    discard_entry = frappe.new_doc("Stock Entry")
    discard_entry.stock_entry_type = "Discard"
    discard_entry.purpose = "Discard"
    discard_entry.company = receiving_doc.company
    discard_entry.posting_date = frappe.utils.now_datetime().date()
    discard_entry.posting_time = frappe.utils.now_datetime().time()
    discard_entry.set_posting_time = 1

    # --- Parent-level fields that exist on Stock Entry ---
    set_if_exists(discard_entry, "farm",                receiving_doc.get("farm"))
    set_if_exists(discard_entry, "business_unit",       receiving_doc.get("business_unit"))
    set_if_exists(discard_entry, "custom_greenhouse",   receiving_doc.get("custom_greenhouse"))
    set_if_exists(discard_entry, "custom_harvester",    receiving_doc.get("custom_harvester"))
    set_if_exists(discard_entry, "custom_bucket_id",    receiving_doc.get("custom_bucket_id"))
    set_if_exists(discard_entry, "custom_stem_length",  receiving_doc.get("custom_stem_length"))
    set_if_exists(discard_entry, "custom_graded_by",    receiving_doc.get("custom_graded_by"))
    set_if_exists(discard_entry, "custom_harvest_date", receiving_doc.get("custom_harvest_date"))

    discard_entry.from_warehouse = recv_item.t_warehouse
    discard_entry.to_warehouse = "Rejects - KR"

    discard_item = discard_entry.append("items", {})
    discard_item.item_code = recv_item.item_code
    discard_item.item_name = recv_item.item_name
    discard_item.description = recv_item.description
    discard_item.item_group = recv_item.item_group
    discard_item.qty = recv_item.qty
    discard_item.uom = recv_item.uom
    discard_item.stock_uom = recv_item.stock_uom
    discard_item.conversion_factor = recv_item.conversion_factor
    discard_item.s_warehouse = recv_item.t_warehouse
    discard_item.expense_account = recv_item.expense_account
    discard_item.cost_center = recv_item.cost_center
    discard_item.allow_zero_valuation_rate = 1

    # --- Item-level fields (guarded: skipped if not on Stock Entry Detail) ---
    set_if_exists(discard_item, "custom_grower",          recv_item.get("custom_grower"))
    set_if_exists(discard_item, "custom_harvester",       recv_item.get("custom_harvester"))
    set_if_exists(discard_item, "custom_bunched_by",      recv_item.get("custom_bunched_by"))
    set_if_exists(discard_item, "custom_number_of_stems", recv_item.get("custom_number_of_stems"))

    discard_entry.insert(ignore_permissions=True)
    discard_entry.submit()

    result["discard_entry"] = discard_entry.name


def remove_bucket_from_shelf(bucket_id, result):
    result["removed_from_shelf"] = []
    shelf_items = frappe.db.get_all(
        'Shelf Item',
        filters={'bucket_id': bucket_id},
        fields=['name', 'parent']
    )
    removed_shelves = []
    for item in shelf_items:
        frappe.delete_doc('Shelf Item', item.name, force=1)
        removed_shelves.append(item.parent)
        frappe.db.set_value('Shelf', item.parent, 'modified', frappe.utils.now())
    result["removed_from_shelf"] = list(set(removed_shelves))


def mark_discarded_on_requests(bucket_id):
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


# ---------------------------------------------------------
# MAIN
# ---------------------------------------------------------
response_payload = None

try:
    data = frappe.form_dict
    bucket_id = data.get("bucket_id")
    override_age = False
    from_discard_request = data.get("from_discard_request")
    farm = data.get("farm")

    if not bucket_id:
        response_payload = {
            "status": "failed",
            "reason": "bucket_id_missing",
            "message": "Bucket ID is required.",
            "payload": {}
        }
    else:
        result = {}
        bypass = False
        done = False

        if from_discard_request:
            if is_bucket_allocated(bucket_id):
                response_payload = {
                    "status": "failed",
                    "reason": "bucket_allocated",
                    "message": "This bucket has been allocated to an order and can no longer be discarded.",
                    "payload": {"bucket_id": bucket_id}
                }
                done = True
            elif is_in_approved_discard_request(bucket_id, farm):
                bypass = True
            else:
                response_payload = {
                    "status": "failed",
                    "reason": "not_in_discard_list",
                    "message": "This bucket is not on an approved discard list.",
                    "payload": {"bucket_id": bucket_id}
                }
                done = True

        if not done:
            fetch_latest_receiving(bucket_id, result)
            receiving_doc = result.get("receiving_doc")

            if not receiving_doc:
                response_payload = {
                    "status": "failed",
                    "reason": "not_received",
                    "message": "This bucket has no Receiving or Late Receipt entry.",
                    "payload": {"bucket_id": bucket_id}
                }
            else:
                if is_bucket_discarded(bucket_id, receiving_doc):
                    response_payload = {
                        "status": "failed",
                        "reason": "already_discarded",
                        "message": "This bucket has already been discarded.",
                        "payload": {"bucket_id": bucket_id}
                    }
                elif (not bypass) and is_bucket_in_todays_opl(bucket_id):
                    response_payload = {
                        "status": "failed",
                        "reason": "bucket_allocated",
                        "message": "Cannot discard,this bucket has been allocated to an order.",
                        "payload": {"bucket_id": bucket_id}
                    }
                else:
                    age_days = calculate_bucket_age(receiving_doc)
                    variety = receiving_doc.items[0].item_code
                    qty = receiving_doc.items[0].qty

                    on_final_dr = is_on_final_discard_request(bucket_id)
                    if age_days < 5 and not override_age and not bypass and not on_final_dr:
                        response_payload = {
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
                        create_discard_entry(receiving_doc, result)
                        remove_bucket_from_shelf(bucket_id, result)
                        mark_discarded_on_requests(bucket_id)

                        success_message = f"Bucket {bucket_id} discarded successfully. Age: {age_days} days, Variety: {variety}, Stems: {qty}."
                        if (bypass or on_final_dr) and age_days < 5:
                            success_message += " (Discard-request age override applied)"
                        if result.get("removed_from_shelf"):
                            success_message += f" Removed from shelf(s): {', '.join(result['removed_from_shelf'])}."

                        response_payload = {
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
    # Undo any partial work (e.g. a submitted discard whose shelf cleanup failed)
    frappe.db.rollback()
    frappe.log_error("Discard Script Error", f"Unexpected error in discard script: {str(e)}")
    response_payload = {
        "status": "error",
        "reason": "unknown_error",
        "message": f"An unexpected error occurred: {str(e)}"
    }

frappe.response["data"] = response_payload