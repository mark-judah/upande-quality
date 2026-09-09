# Frappe Server Script (API), api_method = saveDaySchedule
# Reorder IS the schedule: takes the global ordered ready list and rebuilds each
# team's Packhouse Schedule doc (orders in the global order, resequenced 1..N per team).
# Params: { date?, order }  order = "|~|"-joined OPL names in global order.
fd = frappe.form_dict
sdate = fd.get('date') or frappe.utils.today()
order_raw = fd.get('order') or ''
opls = []
parts = order_raw.split("|~|") if order_raw else []
p = 0
while p < len(parts):
    v = (parts[p] or "").strip()
    if v:
        opls.append(v)
    p = p + 1

info_map = {}
if opls:
    recs = frappe.get_all("Order Pick List", filters={"name": ["in", opls]},
                          fields=["name", "custom_team", "custom_order_name", "customer"], limit_page_length=0)
    r = 0
    while r < len(recs):
        info_map[recs[r]["name"]] = recs[r]
        r = r + 1

by_team = {}
team_order = []
i = 0
while i < len(opls):
    info = info_map.get(opls[i])
    if info:
        team = info.get("custom_team") or ""
        if team:
            if team not in by_team:
                by_team[team] = []
                team_order.append(team)
            by_team[team].append(opls[i])
    i = i + 1

saved = {}
k = 0
while k < len(team_order):
    team = team_order[k]
    name = "PSCH-" + str(sdate) + "-" + str(team)
    if frappe.db.exists("Packhouse Schedule", name):
        doc = frappe.get_doc("Packhouse Schedule", name)
    else:
        doc = frappe.new_doc("Packhouse Schedule")
        doc.schedule_date = sdate
        doc.team = team
    doc.set("orders", [])
    rows = by_team[team]
    seq = 1
    j = 0
    while j < len(rows):
        info = info_map.get(rows[j]) or {}
        row = doc.append("orders", {})
        row.order_pick_list = rows[j]
        row.order_name = info.get("custom_order_name") or ""
        row.customer = info.get("customer") or ""
        row.sequence = seq
        seq = seq + 1
        j = j + 1
    doc.save(ignore_permissions=True)
    saved[team] = len(rows)
    k = k + 1
frappe.db.commit()
frappe.response["message"] = {"status": "success", "saved": saved}
