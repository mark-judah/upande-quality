# Server Script: submit_batch_quality   (API method: submitBatchQuality)
#
# Creates a Quality Reporting doc per (variety, action) for a scanned batch and,
# for Quarantined / Rejected varieties, a Corrective Action Report.
#
# Design notes / why this version exists:
#  - Bucket data (item_code, warehouse, greenhouse, farm, rate, cost center) is
#    read from the PAYLOAD first. The frontend already has it from
#    getBatchByBucket, so reporting no longer depends on a submitted "Receiving"
#    Stock Entry existing. A Receiving entry is now only used (when present) to
#    fill gaps and to source the warehouse for the quarantine/reject stock move.
#  - quality_concerns is VARIETY-KEYED: { item_code: { param_key: { count } } }.
#  - quality_parameters.parameter_name is a Link to "QC Parameters", so each
#    incoming param_key is resolved back to a real QC Parameters name. Unknown
#    keys are dropped instead of crashing the insert.
#  - Every Stock Entry, Quality Reporting and CAR insert is wrapped in its own
#    try/except. A failure in one (e.g. a bad CAR field) is logged and skipped
#    so it can NEVER roll back the others. The single commit at the end then
#    persists everything that succeeded. This is the root-cause fix for "after
#    a change the Quality Report AND the CAR both stopped being generated":
#    previously any exception before the final commit rolled back the whole
#    transaction, including reports that had already been inserted.

data = frappe.request.get_json()
data = data.get("data", data)
frappe.log_error(json.dumps(data, indent=2), "Submit Batch Quality Payload")

batch_no          = data.get("batch_no", "")
control_point     = data.get("control_point", "Intake")
batch_decision    = data.get("batch_decision", "ACCEPT")
quarantine_scope  = data.get("quarantine_scope", "buckets")
checked_stems     = data.get("checked_stems_sampled", 0)
solution_level    = data.get("solution_level_liters", 0)
solution_hygiene  = data.get("solution_hygiene", "")
chlorine_ppm      = data.get("chlorine_ppm", 0)
solution_ph       = data.get("solution_ph", "")
farm              = data.get("farm", "")
company           = data.get("company", "")
buckets_data      = data.get("buckets", [])
concerns_by_variety = data.get("quality_concerns", {}) or {}
stems_by_variety    = data.get("stems_checked_by_variety", {}) or {}

if not batch_no:
    frappe.throw("Missing batch number")


def normalize_action(action):
    action = (action or "").strip().upper()
    if action in ["ACCEPT", "ACCEPTED"]:
        return "Accepted"
    elif action in ["QUARANTINE", "QUARANTINED"]:
        return "Quarantined"
    elif action in ["REJECT", "REJECTED"]:
        return "Rejected"
    return ""


# Normalise a parameter label the same way the frontend does:
#   trim -> drop punctuation (keep word chars + spaces) -> spaces to "_" -> lower
def norm_param(s):
    s = (s or "").strip().lower()
    out = []
    prev_us = False
    for ch in s:
        if ch.isalnum() or ch == "_":
            out.append(ch)
            prev_us = (ch == "_")
        elif ch.isspace():
            if not prev_us:
                out.append("_")
                prev_us = True
        # any other punctuation is dropped
    return "".join(out)


# Map normalised param key -> canonical QC Parameters name (the Link target)
qc_param_map = {}
for p in frappe.get_all("QC Parameters", fields=["name", "parameter"]):
    if p.get("parameter"):
        qc_param_map[norm_param(p.get("parameter"))] = p.get("name")
    qc_param_map[norm_param(p.get("name"))] = p.get("name")

# CAR.control_point is a Select with a DIFFERENT option set than the QC form,
# so map the incoming control point to a valid CAR option (default Intake).
CAR_CP_MAP = {
    "intake": "Intake",
    "coldroom": "Cold Room",
    "cold room": "Cold Room",
    "grading": "Grading",
    "packhouse": "Packing",
    "packing": "Packing",
    "dispatch": "Dispatch",
    "field": "Intake",
}
car_control_point = CAR_CP_MAP.get((control_point or "").strip().lower(), "Intake")

