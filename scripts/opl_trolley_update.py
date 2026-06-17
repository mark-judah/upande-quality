import frappe

DT = "Order Pick List"
OPL = "OPL-UK & IE Flora Group Limited-1251069"
TROLLEY = "001"
TRUCK = "KTCB 444K"

# Pick the value to write into a "status" field. Prefer a Select option that
# mentions transit; otherwise fall back to the literal the app's endpoint uses.
def resolve_status(df):
    if df.fieldtype == "Select" and df.options:
        for o in df.options.split("\n"):
            if "transit" in o.lower():
                return o
    return "in_transit"

# For a given doctype, return (trolley_field, truck_field, status_field, status_value)
def targets(meta):
    tf = None
    kf = None
    sf = None
    sv = None
    for df in meta.fields:
        nm = df.fieldname.lower()
        if tf is None and "trolley" in nm:
            tf = df.fieldname
        if kf is None and "truck" in nm:
            kf = df.fieldname
        if sf is None and "status" in nm:
            sf = df.fieldname
            sv = resolve_status(df)
    return tf, kf, sf, sv

def build_vals(meta):
    res = targets(meta)
    tf = res[0]
    kf = res[1]
    sf = res[2]
    sv = res[3]
    vals = {}
    if tf:
        vals[tf] = TROLLEY
    if kf:
        vals[kf] = TRUCK
    if sf:
        vals[sf] = sv
    return vals

updated = 0

# 1) The OPL document itself + its child tables
doc = frappe.get_doc(DT, OPL)

oplvals = build_vals(frappe.get_meta(DT))
if oplvals:
    frappe.db.set_value(DT, OPL, oplvals)
    updated = updated + 1
    print("OPL header set:", oplvals)

for df in frappe.get_meta(DT).fields:
    if df.fieldtype == "Table" and df.options:
        child_dt = df.options
        cmeta = frappe.get_meta(child_dt)
        cvals = build_vals(cmeta)
        if not cvals:
            continue
        rows = doc.get(df.fieldname) or []
        for row in rows:
            frappe.db.set_value(child_dt, row.name, cvals)
            updated = updated + 1
        print("Child %s.%s (%s rows) set: %s" % (DT, df.fieldname, len(rows), cvals))

# 2) Standalone doctypes that Link to Order Pick List (e.g. the Bucket doctype)
links = frappe.get_all("DocField",
    filters={"fieldtype": "Link", "options": DT},
    fields=["parent", "fieldname"])
for l in links:
    dt = l["parent"]
    fn = l["fieldname"]
    if not frappe.db.exists("DocType", dt):
        continue
    meta = frappe.get_meta(dt)
    if meta.istable:
        continue
    vals = build_vals(meta)
    if not vals:
        continue
    recs = frappe.get_all(dt, filters={fn: OPL}, fields=["name"], limit_page_length=0)
    for r in recs:
        frappe.db.set_value(dt, r["name"], vals)
        updated = updated + 1
    print("%s where %s=OPL (%s recs) set: %s" % (dt, fn, len(recs), vals))

frappe.db.commit()
print("TOTAL records updated:", updated)
