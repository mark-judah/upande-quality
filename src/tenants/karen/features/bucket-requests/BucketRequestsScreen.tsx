import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Alert as RNAlert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '@/src/core/ui/Screen';
import { Card, Alert } from '@/src/core/ui/Card';
import { Button } from '@/src/core/ui/Button';
import { Segmented } from '@/src/core/ui/Segmented';
import { ScanField, type ScanFieldHandle } from '@/src/core/scanning/ScanField';
import { focusWhenReady } from '@/src/core/scanning/focus';
import { useToast } from '@/src/core/ui/Toast';
import { borderRadius, COLORS, fontFamily, fontSize, spacing } from '@/src/core/theme';
import {
  useKarenBucketRequestsStore,
  type OrderGroup,
  type TrolleyOpl,
  type PlannedTrip,
  type PlannedTripStop,
} from '@/src/tenants/karen/state/karen-bucket-requests-store';
import type { ReqOpl, ReqBucket, Vehicle } from '@/src/tenants/karen/offline/bucket-requests-db';

type Tab = 'requests' | 'trips' | 'trolley' | 'transit';

/** OPL name -> its planned trip, so the Requests tab can grey unscheduled ones. */
type OplTripInfo = { tripId: string; confirmed: boolean; status: string };
type OplTripMap = Record<string, OplTripInfo>;

