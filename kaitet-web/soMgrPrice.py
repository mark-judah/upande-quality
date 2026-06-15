# Frappe Server Script (Type: API), api_method = soMgrPrice
# Resolve rates for a list of items.
# Params: customer, price_list (optional), currency,
#   items = "|~|"-joined string of "item_code~length~conversion_factor".
# Resolution: Price By Length first (filters customer, currency, item_code,
#   length -> rate; row rate = rate * conversion_factor), then fall back to
#   Customer.custom_customer_pricing child (variety==item_code,
#   stem_length==length, currency==currency -> rate).
# Customer pricing child fields (introspected live): variety, stem_length,
#   rate, currency, event, event_rate.
# safe_exec: no import / def / += / list.append / sql. Flat while-loops only.

frappe.response["message"] = {"success": False, "error": "Script failed"}
try:
    fd = frappe.form_dict
    customer = fd.get("customer")
    currency = fd.get("currency")
    items_raw = fd.get("items") or ""

    # Parse the "|~|"-joined item tuples.
    tuples = []
    parts = items_raw.split("|~|")
    pi = 0
    while pi < len(parts):
        seg = parts[pi].strip()
        if seg:
            bits = seg.split("~")
            item_code = bits[0] if len(bits) > 0 else ""
            length = bits[1] if len(bits) > 1 else ""
            cf_str = bits[2] if len(bits) > 2 else "1"
            cf = 1.0
            try:
                cf = float(cf_str)
            except Exception:
                cf = 1.0
            tuples = tuples + [{"item_code": item_code, "length": length, "cf": cf}]
        pi = pi + 1

    # Preload customer pricing child rows once for fallback.
    cp_rows = []
    if customer:
        cp_rows = frappe.get_all(
            "Customer pricing",
            filters={"parent": customer, "parenttype": "Customer"},
            fields=["variety", "stem_length", "rate", "currency"],
            limit_page_length=0,
        )

    out = []
    ti = 0
    while ti < len(tuples):
        t = tuples[ti]
        item_code = t["item_code"]
        length = t["length"]
        cf = t["cf"]
        rate = None
        source = "none"

        # 1) Price By Length
        pbl_filters = [["item_code", "=", item_code]]
        if customer:
            pbl_filters = pbl_filters + [["customer", "=", customer]]
        if currency:
            pbl_filters = pbl_filters + [["currency", "=", currency]]
        if length:
            pbl_filters = pbl_filters + [["length", "=", length]]
        pbl = frappe.get_all(
            "Price By Length",
            filters=pbl_filters,
            fields=["rate"],
            limit_page_length=1,
        )
        if len(pbl) > 0 and pbl[0].get("rate") is not None:
            rate = (pbl[0].get("rate") or 0) * cf
            source = "price_by_length"

        # 2) Customer pricing fallback
        if source == "none":
            ci = 0
            while ci < len(cp_rows):
                c = cp_rows[ci]
                ok_variety = (c.get("variety") == item_code)
                ok_length = (c.get("stem_length") == length) if length else True
                ok_curr = (c.get("currency") == currency) if currency else True
                if ok_variety and ok_length and ok_curr:
                    rate = c.get("rate")
                    source = "customer_pricing"
                    ci = len(cp_rows)
                else:
                    ci = ci + 1

        out = out + [{"item_code": item_code, "length": length,
                      "rate": rate, "source": source}]
        ti = ti + 1

    frappe.response["message"] = {"success": True, "data": out}
except Exception as e:
    frappe.response["message"] = {"success": False, "error": str(e)}
