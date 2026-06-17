import frappe

NAME = "OPL-Superflora B.V.(IRELAND)-1269728"

if not frappe.db.exists("Order Pick List", NAME):
    print("Not found (already deleted?):", NAME)
else:
    doc = frappe.get_doc("Order Pick List", NAME)
    print("Found:", NAME, "| docstatus =", doc.docstatus, "| customer =", doc.customer)
    try:
        if doc.docstatus == 1:
            doc.cancel()
            print("Submitted doc cancelled.")
        # force=True bypasses the "linked with Sales Order ..." check.
        # The linking docs (e.g. SO-2026-07493-2) keep their stored OPL value,
        # which now points at a deleted record — accepted to get the OPL gone.
        frappe.delete_doc("Order Pick List", NAME, force=True, ignore_permissions=True)
        frappe.db.commit()
        print("DELETED:", NAME)
    except Exception as e:
        frappe.db.rollback()
        print("Delete still blocked:", str(e))