# Quality Reporting Select guards (an out-of-range value would fail validation).
VALID_PH = {"3.0", "3.5", "4.0", "4.5", "5.0", "5.5", "6.0", "6.5"}
solution_ph_val = str(solution_ph) if str(solution_ph) in VALID_PH else ""
solution_hygiene_val = solution_hygiene if solution_hygiene in ("Clean", "Not Clean") else ""

WAREHOUSE_CONFIG = {
    "rejected": "Rejects - KR",
    "quarantined": "Kapkolia Receiving Quarantined - KR",
}
STOCK_ENTRY_TYPES = {
    "quarantined": "Receiving Quarantined",
    "rejected": "Quarantine Rejects",
}

created_reports = []
stock_entries = []
corrective_action_reports = []
skipped_buckets = []
stock_move_errors = []
total_accepted_stems = 0
total_quarantined_stems = 0
total_rejected_stems = 0


def extract_time_string(pt_val):
    if not pt_val:
        return ""
    try:
        raw = str(pt_val)
        if "," in raw:
            raw = raw.split(",")[1].strip()
        if "." in raw:
            raw = raw.split(".")[0]
        parts = raw.strip().split(":")
        if len(parts) == 3:
            return str(parts[0]).zfill(2) + ":" + str(parts[1]).zfill(2) + ":" + str(parts[2]).zfill(2)
        if len(parts) == 2:
            return str(parts[0]).zfill(2) + ":" + str(parts[1]).zfill(2) + ":00"
        return ""
    except Exception:
        return ""


def get_first_time(greenhouse, entry_type):
    if not greenhouse:
        return ""
    today = frappe.utils.nowdate()
    entry = frappe.db.sql("""
        SELECT posting_time
        FROM `tabStock Entry`
        WHERE custom_greenhouse = %s
            AND stock_entry_type = %s
            AND posting_date = %s
            AND docstatus = 1
        ORDER BY posting_time ASC
        LIMIT 1
    """, (greenhouse, entry_type, today), as_dict=1)
    if entry:
        return extract_time_string(entry[0].posting_time)
    return ""


def compute_transit_time(harvest_time_str, arrival_time_str):
    if not harvest_time_str or not arrival_time_str:
        return ""
    try:
        today = frappe.utils.nowdate()
        harvest_dt = frappe.utils.get_datetime(str(today) + " " + harvest_time_str)
        arrival_dt = frappe.utils.get_datetime(str(today) + " " + arrival_time_str)
        if arrival_dt > harvest_dt:
            diff = arrival_dt - harvest_dt
            total_secs = int(diff.total_seconds())
            t_hours = total_secs // 3600
            t_minutes = (total_secs % 3600) // 60
            return str(t_hours) + "h " + str(t_minutes).zfill(2) + "m"
    except Exception:
        pass
    return ""


# Look up unit_manager: Farm -> Employee ID -> User ID
unit_manager = ""
if farm:
    emp_id = frappe.db.get_value("Farm", farm, "custom_unit_manager") or ""
    if emp_id:
        unit_manager = frappe.db.get_value("Employee", emp_id, "user_id") or ""


def should_create_car(greenhouse, variety):
    if not variety or not greenhouse:
        return True
    existing_cars = frappe.db.sql("""
        SELECT name, status, target_date, actual_completion_date
        FROM `tabCorrective Action Report`
        WHERE variety = %s
            AND custom_greenhouse = %s
            AND status IN ('Pending', 'WIP')
        ORDER BY creation DESC
        LIMIT 1
    """, (variety, greenhouse), as_dict=1)
    if not existing_cars:
        return True
    car = existing_cars[0]
    today = frappe.utils.getdate(frappe.utils.nowdate())
    target = frappe.utils.getdate(car.target_date) if car.target_date else None
    if target and target >= today:
        return False
    if target and target < today and not car.actual_completion_date:
        return True
    if not target:
        return False
    return True


