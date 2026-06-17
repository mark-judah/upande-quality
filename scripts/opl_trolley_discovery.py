import frappe
import json

OPL = "OPL-UK & IE Flora Group Limited-1251069"

# 1) The OPL doc itself: its fields + any child tables (e.g. pick-list items / buckets)
doc = frappe.get_doc("OPL", OPL)
dd = doc.as_dict()
print("===== OPL TOP-LEVEL FIELDS =====")
for k in sorted(dd.keys()):
    v = dd[k]
    if isinstance(v, list):
        print("  [child table] %s -> %s rows" % (k, len(v)))
    else:
        print("  %s = %r" % (k, v))

print("\n===== CHILD TABLE ROWS (first row of each, all fields) =====")
for k in sorted(dd.keys()):
    v = dd[k]
    if isinstance(v, list) and v:
        print("\n-- %s (%s rows) -- first row fields:" % (k, len(v)))
        row0 = v[0]
        for fk in sorted(row0.keys()):
            print("     %s = %r" % (fk, row0[fk]))

# 2) Which DocTypes have a Link field pointing at OPL? (finds the Bucket doctype)
print("\n===== DOCTYPES WITH A Link FIELD -> OPL =====")
links = frappe.get_all("DocField",
    filters={"fieldtype": "Link", "options": "OPL"},
    fields=["parent", "fieldname"])
for l in links:
    print("  %s.%s" % (l["parent"], l["fieldname"]))

# 3) For each such doctype, show records tied to this OPL + their fields
for l in links:
    dt = l["parent"]
    fn = l["fieldname"]
    if frappe.db.exists("DocType", dt) and frappe.get_meta(dt).istable == 0:
        recs = frappe.get_all(dt, filters={fn: OPL}, fields=["name"], limit_page_length=0)
        print("\n===== %s WHERE %s = OPL  (%s records) =====" % (dt, fn, len(recs)))
        if recs:
            sample = frappe.get_doc(dt, recs[0]["name"]).as_dict()
            print("  sample record fields:")
            for sk in sorted(sample.keys()):
                if not isinstance(sample[sk], list):
                    print("     %s = %r" % (sk, sample[sk]))
