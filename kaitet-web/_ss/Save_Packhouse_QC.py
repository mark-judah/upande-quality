try:
    data = frappe.form_dict

    def greenhouse_from_wh(wh):
        if not wh:
            return ""
        if " - " in wh:
            wh = wh.rsplit(" - ", 1)[0]
        non_gh = ["Packhouse", "Rejects", "WIP", "Transit",
                  "Main Store", "Cold Room", "Finished"]
        for skip in non_gh:
            if skip in wh:
                return ""
        for clip in ["Receiving", "Cold"]:
            if clip in wh:
                wh = wh.split(clip)[0].strip()
                break
        return wh.strip()

    qc_stage        = data.get("qc_stage", "")
    inspection_type = data.get("inspection_type", "") or (
        "Online QC" if "Online" in qc_stage else "Final QC"
    )
    inspection_mode = data.get("inspection_mode", "")
    if not qc_stage:
        if inspection_type == "Online QC":
            qc_stage = (
                "Online QC - Grading QC" if inspection_mode == "Grading QC"
                else "Online QC - Reject Recorder"
            )
        else:
            qc_stage = "Final QC"
    date_val = data.get("date", frappe.utils.today())

    control_point = data.get("control_point", "")
    control_area  = data.get("control_area", "")
    if control_point and not control_area:
        try:
            control_area = (frappe.db.get_value(
                "QC Control Point", control_point, "control_area"
            ) or control_point)
        except Exception:
            control_area = control_point

    # Airport Returns is a scan-based return QC (control area "Airport
    # Returns"). Its stems are dispositioned as Reuse (shelved back to the
    # Kapkolia cold store) or Reject (moved to rejects) -- and it never
    # raises a CAR, since a customer return isn't a production defect.
    is_airport = (control_area or "").strip().lower() == "airport returns"

    order_pick_list = (
        data.get("order_pick_list", "")
        or data.get("order_spec", "")
        or data.get("order_spec_id", "")
    )

    variety   = data.get("variety", "")
    greenhouse = data.get("greenhouse", "")
    farm      = data.get("farm", "")
    box_label_raw = data.get("box_label", "")
    box_label = box_label_raw if frappe.db.exists("Box Label", box_label_raw) else ""

    specification_raw = data.get("specification", "")
    specification = specification_raw if frappe.db.exists("Specifications", specification_raw) else ""

    length = data.get("length", "")
    if not length and box_label:
        length = frappe.db.get_value(
            "Box Label Item", {"parent": box_label}, "length"
        ) or ""
    if not length and order_pick_list and variety:
        length = frappe.db.get_value(
            "Pick List Item",
            {"parent": order_pick_list, "item_code": variety},
            "custom_stem_length"
        ) or ""

    stems_affected   = int(data.get("stems_affected",   0) or 0)
    bunches_affected = int(data.get("bunches_affected",  0) or 0)
    stems_checked    = int(data.get("stems_checked",     0) or 0) or stems_affected
    boxes_checked    = int(data.get("boxes_checked",     0) or 0)
    boxes_staged     = int(data.get("boxes_staged",      0) or 0)
    boxes_quarantined= int(data.get("boxes_quarantined", 0) or 0)
    sampled_stems    = int(data.get("sampled_stems",     0) or 0)
    # Airport Returns extras carried on the QC record.
    invoice_number   = data.get("invoice_number", "")
    packhouse        = data.get("packhouse", "")
    stock_age        = int(data.get("stock_age", 0) or 0)

    qc_incharge = data.get("qc_incharge", "") or data.get("inspector", "")
    recorder    = frappe.session.user

    reason     = data.get("reason", "")
    remarks    = data.get("remarks", "")
    issues_raw = data.get("issues", "[]")
    if isinstance(issues_raw, str):
        issues_list = frappe.parse_json(issues_raw)
    else:
        issues_list = issues_raw or []

    customer = data.get("customer", "")
    team     = data.get("team", "")
    opl_data = {}
    if order_pick_list:
        opl_data = frappe.db.get_value(
            "Order Pick List", order_pick_list,
            ["customer", "custom_team", "custom_farm", "custom_total_stems"], as_dict=1
        ) or {}
        customer = customer or opl_data.get("customer", "")
        team     = team     or opl_data.get("custom_team", "")
        if not farm:
            farm = opl_data.get("custom_farm", "")

    def true_greenhouse_warehouse(bucket_id, fallback_wh):
        if bucket_id:
            rows = frappe.db.sql(
                "SELECT custom_greenhouse FROM `tabStock Entry`"
                " WHERE custom_received_bucket_id = %(bucket)s"
                " AND stock_entry_type IN ('Receiving', 'Late Receipt')"
                " AND docstatus = 1"
                " AND custom_greenhouse IS NOT NULL AND custom_greenhouse != ''"
                " ORDER BY creation DESC LIMIT 1",
                {"bucket": bucket_id}, as_dict=1
            )
            if rows:
                return rows[0]["custom_greenhouse"]
        return fallback_wh

    opl_variety_gh_pairs = []
    if order_pick_list:
        loc_rows = frappe.db.sql(
            "SELECT DISTINCT item_code, warehouse, custom_bucket"
            " FROM `tabPick List Item` WHERE parent = %s",
            order_pick_list, as_dict=1
        )
        seen_pairs = set()
        for loc in loc_rows:
            v  = loc.get("item_code", "")
            cold_room_wh = loc.get("warehouse", "")
            wh = true_greenhouse_warehouse(loc.get("custom_bucket", ""), cold_room_wh)
            gh = greenhouse_from_wh(wh)
            if v and gh:
                pair_key = v + "|" + gh
                if pair_key not in seen_pairs:
                    seen_pairs.add(pair_key)
                    opl_variety_gh_pairs.append({
                        "variety": v, "greenhouse": gh, "warehouse": wh,
                        "cold_room_warehouse": cold_room_wh,
                    })

        if not greenhouse and opl_variety_gh_pairs:
            greenhouse = opl_variety_gh_pairs[0].get("greenhouse", "")

    # ── Tally issues ─────────────────────────────────────────────────
    stems_quarantined = 0
    stems_rejected    = 0
    reuse_stems       = 0
    for issue in issues_list:
        cnt    = int(issue.get("count", 0) or 0)
        action = issue.get("action", "")
        if action == "Quarantine":
            stems_quarantined += cnt
        elif action == "Reject":
            stems_rejected += cnt
        elif action == "Reuse":
            reuse_stems += cnt

    stems_accepted = max(0, stems_checked - stems_quarantined - stems_rejected)

    if stems_accepted > 0:
        overall_result = "Accepted"
    elif stems_rejected > 0:
        overall_result = "Rejected"
    elif stems_quarantined > 0:
        overall_result = "Quarantined"
    else:
        overall_result = "Accepted"

    final_decision = data.get("final_decision", "")
    if final_decision in ("Accept", "Quarantine", "Reject"):
        order_total_stems = int(opl_data.get("custom_total_stems", 0) or 0)
        stems_checked = order_total_stems or stems_checked
        if final_decision == "Accept":
            stems_quarantined = 0
            stems_accepted    = max(0, stems_checked - stems_rejected)
            overall_result    = "Accepted"
        elif final_decision == "Quarantine":
            stems_accepted    = 0
            stems_quarantined = stems_checked
            stems_rejected    = 0
            overall_result    = "Quarantined"
        else:
            stems_accepted    = 0
            stems_quarantined = 0
            stems_rejected    = stems_checked
            overall_result    = "Rejected"

    issue_rows = []
    for i, iss in enumerate(issues_list):
        param = iss.get("parameter", "")
        cnt   = int(iss.get("count", 0) or 0)
        if param and cnt > 0:
            issue_rows.append({
                "doctype":   "Packhouse QC Issue",
                "parameter": param,
                "count":     cnt,
                "action":    iss.get("action", ""),
                "remarks":   iss.get("remarks", ""),
                "idx":       i + 1
            })

    doc = frappe.get_doc({
        "doctype":           "Packhouse QC",
        "inspection_type":   inspection_type,
        "inspection_mode":   inspection_mode,
        "date":              date_val,
        "order_pick_list":   order_pick_list,
        "box_label":         box_label,
        "customer":          customer,
        "team":              team,
        "inspector":         qc_incharge,
        "stems_checked":     stems_checked,
        "boxes_checked":     boxes_checked,
        "boxes_staged":      boxes_staged,
        "boxes_quarantined": boxes_quarantined,
        "stems_accepted":    stems_accepted,
        "stems_quarantined": stems_quarantined,
        "stems_rejected":    stems_rejected,
        "overall_result":    overall_result,
        "remarks":           remarks,
        "issues":            issue_rows,
        "qc_stage":          qc_stage,
        "order_spec_id":     order_pick_list,
        "control_point":     control_point,
        "control_area":      control_area,
        "variety":           variety,
        "length":            length,
        "specification":     specification,
        "greenhouse":        greenhouse,
        "farm":              farm,
        "stems_affected":    stems_affected,
        "bunches_affected":  bunches_affected,
        "invoice_number":    invoice_number,
        "packhouse":         packhouse,
        "stock_age":         stock_age,
        "reason":            reason if frappe.db.exists("Packhouse Rejection Reason", reason) else "",
        "qc_incharge":       qc_incharge if frappe.db.exists("User", qc_incharge) else "",
        "recorder":          recorder,
    })
    doc.insert(ignore_permissions=True)

    created_cars = []
    car_errors   = []

    PEST_DISEASE_PARAMS = {
        "Helicoverpa Egg", "Helicoverpa Damage", "Helicoverpa Larvae",
        "FCM Egg", "FCM Damages", "FCM Larvae",
        "Spodoptera Egg", "Spodoptera Damage", "Spodoptera Larvae",
        "Aphids", "Live Aphids", "Mites", "Mite Damage",
        "Thrips", "Thrips Damage", "Mealy Bugs", "White Flies",
        "Leaf Miner", "Slugs", "Poor Defoliation", "Poor Sizing",
        "Botrytis", "Fresh Powdery Mildew", "Dry Powdery Mildew",
        "Fresh Downy Mildew", "Dry Downy Mildew", "Black Spot", "Rust", "Rotting",
    }
    CAR_OTHER_THRESHOLD_PCT = 6.0
    car_base = sampled_stems if sampled_stems > 0 else stems_checked

    def issue_warrants_car(iss):
        param = iss.get("parameter", "")
        if param in PEST_DISEASE_PARAMS:
            return True
        cnt = int(iss.get("count", 0) or 0)
        return car_base > 0 and (cnt * 100.0 / car_base) > CAR_OTHER_THRESHOLD_PCT

    car_worthy = any(issue_warrants_car(r) for r in issue_rows)
    # Airport Returns never raise CARs -- a customer return isn't a farm defect.
    has_issues = (bool(issue_rows)
                  and (stems_rejected > 0 or stems_quarantined > 0)
                  and car_worthy
                  and not is_airport)

    CAR_ASSIGNEE = "nouma@karenroses.com"

    CAR_CP_MAP = {
        "intake": "Intake", "cold room": "Cold Room", "coldroom": "Cold Room",
        "grading": "Grading", "packhouse": "Packing", "packing": "Packing",
        "dispatch": "Dispatch",
    }
    def to_car_control_point(*texts):
        for text in texts:
            lowered = (text or "").strip().lower()
            for key, val in CAR_CP_MAP.items():
                if key in lowered:
                    return val
        return "Packing"
    car_control_point = to_car_control_point(control_area, control_point)

    if has_issues and opl_variety_gh_pairs:
        issue_summary = "; ".join(
            r["parameter"] + " x" + str(r["count"])
            for r in issue_rows
            if r.get("action") in ("Reject", "Quarantine")
        )
        week_start = frappe.utils.add_days(date_val, -7)

        for pair in opl_variety_gh_pairs:
            pair_variety    = pair.get("variety", "")
            pair_greenhouse = pair.get("greenhouse", "")
            pair_warehouse  = pair.get("warehouse", "")
            if not pair_variety or not pair_warehouse:
                continue
            if not frappe.db.exists("Warehouse", pair_warehouse):
                car_errors.append({
                    "variety": pair_variety, "greenhouse": pair_greenhouse,
                    "error": "Warehouse %s not found" % pair_warehouse,
                })
                continue

            try:
                existing_car = frappe.db.get_value(
                    "Corrective Action Report",
                    {
                        "custom_greenhouse": pair_warehouse,
                        "control_point":     car_control_point,
                        "variety":           pair_variety,
                        "date_of_incident":  [">=", week_start],
                        "status":            ["!=", "Complete"]
                    },
                    "name"
                )

                if existing_car:
                    created_cars.append({"variety": pair_variety,
                                         "greenhouse": pair_greenhouse,
                                         "car": existing_car,
                                         "new": False})
                else:
                    car_doc = frappe.get_doc({
                        "doctype":           "Corrective Action Report",
                        "variety":           pair_variety,
                        "issue":             issue_summary,
                        "date_of_incident":  date_val,
                        "farm":              farm,
                        "requested_by":      qc_incharge or frappe.session.user,
                        "control_point":     car_control_point,
                        "assigned_to":       CAR_ASSIGNEE,
                        "status":            "Pending",
                        "custom_greenhouse": pair_warehouse,
                        "custom_specification": specification,
                        "root_cause":        reason or issue_summary or "See linked Packhouse QC for detail",
                        "corrective_action_plan": "Pending review",
                        "target_date":       frappe.utils.add_days(date_val, 7)
                    })
                    car_doc.insert(ignore_permissions=True)
                    created_cars.append({"variety": pair_variety,
                                         "greenhouse": pair_greenhouse,
                                         "car": car_doc.name,
                                         "new": True})
            except Exception as car_exc:
                car_errors.append({
                    "variety":    pair_variety,
                    "greenhouse": pair_greenhouse,
                    "error":      str(car_exc)
                })

    new_cars = [c for c in created_cars if c.get("new")]
    if new_cars:
        frappe.db.set_value(
            "Packhouse QC", doc.name,
            "corrective_action_report", new_cars[0]["car"],
            update_modified=False
        )

    # ── Stock Entry for rejected stems ───────────────────────────────
    se_name  = None
    se_error = None
    if stems_rejected > 0:
        try:
            se_greenhouse_warehouse = ""
            se_source_warehouse = ""
            for pair in opl_variety_gh_pairs:
                if pair.get("greenhouse") == greenhouse:
                    se_greenhouse_warehouse = pair.get("warehouse", "")
                    se_source_warehouse = pair.get("cold_room_warehouse", "")
                    break
            if not se_greenhouse_warehouse and opl_variety_gh_pairs:
                se_greenhouse_warehouse = opl_variety_gh_pairs[0].get("warehouse", "")
                se_source_warehouse = opl_variety_gh_pairs[0].get("cold_room_warehouse", "")

            reject_item_code = variety if variety and frappe.db.exists("Item", variety) else "PACKHOUSE-REJECTS-KR"
            reject_item_uom = frappe.db.get_value("Item", reject_item_code, "stock_uom") or "Nos"

            se_item = {
                "doctype":          "Stock Entry Detail",
                "item_code":        reject_item_code,
                "qty":              stems_rejected,
                "uom":              reject_item_uom,
                "t_warehouse":      "Rejects - KR",
                "farm":             farm if frappe.db.exists("Farm", farm) else "",
                "custom_greenhouse": greenhouse,
            }
            # Airport rejects come back from the airport, so there's no live
            # cold-room source to transfer from -- receive them into Rejects.
            if (not is_airport) and se_source_warehouse and frappe.db.exists("Warehouse", se_source_warehouse):
                se_item["s_warehouse"] = se_source_warehouse
            else:
                se_item["item_code"] = variety if (variety and frappe.db.exists("Item", variety)) else "PACKHOUSE-REJECTS-KR"
                se_item["uom"] = frappe.db.get_value("Item", se_item["item_code"], "stock_uom") or "Nos"
                se_item["basic_rate"] = 0

            se_doc = {
                "doctype":          "Stock Entry",
                "stock_entry_type": "Packhouse Rejects" if se_item.get("s_warehouse") else "Material Receipt",
                "purpose":          "Material Transfer" if se_item.get("s_warehouse") else "Material Receipt",
                "company":          "Karen Roses",
                "posting_date":     date_val,
                "custom_packhouse_qc": doc.name,
                "custom_team":      team,
                "items": [se_item]
            }
            if farm and frappe.db.exists("Farm", farm):
                se_doc["custom_farm"] = farm
            if se_greenhouse_warehouse and frappe.db.exists("Warehouse", se_greenhouse_warehouse):
                se_doc["custom_greenhouse"] = se_greenhouse_warehouse

            se = frappe.get_doc(se_doc)
            se.insert(ignore_permissions=True)
            se.submit()
            se_name = se.name
        except Exception as se_exc:
            se_error = str(se_exc)

    # ── Reuse shelving (Airport Returns) ────────────────────────────
    # Reused stems are shelved back into stock at the Kapkolia cold store,
    # keeping their farm/greenhouse. A plain Material Receipt is used; the
    # original stock age is recorded on the QC (true ledger-age carry-through
    # would need the original batch, which returns don't carry).
    reuse_se_name  = None
    reuse_se_error = None
    if is_airport and reuse_stems > 0:
        try:
            reuse_wh = "Kapkolia Receiving Cold Store - KR"
            reuse_item = variety if (variety and frappe.db.exists("Item", variety)) else ""
            if not frappe.db.exists("Warehouse", reuse_wh):
                reuse_se_error = "Warehouse %s not found" % reuse_wh
            elif not reuse_item:
                reuse_se_error = "Variety item '%s' not found" % variety
            else:
                reuse_uom = frappe.db.get_value("Item", reuse_item, "stock_uom") or "Stems"
                r_item = {
                    "doctype":           "Stock Entry Detail",
                    "item_code":         reuse_item,
                    "qty":               reuse_stems,
                    "uom":               reuse_uom,
                    "t_warehouse":       reuse_wh,
                    "basic_rate":        0,
                    "farm":              farm if frappe.db.exists("Farm", farm) else "",
                    "custom_greenhouse": greenhouse,
                }
                r_doc = {
                    "doctype":          "Stock Entry",
                    "stock_entry_type": "Material Receipt",
                    "purpose":          "Material Receipt",
                    "company":          "Karen Roses",
                    "posting_date":     date_val,
                    "custom_packhouse_qc": doc.name,
                    "custom_team":      team,
                    "items": [r_item]
                }
                if farm and frappe.db.exists("Farm", farm):
                    r_doc["custom_farm"] = farm
                r_se = frappe.get_doc(r_doc)
                r_se.insert(ignore_permissions=True)
                r_se.submit()
                reuse_se_name = r_se.name
        except Exception as reuse_exc:
            reuse_se_error = str(reuse_exc)

    frappe.response["message"] = {
        "success":                  True,
        "name":                     doc.name,
        "overall_result":           overall_result,
        "stems_accepted":           stems_accepted,
        "stems_quarantined":        stems_quarantined,
        "stems_rejected":           stems_rejected,
        "stems_reused":             reuse_stems,
        "corrective_action_reports": created_cars,
        "car_errors":               car_errors,
        "stock_entry":              se_name,
        "stock_entry_error":        se_error,
        "reuse_stock_entry":        reuse_se_name,
        "reuse_stock_entry_error":  reuse_se_error
    }

except Exception as e:
    frappe.log_error(str(e), "savePackhouseQC Error")
    frappe.response["message"] = {"success": False, "error": str(e)}
