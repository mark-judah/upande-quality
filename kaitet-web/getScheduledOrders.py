# Frappe Server Script (API), api_method = getScheduledOrders
# Flat map of every order on a Packhouse Schedule for a date -> {team, sequence}.
# Powers the scheduler's scheduled/unscheduled marking (default = unscheduled).
# Params: { date? } -> { status, date, scheduled: { <opl>: {team, sequence} } }
fd = frappe.form_dict
sdate = fd.get('date') or frappe.utils.today()
scheduled = {}
names = frappe.get_all("Packhouse Schedule", filters={"schedule_date": sdate}, pluck="name")
i = 0
while i < len(names):
    doc = frappe.get_doc("Packhouse Schedule", names[i])
    rows = doc.orders or []
    j = 0
    while j < len(rows):
        r = rows[j]
        if r.order_pick_list:
            scheduled[r.order_pick_list] = {"team": doc.team, "sequence": int(r.sequence or 0)}
        j = j + 1
    i = i + 1
frappe.response["message"] = {"status": "success", "date": str(sdate), "scheduled": scheduled}
