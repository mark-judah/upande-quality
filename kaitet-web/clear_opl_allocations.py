# Frappe Server Script (Type: API), api_method = clearOplAllocations
# Cleanup for orders damaged by the mixed-box bug.
#   - Reverses the Sales Order lines linked to the OPL (clears alloc flags + OPL link)
#   - Deletes the Bucket Allocation Status allocated to those SO(s) for those varieties
#   - Force-deletes the OPL itself (bypass submit guard / link checks / permissions / hooks)
# Works even if the OPL has ALREADY been deleted: it then derives the sales order(s)
# and varieties from the Sales Order lines that still carry the (now dangling) custom_opl.
# Payload: { opl: "<Order Pick List name>" }
# Constraints: no import / def / += — keep it flat.

frappe.response["message"] = {"success": False, "error": "Script failed"}

try:
    opl_name = frappe.form_dict.get("opl")
    if not opl_name:
        frappe.response["message"] = {"success": False, "error": "No OPL provided"}
    else:
        opl_exists = frappe.db.exists("Order Pick List", opl_name)
        so_list = []
        varieties = []

        # 1) Reverse + collect the Sales Order lines linked to this OPL.
        reset_items = frappe.get_all("Sales Order Item",
                                     filters={"custom_opl": opl_name},
                                     fields=["name", "parent", "item_code"])
        reset_count = 0
        i = 0
        while i < len(reset_items):
            r = reset_items[i]
            frappe.db.set_value("Sales Order Item", r.name, {
                "custom_fully_allocated": 0,
                "custom_stock_available": 0,
                "custom_opl": ""
            })
            if r.parent and r.parent not in so_list:
                so_list = so_list + [r.parent]
            if r.item_code and r.item_code not in varieties:
                varieties = varieties + [r.item_code]
            reset_count = reset_count + 1
            i = i + 1

        # 2) If the OPL still exists, fold in its own SO + pick-list varieties.
        if opl_exists:
            opl = frappe.get_doc("Order Pick List", opl_name)
            if opl.sales_order and opl.sales_order not in so_list:
                so_list = so_list + [opl.sales_order]
            locs = opl.locations or []
            j = 0
            while j < len(locs):
                ic = locs[j].item_code
                if ic and ic not in varieties:
                    varieties = varieties + [ic]
                j = j + 1

        # 3) Delete Bucket Allocation Status allocated to those SO(s) for those varieties.
        bas_names = []
        s = 0
        while s < len(so_list):
            rows = frappe.get_all("Bucket Allocations",
                                  filters={"parenttype": "Bucket Allocation Status", "sales_order": so_list[s]},
                                  fields=["parent"])
            t = 0
            while t < len(rows):
                p = rows[t].parent
                if p and p not in bas_names:
                    bas_names = bas_names + [p]
                t = t + 1
            s = s + 1

        deleted_bas = 0
        k = 0
        while k < len(bas_names):
            p = bas_names[k]
            if frappe.db.exists("Bucket Allocation Status", p):
                ic = frappe.db.get_value("Bucket Allocation Status", p, "item_code")
                if (not varieties) or (ic in varieties):
                    frappe.delete_doc("Bucket Allocation Status", p, force=1,
                                      ignore_permissions=True, ignore_on_trash=True)
                    deleted_bas = deleted_bas + 1
            k = k + 1

        # 4) Force-delete the pick list if it still exists.
        if opl_exists:
            if opl.docstatus == 1:
                frappe.db.set_value("Order Pick List", opl_name, "docstatus", 2)
            frappe.delete_doc("Order Pick List", opl_name, force=1,
                              ignore_permissions=True, ignore_on_trash=True)

        frappe.db.commit()
        frappe.response["message"] = {
            "success": True,
            "opl": opl_name,
            "opl_existed": 1 if opl_exists else 0,
            "sales_orders": so_list,
            "varieties": varieties,
            "deleted_bas": deleted_bas,
            "reset_so_items": reset_count
        }

except Exception as e:
    frappe.db.rollback()
    frappe.response["message"] = {"success": False, "error": str(e)}
