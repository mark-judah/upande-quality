# Server Script (API), api_method = itAssignableRoles
# Returns assignable Role names for the IT Dashboard Role Manager, reading the
# DB directly. frappe.get_all does NOT apply the doctype read-permission check
# (unlike frappe.client.get_list), so an IT User Admin can list roles WITHOUT
# holding System Manager / User Manager. Access is gated to IT User Admin /
# System Manager so the endpoint isn't open to everyone.
frappe.response["message"] = {"status": "error", "roles": []}
try:
    my_role_rows = frappe.get_all(
        "Has Role",
        filters={"parent": frappe.session.user, "parenttype": "User"},
        fields=["role"],
        limit_page_length=0,
    )
    roles_of_user = {}
    n = 0
    while n < len(my_role_rows):
        roles_of_user[my_role_rows[n].role] = 1
        n = n + 1
    if ("IT User Admin" not in roles_of_user) and ("System Manager" not in roles_of_user):
        frappe.response["message"] = {"status": "forbidden", "roles": []}
    else:
        rows = frappe.get_all(
            "Role",
            filters={"disabled": 0},
            fields=["name"],
            order_by="name asc",
            limit_page_length=0,
        )
        names = []
        i = 0
        while i < len(rows):
            names = names + [rows[i].name]
            i = i + 1
        frappe.response["message"] = {"status": "success", "roles": names}
except Exception as e:
    frappe.response["message"] = {"status": "error", "message": str(e), "roles": []}
