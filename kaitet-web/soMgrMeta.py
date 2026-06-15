# Frappe Server Script (Type: API), api_method = soMgrMeta
# Reference / dropdown data for the Roses Sales Order Manager web form.
# Returns customers, varieties, specs, packrates, box_types, farms, pricelists,
# consignees, shipping_agents, delivery_points, modes_of_transport, settings.
# safe_exec: no import / def / += / list.append / sql. Flat while-loops only.

frappe.response["message"] = {"success": False, "error": "Script failed"}
try:
    out = {}

    out["customers"] = frappe.get_all(
        "Customer",
        filters={"disabled": 0},
        fields=["name", "customer_name", "customer_group", "territory"],
        limit_page_length=0,
        order_by="customer_name asc",
    )

    out["varieties"] = frappe.get_all(
        "Item",
        filters=[["item_group", "in", ["Roses", "Spray Roses"]]],
        fields=["name", "item_name", "item_group", "stock_uom"],
        limit_page_length=0,
        order_by="item_name asc",
    )

    out["specs"] = frappe.get_all(
        "Specifications",
        fields=["name", "spec_name", "customer", "box_assortment"],
        limit_page_length=0,
        order_by="spec_name asc",
    )

    out["packrates"] = frappe.get_all(
        "Packrate",
        fields=["name", "packrate", "box_type"],
        limit_page_length=0,
        order_by="packrate asc",
    )

    out["box_types"] = frappe.get_all(
        "Box Type",
        fields=["name"],
        limit_page_length=0,
        order_by="name asc",
    )

    out["farms"] = frappe.get_all(
        "Farm",
        fields=["name"],
        limit_page_length=0,
        order_by="name asc",
    )

    out["pricelists"] = frappe.get_all(
        "Price List",
        filters={"selling": 1},
        fields=["name", "currency"],
        limit_page_length=0,
        order_by="name asc",
    )

    out["consignees"] = frappe.get_all(
        "Consignee",
        fields=["name"],
        limit_page_length=0,
        order_by="name asc",
    )

    out["shipping_agents"] = frappe.get_all(
        "Shipping Agent",
        fields=["name"],
        limit_page_length=0,
        order_by="name asc",
    )

    out["delivery_points"] = frappe.get_all(
        "Delivery Point",
        fields=["name"],
        limit_page_length=0,
        order_by="name asc",
    )

    # custom_mode_of_transport is a Select on Sales Order
    out["modes_of_transport"] = ["Air", "Sea Freight"]

    out["settings"] = {}

    frappe.response["message"] = {"success": True, "data": out}
except Exception as e:
    frappe.response["message"] = {"success": False, "error": str(e)}
