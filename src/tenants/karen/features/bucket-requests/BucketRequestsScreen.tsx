import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Alert as RNAlert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '@/src/core/ui/Screen';
import { Card, Alert } from '@/src/core/ui/Card';
import { Button } from '@/src/core/ui/Button';
import { Segmented } from '@/src/core/ui/Segmented';
import { Spinner } from '@/src/core/ui/Spinner';
import { Dropdown } from '@/src/core/ui/Dropdown';
import { ScanField, type ScanFieldHandle } from '@/src/core/scanning/ScanField';
import { focusWhenReady } from '@/src/core/scanning/focus';
import { useToast } from '@/src/core/ui/Toast';
import {
  borderRadius,
  COLORS,
  fontFamily,
  fontSize,
  spacing,
} from '@/src/core/theme';
import {
  useKarenBucketRequestsStore,
  type LocalTrolley,
} from '@/src/tenants/karen/state/karen-bucket-requests-store';
import type {
  AllocationItem,
  SavedTrolley,
} from '@/src/tenants/karen/repository/karen-bucket-requests-repository';

type Tab = 'pick' | 'trolleys';

export function KarenBucketRequestsScreen({ userFarm }: { userFarm: string }) {
  const trolleyRef = useRef<ScanFieldHandle>(null);
  const bucketRef = useRef<ScanFieldHandle>(null);
  const { showSuccess, showError } = useToast();
  const [tab, setTab] = useState<Tab>('pick');
  const [refreshing, setRefreshing] = useState(false);

  const {
    loading,
    loadError,
    allItems,
    assigned,
    trolleys,
    trolleyOrder,
    activeTrolleyId,
    vehicles,
    savedLoading,
    savedError,
    savedTrolleys,
    saving,
    loadingToTruck,
    deleting,
    loadPickList,
    setTrolleyFromScan,
    clearActiveTrolley,
    assignBucketFromScan,
    removeBucket,
    saveAllUnsaved,
    loadSaved,
    loadTrolleyInTruck,
    deleteSavedTrolley,
    clearSavedTrolleys,
    reset,
  } = useKarenBucketRequestsStore();

  // ── Initial fetch + cleanup on unmount ───────────────────────────────
  useEffect(() => {
    loadPickList(userFarm);
    return () => reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userFarm]);

  // ── Park the cursor on the right field on every screen entry ─────────
  useFocusEffect(
    useCallback(() => {
      focusWhenReady(activeTrolleyId ? bucketRef : trolleyRef);
    }, [activeTrolleyId]),
  );

  // ── And whenever the active trolley flips ────────────────────────────
  useEffect(() => {
    focusWhenReady(activeTrolleyId ? bucketRef : trolleyRef);
  }, [activeTrolleyId]);

  // ── Counters for the header ──────────────────────────────────────────
  const totalBuckets = allItems.length;
  const scannedBuckets = assigned.size;
  const unsavedTrolleyCount = trolleyOrder.filter(
    (id) => trolleys[id]?.status === 'scanning' && trolleys[id].buckets.length > 0,
  ).length;

  // ── Group remaining pick-list items by OPL (order) for the Pick tab ──
  // Operators reason about what to pick per order, so we group by OPL and
  // surface the shelf on each bucket row instead of grouping by shelf.
  const groupedByOpl = useMemo(() => {
    const map = new Map<string, AllocationItem[]>();
    for (const item of allItems) {
      if (assigned.has(item.bucketId)) continue;
      const key = item.oplName || item.orderName || '(no OPL)';
      const arr = map.get(key);
      if (arr) arr.push(item);
      else map.set(key, [item]);
    }
    return Array.from(map.entries())
      .map(([key, items]) => ({
        key,
        title: items[0].orderName || items[0].customer || key,
        customer: items[0].customer,
        items,
      }))
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [allItems, assigned]);

  // ── Refresh handler — pulls pick list AND (if applicable) saved list
  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await loadPickList(userFarm);
      if (tab === 'trolleys') await loadSaved(userFarm);
    } finally {
      setRefreshing(false);
    }
  };

  // ── Scanner handlers ─────────────────────────────────────────────────
  const onTrolleyScan = (raw: string) => {
    const result = setTrolleyFromScan(raw);
    if (!result.ok) {
      showError(result.message ?? 'Invalid trolley QR.');
      trolleyRef.current?.clear();
      focusWhenReady(trolleyRef);
    } else {
      showSuccess(`Trolley ${result.trolleyId}`);
      trolleyRef.current?.clear();
      // focus jump handled by the effect on activeTrolleyId
    }
  };

  const onBucketScan = (raw: string) => {
    const result = assignBucketFromScan(raw);
    if (!result.ok) {
      showError(result.message ?? 'Could not assign bucket.');
    } else if (result.message) {
      showSuccess(result.message);
    }
    bucketRef.current?.clear();
    focusWhenReady(bucketRef);
  };

  const onSaveAll = async () => {
    const outcome = await saveAllUnsaved();
    if (outcome.ok) {
      showSuccess(outcome.message ?? 'Saved.');
      // Refresh the saved list & switch tabs so the operator can pick a truck
      await loadSaved(userFarm);
      setTab('trolleys');
    } else {
      showError(outcome.message ?? 'Save failed.');
    }
  };

  const onDeleteTrolley = (t: SavedTrolley) => {
    RNAlert.alert(
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
    RNAlert.alert(
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

  // Lazy-load the saved trolleys list the first time the user switches to it
  useEffect(() => {
    if (tab === 'trolleys' && savedTrolleys.length === 0 && !savedLoading) {
      loadSaved(userFarm);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  return (
    <Screen title="Bucket Requests" scroll={false}>
      <ScrollView
        contentContainerStyle={s.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.text} />
        }
      >
        {/* Header summary line ─────────────────────────────────────── */}
        <Text style={s.summary}>
          <Text style={s.summaryNumber}>{scannedBuckets}</Text>
          <Text style={s.summaryMuted}>{` / ${totalBuckets} scanned · `}</Text>
          <Text style={s.summaryNumber}>{trolleyOrder.length}</Text>
          <Text style={s.summaryMuted}>{` trolley${trolleyOrder.length === 1 ? '' : 's'}`}</Text>
        </Text>

        {/* SCANNER (always visible — both tabs benefit) ────────────── */}
        <Card>
          <View style={s.scanRow}>
            <View style={s.scanField}>
              <Text style={s.scanLabel}>1 · Trolley</Text>
              <ScanField
                ref={trolleyRef}
                onScan={onTrolleyScan}
                autoFocus={!activeTrolleyId}
                placeholder="Scan trolley QR"
                value={activeTrolleyId ?? undefined}
                editable={!activeTrolleyId}
              />
              {activeTrolleyId ? (
                <Pressable
                  onPress={() => {
                    clearActiveTrolley();
                    focusWhenReady(trolleyRef);
                  }}
                  hitSlop={8}
                  style={s.changeLinkRow}
                >
                  <Ionicons name="swap-horizontal" size={14} color={COLORS.text} />
                  <Text style={s.changeLink}>Change trolley</Text>
                </Pressable>
              ) : null}
            </View>
            <View style={s.scanField}>
              <Text style={s.scanLabel}>2 · Bucket</Text>
              <ScanField
                ref={bucketRef}
                onScan={onBucketScan}
                autoFocus={!!activeTrolleyId}
                placeholder={activeTrolleyId ? 'Scan bucket QR' : 'Scan trolley first'}
                editable={!!activeTrolleyId}
              />
            </View>
          </View>
        </Card>

        <Segmented
          value={tab}
          onChange={(v) => setTab(v as Tab)}
          options={[
            { value: 'pick', label: `Pick List (${totalBuckets - scannedBuckets})` },
            { value: 'trolleys', label: `Trolleys (${trolleyOrder.length + savedTrolleys.length})` },
          ]}
        />

        {tab === 'pick' ? (
          <PickListTab
            loading={loading}
            loadError={loadError}
            grouped={groupedByOpl}
            assignedCount={scannedBuckets}
            onRetry={() => loadPickList(userFarm)}
          />
        ) : (
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
        )}
      </ScrollView>

      {/* Sticky bottom Save bar appears only while there's unsaved work */}
      {unsavedTrolleyCount > 0 ? (
        <View style={s.saveBar}>
          <Button
            label={
              saving
                ? `Saving ${unsavedTrolleyCount} trolley${unsavedTrolleyCount === 1 ? '' : 's'}…`
                : `Save ${unsavedTrolleyCount} trolley${unsavedTrolleyCount === 1 ? '' : 's'}`
            }
            onPress={onSaveAll}
            loading={saving}
            disabled={saving}
            iconLeft="save-outline"
          />
        </View>
      ) : null}
    </Screen>
  );
}

/* ─── Pick list tab ────────────────────────────────────────────────── */

function PickListTab({
  loading,
  loadError,
  grouped,
  assignedCount,
  onRetry,
}: {
  loading: boolean;
  loadError: string | null;
  grouped: { key: string; title: string; customer: string; items: AllocationItem[] }[];
  assignedCount: number;
  onRetry: () => void;
}) {
  if (loading && grouped.length === 0) {
    return (
      <Card>
        <Spinner inline label="Loading pick list…" />
      </Card>
    );
  }
  if (loadError) {
    return (
      <>
        <Alert tone="danger">{loadError}</Alert>
        <Card>
          <Button label="Try again" variant="outline" iconLeft="refresh" onPress={onRetry} />
        </Card>
      </>
    );
  }
  if (grouped.length === 0) {
    return (
      <Card>
        <View style={s.emptyWrap}>
          <View style={s.emptyIcon}>
            <Ionicons name="checkmark-circle-outline" size={28} color={COLORS.text} />
          </View>
          <Text style={s.emptyTitle}>
            {assignedCount > 0 ? 'All buckets scanned' : 'Nothing to pick'}
          </Text>
          <Text style={s.emptyHint}>
            {assignedCount > 0
              ? 'Switch to the Trolleys tab to save and load to a truck.'
              : 'Pull down to refresh.'}
          </Text>
        </View>
      </Card>
    );
  }

  return (
    <>
      {grouped.map((group) => (
        <Card key={group.key}>
          <View style={s.shelfHeader}>
            <View style={s.shelfBadge}>
              <Ionicons name="receipt-outline" size={14} color={COLORS.textOnPrimary ?? '#fff'} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.shelfTitle} numberOfLines={1}>{group.title}</Text>
              <Text style={s.shelfMeta}>
                {group.customer ? `${group.customer} · ` : ''}
                {group.items.length} bucket{group.items.length === 1 ? '' : 's'} remaining
              </Text>
            </View>
          </View>
          <View style={s.divider} />
          {group.items.map((it, idx) => (
            <View key={it.bucketId}>
              <PickListRow item={it} />
              {idx < group.items.length - 1 ? <View style={s.rowDivider} /> : null}
            </View>
          ))}
        </Card>
      ))}
    </>
  );
}

function PickListRow({ item }: { item: AllocationItem }) {
  return (
    <View style={s.pickRow}>
      <View style={s.pickRowMain}>
        <Text style={s.bucketId}>{item.bucketId}</Text>
        <Text style={s.variety} numberOfLines={1}>
          {item.varietyLabel}
        </Text>
      </View>
      <View style={s.pickRowMeta}>
        <MetaPill icon="location-outline" label={item.shelfLocation || '(no shelf)'} />
        <MetaPill icon="resize-outline" label={item.stemLength || '—'} />
        <MetaPill icon="leaf-outline" label={`${Math.round(item.qty)} ${item.uom || ''}`.trim()} />
        {item.allocatedDate ? (
          <MetaPill icon="calendar-outline" label={`Allocated ${item.allocatedDate}`} />
        ) : null}
      </View>
    </View>
  );
}

function MetaPill({
  icon,
  label,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
}) {
  return (
    <View style={s.metaPill}>
      <Ionicons name={icon} size={11} color={COLORS.textMuted} />
      <Text style={s.metaPillText} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/* ─── Trolleys tab ─────────────────────────────────────────────────── */

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
  const [loadModal, setLoadModal] = useState<SavedTrolley | null>(null);

  // Only show still-in-progress trolleys here. Once a trolley is saved it
  // moves to the "Saved" section below (which carries the Load-to-truck
  // action) — keeping it here too would render a confusing button-less
  // duplicate of the trolley the operator just saved.
  const localTrolleys = order
    .map((id) => trolleys[id])
    .filter((t): t is LocalTrolley => !!t && t.status !== 'saved');

  return (
    <>
      {localTrolleys.length === 0 && saved.length === 0 && !savedLoading && !savedError ? (
        <Card>
          <View style={s.emptyWrap}>
            <View style={s.emptyIcon}>
              <Ionicons name="cube-outline" size={28} color={COLORS.textMuted} />
            </View>
            <Text style={s.emptyTitle}>No trolleys yet</Text>
            <Text style={s.emptyHint}>
              Scan a trolley QR above, then scan buckets onto it.
            </Text>
          </View>
        </Card>
      ) : null}

      {localTrolleys.length > 0 ? (
        <View>
          <SectionHeader label="This session" />
          {localTrolleys.map((t, i) => (
            <LocalTrolleyCard
              key={t.trolleyId}
              trolley={t}
              number={i + 1}
              onRemoveBucket={onRemoveBucket}
            />
          ))}
        </View>
      ) : null}

      {savedLoading && saved.length === 0 ? (
        <Card>
          <Spinner inline label="Loading saved trolleys…" />
        </Card>
      ) : savedError ? (
        <>
          <Alert tone="danger">{savedError}</Alert>
          <Card>
            <Button label="Try again" variant="outline" iconLeft="refresh" onPress={onRetry} />
          </Card>
        </>
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

      <LoadTruckModal
        trolley={loadModal}
        vehicles={vehicles}
        onClose={() => setLoadModal(null)}
        onConfirm={(truckId) => {
          if (loadModal) onLoadToTruck(loadModal.trolleyId, truckId);
          setLoadModal(null);
        }}
      />
    </>
  );
}

function SectionHeader({ label, action }: { label: string; action?: ReactNode }) {
  return (
    <View style={s.sectionHeaderRow}>
      <Text style={s.sectionLabel}>{label}</Text>
      {action ?? null}
    </View>
  );
}

function LocalTrolleyCard({
  trolley,
  number,
  onRemoveBucket,
}: {
  trolley: LocalTrolley;
  number: number;
  onRemoveBucket: (bucketId: string) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <Card>
      <Pressable onPress={() => setOpen((o) => !o)} style={s.trolleyHeader}>
        <View style={s.trolleyNumber}>
          <Text style={s.trolleyNumberText}>{number}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.trolleyId}>{trolley.trolleyId}</Text>
          <Text style={s.trolleyMeta}>
            {trolley.buckets.length} bucket{trolley.buckets.length === 1 ? '' : 's'}
          </Text>
        </View>
        <StatusBadge status={trolley.status} />
        <Ionicons
          name={open ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={COLORS.textMuted}
        />
      </Pressable>
      {open ? (
        <View>
          <View style={s.divider} />
          {trolley.buckets.length === 0 ? (
            <Text style={s.emptyHint}>Scan buckets to fill this trolley.</Text>
          ) : (
            trolley.buckets.map((b, idx) => (
              <View key={b.bucketId}>
                <View style={s.trolleyBucketRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.bucketId}>{b.bucketId}</Text>
                    <Text style={s.variety} numberOfLines={1}>
                      {b.varietyLabel} · {b.shelfLocation}
                    </Text>
                  </View>
                  <Text style={s.trolleyQty}>
                    {Math.round(b.qty)} {b.uom}
                  </Text>
                  {trolley.status === 'scanning' ? (
                    <Pressable
                      onPress={() => onRemoveBucket(b.bucketId)}
                      hitSlop={8}
                      style={s.removeBtn}
                    >
                      <Ionicons name="close" size={14} color={COLORS.danger ?? '#EF4444'} />
                    </Pressable>
                  ) : null}
                </View>
                {idx < trolley.buckets.length - 1 ? <View style={s.rowDivider} /> : null}
              </View>
            ))
          )}
        </View>
      ) : null}
    </Card>
  );
}

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
  // Default not-yet-loaded trolleys to expanded so the "Load to truck" action
  // is visible immediately. Cards remount whenever the saved list re-fetches
  // (e.g. after saving another trolley); without this they'd reset to
  // collapsed and the button would appear to "disappear". Loaded trolleys
  // start collapsed since there's nothing actionable left.
  const [open, setOpen] = useState(!isLoaded);
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
          style={[
            s.statusBadge,
            isLoaded ? s.statusBadgeLoaded : s.statusBadgeSaved,
          ]}
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
}

function StatusBadge({ status }: { status: LocalTrolley['status'] }) {
  const isSaved = status === 'saved';
  const label = status === 'saving' ? 'Saving' : isSaved ? 'Saved' : 'Unsaved';
  return (
    <View style={[s.statusBadge, isSaved ? s.statusBadgeSaved : s.statusBadgeMuted]}>
      <Text
        style={[
          s.statusBadgeText,
          isSaved ? s.statusBadgeTextSaved : s.statusBadgeTextMuted,
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

/* ─── Load truck modal ─────────────────────────────────────────────── */

function LoadTruckModal({
  trolley,
  vehicles,
  onClose,
  onConfirm,
}: {
  trolley: SavedTrolley | null;
  vehicles: string[];
  onClose: () => void;
  onConfirm: (truckId: string) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    setSelected(null);
  }, [trolley?.trolleyId]);

  return (
    <Modal
      visible={!!trolley}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable style={s.modalBackdrop} onPress={onClose}>
        <Pressable style={s.modalSheet} onPress={(e) => e.stopPropagation()}>
          <View style={s.modalHeader}>
            <Ionicons name="car" size={18} color={COLORS.text} />
            <Text style={s.modalTitle}>Load to truck</Text>
          </View>
          {trolley ? (
            <Text style={s.modalSubtitle}>
              {trolley.trolleyId} · {trolley.buckets.length} bucket
              {trolley.buckets.length === 1 ? '' : 's'}
            </Text>
          ) : null}
          <View style={{ height: spacing.md }} />
          <Dropdown
            label="Vehicle"
            iconName="truck-outline"
            value={selected}
            options={vehicles.map((v) => ({ label: v, value: v }))}
            placeholder={vehicles.length === 0 ? 'No vehicles available' : 'Select a vehicle'}
            onChange={(v) => setSelected(v)}
            disabled={vehicles.length === 0}
          />
          <View style={{ height: spacing.md }} />
          <View style={s.modalActions}>
            <View style={{ flex: 1 }}>
              <Button label="Cancel" variant="outline" onPress={onClose} />
            </View>
            <View style={{ flex: 1 }}>
              <Button
                label="Load"
                onPress={() => selected && onConfirm(selected)}
                disabled={!selected}
              />
            </View>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/* ─── Styles ──────────────────────────────────────────────────────── */

const s = StyleSheet.create({
  scrollContent: { paddingBottom: 120 },

  // Summary line at the top of the scroll
  summary: { paddingHorizontal: spacing.xs, marginBottom: spacing.sm },
  summaryNumber: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.md,
    color: COLORS.text,
  },
  summaryMuted: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.sm,
    color: COLORS.textMuted,
  },

  // Scanner
  scanRow: { flexDirection: 'row', gap: spacing.sm },
  scanField: { flex: 1 },
  scanLabel: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.xs,
    color: COLORS.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: spacing.xs,
  },
  changeLinkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: spacing.xs,
    alignSelf: 'flex-end',
  },
  changeLink: {
    fontFamily: fontFamily.medium,
    fontSize: fontSize.xs,
    color: COLORS.text,
  },

  // Empty / generic
  emptyWrap: { alignItems: 'center', paddingVertical: spacing.lg, gap: spacing.xs },
  emptyIcon: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: COLORS.surfaceAlt,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  emptyTitle: { fontFamily: fontFamily.semiBold, fontSize: fontSize.md, color: COLORS.text },
  emptyHint: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.sm,
    color: COLORS.textMuted,
    textAlign: 'center',
  },

  // Section header (Trolleys tab)
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionLabel: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.xs,
    color: COLORS.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
    marginLeft: spacing.xs,
  },
  clearAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: spacing.xs,
  },
  clearAllText: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.xs,
    color: COLORS.danger ?? '#EF4444',
  },

  // Shelf group
  shelfHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  shelfBadge: {
    width: 28, height: 28, borderRadius: 8,
    backgroundColor: COLORS.text,
    alignItems: 'center', justifyContent: 'center',
  },
  shelfTitle: { fontFamily: fontFamily.bold, fontSize: fontSize.md, color: COLORS.text },
  shelfMeta: { fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: COLORS.textMuted },

  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: COLORS.border,
    marginVertical: spacing.sm,
  },
  rowDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: COLORS.border,
    marginVertical: spacing.xs,
  },

  // Pick row
  pickRow: { paddingVertical: spacing.xs, gap: 4 },
  pickRowMain: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: spacing.sm,
  },
  bucketId: {
    fontFamily: 'monospace',
    fontSize: fontSize.sm,
    color: COLORS.text,
    fontWeight: '700',
  },
  variety: {
    fontFamily: fontFamily.medium,
    fontSize: fontSize.sm,
    color: COLORS.textSecondary,
    flexShrink: 1,
    textAlign: 'right',
  },
  pickRowMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  pickRowFootnote: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.xs,
    color: COLORS.textMuted,
    marginTop: 4,
  },
  metaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: borderRadius.full,
    backgroundColor: COLORS.surfaceAlt,
  },
  metaPillText: {
    fontFamily: fontFamily.medium,
    fontSize: 11,
    color: COLORS.textSecondary,
  },

  // Trolley card
  trolleyHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  trolleyNumber: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: COLORS.text,
    alignItems: 'center', justifyContent: 'center',
  },
  trolleyNumberLoaded: { backgroundColor: '#2563EB' /* blue when in truck */ },
  trolleyNumberText: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.sm,
    color: COLORS.textOnPrimary ?? '#fff',
  },
  trolleyId: { fontFamily: fontFamily.bold, fontSize: fontSize.md, color: COLORS.text },
  trolleyMeta: { fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: COLORS.textMuted },

  trolleyBucketRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 6,
  },
  trolleyQty: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.xs,
    color: COLORS.textSecondary,
  },
  removeBtn: {
    width: 24, height: 24, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: COLORS.surfaceAlt,
  },

  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: borderRadius.full,
  },
  statusBadgeSaved: { backgroundColor: COLORS.text },
  statusBadgeMuted: { backgroundColor: COLORS.surfaceAlt },
  statusBadgeLoaded: { backgroundColor: '#DBEAFE' },
  statusBadgeText: {
    fontFamily: fontFamily.bold,
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  statusBadgeTextSaved: { color: '#FFFFFF' },
  statusBadgeTextMuted: { color: COLORS.textMuted },
  statusBadgeTextLoaded: { color: '#1E3A8A' },

  loadedInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: borderRadius.md,
    backgroundColor: COLORS.surfaceAlt,
    justifyContent: 'center',
  },
  loadedInlineText: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.sm,
    color: COLORS.text,
  },

  // Save bar (sticky)
  saveBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: spacing.md,
    backgroundColor: COLORS.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
  },

  // Load truck modal
  modalBackdrop: {
    flex: 1,
    backgroundColor: COLORS.overlay ?? 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  modalSheet: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: COLORS.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
  },
  modalHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  modalTitle: { fontFamily: fontFamily.bold, fontSize: fontSize.lg, color: COLORS.text },
  modalSubtitle: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.sm,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  modalActions: { flexDirection: 'row', gap: spacing.sm },
});