export function KarenBucketRequestsScreen({ userFarm }: { userFarm: string }) {
  const trolleyRef = useRef<ScanFieldHandle>(null);
  const bucketRef = useRef<ScanFieldHandle>(null);
  const { showSuccess, showError } = useToast();
  const [tab, setTab] = useState<Tab>('requests');
  const [refreshing, setRefreshing] = useState(false);
  const [scanStatus, setScanStatus] = useState<{ ok: boolean; message: string } | null>(null);
  // The completed OPL awaiting a truck choice (null = picker closed).
  const [truckPickerFor, setTruckPickerFor] = useState<TrolleyOpl | null>(null);
  const [truckQuery, setTruckQuery] = useState('');

  const {
    ready,
    error,
    requests,
    trolley,
    inTransit,
    vehicles,
    plannedTrips,
    reqCount,
    trolleyCount,
    inTransitCount,
    tripsCount,
    activeTrolleyId,
    online,
    downloading,
    loadingTrips,
    syncingOpl,
    init,
    refresh,
    download,
    loadPlannedTrips,
    setTrolleyFromScan,
    clearActiveTrolley,
    scanBucketFromScan,
    loadToTruck,
    markInTransit,
    clearAll,
  } = useKarenBucketRequestsStore();

  // OPL name -> the planned trip it sits on (for greying the Requests tab).
  const oplTrip = useMemo(() => {
    const m: OplTripMap = {};
    for (const t of plannedTrips) {
      for (const o of t.orders ?? []) {
        if (o.opl) m[o.opl] = { tripId: t.tripId, confirmed: t.confirmed, status: t.status };
      }
    }
    return m;
  }, [plannedTrips]);

  useEffect(() => {
    init();
  }, [init]);

  useFocusEffect(
    useCallback(() => {
      focusWhenReady(activeTrolleyId ? bucketRef : trolleyRef);
    }, [activeTrolleyId]),
  );
  useEffect(() => {
    focusWhenReady(activeTrolleyId ? bucketRef : trolleyRef);
  }, [activeTrolleyId]);

  const onTrolleyScan = (raw: string) => {
    const r = setTrolleyFromScan(raw);
    if (!r.ok) {
      const msg = r.message ?? 'Invalid trolley QR.';
      setScanStatus({ ok: false, message: msg });
      showError(msg);
      trolleyRef.current?.clear();
      focusWhenReady(trolleyRef);
    } else {
      const msg = `Trolley ${r.trolleyId} active`;
      setScanStatus({ ok: true, message: msg });
      showSuccess(`Trolley ${r.trolleyId}`);
      trolleyRef.current?.clear();
    }
  };

  const onBucketScan = async (raw: string) => {
    const r = await scanBucketFromScan(raw);
    setScanStatus({ ok: r.ok, message: r.message });
    if (r.ok) showSuccess(r.message);
    else showError(r.message);
    bucketRef.current?.clear();
    focusWhenReady(bucketRef);
  };

  // "Load to truck" now needs a truck: open the picker instead of loading straight away.
  const onLoad = (o: TrolleyOpl) => {
    setTruckQuery('');
    setTruckPickerFor(o);
  };
  const onPickTruck = async (truck: string) => {
    const target = truckPickerFor;
    setTruckPickerFor(null);
    if (!target) return;
    const r = await loadToTruck(target.oplName, target.pliIds, truck);
    if (r.ok) showSuccess(r.message);
    else showError(r.message);
  };
  const onTransit = async (o: TrolleyOpl) => {
    const r = await markInTransit(o.oplName, o.pliIds);
    if (r.ok) showSuccess(r.message);
    else showError(r.message);
  };

  const onDownload = async () => {
    const r = await download(userFarm);
    if (r.ok) showSuccess(r.message);
    else showError(r.message);
  };

  const onClear = () => {
    RNAlert.alert(
      'Clear downloaded data?',
      'This removes all downloaded picklists, scans and trolleys from this device.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            await clearAll();
            showSuccess('Cleared.');
          },
        },
      ],
    );
  };

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      // On the Trips tab a pull also re-pulls the live plan (when online).
      if (tab === 'trips' && online) await loadPlannedTrips(userFarm);
      await refresh();
    } finally {
      setRefreshing(false);
    }
  };

  const onRefreshTrips = async () => {
    const r = await loadPlannedTrips(userFarm);
    if (!r.ok && r.message) showError(r.message);
  };

  if (!ready && error) {
    return (
      <Screen title="Bucket Requests" scroll={false}>
        <Alert tone="danger">{error}</Alert>
        <Card>
          <Button label="Retry" iconLeft="refresh" onPress={() => init()} />
        </Card>
      </Screen>
    );
  }

  return (
    <Screen title="Bucket Requests" scroll={false}>
      <ScrollView
        contentContainerStyle={s.scroll}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.text} />
        }
      >
        <View style={s.topRow}>
          <View style={{ flex: 1 }}>
            <Button
              label={downloading ? 'Downloading…' : 'Download picklists'}
              iconLeft="cloud-download-outline"
              onPress={onDownload}
              loading={downloading}
              disabled={downloading}
            />
          </View>
          <Pressable style={s.clearBtn} hitSlop={8} onPress={onClear}>
            <Ionicons name="trash-outline" size={16} color={COLORS.danger ?? '#EF4444'} />
          </Pressable>
        </View>
        {!online ? (
          <Text style={s.offline}>Offline — you can still scan; downloads need internet.</Text>
        ) : null}

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
                  style={s.changeRow}
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

        {scanStatus ? (
          <View style={[s.statusBanner, scanStatus.ok ? s.statusOk : s.statusErr]}>
            <Ionicons
              name={scanStatus.ok ? 'checkmark-circle' : 'alert-circle'}
              size={18}
              color={scanStatus.ok ? (COLORS.success ?? '#12B76A') : (COLORS.danger ?? '#EF4444')}
            />
            <Text
              style={[
                s.statusText,
                { color: scanStatus.ok ? (COLORS.success ?? '#067647') : (COLORS.danger ?? '#B42318') },
              ]}
              numberOfLines={2}
            >
              {scanStatus.message}
            </Text>
          </View>
        ) : null}

        <Segmented
          value={tab}
          onChange={(v) => setTab(v as Tab)}
          options={[
            { value: 'requests', label: `Requests (${reqCount})` },
            { value: 'trips', label: `Trips (${tripsCount})` },
            { value: 'trolley', label: `Trolley (${trolleyCount})` },
            { value: 'transit', label: `In Transit (${inTransitCount})` },
          ]}
        />

        {tab === 'requests' ? (
          <RequestsTab groups={requests} oplTrip={oplTrip} />
        ) : tab === 'trips' ? (
          <TripsTab
            trips={plannedTrips}
            farm={userFarm}
            online={online}
            loading={loadingTrips}
            onRefresh={onRefreshTrips}
          />
        ) : tab === 'trolley' ? (
          <TrolleyTab items={trolley} syncingOpl={syncingOpl} onLoad={onLoad} onTransit={onTransit} />
        ) : (
          <InTransitTab items={inTransit} />
        )}
      </ScrollView>

      <TruckPicker
        visible={!!truckPickerFor}
        orderName={truckPickerFor?.orderName ?? ''}
        vehicles={vehicles}
        query={truckQuery}
        onQuery={setTruckQuery}
        online={online}
        onClose={() => setTruckPickerFor(null)}
        onPick={onPickTruck}
      />
    </Screen>
  );
}

