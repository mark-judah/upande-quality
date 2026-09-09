# Frappe Server Script (API), api_method = savePackhouseSchedule
# Upsert the day's curated schedule for a team. `orders` = "|~|"-joined OPL names
# in the desired sequence (sandbox has no JSON parse). One doc per (date, team).
fd = frappe.form_dict
team = fd.get('team') or ''
sdate = fd.get('date') or frappe.utils.today()
orders_raw = fd.get('orders') or ''
if not team:
    frappe.response["message"] = {"status": "error", "message": "team is required"}
else:
    name = "PSCH-" + str(sdate) + "-" + str(team)
    if frappe.db.exists("Packhouse Schedule", name):
        doc = frappe.get_doc("Packhouse Schedule", name)
    else:
        doc = frappe.new_doc("Packhouse Schedule")
        doc.schedule_date = sdate
        doc.team = team
    doc.set("orders", [])
    opls = orders_raw.split("|~|") if orders_raw else []
    seq = 1
    i = 0
    while i < len(opls):
        opl = (opls[i] or "").strip()
        if opl and frappe.db.exists("Order Pick List", opl):
            info = frappe.db.get_value("Order Pick List", opl, ["custom_order_name", "customer"], as_dict=True) or {}
            row = doc.append("orders", {})
            row.order_pick_list = opl
            row.order_name = info.get("custom_order_name") or ""
            row.customer = info.get("customer") or ""
            row.sequence = seq
            seq = seq + 1
        i = i + 1
    doc.save(ignore_permissions=True)
    frappe.db.commit()
    frappe.response["message"] = {"status": "success", "name": doc.name, "count": len(doc.orders)}
