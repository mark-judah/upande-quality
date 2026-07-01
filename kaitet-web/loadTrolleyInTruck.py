try:
    data = frappe.form_dict.get("data")
    if not data:
        frappe.throw("No data provided")

    if isinstance(data, str):
        data = frappe.parse_json(data)

    trolley_id = data.get("trolley_id")
    custom_transit_truck = data.get("truck_id")

    if not trolley_id:
        frappe.throw("trolley_id is required")

    if not custom_transit_truck:
        frappe.throw("custom_transit_truck is required")

    rows = frappe.get_all(
        "Pick List Item",
        filters={
            "custom_trolley_id": trolley_id,
            "custom_loaded_in_trolley": 1,
            "custom_in_transit": 0
        },
        fields=["name", "parent"],
        order_by="parent asc"
    )

    if not rows:
        frappe.response["message"] = {
            "status": "error",
            "message": "No buckets found for trolley " + str(trolley_id)
        }
    else:
        opl_map = {}
        for row in rows:
            parent = row.get("parent")
            if parent not in opl_map:
                opl_map[parent] = []
            opl_map[parent].append(row.get("name"))

        updated_count = 0
        for opl_name, child_names in opl_map.items():
            doc = frappe.get_doc("Order Pick List", opl_name)
            for loc_row in doc.locations:
                if loc_row.name in child_names:
                    loc_row.custom_in_transit = 1
                    loc_row.custom_transit_truck=custom_transit_truck
                    loc_row.custom_shelf = ""
                    updated_count += 1
            doc.save(ignore_permissions=True)

        frappe.db.commit()

        frappe.response["message"] = {
            "status": "success",
            "message": str(updated_count) + " bucket(s) from trolley " + str(trolley_id) + " loaded to " + str(custom_transit_truck)
        }

except Exception as e:
    frappe.log_error("loadTrolleyInTruck error", str(e))
    frappe.response["message"] = {
        "status": "error",
        "message": str(e)
    }