function TruckPicker({
  visible,
  orderName,
  vehicles,
  query,
  onQuery,
  online,
  onClose,
  onPick,
}: {
  visible: boolean;
  orderName: string;
  vehicles: Vehicle[];
  query: string;
  onQuery: (q: string) => void;
  online: boolean;
  onClose: () => void;
  onPick: (truck: string) => void;
}) {
  const q = query.trim().toLowerCase();
  const filtered = q
    ? vehicles.filter(
        (v) =>
          v.name.toLowerCase().includes(q) || v.licensePlate.toLowerCase().includes(q),
      )
    : vehicles;
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.sheetBackdrop} onPress={onClose} />
      <View style={s.sheet}>
        <View style={s.sheetHandle} />
        <Text style={s.sheetTitle}>Load to truck</Text>
        <Text style={s.sheetSub} numberOfLines={1}>
          {orderName}
        </Text>
        <View style={s.sheetHint}>
          <Ionicons name="wifi-outline" size={14} color={COLORS.textMuted} />
          <Text style={s.sheetHintText}>Loading to a truck needs internet.</Text>
        </View>
        {!online ? (
          <Text style={s.sheetOffline}>You’re offline — connect before choosing a truck.</Text>
        ) : null}
        {vehicles.length === 0 ? (
          <View style={s.empty}>
            <Ionicons name="car-outline" size={26} color={COLORS.textMuted} />
            <Text style={s.emptyTitle}>No trucks downloaded</Text>
            <Text style={s.emptyHint}>Tap “Download picklists” while Download pickonline to fetch trucks.</Text>
          </View>
        ) : (
          <>
            <TextInput
              value={query}
              onChangeText={onQuery}
              placeholder="Search truck / plate"
              placeholderTextColor={COLORS.textMuted}
              autoCorrect={false}
              autoCapitalize="characters"
              style={s.sheetSearch}
            />
            <ScrollView style={s.sheetList} keyboardShouldPersistTaps="handled">
              {filtered.map((v) => (
                <Pressable key={v.name} style={s.truckRow} onPress={() => onPick(v.name)}>
                  <Ionicons name="car-outline" size={18} color={COLORS.text} />
                  <Text style={s.truckName}>{v.licensePlate || v.name}</Text>
                  <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} />
                </Pressable>
              ))}
              {filtered.length === 0 ? (
                <Text style={s.emptyHint}>No truck matches “{query}”.</Text>
              ) : null}
            </ScrollView>
          </>
        )}
      </View>
    </Modal>
  );
}

