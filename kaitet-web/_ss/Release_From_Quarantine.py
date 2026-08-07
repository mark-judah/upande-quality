data = frappe.request.get_json()

bucket_id = data.get("bucket_id", "")
action = data.get("action", "")
stems_to_release = data.get("stems_to_release")
batch_no = data.get("batch_no", "")

if not bucket_id:
    frappe.throw("bucket_id is required")

if not batch_no:
    frappe.throw("batch_no is required")

if action not in ("accept", "reject"):
    frappe.throw("action must be 'accept' or 'reject'")

ACCEPTED_STORAGE = "Kapkolia Receiving Storage - KR"

bucket_id_lower = bucket_id.strip().lower()
bucket_id_upper = bucket_id.strip().upper()

CONTINUITY_FIELDS = [
    "custom_farm", "custom_location", "custom_business_unit",
    "custom_employee", "custom_employee_name", "custom_greenhouse",
    "custom_harvester", "custom_stem_length", "custom_graded_by",
    "custom_grader_payroll_number", "custom_biometric_verified"
]


def build_movement(stock_entry_type, purpose, s_warehouse, t_warehouse, qty, entry):
    item = {
        "item_code": entry.item_code or "",
        "item_name": entry.item_name or "",
        "qty": qty,
        "transfer_qty": qty,
        "uom": "Stems",
        "stock_uom": "Stems",
        "conversion_factor": 1.0,
        "s_warehouse": s_warehouse,
        "cost_center": entry.cost_center or "",
        "basic_rate": entry.basic_rate or 0,
        "basic_amount": qty * (entry.basic_rate or 0),
        "allow_zero_valuation_rate": 1,
    }
    if t_warehouse:
        item["t_warehouse"] = t_warehouse

    se_data = {
        "doctype": "Stock Entry",
        "stock_entry_type": stock_entry_type,
        "purpose": purpose,
        "custom_received_bucket_id": bucket_id_lower,
        "custom_harvest_batch_no": entry.custom_harvest_batch_no or "",
        "custom_receiving_batch_id": batch_no,
        "company": entry.company or "",
        "posting_date": frappe.utils.nowdate(),
        "posting_time": frappe.utils.nowtime(),
        "set_posting_time": 1,
        "items": [item],
    }
    for field in CONTINUITY_FIELDS:
        if entry.get(field):
            se_data[field] = entry.get(field)

    se_doc = frappe.get_doc(se_data)
    se_doc.insert(ignore_permissions=True)
    se_doc.submit()
    return se_doc


# Step 1: all submitted stock entries for this bucket + batch (one indexed query).
all_entries = frappe.db.sql("""
    SELECT se.name, se.stock_entry_type,
           sei.qty, sei.item_code, sei.item_name,
           sei.s_warehouse, sei.t_warehouse,
           sei.cost_center, sei.basic_rate,
           se.company, se.custom_harvest_batch_no, se.custom_receiving_batch_id,
           se.custom_farm, se.custom_location, se.custom_business_unit,
           se.custom_employee, se.custom_employee_name, se.custom_greenhouse,
           se.custom_harvester, se.custom_stem_length, se.custom_graded_by,
           se.custom_grader_payroll_number, se.custom_biometric_verified,
           se.creation
    FROM `tabStock Entry` se
    JOIN `tabStock Entry Detail` sei ON sei.parent = se.name
    WHERE se.custom_received_bucket_id = %s
        AND se.custom_receiving_batch_id = %s
        AND se.docstatus = 1
    ORDER BY se.creation DESC
""", (bucket_id_lower, batch_no), as_dict=1)

# Step 2: find the entry that put stock into a quarantine warehouse for this batch.
quarantine_entry = None

# Strategy A: any entry whose t_warehouse is a quarantine warehouse.
for e in all_entries:
    t_wh = (e.t_warehouse or "").lower()
    if "quarantine" in t_wh and e.custom_receiving_batch_id == batch_no:
        quarantine_entry = e
        break

