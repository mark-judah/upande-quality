# Frappe Server Script (Type: API), api_method = getDispatchTrucks
# Truck list for the offline Bucket Requests "Load to truck" picker:
# every Vehicle whose "Dispatch Truck?" (custom_dispatch_truck) is UNCHECKED (0).
# frappe.get_all ignores user permissions, so any logged-in operator can read it.
# Response: { "status": "success", "trucks": [{"name","license_plate"}], "count" }
frappe.response["message"] = {"status": "error", "trucks": []}
try:
    rows = frappe.get_all(
        "Vehicle",
        filters={"custom_dispatch_truck": 0},
        fields=["name", "license_plate"],
        order_by="name asc",
        limit_page_length=0,
    )
    trucks = []
    i = 0
    while i < len(rows):
        r = rows[i]
        trucks = trucks + [{"name": r.get("name"), "license_plate": r.get("license_plate")}]
        i = i + 1
    frappe.response["message"] = {"status": "success", "trucks": trucks, "count": len(trucks)}
except Exception as e:
    frappe.response["message"] = {"status": "error", "message": str(e), "trucks": []}