def build_child_entries(item_code, action):
    """Per-variety quality_parameters rows, resolving each param key to a valid
    QC Parameters Link. Unknown keys are skipped so the insert never crashes."""
    entries = []
    concerns = concerns_by_variety.get(item_code, {}) or {}
    if not isinstance(concerns, dict):
        return entries
    for param_key, details in concerns.items():
        if not isinstance(details, dict):
            continue
        count = int(details.get("count") or 0)
        if count <= 0:
            continue
        real_name = qc_param_map.get(norm_param(param_key))
        if not real_name:
            continue
        entries.append({
            "parameter_name": real_name,
            "count": count,
            "action": action if action in ("Quarantined", "Accepted", "Rejected", "Monitor") else "Monitor",
            "photo": details.get("photo", "") or "",
        })
    return entries


# ═══════════════════════════════════════════════════════════════════════════
# PHASE 1: process each bucket - accumulate per variety + optional stock move
# ═══════════════════════════════════════════════════════════════════════════
variety_groups = {}
variety_stems_received = {}
variety_greenhouse = {}
variety_farm = {}

for bucket in buckets_data:
    bucket_id = (bucket.get("bucket_id") or "").upper()
    bucket_stems = int(bucket.get("stems") or 0)
    bucket_selected = bucket.get("selected", False)

    if quarantine_scope == "buckets" and not bucket_selected:
        effective_action = "Accepted"
    elif quarantine_scope == "batch":
        effective_action = normalize_action(batch_decision)
    else:
        effective_action = normalize_action(bucket.get("action", batch_decision))

    # ── Bucket details from the payload (preferred) ──
    item_code = bucket.get("item_code") or ""
    item_name = bucket.get("item_name") or ""
    source_warehouse = bucket.get("warehouse") or ""
    basic_rate = bucket.get("basic_rate") or 0
    cost_center = bucket.get("cost_center") or ""
    greenhouse = bucket.get("greenhouse") or ""
    bucket_farm = bucket.get("farm") or farm

    # ── Optional Receiving Stock Entry: fill gaps + source for stock movement ──
    receiving_doc = None
    try:
        se_name = bucket.get("stock_entry") or ""
        if se_name and frappe.db.exists("Stock Entry", se_name):
            receiving_doc = frappe.get_doc("Stock Entry", se_name)
        else:
            receiving = frappe.db.sql("""
                SELECT name FROM `tabStock Entry`
                WHERE LOWER(custom_received_bucket_id) = %s
                    AND stock_entry_type = 'Receiving'
                    AND docstatus = 1
                ORDER BY creation DESC LIMIT 1
            """, (bucket_id.lower(),), as_dict=1)
            if receiving:
                receiving_doc = frappe.get_doc("Stock Entry", receiving[0].name)
    except Exception:
        receiving_doc = None

    if receiving_doc and receiving_doc.items:
        first_item = receiving_doc.items[0]
        if not item_code:
            item_code = first_item.item_code
        if not item_name:
            item_name = first_item.item_name
        if not source_warehouse:
            source_warehouse = first_item.t_warehouse
        if not basic_rate:
            basic_rate = first_item.basic_rate or 0
        if not cost_center:
            cost_center = first_item.cost_center or ""
        if not greenhouse:
            greenhouse = receiving_doc.custom_greenhouse or ""
        if not bucket_farm:
            bucket_farm = receiving_doc.custom_farm or farm

    # Without a variety there is nothing to report on.
    if not item_code:
        skipped_buckets.append(bucket_id)
        continue

    variety_stems_received[item_code] = variety_stems_received.get(item_code, 0) + bucket_stems
    if item_code not in variety_greenhouse and greenhouse:
        variety_greenhouse[item_code] = greenhouse
    if item_code not in variety_farm and bucket_farm:
        variety_farm[item_code] = bucket_farm

    effective_rejected = int(bucket.get("rejected_stems", 0) or 0)

    group_key = item_code + "|" + effective_action
    if group_key not in variety_groups:
        variety_groups[group_key] = {
            "item_code": item_code,
            "farm": bucket_farm,
            "greenhouse": greenhouse,
            "effective_action": effective_action,
            "total_quarantined_stems": 0,
            "total_accepted_stems": 0,
            "total_rejected_stems": 0,
            "bucket_count": 0,
        }
    group = variety_groups[group_key]
    group["bucket_count"] += 1
    if not group["greenhouse"] and greenhouse:
        group["greenhouse"] = greenhouse

    if effective_action == "Accepted":
        group["total_accepted_stems"] += (bucket_stems - effective_rejected)
        group["total_rejected_stems"] += effective_rejected
    elif effective_action == "Quarantined":
        group["total_quarantined_stems"] += bucket_stems
        group["total_rejected_stems"] += effective_rejected
    elif effective_action == "Rejected":
        group["total_rejected_stems"] += bucket_stems

    # ── Stock movement (quarantine / reject only). Best-effort: never blocks. ──
    if effective_action in ("Quarantined", "Rejected") and receiving_doc and source_warehouse:
        target_key = "quarantined" if effective_action == "Quarantined" else "rejected"
        target_warehouse = WAREHOUSE_CONFIG[target_key]
        entry_type = STOCK_ENTRY_TYPES[target_key]
        qty_to_move = bucket_stems if effective_action == "Rejected" else (bucket_stems - effective_rejected)
        if qty_to_move > 0:
            try:
                se_data = {
                    "doctype": "Stock Entry",
                    "stock_entry_type": entry_type,
                    "purpose": "Material Transfer",
                    "custom_received_bucket_id": bucket_id.lower(),
                    "custom_harvest_batch_no": receiving_doc.custom_harvest_batch_no or "",
                    "custom_receiving_batch_id": receiving_doc.custom_receiving_batch_id or "",
                    "company": company or receiving_doc.company or "",
                    "posting_date": frappe.utils.nowdate(),
                    "posting_time": frappe.utils.nowtime(),
                    "set_posting_time": 1,
                    "items": [{
                        "item_code": item_code,
                        "item_name": item_name,
                        "qty": qty_to_move,
                        "transfer_qty": qty_to_move,
                        "uom": "Stems",
                        "stock_uom": "Stems",
                        "conversion_factor": 1.0,
                        "s_warehouse": source_warehouse,
                        "t_warehouse": target_warehouse,
                        "cost_center": cost_center,
                        "basic_rate": basic_rate,
                        "basic_amount": qty_to_move * basic_rate,
                        "allow_zero_valuation_rate": 1,
                    }]
                }
                continuity_fields = [
                    "custom_farm", "custom_location", "custom_business_unit",
                    "custom_employee", "custom_employee_name", "custom_greenhouse",
                    "custom_harvester", "custom_stem_length", "custom_graded_by",
                    "custom_grader_payroll_number", "custom_biometric_verified",
                ]
                for field in continuity_fields:
                    if receiving_doc.get(field):
                        se_data[field] = receiving_doc.get(field)
                se_doc = frappe.get_doc(se_data)
                se_doc.insert(ignore_permissions=True)
                se_doc.submit()
                stock_entries.append(se_doc.name)
            except Exception as e:
                stock_move_errors.append(bucket_id + ": " + str(e))
                frappe.log_error(frappe.get_traceback(), "Submit Batch Quality - stock move " + bucket_id)


