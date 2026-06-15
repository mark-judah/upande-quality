# Frappe Server Script (Type: API), api_method = soMgrList
# List rows for the Roses Sales Order Manager.
# Params (all optional): from_date, to_date, customer, farm, week, status.
# Always filters custom_sales_order_type = "Roses". Default window: last 30 days.
# safe_exec: no import / def / += / list.append / sql. Flat while-loops only.

frappe.response["message"] = {"success": False, "error": "Script failed"}
try:
    fd = frappe.form_dict
    from_date = fd.get("from_date")
    to_date = fd.get("to_date")
    customer = fd.get("customer")
    farm = fd.get("farm")
    week = fd.get("week")
    status = fd.get("status")

    if not from_date and not to_date:
        to_date = frappe.utils.today()
        from_date = frappe.utils.add_days(to_date, -30)

    filters = [["custom_sales_order_type", "=", "Roses"]]
    if from_date:
        filters = filters + [["transaction_date", ">=", from_date]]
    if to_date:
        filters = filters + [["transaction_date", "<=", to_date]]
    if customer:
        filters = filters + [["customer", "=", customer]]
    if farm:
        filters = filters + [["custom_farm", "=", farm]]
    if week:
        filters = filters + [["custom_week", "=", week]]
    if status:
        filters = filters + [["status", "=", status]]

    rows = frappe.get_all(
        "Sales Order",
        filters=filters,
        fields=["name", "custom_order_name", "customer", "customer_name",
                "delivery_date", "custom_week", "custom_farm", "total_qty",
                "status", "docstatus", "transaction_date"],
        order_by="transaction_date desc, creation desc",
        limit_page_length=200,
    )

    out = []
    i = 0
    while i < len(rows):
        r = rows[i]
        d = dict(r)
        if d.get("delivery_date"):
            d["delivery_date"] = str(d["delivery_date"])
        if d.get("transaction_date"):
            d["transaction_date"] = str(d["transaction_date"])
        out = out + [d]
        i = i + 1

    frappe.response["message"] = {"success": True, "data": out}
except Exception as e:
    frappe.response["message"] = {"success": False, "error": str(e)}