function RequestsTab({ groups, oplTrip }: { groups: OrderGroup[]; oplTrip: OplTripMap }) {
  const [query, setQuery] = useState('');

  if (!groups.length) {
    return (
      <Card>
        <View style={s.empty}>
          <Ionicons name="download-outline" size={26} color={COLORS.textMuted} />
          <Text style={s.emptyTitle}>No picklists</Text>
          <Text style={s.emptyHint}>Tap “Download picklists” while online to load your orders.</Text>
        </View>
      </Card>
    );
  }

  const q = query.trim().toLowerCase();
  const filtered = q
    ? groups.filter((g) => {
        const inName = g.orderName.toLowerCase().includes(q);
        const inCustomer = g.opls.some((o) => (o.customer || '').toLowerCase().includes(q));
        return inName || inCustomer;
      })
    : groups;

  // Orders on a trip come first; unscheduled ones sink to the bottom (greyed).
  const isScheduled = (g: OrderGroup) => g.opls.some((o) => !!oplTrip[o.oplName]);
  const sorted = [...filtered].sort((a, b) => Number(isScheduled(b)) - Number(isScheduled(a)));
  const firstUnschedIdx = sorted.findIndex((g) => !isScheduled(g));

  return (
    <>
      <View style={s.searchRow}>
        <Ionicons name="search" size={16} color={COLORS.textMuted} />
        <TextInput
          style={s.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder="Search by order or customer"
          placeholderTextColor={COLORS.textMuted}
          autoCorrect={false}
          autoCapitalize="none"
        />
        {query ? (
          <Pressable onPress={() => setQuery('')} hitSlop={8}>
            <Ionicons name="close-circle" size={18} color={COLORS.textMuted} />
          </Pressable>
        ) : null}
      </View>

      {sorted.length === 0 ? (
        <Card>
          <View style={s.empty}>
            <Text style={s.emptyHint}>No orders match “{query}”.</Text>
          </View>
        </Card>
      ) : null}

      {sorted.map((g, idx) => {
        const customer = g.opls.find((o) => o.customer)?.customer;
        const scheduled = isScheduled(g);
        return (
          <View key={g.orderName}>
            {firstUnschedIdx > 0 && idx === firstUnschedIdx ? (
              <Text style={s.sectionHdr}>Not on a trip yet</Text>
            ) : null}
            <Text style={[s.groupHdr, !scheduled ? s.groupHdrDim : null]}>{g.orderName}</Text>
            {customer ? (
              <Text style={[s.groupCustomer, !scheduled ? s.groupHdrDim : null]}>{customer}</Text>
            ) : null}
            {g.opls.map((o) => (
              <OplCard key={o.oplName} opl={o} trip={oplTrip[o.oplName]} />
            ))}
          </View>
        );
      })}
    </>
  );
}

/** Bucket meta line: "Variety · 40cm · Shelf", omitting any empty part. A bare
 *  numeric stem length gets a "cm" suffix; anything else is shown as-is. */
function bucketMeta(variety: string, stemLength: string, shelf: string): string {
  const stem = (stemLength || '').trim();
  const stemLabel = stem ? (/^\d+(\.\d+)?$/.test(stem) ? `${stem}cm` : stem) : '';
  return [variety, stemLabel, shelf].filter(Boolean).join(' · ');
}

function OplCard({ opl, trip }: { opl: ReqOpl; trip?: OplTripInfo }) {
  const pct = opl.total > 0 ? Math.round((opl.scanned / opl.total) * 100) : 0;
  const dimmed = !trip;
  return (
    <View style={dimmed ? s.dimmed : undefined}>
    <Card>
      <View style={s.oplTagRow}>
        {trip ? (
          <View style={[s.oplTag, trip.confirmed ? s.oplTagConfirmed : s.oplTagPlanned]}>
            <Ionicons
              name="car"
              size={12}
              color={trip.confirmed ? (COLORS.textOnPrimary ?? '#fff') : COLORS.text}
            />
            <Text style={[s.oplTagText, trip.confirmed ? s.oplTagTextConfirmed : null]} numberOfLines={1}>
              {trip.tripId} · {trip.confirmed ? 'Confirmed' : 'Planned'}
            </Text>
          </View>
        ) : (
          <View style={s.oplTagUnsched}>
            <Ionicons name="ellipse-outline" size={11} color={COLORS.textMuted} />
            <Text style={s.oplTagUnschedText}>Unscheduled</Text>
          </View>
        )}
      </View>
      <View style={s.oplHead}>
        <View style={{ flex: 1 }}>
          <Text style={s.oplDate}>{opl.createdOn || '—'}</Text>
          <Text style={s.oplMeta}>
            {opl.scanned}/{opl.total} scanned
          </Text>
        </View>
        <Text style={s.pct}>{pct}%</Text>
      </View>
      <View style={s.track}>
        <View style={[s.fill, { width: `${pct}%` }]} />
      </View>
      <View style={s.divider} />
      {opl.buckets.map((b) => (
        <View key={b.id} style={s.bRow}>
          <Ionicons
            name={b.scanned ? 'checkmark-circle' : 'ellipse-outline'}
            size={18}
            color={b.scanned ? (COLORS.success ?? '#12B76A') : COLORS.textMuted}
          />
          <View style={{ flex: 1 }}>
            <Text style={s.bId}>{b.bucketId}</Text>
            <Text style={s.bMeta} numberOfLines={1}>
              {bucketMeta(b.variety, b.stemLength, b.shelf)}
            </Text>
          </View>
          <Text style={s.bQty}>
            {Math.round(b.qty)} {b.uom}
          </Text>
        </View>
      ))}
    </Card>
    </View>
  );
}

function CompletedCard({ o, footer }: { o: TrolleyOpl; footer: ReactNode }) {
  return (
    <Card>
      <View style={s.oplHead}>
        <View style={{ flex: 1 }}>
          <Text style={s.bId}>{o.orderName}</Text>
          <Text style={s.oplMeta}>
            {o.createdOn} · trolley {o.trolleys.join(', ') || '—'}
          </Text>
        </View>
        <View style={s.badge}>
          <Text style={s.badgeTxt}>{o.buckets.length}</Text>
        </View>
      </View>
      <View style={s.divider} />
      {o.buckets.map((b: ReqBucket) => (
        <View key={b.id} style={s.bRow}>
          <Ionicons name="checkmark-circle" size={16} color={COLORS.success ?? '#12B76A'} />
          <View style={{ flex: 1 }}>
            <Text style={s.bId}>{b.bucketId}</Text>
            <Text style={s.bMeta} numberOfLines={1}>
              {bucketMeta(b.variety, b.stemLength, b.shelf)}
            </Text>
          </View>
          <Text style={s.bQty}>{b.trolleyId || ''}</Text>
        </View>
      ))}
      <View style={s.divider} />
      {footer}
    </Card>
  );
}

function TrolleyTab({
  items,
  syncingOpl,
  onLoad,
  onTransit,
}: {
  items: TrolleyOpl[];
  syncingOpl: string | null;
  onLoad: (o: TrolleyOpl) => void;
  onTransit: (o: TrolleyOpl) => void;
}) {
  if (!items.length) {
    return (
      <Card>
        <View style={s.empty}>
          <Ionicons name="cart-outline" size={26} color={COLORS.textMuted} />
          <Text style={s.emptyTitle}>No completed orders</Text>
          <Text style={s.emptyHint}>Fully-scanned orders appear here to load to a truck.</Text>
        </View>
      </Card>
    );
  }
  return (
    <>
      {items.map((o) => (
        <CompletedCard
          key={o.oplName}
          o={o}
          footer={
            o.loadedToTruck ? (
              <Button
                label="Mark in transit"
                iconLeft="swap-horizontal"
                loading={syncingOpl === o.oplName}
                onPress={() => onTransit(o)}
              />
            ) : (
              <Button
                label="Load to truck"
                iconLeft="car-outline"
                loading={syncingOpl === o.oplName}
                onPress={() => onLoad(o)}
              />
            )
          }
        />
      ))}
    </>
  );
}

function InTransitTab({ items }: { items: TrolleyOpl[] }) {
  if (!items.length) {
    return (
      <Card>
        <View style={s.empty}>
          <Ionicons name="car-outline" size={26} color={COLORS.textMuted} />
          <Text style={s.emptyTitle}>Nothing in transit</Text>
          <Text style={s.emptyHint}>Orders marked in transit appear here.</Text>
        </View>
      </Card>
    );
  }
  return (
    <>
      {items.map((o) => (
        <CompletedCard
          key={o.oplName}
          o={o}
          footer={
            <View style={s.loadedInline}>
              <Ionicons name="car" size={16} color={COLORS.text} />
              <Text style={s.loadedInlineText}>In transit</Text>
            </View>
          }
        />
      ))}
    </>
  );
}

/** Upcoming planned trips coming to collect from this farm — so the attendant
 *  can pre-stage trolleys before the truck arrives. */
function TripsTab({
  trips,
  farm,
  online,
  loading,
  onRefresh,
}: {
  trips: PlannedTrip[];
  farm: string;
  online: boolean;
  loading: boolean;
  onRefresh: () => void;
}) {
  return (
    <>
      <View style={s.tripsHead}>
        <Text style={s.tripsHint} numberOfLines={2}>
          {farm ? `Trucks coming for ${farm}` : 'Upcoming trips'} — start staging trolleys before they
          arrive.
        </Text>
        <Pressable style={s.refreshTrips} hitSlop={8} onPress={onRefresh} disabled={loading}>
          <Ionicons name="refresh" size={15} color={COLORS.text} />
          <Text style={s.refreshTripsText}>{loading ? '…' : 'Refresh'}</Text>
        </Pressable>
      </View>

      {!trips.length ? (
        <Card>
          <View style={s.empty}>
            <Ionicons name="bus-outline" size={26} color={COLORS.textMuted} />
            <Text style={s.emptyTitle}>No planned trips</Text>
            <Text style={s.emptyHint}>
              {online
                ? 'No trucks are scheduled to collect from your farm yet. Pull down to refresh.'
                : 'Connect to the internet and pull down to load the trip plan.'}
            </Text>
          </View>
        </Card>
      ) : (
        trips.map((t) => <TripCard key={t.tripId} trip={t} />)
      )}
    </>
  );
}

/** Visual treatment per stop status. */
const STOP_UI: Record<
  PlannedTripStop['status'],
  { label: string; color: string; icon: keyof typeof Ionicons.glyphMap }
> = {
  waiting: { label: 'Not loaded', color: COLORS.danger, icon: 'ellipse-outline' },
  loading: { label: 'Loading', color: COLORS.warn, icon: 'time-outline' },
  ready: { label: 'Trolleys ready', color: COLORS.success, icon: 'checkmark-circle' },
  transit: { label: 'On the truck', color: '#2E90FA', icon: 'car' },
  done: { label: 'Delivered', color: COLORS.textMuted, icon: 'checkmark-done-circle' },
};

function StopRow({ stop }: { stop: PlannedTripStop }) {
  const ui = STOP_UI[stop.status] ?? STOP_UI.waiting;
  const progress = stop.total > 0 ? `${stop.doneCount}/${stop.total}` : `${stop.planned}`;
  return (
    <View style={[s.stopRow, stop.isYou ? s.stopRowYou : null]}>
      <Text style={[s.stopNum, stop.isYou ? s.stopNumYou : null]}>{stop.stop}</Text>
      <View style={{ flex: 1 }}>
        <Text style={s.stopFarm} numberOfLines={1}>
          {stop.farm}
          {stop.isYou ? '  · you' : ''}
          {stop.delaying ? '  ⚠︎' : ''}
        </Text>
        <Text style={[s.stopStatus, { color: ui.color }]} numberOfLines={1}>
          {ui.label} · {progress}
          {stop.delaying ? ' · holding up the run' : ''}
        </Text>
      </View>
      <Ionicons name={ui.icon} size={16} color={ui.color} />
    </View>
  );
}

function TripCard({ trip }: { trip: PlannedTrip }) {
  return (
    <Card>
      <View style={s.tripHead}>
        <View style={s.tripTruck}>
          <Ionicons name="car" size={16} color={COLORS.text} />
          <Text style={s.tripTruckText} numberOfLines={1}>
            {trip.vehicle || 'No truck yet'}
          </Text>
        </View>
        {trip.inTransit ? (
          <View style={[s.tripPill, s.tripPillTransit]}>
            <Text style={[s.tripPillText, s.tripPillTextConfirmed]}>In transit</Text>
          </View>
        ) : null}
        <View style={[s.tripPill, trip.confirmed ? s.tripPillConfirmed : s.tripPillDraft]}>
          <Text
            style={[s.tripPillText, trip.confirmed ? s.tripPillTextConfirmed : s.tripPillTextDraft]}
          >
            {trip.confirmed ? 'Confirmed' : 'Planned'}
          </Text>
        </View>
      </View>

      <View style={s.tripMetaRow}>
        <Text style={s.tripMeta} numberOfLines={1}>
          {trip.tripId}
          {trip.tripDate ? ` · ${trip.tripDate}` : ''}
        </Text>
        {trip.yourStop > 0 && trip.totalStops > 1 ? (
          <Text style={s.tripStop}>
            You’re stop {trip.yourStop} of {trip.totalStops} · {trip.farmBuckets} bkt
          </Text>
        ) : (
          <Text style={s.tripStop}>{trip.farmBuckets} bkt for you</Text>
        )}
      </View>

      <View style={s.divider} />
      <Text style={s.routeLabel}>Collection route</Text>
      {(trip.stops ?? []).map((st) => (
        <StopRow key={`${trip.tripId}-${st.stop}-${st.farm}`} stop={st} />
      ))}
    </Card>
  );
}

const s = StyleSheet.create({
  scroll: { paddingBottom: 40 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs },
  clearBtn: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.surfaceAlt,
  },
  offline: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.xs,
    color: COLORS.textMuted,
    marginBottom: spacing.sm,
  },
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
  changeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: spacing.xs,
    alignSelf: 'flex-end',
  },
  changeLink: { fontFamily: fontFamily.medium, fontSize: fontSize.xs, color: COLORS.text },
  groupHdr: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.sm,
    color: COLORS.text,
    marginTop: spacing.md,
    marginBottom: 2,
    marginLeft: spacing.xs,
  },
  groupHdrDim: { color: COLORS.textMuted },
  sectionHdr: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.xs,
    color: COLORS.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: spacing.lg,
    marginBottom: spacing.xs,
    marginLeft: spacing.xs,
  },
  dimmed: { opacity: 0.5 },
  oplTagRow: { flexDirection: 'row', marginBottom: spacing.xs },
  oplTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: borderRadius.full,
  },
  oplTagConfirmed: { backgroundColor: COLORS.success },
  oplTagPlanned: { backgroundColor: COLORS.surfaceAlt },
  oplTagText: { fontFamily: fontFamily.semiBold, fontSize: 11, color: COLORS.text },
  oplTagTextConfirmed: { color: COLORS.textOnPrimary ?? '#fff' },
  oplTagUnsched: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: borderRadius.full,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
  },
  oplTagUnschedText: { fontFamily: fontFamily.medium, fontSize: 11, color: COLORS.textMuted },
  groupCustomer: {
    fontFamily: fontFamily.medium,
    fontSize: fontSize.xs,
    color: COLORS.textMuted,
    marginBottom: spacing.xs,
    marginLeft: spacing.xs,
  },
  oplHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  oplDate: { fontFamily: fontFamily.semiBold, fontSize: fontSize.sm, color: COLORS.text },
  oplMeta: { fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: COLORS.textMuted },
  pct: { fontFamily: fontFamily.bold, fontSize: fontSize.md, color: COLORS.text },
  track: {
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.surfaceAlt,
    marginTop: spacing.sm,
    overflow: 'hidden',
  },
  fill: { height: 6, backgroundColor: COLORS.text },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: COLORS.border,
    marginVertical: spacing.sm,
  },
  bRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 6 },
  bId: { fontFamily: 'monospace', fontSize: fontSize.sm, color: COLORS.text, fontWeight: '700' },
  bMeta: { fontFamily: fontFamily.medium, fontSize: fontSize.sm, color: COLORS.textSecondary },
  bQty: { fontFamily: fontFamily.semiBold, fontSize: fontSize.xs, color: COLORS.textSecondary },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: borderRadius.full,
    backgroundColor: COLORS.text,
  },
  badgeTxt: { fontFamily: fontFamily.bold, fontSize: 11, color: COLORS.textOnPrimary ?? '#fff' },
  // Trips tab
  tripsHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  tripsHint: { flex: 1, fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: COLORS.textMuted },
  refreshTrips: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  refreshTripsText: { fontFamily: fontFamily.medium, fontSize: fontSize.xs, color: COLORS.text },
  tripHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  tripTruck: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  tripTruckText: { fontFamily: fontFamily.semiBold, fontSize: fontSize.md, color: COLORS.text },
  tripPill: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: borderRadius.full },
  tripPillConfirmed: { backgroundColor: COLORS.success },
  tripPillDraft: { backgroundColor: COLORS.surfaceAlt },
  tripPillTransit: { backgroundColor: '#2E90FA' },
  tripPillText: { fontFamily: fontFamily.bold, fontSize: 10, letterSpacing: 0.4, textTransform: 'uppercase' },
  tripPillTextConfirmed: { color: COLORS.textOnPrimary ?? '#fff' },
  tripPillTextDraft: { color: COLORS.textMuted },
  routeLabel: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.xs,
    color: COLORS.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 4,
  },
  stopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 7,
    paddingHorizontal: 8,
    borderRadius: borderRadius.sm,
  },
  stopRowYou: { backgroundColor: COLORS.surfaceAlt },
  stopNum: {
    width: 20,
    height: 20,
    borderRadius: 10,
    textAlign: 'center',
    lineHeight: 20,
    fontFamily: fontFamily.bold,
    fontSize: 11,
    color: COLORS.textMuted,
    backgroundColor: COLORS.surfaceAlt,
    overflow: 'hidden',
  },
  stopNumYou: { color: COLORS.textOnPrimary ?? '#fff', backgroundColor: COLORS.text },
  stopFarm: { fontFamily: fontFamily.semiBold, fontSize: fontSize.sm, color: COLORS.text },
  stopStatus: { fontFamily: fontFamily.medium, fontSize: fontSize.xs, marginTop: 1 },
  tripMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginTop: 4,
  },
  tripMeta: { flex: 1, fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: COLORS.textMuted },
  tripStop: { fontFamily: fontFamily.semiBold, fontSize: fontSize.xs, color: COLORS.text },
  tripBucketsRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  tripBucketsText: { fontFamily: fontFamily.semiBold, fontSize: fontSize.sm, color: COLORS.text },
  empty: { alignItems: 'center', paddingVertical: spacing.lg, gap: spacing.xs },
  emptyTitle: { fontFamily: fontFamily.semiBold, fontSize: fontSize.md, color: COLORS.text },
  emptyHint: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.sm,
    color: COLORS.textMuted,
    textAlign: 'center',
  },
  statusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: spacing.sm,
  },
  statusOk: { backgroundColor: '#ECFDF3', borderColor: '#ABEFC6' },
  statusErr: { backgroundColor: '#FEF3F2', borderColor: '#FECDCA' },
  statusText: { flex: 1, fontFamily: fontFamily.semiBold, fontSize: fontSize.sm },
  loadedInline: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: borderRadius.md,
    backgroundColor: COLORS.surfaceAlt,
  },
  loadedInlineText: { fontFamily: fontFamily.semiBold, fontSize: fontSize.sm, color: COLORS.text },
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '80%',
    backgroundColor: COLORS.surface ?? '#fff',
    borderTopLeftRadius: borderRadius.lg ?? 16,
    borderTopRightRadius: borderRadius.lg ?? 16,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.border,
    marginBottom: spacing.sm,
  },
  sheetTitle: { fontFamily: fontFamily.bold, fontSize: fontSize.md, color: COLORS.text },
  sheetSub: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.xs,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  sheetHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: spacing.sm,
  },
  sheetHintText: { fontFamily: fontFamily.medium, fontSize: fontSize.xs, color: COLORS.textMuted },
  sheetOffline: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.xs,
    color: COLORS.danger ?? '#B42318',
    marginTop: spacing.xs,
  },
  sheetSearch: {
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surfaceAlt,
    fontFamily: fontFamily.medium,
    fontSize: fontSize.sm,
    color: COLORS.text,
  },
  sheetList: { marginTop: spacing.sm },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surfaceAlt,
    marginBottom: spacing.xs,
  },
  searchInput: {
    flex: 1,
    fontFamily: fontFamily.medium,
    fontSize: fontSize.sm,
    color: COLORS.text,
    padding: 0,
  },
  truckRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  truckName: { flex: 1, fontFamily: fontFamily.semiBold, fontSize: fontSize.sm, color: COLORS.text },
});
