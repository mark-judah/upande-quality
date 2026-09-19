# Shelf Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a same-farm bucket-transfer operation (that re-syncs a bucket's cached location on any draft Order Pick List) and an "offline removal" report operation (that posts a real stock movement) to the packhouse shelving system, both writing correct Shelving Log entries — plus fix the pre-existing gap where normal shelving never wrote a Shelving Log entry in the first place.

**Architecture:** Two new whitelisted Python endpoints in `upande_quality`'s mobile API façade (matching where `createShelvingEntry`/`createDiscardEntry` already live), calling directly into `upande_packhouse`'s doctypes. A new "Shelf Operations" React Native screen in `upande-quality`, built from the same four-layer pattern (api → repository → zustand store → screen) as the existing Shelving screen.

**Tech Stack:** Frappe (Python) backend across two apps (`upande_packhouse`, `upande_quality`) in the bench at `/home/jk/Projects/upande-local-bench-v16`; React Native / Expo Router frontend in `/home/jk/Projects/upande-quality`; zustand for client state.

**Spec:** `/home/jk/Projects/upande-quality/docs/superpowers/specs/2026-09-19-shelf-operations-design.md`

## Global Constraints

- Transfer is same-farm only — reject cross-farm moves with a clear error naming both farms.
- A bucket moves/removes as one physical unit — every `Shelf Item` row for its `bucket_id` (it can have more than one, e.g. mixed variety/length) is handled together.
- Every operation that changes where a bucket sits must produce a correct Shelving Log entry (close the open "Shelved" row, open a new one or leave it closed with the right `reason`).
- Offline removal is blocked outright if the bucket is currently allocated (`Bucket Allocation Status.allocated_quantity > 0`) — the error must name the specific sales order(s).
- New backend endpoints follow the existing response convention exactly: `frappe.response["data"] = {"status": "success"|"failed"|"error", "reason"?, "message", "payload"?}` — this is what the mobile api layer's unwrap logic (`unwrapped.data ?? unwrapped`) depends on.
- All Frappe doc mutations that touch already-existing records use `ignore_permissions=True` and end with an explicit `frappe.db.commit()`, matching every existing whitelisted endpoint in these files (they're reachable over GET, and Frappe rolls back writes made during a GET request otherwise).

---

### Task 1: Data model — Stock Entry Type + Shelving Log reason options

**Files:**
- Modify: `/home/jk/Projects/upande-local-bench-v16/apps/upande_packhouse/upande_packhouse/fixtures/stock_entry_type.json`
- Modify: `/home/jk/Projects/upande-local-bench-v16/apps/upande_packhouse/upande_packhouse/upande_packhouse/doctype/shelving_log/shelving_log.json`

**Interfaces:**
- Produces: Stock Entry Type `"Offline Issuing"` (usable as `stock_entry_type` on any `Stock Entry`); Shelving Log `reason` Select options `"Transferred (Shelf-to-Shelf)"` and `"Offline Issuing"` (usable as the `reason` field value on any `Shelving Log` doc).

- [ ] **Step 1: Add the new Stock Entry Type fixture entry**

Current file content:
```json
[
 {
  "add_to_transit": 0,
  "docstatus": 0,
  "doctype": "Stock Entry Type",
  "is_standard": 0,
  "modified": "2026-09-11 16:24:26.474557",
  "name": "Move To Graded Sold",
  "purpose": "Material Transfer",
  "require_biometric": 0
 },
 {
  "add_to_transit": 0,
  "docstatus": 0,
  "doctype": "Stock Entry Type",
  "is_standard": 0,
  "modified": "2026-09-12 01:09:43.780969",
  "name": "Farm Transfer",
  "purpose": "Material Transfer",
  "require_biometric": 0
 }
]
```

Replace with (adds a third entry, keeps the first two byte-for-byte):
```json
[
 {
  "add_to_transit": 0,
  "docstatus": 0,
  "doctype": "Stock Entry Type",
  "is_standard": 0,
  "modified": "2026-09-11 16:24:26.474557",
  "name": "Move To Graded Sold",
  "purpose": "Material Transfer",
  "require_biometric": 0
 },
 {
  "add_to_transit": 0,
  "docstatus": 0,
  "doctype": "Stock Entry Type",
  "is_standard": 0,
  "modified": "2026-09-12 01:09:43.780969",
  "name": "Farm Transfer",
  "purpose": "Material Transfer",
  "require_biometric": 0
 },
 {
  "add_to_transit": 0,
  "docstatus": 0,
  "doctype": "Stock Entry Type",
  "is_standard": 0,
  "modified": "2026-09-19 00:00:00.000000",
  "name": "Offline Issuing",
  "purpose": "Material Issue",
  "require_biometric": 0
 }
]
```

- [ ] **Step 2: Add the two new Shelving Log reason options**

In `shelving_log.json`, find the `reason` field's `options` string:
```json
   "options": "Shelved\nIssued to Sales Order\nIssued from Coldstore\nTransferred (Trolley/Truck)\nDiscarded\nReplaced\nShelf Cleared\nAged Out"
```
Replace with:
```json
   "options": "Shelved\nIssued to Sales Order\nIssued from Coldstore\nTransferred (Trolley/Truck)\nDiscarded\nReplaced\nShelf Cleared\nAged Out\nTransferred (Shelf-to-Shelf)\nOffline Issuing"
```
Also bump the doctype's own `"modified"` timestamp field (top-level, currently `"2026-08-12 13:50:49.596943"`) to the current date/time so Frappe picks up the change as newer than what's in the DB — set it to `"2026-09-19 00:00:00.000000"`.

- [ ] **Step 3: Apply the fixtures**

Run: `cd /home/jk/Projects/upande-local-bench-v16 && bench --site kaitet.local migrate`

Expected: migration completes without error; it re-imports the `Stock Entry Type` fixture and picks up the doctype JSON change for `Shelving Log`.

- [ ] **Step 4: Verify in the console**

```bash
cd /home/jk/Projects/upande-local-bench-v16 && bench --site kaitet.local console
```
```python
import frappe
print(frappe.db.exists("Stock Entry Type", "Offline Issuing"))
print(frappe.get_meta("Shelving Log").get_field("reason").options)
exit()
```
Expected: `Offline Issuing` (truthy — the type exists), and the options string contains both `Transferred (Shelf-to-Shelf)` and `Offline Issuing`.

- [ ] **Step 5: Commit**

```bash
cd /home/jk/Projects/upande-local-bench-v16
git add apps/upande_packhouse/upande_packhouse/fixtures/stock_entry_type.json apps/upande_packhouse/upande_packhouse/upande_packhouse/doctype/shelving_log/shelving_log.json
git commit -m "feat: add Offline Issuing stock entry type and Shelving Log reasons"
```

---

### Task 2: Shelving Log gap fix — `createShelvingEntry` (upande_quality)

**Files:**
- Modify: `/home/jk/Projects/upande-local-bench-v16/apps/upande_quality/upande_quality/mobile/api.py:1893-1914`
- Test: `/home/jk/Projects/upande-local-bench-v16/apps/upande_quality/upande_quality/tests/test_shelf_operations.py` (new file)

**Interfaces:**
- Produces: after a successful `createShelvingEntry` call, one `Shelving Log` row per newly-created `Shelf Item` row, with `reason="Shelved"`, `shelved_on` set, `shelved_by` set to the acting user, and `shelf_item` set to that Shelf Item row's own `name`.

- [ ] **Step 1: Write the failing test**

Create `/home/jk/Projects/upande-local-bench-v16/apps/upande_quality/upande_quality/tests/__init__.py` (empty file, if the `tests` directory doesn't already exist under `upande_quality/upande_quality/`) and `/home/jk/Projects/upande-local-bench-v16/apps/upande_quality/upande_quality/tests/test_shelf_operations.py`:

```python
import json

import frappe
from frappe.tests import IntegrationTestCase


class IntegrationTestShelfOperations(IntegrationTestCase):
	def setUp(self):
		self.farm = "Test Shelf Ops Farm"
		if not frappe.db.exists("Farm", self.farm):
			frappe.get_doc({
				"doctype": "Farm",
				"farm_name": self.farm,
				"company": "Karen Roses",
				"abbreviation": "TSOF",
				"farm_type": [{"farm_type": "Has Greenhouses"}],
			}).insert(ignore_permissions=True)
		self.bucket_id = "TEST-BUCKET-001"
		if not frappe.db.exists("Bucket QR Code", self.bucket_id):
			frappe.get_doc(
				{"doctype": "Bucket QR Code", "id": self.bucket_id, "item_code": "Reflex"}
			).insert(ignore_permissions=True)
		frappe.db.commit()

	def tearDown(self):
		frappe.db.delete("Shelving Log", {"bucket_id": self.bucket_id})
		frappe.db.delete("Shelf Item", {"bucket_id": self.bucket_id})
		frappe.db.commit()

	def test_shelving_writes_shelved_log_row(self):
		shelf_id = "TEST-SHELF-A"
		if not frappe.db.exists("Shelf", shelf_id):
			frappe.get_doc(
				{"doctype": "Shelf", "shelf_id": shelf_id, "farm": self.farm}
			).insert(ignore_permissions=True)

		shelf_doc = frappe.get_doc("Shelf", shelf_id)
		new_item = shelf_doc.append("items", {})
		new_item.bucket_id = self.bucket_id
		new_item.variety = "Reflex"
		new_item.stem_qty = 40
		new_item.farm = self.farm
		new_item.date_added = frappe.utils.now_datetime()
		shelf_doc.save(ignore_permissions=True)
		frappe.db.commit()

		from upande_quality.mobile.api import _write_shelved_log

		_write_shelved_log(new_item, shelf_id, self.farm)
		frappe.db.commit()

		log = frappe.get_all(
			"Shelving Log",
			filters={"bucket_id": self.bucket_id, "reason": "Shelved"},
			fields=["name", "shelf", "shelf_item", "shelved_by", "removed_on"],
		)
		self.assertEqual(len(log), 1)
		self.assertEqual(log[0].shelf, shelf_id)
		self.assertEqual(log[0].shelf_item, new_item.name)
		self.assertFalse(log[0].removed_on)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/jk/Projects/upande-local-bench-v16 && bench --site kaitet.local run-tests --app upande_quality --module upande_quality.tests.test_shelf_operations`

Expected: FAIL with `ImportError: cannot import name '_write_shelved_log'` (the helper doesn't exist yet).

- [ ] **Step 3: Add the `_write_shelved_log` helper and call it from `createShelvingEntry`**

In `/home/jk/Projects/upande-local-bench-v16/apps/upande_quality/upande_quality/mobile/api.py`, add this module-level helper function just above `def createShelvingEntry():` (currently at line 1291-1292, right after the `@frappe.whitelist()` decorator line — insert the helper *before* the decorator):

```python
def _write_shelved_log(shelf_item_row, shelf_id, farm):
    """Write a Shelving Log "Shelved" row for one just-created Shelf Item row.
    Called once per Shelf Item row a bucket produces (a bucket can carry
    several varieties/lengths). shelf_item_row must already have its `name`
    populated (i.e. called after the parent Shelf has been saved)."""
    frappe.get_doc({
        "doctype": "Shelving Log",
        "bucket_id": shelf_item_row.bucket_id,
        "shelf": shelf_id,
        "farm": farm,
        "variety": shelf_item_row.variety,
        "stem_length": shelf_item_row.stem_length,
        "stem_qty": shelf_item_row.stem_qty,
        "greenhouse": shelf_item_row.greenhouse,
        "warehouse": shelf_item_row.warehouse,
        "cut_stage": shelf_item_row.cut_stage,
        "harvest_date": shelf_item_row.harvest_date,
        "receiving_date": shelf_item_row.receiving_date,
        "harvester": shelf_item_row.harvester,
        "graded_by": shelf_item_row.graded_by,
        "grading_date": shelf_item_row.grading_date,
        "reason": "Shelved",
        "shelved_on": frappe.utils.now(),
        "shelved_by": frappe.session.user,
        "shelf_item": shelf_item_row.name,
    }).insert(ignore_permissions=True)
```

Then in `createShelvingEntry`'s main execution block, find (currently around line 1893-1917):
```python
                            # Add bucket to shelf
                            total_qty = 0
                            for ri in receiving_doc.items:
                                new_item = shelf_doc.append("items", {})
                                new_item.bucket_id = bucket_id
                                new_item.variety = ri.item_code
                                new_item.date_added = frappe.utils.now_datetime()
                                new_item.stem_length = ri.get("custom_stem_length") or stem_length
                                new_item.stem_qty = ri.qty
                                new_item.greenhouse = ri.s_warehouse
                                new_item.warehouse = warehouse_by_ri.get(ri.name, ri.t_warehouse)
                                new_item.cut_stage = receiving_doc.custom_cut_stage
                                new_item.harvest_date = harvest_date
                                new_item.receiving_date = recv_date
                                new_item.farm = farm
                                new_item.harvester = receiving_doc.custom_harvester
                                new_item.graded_by = receiving_doc.custom_graded_by
                                new_item.grading_date = receiving_doc.custom_grading_date
                                total_qty += (ri.qty or 0)
                            qty = total_qty

                            shelf_doc.save()

                            # Mark bucket as shelved in receiving entry
                            mark_bucket_as_shelved(bucket_id, receiving_doc, result)
```

Replace with (adds a `new_items` list to track the appended rows, and writes the log entries right after save):
```python
                            # Add bucket to shelf
                            total_qty = 0
                            new_items = []
                            for ri in receiving_doc.items:
                                new_item = shelf_doc.append("items", {})
                                new_item.bucket_id = bucket_id
                                new_item.variety = ri.item_code
                                new_item.date_added = frappe.utils.now_datetime()
                                new_item.stem_length = ri.get("custom_stem_length") or stem_length
                                new_item.stem_qty = ri.qty
                                new_item.greenhouse = ri.s_warehouse
                                new_item.warehouse = warehouse_by_ri.get(ri.name, ri.t_warehouse)
                                new_item.cut_stage = receiving_doc.custom_cut_stage
                                new_item.harvest_date = harvest_date
                                new_item.receiving_date = recv_date
                                new_item.farm = farm
                                new_item.harvester = receiving_doc.custom_harvester
                                new_item.graded_by = receiving_doc.custom_graded_by
                                new_item.grading_date = receiving_doc.custom_grading_date
                                total_qty += (ri.qty or 0)
                                new_items.append(new_item)
                            qty = total_qty

                            shelf_doc.save()

                            # Shelving Log: one "Shelved" row per Shelf Item row just created.
                            for new_item in new_items:
                                _write_shelved_log(new_item, shelf_id, farm)

                            # Mark bucket as shelved in receiving entry
                            mark_bucket_as_shelved(bucket_id, receiving_doc, result)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/jk/Projects/upande-local-bench-v16 && bench --site kaitet.local run-tests --app upande_quality --module upande_quality.tests.test_shelf_operations`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /home/jk/Projects/upande-local-bench-v16
git add apps/upande_quality/upande_quality/mobile/api.py apps/upande_quality/upande_quality/tests/
git commit -m "fix: write Shelving Log entry when a bucket is shelved (createShelvingEntry)"
```

---

### Task 3: Shelving Log gap fix — `shelveBucket` (upande_packhouse)

**Files:**
- Modify: `/home/jk/Projects/upande-local-bench-v16/apps/upande_packhouse/upande_packhouse/mobile/api.py:4425-4444`
- Test: `/home/jk/Projects/upande-local-bench-v16/apps/upande_packhouse/upande_packhouse/tests/test_shelf_operations.py` (new file)

**Interfaces:**
- Consumes: none from other tasks.
- Produces: same as Task 2, for buckets shelved via `shelveBucket` (the Flutter packhouse app's entry point) instead of `createShelvingEntry`.

- [ ] **Step 1: Write the failing test**

Create `/home/jk/Projects/upande-local-bench-v16/apps/upande_packhouse/upande_packhouse/tests/__init__.py` (empty, if the directory doesn't exist) and `/home/jk/Projects/upande-local-bench-v16/apps/upande_packhouse/upande_packhouse/tests/test_shelf_operations.py`:

```python
import frappe
from frappe.tests import IntegrationTestCase


class IntegrationTestShelfOperationsPackhouse(IntegrationTestCase):
	def setUp(self):
		self.farm = "Test Shelf Ops Farm"
		if not frappe.db.exists("Farm", self.farm):
			frappe.get_doc({
				"doctype": "Farm",
				"farm_name": self.farm,
				"company": "Karen Roses",
				"abbreviation": "TSOF",
				"farm_type": [{"farm_type": "Has Greenhouses"}],
			}).insert(ignore_permissions=True)
		self.bucket_id = "TEST-BUCKET-002"
		if not frappe.db.exists("Bucket QR Code", self.bucket_id):
			frappe.get_doc(
				{"doctype": "Bucket QR Code", "id": self.bucket_id, "item_code": "Reflex"}
			).insert(ignore_permissions=True)
		frappe.db.commit()

	def tearDown(self):
		frappe.db.delete("Shelving Log", {"bucket_id": self.bucket_id})
		frappe.db.delete("Shelf Item", {"bucket_id": self.bucket_id})
		frappe.db.commit()

	def test_shelve_bucket_writes_shelved_log_row(self):
		shelf_id = "TEST-SHELF-B"
		if not frappe.db.exists("Shelf", shelf_id):
			frappe.get_doc(
				{"doctype": "Shelf", "shelf_id": shelf_id, "farm": self.farm}
			).insert(ignore_permissions=True)

		shelf_doc = frappe.get_doc("Shelf", shelf_id)
		new_item = shelf_doc.append("items", {})
		new_item.bucket_id = self.bucket_id
		new_item.variety = "Reflex"
		new_item.stem_qty = 30
		new_item.farm = self.farm
		new_item.date_added = frappe.utils.now_datetime()
		shelf_doc.save(ignore_permissions=True)
		frappe.db.commit()

		from upande_packhouse.mobile.api import _write_shelved_log

		_write_shelved_log(new_item, shelf_id, self.farm)
		frappe.db.commit()

		log = frappe.get_all(
			"Shelving Log",
			filters={"bucket_id": self.bucket_id, "reason": "Shelved"},
			fields=["name", "shelf", "shelf_item", "shelved_by", "shelved_on"],
		)
		self.assertEqual(len(log), 1)
		self.assertEqual(log[0].shelf, shelf_id)
		self.assertEqual(log[0].shelf_item, new_item.name)
		self.assertEqual(log[0].shelved_by, frappe.session.user)
		self.assertTrue(log[0].shelved_on)

	def test_shelve_bucket_end_to_end_writes_shelved_log_row(self):
		"""Exercises the real shelveBucket() wiring (not just the extracted
		helper) -- the actual bug this task fixes. Same real preconditions
		shelveBucket enforces: a submitted Harvesting entry within 1 day of a
		submitted Receiving entry, both same-day so the staleness gate passes."""
		shelf_id = "TEST-SHELF-G"
		if not frappe.db.exists("Shelf", shelf_id):
			frappe.get_doc({"doctype": "Shelf", "shelf_id": shelf_id, "farm": self.farm}).insert(
				ignore_permissions=True
			)

		today = frappe.utils.today()
		harvest = frappe.get_doc({
			"doctype": "Stock Entry",
			"stock_entry_type": "Harvesting",
			"purpose": "Material Receipt",
			"company": "Karen Roses",
			"posting_date": today,
			"custom_bucket_id": self.bucket_id,
			"items": [{
				"item_code": "Reflex", "qty": 20, "t_warehouse": "Karen GH 04 - KR", "uom": "Stems",
				"allow_zero_valuation_rate": 1,
			}],
		})
		harvest.insert(ignore_permissions=True)
		harvest.submit()

		receiving = frappe.get_doc({
			"doctype": "Stock Entry",
			"stock_entry_type": "Receiving",
			"purpose": "Material Transfer",
			"company": "Karen Roses",
			"posting_date": today,
			"set_posting_time": 1,
			"custom_bucket_id": self.bucket_id,
			"items": [{
				"item_code": "Reflex", "qty": 20, "uom": "Stems",
				"s_warehouse": "Karen GH 04 - KR", "t_warehouse": "Karen Receiving Cold Store - KR",
				"custom_stem_length": "52cm", "allow_zero_valuation_rate": 1,
			}],
		})
		receiving.insert(ignore_permissions=True)
		receiving.submit()
		frappe.db.commit()

		from upande_packhouse.mobile.api import shelveBucket

		frappe.local.form_dict = frappe._dict({})
		frappe.request = frappe._dict(
			get_json=lambda: {"shelf_id": shelf_id, "bucket_id": self.bucket_id, "farm": self.farm}
		)
		frappe.response = frappe._dict()
		shelveBucket()

		self.assertEqual(frappe.response["data"]["status"], "success")

		logs = frappe.get_all(
			"Shelving Log",
			filters={"bucket_id": self.bucket_id, "reason": "Shelved"},
			fields=["shelf", "shelf_item", "shelved_by", "shelved_on", "removed_on"],
		)
		self.assertEqual(len(logs), 1)
		self.assertEqual(logs[0].shelf, shelf_id)
		self.assertTrue(logs[0].shelf_item)
		self.assertEqual(logs[0].shelved_by, frappe.session.user)
		self.assertTrue(logs[0].shelved_on)
		self.assertFalse(logs[0].removed_on)

		frappe.db.delete("Stock Entry", {"custom_bucket_id": self.bucket_id})
		frappe.db.commit()
```

Also add `frappe.db.delete("Stock Entry", {"custom_bucket_id": self.bucket_id})` to `tearDown`, before the existing two deletes, so a re-run doesn't collide with leftover submitted Stock Entries from the end-to-end test.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/jk/Projects/upande-local-bench-v16 && bench --site kaitet.local run-tests --app upande_packhouse --module upande_packhouse.tests.test_shelf_operations`

Expected: FAIL with `ImportError: cannot import name '_write_shelved_log'`.

- [ ] **Step 3: Add `_write_shelved_log` and call it from `shelveBucket`**

In `/home/jk/Projects/upande-local-bench-v16/apps/upande_packhouse/upande_packhouse/mobile/api.py`, add this helper just above `def shelveBucket():` (currently at line 4239):

```python
def _write_shelved_log(shelf_item_row, shelf_id, farm):
	"""Write a Shelving Log "Shelved" row for one just-created Shelf Item row.
	Called once per Shelf Item row a bucket produces (a bucket can carry
	several varieties/lengths). shelf_item_row must already have its `name`
	populated (i.e. called after the parent Shelf has been saved)."""
	frappe.get_doc({
		"doctype": "Shelving Log",
		"bucket_id": shelf_item_row.bucket_id,
		"shelf": shelf_id,
		"farm": farm,
		"variety": shelf_item_row.variety,
		"stem_length": shelf_item_row.stem_length,
		"stem_qty": shelf_item_row.stem_qty,
		"greenhouse": shelf_item_row.greenhouse,
		"warehouse": shelf_item_row.warehouse,
		"cut_stage": shelf_item_row.get("cut_stage"),
		"harvest_date": shelf_item_row.harvest_date,
		"receiving_date": shelf_item_row.receiving_date,
		"harvester": shelf_item_row.get("harvester"),
		"graded_by": shelf_item_row.get("graded_by"),
		"grading_date": shelf_item_row.get("grading_date"),
		"reason": "Shelved",
		"shelved_on": frappe.utils.now(),
		"shelved_by": frappe.session.user,
		"shelf_item": shelf_item_row.name,
	}).insert(ignore_permissions=True)
```

Then find (currently lines 4425-4444):
```python
	# ── SHELVE: one Shelf Item per received variety ──────────────────────────
	stem_length = receiving_doc.get("custom_stem_length")
	variety = receiving_doc.items[0].item_code if receiving_doc.items else None
	origin_greenhouse = receiving_doc.items[0].s_warehouse if receiving_doc.items else None
	shelf_doc.farm = farm
	total_qty = 0
	for ri in receiving_doc.items:
		new_item = shelf_doc.append("items", {})
		new_item.bucket_id = bucket_id
		new_item.variety = ri.item_code
		new_item.date_added = frappe.utils.now_datetime()
		new_item.stem_length = stem_length
		new_item.stem_qty = ri.qty
		new_item.greenhouse = ri.s_warehouse
		new_item.warehouse = ri.t_warehouse
		new_item.farm = farm
		new_item.harvest_date = harvest_date
		new_item.receiving_date = recv_date
		total_qty += ri.qty or 0
	shelf_doc.save(ignore_permissions=True)
```

Replace with:
```python
	# ── SHELVE: one Shelf Item per received variety ──────────────────────────
	stem_length = receiving_doc.get("custom_stem_length")
	variety = receiving_doc.items[0].item_code if receiving_doc.items else None
	origin_greenhouse = receiving_doc.items[0].s_warehouse if receiving_doc.items else None
	shelf_doc.farm = farm
	total_qty = 0
	new_items = []
	for ri in receiving_doc.items:
		new_item = shelf_doc.append("items", {})
		new_item.bucket_id = bucket_id
		new_item.variety = ri.item_code
		new_item.date_added = frappe.utils.now_datetime()
		new_item.stem_length = stem_length
		new_item.stem_qty = ri.qty
		new_item.greenhouse = ri.s_warehouse
		new_item.warehouse = ri.t_warehouse
		new_item.farm = farm
		new_item.harvest_date = harvest_date
		new_item.receiving_date = recv_date
		total_qty += ri.qty or 0
		new_items.append(new_item)
	shelf_doc.save(ignore_permissions=True)

	# Shelving Log: one "Shelved" row per Shelf Item row just created.
	for new_item in new_items:
		_write_shelved_log(new_item, shelf_id, farm)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/jk/Projects/upande-local-bench-v16 && bench --site kaitet.local run-tests --app upande_packhouse --module upande_packhouse.tests.test_shelf_operations`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /home/jk/Projects/upande-local-bench-v16
git add apps/upande_packhouse/upande_packhouse/mobile/api.py apps/upande_packhouse/upande_packhouse/tests/
git commit -m "fix: write Shelving Log entry when a bucket is shelved (shelveBucket)"
```

---

### Task 4: `transferBucket` endpoint

**Files:**
- Modify: `/home/jk/Projects/upande-local-bench-v16/apps/upande_quality/upande_quality/mobile/api.py` (append new function at end of file)
- Test: `/home/jk/Projects/upande-local-bench-v16/apps/upande_quality/upande_quality/tests/test_shelf_operations.py` (extend from Task 2)

**Interfaces:**
- Consumes: `_write_shelved_log(shelf_item_row, shelf_id, farm)` from Task 2 (same file).
- Produces: whitelisted `transferBucket()` reading `frappe.request.get_json()` for `{"bucket_id": str, "to_shelf_id": str}`, writing `frappe.response["data"]` per the Global Constraints response shape. On success, `payload` includes `bucket_id`, `from_shelf_id`, `to_shelf_id`, `stems` (int), `synced_opls` (list of Order Pick List names), `bas_updated` (list of Bucket Allocation Status names).

- [ ] **Step 1: Write the failing tests**

Append to `/home/jk/Projects/upande-local-bench-v16/apps/upande_quality/upande_quality/tests/test_shelf_operations.py`, inside `IntegrationTestShelfOperations` (same class as Task 2):

```python
	def test_transfer_moves_shelf_item_and_writes_log(self):
		shelf_a = "TEST-SHELF-A"
		shelf_b = "TEST-SHELF-C"
		for sid in (shelf_a, shelf_b):
			if not frappe.db.exists("Shelf", sid):
				frappe.get_doc({"doctype": "Shelf", "shelf_id": sid, "farm": self.farm}).insert(
					ignore_permissions=True
				)

		shelf_doc = frappe.get_doc("Shelf", shelf_a)
		item = shelf_doc.append("items", {})
		item.bucket_id = self.bucket_id
		item.variety = "Reflex"
		item.stem_qty = 25
		item.farm = self.farm
		item.date_added = frappe.utils.now_datetime()
		shelf_doc.save(ignore_permissions=True)
		frappe.db.commit()

		from upande_quality.mobile.api import _write_shelved_log

		_write_shelved_log(item, shelf_a, self.farm)
		frappe.db.commit()

		from upande_quality.mobile.api import transferBucket

		frappe.local.form_dict = frappe._dict({})
		frappe.request = frappe._dict(
			get_json=lambda: {"bucket_id": self.bucket_id, "to_shelf_id": shelf_b}
		)
		frappe.response = frappe._dict()
		transferBucket()

		self.assertEqual(frappe.response["data"]["status"], "success")
		remaining_on_a = frappe.get_all("Shelf Item", filters={"parent": shelf_a, "bucket_id": self.bucket_id})
		on_b = frappe.get_all(
			"Shelf Item", filters={"parent": shelf_b, "bucket_id": self.bucket_id}, fields=["stem_qty"]
		)
		self.assertEqual(len(remaining_on_a), 0)
		self.assertEqual(len(on_b), 1)
		self.assertEqual(on_b[0].stem_qty, 25)

		logs = frappe.get_all(
			"Shelving Log",
			filters={"bucket_id": self.bucket_id},
			fields=["reason", "shelf", "removed_on"],
			order_by="creation asc",
		)
		self.assertEqual(len(logs), 2)
		self.assertEqual(logs[0].reason, "Transferred (Shelf-to-Shelf)")
		self.assertTrue(logs[0].removed_on)
		self.assertEqual(logs[1].reason, "Shelved")
		self.assertEqual(logs[1].shelf, shelf_b)
		self.assertFalse(logs[1].removed_on)

	def test_transfer_syncs_unissued_pick_list_item_shelf(self):
		shelf_a = "TEST-SHELF-A"
		shelf_e = "TEST-SHELF-E"
		for sid in (shelf_a, shelf_e):
			if not frappe.db.exists("Shelf", sid):
				frappe.get_doc({"doctype": "Shelf", "shelf_id": sid, "farm": self.farm}).insert(
					ignore_permissions=True
				)

		shelf_doc = frappe.get_doc("Shelf", shelf_a)
		item = shelf_doc.append("items", {})
		item.bucket_id = self.bucket_id
		item.variety = "Reflex"
		item.stem_qty = 20
		item.farm = self.farm
		item.date_added = frappe.utils.now_datetime()
		shelf_doc.save(ignore_permissions=True)

		opl = frappe.get_doc(
			{
				"doctype": "Order Pick List",
				"naming_series": "OPL-.YYYY.-",
				"farm": self.farm,
				"table_ytkc": [
					{"item_code": "Reflex", "bucket": self.bucket_id, "shelf": shelf_a,
					 "issued": 0, "qty": 20},
					{"item_code": "Reflex", "bucket": self.bucket_id, "shelf": shelf_a,
					 "issued": 1, "qty": 5},
				],
			}
		)
		opl.insert(ignore_permissions=True)
		unissued_row, issued_row = opl.table_ytkc[0].name, opl.table_ytkc[1].name
		frappe.db.commit()

		from upande_quality.mobile.api import transferBucket

		frappe.request = frappe._dict(
			get_json=lambda: {"bucket_id": self.bucket_id, "to_shelf_id": shelf_e}
		)
		frappe.response = frappe._dict()
		transferBucket()

		self.assertEqual(frappe.response["data"]["status"], "success")
		self.assertIn(opl.name, frappe.response["data"]["payload"]["synced_opls"])
		self.assertEqual(frappe.db.get_value("Pick List Item", unissued_row, "shelf"), shelf_e)
		# Already-issued row is left alone -- issuing already happened, its
		# shelf value is moot.
		self.assertEqual(frappe.db.get_value("Pick List Item", issued_row, "shelf"), shelf_a)

		frappe.delete_doc("Order Pick List", opl.name, force=1, ignore_permissions=True)

	def test_transfer_rejects_cross_farm(self):
		shelf_a = "TEST-SHELF-A"
		other_farm = "Test Shelf Ops Farm 2"
		if not frappe.db.exists("Farm", other_farm):
			frappe.get_doc({
				"doctype": "Farm",
				"farm_name": other_farm,
				"company": "Karen Roses",
				"abbreviation": "TSOF2",
				"farm_type": [{"farm_type": "Has Greenhouses"}],
			}).insert(ignore_permissions=True)
		shelf_d = "TEST-SHELF-D"
		if not frappe.db.exists("Shelf", shelf_d):
			frappe.get_doc({"doctype": "Shelf", "shelf_id": shelf_d, "farm": other_farm}).insert(
				ignore_permissions=True
			)
		if not frappe.db.exists("Shelf", shelf_a):
			frappe.get_doc({"doctype": "Shelf", "shelf_id": shelf_a, "farm": self.farm}).insert(
				ignore_permissions=True
			)

		shelf_doc = frappe.get_doc("Shelf", shelf_a)
		item = shelf_doc.append("items", {})
		item.bucket_id = self.bucket_id
		item.variety = "Reflex"
		item.stem_qty = 10
		item.farm = self.farm
		item.date_added = frappe.utils.now_datetime()
		shelf_doc.save(ignore_permissions=True)
		frappe.db.commit()

		from upande_quality.mobile.api import transferBucket

		frappe.request = frappe._dict(
			get_json=lambda: {"bucket_id": self.bucket_id, "to_shelf_id": shelf_d}
		)
		frappe.response = frappe._dict()
		transferBucket()

		self.assertEqual(frappe.response["data"]["status"], "failed")
		self.assertEqual(frappe.response["data"]["reason"], "cross_farm_not_allowed")
		still_on_a = frappe.get_all("Shelf Item", filters={"parent": shelf_a, "bucket_id": self.bucket_id})
		self.assertEqual(len(still_on_a), 1)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/jk/Projects/upande-local-bench-v16 && bench --site kaitet.local run-tests --app upande_quality --module upande_quality.tests.test_shelf_operations`

Expected: FAIL with `ImportError: cannot import name 'transferBucket'`.

- [ ] **Step 3: Implement `transferBucket`**

Append to the end of `/home/jk/Projects/upande-local-bench-v16/apps/upande_quality/upande_quality/mobile/api.py`:

```python
@frappe.whitelist()
def transferBucket():
    """Move a bucket from its current shelf to another shelf on the SAME farm,
    re-syncing every place a bucket's location is cached for an existing order
    (Pick List Item.shelf, Bucket Allocation Status.shelf_location/shelf_farm)
    so a draft OPL never points a picker at a shelf the bucket has since left.
    Cross-farm moves are NOT handled here -- that's the separate truck-transfer
    flow (awaiting_transfer/in_transit/loaded_in_trolley on Pick List Item).
    A bucket moves as one physical unit: every Shelf Item row it has (one per
    variety/length) moves together."""
    data = frappe.request.get_json() or {}
    bucket_id = data.get("bucket_id")
    to_shelf_id = data.get("to_shelf_id")

    if not bucket_id:
        frappe.response["data"] = {
            "status": "failed",
            "reason": "bucket_id_not_null",
            "message": "Bucket ID is missing.",
            "payload": {},
        }
        return
    if not to_shelf_id:
        frappe.response["data"] = {
            "status": "failed",
            "reason": "to_shelf_id_not_null",
            "message": "Destination shelf ID is missing.",
            "payload": {"bucket_id": bucket_id},
        }
        return

    source_items = frappe.get_all(
        "Shelf Item",
        filters={"bucket_id": bucket_id},
        fields=[
            "name", "parent", "variety", "greenhouse", "warehouse", "stem_qty",
            "stem_length", "cut_stage", "harvest_date", "receiving_date", "farm",
            "harvester", "graded_by", "grading_date",
        ],
    )
    if not source_items:
        frappe.response["data"] = {
            "status": "failed",
            "reason": "not_on_shelf",
            "message": "This bucket is not currently on any shelf.",
            "payload": {"bucket_id": bucket_id},
        }
        return

    from_shelf_id = source_items[0].parent

    if from_shelf_id == to_shelf_id:
        frappe.response["data"] = {
            "status": "failed",
            "reason": "same_shelf",
            "message": "The bucket is already on shelf {0}.".format(to_shelf_id),
            "payload": {"bucket_id": bucket_id, "shelf_id": to_shelf_id},
        }
        return

    if not frappe.db.exists("Shelf", to_shelf_id):
        frappe.response["data"] = {
            "status": "failed",
            "reason": "destination_not_found",
            "message": "Shelf {0} does not exist.".format(to_shelf_id),
            "payload": {"bucket_id": bucket_id, "to_shelf_id": to_shelf_id},
        }
        return

    from_farm = frappe.db.get_value("Shelf", from_shelf_id, "farm")
    to_farm = frappe.db.get_value("Shelf", to_shelf_id, "farm")
    if from_farm != to_farm:
        frappe.response["data"] = {
            "status": "failed",
            "reason": "cross_farm_not_allowed",
            "message": "Cannot transfer from {0} ({1}) to {2} ({3}) -- shelf-to-shelf "
            "transfer only works within the same farm.".format(
                from_shelf_id, from_farm, to_shelf_id, to_farm
            ),
            "payload": {
                "bucket_id": bucket_id,
                "from_shelf_id": from_shelf_id,
                "from_farm": from_farm,
                "to_shelf_id": to_shelf_id,
                "to_farm": to_farm,
            },
        }
        return

    mid_transfer = frappe.db.sql(
        """
        SELECT pli.name FROM `tabPick List Item` pli
        JOIN `tabOrder Pick List` opl ON opl.name = pli.parent AND opl.docstatus = 0
        WHERE pli.parenttype = 'Order Pick List' AND pli.bucket = %s
          AND (pli.awaiting_transfer = 1 OR pli.in_transit = 1
               OR pli.loaded_in_trolley = 1) LIMIT 1""",
        bucket_id,
        as_dict=True,
    )
    if mid_transfer:
        frappe.response["data"] = {
            "status": "failed",
            "reason": "mid_truck_transfer",
            "message": "This bucket is mid inter-farm transfer and can't be moved "
            "between shelves right now.",
            "payload": {"bucket_id": bucket_id},
        }
        return

    to_shelf = frappe.get_doc("Shelf", to_shelf_id)
    existing_buckets = {(it.bucket_id or "").lower() for it in (to_shelf.items or [])}
    existing_buckets.discard(bucket_id.lower())
    if len(existing_buckets) >= 2:
        frappe.response["data"] = {
            "status": "failed",
            "reason": "two_buckets_per_shelf",
            "message": "The destination shelf is full.",
            "payload": {"bucket_id": bucket_id, "to_shelf_id": to_shelf_id},
        }
        return

    total_qty = 0
    new_items = []
    for src in source_items:
        new_item = to_shelf.append("items", {})
        new_item.bucket_id = bucket_id
        new_item.variety = src.variety
        new_item.greenhouse = src.greenhouse
        new_item.warehouse = src.warehouse
        new_item.stem_qty = src.stem_qty
        new_item.stem_length = src.stem_length
        new_item.date_added = frappe.utils.now_datetime()
        new_item.cut_stage = src.cut_stage
        new_item.harvest_date = src.harvest_date
        new_item.receiving_date = src.receiving_date
        new_item.farm = src.farm
        new_item.harvester = src.harvester
        new_item.graded_by = src.graded_by
        new_item.grading_date = src.grading_date
        new_items.append(new_item)
        total_qty += src.stem_qty or 0
    to_shelf.save(ignore_permissions=True)

    for src in source_items:
        frappe.delete_doc("Shelf Item", src.name, force=1, ignore_permissions=True)
    frappe.db.set_value("Shelf", from_shelf_id, "modified", frappe.utils.now())

    # Sync every not-yet-issued Pick List Item pointing at this bucket -- an
    # issued row's shelf is already moot, issuing already happened. Uses a raw
    # field update (not load-doc-then-save) because the parent Order Pick List
    # may already be submitted (a partially-picked order) and `shelf` has no
    # allow_on_submit flag -- loading the doc and calling .save() on it would
    # throw on a submitted OPL even with ignore_permissions=True, since that
    # only bypasses permission checks, not the submit-lock field validation.
    pli_rows = frappe.get_all(
        "Pick List Item", filters={"bucket": bucket_id, "issued": 0}, fields=["name", "parent"]
    )
    synced_opls = []
    for row in pli_rows:
        frappe.db.set_value("Pick List Item", row.name, "shelf", to_shelf_id, update_modified=False)
        synced_opls.append(row.parent)
    synced_opls = sorted(set(synced_opls))

    # Sync Bucket Allocation Status shelf fields, if a row exists per variety.
    bas_updated = []
    for src in source_items:
        bas_name = frappe.db.get_value(
            "Bucket Allocation Status", {"bucket_id": bucket_id, "item_code": src.variety}, "name"
        )
        if bas_name:
            frappe.db.set_value(
                "Bucket Allocation Status", bas_name,
                {"shelf_location": to_shelf_id, "shelf_farm": to_farm},
                update_modified=False,
            )
            bas_updated.append(bas_name)

    # Shelving Log: close the row this Shelf Item row opened (correlated by
    # shelf_item name), open a new "Shelved" row for the destination.
    for i, src in enumerate(source_items):
        open_log = frappe.db.get_value(
            "Shelving Log",
            {"shelf_item": src.name, "reason": "Shelved", "removed_on": ["is", "not set"]},
            "name",
        )
        if open_log:
            frappe.db.set_value(
                "Shelving Log", open_log,
                {"removed_on": frappe.utils.now(), "reason": "Transferred (Shelf-to-Shelf)"},
                update_modified=False,
            )
        frappe.get_doc({
            "doctype": "Shelving Log",
            "bucket_id": bucket_id,
            "shelf": to_shelf_id,
            "farm": to_farm,
            "variety": src.variety,
            "stem_length": src.stem_length,
            "stem_qty": src.stem_qty,
            "greenhouse": src.greenhouse,
            "warehouse": src.warehouse,
            "cut_stage": src.cut_stage,
            "harvest_date": src.harvest_date,
            "receiving_date": src.receiving_date,
            "harvester": src.harvester,
            "graded_by": src.graded_by,
            "grading_date": src.grading_date,
            "reason": "Shelved",
            "shelved_on": frappe.utils.now(),
            "shelved_by": frappe.session.user,
            "shelf_item": new_items[i].name,
        }).insert(ignore_permissions=True)

    frappe.db.commit()
    frappe.response["data"] = {
        "status": "success",
        "message": "Bucket {0} moved from {1} to {2} ({3} stems).".format(
            bucket_id, from_shelf_id, to_shelf_id, total_qty
        ),
        "payload": {
            "bucket_id": bucket_id,
            "from_shelf_id": from_shelf_id,
            "to_shelf_id": to_shelf_id,
            "stems": total_qty,
            "synced_opls": synced_opls,
            "bas_updated": bas_updated,
        },
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/jk/Projects/upande-local-bench-v16 && bench --site kaitet.local run-tests --app upande_quality --module upande_quality.tests.test_shelf_operations`

Expected: all PASS (Task 2's test plus the two new ones).

- [ ] **Step 5: Commit**

```bash
cd /home/jk/Projects/upande-local-bench-v16
git add apps/upande_quality/upande_quality/mobile/api.py apps/upande_quality/upande_quality/tests/test_shelf_operations.py
git commit -m "feat: add transferBucket endpoint for shelf-to-shelf bucket moves"
```

---

### Task 5: `createOfflineIssuingEntry` endpoint

**Files:**
- Modify: `/home/jk/Projects/upande-local-bench-v16/apps/upande_quality/upande_quality/mobile/api.py` (append new function at end of file)
- Test: `/home/jk/Projects/upande-local-bench-v16/apps/upande_quality/upande_quality/tests/test_shelf_operations.py` (extend from Task 4)

**Interfaces:**
- Consumes: `_write_shelved_log` is NOT reused here (this operation closes logs, it doesn't open new ones) — no cross-task function dependency.
- Produces: whitelisted `createOfflineIssuingEntry()` reading `{"bucket_id": str, "reason": str}`, same response shape. On success, `payload` includes `bucket_id`, `stems` (int), `stock_entry` (Stock Entry name).

- [ ] **Step 1: Write the failing tests**

Append to `IntegrationTestShelfOperations` in the same test file:

```python
	def test_offline_issuing_creates_stock_entry_and_clears_shelf(self):
		shelf_a = "TEST-SHELF-A"
		if not frappe.db.exists("Shelf", shelf_a):
			frappe.get_doc({"doctype": "Shelf", "shelf_id": shelf_a, "farm": self.farm}).insert(
				ignore_permissions=True
			)
		if not frappe.db.exists("Warehouse", "Test Shelf Ops WH - TSO"):
			frappe.get_doc(
				{
					"doctype": "Warehouse",
					"warehouse_name": "Test Shelf Ops WH",
					"company": "Karen Roses",
				}
			).insert(ignore_permissions=True)
		warehouse = frappe.get_all("Warehouse", filters={"warehouse_name": "Test Shelf Ops WH"}, pluck="name")[0]

		shelf_doc = frappe.get_doc("Shelf", shelf_a)
		item = shelf_doc.append("items", {})
		item.bucket_id = self.bucket_id
		item.variety = "Reflex"
		item.stem_qty = 15
		item.farm = self.farm
		item.warehouse = warehouse
		item.date_added = frappe.utils.now_datetime()
		shelf_doc.save(ignore_permissions=True)
		frappe.db.commit()

		from upande_quality.mobile.api import _write_shelved_log

		_write_shelved_log(item, shelf_a, self.farm)
		frappe.db.commit()

		from upande_quality.mobile.api import createOfflineIssuingEntry

		frappe.request = frappe._dict(
			get_json=lambda: {"bucket_id": self.bucket_id, "reason": "Damaged in transit"}
		)
		frappe.response = frappe._dict()
		createOfflineIssuingEntry()

		self.assertEqual(frappe.response["data"]["status"], "success")
		stock_entry_name = frappe.response["data"]["payload"]["stock_entry"]
		se = frappe.get_doc("Stock Entry", stock_entry_name)
		self.assertEqual(se.stock_entry_type, "Offline Issuing")
		self.assertEqual(se.docstatus, 1)
		self.assertEqual(se.remarks, "Damaged in transit")

		remaining = frappe.get_all("Shelf Item", filters={"bucket_id": self.bucket_id})
		self.assertEqual(len(remaining), 0)

		log = frappe.get_all(
			"Shelving Log",
			filters={"bucket_id": self.bucket_id, "reason": "Offline Issuing"},
			fields=["removed_on"],
		)
		self.assertEqual(len(log), 1)
		self.assertTrue(log[0].removed_on)

	def test_offline_issuing_blocked_when_allocated(self):
		shelf_a = "TEST-SHELF-A"
		if not frappe.db.exists("Shelf", shelf_a):
			frappe.get_doc({"doctype": "Shelf", "shelf_id": shelf_a, "farm": self.farm}).insert(
				ignore_permissions=True
			)
		shelf_doc = frappe.get_doc("Shelf", shelf_a)
		item = shelf_doc.append("items", {})
		item.bucket_id = self.bucket_id
		item.variety = "Reflex"
		item.stem_qty = 15
		item.farm = self.farm
		item.date_added = frappe.utils.now_datetime()
		shelf_doc.save(ignore_permissions=True)

		bas = frappe.get_doc(
			{
				"doctype": "Bucket Allocation Status",
				"bucket_id": self.bucket_id,
				"item_code": "Reflex",
				"total_quantity": 15,
				"allocated_quantity": 15,
				"available_quantity": 0,
				"bucket_allocations": [
					{"sales_order": "SAL-ORD-TEST-0001", "sales_order_item": "row1",
					 "quantity_allocated": 15, "cancelled": 0, "issued": 0}
				],
			}
		)
		bas.insert(ignore_permissions=True)
		frappe.db.commit()

		from upande_quality.mobile.api import createOfflineIssuingEntry

		frappe.request = frappe._dict(
			get_json=lambda: {"bucket_id": self.bucket_id, "reason": "Damaged"}
		)
		frappe.response = frappe._dict()
		createOfflineIssuingEntry()

		self.assertEqual(frappe.response["data"]["status"], "failed")
		self.assertEqual(frappe.response["data"]["reason"], "bucket_allocated")
		self.assertIn("SAL-ORD-TEST-0001", frappe.response["data"]["message"])
		still_on_shelf = frappe.get_all("Shelf Item", filters={"bucket_id": self.bucket_id})
		self.assertEqual(len(still_on_shelf), 1)

		bas.delete(ignore_permissions=True)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/jk/Projects/upande-local-bench-v16 && bench --site kaitet.local run-tests --app upande_quality --module upande_quality.tests.test_shelf_operations`

Expected: FAIL with `ImportError: cannot import name 'createOfflineIssuingEntry'`.

- [ ] **Step 3: Implement `createOfflineIssuingEntry`**

Append to the end of `/home/jk/Projects/upande-local-bench-v16/apps/upande_quality/upande_quality/mobile/api.py`:

```python
@frappe.whitelist()
def createOfflineIssuingEntry():
    """Report that a bucket was physically removed from its shelf for a reason
    other than a normal sales issue or a Discard-Request-driven discard (e.g.
    damage, quality hold, internal use). Posts a real stock-ledger movement
    (Stock Entry Type "Offline Issuing") from the CURRENT Shelf Item quantities
    (not the original receiving quantities -- a bucket may already have been
    partially issued), then clears the shelf and closes the Shelving Log.
    Blocked outright if the bucket is currently allocated to a sales order --
    use normal issuing for that instead."""
    data = frappe.request.get_json() or {}
    bucket_id = data.get("bucket_id")
    reason = (data.get("reason") or "").strip()

    if not bucket_id:
        frappe.response["data"] = {
            "status": "failed",
            "reason": "bucket_id_not_null",
            "message": "Bucket ID is missing.",
            "payload": {},
        }
        return
    if not reason:
        frappe.response["data"] = {
            "status": "failed",
            "reason": "reason_not_null",
            "message": "A reason is required to report an offline removal.",
            "payload": {"bucket_id": bucket_id},
        }
        return

    shelf_items = frappe.get_all(
        "Shelf Item",
        filters={"bucket_id": bucket_id},
        fields=["name", "parent", "variety", "greenhouse", "warehouse", "stem_qty", "stem_length", "farm"],
    )
    if not shelf_items:
        frappe.response["data"] = {
            "status": "failed",
            "reason": "not_on_shelf",
            "message": "This bucket is not currently on any shelf.",
            "payload": {"bucket_id": bucket_id},
        }
        return

    allocated_orders = set()
    for si in shelf_items:
        bas_name = frappe.db.get_value(
            "Bucket Allocation Status", {"bucket_id": bucket_id, "item_code": si.variety}, "name"
        )
        if not bas_name:
            continue
        bas_doc = frappe.get_doc("Bucket Allocation Status", bas_name)
        if (bas_doc.allocated_quantity or 0) > 0:
            for row in bas_doc.bucket_allocations:
                if not row.cancelled and not row.issued and row.sales_order:
                    allocated_orders.add(row.sales_order)
    if allocated_orders:
        frappe.response["data"] = {
            "status": "failed",
            "reason": "bucket_allocated",
            "message": "This bucket is allocated to order(s) {0} -- use normal issuing "
            "instead of an offline removal report.".format(", ".join(sorted(allocated_orders))),
            "payload": {"bucket_id": bucket_id, "sales_orders": sorted(allocated_orders)},
        }
        return

    # frappe.defaults.get_global_default("company") is unreliable -- this site
    # has no Global Defaults.default_company configured, so it silently
    # returns None (Stock Entry then fails validation on submit). Deriving
    # from the shelf item's own Farm is more correct anyway (multi-company
    # safe) and always set, since every Shelf Item carries its farm.
    entry = frappe.new_doc("Stock Entry")
    entry.stock_entry_type = "Offline Issuing"
    entry.purpose = "Material Issue"
    entry.company = frappe.db.get_value("Farm", shelf_items[0].farm, "company")
    entry.posting_date = frappe.utils.now_datetime().date()
    entry.posting_time = frappe.utils.now_datetime().time()
    entry.set_posting_time = 1
    entry.custom_bucket_id = bucket_id
    entry.remarks = reason
    entry.from_warehouse = shelf_items[0].warehouse

    total_qty = 0
    for si in shelf_items:
        item_meta = frappe.db.get_value(
            "Item", si.variety, ["item_name", "description", "item_group", "stock_uom"], as_dict=True
        )
        recv_row = frappe.db.sql(
            """
            SELECT sed.expense_account, sed.cost_center
            FROM `tabStock Entry Detail` sed
            JOIN `tabStock Entry` se ON se.name = sed.parent
            WHERE se.stock_entry_type IN ('Receiving', 'Late Receipt')
              AND se.custom_bucket_id = %s AND se.docstatus = 1
              AND sed.item_code = %s
            ORDER BY se.creation DESC LIMIT 1
            """,
            (bucket_id, si.variety),
            as_dict=True,
        )
        row = entry.append("items", {})
        row.item_code = si.variety
        row.item_name = item_meta.item_name if item_meta else si.variety
        row.description = item_meta.description if item_meta else None
        row.item_group = item_meta.item_group if item_meta else None
        row.qty = si.stem_qty
        row.uom = item_meta.stock_uom if item_meta else None
        row.stock_uom = item_meta.stock_uom if item_meta else None
        row.conversion_factor = 1
        row.s_warehouse = si.warehouse
        row.allow_zero_valuation_rate = 1
        if recv_row:
            row.expense_account = recv_row[0].expense_account
            row.cost_center = recv_row[0].cost_center
        total_qty += si.stem_qty or 0

    entry.insert(ignore_permissions=True)
    entry.submit()

    for si in shelf_items:
        frappe.delete_doc("Shelf Item", si.name, force=1, ignore_permissions=True)
        frappe.db.set_value("Shelf", si.parent, "modified", frappe.utils.now())

    for si in shelf_items:
        open_log = frappe.db.get_value(
            "Shelving Log",
            {"shelf_item": si.name, "reason": "Shelved", "removed_on": ["is", "not set"]},
            "name",
        )
        if open_log:
            frappe.db.set_value(
                "Shelving Log", open_log,
                {"removed_on": frappe.utils.now(), "reason": "Offline Issuing"},
                update_modified=False,
            )

    frappe.db.commit()
    frappe.response["data"] = {
        "status": "success",
        "message": "Bucket {0} reported removed offline ({1} stems). Stock entry {2}.".format(
            bucket_id, total_qty, entry.name
        ),
        "payload": {"bucket_id": bucket_id, "stems": total_qty, "stock_entry": entry.name},
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/jk/Projects/upande-local-bench-v16 && bench --site kaitet.local run-tests --app upande_quality --module upande_quality.tests.test_shelf_operations`

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
cd /home/jk/Projects/upande-local-bench-v16
git add apps/upande_quality/upande_quality/mobile/api.py apps/upande_quality/upande_quality/tests/test_shelf_operations.py
git commit -m "feat: add createOfflineIssuingEntry endpoint for offline bucket removal"
```

---

### Task 6: Mobile API layer — `karen-shelf-operations-api.ts`

**Files:**
- Create: `/home/jk/Projects/upande-quality/src/tenants/karen/api/karen-shelf-operations-api.ts`

**Interfaces:**
- Produces: `RawTransferPayload`, `RawTransferResponse`, `RawOfflineIssuingPayload`, `RawOfflineIssuingResponse` types; `karenShelfOperationsApi.transferBucket(args: {bucketId: string; toShelfId: string}): Promise<RawTransferResponse>`; `karenShelfOperationsApi.reportOfflineRemoval(args: {bucketId: string; reason: string}): Promise<RawOfflineIssuingResponse>`.

- [ ] **Step 1: Write the file**

```typescript
import { api } from '@/src/core/api/client';

export type TransferReason =
  | 'bucket_id_not_null'
  | 'to_shelf_id_not_null'
  | 'not_on_shelf'
  | 'same_shelf'
  | 'destination_not_found'
  | 'cross_farm_not_allowed'
  | 'mid_truck_transfer'
  | 'two_buckets_per_shelf'
  | 'unknown_error';

export type RawTransferPayload = {
  bucket_id?: string;
  from_shelf_id?: string;
  to_shelf_id?: string;
  shelf_id?: string;
  from_farm?: string;
  to_farm?: string;
  stems?: number;
  synced_opls?: string[];
  bas_updated?: string[];
};

export type RawTransferResponse = {
  status?: 'success' | 'failed' | 'error' | string;
  reason?: TransferReason | string;
  message?: string;
  payload?: RawTransferPayload;
};

export type OfflineIssuingReason =
  | 'bucket_id_not_null'
  | 'reason_not_null'
  | 'not_on_shelf'
  | 'bucket_allocated'
  | 'unknown_error';

export type RawOfflineIssuingPayload = {
  bucket_id?: string;
  stems?: number;
  stock_entry?: string;
  sales_orders?: string[];
};

export type RawOfflineIssuingResponse = {
  status?: 'success' | 'failed' | 'error' | string;
  reason?: OfflineIssuingReason | string;
  message?: string;
  payload?: RawOfflineIssuingPayload;
};

export const karenShelfOperationsApi = {
  /** POST /api/method/upande_quality.mobile.api.transferBucket */
  async transferBucket(args: { bucketId: string; toShelfId: string }): Promise<RawTransferResponse> {
    const res = await api<{ data?: RawTransferResponse } | RawTransferResponse>({
      method: 'POST',
      url: '/api/method/upande_quality.mobile.api.transferBucket',
      data: { bucket_id: args.bucketId, to_shelf_id: args.toShelfId },
      validateStatus: () => true,
    });
    const unwrapped = res as { data?: RawTransferResponse } & RawTransferResponse;
    return unwrapped.data ?? unwrapped;
  },

  /** POST /api/method/upande_quality.mobile.api.createOfflineIssuingEntry */
  async reportOfflineRemoval(args: {
    bucketId: string;
    reason: string;
  }): Promise<RawOfflineIssuingResponse> {
    const res = await api<{ data?: RawOfflineIssuingResponse } | RawOfflineIssuingResponse>({
      method: 'POST',
      url: '/api/method/upande_quality.mobile.api.createOfflineIssuingEntry',
      data: { bucket_id: args.bucketId, reason: args.reason },
      validateStatus: () => true,
    });
    const unwrapped = res as { data?: RawOfflineIssuingResponse } & RawOfflineIssuingResponse;
    return unwrapped.data ?? unwrapped;
  },
};
```

- [ ] **Step 2: Type-check**

Run: `cd /home/jk/Projects/upande-quality && npx tsc --noEmit`

Expected: no new errors referencing `karen-shelf-operations-api.ts`.

- [ ] **Step 3: Commit**

```bash
cd /home/jk/Projects/upande-quality
git add src/tenants/karen/api/karen-shelf-operations-api.ts
git commit -m "feat: add API layer for Shelf Operations (transfer, offline removal)"
```

---

### Task 7: Mobile repository layer — `karen-shelf-operations-repository.ts`

**Files:**
- Create: `/home/jk/Projects/upande-quality/src/tenants/karen/repository/karen-shelf-operations-repository.ts`

**Interfaces:**
- Consumes: `karenShelfOperationsApi` from Task 6.
- Produces: `TransferOutcome` (`TransferSuccess | TransferFailure | TransferError`), `OfflineIssuingOutcome` (`OfflineIssuingSuccess | OfflineIssuingFailure | OfflineIssuingError`) unions; `karenShelfOperationsRepository.extractShelfIdFromScan(raw)`, `.extractBucketIdFromScan(raw)` (same QR parsing rules as shelving), `.transfer(args)`, `.reportOfflineRemoval(args)`.

- [ ] **Step 1: Write the file**

```typescript
import {
  karenShelfOperationsApi,
  type RawTransferPayload,
  type RawTransferResponse,
  type RawOfflineIssuingPayload,
  type RawOfflineIssuingResponse,
} from '../api/karen-shelf-operations-api';

export type TransferSuccess = {
  kind: 'success';
  bucketId: string;
  fromShelfId: string;
  toShelfId: string;
  stems: number | null;
  syncedOpls: string[];
  message: string;
};

export type TransferFailure = {
  kind: 'failure';
  bucketId: string;
  reason: string;
  message: string;
  payload: RawTransferPayload | null;
};

export type TransferError = { kind: 'error'; message: string };

export type TransferOutcome = TransferSuccess | TransferFailure | TransferError;

export type OfflineIssuingSuccess = {
  kind: 'success';
  bucketId: string;
  stems: number | null;
  stockEntry: string | null;
  message: string;
};

export type OfflineIssuingFailure = {
  kind: 'failure';
  bucketId: string;
  reason: string;
  message: string;
  payload: RawOfflineIssuingPayload | null;
};

export type OfflineIssuingError = { kind: 'error'; message: string };

export type OfflineIssuingOutcome = OfflineIssuingSuccess | OfflineIssuingFailure | OfflineIssuingError;

function pickMessage(raw: { message?: string }, fallback: string): string {
  return raw.message?.trim() || fallback;
}

export const karenShelfOperationsRepository = {
  /** Shelf QR is `{"shelf": "<id>"}` -- same shape shelving already uses. */
  extractShelfIdFromScan(raw: string): string | null {
    const text = raw.trim();
    if (!text.startsWith('{') || !text.endsWith('}')) return null;
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === 'object') {
        const shelf = (parsed as Record<string, unknown>)['shelf'];
        return typeof shelf === 'string' && shelf ? shelf : null;
      }
      return null;
    } catch {
      return null;
    }
  },

  /** Bucket QR is `{"<bucket_id>": "bucket"}`. */
  extractBucketIdFromScan(raw: string): string | null {
    const text = raw.trim();
    if (!text.startsWith('{') || !text.endsWith('}')) return null;
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === 'object') {
        const entry = Object.entries(parsed as Record<string, unknown>).find(
          ([, v]) => v === 'bucket',
        );
        return entry ? entry[0] : null;
      }
      return null;
    } catch {
      return null;
    }
  },

  async transfer(args: { bucketId: string; toShelfId: string }): Promise<TransferOutcome> {
    const raw: RawTransferResponse = await karenShelfOperationsApi.transferBucket(args);
    if (raw.status === 'success') {
      return {
        kind: 'success',
        bucketId: raw.payload?.bucket_id ?? args.bucketId,
        fromShelfId: raw.payload?.from_shelf_id ?? '',
        toShelfId: raw.payload?.to_shelf_id ?? args.toShelfId,
        stems: typeof raw.payload?.stems === 'number' ? raw.payload.stems : null,
        syncedOpls: raw.payload?.synced_opls ?? [],
        message: pickMessage(raw, 'Bucket transferred.'),
      };
    }
    if (raw.status === 'failed') {
      return {
        kind: 'failure',
        bucketId: raw.payload?.bucket_id ?? args.bucketId,
        reason: raw.reason ?? 'unknown',
        message: pickMessage(raw, 'Transfer failed.'),
        payload: raw.payload ?? null,
      };
    }
    return { kind: 'error', message: pickMessage(raw, 'Transfer failed.') };
  },

  async reportOfflineRemoval(args: {
    bucketId: string;
    reason: string;
  }): Promise<OfflineIssuingOutcome> {
    const raw: RawOfflineIssuingResponse = await karenShelfOperationsApi.reportOfflineRemoval(args);
    if (raw.status === 'success') {
      return {
        kind: 'success',
        bucketId: raw.payload?.bucket_id ?? args.bucketId,
        stems: typeof raw.payload?.stems === 'number' ? raw.payload.stems : null,
        stockEntry: raw.payload?.stock_entry ?? null,
        message: pickMessage(raw, 'Removal reported.'),
      };
    }
    if (raw.status === 'failed') {
      return {
        kind: 'failure',
        bucketId: raw.payload?.bucket_id ?? args.bucketId,
        reason: raw.reason ?? 'unknown',
        message: pickMessage(raw, 'Report failed.'),
        payload: raw.payload ?? null,
      };
    }
    return { kind: 'error', message: pickMessage(raw, 'Report failed.') };
  },
};
```

- [ ] **Step 2: Type-check**

Run: `cd /home/jk/Projects/upande-quality && npx tsc --noEmit`

Expected: no new errors referencing `karen-shelf-operations-repository.ts`.

- [ ] **Step 3: Commit**

```bash
cd /home/jk/Projects/upande-quality
git add src/tenants/karen/repository/karen-shelf-operations-repository.ts
git commit -m "feat: add repository layer for Shelf Operations"
```

---

### Task 8: Mobile store — `karen-shelf-operations-store.ts`

**Files:**
- Create: `/home/jk/Projects/upande-quality/src/tenants/karen/state/karen-shelf-operations-store.ts`

**Interfaces:**
- Consumes: `karenShelfOperationsRepository` from Task 7; `mapAxiosError` from `@/src/core/api/client` (same import used by `karen-shelving-store.ts`).
- Produces: `useKarenShelfOperationsStore` zustand hook with state `{mode: 'transfer' | 'offline-removal', shelfId: string | null, reason: string, loading: boolean, lastTransferOutcome: TransferOutcome | null, lastOfflineOutcome: OfflineIssuingOutcome | null}` and actions `setMode`, `setShelfFromScan`, `clearShelf`, `setReason`, `submitTransfer(rawBucket: string) => Promise<TransferOutcome>`, `submitOfflineRemoval(rawBucket: string) => Promise<OfflineIssuingOutcome>`, `reset`.

- [ ] **Step 1: Write the file**

```typescript
import { create } from 'zustand';
import {
  karenShelfOperationsRepository,
  type TransferOutcome,
  type OfflineIssuingOutcome,
} from '../repository/karen-shelf-operations-repository';
import { mapAxiosError } from '@/src/core/api/client';

export type ShelfOperationsMode = 'transfer' | 'offline-removal';

type State = {
  mode: ShelfOperationsMode;
  /** Destination shelf for Transfer mode. Not used in Offline Removal mode. */
  shelfId: string | null;
  /** Free-text reason for Offline Removal mode. */
  reason: string;
  loading: boolean;
  lastTransferOutcome: TransferOutcome | null;
  lastOfflineOutcome: OfflineIssuingOutcome | null;

  setMode: (mode: ShelfOperationsMode) => void;
  setShelfFromScan: (raw: string) => { ok: boolean; message?: string; shelfId?: string };
  clearShelf: () => void;
  setReason: (reason: string) => void;
  submitTransfer: (rawBucket: string) => Promise<TransferOutcome>;
  submitOfflineRemoval: (rawBucket: string) => Promise<OfflineIssuingOutcome>;
  reset: () => void;
};

export const useKarenShelfOperationsStore = create<State>((set, get) => ({
  mode: 'transfer',
  shelfId: null,
  reason: '',
  loading: false,
  lastTransferOutcome: null,
  lastOfflineOutcome: null,

  setMode: (mode) =>
    set({ mode, shelfId: null, reason: '', lastTransferOutcome: null, lastOfflineOutcome: null }),

  setShelfFromScan: (raw) => {
    const shelfId = karenShelfOperationsRepository.extractShelfIdFromScan(raw);
    if (!shelfId) {
      return { ok: false, message: 'Please scan a valid shelf QR code.' };
    }
    set({ shelfId, lastTransferOutcome: null });
    return { ok: true, shelfId };
  },

  clearShelf: () => set({ shelfId: null, lastTransferOutcome: null }),

  setReason: (reason) => set({ reason }),

  submitTransfer: async (rawBucket) => {
    const state = get();
    if (!state.shelfId) {
      const out: TransferOutcome = { kind: 'error', message: 'Scan the destination shelf first.' };
      set({ lastTransferOutcome: out });
      return out;
    }
    const bucketId = karenShelfOperationsRepository.extractBucketIdFromScan(rawBucket);
    if (!bucketId) {
      const out: TransferOutcome = { kind: 'error', message: 'Please scan a valid bucket QR code.' };
      set({ lastTransferOutcome: out });
      return out;
    }
    set({ loading: true });
    try {
      const outcome = await karenShelfOperationsRepository.transfer({
        bucketId,
        toShelfId: state.shelfId,
      });
      set({ loading: false, lastTransferOutcome: outcome });
      return outcome;
    } catch (err) {
      const out: TransferOutcome = { kind: 'error', message: mapAxiosError(err).message };
      set({ loading: false, lastTransferOutcome: out });
      return out;
    }
  },

  submitOfflineRemoval: async (rawBucket) => {
    const state = get();
    if (!state.reason.trim()) {
      const out: OfflineIssuingOutcome = { kind: 'error', message: 'Enter a reason first.' };
      set({ lastOfflineOutcome: out });
      return out;
    }
    const bucketId = karenShelfOperationsRepository.extractBucketIdFromScan(rawBucket);
    if (!bucketId) {
      const out: OfflineIssuingOutcome = { kind: 'error', message: 'Please scan a valid bucket QR code.' };
      set({ lastOfflineOutcome: out });
      return out;
    }
    set({ loading: true });
    try {
      const outcome = await karenShelfOperationsRepository.reportOfflineRemoval({
        bucketId,
        reason: state.reason.trim(),
      });
      set({ loading: false, lastOfflineOutcome: outcome });
      return outcome;
    } catch (err) {
      const out: OfflineIssuingOutcome = { kind: 'error', message: mapAxiosError(err).message };
      set({ loading: false, lastOfflineOutcome: out });
      return out;
    }
  },

  reset: () =>
    set({
      mode: 'transfer',
      shelfId: null,
      reason: '',
      loading: false,
      lastTransferOutcome: null,
      lastOfflineOutcome: null,
    }),
}));
```

- [ ] **Step 2: Type-check**

Run: `cd /home/jk/Projects/upande-quality && npx tsc --noEmit`

Expected: no new errors referencing `karen-shelf-operations-store.ts`.

- [ ] **Step 3: Commit**

```bash
cd /home/jk/Projects/upande-quality
git add src/tenants/karen/state/karen-shelf-operations-store.ts
git commit -m "feat: add zustand store for Shelf Operations"
```

---

### Task 9: Mobile screen — `ShelfOperationsScreen.tsx`

**Files:**
- Create: `/home/jk/Projects/upande-quality/src/tenants/karen/features/shelf-operations/ShelfOperationsScreen.tsx`

**Interfaces:**
- Consumes: `useKarenShelfOperationsStore` from Task 8; `Screen`, `Card`, `Alert` from `@/src/core/ui/Screen` / `@/src/core/ui/Card`; `ScanField`, `ScanFieldHandle` from `@/src/core/scanning/ScanField`; `focusWhenReady` from `@/src/core/scanning/focus`; `useToast` from `@/src/core/ui/Toast`; `COLORS` from `@/src/core/theme`.
- Produces: `KarenShelfOperationsScreen({userFarm}: {userFarm: string})` React component.

- [ ] **Step 1: Write the file**

```tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Screen } from '@/src/core/ui/Screen';
import { Card, Alert } from '@/src/core/ui/Card';
import { ScanField, type ScanFieldHandle } from '@/src/core/scanning/ScanField';
import { focusWhenReady } from '@/src/core/scanning/focus';
import { useToast } from '@/src/core/ui/Toast';
import {
  useKarenShelfOperationsStore,
  type ShelfOperationsMode,
} from '@/src/tenants/karen/state/karen-shelf-operations-store';
import { COLORS } from '@/src/core/theme';

export function KarenShelfOperationsScreen({ userFarm }: { userFarm: string }) {
  const shelfRef = useRef<ScanFieldHandle>(null);
  const bucketRef = useRef<ScanFieldHandle>(null);
  const {
    mode,
    shelfId,
    reason,
    loading,
    lastTransferOutcome,
    lastOfflineOutcome,
    setMode,
    setShelfFromScan,
    clearShelf,
    setReason,
    submitTransfer,
    submitOfflineRemoval,
    reset,
  } = useKarenShelfOperationsStore();
  const { showSuccess, showError } = useToast();

  useEffect(() => () => reset(), [reset]);

  // Transfer mode: shelf then bucket, mirrors Shelving's focus chain.
  // Offline Removal mode: no shelf step, focus goes straight to the bucket field.
  useFocusEffect(
    useCallback(() => {
      if (mode === 'transfer') {
        focusWhenReady(shelfId ? bucketRef : shelfRef);
      } else {
        focusWhenReady(bucketRef);
      }
    }, [mode, shelfId]),
  );

  useEffect(() => {
    if (mode === 'transfer') {
      focusWhenReady(shelfId ? bucketRef : shelfRef);
    }
  }, [mode, shelfId]);

  const switchMode = (next: ShelfOperationsMode) => {
    setMode(next);
    bucketRef.current?.clear();
    shelfRef.current?.clear();
  };

  const onShelfScan = (raw: string) => {
    const result = setShelfFromScan(raw);
    if (!result.ok) {
      showError(result.message ?? 'Invalid shelf QR.');
      shelfRef.current?.clear();
      focusWhenReady(shelfRef);
    }
  };

  const onBucketScanTransfer = async (raw: string) => {
    const outcome = await submitTransfer(raw);
    if (outcome.kind === 'success') {
      showSuccess(outcome.message);
    } else {
      showError(outcome.message);
    }
    bucketRef.current?.clear();
    focusWhenReady(bucketRef);
  };

  const onBucketScanOfflineRemoval = async (raw: string) => {
    const outcome = await submitOfflineRemoval(raw);
    if (outcome.kind === 'success') {
      showSuccess(outcome.message);
    } else {
      showError(outcome.message);
    }
    bucketRef.current?.clear();
    focusWhenReady(bucketRef);
  };

  return (
    <Screen title="Shelf Operations">
      <View style={s.farmBanner}>
        <Text style={s.farmBannerLabel}>Farm</Text>
        <Text style={s.farmBannerValue}>{userFarm || 'All farms'}</Text>
      </View>

      <View style={s.modeRow}>
        <ModeButton label="Transfer" active={mode === 'transfer'} onPress={() => switchMode('transfer')} />
        <ModeButton
          label="Report Offline Removal"
          active={mode === 'offline-removal'}
          onPress={() => switchMode('offline-removal')}
        />
      </View>

      {mode === 'transfer' ? (
        <>
          <Card title="Destination shelf">
            <ScanField
              ref={shelfRef}
              onScan={onShelfScan}
              autoFocus={!shelfId}
              placeholder="Scan destination shelf QR"
              value={shelfId ?? undefined}
              editable={!loading && !shelfId}
            />
            {shelfId ? (
              <View style={s.shelfStatusRow}>
                <Text style={s.shelfStatusLabel}>Moving bucket(s) to {shelfId}</Text>
                <Pressable onPress={clearShelf} hitSlop={8}>
                  <Text style={s.changeLink}>Change shelf</Text>
                </Pressable>
              </View>
            ) : null}
          </Card>

          <Card title="Bucket to move">
            <ScanField
              ref={bucketRef}
              onScan={onBucketScanTransfer}
              autoFocus={!!shelfId}
              placeholder={shelfId ? 'Scan bucket QR' : 'Scan the destination shelf first'}
              editable={!loading && !!shelfId}
            />
            {loading ? <Text style={s.muted}>Transferring…</Text> : null}
          </Card>

          {lastTransferOutcome ? <TransferOutcomeCard outcome={lastTransferOutcome} /> : null}
        </>
      ) : (
        <>
          <Card title="Reason">
            <TextInput
              style={s.reasonInput}
              placeholder="Why is this bucket being removed? (e.g. damaged, quality hold)"
              placeholderTextColor={COLORS.textMuted}
              value={reason}
              onChangeText={setReason}
              multiline
              editable={!loading}
            />
          </Card>

          <Card title="Bucket to report">
            <ScanField
              ref={bucketRef}
              onScan={onBucketScanOfflineRemoval}
              autoFocus={!!reason.trim()}
              placeholder={reason.trim() ? 'Scan bucket QR' : 'Enter a reason first'}
              editable={!loading && !!reason.trim()}
            />
            {loading ? <Text style={s.muted}>Reporting…</Text> : null}
          </Card>

          {lastOfflineOutcome ? <OfflineOutcomeCard outcome={lastOfflineOutcome} /> : null}
        </>
      )}
    </Screen>
  );
}

function ModeButton({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable style={[s.modeButton, active && s.modeButtonActive]} onPress={onPress}>
      <Text style={[s.modeButtonLabel, active && s.modeButtonLabelActive]}>{label}</Text>
    </Pressable>
  );
}

function TransferOutcomeCard({
  outcome,
}: {
  outcome: NonNullable<ReturnType<typeof useKarenShelfOperationsStore.getState>['lastTransferOutcome']>;
}) {
  if (outcome.kind === 'success') {
    return (
      <Card title="Transferred">
        <Row label="Bucket" value={outcome.bucketId} />
        <Row label="From" value={outcome.fromShelfId || '—'} />
        <Row label="To" value={outcome.toShelfId} />
        {outcome.stems != null ? <Row label="Stems" value={String(outcome.stems)} /> : null}
        {outcome.syncedOpls.length ? (
          <Row label="Pick lists updated" value={outcome.syncedOpls.join(', ')} />
        ) : null}
      </Card>
    );
  }
  return <Alert tone="danger">{outcome.message}</Alert>;
}

function OfflineOutcomeCard({
  outcome,
}: {
  outcome: NonNullable<ReturnType<typeof useKarenShelfOperationsStore.getState>['lastOfflineOutcome']>;
}) {
  if (outcome.kind === 'success') {
    return (
      <Card title="Removal reported">
        <Row label="Bucket" value={outcome.bucketId} />
        {outcome.stems != null ? <Row label="Stems" value={String(outcome.stems)} /> : null}
        {outcome.stockEntry ? <Row label="Stock entry" value={outcome.stockEntry} /> : null}
      </Card>
    );
  }
  if (outcome.kind === 'failure' && outcome.reason === 'bucket_allocated') {
    return (
      <>
        <Alert tone="danger">{outcome.message}</Alert>
        {outcome.payload?.sales_orders?.length ? (
          <Card title="Allocated to">
            {outcome.payload.sales_orders.map((so) => (
              <Row key={so} label="Sales order" value={so} />
            ))}
          </Card>
        ) : null}
      </>
    );
  }
  return <Alert tone="danger">{outcome.message}</Alert>;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.detailRow}>
      <Text style={s.detailLabel}>{label}</Text>
      <Text style={s.detailValue}>{value || '—'}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  farmBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.surfaceAlt,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 12,
  },
  farmBannerLabel: {
    fontSize: 12,
    color: COLORS.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    fontWeight: '600',
  },
  farmBannerValue: { fontSize: 15, color: COLORS.text, fontWeight: '700' },
  modeRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  modeButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
  },
  modeButtonActive: { backgroundColor: COLORS.text, borderColor: COLORS.text },
  modeButtonLabel: { fontSize: 13, fontWeight: '600', color: COLORS.text },
  modeButtonLabelActive: { color: COLORS.surface },
  shelfStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  shelfStatusLabel: {
    fontSize: 12,
    color: COLORS.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  changeLink: { fontSize: 13, color: COLORS.text, fontWeight: '600' },
  muted: { fontSize: 12, color: COLORS.textMuted, marginTop: 8 },
  reasonInput: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    padding: 10,
    fontSize: 14,
    color: COLORS.text,
    minHeight: 60,
    textAlignVertical: 'top',
  },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  detailLabel: {
    fontSize: 12,
    color: COLORS.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  detailValue: { fontSize: 14, color: COLORS.text, flexShrink: 1, textAlign: 'right' },
});
```

- [ ] **Step 2: Type-check**

Run: `cd /home/jk/Projects/upande-quality && npx tsc --noEmit`

Expected: no new errors referencing `ShelfOperationsScreen.tsx`. If `Screen`'s exact prop types don't match (e.g. it doesn't accept a bare `title` string, or `Card`/`Alert` have different prop names), fix the JSX to match — check `@/src/core/ui/Screen.tsx` and `@/src/core/ui/Card.tsx` directly if the compiler flags a mismatch.

- [ ] **Step 3: Commit**

```bash
cd /home/jk/Projects/upande-quality
git add src/tenants/karen/features/shelf-operations/ShelfOperationsScreen.tsx
git commit -m "feat: add Shelf Operations screen (transfer + report offline removal)"
```

---

### Task 10: Route + navigation registration

**Files:**
- Create: `/home/jk/Projects/upande-quality/app/(tabs)/shelf-operations.tsx`
- Modify: `/home/jk/Projects/upande-quality/app/(tabs)/_layout.tsx`
- Modify: `/home/jk/Projects/upande-quality/src/tenants/karen/navigation.ts`

**Interfaces:**
- Consumes: `KarenShelfOperationsScreen` from Task 9.
- Produces: the app-router route `/shelf-operations`, reachable from the drawer.

- [ ] **Step 1: Create the route file**

```tsx
import { useTenant } from '@/src/core/tenant/tenant-context';
import { RequireStation } from '@/src/core/tenant/RequireStation';
import { PendingScreen } from '@/src/core/ui/PendingScreen';
import { KarenShelfOperationsScreen } from '@/src/tenants/karen/features/shelf-operations/ShelfOperationsScreen';

export default function ShelfOperationsRoute() {
  const { tenant } = useTenant();

  if (tenant !== 'Karen' && tenant !== 'Demo') {
    return <PendingScreen feature="Shelf Operations" tenant={tenant} />;
  }

  return (
    <RequireStation next="/shelf-operations">
      {(station) => <KarenShelfOperationsScreen userFarm={station.userFarm} />}
    </RequireStation>
  );
}
```

- [ ] **Step 2: Register the icon and drawer-only tab in `_layout.tsx`**

In `/home/jk/Projects/upande-quality/app/(tabs)/_layout.tsx`, in the `ICONS` map, find:
```typescript
  discards:             { outline: 'trash-outline',             filled: 'trash' },
```
Add right after it:
```typescript
  discards:             { outline: 'trash-outline',             filled: 'trash' },
  'shelf-operations':   { outline: 'repeat-outline',            filled: 'repeat' },
```

Then find the drawer-only `<Tabs.Screen>` block, specifically:
```tsx
      <Tabs.Screen name="bucket-transfers" options={{ title: 'Bucket Transfers', href: null }} />
```
Add right after it:
```tsx
      <Tabs.Screen name="bucket-transfers" options={{ title: 'Bucket Transfers', href: null }} />
      <Tabs.Screen name="shelf-operations" options={{ title: 'Shelf Operations', href: null }} />
```

- [ ] **Step 3: Register the drawer entry**

In `/home/jk/Projects/upande-quality/src/tenants/karen/navigation.ts`, find:
```typescript
  { label: 'Shelving',           route: 'shelving',           icon: 'albums-outline' },
```
Add right after it:
```typescript
  { label: 'Shelving',           route: 'shelving',           icon: 'albums-outline' },
  { label: 'Shelf Operations',   route: 'shelf-operations',   icon: 'repeat-outline' },
```

- [ ] **Step 4: Type-check and verify the route resolves**

Run: `cd /home/jk/Projects/upande-quality && npx tsc --noEmit`

Expected: no errors.

Run: `cd /home/jk/Projects/upande-quality && npx expo start` (or the project's existing `run`/dev-server command), then confirm "Shelf Operations" appears in the Karen-tenant drawer and opens both modes without crashing.

- [ ] **Step 5: Commit**

```bash
cd /home/jk/Projects/upande-quality
git add app/\(tabs\)/shelf-operations.tsx app/\(tabs\)/_layout.tsx src/tenants/karen/navigation.ts
git commit -m "feat: register Shelf Operations route and navigation entry"
```