# ═══════════════════════════════════════════════════════════════════════════
# PHASE 2: one Quality Reporting per (variety, action) + CAR for Q / R
# ═══════════════════════════════════════════════════════════════════════════
for group_key, group in variety_groups.items():
    item_code = group["item_code"]
    effective_action = group["effective_action"]
    greenhouse = group["greenhouse"] or variety_greenhouse.get(item_code, "")
    group_farm = group["farm"] or variety_farm.get(item_code, "") or farm

    gh_val = greenhouse if (greenhouse and frappe.db.exists("Warehouse", greenhouse)) else None
    farm_val = group_farm if (group_farm and frappe.db.exists("Farm", group_farm)) else None
    variety_val = item_code if frappe.db.exists("Item", item_code) else None

    harvest_time = get_first_time(greenhouse, "Harvesting")
    arrival_time = get_first_time(greenhouse, "Receiving")
    transit_time = compute_transit_time(harvest_time, arrival_time)

    quarantined_stems = group["total_quarantined_stems"] if effective_action == "Quarantined" else 0
    report_quality_params = build_child_entries(item_code, effective_action) if effective_action in ("Quarantined", "Rejected") else []
    stems_checked_for_variety = int(stems_by_variety.get(item_code) or checked_stems or 0)

    intake_data = {
        "doctype": "Quality Reporting",
        "control_point": control_point,
        "farm": farm_val,
        "ghouse": gh_val,
        "variety": variety_val,
        "harvest_time": harvest_time,
        "arrival_time": arrival_time,
        "transit_time": transit_time,
        "stems_received": variety_stems_received.get(item_code, 0),
        "stems_checked": stems_checked_for_variety,
        "stems_per_bucket": 0,
        "solution_level": solution_level,
        "solution_hygeine": solution_hygiene_val,
        "solution_ph": solution_ph_val,
        "chlorine_ppm": chlorine_ppm,
        "control_action": effective_action,
        "quarantined_stems": quarantined_stems,
        "quality_parameters": report_quality_params,
        "prepared_by": frappe.session.user,
        "unit_manager": unit_manager or None,
    }

    try:
        intake_doc = frappe.get_doc(intake_data)
        intake_doc.insert(ignore_permissions=True)
        created_reports.append(intake_doc.name)
    except Exception as e:
        frappe.log_error(frappe.get_traceback(), "Submit Batch Quality - QR " + item_code + "/" + effective_action)
        continue

    # ── Corrective Action Report (isolated: never rolls back the report) ──
    if effective_action in ("Quarantined", "Rejected") and variety_val:
        try:
            if should_create_car(greenhouse, item_code):
                car_data = {
                    "doctype": "Corrective Action Report",
                    "variety": variety_val,
                    "date_of_incident": frappe.utils.nowdate(),
                    "requested_by": frappe.session.user,
                    "control_point": car_control_point,
                    "assigned_to": unit_manager or frappe.session.user,
                    "status": "Pending",
                    "root_cause": "To be determined",
                    "corrective_action_plan": "To be determined",
                    "target_date": frappe.utils.add_days(frappe.utils.nowdate(), 7),
                }
                if gh_val:
                    car_data["custom_greenhouse"] = gh_val
                car_doc = frappe.get_doc(car_data)
                car_doc.insert(ignore_permissions=True)
                corrective_action_reports.append(car_doc.name)
        except Exception as e:
            frappe.log_error(frappe.get_traceback(), "Submit Batch Quality - CAR " + item_code)

    total_accepted_stems += group["total_accepted_stems"]
    total_quarantined_stems += group["total_quarantined_stems"]
    total_rejected_stems += group["total_rejected_stems"]

frappe.db.commit()

frappe.response["status"] = "success"
frappe.response["message"] = (
    "Batch " + batch_no + ": " + str(len(created_reports)) + " Quality Reports created. "
    + "Accepted: " + str(total_accepted_stems) + ", Quarantined: " + str(total_quarantined_stems)
    + ", Rejected: " + str(total_rejected_stems) + " stems. "
    + str(len(corrective_action_reports)) + " Corrective Action Report(s) raised."
)
frappe.response["reports"] = created_reports
frappe.response["stock_entries"] = stock_entries
frappe.response["corrective_action_reports"] = corrective_action_reports
frappe.response["skipped_buckets"] = skipped_buckets
frappe.response["stock_move_errors"] = stock_move_errors
frappe.response["summary"] = {
    "total_accepted": total_accepted_stems,
    "total_quarantined": total_quarantined_stems,
    "total_rejected": total_rejected_stems,
    "varieties_processed": len(variety_groups),
    "buckets_processed": sum(g["bucket_count"] for g in variety_groups.values()),
    "buckets_skipped": len(skipped_buckets),
    "corrective_actions_raised": len(corrective_action_reports),
}
