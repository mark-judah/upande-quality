"""
CAR Backfill — fills `farm` and `issue` on existing Corrective Action Report
documents using data from matching Quality Reporting records.

How to run:
    cd <bench-dir>
    bench --site kaitet.local console
    >>> exec(open('/path/to/car_backfill.py').read())

Or one-shot via execute:
    bench --site kaitet.local execute path.to.car_backfill.run
(but for that you'd need to drop this file into an app module; pasting into
console is the simplest).

Idempotent — only fills fields that are currently empty. Safe to re-run.
"""

import frappe


def derive_farm(greenhouse: str) -> str:
    """First token of the greenhouse name, e.g. 'Simotwo GH 03' -> 'Simotwo'."""
    if not greenhouse:
        return ""
    parts = str(greenhouse).strip().split()
    return parts[0] if parts else ""


def compute_issue(car: dict) -> str:
    """Find Quality Reporting documents that match this CAR's
    (variety, ghouse, control_point) and pull non-empty parameter_name values
    from their quality_parameters child rows where action is Quarantined or
    Rejected. Returns a '; '-joined dedup string like:
        'Bent Stem (12); Wrong Length (5); Pest Damage (3)'
    """
    if not car.get("variety") or not car.get("custom_greenhouse"):
        return ""

    rows = frappe.db.sql(
        """
        SELECT qr.name
        FROM `tabQuality Reporting` qr
        WHERE qr.docstatus < 2
          AND COALESCE(qr.variety, '')       = %(variety)s
          AND COALESCE(qr.ghouse, '')        = %(ghouse)s
          AND COALESCE(qr.control_point, '') = %(control_point)s
          AND (
              %(d)s IS NULL
              OR DATE(qr.creation) BETWEEN DATE_SUB(%(d)s, INTERVAL 1 DAY)
                                       AND DATE_ADD(%(d)s, INTERVAL 1 DAY)
          )
          AND qr.control_action IN ('Quarantined', 'Rejected')
        ORDER BY qr.creation DESC
        LIMIT 5
        """,
        {
            "variety": car.get("variety") or "",
            "ghouse": car.get("custom_greenhouse") or "",
            "control_point": car.get("control_point") or "",
            "d": car.get("date_of_incident"),
        },
        as_dict=1,
    )

    seen = []
    seen_lower = set()
    for r in rows:
        params = frappe.db.sql(
            """
            SELECT parameter_name, count
            FROM `tabQuality Parameter`
            WHERE parent = %(p)s
              AND action IN ('Quarantined', 'Rejected')
              AND parameter_name IS NOT NULL AND parameter_name != ''
            ORDER BY count DESC
            """,
            {"p": r["name"]},
            as_dict=1,
        )
        for p in params:
            pn = (p.get("parameter_name") or "").strip()
            if not pn:
                continue
            key = pn.lower()
            if key in seen_lower:
                continue
            seen_lower.add(key)
            cnt = p.get("count") or 0
            seen.append(f"{pn} ({cnt})" if cnt else pn)
    return "; ".join(seen)


def run():
    cars = frappe.get_all(
        "Corrective Action Report",
        fields=[
            "name", "variety", "custom_greenhouse", "control_point",
            "date_of_incident", "farm", "issue",
        ],
        limit_page_length=0,  # no limit
        order_by="creation asc",
    )

    total = len(cars)
    filled_farm = 0
    filled_issue = 0
    skipped = 0
    print(f"Scanning {total} CARs…")

    for car in cars:
        updates = {}

        if not car.get("farm"):
            f = derive_farm(car.get("custom_greenhouse") or "")
            if f:
                updates["farm"] = f

        if not car.get("issue"):
            issue = compute_issue(car)
            if issue:
                updates["issue"] = issue

        if not updates:
            skipped += 1
            continue

        # Bypass hooks (we just want the DB write) — faster than doc.save().
        frappe.db.set_value(
            "Corrective Action Report", car["name"], updates, update_modified=False,
        )
        if "farm" in updates:  filled_farm += 1
        if "issue" in updates: filled_issue += 1

    frappe.db.commit()
    print(
        f"Done. total={total}  farm_filled={filled_farm}  "
        f"issue_filled={filled_issue}  skipped(no-change)={skipped}"
    )


# Auto-run when exec()'d from the bench console
if __name__ == "__main__" or "frappe" in dir():
    try:
        run()
    except Exception as e:
        print("ERROR:", e)