# Strategy B: specific quarantine stock entry types.
if not quarantine_entry:
    for e in all_entries:
        if e.stock_entry_type in ("Receiving Quarantined", "Quarantine Transfer") and e.custom_receiving_batch_id == batch_no:
            quarantine_entry = e
            break

if not quarantine_entry:
    frappe.throw("No quarantined entry found for bucket %s in batch %s" % (bucket_id_upper, batch_no))

entry = quarantine_entry
quarantine_wh = entry.t_warehouse or ""
original_wh = entry.s_warehouse or ""
available_stems = int(entry.qty or 0)

# Step 3: guard against double-release — look for a later movement out of quarantine.
quarantine_time = entry.creation
for e in all_entries:
    if e.name == entry.name:
        continue
    if e.custom_receiving_batch_id != batch_no:
        continue
    if e.creation <= quarantine_time:
        continue
    s_wh = (e.s_warehouse or "").lower()
    if e.stock_entry_type == "Material Transfer" and "quarantine" in s_wh:
        frappe.throw("Bucket %s (Batch: %s) has already been released from quarantine" % (bucket_id_upper, batch_no))
    if e.stock_entry_type in ("Quarantine Rejects", "Remove From Quarantine"):
        frappe.throw("Bucket %s (Batch: %s) has already been released from quarantine" % (bucket_id_upper, batch_no))

# Step 4: how many stems to release.
stems_count = available_stems
if stems_to_release:
    stems_count = int(stems_to_release)

if stems_count > available_stems:
    frappe.throw("Only %s stems available in quarantine for bucket %s (Batch: %s)" % (available_stems, bucket_id_upper, batch_no))

# Step 5: perform the movement.
if action == "accept":
    target_warehouse = original_wh if original_wh else ACCEPTED_STORAGE
    se_doc = build_movement("Material Transfer", "Material Transfer", quarantine_wh, target_warehouse, stems_count, entry)
    frappe.db.commit()

    frappe.response["status"] = "success"
    frappe.response["message"] = "%s stems from bucket %s (Batch: %s) accepted and moved to %s" % (stems_count, bucket_id_upper, batch_no, target_warehouse)
    frappe.response["stock_entry"] = se_doc.name
    frappe.response["stems_released"] = stems_count
    frappe.response["remaining_in_quarantine"] = available_stems - stems_count
    frappe.response["target_warehouse"] = target_warehouse

else:  # reject
    # 1) Remove the rejected stems from inventory (Quarantine Rejects issue).
    se_doc = build_movement("Quarantine Rejects", "Material Issue", quarantine_wh, None, stems_count, entry)

    # 2) A partial reject means the rest of the bucket is good -- move those
    #    remaining stems back OUT of quarantine to the coldroom (the warehouse
    #    they were quarantined from), so they aren't left stranded. This makes
    #    "reject N of M" a complete disposition: N rejected + (M-N) returned.
    coldroom_wh = original_wh if original_wh else ACCEPTED_STORAGE
    remaining = available_stems - stems_count
    transfer_doc = None
    if remaining > 0:
        transfer_doc = build_movement("Material Transfer", "Material Transfer", quarantine_wh, coldroom_wh, remaining, entry)

    frappe.db.commit()

    frappe.response["status"] = "success"
    if transfer_doc:
        frappe.response["message"] = "%s stems from bucket %s (Batch: %s) rejected; %s good stems returned to %s" % (stems_count, bucket_id_upper, batch_no, remaining, coldroom_wh)
    else:
        frappe.response["message"] = "%s stems from bucket %s (Batch: %s) rejected (removed from inventory)" % (stems_count, bucket_id_upper, batch_no)
    frappe.response["stock_entry"] = se_doc.name
    frappe.response["transfer_stock_entry"] = transfer_doc.name if transfer_doc else None
    frappe.response["stems_released"] = stems_count
    frappe.response["stems_returned_to_coldroom"] = remaining
    frappe.response["remaining_in_quarantine"] = 0
