# Frappe Server Script (API), api_method = getPackhouseSchedule
# The day's curated packhouse schedule for a team (Packhouse Schedule doctype).
# Params: { team, date? }  -> { status, data:{ team, date, orders:[...] } }
fd = frappe.form_dict
team = fd.get('team') or ''
sdate = fd.get('date') or frappe.utils.today()
data = {"team": team, "date": str(sdate), "orders": []}
if team:
    name = "PSCH-" + str(sdate) + "-" + str(team)
    if frappe.db.exists("Packhouse Schedule", name):
        doc = frappe.get_doc("Packhouse Schedule", name)
        rows = doc.orders or []
        i = 0
        while i < len(rows):
            r = rows[i]
            data["orders"].append({
                "order_pick_list": r.order_pick_list or "",
                "order_name": r.order_name or "",
                "customer": r.customer or "",
                "sequence": int(r.sequence or 0),
            })
            i = i + 1
frappe.response["message"] = {"status": "success", "data": data}
