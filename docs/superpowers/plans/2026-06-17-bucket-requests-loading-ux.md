# Bucket Requests Loading UX + Clear Saved Trolleys — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the disappearing "Load to truck" button, clarify saved/loaded trolley states, and add per-trolley delete + clear-all for saved trolleys (server-side undo that does not re-shelve).

**Architecture:** A new safe_exec Server Script (`deleteSavedTrolleys`) clears the trolley grouping on Pick List Item rows without restoring their shelf. The React Native app gains an api → repository → zustand-store → screen vertical slice that calls it, with optimistic removal and confirm dialogs. The "Load to truck" action is moved out of the collapsible card body so it is always visible.

**Tech Stack:** Expo / React Native + TypeScript, Zustand store, Frappe Server Script (API, safe_exec) on kaitet-group.upande.com via the `kaitet-web/fac.sh` FAC harness.

## Global Constraints

- **No test framework exists** (no jest/test files). Verification = `npx tsc --noEmit` (must pass), `npx expo lint` (no new errors), plus the manual/curl checks each task specifies.
- **safe_exec rules for the Server Script:** NO `import`, NO `def`, NO `+=`, NO Python `list.append()`, NO `frappe.parse_json`, NO raw `frappe.db.sql`. Build lists with `x = x + [i]`, iterate with `while`, set dict via `d[k]=v`. Start with a failure default, wrap in try/except.
- **List payloads to the Server Script are `|~|`-joined strings** (safe_exec can't parse JSON), matching `kaitet-web/getSchedulerMeta.py`.
- **FAC harness:** `export FAC_TOKEN=ca1df47f12af6ba:feb690abcb32c99` then use `./kaitet-web/fac.sh <tool> <json>`. If a call returns `AuthenticationError`, stop and request a fresh token.
- **Pick List Item fields (confirmed via `kaitet-web/getSchedulerDrafts.py`):** `custom_trolley_id`, `custom_loaded_in_trolley`, `custom_in_transit`, `custom_awaiting_transfer`, `custom_shelf`, `custom_bucket`, `custom_transit_truck`. Parent doctype `Order Pick List` has `custom_farm`, `date_created`, draft `docstatus 0`.
- **Delete scope:** only trolleys with `custom_in_transit != 1` (not yet loaded). Never modify `custom_shelf`.

---

## File Structure

- `kaitet-web/deleteSavedTrolleys.py` — new Server Script source (versioned locally; deployed to instance). **Create.**
- `src/tenants/karen/api/karen-bucket-requests-api.ts` — add `deleteSavedTrolleys`. **Modify.**
- `src/tenants/karen/repository/karen-bucket-requests-repository.ts` — add `deleteSavedTrolleys` + outcome type. **Modify.**
- `src/tenants/karen/state/karen-bucket-requests-store.ts` — add `deleting` map + `deleteSavedTrolley`/`clearSavedTrolleys` actions. **Modify.**
- `src/tenants/karen/features/bucket-requests/BucketRequestsScreen.tsx` — button fix, delete/clear controls, confirms, wiring. **Modify.**

---

## Task 1: Backend — `deleteSavedTrolleys` Server Script

**Files:**
- Create: `kaitet-web/deleteSavedTrolleys.py`

**Interfaces:**
- Produces: HTTP `POST /api/method/deleteSavedTrolleys` with form params `trolley_ids` (a `|~|`-joined string) and `farm`. Response: `frappe.response["message"] = { "status": "success", "cleared_count": <int>, "skipped_loaded": [<trolley_id>, ...] }` or `{ "status": "error", "message": <str> }`.

- [ ] **Step 1: Write the Server Script source**

Create `kaitet-web/deleteSavedTrolleys.py`:

```python
# Frappe Server Script (Type: API), api_method = deleteSavedTrolleys
# Undo a SAVED trolley grouping WITHOUT re-shelving its buckets.
# Clears custom_trolley_id / custom_loaded_in_trolley / custom_awaiting_transfer
# on the trolley's Pick List Item rows, but leaves custom_shelf untouched.
# Only acts on not-yet-loaded trolleys (custom_in_transit != 1); loaded ones
# are skipped and reported back.
# Payload (form params): trolley_ids = "T1|~|T2", farm = "Karen"
# safe_exec: no def/import/+=/.append/parse_json/sql.

frappe.response["message"] = {"status": "error", "message": "Script failed"}

try:
    ids_raw = frappe.form_dict.get("trolley_ids") or ""
    farm = frappe.form_dict.get("farm") or ""

    trolley_ids = []
    parts = ids_raw.split("|~|")
    p = 0
    while p < len(parts):
        v = parts[p].strip()
        if v != "":
            trolley_ids = trolley_ids + [v]
        p = p + 1

    if len(trolley_ids) == 0:
        frappe.response["message"] = {"status": "error", "message": "No trolley ids supplied."}
    else:
        # Scope to the farm's OPLs (drafts carry the trolley grouping), mirroring
        # getSchedulerDrafts.py. If farm is blank, fall back to all draft OPLs.
        opl_filters = [["docstatus", "=", 0]]
        if farm != "":
            opl_filters = opl_filters + [["custom_farm", "=", farm]]
        opls = frappe.get_all("Order Pick List", filters=opl_filters, fields=["name"])
        opl_names = []
        i = 0
        while i < len(opls):
            opl_names = opl_names + [opls[i].name]
            i = i + 1

        cleared_count = 0
        skipped = {}
        if len(opl_names) > 0:
            rows = frappe.get_all(
                "Pick List Item",
                filters=[["parent", "in", opl_names], ["custom_trolley_id", "in", trolley_ids]],
                fields=["name", "custom_trolley_id", "custom_in_transit"],
            )
            j = 0
            while j < len(rows):
                r = rows[j]
                if r.custom_in_transit == 1:
                    skipped[r.custom_trolley_id] = 1
                else:
                    frappe.db.set_value("Pick List Item", r.name, {
                        "custom_trolley_id": "",
                        "custom_loaded_in_trolley": 0,
                        "custom_awaiting_transfer": 0,
                    }, update_modified=True)
                    cleared_count = cleared_count + 1
                j = j + 1

        skipped_loaded = []
        for k in skipped:
            skipped_loaded = skipped_loaded + [k]

        frappe.response["message"] = {
            "status": "success",
            "cleared_count": cleared_count,
            "skipped_loaded": skipped_loaded,
        }

except Exception as e:
    frappe.response["message"] = {"status": "error", "message": str(e)}
```

- [ ] **Step 2: Create the Server Script doc on the instance**

```bash
export FAC_TOKEN=ca1df47f12af6ba:feb690abcb32c99
cd /home/jk/Projects/upande-quality
./kaitet-web/fac.sh create_document '{"doctype":"Server Script","data":{"name":"deleteSavedTrolleys","script_type":"API","api_method":"deleteSavedTrolleys","allow_guest":0,"disabled":0,"script":"frappe.response[\"message\"]={\"status\":\"error\",\"message\":\"stub\"}"}}'
```
Expected: a success JSON (the doc is created). If it already exists, ignore the "duplicate" error.

- [ ] **Step 3: Deploy the real script**

```bash
PY=$(python3 -c 'import json,sys;print(json.dumps(open(sys.argv[1]).read()))' kaitet-web/deleteSavedTrolleys.py)
./kaitet-web/fac.sh update_document "{\"doctype\":\"Server Script\",\"name\":\"deleteSavedTrolleys\",\"data\":{\"script\":$PY}}"
```
Expected: success JSON.

- [ ] **Step 4: Verify field names live before trusting the script**

Confirm a real saved trolley's rows look as expected. Find one via the app's `getSavedTrolleys`, then:
```bash
./kaitet-web/fac.sh list_documents '{"doctype":"Pick List Item","filters":{"custom_loaded_in_trolley":1,"custom_in_transit":0},"fields":["name","parent","custom_trolley_id","custom_shelf","custom_in_transit"],"limit_page_length":5}'
```
Expected: rows with a non-empty `custom_trolley_id`, `custom_loaded_in_trolley=1`, `custom_shelf` already blank. If any field name errors, fix the script to match the live schema and re-deploy (Step 3).

- [ ] **Step 5: Curl-test the endpoint against a real not-loaded trolley**

Pick a real `custom_trolley_id` + its farm from Step 4 (use a genuinely disposable one, or coordinate with the user). Capture a row's `custom_shelf` first, then:
```bash
curl -s -m 90 "https://kaitet-group.upande.com/api/method/deleteSavedTrolleys" \
  -H "Authorization: token $FAC_TOKEN" \
  --data-urlencode 'trolley_ids=<TROLLEY_ID>' --data-urlencode 'farm=<FARM>' | python3 -m json.tool
```
Expected: `{"message":{"status":"success","cleared_count":>=1,"skipped_loaded":[]}}`. Re-query the rows: `custom_trolley_id` now empty, `custom_loaded_in_trolley=0`, **`custom_shelf` unchanged**. Then call once more with a trolley_id that is loaded (`custom_in_transit=1`) and confirm it appears in `skipped_loaded` with `cleared_count` not counting it.

- [ ] **Step 6: Commit**

```bash
git add kaitet-web/deleteSavedTrolleys.py
git commit -m "feat(bucket-requests): deleteSavedTrolleys server endpoint (no re-shelve)"
```

---

## Task 2: App data layer — api + repository + store

**Files:**
- Modify: `src/tenants/karen/api/karen-bucket-requests-api.ts`
- Modify: `src/tenants/karen/repository/karen-bucket-requests-repository.ts`
- Modify: `src/tenants/karen/state/karen-bucket-requests-store.ts`

**Interfaces:**
- Consumes: Task 1's `POST /api/method/deleteSavedTrolleys` (`trolley_ids` `|~|`-joined, `farm`).
- Produces:
  - api: `karenBucketRequestsApi.deleteSavedTrolleys(payload: { trolley_ids: string; farm: string }): Promise<RawTrolleyActionResponse>`
  - repository: `karenBucketRequestsRepository.deleteSavedTrolleys(args: { trolleyIds: string[]; farm: string }): Promise<DeleteTrolleysOutcome>` where `DeleteTrolleysOutcome = { kind: 'ok'; clearedCount: number; skippedLoaded: string[] } | { kind: 'error'; message: string }`
  - store: `deleteSavedTrolley(trolleyId: string, farm: string): Promise<{ ok: boolean; message?: string }>`, `clearSavedTrolleys(farm: string): Promise<{ ok: boolean; message?: string }>`, and state field `deleting: Record<string, boolean>`.

- [ ] **Step 1: Add the api method**

In `src/tenants/karen/api/karen-bucket-requests-api.ts`, after `loadTrolleyInTruck` (before the closing `};` of `karenBucketRequestsApi`), add:

```typescript
  /** Undo saved trolleys on the server (clears the grouping; does NOT re-shelve).
   *  `trolley_ids` is a "|~|"-joined string (the Server Script is safe_exec and
   *  cannot parse JSON). */
  deleteSavedTrolleys(payload: {
    trolley_ids: string;
    farm: string;
  }): Promise<RawTrolleyActionResponse> {
    return api<RawTrolleyActionResponse>({
      method: 'POST',
      url: '/api/method/deleteSavedTrolleys',
      data: payload,
      validateStatus: () => true,
    });
  },
```

Also extend `RawTrolleyActionResponse.message` to include the new fields. Replace its type definition with:

```typescript
export type RawTrolleyActionResponse = {
  message?: {
    status?: 'success' | 'error' | string;
    message?: string;
    updated_count?: number;
    shelf_removed_count?: number;
    cleared_count?: number;
    skipped_loaded?: string[];
    errors?: { bucket_id?: string; error?: string }[];
  };
};
```

- [ ] **Step 2: Add the repository method + outcome type**

In `src/tenants/karen/repository/karen-bucket-requests-repository.ts`, add the outcome type near the other `*Outcome` types:

```typescript
export type DeleteTrolleysOutcome =
  | { kind: 'ok'; clearedCount: number; skippedLoaded: string[] }
  | { kind: 'error'; message: string };
```

Then add this method inside `karenBucketRequestsRepository` (after `loadTrolleyInTruck`):

```typescript
  async deleteSavedTrolleys(args: {
    trolleyIds: string[];
    farm: string;
  }): Promise<DeleteTrolleysOutcome> {
    const raw = await karenBucketRequestsApi.deleteSavedTrolleys({
      trolley_ids: args.trolleyIds.join('|~|'),
      farm: args.farm,
    });
    const m = raw.message ?? {};
    if (m.status === 'success') {
      return {
        kind: 'ok',
        clearedCount: m.cleared_count ?? 0,
        skippedLoaded: m.skipped_loaded ?? [],
      };
    }
    return { kind: 'error', message: m.message ?? 'Delete failed.' };
  },
```

- [ ] **Step 3: Add store state + actions**

In `src/tenants/karen/state/karen-bucket-requests-store.ts`:

(a) Add to the `State` type (after `loadingToTruck: Record<string, boolean>;`):
```typescript
  deleting: Record<string, boolean>;
```
(b) Add to the actions section of `State` (after `loadTrolleyInTruck`):
```typescript
  deleteSavedTrolley: (trolleyId: string, farm: string) => Promise<{ ok: boolean; message?: string }>;
  clearSavedTrolleys: (farm: string) => Promise<{ ok: boolean; message?: string }>;
```
(c) Add to `initial` (after `loadingToTruck: {} as Record<string, boolean>,`):
```typescript
  deleting: {} as Record<string, boolean>,
```
(d) Add the action implementations after `loadTrolleyInTruck` (before `reset`):
```typescript
  deleteSavedTrolley: async (trolleyId, farm) => {
    set((cur) => ({ deleting: { ...cur.deleting, [trolleyId]: true } }));
    try {
      const outcome = await karenBucketRequestsRepository.deleteSavedTrolleys({
        trolleyIds: [trolleyId],
        farm,
      });
      if (outcome.kind === 'ok') {
        set((cur) => {
          const next = { ...cur.deleting };
          delete next[trolleyId];
          return {
            deleting: next,
            savedTrolleys: cur.savedTrolleys.filter((t) => t.trolleyId !== trolleyId),
          };
        });
        return { ok: true, message: 'Trolley cleared.' };
      }
      // error: drop the in-flight flag and re-fetch to restore truth
      set((cur) => {
        const next = { ...cur.deleting };
        delete next[trolleyId];
        return { deleting: next };
      });
      await get().loadSaved(farm);
      return { ok: false, message: outcome.message };
    } catch (err) {
      set((cur) => {
        const next = { ...cur.deleting };
        delete next[trolleyId];
        return { deleting: next };
      });
      await get().loadSaved(farm);
      return { ok: false, message: mapAxiosError(err).message };
    }
  },

  clearSavedTrolleys: async (farm) => {
    const ids = get()
      .savedTrolleys.filter((t) => !t.truckId)
      .map((t) => t.trolleyId);
    if (ids.length === 0) return { ok: false, message: 'Nothing to clear.' };
    set((cur) => {
      const deleting = { ...cur.deleting };
      for (const id of ids) deleting[id] = true;
      return { deleting };
    });
    try {
      const outcome = await karenBucketRequestsRepository.deleteSavedTrolleys({
        trolleyIds: ids,
        farm,
      });
      if (outcome.kind === 'ok') {
        const idSet = new Set(ids);
        set((cur) => {
          const next = { ...cur.deleting };
          for (const id of ids) delete next[id];
          return {
            deleting: next,
            savedTrolleys: cur.savedTrolleys.filter((t) => !idSet.has(t.trolleyId)),
          };
        });
        return {
          ok: true,
          message: `Cleared ${outcome.clearedCount} trolley${outcome.clearedCount === 1 ? '' : 's'}.`,
        };
      }
      set((cur) => {
        const next = { ...cur.deleting };
        for (const id of ids) delete next[id];
        return { deleting: next };
      });
      await get().loadSaved(farm);
      return { ok: false, message: outcome.message };
    } catch (err) {
      set((cur) => {
        const next = { ...cur.deleting };
        for (const id of ids) delete next[id];
        return { deleting: next };
      });
      await get().loadSaved(farm);
      return { ok: false, message: mapAxiosError(err).message };
    }
  },
```
(e) Update `reset` so the new map is cleared too. Change `reset: () => set({ ...initial, assigned: new Set() })` to also reset `deleting` (it already does via `...initial`, so no change needed — verify `deleting` is in `initial`).

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: passes with no new errors referencing these three files. (Pre-existing errors elsewhere, if any, are out of scope — confirm none are in the edited files.)

- [ ] **Step 5: Commit**

```bash
git add src/tenants/karen/api/karen-bucket-requests-api.ts src/tenants/karen/repository/karen-bucket-requests-repository.ts src/tenants/karen/state/karen-bucket-requests-store.ts
git commit -m "feat(bucket-requests): data layer for deleting saved trolleys"
```

---

## Task 3: Screen — always-visible Load button, delete + clear-all controls

**Files:**
- Modify: `src/tenants/karen/features/bucket-requests/BucketRequestsScreen.tsx`

**Interfaces:**
- Consumes: store `deleteSavedTrolley(trolleyId, farm)`, `clearSavedTrolleys(farm)`, `deleting` (Task 2); `userFarm` prop (already in scope).

- [ ] **Step 1: Fix the disappearing Load button (move action out of the collapsible body)**

In `SavedTrolleyCard`, the action region currently lives inside `{open ? (...) : null}`. Restructure so the bucket list collapses but the action is always rendered. Replace the whole `return (...)` of `SavedTrolleyCard` with:

```tsx
  return (
    <Card>
      <Pressable onPress={() => setOpen((o) => !o)} style={s.trolleyHeader}>
        <View style={[s.trolleyNumber, isLoaded && s.trolleyNumberLoaded]}>
          <Ionicons
            name={isLoaded ? 'car' : 'cart'}
            size={14}
            color={COLORS.textOnPrimary ?? '#fff'}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.trolleyId}>{trolley.trolleyId}</Text>
          <Text style={s.trolleyMeta}>
            {trolley.buckets.length} bucket{trolley.buckets.length === 1 ? '' : 's'}
            {isLoaded ? ` · in ${trolley.truckId}` : ''}
          </Text>
        </View>
        <View
          style={[s.statusBadge, isLoaded ? s.statusBadgeLoaded : s.statusBadgeSaved]}
        >
          <Text
            style={[
              s.statusBadgeText,
              isLoaded ? s.statusBadgeTextLoaded : s.statusBadgeTextSaved,
            ]}
          >
            {isLoaded ? 'Loaded' : 'Saved'}
          </Text>
        </View>
        {!isLoaded ? (
          <Pressable onPress={onDelete} hitSlop={8} style={s.removeBtn} disabled={deleting}>
            {deleting ? (
              <Spinner inline />
            ) : (
              <Ionicons name="trash-outline" size={15} color={COLORS.danger ?? '#EF4444'} />
            )}
          </Pressable>
        ) : null}
        <Ionicons
          name={open ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={COLORS.textMuted}
        />
      </Pressable>

      {/* Collapsible bucket detail only */}
      {open ? (
        <View>
          <View style={s.divider} />
          {trolley.buckets.map((b, idx) => (
            <View key={b.bucketId + ':' + idx}>
              <View style={s.trolleyBucketRow}>
                <View style={{ flex: 1 }}>
                  <Text style={s.bucketId}>{b.bucketId}</Text>
                  <Text style={s.variety} numberOfLines={1}>
                    {b.varietyLabel}
                    {b.shelfLocation ? ` · ${b.shelfLocation}` : ''}
                  </Text>
                </View>
                <Text style={s.trolleyQty}>
                  {Math.round(b.qty)} {b.uom}
                </Text>
              </View>
              {idx < trolley.buckets.length - 1 ? <View style={s.rowDivider} /> : null}
            </View>
          ))}
        </View>
      ) : null}

      {/* Action region — ALWAYS visible, never inside the collapse */}
      <View style={s.divider} />
      {isLoaded ? (
        <View style={s.loadedInline}>
          <Ionicons name="car" size={16} color={COLORS.text} />
          <Text style={s.loadedInlineText}>Loaded in {trolley.truckId}</Text>
        </View>
      ) : (
        <Button
          label="Load to truck"
          iconLeft="car-outline"
          onPress={onLoadPress}
          loading={loading}
        />
      )}
    </Card>
  );
```

- [ ] **Step 2: Extend `SavedTrolleyCard` props for delete**

Update the `SavedTrolleyCard` signature/props type to add `onDelete` and `deleting`:

```tsx
function SavedTrolleyCard({
  trolley,
  loading,
  deleting,
  onLoadPress,
  onDelete,
}: {
  trolley: SavedTrolley;
  loading: boolean;
  deleting: boolean;
  onLoadPress: () => void;
  onDelete: () => void;
}) {
  const isLoaded = !!trolley.truckId;
  const [open, setOpen] = useState(!isLoaded);
```
(Keep the existing explanatory comment about defaulting open to `!isLoaded`.)

- [ ] **Step 3: Add a `SectionHeader` right-action and a Clear-all button**

Replace `SectionHeader` with a version that accepts an optional right action:

```tsx
function SectionHeader({ label, action }: { label: string; action?: React.ReactNode }) {
  return (
    <View style={s.sectionHeaderRow}>
      <Text style={s.sectionLabel}>{label}</Text>
      {action ?? null}
    </View>
  );
}
```

Add these styles to the `StyleSheet.create` block:

```tsx
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  clearAllBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4, paddingHorizontal: spacing.xs },
  clearAllText: { fontFamily: fontFamily.semiBold, fontSize: fontSize.xs, color: COLORS.danger ?? '#EF4444' },
```

Note: `sectionLabel` currently has `marginLeft: spacing.xs`; leave it — the row layout still reads well.

- [ ] **Step 4: Wire delete + clear-all into `TrolleysTab`**

Extend `TrolleysTab`'s props with `deleting`, `onDeleteTrolley`, `onClearAll`:

```tsx
function TrolleysTab({
  order,
  trolleys,
  saved,
  savedLoading,
  savedError,
  vehicles,
  loadingToTruck,
  deleting,
  onRemoveBucket,
  onLoadToTruck,
  onDeleteTrolley,
  onClearAll,
  onRetry,
}: {
  order: string[];
  trolleys: Record<string, LocalTrolley>;
  saved: SavedTrolley[];
  savedLoading: boolean;
  savedError: string | null;
  vehicles: string[];
  loadingToTruck: Record<string, boolean>;
  deleting: Record<string, boolean>;
  onRemoveBucket: (bucketId: string) => void;
  onLoadToTruck: (trolleyId: string, truckId: string) => void;
  onDeleteTrolley: (trolley: SavedTrolley) => void;
  onClearAll: (count: number) => void;
  onRetry: () => void;
}) {
```

Inside, compute the clearable count and render the Saved section header with a Clear-all action, and pass delete props to each card. Replace the existing `saved.length > 0 ? (...)` Saved block with:

```tsx
      ) : saved.length > 0 ? (
        <View>
          {(() => {
            const clearableCount = saved.filter((t) => !t.truckId).length;
            return (
              <SectionHeader
                label="Saved"
                action={
                  clearableCount > 0 ? (
                    <Pressable
                      style={s.clearAllBtn}
                      hitSlop={8}
                      onPress={() => onClearAll(clearableCount)}
                    >
                      <Ionicons name="trash-outline" size={14} color={COLORS.danger ?? '#EF4444'} />
                      <Text style={s.clearAllText}>Clear all</Text>
                    </Pressable>
                  ) : null
                }
              />
            );
          })()}
          {saved.map((t, i) => (
            <SavedTrolleyCard
              key={t.trolleyId + ':' + i}
              trolley={t}
              loading={!!loadingToTruck[t.trolleyId]}
              deleting={!!deleting[t.trolleyId]}
              onLoadPress={() => setLoadModal(t)}
              onDelete={() => onDeleteTrolley(t)}
            />
          ))}
        </View>
      ) : null}
```

- [ ] **Step 5: Add `Alert` import and confirm-dialog wiring in the screen component**

At the top of the file, add `Alert` to the existing `react-native` import list:

```tsx
import {
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
```

Pull the new store members in the `useKarenBucketRequestsStore()` destructure (add `deleting`, `deleteSavedTrolley`, `clearSavedTrolleys`).

In `KarenBucketRequestsScreen`, add two handlers (near `onSaveAll`):

```tsx
  const onDeleteTrolley = (t: SavedTrolley) => {
    Alert.alert(
      'Clear trolley?',
      `Delete trolley ${t.trolleyId}? Its ${t.buckets.length} bucket${t.buckets.length === 1 ? '' : 's'} stay picked (off-shelf); only the trolley grouping is removed.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            const outcome = await deleteSavedTrolley(t.trolleyId, userFarm);
            if (outcome.ok) showSuccess(outcome.message ?? 'Trolley cleared.');
            else showError(outcome.message ?? 'Could not clear trolley.');
          },
        },
      ],
    );
  };

  const onClearAllSaved = (count: number) => {
    Alert.alert(
      'Clear all saved trolleys?',
      `Clear ${count} saved trolley${count === 1 ? '' : 's'}? Their buckets stay picked; trolleys already loaded onto a truck are kept.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear all',
          style: 'destructive',
          onPress: async () => {
            const outcome = await clearSavedTrolleys(userFarm);
            if (outcome.ok) showSuccess(outcome.message ?? 'Cleared.');
            else showError(outcome.message ?? 'Could not clear trolleys.');
          },
        },
      ],
    );
  };
```

Then pass them (and `deleting`) to `<TrolleysTab>` in the render:

```tsx
          <TrolleysTab
            order={trolleyOrder}
            trolleys={trolleys}
            saved={savedTrolleys}
            savedLoading={savedLoading}
            savedError={savedError}
            vehicles={vehicles}
            loadingToTruck={loadingToTruck}
            deleting={deleting}
            onRemoveBucket={removeBucket}
            onLoadToTruck={async (trolleyId, truckId) => {
              const outcome = await loadTrolleyInTruck(trolleyId, truckId);
              if (outcome.ok) showSuccess(outcome.message ?? 'Loaded to truck.');
              else showError(outcome.message ?? 'Load failed.');
            }}
            onDeleteTrolley={onDeleteTrolley}
            onClearAll={onClearAllSaved}
            onRetry={() => loadSaved(userFarm)}
          />
```

Add `import React from 'react';` is unnecessary (JSX runtime), but `React.ReactNode` is used in `SectionHeader` — it resolves via the existing `react` types; if `tsc` complains about `React` not defined, change the `SectionHeader` action type from `React.ReactNode` to `import('react').ReactNode` is overkill — instead `import type { ReactNode } from 'react';` at the top and use `ReactNode`. Use this `import type` approach to be safe.

So also add at the top:
```tsx
import type { ReactNode } from 'react';
```
and change `action?: React.ReactNode` to `action?: ReactNode`.

- [ ] **Step 6: Typecheck + lint**

Run: `npx tsc --noEmit`
Expected: passes, no errors in `BucketRequestsScreen.tsx`.
Run: `npx expo lint`
Expected: no new lint errors in the edited file.

- [ ] **Step 7: Commit**

```bash
git add src/tenants/karen/features/bucket-requests/BucketRequestsScreen.tsx
git commit -m "feat(bucket-requests): always-visible Load action + delete/clear saved trolleys"
```

---

## Task 4: End-to-end verification

**Files:** none (verification only).

- [ ] **Step 1: Start the app**

Run: `npx expo start` (or coordinate with the user to run it on a device/emulator pointed at kaitet-group). Sign in as a Karen station user with a farm that has buckets awaiting transfer.

- [ ] **Step 2: Walk the loading flow**

Scan a trolley → scan buckets → tap Save. Confirm the trolley moves to the **Saved** section with a **Saved** badge, and the **Load to truck** button is visible. Tap the card header to collapse the bucket list — confirm the **Load to truck** button is STILL visible (the original bug). Pull-to-refresh — confirm it stays visible.

- [ ] **Step 3: Verify delete (per-trolley)**

Tap the trash icon on a Saved (not-loaded) trolley → confirm the Alert copy → Clear. Confirm a success toast, the card disappears, and via FAC the rows' `custom_trolley_id` is cleared while `custom_shelf` is unchanged (re-run the Task 1 Step 4 query for that trolley).

- [ ] **Step 4: Verify clear-all and the loaded guard**

Load one trolley to a truck (so it shows **Loaded**, no trash icon, "Loaded in {truck}" inline). With at least one other Saved trolley present, tap **Clear all** → confirm. Confirm only the not-loaded saved trolleys are removed and the **Loaded** one remains untouched. Confirm the toast reports the cleared count.

- [ ] **Step 5: Verify error recovery**

Temporarily break connectivity (airplane mode) and attempt a delete; confirm the error toast appears and the list re-fetches to its true state once connectivity returns (no phantom removal persists).

- [ ] **Step 6: Final commit (if any verification fixes were needed)**

```bash
git add -A && git commit -m "fix(bucket-requests): verification follow-ups"
```
(Skip if nothing changed.)

---

## Self-Review notes (addressed)

- **Spec §4.1 disappearing button** → Task 3 Step 1 (action moved out of collapse).
- **Spec §4.2 clearer states** → Task 3 Step 1 (Saved/Loaded badges retained + always-visible action region; bucket list still inspectable).
- **Spec §4.3 clear controls (per-trolley + clear-all, saved-only, confirm copy)** → Task 3 Steps 2–5.
- **Spec §4.4 store actions (deleting map, optimistic, re-fetch on error)** → Task 2 Step 3.
- **Spec §5 backend (guard not-loaded, no re-shelve, return shape)** → Task 1.
- **Spec §6 error handling** → Task 2 Step 3 (re-fetch on error) + Task 3 Step 5 (confirms) + Task 4 Step 5.
- **Spec §7 verification** → Task 1 Steps 4–5 (backend) + Task 4 (frontend).
- **Type consistency:** `deleteSavedTrolleys` (api/repo), `deleteSavedTrolley`/`clearSavedTrolleys` (store), `DeleteTrolleysOutcome`, `deleting` map, and the `onDeleteTrolley`/`onClearAll` prop names are used identically across Tasks 2–3.
- **No test framework:** verification is typecheck + lint + manual/curl, stated in Global Constraints and each task.
